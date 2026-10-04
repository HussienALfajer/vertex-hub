import { describe, expect, it } from 'vitest';
import {
  createLeadNoteSchema,
  createLeadSchema,
  daysInStage,
  defaultFollowUpDate,
  followUpDateInRange,
  followUpFilterRange,
  followUpReminderBounds,
  LEAD_LOSS_REASONS,
  leadDisplayName,
  leadDuplicateQuerySchema,
  leadHasContactMethod,
  leadListQuerySchema,
  leadSourceDetailMissing,
  leadStageChangeSchema,
  loseLeadSchema,
  lossRejectionReason,
  manualLeadMoveRefusal,
  reopenLeadSchema,
  updateLeadSchema,
} from './leads.js';
import { QUOTE_REJECTION_REASONS } from './quotes.js';

const id = '0192f000-0000-7000-8000-000000000001';
const other = '0192f000-0000-7000-8000-000000000002';

const minimal = {
  contactName: ' Ahmad ',
  phone: '0096 3933 123 456',
  source: 'instagram',
  nextFollowUpOn: '2026-10-05',
  ownerId: id,
} as const;

describe('createLeadSchema', () => {
  it('trims, normalizes the phone and fills the defaults', () => {
    const lead = createLeadSchema.parse(minimal);
    expect(lead).toMatchObject({
      contactName: 'Ahmad',
      phone: '+963933123456',
      companyName: null,
      email: null,
      budgetMinor: null,
      budgetCurrency: null,
      isHealthcare: false,
      interests: [],
    });
  });

  it('stores the email lower-case', () => {
    expect(createLeadSchema.parse({ ...minimal, email: ' A@Clinic.SY ' }).email).toBe(
      'a@clinic.sy',
    );
  });

  it('takes the budget amount and currency together or not at all', () => {
    expect(
      createLeadSchema.safeParse({ ...minimal, budgetMinor: 40_000, budgetCurrency: 'USD' })
        .success,
    ).toBe(true);
    expect(createLeadSchema.safeParse({ ...minimal, budgetMinor: 40_000 }).success).toBe(false);
    expect(createLeadSchema.safeParse({ ...minimal, budgetCurrency: 'SYP' }).success).toBe(false);
    expect(
      createLeadSchema.safeParse({ ...minimal, budgetMinor: 0, budgetCurrency: 'USD' }).success,
    ).toBe(false);
  });

  it('takes each interest as exactly one service or package, once', () => {
    expect(
      createLeadSchema.safeParse({
        ...minimal,
        interests: [{ serviceId: id }, { packageId: other }],
      }).success,
    ).toBe(true);
    expect(
      createLeadSchema.safeParse({ ...minimal, interests: [{ serviceId: id, packageId: other }] })
        .success,
    ).toBe(false);
    expect(createLeadSchema.safeParse({ ...minimal, interests: [{}] }).success).toBe(false);
    expect(
      createLeadSchema.safeParse({ ...minimal, interests: [{ serviceId: id }, { serviceId: id }] })
        .success,
    ).toBe(false);
  });

  it('refuses a malformed phone and an empty contact name', () => {
    expect(createLeadSchema.safeParse({ ...minimal, phone: '12' }).success).toBe(false);
    expect(createLeadSchema.safeParse({ ...minimal, contactName: '  ' }).success).toBe(false);
  });
});

describe('updateLeadSchema', () => {
  const updatedAt = '2026-10-04T08:00:00.000Z';

  it('needs the loaded updatedAt and takes any field', () => {
    expect(updateLeadSchema.safeParse({ updatedAt, request: 'Monthly social' }).success).toBe(true);
    expect(updateLeadSchema.safeParse({ request: 'Monthly social' }).success).toBe(false);
  });

  it('changes the budget only as a pair', () => {
    expect(updateLeadSchema.safeParse({ updatedAt, budgetMinor: 100 }).success).toBe(false);
    expect(
      updateLeadSchema.safeParse({ updatedAt, budgetMinor: null, budgetCurrency: null }).success,
    ).toBe(true);
  });

  it('does not change the owner', () => {
    expect(updateLeadSchema.parse({ updatedAt, ownerId: id })).not.toHaveProperty('ownerId');
  });
});

