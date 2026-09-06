import type { App } from "./app.js";
import type { Principal } from "./auth.js";
import { addCompetitor, createBusiness } from "./web/actions.js";

/** Creates a demo account/user (admin) and business; returns a Principal to act as and a competitor seeder. */
export function seedDemo(app: App, demoBase: string, email = "demo@rivalwatch.local") {
  let user = app.repo.getUserByEmail(email);
  if (!user) {
    const account = app.repo.createAccount({ name: "Bright Pixel Design", plan: "pro" });
    user = app.repo.createUser({ account_id: account.id, email, is_admin: true });
    app.events.record({ type: "account.created", actor: "system", accountId: account.id, entity: { type: "account", id: account.id }, payload: { demo: true } });
  }
  const principal: Principal = { user, accountId: user.account_id, actor: `user:${user.id}`, via: "session", isAdmin: true };
  const existing = app.repo.listBusinesses(user.account_id)[0];
  if (existing) return { principal, business: existing };
  const business = createBusiness(app, principal, {
    name: "Bright Pixel Design",
    website: "https://brightpixel.example",
    description: "Freelance brand and web design studio for small businesses in the UK.",
    pricing_notes: "Starter £25/month, Studio £55/month. No annual plan yet.",
  });
  return {
    principal,
    business,
    seedCompetitor: () =>
      addCompetitor(app, principal, business.id, {
        name: "Acme Studio",
        website: `${demoBase}/`,
        discover: true,
        pages: [
          { url: `${demoBase}/`, kind: "home" },
          { url: `${demoBase}/pricing`, kind: "pricing" },
        ],
      }),
  };
}
