import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, editDraft, insertMention, splitMentions, toBody, toDraft } from './mentions';

const sara = { id: '01920000-0000-7000-8000-000000000001', name: 'سارة' };
const saraAli = { id: '01920000-0000-7000-8000-000000000002', name: 'سارة علي' };
const otherSara = { id: '01920000-0000-7000-8000-000000000003', name: 'سارة' };

/** Types `text` at the end of the draft. */
const type = (draft: ReturnType<typeof toDraft>, text: string) =>
  editDraft(draft, `${draft.text}${text}`);

describe('comment mentions', () => {
  it('splits a stored body into text and mentions', () => {
    expect(splitMentions(`مرحبا @{${sara.id}}، راجعي هذا`)).toEqual([
      { text: 'مرحبا ' },
      { mention: sara.id },
      { text: '، راجعي هذا' },
    ]);
    expect(splitMentions('بلا إشارات')).toEqual([{ text: 'بلا إشارات' }]);
  });

  it('shows tokens as names in the composer and keeps unknown tokens', () => {
    const unknown = '01920000-0000-7000-8000-000000000009';
    expect(toDraft(`@{${sara.id}} و @{${unknown}}`, [sara]).text).toBe(`@سارة و @{${unknown}}`);
  });

  it('saves each picked person as their own token, even when two share a name', () => {
    let draft = insertMention(EMPTY_DRAFT, 0, sara).draft;
    draft = insertMention(draft, draft.text.length, otherSara).draft;
    expect(draft.text).toBe('@سارة @سارة ');
    expect(toBody(draft)).toBe(`@{${sara.id}} @{${otherSara.id}} `);
  });

  it('keeps a longer name picked after a shorter one', () => {
    let draft = insertMention(EMPTY_DRAFT, 0, saraAli).draft;
    draft = insertMention(draft, draft.text.length, sara).draft;
    expect(toBody(draft)).toBe(`@{${saraAli.id}} @{${sara.id}} `);
  });

  it('leaves a name that was typed without picking it as text', () => {
    expect(toBody(editDraft(EMPTY_DRAFT, '@سارة'))).toBe('@سارة');
    const picked = insertMention(EMPTY_DRAFT, 0, sara).draft;
    // A typed "@سارةh" next to the picked one stays text.
    expect(toBody(type(picked, '@سارة_ب'))).toBe(`@{${sara.id}} @سارة_ب`);
  });

  it('moves mentions with the text typed before them', () => {
    const picked = insertMention(EMPTY_DRAFT, 0, sara).draft;
    expect(toBody(editDraft(picked, `شكرًا ${picked.text}`))).toBe(`شكرًا @{${sara.id}} `);
  });

  it('drops a mention whose name was edited', () => {
    const picked = insertMention(EMPTY_DRAFT, 0, saraAli).draft;
    const edited = editDraft(picked, picked.text.replace('علي', 'عل'));
    expect(toBody(edited)).toBe('@سارة عل ');
  });

  it('round-trips a stored body', () => {
    const body = `شكرًا @{${saraAli.id}} و @{${sara.id}}`;
    expect(toBody(toDraft(body, [saraAli, sara]))).toBe(body);
  });
});
