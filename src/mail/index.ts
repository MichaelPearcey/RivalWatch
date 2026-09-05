import type { Config } from "../config.js";
import type { Repo } from "../db/repo.js";
import type { Events } from "../events.js";
import { errorFields, log } from "../logger.js";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** magic_link | weekly_digest | test ... */
  kind: string;
  accountId?: number | null;
}

export interface SendResult {
  ok: boolean;
  provider: string;
  providerId?: string;
  error?: string;
}

/** Provider contract. Implementations must not throw; return ok=false instead. */
export interface MailProvider {
  readonly name: string;
  send(email: Email, from: string): Promise<SendResult>;
}

/** Writes emails to the log only. Default in development and tests. */
export class LogMailProvider implements MailProvider {
  readonly name = "log";
  async send(email: Email): Promise<SendResult> {
    log.info("email (log provider)", { to: email.to, subject: email.subject, kind: email.kind });
    return { ok: true, provider: this.name, providerId: `log-${Date.now()}` };
  }
}

/** Resend via plain HTTPS; no SDK dependency. https://resend.com/docs/api-reference/emails/send-email */
export class ResendMailProvider implements MailProvider {
  readonly name = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(email: Email, from: string): Promise<SendResult> {
    try {
      const res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!res.ok) return { ok: false, provider: this.name, error: `${res.status} ${body.name ?? ""} ${body.message ?? ""}`.trim() };
      return { ok: true, provider: this.name, ...(body.id ? { providerId: body.id } : {}) };
    } catch (err) {
      return { ok: false, provider: this.name, error: (err as Error).message };
    }
  }
}

/**
 * The application-facing mailer: sends via the provider, records every email
 * in the `emails` table and emits email.sent / email.failed events.
 */
export class Mailer {
  constructor(
    private readonly provider: MailProvider,
    private readonly from: string,
    private readonly repo: Repo,
    private readonly events: Events,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  async send(email: Email, actor = "system"): Promise<SendResult> {
    const result = await this.provider.send(email, this.from);
    const row = this.repo.recordEmail({
      account_id: email.accountId ?? null,
      to_address: email.to,
      kind: email.kind,
      subject: email.subject,
      provider: result.provider,
      provider_id: result.providerId ?? null,
      status: result.ok ? (result.provider === "log" ? "logged" : "sent") : "failed",
      error: result.error ?? null,
      body_text: result.provider === "log" ? email.text : null,
    });
    this.events.record({
      type: result.ok ? "email.sent" : "email.failed",
      actor,
      accountId: email.accountId ?? null,
      entity: { type: "email", id: row.id },
      result: result.ok ? "ok" : "failed",
      payload: { to: maskEmail(email.to), kind: email.kind, provider: result.provider, ...(result.error ? { error: result.error } : {}) },
    });
    if (!result.ok) log.error("email failed", { kind: email.kind, provider: result.provider, ...errorFields(result.error) });
    return result;
  }
}

export function createMailer(cfg: Config, repo: Repo, events: Events, fetchImpl?: typeof fetch): Mailer {
  const provider: MailProvider = cfg.EMAIL_PROVIDER === "resend" ? new ResendMailProvider(cfg.RESEND_API_KEY!, fetchImpl) : new LogMailProvider();
  return new Mailer(provider, cfg.EMAIL_FROM, repo, events);
}

/** j***@example.com - keep addresses out of the event log. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
