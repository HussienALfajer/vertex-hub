/*
 * Comments store mentions as `@{userId}` tokens (spec F06, rule 16). The composer shows them as
 * `@Name` and turns the names of the people picked from the list back into tokens on save.
 */

export interface MentionedPerson {
  id: string;
  name: string;
}

const TOKEN = /@\{([0-9a-fA-F-]{36})\}/g;

/** A stored body split into text and mentions, for display. */
export type BodyPart = { text: string } | { mention: string };

export function splitMentions(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: body.slice(last, index) });
    parts.push({ mention: (match[1] as string).toLowerCase() });
    last = index + match[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/** A stored body as the composer shows it: tokens become `@Name`. */
export function toDraft(body: string, people: readonly MentionedPerson[]): string {
  const names = new Map(people.map((person) => [person.id.toLowerCase(), person.name]));
  return body.replace(TOKEN, (token, id: string) => {
    const name = names.get(id.toLowerCase());
    return name ? `@${name}` : token;
  });
}

/**
 * The composer's text as stored: each `@Name` of a picked person becomes their token. Longer
 * names go first, so "@Sara Ali" is not taken for "@Sara".
 */
export function toBody(draft: string, picked: readonly MentionedPerson[]): string {
  const byLength = [...picked].sort((a, b) => b.name.length - a.name.length);
  let body = draft;
  for (const person of byLength) body = body.split(`@${person.name}`).join(`@{${person.id}}`);
  return body;
}
