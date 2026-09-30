/*
 * Comments store mentions as `@{userId}` tokens (spec F06, rule 16). The composer shows them as
 * `@Name` and remembers where each picked mention sits in the text, so two people with the same
 * name, or a typed name that starts like a picked one, never swap identities.
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

/** A picked mention shown as `@Name` in the draft, from `start` to `end` (exclusive). */
export interface MentionSpan {
  start: number;
  end: number;
  person: MentionedPerson;
}

/** The composer's state: the text as shown, and where the picked mentions are in it. */
export interface MentionDraft {
  text: string;
  spans: MentionSpan[];
}

export const EMPTY_DRAFT: MentionDraft = { text: '', spans: [] };

/** A stored body as the composer shows it: known tokens become `@Name` mentions. */
export function toDraft(body: string, people: readonly MentionedPerson[]): MentionDraft {
  const known = new Map(people.map((person) => [person.id.toLowerCase(), person]));
  let text = '';
  const spans: MentionSpan[] = [];
  for (const part of splitMentions(body)) {
    if ('text' in part) {
      text += part.text;
      continue;
    }
    const person = known.get(part.mention);
    if (!person) {
      text += `@{${part.mention}}`;
      continue;
    }
    const shown = `@${person.name}`;
    spans.push({ start: text.length, end: text.length + shown.length, person });
    text += shown;
  }
  return { text, spans };
}

/**
 * Inserts a picked person at `at`, with a space before when needed and one after. Returns the
 * new draft and where the caret goes.
 */
export function insertMention(
  draft: MentionDraft,
  at: number,
  person: MentionedPerson,
): { draft: MentionDraft; caret: number } {
  const before = draft.text.slice(0, at);
  const spacer = before && !/\s$/.test(before) ? ' ' : '';
  const shown = `@${person.name}`;
  const inserted = `${spacer}${shown} `;
  const next = editDraft(draft, `${before}${inserted}${draft.text.slice(at)}`);
  const start = at + spacer.length;
  return {
    draft: {
      text: next.text,
      spans: [...next.spans, { start, end: start + shown.length, person }].sort(
        (a, b) => a.start - b.start,
      ),
    },
    caret: at + inserted.length,
  };
}

/**
 * The draft after the text changed to `text` (typing, pasting, deleting). Mentions before the
 * change stay, those after it move with the text, and a mention the change touched becomes
 * plain text: its person is no longer mentioned.
 */
export function editDraft(draft: MentionDraft, text: string): MentionDraft {
  const old = draft.text;
  let prefix = 0;
  const shortest = Math.min(old.length, text.length);
  while (prefix < shortest && old[prefix] === text[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    old[old.length - 1 - suffix] === text[text.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const changedEnd = old.length - suffix;
  const shift = text.length - old.length;
  const spans = draft.spans.flatMap((span) => {
    if (span.end <= prefix) return [span];
    if (span.start >= changedEnd)
      return [{ ...span, start: span.start + shift, end: span.end + shift }];
    return [];
  });
  return { text, spans };
}

/** The draft as stored: each picked mention becomes its token, the rest stays text. */
export function toBody(draft: MentionDraft): string {
  let body = draft.text;
  for (const span of [...draft.spans].sort((a, b) => b.start - a.start)) {
    body = `${body.slice(0, span.start)}@{${span.person.id}}${body.slice(span.end)}`;
  }
  return body;
}
