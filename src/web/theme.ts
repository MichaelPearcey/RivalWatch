/**
 * Single inline stylesheet + a few lines of inline JS. Dark by default with a light toggle
 * (persisted in localStorage). No external assets: visuals are CSS gradients and inline SVG,
 * so pages make zero third-party requests and need no cookie banner.
 */
export const CSS = `
@font-face{font-family:"Plus Jakarta Sans";font-style:normal;font-weight:300 800;font-display:swap;src:url(/static/fonts/plus-jakarta-sans-latin.woff2) format("woff2")}
:root{
  --bg:#070a12;--bg-2:#0b1020;--surface:rgba(255,255,255,.04);--surface-2:rgba(255,255,255,.07);--ink:#e8ecf5;--ink-2:#b7c0d3;--muted:#7f8aa3;--line:rgba(255,255,255,.09);--line-2:rgba(255,255,255,.16);
  --brand:#10b981;--brand-2:#14b8a6;--brand-3:#22c55e;--brand-ink:#0b1020;--ok:#34d399;--ok-soft:rgba(52,211,153,.12);--warn:#fbbf24;--warn-soft:rgba(251,191,36,.12);--bad:#f87171;--bad-soft:rgba(248,113,113,.12);
  --radius:14px;--shadow:0 1px 0 rgba(255,255,255,.04) inset,0 20px 60px -30px rgba(0,0,0,.8);--glow:0 0 0 1px rgba(16,185,129,.25),0 0 40px -10px rgba(16,185,129,.55);
  --font:"Plus Jakarta Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;--display:var(--font);--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --grid:rgba(255,255,255,.05);color-scheme:dark;
}
[data-theme="light"]{
  --bg:#f5f7fb;--bg-2:#ffffff;--surface:rgba(255,255,255,.75);--surface-2:rgba(255,255,255,.95);--ink:#0b1020;--ink-2:#2b3550;--muted:#5d6883;--line:rgba(11,16,32,.09);--line-2:rgba(11,16,32,.18);
  --brand:#059669;--brand-2:#0d9488;--brand-3:#16a34a;--brand-ink:#ffffff;--ok:#15803d;--ok-soft:rgba(21,128,61,.1);--warn:#b45309;--warn-soft:rgba(180,83,9,.1);--bad:#b91c1c;--bad-soft:rgba(185,28,28,.1);
  --shadow:0 1px 2px rgba(11,16,32,.06),0 16px 40px -24px rgba(11,16,32,.35);--glow:0 0 0 1px rgba(5,150,105,.2),0 0 40px -12px rgba(5,150,105,.45);--grid:rgba(11,16,32,.06);color-scheme:light;
}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;font:16px/1.6 var(--font);background:var(--bg);color:var(--ink);overflow-x:hidden}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
h1,h2,h3{line-height:1.18;letter-spacing:-.015em;color:var(--ink);font-family:var(--display);font-weight:700}h1{font-size:2rem;margin:0 0 .5rem}h2{font-size:1.5rem;margin:2rem 0 .75rem}h3{font-size:1.05rem;margin:1.25rem 0 .5rem;font-weight:600}
.brand,.price,.stats b,.stat b{font-family:var(--display)}body{font-weight:400}
p{margin:.5rem 0}code{font:.9em var(--mono);background:var(--surface-2);padding:.1em .4em;border-radius:6px;border:1px solid var(--line)}
pre{font:.85rem/1.55 var(--mono);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:.9rem 1rem;overflow:auto;white-space:pre-wrap}
table{width:100%;border-collapse:collapse;font-size:.95rem}th,td{text-align:left;padding:.6rem .65rem;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em}

/* backdrop */
.bg{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}
.bg .grid{position:absolute;inset:-10%;background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:56px 56px;mask-image:radial-gradient(ellipse at 50% 0%,#000 30%,transparent 75%);-webkit-mask-image:radial-gradient(ellipse at 50% 0%,#000 30%,transparent 75%)}
.orb{position:absolute;border-radius:50%;filter:blur(70px);opacity:.55;will-change:transform}
.orb.a{width:60vw;height:60vw;max-width:800px;max-height:800px;left:-15vw;top:-20vh;background:radial-gradient(circle at 30% 30%,var(--brand),transparent 60%)}
.orb.b{width:50vw;height:50vw;max-width:700px;max-height:700px;right:-15vw;top:10vh;background:radial-gradient(circle at 60% 40%,var(--brand-2),transparent 60%)}
.orb.c{width:40vw;height:40vw;max-width:520px;max-height:520px;left:30vw;top:70vh;background:radial-gradient(circle at 50% 50%,var(--brand-3),transparent 60%);opacity:.35}
[data-theme="light"] .orb{opacity:.28}[data-theme="light"] .orb.c{opacity:.18}

/* nav */
.nav{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 70%,transparent);backdrop-filter:saturate(160%) blur(14px);-webkit-backdrop-filter:saturate(160%) blur(14px);border-bottom:1px solid var(--line)}
.nav-in{max-width:1140px;margin:0 auto;padding:.75rem 1.25rem;display:flex;align-items:center;gap:1.25rem}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:700;font-size:1.05rem;color:var(--ink);letter-spacing:-.01em}.brand:hover{text-decoration:none}
.nav a.link{font-weight:400;font-size:.95rem;letter-spacing:0}.nav .btn{font-weight:600}
.logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--brand),var(--brand-2));display:inline-block;position:relative;box-shadow:var(--glow)}
.logo:after{content:"";position:absolute;inset:8px;border:2.5px solid #fff;border-radius:50%;border-right-color:transparent;transform:rotate(-45deg)}
.nav a.link{color:var(--ink-2);font-weight:500}.nav a.link:hover{color:var(--ink);text-decoration:none}.nav .right{margin-left:auto;display:flex;gap:.75rem;align-items:center}
.theme{width:36px;height:36px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.theme:hover{background:var(--surface-2)}.theme svg{width:18px;height:18px}[data-theme="light"] .theme .moon{display:none}:root:not([data-theme="light"]) .theme .sun{display:none}
.lang{display:inline-flex;align-items:center;margin:0;vertical-align:middle}.nav .right form{margin:0;display:inline-flex;align-items:center}
.lang select{appearance:none;-webkit-appearance:none;height:36px;padding:0 1.9rem 0 .7rem;border-radius:10px;border:1px solid var(--line);background:var(--bg-2) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237f8aa3' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") no-repeat right .55rem center/14px;color:var(--ink);font:inherit;font-size:.85rem;font-weight:500;cursor:pointer;line-height:34px}
.lang select:hover{background-color:var(--surface-2)}.lang select:focus{outline:2px solid rgba(16,185,129,.35)}
/* Native option lists ignore translucency; give them solid, readable colours in both themes. */
select option{background:var(--bg-2);color:var(--ink)}select option:checked{background:var(--brand);color:#fff}

/* layout */
.wrap{max-width:1140px;margin:0 auto;padding:1.5rem 1.25rem 4rem;position:relative}.narrow{max-width:780px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:1.25rem;box-shadow:var(--shadow);margin-bottom:1rem;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.card.flat{box-shadow:none}.card.alert{border-color:rgba(248,113,113,.45);background:var(--bad-soft)}.card.good{border-color:rgba(52,211,153,.45)}.card.info{border-color:rgba(16,185,129,.45);background:rgba(16,185,129,.08)}
.card.glow{box-shadow:var(--glow),var(--shadow)}
.row{display:flex;gap:1rem;flex-wrap:wrap;align-items:center}.row.top{align-items:flex-start}.grow{flex:1}.ml{margin-left:auto}
.grid{display:grid;gap:1rem}.g2{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}.g3{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.muted{color:var(--muted)}.small{font-size:.875rem}.tiny{font-size:.8rem}.center{text-align:center}
.empty{padding:2.5rem 1rem;text-align:center;color:var(--muted)}

/* badges */
.badge{display:inline-flex;align-items:center;gap:.3rem;padding:.12rem .65rem;border-radius:999px;font-size:.74rem;font-weight:600;border:1px solid var(--line-2);background:var(--surface-2);color:var(--ink-2);white-space:nowrap}
.badge.cat{text-transform:uppercase;letter-spacing:.06em}.badge.imp-4,.badge.imp-5{border-color:rgba(251,191,36,.5);background:var(--warn-soft);color:var(--warn)}
.badge.st-ACTIVE,.badge.ok{border-color:rgba(52,211,153,.5);background:var(--ok-soft);color:var(--ok)}.badge.st-PAUSED{color:var(--muted)}
.badge.st-ROBOTS_BLOCKED,.badge.st-AUTH_REQUIRED,.badge.st-RATE_LIMITED,.badge.st-FETCH_ERROR,.badge.st-CONTENT_UNREADABLE,.badge.bad{border-color:rgba(248,113,113,.5);background:var(--bad-soft);color:var(--bad)}
.badge.brand{border-color:rgba(16,185,129,.5);background:rgba(16,185,129,.12);color:var(--brand)}

/* forms */
form.inline{display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end}label{display:flex;flex-direction:column;gap:.3rem;font-size:.85rem;color:var(--ink-2);font-weight:500}
input,select,textarea{font:inherit;padding:.6rem .75rem;border:1px solid var(--line-2);border-radius:10px;background:var(--bg-2);color:var(--ink);min-width:0}
input:focus,select:focus,textarea:focus{outline:2px solid rgba(16,185,129,.35);border-color:var(--brand)}textarea{min-height:4.5rem;width:100%}
.check{flex-direction:row;align-items:flex-start;gap:.6rem;font-weight:400}.check input{margin-top:.3rem}
button,.btn{font:inherit;font-weight:600;padding:.6rem 1.05rem;border-radius:10px;border:1px solid transparent;background:linear-gradient(135deg,var(--brand),var(--brand-2));color:#fff;cursor:pointer;display:inline-flex;align-items:center;gap:.4rem;text-decoration:none;transition:transform .15s ease,box-shadow .15s ease}
button:hover,.btn:hover{text-decoration:none;transform:translateY(-1px);box-shadow:var(--glow)}button:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
button.secondary,.btn.secondary{background:var(--surface-2);color:var(--ink);border-color:var(--line-2)}button.secondary:hover,.btn.secondary:hover{box-shadow:none;background:var(--surface)}
button.danger{background:transparent;color:var(--bad);border-color:var(--bad)}button.danger:hover{background:var(--bad-soft);box-shadow:none}
button svg,.btn svg{width:1.1em;height:1.1em}

/* stats */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem}.stat{text-align:center;padding:1.25rem}.stat b{display:block;font-size:2.2rem;color:var(--brand);margin-bottom:.25rem;font-weight:700}.stat span{color:var(--muted);font-size:.85rem;text-transform:uppercase;letter-spacing:.08em}

/* hero */
.hero{text-align:center;padding:5rem 1.25rem 4rem;max-width:880px;margin:0 auto}.hero h1{font-size:clamp(2.2rem,5vw,3.5rem);margin-bottom:1rem;background:linear-gradient(135deg,var(--ink),var(--ink-2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.hero p{font-size:1.15rem;color:var(--ink-2);margin-bottom:2rem;max-width:640px;margin-left:auto;margin-right:auto}
.hero .row{justify-content:center;margin-top:2rem}

/* features */
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.5rem;margin:3rem 0}.feature{padding:1.5rem;text-align:center}.feature .icon{width:48px;height:48px;margin:0 auto 1rem;border-radius:12px;background:linear-gradient(135deg,var(--brand),var(--brand-2));display:flex;align-items:center;justify-content:center;box-shadow:var(--glow)}
.feature .icon svg{width:24px;height:24px;color:#fff}.feature h3{margin-top:0;margin-bottom:.5rem}.feature p{color:var(--ink-2);font-size:.95rem}

/* pricing */
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.5rem;margin:2rem 0}.plan{padding:1.75rem;position:relative;display:flex;flex-direction:column}.plan.featured{border-color:rgba(16,185,129,.5);box-shadow:var(--glow),var(--shadow)}
.plan .name{font-size:1.1rem;font-weight:700;margin-bottom:.5rem;color:var(--ink)}.plan .price{font-size:2.5rem;font-weight:700;color:var(--brand);margin:.5rem 0}.plan .price small{font-size:1rem;color:var(--muted);font-weight:400}
.plan ul{list-style:none;padding:0;margin:1.25rem 0;flex:1}.plan li{padding:.4rem 0;color:var(--ink-2);font-size:.95rem;display:flex;align-items:flex-start;gap:.5rem}.plan li:before{content:"✓";color:var(--ok);font-weight:700;flex-shrink:0}
.plan .btn{margin-top:auto;width:100%;justify-content:center}

/* footer */
.footer{border-top:1px solid var(--line);padding:2.5rem 1.25rem;margin-top:4rem;text-align:center;color:var(--muted);font-size:.85rem}.footer a{color:var(--ink-2)}.footer a:hover{color:var(--brand)}
.footer .links{display:flex;gap:1.5rem;justify-content:center;margin-bottom:1rem;flex-wrap:wrap}

/* insights */
.insight{border-left:3px solid var(--brand);padding-left:1rem;margin:1rem 0}.insight.imp-4,.insight.imp-5{border-color:var(--warn)}.insight .meta{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem}
.insight p{margin:.25rem 0;color:var(--ink)}

/* changelog */
.change{border-left:3px solid var(--brand-3);padding-left:1rem;margin:1.5rem 0}.change .meta{color:var(--muted);font-size:.85rem;margin-bottom:.5rem}
.change .diff{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:.75rem;margin-top:.5rem;font-family:var(--mono);font-size:.85rem;overflow:auto}
.change .diff ins{background:rgba(52,211,153,.15);color:var(--ok);text-decoration:none;padding:0 .2em}.change .diff del{background:rgba(248,113,113,.15);color:var(--bad);text-decoration:line-through;padding:0 .2em}

/* admin */
.admin-nav{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:.75rem;margin-bottom:1.5rem;display:flex;gap:.5rem;flex-wrap:wrap}
.admin-nav a{padding:.5rem 1rem;border-radius:8px;color:var(--ink-2);font-weight:500;font-size:.9rem}.admin-nav a:hover{background:var(--surface-2);color:var(--ink);text-decoration:none}
.admin-nav a.active{background:var(--brand);color:#fff}

/* responsive */
@media(max-width:640px){.hero{padding:3rem 1.25rem 2.5rem}.hero h1{font-size:2rem}.hero p{font-size:1rem}.nav-in{padding:.65rem 1rem}.features,.plans{grid-template-columns:1fr}.stats{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}.stat b{font-size:1.8rem}}
`;

export const THEME_SCRIPT = `
(function(){
  const stored = localStorage.getItem('theme');
  if(stored === 'light') document.documentElement.dataset.theme = 'light';
  else if(stored === 'dark') document.documentElement.dataset.theme = '';
  else if(window.matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset.theme = 'light';
})();
`;
