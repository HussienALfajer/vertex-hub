import { z } from 'zod';

/*
 * Light rich text (ADR 0038): a TipTap document limited to paragraphs, headings, bold, emphasis,
 * lists and links, stored as validated JSON and rendered from the same schema, never as raw HTML.
 * Announcements use it as is; task comments, questions and replies (F06B rule B2) add a mention
 * node. A plain-text extract is kept beside each document for search, emails and notifications.
 */

/**
 * TipTap's name of the emphasis mark. The web renders it as a highlight, never slanted: Arabic is
 * not italicized (brand/identity.md).
 */
export const EMPHASIS_MARK = 'italic';

export const RICH_TEXT_LINK_MAX = 1000;

/** A mention in a plain-text extract: `@{userId}`, shown with the user's current name. */
const MENTION_TOKEN =
  /@\{([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}/g;

const markSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal(EMPHASIS_MARK) }),
  z.object({
    type: z.literal('link'),
    attrs: z.object({
      href: z
        .string()
        .trim()
        .pipe(z.url({ protocol: /^(https|mailto)$/ }).max(RICH_TEXT_LINK_MAX)),
    }),
  }),
]);

const textNodeSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(markSchema).max(3).optional(),
});

/** F06B: a mention of a user, kept in the extract as `@{userId}` (F06 rule 16). */
const mentionNodeSchema = z.object({
  type: z.literal('mention'),
  attrs: z.object({ userId: z.uuid().transform((id) => id.toLowerCase()) }),
});

export type MentionNode = z.infer<typeof mentionNodeSchema>;

type InlineNode = z.infer<typeof textNodeSchema> | MentionNode;

type Paragraph = { type: 'paragraph'; content?: InlineNode[] };

export type ListNode =
  | { type: 'bulletList'; content: ListItemNode[] }
  | { type: 'orderedList'; attrs?: { start?: number }; content: ListItemNode[] };

export type ListItemNode = { type: 'listItem'; content: (Paragraph | ListNode)[] };

/** The block schemas over one kind of inline content (with or without mentions). */
function blockSchemas(inline: z.ZodType<InlineNode>) {
  const inlineContent = z.array(inline).optional();
  const paragraphSchema = z.object({ type: z.literal('paragraph'), content: inlineContent });
  const headingSchema = z.object({
    type: z.literal('heading'),
    attrs: z.object({ level: z.literal(3) }),
    content: inlineContent,
  });
  const listItemSchema: z.ZodType<ListItemNode> = z.lazy(() =>
    z.object({
      type: z.literal('listItem'),
      content: z.array(z.union([paragraphSchema, listSchema])).min(1),
    }),
  );
  const listSchema: z.ZodType<ListNode> = z.lazy(() =>
    z.union([
      z.object({ type: z.literal('bulletList'), content: z.array(listItemSchema).min(1) }),
      z.object({
        type: z.literal('orderedList'),
        attrs: z.object({ start: z.number().int().min(1).optional() }).optional(),
        content: z.array(listItemSchema).min(1),
      }),
    ]),
  );
  return z.union([paragraphSchema, headingSchema, listSchema]);
}

const plainBlockSchema = blockSchemas(textNodeSchema);
const mentionBlockSchema = blockSchemas(z.union([textNodeSchema, mentionNodeSchema]));

type DocNode = {
  type: string;
  text?: string;
  attrs?: object;
  content?: readonly DocNode[];
};

/** A document as the plain-text functions read it. */
export type RichTextDoc = { type: 'doc'; content: readonly DocNode[] };

function inlineText(nodes: readonly DocNode[]): string {
  return nodes
    .map((node) => (node.type === 'mention' ? `@{${(node.attrs as MentionNode['attrs']).userId}}` : (node.text ?? '')))
    .join('');
}

/** The blocks of a document as plain text, one per line; list items each on their own line. */
function blocksText(nodes: readonly DocNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      return [inlineText(node.content ?? [])];
    }
    return blocksText(node.content ?? []);
  });
}

/** The document as plain text: blocks on their own lines, mentions as `@{userId}` tokens. */
export function richTextPlain(doc: { content: readonly DocNode[] }): string {
  return blocksText(doc.content).join('\n');
}

/** The distinct users a plain-text extract mentions, in order of first mention, lowercased. */
export function mentionedUserIds(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(MENTION_TOKEN)].map((match) => (match[1] as string).toLowerCase()),
    ),
  ];
}

/** Replaces each `@{userId}` token of a plain-text extract. */
export function replaceMentions(text: string, replace: (userId: string) => string): string {
  return text.replace(MENTION_TOKEN, (_, id: string) => replace(id.toLowerCase()));
}

/**
 * A plain text as a document: one paragraph per line, and `@{userId}` tokens as mention nodes
 * when `mentions` is set (the migration of old comments and briefs, F06B edge case 22).
 */
export function richTextFromPlain(
  text: string,
  options: { mentions: boolean } = { mentions: false },
): { type: 'doc'; content: Paragraph[] } {
  return {
    type: 'doc',
    content: text.split('\n').map((line): Paragraph => {
      const content: InlineNode[] = [];
      let rest = 0;
      if (options.mentions) {
        for (const match of line.matchAll(MENTION_TOKEN)) {
          const at = match.index ?? 0;
          if (at > rest) content.push({ type: 'text', text: line.slice(rest, at) });
          content.push({
            type: 'mention',
            attrs: { userId: (match[1] as string).toLowerCase() },
          });
          rest = at + match[0].length;
        }
      }
      if (line.length > rest) content.push({ type: 'text', text: line.slice(rest) });
      return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
    }),
  };
}

/**
 * A rich-text document holding 1 to `maxText` characters of text (its plain extract). Unknown
 * nodes, marks and attributes are refused or dropped (Zod objects strip unknown keys), so only the
 * allowed document is stored and rendered.
 */
export function richTextSchema(options: { maxText: number; mentions?: boolean }) {
  const block = options.mentions ? mentionBlockSchema : plainBlockSchema;
  return z
    .object({ type: z.literal('doc'), content: z.array(block).min(1) })
    .refine((doc) => richTextPlain(doc).trim().length > 0, { message: 'The text is empty' })
    .refine((doc) => richTextPlain(doc).length <= options.maxText, {
      message: `The text holds more than ${options.maxText} characters`,
    });
}
