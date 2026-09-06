/** Single stylesheet, inlined. System fonts only (no third-party requests = no cookie banner, no font-loading flash). */
export const CSS = `
:root{
  --bg:#f6f7f9;--surface:#ffffff;--ink:#0f172a;--ink-2:#334155;--muted:#64748b;--line:#e2e8f0;--line-2:#cbd5e1;
  --brand:#1d4ed8;--brand-2:#1e40af;--brand-soft:#dbeafe;--ok:#15803d;--ok-soft:#dcfce7;--warn:#b45309;--warn-soft:#fef3c7;--bad:#b91c1c;--bad-soft:#fee2e2;
  --radius:12px;--shadow:0 1px 2px rgba(15,23,42,.06),0 8px 24px -12px rgba(15,23,42,.18);
  --font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Inter,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:16px/1.55 var(--font);background:var(--bg);color:var(--ink)}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
h1,h2,h3{line-height:1.2;letter-spacing:-.01em;color:var(--ink)}h1{font-size:2rem;margin:0 0 .5rem}h2{font-size:1.35rem;margin:2rem 0 .75rem}h3{font-size:1.05rem;margin:1.25rem 0 .5rem}
p{margin:.5rem 0}code{font:.9em var(--mono);background:#f1f5f9;padding:.1em .35em;border-radius:5px}
pre{font:.85rem/1.5 var(--mono);background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:.85rem 1rem;overflow:auto;white-space:pre-wrap}
table{width:100%;border-collapse:collapse;font-size:.95rem}th,td{text-align:left;padding:.55rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}

/* nav */
.nav{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.9);backdrop-filter:saturate(180%) blur(8px);border-bottom:1px solid var(--line)}
.nav-in{max-width:1100px;margin:0 auto;padding:.7rem 1.25rem;display:flex;align-items:center;gap:1.25rem}
.brand{display:flex;align-items:center;gap:.55rem;font-weight:800;font-size:1.1rem;color:var(--ink);letter-spacing:-.02em}.brand:hover{text-decoration:none}
.logo{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,var(--brand),#7c3aed);display:inline-block;position:relative}
.logo:after{content:"";position:absolute;inset:7px;border:2.5px solid #fff;border-radius:50%;border-right-color:transparent;transform:rotate(-45deg)}
.nav a.link{color:var(--ink-2);font-weight:500}.nav .right{margin-left:auto;display:flex;gap:.75rem;align-items:center}

/* layout */
.wrap{max-width:1100px;margin:0 auto;padding:1.5rem 1.25rem 4rem}.narrow{max-width:760px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:1.25rem;box-shadow:var(--shadow);margin-bottom:1rem}
.card.flat{box-shadow:none}.card.alert{border-color:#fca5a5;background:#fff7f7}.card.good{border-color:#86efac}.card.info{border-color:#93c5fd;background:#f5f9ff}
.row{display:flex;gap:1rem;flex-wrap:wrap;align-items:center}.row.top{align-items:flex-start}.grow{flex:1}.ml{margin-left:auto}
.grid{display:grid;gap:1rem}.g2{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}.g3{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.muted{color:var(--muted)}.small{font-size:.875rem}.tiny{font-size:.8rem}.center{text-align:center}
.empty{padding:2.5rem 1rem;text-align:center;color:var(--muted)}

/* badges */
.badge{display:inline-flex;align-items:center;gap:.3rem;padding:.1rem .6rem;border-radius:999px;font-size:.75rem;font-weight:600;border:1px solid var(--line);background:#f8fafc;color:var(--ink-2);white-space:nowrap}
.badge.cat{text-transform:uppercase;letter-spacing:.05em}.badge.imp-4,.badge.imp-5{border-color:#fcd34d;background:var(--warn-soft);color:var(--warn)}
.badge.st-ACTIVE,.badge.ok{border-color:#86efac;background:var(--ok-soft);color:var(--ok)}.badge.st-PAUSED{color:var(--muted)}
.badge.st-ROBOTS_BLOCKED,.badge.st-AUTH_REQUIRED,.badge.st-RATE_LIMITED,.badge.st-FETCH_ERROR,.badge.st-CONTENT_UNREADABLE,.badge.bad{border-color:#fca5a5;background:var(--bad-soft);color:var(--bad)}
.badge.brand{border-color:#93c5fd;background:var(--brand-soft);color:var(--brand-2)}

/* forms */
form.inline{display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end}label{display:flex;flex-direction:column;gap:.25rem;font-size:.85rem;color:var(--ink-2);font-weight:500}
input,select,textarea{font:inherit;padding:.55rem .7rem;border:1px solid var(--line-2);border-radius:8px;background:#fff;color:var(--ink);min-width:0}
input:focus,select:focus,textarea:focus{outline:2px solid var(--brand-soft);border-color:var(--brand)}textarea{min-height:4.5rem;width:100%}
.check{flex-direction:row;align-items:flex-start;gap:.6rem;font-weight:400}.check input{margin-top:.3rem}
button,.btn{font:inherit;font-weight:600;padding:.55rem 1rem;border-radius:8px;border:1px solid var(--brand);background:var(--brand);color:#fff;cursor:pointer;display:inline-flex;align-items:center;gap:.4rem;text-decoration:none}
button:hover,.btn:hover{background:var(--brand-2);text-decoration:none}button:disabled{opacity:.5;cursor:not-allowed}
button.secondary,.btn.secondary{background:#fff;color:var(--ink);border-color:var(--line-2)}button.secondary:hover,.btn.secondary:hover{background:#f8fafc}
button.danger{background:#fff;color:var(--bad);border-color:#fca5a5}button.danger:hover{background:var(--bad-soft)}
button.tiny,.btn.tiny{padding:.25rem .6rem;font-size:.8rem;font-weight:500}button.active{background:var(--brand-soft);border-color:var(--brand);color:var(--brand-2)}
.btn.big{padding:.85rem 1.4rem;font-size:1.05rem;border-radius:10px}

/* insight */
.insight{border-left:4px solid var(--brand)}.insight.filtered{border-left-color:var(--line-2);opacity:.85}.insight h3{margin:.4rem 0 .2rem;font-size:1.1rem}
.why{background:#f8fafc;border-radius:8px;padding:.6rem .8rem;margin-top:.5rem}.fb{display:inline-flex;gap:.35rem;flex-wrap:wrap;align-items:center}.fb form{display:inline}
.diff .del{color:var(--bad)}.diff .add{color:var(--ok)}

/* marketing */
.hero{padding:4rem 0 2.5rem;text-align:center}.hero h1{font-size:clamp(2rem,5vw,3.25rem);letter-spacing:-.03em;max-width:820px;margin:0 auto .75rem}
.hero p.lead{font-size:1.2rem;color:var(--ink-2);max-width:640px;margin:0 auto 1.5rem}
.eyebrow{display:inline-block;font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);margin-bottom:.75rem}
.steps{counter-reset:s}.step{position:relative;padding-left:3rem}.step:before{counter-increment:s;content:counter(s);position:absolute;left:0;top:0;width:2.1rem;height:2.1rem;border-radius:50%;background:var(--brand-soft);color:var(--brand-2);font-weight:800;display:flex;align-items:center;justify-content:center}
.price{font-size:2.2rem;font-weight:800;letter-spacing:-.03em}.price small{font-size:1rem;font-weight:500;color:var(--muted)}
.plan.featured{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.tick{list-style:none;padding:0;margin:.75rem 0}.tick li{padding:.25rem 0 .25rem 1.5rem;position:relative}.tick li:before{content:"✓";position:absolute;left:0;color:var(--ok);font-weight:800}
.footer{border-top:1px solid var(--line);margin-top:3rem;padding:2rem 1.25rem;color:var(--muted);font-size:.9rem}.footer-in{max-width:1100px;margin:0 auto;display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center}
.stat{display:inline-block;min-width:7.5rem;margin:.25rem 1.25rem .25rem 0}.stat b{display:block;font-size:1.5rem;letter-spacing:-.02em}
.prose h1{font-size:1.75rem}.prose h2{font-size:1.25rem;margin-top:1.75rem}.prose table{font-size:.9rem}
details summary{cursor:pointer}
@media (max-width:640px){.nav a.link.hide-sm{display:none}.hero{padding:2.5rem 0 1.5rem}}
`;
