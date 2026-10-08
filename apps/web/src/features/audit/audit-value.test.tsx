import type { AuditEntityType } from '@vertex-hub/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { formatMonth } from '../../lib/format';
import { formatAmount } from '../../lib/money';
import { shownFields } from './audit-fields';
import { type AuditNames, AuditValue } from './audit-value';

// The auth client reads the page's origin when its module loads.
vi.hoisted(() => vi.stubGlobal('window', { location: { origin: 'http://localhost' } }));

const USER = '0190a3c2-0000-7000-8000-000000000001';
const names: AuditNames = {
  user: (id) => (id === USER ? 'سلمى عيسى' : undefined),
  department: () => undefined,
  service: () => undefined,
};

/** The text a value shows, without its markup. */
const shown = (entityType: AuditEntityType, field: string, value: unknown) =>
  renderToStaticMarkup(
    <AuditValue entityType={entityType} field={field} value={value} names={names} />,
  ).replace(/<[^>]+>/g, '');

describe('AuditValue', () => {
  it('translates codes from the fixed lists', () => {
    expect(shown('task', 'status', 'in_progress')).toBe(i18n.t('tasks.statuses.in_progress'));
    expect(shown('invoice', 'status', 'partially_paid')).toBe(
      i18n.t('invoices.statuses.partially_paid'),
    );
    expect(shown('payment', 'method', 'bank_transfer')).toBe(
      i18n.t('invoices.methods.bank_transfer'),
    );
    expect(shown('retainer_term', 'reason', 'retainer_ended')).toBe(
      i18n.t('audit.reasons.retainer_ended'),
    );
    expect(shown('user', 'roles', ['finance'])).toBe(i18n.t('roles.finance'));
  });

  it('names users from their ids', () => {
    expect(shown('task', 'assigneeId', USER)).toBe('سلمى عيسى');
    expect(shown('meeting', 'attendeeIds', [USER])).toBe('سلمى عيسى');
  });

  it('formats a term’s schedule and an amendment’s months as amounts', () => {
    expect(shown('retainer_term', 'schedule', [30000, 40000])).toBe(
      `${formatAmount(30000)}${formatAmount(40000)}`,
    );
    expect(
      shown('retainer_amendment', 'effects', [
        { month: '2026-11-01', beforeMinor: 30000, afterMinor: 35000 },
      ]),
    ).toBe(`${formatMonth('2026-11-01')}: ${formatAmount(30000)} → ${formatAmount(35000)}`);
    expect(shown('retainer_term', 'startMonth', '2026-11-01')).toBe(formatMonth('2026-11-01'));
  });
});

describe('shownFields', () => {
  it('leaves out links and the ids of records the log cannot name', () => {
    expect(
      shownFields({
        before: { title: 'أ', contactId: USER, clientId: USER },
        after: { title: 'ب', taskIds: [USER], assigneeId: USER, retainerCycleId: USER },
      }),
    ).toEqual(['title', 'assigneeId']);
    expect(shownFields({ before: null, after: null })).toEqual([]);
  });
});
