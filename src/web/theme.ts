/**
 * Single inline stylesheet + a few lines of inline JS. Dark by default with a light toggle
 * (persisted in localStorage). No external assets: visuals are CSS gradients and inline SVG,
 * so pages make zero third-party requests and need no cookie banner.
 */
export const CSS = `
@font-face{font-family:"Plus Jakarta Sans";font-style:normal;font-weight:300 800;font-display:swap;src:url(/static/fonts/plus-jakarta-sans-latin.woff2) format("woff2")}
:root{
  --bg:#070a12;--bg-2:#0b1020;--surface:rgba(255,255,255,.04);--surface-2:rgba(255,255,255,.07);--ink:#e8ecf5;--ink-2:#b7c0d3;--muted:#7f8aa3;--line:rgba(255,255,255,.09);--line-2:rgba(255,255,255,.16);
  --brand:#6ea8ff;--brand-2:#8b5cf6;--brand-3:#22d3ee;--brand-ink:#0b1020;--ok:#34d399;--ok-soft:rgba(52,211,153,.12);--warn:#fbbf24;--warn-soft:rgba(251,191,36,.12);--bad:#f87171;--bad-soft:rgba(248,113,113,.12);
  --radius:14px;--shadow:0 1px 0 rgba(255,255,255,.04) inset,0 20px 60px -30px rgba(0,0,0,.8);--glow:0 0 0 1px rgba(110,168,255,.25),0 0 40px -10px rgba(110,168,255,.55);
  --font:"Plus Jakarta Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;--display:var(--font);--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --grid:rgba(255,255,255,.05);color-scheme:dark;
}
[data-theme="light"]{
  --bg:#f5f7fb;--bg-2:#ffffff;--surface:rgba(255,255,255,.75);--surface-2:rgba(255,255,255,.95);--ink:#0b1020;--ink-2:#2b3550;--muted:#5d6883;--line:rgba(11,16,32,.09);--line-2:rgba(11,16,32,.18);
  --brand:#2563eb;--brand-2:#7c3aed;--brand-3:#0891b2;--brand-ink:#ffffff;--ok:#15803d;--ok-soft:rgba(21,128,61,.1);--warn:#b45309;--warn-soft:rgba(180,83,9,.1);--bad:#b91c1c;--bad-soft:rgba(185,28,28,.1);
  --shadow:0 1px 2px rgba(11,16,32,.06),0 16px 40px -24px rgba(11,16,32,.35);--glow:0 0 0 1px rgba(37,99,235,.2),0 0 40px -12px rgba(37,99,235,.45);--grid:rgba(11,16,32,.06);color-scheme:light;
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
.lang select:hover{background-color:var(--surface-2)}.lang select:focus{outline:2px solid rgba(110,168,255,.35)}
/* Native option lists ignore translucency; give them solid, readable colours in both themes. */
select option{background:var(--bg-2);color:var(--ink)}select option:checked{background:var(--brand);color:#fff}

/* layout */
.wrap{max-width:1140px;margin:0 auto;padding:1.5rem 1.25rem 4rem;position:relative}.narrow{max-width:780px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:1.25rem;box-shadow:var(--shadow);margin-bottom:1rem;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.card.flat{box-shadow:none}.card.alert{border-color:rgba(248,113,113,.45);background:var(--bad-soft)}.card.good{border-color:rgba(52,211,153,.45)}.card.info{border-color:rgba(110,168,255,.45);background:rgba(110,168,255,.08)}
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
.badge.brand{border-color:rgba(110,168,255,.5);background:rgba(110,168,255,.12);color:var(--brand)}

/* forms */
form.inline{display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end}label{display:flex;flex-direction:column;gap:.3rem;font-size:.85rem;color:var(--ink-2);font-weight:500}
input,select,textarea{font:inherit;padding:.6rem .75rem;border:1px solid var(--line-2);border-radius:10px;background:var(--bg-2);color:var(--ink);min-width:0}
input:focus,select:focus,textarea:focus{outline:2px solid rgba(110,168,255,.35);border-color:var(--brand)}textarea{min-height:4.5rem;width:100%}
.check{flex-direction:row;align-items:flex-start;gap:.6rem;font-weight:400}.check input{margin-top:.3rem}
button,.btn{font:inherit;font-weight:600;padding:.6rem 1.05rem;border-radius:10px;border:1px solid transparent;background:linear-gradient(135deg,var(--brand),var(--brand-2));color:#fff;cursor:pointer;display:inline-flex;align-items:center;gap:.4rem;text-decoration:none;transition:transform .15s ease,box-shadow .15s ease}
button:hover,.btn:hover{text-decoration:none;transform:translateY(-1px);box-shadow:var(--glow)}button:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
button.secondary,.btn.secondary{background:var(--surface-2);color:var(--ink);border-color:var(--line-2)}button.secondary:hover,.btn.secondary:hover{box-shadow:none;background:var(--surface)}
button.danger{background:transparent;color:var(--bad);border-color:rgba(248,113,113,.5)}button.danger:hover{background:var(--bad-soft);box-shadow:none}
button.tiny,.btn.tiny{padding:.28rem .65rem;font-size:.8rem;font-weight:500;border-radius:8px}button.active{background:rgba(110,168,255,.15);border-color:var(--brand);color:var(--brand)}
.btn.big{padding:.95rem 1.5rem;font-size:1.05rem;border-radius:12px}

/* insight */
.insight{border-left:3px solid var(--brand)}.insight.filtered{border-left-color:var(--line-2);opacity:.85}.insight h3{margin:.45rem 0 .2rem;font-size:1.1rem}
.why{background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:.7rem .9rem;margin-top:.6rem}.fb{display:inline-flex;gap:.35rem;flex-wrap:wrap;align-items:center}.fb form{display:inline}
.diff .del{color:var(--bad)}.diff .add{color:var(--ok)}

/* marketing */
.hero{min-height:calc(100vh - 64px);display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:3rem 0 2rem;position:relative}
.hero h1{font-size:clamp(2.3rem,6vw,4.3rem);letter-spacing:-.03em;line-height:1.05;max-width:980px;margin:0 auto 1rem;font-weight:700}
.gradient{background:linear-gradient(90deg,var(--brand) 0%,var(--brand-2) 50%,var(--brand-3) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p.lead{font-size:1.2rem;color:var(--ink-2);max-width:680px;margin:0 auto 1.75rem}
.eyebrow{display:inline-flex;align-items:center;gap:.5rem;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--brand);margin-bottom:1.25rem;padding:.35rem .9rem;border:1px solid var(--line-2);border-radius:999px;background:var(--surface)}
.eyebrow .dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 12px var(--ok);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.mock{width:min(860px,100%);margin:3rem auto 0;border-radius:18px;border:1px solid var(--line-2);background:var(--bg-2);box-shadow:var(--glow),0 40px 100px -40px rgba(0,0,0,.9);text-align:left;overflow:hidden;position:relative}
.mock .bar{display:flex;gap:.4rem;align-items:center;padding:.65rem .9rem;border-bottom:1px solid var(--line);background:var(--surface)}
.mock .bar i{width:10px;height:10px;border-radius:50%;background:var(--line-2);display:inline-block}.mock .bar .url{margin-left:.6rem;font:.75rem var(--mono);color:var(--muted);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:.15rem .6rem;flex:1}
.mock .body{padding:1.1rem 1.2rem 1.2rem}.mock .insight{margin:0}
.stats{display:flex;gap:2.5rem;justify-content:center;flex-wrap:wrap;margin:3.5rem auto 0;color:var(--muted);font-size:.9rem}.stats b{display:block;color:var(--ink);font-size:1.6rem;letter-spacing:-.03em}
section.block{padding:4.5rem 0 1rem}
.steps{counter-reset:s}.step{position:relative;padding-left:3.2rem}.step:before{counter-increment:s;content:counter(s);position:absolute;left:1.1rem;top:1.2rem;width:2rem;height:2rem;border-radius:50%;background:linear-gradient(135deg,var(--brand),var(--brand-2));color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:.9rem}
.step h3{margin-top:0;padding-left:.25rem}.feature svg{width:28px;height:28px;color:var(--brand)}
.price{font-size:2.4rem;font-weight:800;letter-spacing:-.04em}.price small{font-size:1rem;font-weight:500;color:var(--muted)}
.plan.featured{border-color:var(--brand);box-shadow:var(--glow),var(--shadow)}
.tick{list-style:none;padding:0;margin:.75rem 0}.tick li{padding:.3rem 0 .3rem 1.6rem;position:relative;color:var(--ink-2)}.tick li:before{content:"✓";position:absolute;left:0;color:var(--ok);font-weight:800}
.cta{padding:3rem 1.5rem;text-align:center;border-radius:20px;background:linear-gradient(135deg,rgba(110,168,255,.15),rgba(139,92,246,.15));border:1px solid var(--line-2)}
.footer{border-top:1px solid var(--line);margin-top:3rem;padding:2rem 1.25rem;color:var(--muted);font-size:.9rem;position:relative}.footer-in{max-width:1140px;margin:0 auto;display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center}
.stat{display:inline-block;min-width:7.5rem;margin:.25rem 1.25rem .25rem 0}.stat b{display:block;font-size:1.5rem;letter-spacing:-.02em}
.prose h1{font-size:1.75rem}.prose h2{font-size:1.25rem;margin-top:1.75rem}.prose table{font-size:.9rem}
details summary{cursor:pointer}

/* motion */
.reveal{opacity:0;transform:translateY(18px);transition:opacity .7s ease,transform .7s ease}.reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}.orb{transform:none!important}html{scroll-behavior:auto}}
@media (max-width:640px){.nav a.link.hide-sm{display:none}.hero{min-height:auto;padding:3rem 0 1rem}.stats{gap:1.25rem}}
`;

/** Theme toggle (localStorage), parallax orbs, scroll reveal. Tiny, dependency-free, respects reduced motion. */
export const JS = `
(function(){
  var d=document.documentElement,k='rw-theme';
  try{if(localStorage.getItem(k)==='light')d.setAttribute('data-theme','light');}catch(e){}
  window.rwToggleTheme=function(){var l=d.getAttribute('data-theme')==='light';if(l)d.removeAttribute('data-theme');else d.setAttribute('data-theme','light');try{localStorage.setItem(k,l?'dark':'light')}catch(e){}};
  var rm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!rm){var orbs=document.querySelectorAll('.orb'),t;function px(){var y=window.scrollY||0;orbs.forEach(function(o,i){var f=[0.18,0.12,0.28][i%3];o.style.transform='translate3d(0,'+(y*f*-1)+'px,0)'});t=null}
    window.addEventListener('scroll',function(){if(!t)t=requestAnimationFrame(px)},{passive:true});px();}
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -8% 0px'});
    document.querySelectorAll('.reveal').forEach(function(el){io.observe(el)})}else{document.querySelectorAll('.reveal').forEach(function(el){el.classList.add('in')})}
})();
`;
