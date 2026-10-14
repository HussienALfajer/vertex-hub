import type { Amendment, RetainerContract, RetainerTerm } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import { annexState, coveringContract } from './contract-coverage';

const contract = (
  id: string,
  status: RetainerContract['status'],
  cover: { term: { id: string; startCycle: number; cycles: number } } | { startCycle: number },
  annexes: { amendmentId: string; status: 'issued' | 'signed' | 'void' }[] = [],
) =>
  ({
    id,
    status,
    kind: 'term' in cover ? 'term' : 'open_ended',
    term: 'term' in cover ? cover.term : null,
    startCycle: 'term' in cover ? cover.term.startCycle : cover.startCycle,
    annexes: annexes.map((annex, index) => ({
      id: `${id}-annex-${index}`,
      annexNumber: index + 1,
      amendment: { id: annex.amendmentId, number: 1 },
      status: annex.status,
    })),
  }) as unknown as RetainerContract;

const term = (id: string, endAction: RetainerTerm['endAction']) => ({ id, endAction });

const amendment = (
  effectiveCycle: number,
  status: Amendment['status'] = 'applied',
  kind: Amendment['kind'] = 'change',
) => ({ id: 'amendment', kind, status, effectiveCycle });

describe('coveringContract (F05C K9, K10)', () => {
  const termContract = contract('term', 'issued', {
    term: { id: 't1', startCycle: 3, cycles: 3 },
  });
  const openEnded = contract('open', 'signed', { startCycle: 1 });

  it('picks the term contract whose term holds the cycle', () => {
    const terms = [term('t1', 'renew')];
    expect(coveringContract([openEnded, termContract], terms, 4)?.id).toBe('term');
    expect(coveringContract([openEnded, termContract], terms, 6)?.id).toBe('open');
    expect(coveringContract([termContract], terms, 6)).toBeNull();
  });

  it('covers onward from a term that continues after its end (K1)', () => {
    expect(coveringContract([termContract], [term('t1', 'continue')], 9)?.id).toBe('term');
  });

  it('takes the onward contract that starts latest, and ignores drafts and void ones', () => {
    const later = contract('later', 'issued', { startCycle: 5 });
    const draft = contract('draft', 'draft', { startCycle: 6 });
    const voided = contract('void', 'void', { startCycle: 7 });
    expect(coveringContract([openEnded, later, draft, voided], [], 8)?.id).toBe('later');
    expect(coveringContract([openEnded, later], [], 4)?.id).toBe('open');
  });
});

describe('annexState (K10)', () => {
  const issued = contract('c', 'issued', { startCycle: 1 });

  it('offers an annex for an applied change or reschedule a contract covers', () => {
    expect(annexState(amendment(2), [issued], [])).toMatchObject({ kind: 'available' });
    expect(annexState(amendment(2, 'applied', 'reschedule'), [issued], [])).not.toBeNull();
  });

  it('offers none for a quote renewal or an amendment that is not applied', () => {
    expect(annexState(amendment(2, 'applied', 'quote_renewal'), [issued], [])).toBeNull();
    expect(annexState(amendment(2, 'scheduled'), [issued], [])).toBeNull();
    expect(annexState(amendment(2), [], [])).toBeNull();
  });

  it('shows the live annex; a void one leaves the amendment open again', () => {
    const annexed = contract('c', 'issued', { startCycle: 1 }, [
      { amendmentId: 'amendment', status: 'signed' },
    ]);
    expect(annexState(amendment(2), [annexed], [])).toMatchObject({ kind: 'annex' });
    const voided = contract('c', 'issued', { startCycle: 1 }, [
      { amendmentId: 'amendment', status: 'void' },
    ]);
    expect(annexState(amendment(2), [voided], [])).toMatchObject({ kind: 'available' });
  });
});
