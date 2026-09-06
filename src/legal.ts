/**
 * Legal documents, versioned. Bump the version when the text changes materially;
 * users are asked to re-accept on next sign-in and the acceptance is recorded in `consents`.
 *
 * Basis (UK GDPR / Data Protection Act 2018):
 *  - Account data & monitoring config: performance of a contract (Art. 6(1)(b)).
 *  - Audit/security logs, backups: legitimate interests (Art. 6(1)(f)).
 *  - Marketing email: consent (Art. 6(1)(a)), separate opt-in, not yet collected.
 * This is a founder-written draft; a solicitor should review before paid launch.
 */

export const LEGAL_VERSION = "2026-09-06b"; // b: language-preference cookie disclosed

export const COMPANY = {
  product: "RivalWatch",
  operator: "RivalWatch (operated by Michael Pearcey, United Kingdom)",
  contact: "privacy@rivalwatch.example", // TODO: replace with a real mailbox on the production domain
  jurisdiction: "England and Wales",
};

export const RETENTION = [
  ["Account and business details", "Until you delete your account, then removed within 7 days"],
  ["Competitor pages you ask us to monitor", "Until you remove them or delete your account"],
  ["Snapshots of competitor pages (extracted text)", "Until you remove the page or delete your account"],
  ["Snapshots of competitor pages (raw HTML)", "30 days, then discarded"],
  ["Insights and your feedback on them", "Until you delete your account"],
  ["Sign-in links", "15 minutes or first use"],
  ["Sessions", "30 days of inactivity or sign-out"],
  ["Emails we sent you (metadata)", "Until you delete your account; addresses are then redacted"],
  ["Security and audit logs", "Retained without personal identifiers; account references are removed on deletion"],
  ["Encrypted backups", "Up to 90 days, then deleted automatically"],
] as const;

export const PROCESSORS = [
  ["Railway (USA/EU)", "Hosting of the application and database"],
  ["Anthropic (USA)", "AI analysis of competitor page changes. We send extracts of public competitor pages and the business description and pricing you provide. Anthropic does not train on API data."],
  ["Resend (USA)", "Delivery of sign-in links, digests and alerts"],
  ["Cloudflare / Backblaze (EU/USA)", "Encrypted off-site backups"],
  ["GitHub (USA)", "Source code hosting (no customer data)"],
] as const;

export function privacyPolicy(): string {
  return `# Privacy Policy

**Version ${LEGAL_VERSION}.** ${COMPANY.operator} ("we") operates ${COMPANY.product}. This policy explains what personal data we process, why, and your rights under UK data protection law. Contact: ${COMPANY.contact}.

## 1. What we collect and why

| Data | Why | Legal basis |
|---|---|---|
| Your email address | To sign you in (passwordless links or a password you choose), send you the digests and alerts you asked for, and contact you about your account | Contract |
| Password (if you set one) | Stored only as a salted scrypt hash; we cannot read it | Contract |
| Your business name, description and pricing notes | So the AI can explain why a competitor change matters *to you* | Contract |
| Competitor websites and pages you ask us to monitor, and what we fetch from them | The service itself | Contract |
| Your feedback on insights | To improve the analysis | Contract / legitimate interests |
| Technical logs (IP address on sign-in, timestamps, actions taken in the app) | Security, fraud prevention, audit trail | Legitimate interests |
| Cookies | A strictly necessary session cookie (\`rw_session\`) and, only if you pick a language, a functional preference cookie (\`rw_lang\`) that remembers it. No analytics or advertising cookies. | Not consent-based (strictly necessary / user-requested functionality) |
| Language preference | To show the app, emails and AI insights in your chosen language | Contract |

We do not sell personal data, profile you for advertising, or make automated decisions with legal or similarly significant effects on you.

## 2. Competitor data

We fetch publicly available web pages that *you* nominate, respecting each site's robots.txt, identifying our crawler honestly and at low frequency. Those pages may incidentally contain personal data of third parties (e.g. a named founder on an About page). We process it only to detect and explain business-relevant changes, keep raw copies for at most 30 days, and never use it for any other purpose. Site owners can contact ${COMPANY.contact} to have their site excluded.

## 3. AI processing

Extracted text from competitor pages, together with your business description and pricing notes, is sent to Anthropic's API to produce plain-English insights. Anthropic acts as our processor and does not use API inputs to train models. Our own AI agents that help operate the service only read aggregated or masked data and cannot act on your account without a human approving.

## 4. Who we share data with

${PROCESSORS.map(([who, why]) => `- **${who}** — ${why}`).join("\n")}

Where processors are outside the UK, transfers rely on the UK International Data Transfer Addendum / adequacy decisions. We do not share personal data with anyone else except where required by law.

## 5. How long we keep it

| Data | Retention |
|---|---|
${RETENTION.map(([d, r]) => `| ${d} | ${r} |`).join("\n")}

## 6. Your rights

You can, at any time from **Settings**: export everything we hold about your account as JSON; delete your account (all data is removed after a 7-day grace period during which you can cancel); change your email preferences. You also have the right to rectification, restriction, objection and to lodge a complaint with the Information Commissioner's Office (ico.org.uk). Email ${COMPANY.contact} for anything the app doesn't let you do yourself; we respond within one month.

## 7. Security

Passwords are hashed with scrypt; sign-in links and sessions are stored only as SHA-256 hashes and expire; all traffic is encrypted in transit; the database and backups are encrypted at rest by our hosting providers; access is limited to the operator and audited. If a breach affects your data we will tell you and the ICO as the law requires.

## 8. Changes

We will show you a notice and ask you to re-accept when this policy changes materially. Previous versions are available on request.
`;
}

