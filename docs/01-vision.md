# RivalWatch - Product Vision

## One-line proposition

"Tell us who your competitors are. We continuously watch them and tell you when
something happens that actually matters."

## The problem

Small businesses know they should keep an eye on competitors but don't have the
time. Existing tools (Visualping, Distill, Klue, Crayon) are either raw
page-change alerters that generate noise, or enterprise CI platforms priced far
beyond a solopreneur's budget.

## The differentiator

RivalWatch does **not** forward raw page-change notifications. Every detected
change is filtered and interpreted by AI into a short, plain-English competitive
insight that explains *what changed* and *why it matters to you specifically*.

Bad (what competitors do):

> competitor.com/pricing changed

Good (what RivalWatch does):

> Acme increased its Professional plan from £49 to £59/month and introduced a
> new £399/year annual option.
>
> Why this matters: their monthly price is now 18% above yours, while their
> annual effective monthly price remains slightly below yours.

## What we detect (target set)

- pricing changes
- new products or services
- promotions and discounts
- new landing pages
- significant positioning / copy changes
- product launches
- important announcements
- content / marketing strategy changes

## Target customers (initial)

solopreneurs, freelancers, small online businesses, local service businesses,
small SaaS companies, creators and businesses that rely heavily on social media.

The product must be usable by non-technical people: give us your website and a
handful of competitor URLs, we do everything else.

## Indicative pricing (provisional - do not hard-code)

| Plan  | Price        | Competitors | Cadence          | Features                                           |
|-------|--------------|-------------|------------------|----------------------------------------------------|
| Free  | £0           | 2           | weekly           | weekly report, limited features                    |
| Pro   | £9.99/month  | ~10         | frequent (daily) | AI analysis, alerts, weekly report                 |
| Plus  | £19.99/month | ~25         | frequent         | deeper intelligence, trends, comparisons, monthly strategic analysis |

Plan limits are data (see `plans` config) so they can be changed without code
changes.

## Long-term operating model

The company is intended to be run largely by AI agents:

- **Manager AI** - oversees the company, approves medium-risk actions
- **Growth/Marketing AI** - acquisition, content, experiments
- **Support/Operations AI** - customer support, ops hygiene
- **Devin** - engineering / product
- **Human owner** - strategic decisions and high-risk approvals only

Consequences for the system design:

1. Everything important is exposed as a JSON API, not only a UI.
2. Every important business event is recorded as a structured row in the
   `events` table (signups, subscriptions, scans, changes, insights, emails,
   failures, costs, agent actions, approval requests...).
3. Actions are classified into permission tiers (autonomous / Manager-AI
   approval / human approval). See `docs/02-architecture.md`.
4. An internal owner dashboard will eventually be built on top of `events`.

## Non-goals for the MVP

- Social media monitoring (design for it, don't build it yet; never rely on
  unofficial Instagram scraping).
- Billing, auth, email delivery, multi-tenant hardening.
- Headless-browser crawling.
