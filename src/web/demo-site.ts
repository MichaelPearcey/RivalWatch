import { Hono } from "hono";

/**
 * A fake competitor ("Acme Studio") served locally so the full monitoring loop
 * can be demonstrated and tested deterministically. State is in-memory and
 * mutable via POST /demo/state. Disable in production (DEMO_SITE_ENABLED=false).
 */
export interface DemoState {
  proPrice: number;
  annualPrice: number | null;
  promo: string | null;
  newProduct: string | null;
  /** Rotating testimonial: changes every request to exercise noise filtering. */
  rotateTestimonials: boolean;
}

export const DEFAULT_DEMO_STATE: DemoState = {
  proPrice: 49,
  annualPrice: null,
  promo: null,
  newProduct: null,
  rotateTestimonials: true,
};

const TESTIMONIALS = [
  "“Acme saved us hours every week.” — Jo, freelancer",
  "“Best tool we've used for client work.” — Sam, agency owner",
  "“Setup took five minutes.” — Priya, founder",
];

export function createDemoSite(initial: Partial<DemoState> = {}) {
  let state: DemoState = { ...DEFAULT_DEMO_STATE, ...initial };
  let requests = 0;
  const app = new Hono({ strict: false });

  const layout = (title: string, body: string) => `<!doctype html>
<html><head><title>${title} - Acme Studio</title><script>window.__t=${Date.now()}</script></head>
<body>
<nav><a href="/demo/">Home</a> <a href="/demo/pricing">Pricing</a> <a href="/demo/products">Products</a></nav>
<main>${body}</main>
<footer>© ${new Date().getFullYear()} Acme Studio. Updated ${new Date().toISOString()}.
<div class="cookie-banner">We use cookies.</div></footer>
</body></html>`;

  app.get("/", (c) => {
    requests++;
    const t = state.rotateTestimonials ? TESTIMONIALS[requests % TESTIMONIALS.length] : TESTIMONIALS[0];
    return c.html(
      layout(
        "Home",
        `<h1>Acme Studio</h1><p>Design tools for independent professionals.</p>
         ${state.promo ? `<div class="promo"><strong>${state.promo}</strong></div>` : ""}
         <blockquote>${t}</blockquote>
         <p>Visitors today: ${1000 + requests}</p>`,
      ),
    );
  });

  app.get("/pricing", (c) => {
    requests++;
    return c.html(
      layout(
        "Pricing",
        `<h1>Simple pricing</h1>
         ${state.promo ? `<p class="promo">${state.promo}</p>` : ""}
         <section><h2>Starter</h2><p>£19/month</p><ul><li>1 project</li><li>Email support</li></ul></section>
         <section><h2>Professional</h2><p>£${state.proPrice}/month</p><ul><li>Unlimited projects</li><li>Priority support</li></ul></section>
         ${state.annualPrice ? `<section><h2>Professional (annual)</h2><p>£${state.annualPrice}/year</p><p>Save with annual billing</p></section>` : ""}
         <p>Last reviewed ${new Date().toDateString()}</p>`,
      ),
    );
  });

  app.get("/products", (c) => {
    requests++;
    return c.html(
      layout(
        "Products",
        `<h1>Products</h1>
         <section><h2>Acme Design</h2><p>Vector design in your browser.</p></section>
         <section><h2>Acme Proof</h2><p>Client review and approval.</p></section>
         ${state.newProduct ? `<section><h2>${state.newProduct}</h2><p>Now available. Introducing our newest product.</p></section>` : ""}`,
      ),
    );
  });

  app.get("/private/secret", (c) => c.html("<p>should never be fetched</p>"));
  // Returns the given HTTP status; used to exercise status classification (403 -> AUTH_REQUIRED, 429 -> RATE_LIMITED...).
  app.get("/status/:code", (c) => c.text(`status ${c.req.param("code")}`, Number(c.req.param("code")) as 200));
  app.get("/spa", (c) => c.html(`<!doctype html><html><head><script>${"x".repeat(25000)}</script></head><body><div id="app"></div></body></html>`));

  app.get("/state", (c) => c.json(state));
  app.post("/state", async (c) => {
    const patch = (await c.req.json()) as Partial<DemoState>;
    state = { ...state, ...patch };
    return c.json(state);
  });
  app.post("/reset", (c) => {
    state = { ...DEFAULT_DEMO_STATE, ...initial };
    return c.json(state);
  });

  return {
    app,
    getState: () => state,
    setState: (patch: Partial<DemoState>) => {
      state = { ...state, ...patch };
    },
  };
}