export function termsOfService(): string {
  return `# Terms of Service

**Version ${LEGAL_VERSION}.** These terms govern your use of ${COMPANY.product}, operated by ${COMPANY.operator}. By creating an account you agree to them.

## 1. The service
${COMPANY.product} monitors publicly available competitor web pages that you nominate and uses automated analysis, including AI, to summarise changes. It is an information tool. Summaries may be incomplete or wrong; always check the evidence we link to before acting on a business decision.

## 2. Your account
You must be at least 18 and provide a working email address. Keep your sign-in method secure and tell us promptly if you suspect misuse. You are responsible for activity under your account, including via API keys you create.

## 3. Acceptable use
You may only nominate publicly accessible pages. You must not use the service to monitor individuals, to circumvent access controls or paywalls, to harass, or in breach of any law or third-party rights. We may pause monitoring of pages whose owners object or that block automated access, and we will tell you when we do.

## 4. Plans and payment
Plan limits are shown in the app. Paid plans (when available) are billed in advance, monthly, in GBP; you can cancel at any time and keep access until the end of the period. We may change prices with 30 days' notice. Free plans may be limited or discontinued.

## 5. Data
Our Privacy Policy explains how we handle personal data. You retain ownership of the information you provide; you grant us a licence to process it to provide the service. We may use aggregated, anonymised statistics to improve and describe the service.

## 6. Availability and changes
We aim for high availability but the service is provided "as is" without warranties of uninterrupted or error-free operation. We may change or discontinue features with reasonable notice.

## 7. Liability
Nothing in these terms limits liability that cannot be limited by law. Otherwise our total liability to you in any 12-month period is limited to the fees you paid in that period (or £50 if you paid nothing). We are not liable for indirect or consequential loss, including business decisions taken on the basis of our summaries.

## 8. Termination
You can delete your account at any time from Settings. We may suspend or terminate accounts that breach these terms, with notice where reasonable.

## 9. Law
These terms are governed by the laws of ${COMPANY.jurisdiction}, and the courts there have exclusive jurisdiction. Consumers retain any mandatory protections of their country of residence.

Contact: ${COMPANY.contact}.
`;
}

export function crawlerPage(): string {
  return `# About the RivalWatchBot crawler

RivalWatchBot fetches public web pages that our customers have asked us to monitor for business changes (pricing, products, announcements). It is not a search engine and does not crawl beyond the specific pages nominated.

**How it behaves**
- Identifies itself with the User-Agent \`RivalWatchBot/0.1 (+this page)\`.
- Obeys \`robots.txt\` (checked at most every 6 hours). Disallowed pages are never fetched.
- Fetches each page at most a few times per day, typically once, with a delay between requests to the same host.
- Never executes JavaScript, never submits forms, never logs in, never bypasses paywalls or access controls.
- Keeps raw copies for at most 30 days; keeps extracted text only for as long as the customer monitors the page.

**Want us to stop?** Add \`Disallow\` rules for \`RivalWatchBot\` in your robots.txt (effective within 6 hours), or email ${COMPANY.contact} and we will exclude your site.
`;
}
