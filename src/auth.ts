import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import type { Repo, User } from "./db/repo.js";
import type { Events } from "./events.js";
import { LEGAL_VERSION } from "./legal.js";
import { log } from "./logger.js";
import type { Mailer } from "./mail/index.js";
import { checkPasswordPolicy, hashPassword, needsRehash, verifyPassword } from "./password.js";
import { maskEmail } from "./mail/index.js";

export const SESSION_COOKIE = "rw_session";

export interface Principal {
  user: User;
  accountId: number;
  /** system | user:<id> | agent:<name> */
  actor: string;
  via: "session" | "api_key";
  isAdmin: boolean;
}

export class AuthError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 429,
    message: string,
  ) {
    super(message);
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Passwordless auth. A login request creates a single-use token and emails a
 * link; verifying it creates the user/account on first use and a session.
 */
export class Auth {
  constructor(
    private readonly cfg: Config,
    private readonly repo: Repo,
    private readonly events: Events,
    private readonly mailer: Mailer,
  ) {}

  isAdminEmail(email: string): boolean {
    return this.cfg.ADMIN_EMAILS.includes(email.toLowerCase());
  }

  /** Step 1: request a magic link. Rate limited per email. Always returns silently to avoid account enumeration. */
  async requestLogin(emailRaw: string, ip: string | null): Promise<{ sent: boolean; devLink?: string; error?: string }> {
    const email = emailRaw.trim().toLowerCase();
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    if (this.repo.countRecentLoginTokens(email, hourAgo) >= 5) {
      this.events.record({ type: "user.login_failed", result: "denied", riskLevel: "medium", payload: { email: maskEmail(email), reason: "rate_limited", ip } });
      throw new AuthError(429, "Too many login attempts. Try again in an hour.");
    }
    const token = newToken();
    const expires = new Date(Date.now() + this.cfg.MAGIC_LINK_MINUTES * 60_000).toISOString();
    this.repo.createLoginToken(hashToken(token), email, expires, ip);
    const link = `${this.cfg.publicUrl}/auth/verify?token=${token}`;
    const existing = this.repo.getUserByEmail(email);
    const result = await this.mailer.send(
      {
        to: email,
        kind: "magic_link",
        subject: "Your RivalWatch sign-in link",
        text: `Click to sign in to RivalWatch:\n\n${link}\n\nThis link expires in ${this.cfg.MAGIC_LINK_MINUTES} minutes and can be used once. If you did not request it, ignore this email.`,
        html: `<p>Click to sign in to RivalWatch:</p><p><a href="${link}">${link}</a></p><p>This link expires in ${this.cfg.MAGIC_LINK_MINUTES} minutes and can be used once. If you did not request it, ignore this email.</p>`,
        accountId: existing?.account_id ?? null,
      },
      existing ? `user:${existing.id}` : "system",
    );
    this.events.record({
      type: "user.login_requested",
      accountId: existing?.account_id ?? null,
      result: result.ok ? "ok" : "failed",
      payload: { email: maskEmail(email), existing: !!existing, provider: result.provider },
    });
    // In non-production with the log provider, surface the link so local sign-in is possible.
    const devLink = !this.cfg.isProduction && result.provider === "log" ? link : undefined;
    // Delivery errors are shown to the user: they reveal nothing about whether an account exists,
    // and hiding them leaves operators debugging blind.
    return { sent: result.ok, ...(devLink ? { devLink } : {}), ...(result.error ? { error: result.error } : {}) };
  }

  /** Step 2: verify the token, create user/account if needed, return a session token to set as a cookie. */
  verify(token: string): { user: User; sessionToken: string; created: boolean } {
    const now = new Date().toISOString();
    const consumed = this.repo.consumeLoginToken(hashToken(token), now);
    if (!consumed) {
      this.events.record({ type: "user.login_failed", result: "denied", payload: { reason: "invalid_or_expired" } });
      throw new AuthError(401, "This sign-in link is invalid or has expired.");
    }
    return this.establishSession(consumed.email, "magic_link");
  }

  /**
   * Operator bootstrap sign-in for deployments where email is not (yet) working.
   * Requires BOOTSTRAP_ADMIN_TOKEN to be set and the email to be in ADMIN_EMAILS.
   * Each token *value* can be used exactly once; to sign in again the operator
   * sets a new value in the environment (an operator-only action, which is the
   * trust boundary). Remove the variable when not needed.
   */
  bootstrapAdmin(token: string, emailRaw: string): { user: User; sessionToken: string; created: boolean } {
    const email = emailRaw.trim().toLowerCase();
    const expected = this.cfg.BOOTSTRAP_ADMIN_TOKEN;
    const usedHash = expected ? hashToken(`bootstrap:${expected}`) : "";
    const alreadyUsed = !!expected && this.repo.count("SELECT COUNT(*) c FROM login_tokens WHERE token_hash = ?", usedHash) > 0;
    const why = {
      token_configured: !!expected,
      token_long_enough: !!expected && expected.length >= 16,
      token_matches: !!expected && safeEqual(token, expected),
      email_is_admin: this.isAdminEmail(email),
      token_unused: !alreadyUsed,
    };
    if (!Object.values(why).every(Boolean)) {
      // Operator-facing diagnostics: flags only, never values.
      log.warn("bootstrap sign-in rejected", { email: maskEmail(email), ...why, admin_emails_configured: this.cfg.ADMIN_EMAILS.length });
      this.events.record({ type: "user.login_failed", result: "denied", riskLevel: "high", payload: { reason: "bootstrap_rejected", email: maskEmail(email), ...why } });
      const failed = Object.entries(why).filter(([, v]) => !v).map(([k]) => k).join(", ");
      throw new AuthError(403, `Bootstrap sign-in is not available (${failed}). ${alreadyUsed ? "This token value was already used: set a new BOOTSTRAP_ADMIN_TOKEN in the environment to sign in again." : ""}`.trim());
    }
    // Burn this token value: recorded as a pre-used login token so it survives restarts.
    this.repo.createLoginToken(usedHash, email, new Date(Date.now() + 100 * 365 * 86_400_000).toISOString(), "bootstrap");
    this.repo.db.prepare("UPDATE login_tokens SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash = ?").run(usedHash);
    const result = this.establishSession(email, "bootstrap");
    this.events.record({ type: "agent.action", actor: `user:${result.user.id}`, accountId: result.user.account_id, entity: { type: "user", id: result.user.id }, riskLevel: "high", requestedBy: "operator", approvedBy: "env:BOOTSTRAP_ADMIN_TOKEN", payload: { action: "bootstrap_admin_login" } });
    return result;
  }

  /**
   * Optional password sign-in. Passwords are scrypt-hashed; 10 failures lock the
   * account for 15 minutes; the response never distinguishes "no such user" from
   * "wrong password". Magic links remain available and act as the reset path.
   */
  async loginWithPassword(emailRaw: string, password: string, ip: string | null): Promise<{ user: User; sessionToken: string }> {
    const email = emailRaw.trim().toLowerCase();
    const user = this.repo.getUserByEmail(email);
    const deny = (reason: string, status: 401 | 429 = 401) => {
      this.events.record({ type: "user.login_failed", accountId: user?.account_id ?? null, result: "denied", riskLevel: reason === "locked" ? "medium" : "low", payload: { method: "password", reason, email: maskEmail(email), ip } });
      throw new AuthError(status, status === 429 ? "Too many failed attempts. Try again in 15 minutes, or use an email sign-in link." : "Incorrect email or password.");
    };
    if (!user || !user.password_hash) {
      await hashPassword(password); // constant-ish time whether or not the user exists
      return deny(user ? "no_password_set" : "no_such_user");
    }
    if (user.locked_until && user.locked_until > new Date().toISOString()) return deny("locked", 429);
    if (!(await verifyPassword(password, user.password_hash))) {
      const { locked } = this.repo.recordFailedLogin(user.id, 10, 15);
      return deny(locked ? "locked" : "bad_password", locked ? 429 : 401);
    }
    if (needsRehash(user.password_hash)) this.repo.setUserPassword(user.id, await hashPassword(password));
    const s = this.establishSession(email, "password");
    return { user: s.user, sessionToken: s.sessionToken };
  }

  async setPassword(p: Principal, password: string, currentSessionToken?: string): Promise<void> {
    const check = checkPasswordPolicy(password, p.user.email);
    if (!check.ok) throw new AuthError(400, check.reason!);
    this.repo.setUserPassword(p.user.id, await hashPassword(password));
    // Changing the password signs out every other session.
    const dropped = this.repo.deleteSessionsForUser(p.user.id, currentSessionToken ? hashToken(currentSessionToken) : undefined);
    this.events.record({ type: "user.password_set", actor: p.actor, accountId: p.accountId, entity: { type: "user", id: p.user.id }, riskLevel: "medium", payload: { other_sessions_revoked: dropped } });
  }

  removePassword(p: Principal): void {
    this.repo.setUserPassword(p.user.id, null);
    this.events.record({ type: "user.password_removed", actor: p.actor, accountId: p.accountId, entity: { type: "user", id: p.user.id }, riskLevel: "medium" });
  }

  /** Records acceptance of the current legal documents. */
  acceptLegal(user: User, ip: string | null): void {
    for (const doc of ["terms", "privacy"]) this.repo.recordConsent(user.id, doc, LEGAL_VERSION, ip);
    this.events.record({ type: "user.consent_recorded", actor: `user:${user.id}`, accountId: user.account_id, entity: { type: "user", id: user.id }, payload: { documents: ["terms", "privacy"], version: LEGAL_VERSION } });
  }

  hasCurrentConsent(user: User): boolean {
    return this.repo.hasConsent(user.id, "terms", LEGAL_VERSION) && this.repo.hasConsent(user.id, "privacy", LEGAL_VERSION);
  }

  private establishSession(email: string, method: "magic_link" | "bootstrap" | "password"): { user: User; sessionToken: string; created: boolean } {
    let user = this.repo.getUserByEmail(email);
    let created = false;
    if (!user) {
      const account = this.repo.createAccount({ name: email.split("@")[0] ?? "My account" });
      user = this.repo.createUser({ account_id: account.id, email, role: "owner", is_admin: this.isAdminEmail(email) });
      created = true;
      this.events.record({ type: "account.created", actor: `user:${user.id}`, accountId: account.id, entity: { type: "account", id: account.id }, payload: { plan: account.plan } });
      this.events.record({ type: "user.signup", actor: `user:${user.id}`, accountId: account.id, entity: { type: "user", id: user.id }, payload: { email: maskEmail(user.email) } });
    }
    this.repo.touchUserLogin(user.id, this.isAdminEmail(user.email));
    user = this.repo.getUser(user.id)!;
    const sessionToken = newToken();
    this.repo.createSession(hashToken(sessionToken), user.id, new Date(Date.now() + this.cfg.SESSION_DAYS * 86_400_000).toISOString());
    this.events.record({ type: "user.login", actor: `user:${user.id}`, accountId: user.account_id, entity: { type: "user", id: user.id }, payload: { created, method } });
    return { user, sessionToken, created };
  }

  principalFromSession(sessionToken: string | undefined): Principal | undefined {
    if (!sessionToken) return undefined;
    const user = this.repo.sessionUser(hashToken(sessionToken), new Date().toISOString());
    if (!user) return undefined;
    return { user, accountId: user.account_id, actor: `user:${user.id}`, via: "session", isAdmin: user.is_admin === 1 };
  }

  principalFromApiKey(key: string | undefined): Principal | undefined {
    if (!key) return undefined;
    const found = this.repo.apiKeyByHash(hashToken(key));
    if (!found) return undefined;
    return { user: found.user, accountId: found.account_id, actor: `agent:${found.name}`, via: "api_key", isAdmin: false };
  }

  logout(sessionToken: string | undefined, principal: Principal | undefined): void {
    if (sessionToken) this.repo.deleteSession(hashToken(sessionToken));
    if (principal) this.events.record({ type: "user.logout", actor: principal.actor, accountId: principal.accountId, entity: { type: "user", id: principal.user.id } });
  }

  /** Creates an API key; the plaintext is returned exactly once. */
  createApiKey(p: Principal, name: string): { key: string; id: number; prefix: string } {
    const key = `rw_${newToken(24)}`;
    const prefix = key.slice(0, 11);
    const row = this.repo.createApiKey({ account_id: p.accountId, user_id: p.user.id, name, key_hash: hashToken(key), key_prefix: prefix });
    this.events.record({ type: "api_key.created", actor: p.actor, accountId: p.accountId, entity: { type: "api_key", id: row.id }, riskLevel: "medium", payload: { name, prefix } });
    return { key, id: row.id, prefix };
  }

  revokeApiKey(p: Principal, id: number): boolean {
    const ok = this.repo.revokeApiKey(p.accountId, id);
    if (ok) this.events.record({ type: "api_key.revoked", actor: p.actor, accountId: p.accountId, entity: { type: "api_key", id }, riskLevel: "medium" });
    return ok;
  }
}