describe('lead rules', () => {
  it('names a lead by its company, else its contact', () => {
    expect(leadDisplayName({ companyName: 'Al-Noor', contactName: 'Ahmad' })).toBe('Al-Noor');
    expect(leadDisplayName({ companyName: null, contactName: 'Ahmad' })).toBe('Ahmad');
  });

  it('needs one contact method (CONTACT_REQUIRED)', () => {
    const none = { phone: null, email: null, socialHandle: null };
    expect(leadHasContactMethod(none)).toBe(false);
    expect(leadHasContactMethod({ ...none, socialHandle: '@noor' })).toBe(true);
    expect(leadHasContactMethod({ ...none, email: 'a@b.sy' })).toBe(true);
  });

  it('needs a source detail for other sources only (NOTE_REQUIRED)', () => {
    expect(leadSourceDetailMissing({ source: 'other', sourceDetail: null })).toBe(true);
    expect(leadSourceDetailMissing({ source: 'other', sourceDetail: 'Fair' })).toBe(false);
    expect(leadSourceDetailMissing({ source: 'referral', sourceDetail: null })).toBe(false);
  });

  it('keeps the follow-up date between today and 180 days ahead (rule 3)', () => {
    expect(followUpDateInRange('2026-10-04', '2026-10-04')).toBe(true);
    expect(followUpDateInRange('2027-04-02', '2026-10-04')).toBe(true);
    expect(followUpDateInRange('2027-04-03', '2026-10-04')).toBe(false);
    expect(followUpDateInRange('2026-10-03', '2026-10-04')).toBe(false);
  });

  it('defaults the follow-up date to the next work day', () => {
    // Thursday → Saturday (Friday is off).
    expect(defaultFollowUpDate('2026-10-08')).toBe('2026-10-10');
    expect(defaultFollowUpDate('2026-10-04')).toBe('2026-10-05');
  });

  it('counts whole days in the stage', () => {
    expect(daysInStage('2026-10-04', '2026-10-04')).toBe(0);
    expect(daysInStage('2026-10-01', '2026-10-04')).toBe(3);
  });
});

describe('manual stage moves (rule 5)', () => {
  it('moves freely among New, Contacted and Meeting', () => {
    expect(manualLeadMoveRefusal('new', 'meeting', false)).toBeNull();
    expect(manualLeadMoveRefusal('meeting', 'new', false)).toBeNull();
    expect(manualLeadMoveRefusal('contacted', 'contacted', false)).toBe('INVALID_TRANSITION');
  });

  it('leaves Quote sent for Contacted or Meeting only without a sent quote', () => {
    expect(manualLeadMoveRefusal('quote_sent', 'meeting', false)).toBeNull();
    expect(manualLeadMoveRefusal('quote_sent', 'contacted', true)).toBe('LEAD_HAS_SENT_QUOTE');
    expect(manualLeadMoveRefusal('quote_sent', 'new', false)).toBe('INVALID_TRANSITION');
  });

  it('never enters Quote sent, Won or Lost by hand, nor leaves them', () => {
    expect(manualLeadMoveRefusal('meeting', 'quote_sent', false)).toBe('INVALID_TRANSITION');
    expect(manualLeadMoveRefusal('meeting', 'won', false)).toBe('INVALID_TRANSITION');
    expect(manualLeadMoveRefusal('won', 'new', false)).toBe('INVALID_TRANSITION');
    expect(manualLeadMoveRefusal('lost', 'contacted', false)).toBe('INVALID_TRANSITION');
  });

  it('accepts only the manual stages in the request', () => {
    expect(leadStageChangeSchema.safeParse({ stage: 'meeting' }).success).toBe(true);
    expect(leadStageChangeSchema.safeParse({ stage: 'quote_sent' }).success).toBe(false);
    expect(
      reopenLeadSchema.safeParse({ stage: 'meeting', nextFollowUpOn: '2026-10-05' }).success,
    ).toBe(false);
  });
});

