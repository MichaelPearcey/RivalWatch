import type { Db } from "./db/index.js";
import type { Events } from "./events.js";

/**
 * Shared memory: the bridge between the humans, the in-app founder assistant
 * and the engineering agent (Devin, running elsewhere). Everyone reads and
 * writes the same notes; nothing important lives only in a chat transcript.
 */
export type MemoryKind = "fact" | "decision" | "request" | "journal" | "preference";
export const MEMORY_KINDS: MemoryKind[] = ["fact", "decision", "request", "journal", "preference"];

export interface MemoryNote {
  id: number;
  created_at: string;
  author: string;
  kind: MemoryKind;
  title: string;
  body: string;
  tags: string;
  status: "open" | "done" | "superseded";
  source: string | null;
}

export class Memory {
  constructor(
    private readonly db: Db,
    private readonly events: Events,
  ) {}

  add(input: { author: string; kind: MemoryKind; title: string; body: string; tags?: string[]; source?: string | null }): MemoryNote {
    const row = this.db
      .prepare("INSERT INTO memory_notes (author, kind, title, body, tags, source) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
      .get(input.author, input.kind, input.title.slice(0, 200), input.body.slice(0, 20_000), (input.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean).join(","), input.source ?? null) as unknown as MemoryNote;
    this.events.record({ type: "memory.added", actor: input.author, entity: { type: "memory", id: row.id }, payload: { kind: row.kind, title: row.title, tags: row.tags } });
    return row;
  }

  setStatus(id: number, status: MemoryNote["status"], actor: string): void {
    this.db.prepare("UPDATE memory_notes SET status = ? WHERE id = ?").run(status, id);
    this.events.record({ type: "memory.updated", actor, entity: { type: "memory", id }, payload: { status } });
  }

  get(id: number): MemoryNote | undefined {
    return this.db.prepare("SELECT * FROM memory_notes WHERE id = ?").get(id) as MemoryNote | undefined;
  }

  list(opts: { kind?: MemoryKind; status?: MemoryNote["status"]; since?: string; sinceId?: number; limit?: number } = {}): MemoryNote[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (opts.kind) {
      clauses.push("kind = ?");
      params.push(opts.kind);
    }
    if (opts.status) {
      clauses.push("status = ?");
      params.push(opts.status);
    }
    if (opts.since) {
      clauses.push("created_at >= ?");
      params.push(opts.since);
    }
    if (opts.sinceId !== undefined) {
      clauses.push("id > ?");
      params.push(opts.sinceId);
    }
    params.push(opts.limit ?? 100);
    return this.db.prepare(`SELECT * FROM memory_notes ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`).all(...params) as unknown as MemoryNote[];
  }

  /** Simple keyword search over title, body and tags. */
  search(query: string, limit = 20): MemoryNote[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    if (terms.length === 0) return this.list({ limit });
    const where = terms.map(() => "(lower(title) LIKE ? OR lower(body) LIKE ? OR tags LIKE ?)").join(" AND ");
    const params = terms.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`]);
    return this.db.prepare(`SELECT * FROM memory_notes WHERE ${where} ORDER BY id DESC LIMIT ?`).all(...params, limit) as unknown as MemoryNote[];
  }

  /** Compact digest of what matters for a system prompt: open requests, recent decisions, preferences, facts. */
  briefing(maxChars = 6000): string {
    const sections: [string, MemoryNote[]][] = [
      ["Open requests (things people asked for)", this.list({ kind: "request", status: "open", limit: 15 })],
      ["Preferences", this.list({ kind: "preference", status: "open", limit: 15 })],
      ["Recent decisions", this.list({ kind: "decision", limit: 10 })],
      ["Facts", this.list({ kind: "fact", status: "open", limit: 15 })],
      ["Recent journal", this.list({ kind: "journal", limit: 8 })],
    ];
    let out = "";
    for (const [h, notes] of sections) {
      if (!notes.length) continue;
      out += `\n## ${h}\n` + notes.map((n) => `- [#${n.id} ${n.created_at.slice(0, 10)} ${n.author}] ${n.title}: ${n.body.slice(0, 300).replace(/\s+/g, " ")}`).join("\n") + "\n";
      if (out.length > maxChars) break;
    }
    return out.slice(0, maxChars);
  }
}
