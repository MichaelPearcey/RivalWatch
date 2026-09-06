import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import type { Repo, User } from "./db/repo.js";
import type { Events } from "./events.js";
import { log } from "./logger.js";
import type { Mailer } from "./mail/index.js";
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
    readonly status: 401 | 403 | 429,
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
  async requestLogin(emailRaw: string, ip: string | null): Promise<{ sent: boolean; devLink?: string }> {
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
    return { sent: result.ok, ...(devLink ? { devLink } : {}) };
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
   * One-time operator bootstrap for a fresh deployment where email is not yet
   * configured. Requires BOOTSTRAP_ADMIN_TOKEN to be set, the email to be in
   * ADMIN_EMAILS, and works only while no admin has ever signed in. Remove the
   * variable afterwards.
   */
  bootstrapAdmin(token: string, emailRaw: string): { user: User; sessionToken: string; created: boolean } {
    const email = emailRaw.trim().toLowerCase();
    const expected = this.cfg.BOOTSTRAP_ADMIN_TOKEN;
    const anyAdminLoggedIn = this.repo.count("SELECT COUNT(*) c FROM users WHERE is_admin = 1 AND last_login_at IS NOT NULL") > 0;
    const ok = !!expected && expected.length >= 16 && safeEqual(token, expected) && this.isAdminEmail(email) && !anyAdminLoggedIn;
    if (!ok) {
      const why = {
        token_configured: !!expected,
        token_long_enough: !!expected && expected.length >= 16,
        token_matches: !!expected && safeEqual(token, expected),
        email_is_admin: this.isAdminEmail(email),
        admin_emails_configured: this.cfg.ADMIN_EMAILS.length,
        already_bootstrapped: anyAdminLoggedIn,
      };
      // Operator-facing diagnostics: flags only, never values.
      log.warn("bootstrap sign-in rejected", { email: maskEmail(email), ...why });
      this.events.record({ type: "user.login_failed", result: "denied", riskLevel: "high", payload: { reason: "bootstrap_rejected", email: maskEmail(email), ...why } });
      throw new AuthError(403, `Bootstrap sign-in is not available (${Object.entries(why).filter(([, v]) => v === false).map(([k]) => k).join(", ") || "already used"}).`);
    }
    const result = this.establishSession(email, "bootstrap");
    this.events.record({ type: "agent.action", actor: `user:${result.user.id}`, accountId: result.user.account_id, entity: { type: "user", id: result.user.id }, riskLevel: "high", requestedBy: "operator", approvedBy: "env:BOOTSTRAP_ADMIN_TOKEN", payload: { action: "bootstrap_admin_login" } });
    return result;
  }

  private establishSession(email: string, method: "magic_link" | "bootstrap"): { user: User; sessionToken: string; created: boolean } {
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
