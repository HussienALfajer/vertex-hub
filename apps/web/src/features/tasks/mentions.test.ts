import { describe, expect, it } from 'vitest';
import { splitMentions, toBody, toDraft } from './mentions';

const sara = { id: '01920000-0000-7000-8000-000000000001', name: 'سارة' };
const saraAli = { id: '01920000-0000-7000-8000-000000000002', name: 'سارة علي' };

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
    expect(toDraft(`@{${sara.id}} و @{${unknown}}`, [sara])).toBe(`@سارة و @{${unknown}}`);
  });

  it('turns picked names back into tokens, longer names first', () => {
    expect(toBody('@سارة علي و @سارة', [sara, saraAli])).toBe(`@{${saraAli.id}} و @{${sara.id}}`);
  });

  it('leaves a name that was typed without picking it as text', () => {
    expect(toBody('@سارة', [])).toBe('@سارة');
  });

  it('round-trips a stored body', () => {
    const body = `شكرًا @{${saraAli.id}}`;
    expect(toBody(toDraft(body, [saraAli]), [saraAli])).toBe(body);
  });
});
