import { en, type MessageKey } from "./en";

export type { MessageKey };

/** Looks up a message and fills `{name}` placeholders from `vars`. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const message: string = en[key];
  if (!vars) return message;
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Message key bases that have both `.one` and `.other` forms, e.g. `count.files`. */
type PluralBase = {
  [K in MessageKey]: K extends `${infer B}.one`
    ? `${B}.other` extends MessageKey
      ? B
      : never
    : never;
}[MessageKey];

const rules = new Intl.PluralRules("en");

/** `plural("count.files", 3)` → "3 files", using `<base>.one` / `<base>.other`. */
export function plural(base: PluralBase, count: number): string {
  const form = rules.select(count) === "one" ? "one" : "other";
  return t(`${base}.${form}` as MessageKey, { count: count.toLocaleString("en") });
}
