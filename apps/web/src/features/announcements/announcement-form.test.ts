import {
  type Announcement,
  type AnnouncementTemplate,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import {
  announcementFormValues,
  createInput,
  emptyPoll,
  newAnnouncementValues,
  updateInput,
  withTemplate,
} from './announcement-form';

const body = {
  type: 'doc' as const,
  content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'مرحبًا' }] }],
};

const filled = () => ({
  ...newAnnouncementValues(),
  title: 'مواعيد الدوام',
  body,
  audience: { departments: ['design' as const] },
});

function stored(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: '0192a000-0000-7000-8000-000000000001',
    author: { id: '0192a000-0000-7000-8000-000000000002', name: 'سارة', imageId: null },
    title: 'مواعيد الدوام',
    excerpt: 'مرحبًا',
    priority: 'normal',
    requiresAck: false,
    status: 'sent',
    scheduledAt: null,
    sentAt: '2026-10-20T07:00:00.000Z',
    pinnedUntil: null,
    editedAt: null,
    unsentAt: null,
    withdrawnAt: null,
    receipt: null,
    totals: { recipients: 4, opened: 1, acknowledged: 0 },
    createdAt: '2026-10-20T06:00:00.000Z',
    body,
    linkUrl: null,
    linkLabel: null,
    audience: { departments: ['design'] },
    renotifiedAt: null,
    withdrawnBy: null,
    poll: null,
    rights: { edit: true, withdraw: true, receipts: true, acknowledge: false },
    ...overrides,
  };
}

const poll = (voters: number): Announcement['poll'] => ({
  question: 'أي يوم يناسبكم؟',
  multiple: false,
  anonymous: false,
  results: 'everyone_after_voting',
  closesAt: null,
  closedAt: null,
  closed: false,
  options: [
    { id: '0192a000-0000-7000-8000-00000000000a', label: 'الأحد', votes: voters, voters: [] },
    { id: '0192a000-0000-7000-8000-00000000000b', label: 'الاثنين', votes: 0, voters: [] },
  ],
  voters,
  myVote: [],
  rights: { vote: false, close: true },
});

describe('createInput', () => {
  it('sends empty texts and switches as nulls, and passes the contract', () => {
    const input = createInput(filled());
    expect(input).toMatchObject({ linkUrl: null, linkLabel: null, pinnedUntil: null, poll: null });
    expect(input).not.toHaveProperty('scheduledAt');
    expect(createAnnouncementSchema.safeParse(input).success).toBe(true);
  });

  it('adds the schedule time only when scheduling, in the business timezone', () => {
    const input = createInput({ ...filled(), send: 'schedule', scheduledAt: '2026-10-21T09:30' });
    // Asia/Damascus is UTC+3.
    expect(input.scheduledAt).toBe('2026-10-21T06:30:00.000Z');
  });

  it('sends a poll with its closing time, or null to close it by hand', () => {
    const input = createInput({
      ...filled(),
      poll: { ...emptyPoll(), question: 'أي يوم؟', options: ['الأحد', 'الاثنين'] },
    });
    expect(input.poll).toMatchObject({ options: ['الأحد', 'الاثنين'], closesAt: null });
    expect(createAnnouncementSchema.safeParse(input).success).toBe(true);
  });

  it('fails the contract without a body or an audience', () => {
    expect(createAnnouncementSchema.safeParse(createInput(newAnnouncementValues())).success).toBe(
      false,
    );
  });
});

describe('updateInput', () => {
  it('sends only what a sent announcement still changes (rule D10)', () => {
    const announcement = stored();
    const input = updateInput(
      { ...announcementFormValues(announcement), priority: 'critical', notifyAgain: true },
      announcement,
    );
    expect(Object.keys(input).sort()).toEqual(
      ['body', 'linkLabel', 'linkUrl', 'notifyAgain', 'title'].sort(),
    );
    expect(updateAnnouncementSchema.safeParse(input).success).toBe(true);
  });

  it('sends a pin only when it changed, so an ended pin does not block an edit', () => {
    const ended = stored({ pinnedUntil: '2026-10-01' });
    expect(updateInput(announcementFormValues(ended), ended)).not.toHaveProperty('pinnedUntil');
    expect(
      updateInput({ ...announcementFormValues(ended), pinnedUntil: '2026-10-25' }, ended),
    ).toMatchObject({ pinnedUntil: '2026-10-25' });
  });

  it('changes a sent poll only when it changed, before any vote and while open', () => {
    const open = stored({ poll: poll(0) });
    const values = announcementFormValues(open);
    expect(updateInput(values, open)).not.toHaveProperty('poll');
    const edited = { ...values, poll: values.poll && { ...values.poll, question: 'أي يوم؟' } };
    expect(updateInput(edited, open)).toHaveProperty('poll');
    const voted = stored({ poll: poll(2) });
    const votedValues = announcementFormValues(voted);
    const votedEdit = {
      ...votedValues,
      poll: votedValues.poll && { ...votedValues.poll, question: 'أي يوم؟' },
    };
    expect(updateInput(votedEdit, voted)).not.toHaveProperty('poll');
    const closedPoll = poll(0);
    const closed = stored({ poll: closedPoll && { ...closedPoll, closed: true } });
    const closedValues = announcementFormValues(closed);
    const closedEdit = {
      ...closedValues,
      poll: closedValues.poll && { ...closedValues.poll, question: 'أي يوم؟' },
    };
    expect(updateInput(closedEdit, closed)).not.toHaveProperty('poll');
  });

  it('reopens a draft as a draft, never as "Send now"', () => {
    expect(announcementFormValues(stored({ status: 'draft', sentAt: null })).send).toBe('draft');
  });

  it('sends the audience of a draft and the new time of a scheduled one', () => {
    const draft = stored({ status: 'draft', sentAt: null });
    expect(updateInput(announcementFormValues(draft), draft)).toMatchObject({
      audience: { departments: ['design'] },
    });
    const scheduled = stored({
      status: 'scheduled',
      sentAt: null,
      scheduledAt: '2026-10-22T06:00:00.000Z',
    });
    const values = announcementFormValues(scheduled);
    expect(values.scheduledAt).toBe('2026-10-22T09:00');
    // Unchanged, the time is not sent again: the API would check it as a new one (rule D5).
    expect(updateInput(values, scheduled)).not.toHaveProperty('scheduledAt');
    expect(updateInput({ ...values, scheduledAt: '2026-10-23T10:00' }, scheduled).scheduledAt).toBe(
      '2026-10-23T07:00:00.000Z',
    );
  });
});

describe('withTemplate', () => {
  it('fills the content and keeps the audience (rule D12)', () => {
    const template: AnnouncementTemplate = {
      id: '0192a000-0000-7000-8000-000000000003',
      name: 'إجازة',
      title: 'إجازة رسمية',
      body,
      priority: 'important',
      requiresAck: true,
      linkUrl: 'https://example.com',
      linkLabel: null,
      shared: true,
      editable: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    const values = withTemplate(filled(), template);
    expect(values).toMatchObject({
      title: 'إجازة رسمية',
      priority: 'important',
      requiresAck: true,
      linkUrl: 'https://example.com',
      linkLabel: '',
      audience: { departments: ['design'] },
    });
  });
});
