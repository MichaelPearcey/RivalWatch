import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import type { Principal } from "../auth.js";
import type { Conversation, FounderMessage } from "../founder/index.js";
import type { MemoryNote } from "../memory.js";
import { renderMarkdown } from "./md.js";
import { Layout } from "./views.js";

const fmt = (iso: string) => iso.replace("T", " ").slice(0, 16);

export const FounderPage: FC<{ principal: Principal; conversations: Conversation[]; current: Conversation | null; messages: FounderMessage[]; memory: MemoryNote[]; available: boolean; model: string; flash?: string | undefined }> = ({ principal, conversations, current, messages, memory, available, model, flash }) => (
  <Layout title="Founder" principal={principal} flash={flash}>
    <div class="row top">
      <div class="grow">
        <h1 style="margin:0">Founder assistant</h1>
        <p class="muted small" style="margin:.2rem 0 0">
          Talk about the company, ask what has been built, request changes. Requests are saved to shared memory, which Devin (the engineering agent) reads at the start of every session. Model: <code>{model}</code>. Write in any language.
        </p>
      </div>
      <form method="post" action="/admin/founder/new">
        <button class="secondary" type="submit">
          New conversation
        </button>
      </form>
    </div>
    {!available ? <div class="card alert">The assistant needs the Anthropic provider (AI_PROVIDER=anthropic with a key).</div> : null}

    <div class="grid" style="grid-template-columns:minmax(0,1fr) 300px;gap:1rem;margin-top:1rem">
      <div>
        {current ? (
          <div class="card" style="padding:1rem">
            <div class="muted tiny" style="margin-bottom:.5rem">
              conversation #{current.id} · {current.turns} turns · ${current.estimated_cost_usd.toFixed(3)}
            </div>
            {messages.length === 0 ? <p class="muted">Say hello - for example: "What did you build this week?" or "Я хочу змінити кольори на головній сторінці."</p> : null}
            {messages.map((m) =>
              m.role === "tool" ? (
                <details class="tiny muted" style="margin:.25rem 0 .5rem">
                  <summary>{m.tool_calls} tool call(s)</summary>
                  <ul style="margin:.2rem 0">
                    {(JSON.parse(m.content) as { tool: string; ok: boolean; summary: string }[]).map((a) => (
                      <li>
                        <code>{a.tool}</code> {a.ok ? "✓" : "✗"} <span class="muted">{a.summary}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <div style={`margin:.5rem 0;padding:.75rem 1rem;border-radius:12px;${m.role === "user" ? "background:rgba(110,168,255,.12);border:1px solid rgba(110,168,255,.35);margin-left:15%" : "background:var(--surface-2);border:1px solid var(--line);margin-right:10%"}`}>
                  <div class="tiny muted" style="margin-bottom:.2rem">
                    {m.role === "user" ? "You" : "Founder"} · {fmt(m.created_at)}
                    {m.role === "assistant" && m.estimated_cost_usd ? ` · $${m.estimated_cost_usd.toFixed(3)}` : ""}
                  </div>
                  <div class="prose small">{raw(renderMarkdown(m.content))}</div>
                </div>
              ),
            )}
            <form method="post" action={`/admin/founder/${current.id}/send`} style="margin-top:.75rem">
              <textarea name="text" required maxlength={8000} placeholder="Type your message…" style="min-height:5rem" autofocus></textarea>
              <div class="row" style="margin-top:.5rem">
                <button type="submit" disabled={!available}>
                  Send
                </button>
                <span class="muted tiny">Replies can take 10–40 seconds when tools are used.</span>
              </div>
            </form>
          </div>
        ) : (
          <div class="card empty">Start a new conversation.</div>
        )}
      </div>
      <div>
        <div class="card flat" style="padding:.9rem">
          <h3 style="margin:0 0 .4rem">Conversations</h3>
          {conversations.length === 0 ? <p class="muted tiny">None yet.</p> : null}
          {conversations.map((c) => (
            <div class="small" style="padding:.3rem 0;border-top:1px solid var(--line)">
              <a href={`/admin/founder/${c.id}`} style={c.id === current?.id ? "font-weight:700" : ""}>
                {c.title ?? `#${c.id}`}
              </a>
              <div class="muted tiny">{fmt(c.updated_at)}</div>
            </div>
          ))}
        </div>
        <div class="card flat" style="padding:.9rem">
          <h3 style="margin:0 0 .4rem">
            Shared memory <a class="tiny muted" href="/api/admin/memory">(JSON)</a>
          </h3>
          <p class="muted tiny">Open requests and recent notes. Devin reads these; you can add one directly.</p>
          {memory.map((n) => (
            <div class="small" style="padding:.35rem 0;border-top:1px solid var(--line)">
              <span class="badge">{n.kind}</span> <strong>{n.title}</strong>
              <div class="muted tiny">
                #{n.id} · {n.author} · {fmt(n.created_at)} · {n.status}
              </div>
              <div class="tiny">{n.body.slice(0, 240)}</div>
              {n.status === "open" && n.kind === "request" ? (
                <form method="post" action={`/admin/memory/${n.id}/status`} style="display:inline">
                  <input type="hidden" name="status" value="done" />
                  <button class="tiny secondary" type="submit">
                    Mark done
                  </button>
                </form>
              ) : null}
            </div>
          ))}
          <form method="post" action="/admin/memory" style="margin-top:.6rem">
            <select name="kind" style="width:100%">
              <option value="request">request</option>
              <option value="decision">decision</option>
              <option value="preference">preference</option>
              <option value="fact">fact</option>
              <option value="journal">journal</option>
            </select>
            <input name="title" placeholder="Title" required maxlength={200} style="width:100%;margin-top:.3rem" />
            <textarea name="body" placeholder="Details" required style="min-height:3.5rem;margin-top:.3rem"></textarea>
            <button class="tiny secondary" type="submit" style="margin-top:.3rem">
              Add note
            </button>
          </form>
        </div>
      </div>
    </div>
  </Layout>
);