describe('losing (rule 8)', () => {
  it('maps every loss reason to a quote rejection reason', () => {
    for (const reason of LEAD_LOSS_REASONS) {
      expect(QUOTE_REJECTION_REASONS).toContain(lossRejectionReason(reason));
    }
    expect(lossRejectionReason('not_a_fit')).toBe('scope');
    expect(lossRejectionReason('price')).toBe('price');
  });

  it('takes an optional note', () => {
    expect(loseLeadSchema.parse({ reason: 'price' }).note).toBeNull();
    expect(loseLeadSchema.parse({ reason: 'other', note: ' Moved abroad ' }).note).toBe(
      'Moved abroad',
    );
  });
});

describe('activities (rule 4)', () => {
  it('needs a new follow-up date and a summary', () => {
    const note = {
      channel: 'whatsapp',
      summary: 'Sent the portfolio',
      nextFollowUpOn: '2026-10-06',
    };
    expect(createLeadNoteSchema.safeParse(note).success).toBe(true);
    expect(createLeadNoteSchema.safeParse({ ...note, nextFollowUpOn: undefined }).success).toBe(
      false,
    );
    expect(createLeadNoteSchema.safeParse({ ...note, summary: '' }).success).toBe(false);
  });
});

describe('A12 reminder bounds (rules 18–19)', () => {
  it('reminds a Friday date on Saturday and makes it overdue on Monday', () => {
    // 2026-10-09 is a Friday.
    const saturday = followUpReminderBounds('2026-10-10');
    expect(saturday.dueAfter).toBe('2026-10-08');
    expect('2026-10-09' > saturday.dueAfter && '2026-10-09' <= '2026-10-10').toBe(true);
    expect('2026-10-09' <= followUpReminderBounds('2026-10-11').overdueOnOrBefore).toBe(false);
    expect('2026-10-09' <= followUpReminderBounds('2026-10-12').overdueOnOrBefore).toBe(true);
  });

  it('makes a date overdue after two full work days', () => {
    // A Monday date: due Monday, overdue Wednesday.
    expect(followUpReminderBounds('2026-10-14').overdueOnOrBefore).toBe('2026-10-12');
    expect(followUpReminderBounds('2026-10-13').overdueOnOrBefore).toBe('2026-10-11');
    // A Thursday date is overdue on Sunday (Thursday and Saturday passed).
    expect(followUpReminderBounds('2026-10-11').overdueOnOrBefore).toBe('2026-10-08');
  });

  it('reminds a date once over consecutive work days', () => {
    expect(followUpReminderBounds('2026-10-12').dueAfter).toBe('2026-10-11');
    expect(followUpReminderBounds('2026-10-13').dueAfter).toBe('2026-10-12');
  });
});

describe('list query', () => {
  it('lists open, non-archived leads by next follow-up by default', () => {
    expect(leadListQuerySchema.parse({})).toMatchObject({
      stage: ['new', 'contacted', 'meeting', 'quote_sent'],
      archived: false,
      sort: 'nextFollowUpOn',
      order: 'asc',
    });
    expect(leadListQuerySchema.parse({ stage: 'won', source: 'event' })).toMatchObject({
      stage: ['won'],
      source: ['event'],
    });
  });

  it('ranges the follow-up filters around today', () => {
    // 2026-10-04 is a Sunday; the week ends on Friday 2026-10-09.
    expect(followUpFilterRange('overdue', '2026-10-04')).toEqual({ from: null, to: '2026-10-03' });
    expect(followUpFilterRange('today', '2026-10-04')).toEqual({
      from: '2026-10-04',
      to: '2026-10-04',
    });
    expect(followUpFilterRange('week', '2026-10-04')).toEqual({
      from: '2026-10-04',
      to: '2026-10-09',
    });
  });

  it('takes the duplicate check in a body with blanks as null', () => {
    expect(leadDuplicateQuerySchema.parse({ phone: '', names: ['Al-Noor'] })).toEqual({
      phone: null,
      email: null,
      names: ['Al-Noor'],
    });
  });
});
