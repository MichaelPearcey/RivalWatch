import type { Business, Landscape, LandscapeDoc } from "../db/repo.js";
import type { Translate } from "../i18n/index.js";

/**
 * Standalone HTML for the competitor briefing, used for both downloads:
 * Word opens HTML happily when it is served as application/msword, and the
 * same markup printed from the browser gives a clean PDF. No dependency and
 * no headless browser; the styling is inline so the file survives being
 * emailed on to someone else.
 */

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function list(title: string, items: string[]): string {
  if (!items.length) return "";
  return `<h2>${esc(title)}</h2><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

export interface LandscapeDocOptions {
  t: Translate;
  business: Business;
  landscape: Landscape;
  doc: LandscapeDoc;
  /** Adds a print button and opens the browser print dialog (used for "save as PDF"). */
  print?: boolean;
  lang: string;
}

export function renderLandscapeDocument({ t, business, landscape, doc, print = false, lang }: LandscapeDocOptions): string {
  const generated = t("ls.generated", { date: (landscape.generated_at ?? "").slice(0, 10), n: landscape.competitor_count ?? doc.competitors.length });
  const rows = doc.competitors
    .map(
      (c) =>
        `<tr><td class="name">${esc(c.name)}</td><td>${esc(c.positioning)}</td><td>${esc(c.pricing)}</td><td>${esc(c.strengths)}</td><td>${esc(c.watch_out)}</td></tr>`,
    )
    .join("");
  const head = [t("ls.col.competitor"), t("ls.col.positioning"), t("ls.col.pricing"), t("ls.col.strengths"), t("ls.col.watch")]
    .map((h) => `<th>${esc(h)}</th>`)
    .join("");
  const bar = print
    ? `<div class="bar no-print"><button type="button" onclick="window.print()">${esc(t("ls.print.button"))}</button><span>${esc(t("ls.print.hint"))}</span></div>`
    : "";
  return `<!doctype html>
<html lang="${esc(lang)}"><head><meta charset="utf-8"><title>${esc(t("ls.doc.for", { name: business.name }))}</title>
<style>
body{font-family:Calibri,Segoe UI,Arial,sans-serif;color:#111;line-height:1.45;max-width:52rem;margin:2rem auto;padding:0 1.5rem}
h1{font-size:1.6rem;margin:0 0 .2rem}h2{font-size:1.1rem;margin:1.4rem 0 .3rem}h3{font-size:1.25rem;margin:1.2rem 0 .3rem}
.meta{color:#555;font-size:.85rem;margin:0 0 1.2rem}
table{border-collapse:collapse;width:100%;font-size:.85rem;margin-top:.4rem}
th,td{border:1px solid #bbb;padding:.4rem .5rem;text-align:left;vertical-align:top}
th{background:#f1eefc}td.name{font-weight:700;white-space:nowrap}
ul{margin:.3rem 0 0;padding-left:1.2rem}
.bar{background:#f4f2ff;border:1px solid #d9d2ff;border-radius:8px;padding:.7rem .9rem;margin-bottom:1.5rem;font-size:.85rem;display:flex;gap:.8rem;align-items:center;flex-wrap:wrap}
.bar button{font:inherit;padding:.4rem .9rem;border-radius:6px;border:0;background:#7c3aed;color:#fff;cursor:pointer}
.foot{margin-top:2rem;color:#666;font-size:.75rem;border-top:1px solid #ddd;padding-top:.6rem}
@media print{.no-print{display:none}body{margin:0;max-width:none}}
</style></head>
<body>
${bar}
<h1>${esc(t("ls.doc.for", { name: business.name }))}</h1>
<p class="meta">${esc(generated)}${doc.provider === "heuristic" ? ` · ${esc(t("ls.heuristic"))}` : ""}</p>
<h3>${esc(doc.headline)}</h3>
<p>${esc(doc.summary)}</p>
<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
${list(t("ls.opportunities"), doc.opportunities)}
${list(t("ls.threats"), doc.threats)}
${list(t("ls.actions"), doc.recommendations)}
<p class="foot">RivalWatch — ${esc(t("ls.h"))}</p>
</body></html>`;
}

/** Word-safe file name: no path separators, no characters Windows rejects. */
export function landscapeFilename(businessName: string, ext: string): string {
  const base = businessName.replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "business";
  return `rivalwatch-landscape-${base}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}
