import { describe, expect, it } from 'vitest';
import {
  mentionedUserIds,
  mentionTextSchema,
  replaceMentions,
  richTextFromPlain,
  richTextPlain,
  richTextSchema,
} from './rich-text.js';

const user = '01a0e97d-0028-7d46-8479-c4c5c1a41c11';
const other = '01a0e97d-0028-7d46-8479-c4c5c1a41c22';

describe('mentionedUserIds', () => {
  it('lists each mentioned user once, in order, lowercased', () => {
    const body = `@{${user.toUpperCase()}} please check with @{${other}} and @{${user}}`;
    expect(mentionedUserIds(body)).toEqual([user, other]);
  });

  it('ignores text that only looks like a mention', () => {
    expect(mentionedUserIds('@{not-a-uuid} @name {x}')).toEqual([]);
  });

  it('replaces each mention token', () => {
    expect(replaceMentions(`Hi @{${user.toUpperCase()}}`, (id) => `@${id.slice(-2)}`)).toBe(
      'Hi @11',
    );
  });
});

describe('the mention node (F06B, ADR 0038)', () => {
  const withMentions = mentionTextSchema({ maxText: 100 });
  const plain = richTextSchema({ maxText: 100 });
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ask ' },
          { type: 'mention', attrs: { userId: user.toUpperCase(), label: 'dropped' } },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'mention', attrs: { userId: other } }] },
            ],
          },
        ],
      },
    ],
  };

  it('is allowed only where mentions are, without other attributes', () => {
    const parsed = withMentions.parse(doc);
    expect(parsed.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ask ' },
        { type: 'mention', attrs: { userId: user.toUpperCase() } },
      ],
    });
    expect(plain.safeParse(doc).success).toBe(false);
  });

  it('is kept in the plain extract as a token', () => {
    const plain = richTextPlain(withMentions.parse(doc));
    expect(plain).toBe(`Ask @{${user.toUpperCase()}}\n@{${other}}`);
    expect(mentionedUserIds(plain)).toEqual([user, other]);
  });

  it('counts a document holding only mentions as not empty', () => {
    expect(
      withMentions.safeParse({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { userId: user } }] }],
      }).success,
    ).toBe(true);
  });
});

describe('richTextFromPlain (F06B edge case 22)', () => {
  it('makes one paragraph per line, empty lines included', () => {
    expect(richTextFromPlain('one\n\ntwo')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ],
    });
  });

  it('turns tokens into mention nodes only when asked, and round-trips the extract', () => {
    const text = `Hi @{${user.toUpperCase()}}, see @{${other}}.\nThanks`;
    const doc = richTextFromPlain(text, { mentions: true });
    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hi ' },
        { type: 'mention', attrs: { userId: user } },
        { type: 'text', text: ', see ' },
        { type: 'mention', attrs: { userId: other } },
        { type: 'text', text: '.' },
      ],
    });
    expect(richTextPlain(doc)).toBe(text.replace(user.toUpperCase(), user));
    expect(richTextPlain(richTextFromPlain(text))).toBe(text);
    expect(mentionTextSchema({ maxText: 100 }).safeParse(doc).success).toBe(true);
  });
});
