/** A text with `{{name}}` placeholders, filled from `values`; unknown names are left empty. */
export function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ''));
}

/** The Arabic forms of a counted text, by the CLDR plural category of the count. */
export type PluralForms = Record<Intl.LDMLPluralRule, string>;

const pluralRules = new Intl.PluralRules('ar');

/** The form of `forms` that Arabic uses for `count` (zero, one, two, few, many, other). */
export function plural(forms: PluralForms, count: number): string {
  return forms[pluralRules.select(count)];
}
