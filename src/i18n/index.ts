import { de } from "./de.js";
import { en, type MessageKey } from "./en.js";
import { es } from "./es.js";
import { fr } from "./fr.js";
import { ru } from "./ru.js";
import { uk } from "./uk.js";

export const LOCALES = ["en", "uk", "ru", "de", "fr", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LANG_COOKIE = "rw_lang";

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, uk, ru, de, fr, es };

/** Names the analyser prompt uses ("Write in ..."). */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", uk: "Ukrainian", ru: "Russian", de: "German", fr: "French", es: "Spanish" };

/**
 * Keys whose text must agree with a number. Each one exists three times in every
 * locale table (`.one`, `.few`, `.many`); Slavic locales need all three, the rest
 * repeat the plural form. Call them through `t.plural(key, n)`.
 */
export const PLURAL_KEYS = ["ov.competitors", "ov.pages", "ov.insights", "ov.news", "pricing.competitors", "pricing.pages", "pricing.every.days", "pricing.every.hours"] as const;
export type PluralKey = (typeof PLURAL_KEYS)[number];
type PluralForm = "one" | "few" | "many";

/** Compile-time proof that every form of every plural key exists in the tables. */
type MissingPluralForms = Exclude<`${PluralKey}.${PluralForm}`, MessageKey>;
const _pluralFormsComplete: [MissingPluralForms] extends [never] ? true : ["missing plural keys", MissingPluralForms] = true;
void _pluralFormsComplete;

export type Translate = ((key: MessageKey, vars?: Record<string, string | number>) => string) & {
  locale: Locale;
  plural: (key: PluralKey, n: number, vars?: Record<string, string | number>) => string;
};

const PLURAL_RULES = new Map<Locale, Intl.PluralRules>();

function pluralForm(locale: Locale, n: number): PluralForm {
  let rules = PLURAL_RULES.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    PLURAL_RULES.set(locale, rules);
  }
  const category = rules.select(n);
  return category === "one" ? "one" : category === "few" ? "few" : "many";
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export function translator(locale: Locale): Translate {
  const table = MESSAGES[locale] ?? en;
  const t = ((key: MessageKey, vars?: Record<string, string | number>) => {
    let s = table[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }) as Translate;
  t.locale = locale;
  t.plural = (key, n, vars) => t(`${key}.${pluralForm(locale, n)}` as MessageKey, { n, ...vars });
  return t;
}

/** Best locale from an Accept-Language header, or the default. */
export function fromAcceptLanguage(header: string | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { tag: tag.toLowerCase().split("-")[0]!, q, i };
    })
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const r of ranked) if (isLocale(r.tag)) return r.tag;
  return DEFAULT_LOCALE;
}

/** Resolution order: explicit query -> cookie -> signed-in user's preference -> Accept-Language -> default. */
export function resolveLocale(input: { query?: string | undefined; cookie?: string | undefined; user?: string | null | undefined; acceptLanguage?: string | undefined }): Locale {
  if (isLocale(input.query)) return input.query;
  if (isLocale(input.cookie)) return input.cookie;
  if (isLocale(input.user)) return input.user;
  return fromAcceptLanguage(input.acceptLanguage);
}

export type { MessageKey };
