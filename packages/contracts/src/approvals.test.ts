import { describe, expect, it } from 'vitest';
import {
  APPROVAL_LIMITS,
  approvalRequestListQuerySchema,
  approvalRequestState,
  createApprovalRequestSchema,
  publicResponseSchema,
} from './approvals.js';

const ids = {
  client: '0199a000-0000-7000-8000-000000000001',
  contact: '0199a000-0000-7000-8000-000000000002',
  task: '0199a000-0000-7000-8000-000000000003',
  other: '0199a000-0000-7000-8000-000000000004',
};

describe('approvalRequestState', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const request = {
    revokedAt: null,
    completedAt: null,
    expiresAt: new Date('2026-10-12T12:00:00Z'),
  };

  it('is open until the link expires, to the instant', () => {
    expect(approvalRequestState(request, now)).toBe('open');
    expect(approvalRequestState({ ...request, expiresAt: now }, now)).toBe('expired');
    expect(approvalRequestState({ ...request, expiresAt: new Date(now.getTime() + 1) }, now)).toBe(
      'open',
    );
  });

  it('puts revoked before completed, and both before expired', () => {
    const past = new Date('2026-10-01T12:00:00Z');
    expect(approvalRequestState({ ...request, completedAt: past }, now)).toBe('completed');
    expect(approvalRequestState({ ...request, completedAt: past, expiresAt: past }, now)).toBe(
      'completed',
    );
    expect(approvalRequestState({ ...request, revokedAt: past, expiresAt: past }, now)).toBe(
      'revoked',
    );
    expect(approvalRequestState({ ...request, revokedAt: past, completedAt: past }, now)).toBe(
      'revoked',
    );
  });
});

describe('createApprovalRequestSchema', () => {
  const input = { clientId: ids.client, contactId: ids.contact, items: [{ taskId: ids.task }] };

  it('takes tasks with optional titles and an optional message', () => {
    const request = createApprovalRequestSchema.parse({
      ...input,
      message: '  مرحباً  ',
      items: [{ taskId: ids.task, title: '  منشور الافتتاح ' }, { taskId: ids.other }],
    });
    expect(request.message).toBe('مرحباً');
    expect(request.items).toEqual([
      { taskId: ids.task, title: 'منشور الافتتاح' },
      { taskId: ids.other },
    ]);
    expect(createApprovalRequestSchema.parse({ ...input, message: ' ' }).message).toBeNull();
  });

  it('needs at least one task, each once', () => {
    expect(createApprovalRequestSchema.safeParse({ ...input, items: [] }).success).toBe(false);
    expect(
      createApprovalRequestSchema.safeParse({
        ...input,
        items: [{ taskId: ids.task }, { taskId: ids.task, title: 'مرة ثانية' }],
      }).success,
    ).toBe(false);
  });

  it('keeps titles to 1–160 characters and the message to 1000', () => {
    const titled = (title: string) =>
      createApprovalRequestSchema.safeParse({ ...input, items: [{ taskId: ids.task, title }] });
    expect(titled('x'.repeat(160)).success).toBe(true);
    expect(titled('x'.repeat(161)).success).toBe(false);
    expect(titled('   ').success).toBe(false);
    expect(
      createApprovalRequestSchema.safeParse({ ...input, message: 'x'.repeat(1001) }).success,
    ).toBe(false);
  });

  it('leaves the limit of tasks in one request to the API (LIMIT_REACHED)', () => {
    const items = Array.from({ length: APPROVAL_LIMITS.items + 1 }, (_, index) => ({
      taskId: `0199a000-0000-7000-8000-${String(index).padStart(12, '0')}`,
    }));
    expect(APPROVAL_LIMITS.items).toBe(20);
    expect(createApprovalRequestSchema.safeParse({ ...input, items }).success).toBe(true);
  });
});

describe('publicResponseSchema', () => {
  it('needs a note to request changes, not to approve', () => {
    expect(publicResponseSchema.safeParse({ decision: 'approved' }).success).toBe(true);
    expect(publicResponseSchema.parse({ decision: 'approved', note: ' ' }).note).toBeNull();
    expect(publicResponseSchema.safeParse({ decision: 'changes_requested' }).success).toBe(false);
    expect(
      publicResponseSchema.safeParse({ decision: 'changes_requested', note: '  ' }).success,
    ).toBe(false);
    expect(
      publicResponseSchema.safeParse({ decision: 'changes_requested', note: 'غيّروا اللون' })
        .success,
    ).toBe(true);
    expect(
      publicResponseSchema.safeParse({ decision: 'approved', note: 'x'.repeat(2001) }).success,
    ).toBe(false);
    expect(publicResponseSchema.safeParse({ decision: 'withdrawn' }).success).toBe(false);
  });
});

describe('approvalRequestListQuerySchema', () => {
  it('lists open and expired requests by default', () => {
    expect(approvalRequestListQuerySchema.parse({}).state).toEqual(['open', 'expired']);
    expect(approvalRequestListQuerySchema.parse({ state: 'revoked' }).state).toEqual(['revoked']);
    expect(approvalRequestListQuerySchema.parse({ createdBy: 'me' }).createdBy).toBe('me');
    expect(approvalRequestListQuerySchema.safeParse({ createdBy: ids.other }).success).toBe(false);
  });
});
