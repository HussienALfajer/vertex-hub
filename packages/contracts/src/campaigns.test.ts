import { describe, expect, it } from 'vitest';
import {
  AD_CAMPAIGN_STATUSES,
  acceptsUpdates,
  budgetUsed,
  campaignListQuerySchema,
  campaignStatusChangeSchema,
  campaignUpdateInputSchema,
  canChangeCampaignStatus,
  costPerResult,
  createCampaignSchema,
  daysWithoutUpdate,
  patchCampaignUpdateSchema,
  periodInOneMonth,
  periodsOverlap,
  updateCampaignSchema,
} from './campaigns.js';

const id = '0192f000-0000-7000-8000-000000000001';
const other = '0192f000-0000-7000-8000-000000000002';

describe('costPerResult (rule 11)', () => {
  it('divides spend by results in minor units, rounded half up', () => {
    expect(costPerResult(20_000, 45)).toBe(444);
    expect(costPerResult(1_000, 3)).toBe(333);
    expect(costPerResult(500, 200)).toBe(3);
    expect(costPerResult(100, 200)).toBe(1);
    expect(costPerResult(0, 10)).toBe(0);
  });

  it('is none without results', () => {
    expect(costPerResult(20_000, 0)).toBeNull();
  });
});

describe('budgetUsed (rule 11)', () => {
  it('is a whole percentage rounded down, so only a fully spent budget reaches 100', () => {
    expect(budgetUsed(20_000, 60_000)).toBe(33);
    expect(budgetUsed(59_999, 60_000)).toBe(99);
    expect(budgetUsed(60_000, 60_000)).toBe(100);
    expect(budgetUsed(0, 60_000)).toBe(0);
  });

  it('goes beyond 100 when spend exceeds the budget (rule 13)', () => {
    expect(budgetUsed(90_000, 60_000)).toBe(150);
  });
});

describe('periods (rules 9 and 10)', () => {
  const period = (periodStart: string, periodEnd: string) => ({ periodStart, periodEnd });

  it('overlap when they share at least one day, ends included', () => {
    expect(
      periodsOverlap(period('2026-10-01', '2026-10-07'), period('2026-10-07', '2026-10-14')),
    ).toBe(true);
    expect(
      periodsOverlap(period('2026-10-01', '2026-10-31'), period('2026-10-10', '2026-10-12')),
    ).toBe(true);
    expect(
      periodsOverlap(period('2026-10-08', '2026-10-14'), period('2026-10-01', '2026-10-07')),
    ).toBe(false);
    expect(
      periodsOverlap(period('2026-10-01', '2026-10-07'), period('2026-10-08', '2026-10-08')),
    ).toBe(false);
  });

  it('lie in one calendar month only when both ends do', () => {
    expect(periodInOneMonth(period('2026-09-01', '2026-09-30'))).toBe(true);
    expect(periodInOneMonth(period('2026-10-04', '2026-10-04'))).toBe(true);
    expect(periodInOneMonth(period('2026-09-28', '2026-10-04'))).toBe(false);
    expect(periodInOneMonth(period('2025-12-31', '2026-01-01'))).toBe(false);
  });
});

describe('campaign status', () => {
  it('follows the state machine', () => {
    expect(canChangeCampaignStatus('planned', 'active')).toBe(true);
    expect(canChangeCampaignStatus('active', 'paused')).toBe(true);
    expect(canChangeCampaignStatus('paused', 'active')).toBe(true);
    expect(canChangeCampaignStatus('active', 'completed')).toBe(true);
    expect(canChangeCampaignStatus('paused', 'completed')).toBe(true);
    expect(canChangeCampaignStatus('completed', 'active')).toBe(true);
    for (const from of ['planned', 'active', 'paused'] as const) {
      expect(canChangeCampaignStatus(from, 'cancelled')).toBe(true);
    }
  });

  it('refuses every other move, and nothing leaves cancelled', () => {
    expect(canChangeCampaignStatus('planned', 'paused')).toBe(false);
    expect(canChangeCampaignStatus('planned', 'completed')).toBe(false);
    expect(canChangeCampaignStatus('completed', 'cancelled')).toBe(false);
    expect(canChangeCampaignStatus('completed', 'paused')).toBe(false);
    for (const to of AD_CAMPAIGN_STATUSES) {
      expect(canChangeCampaignStatus('cancelled', to)).toBe(false);
    }
  });

  it('accepts updates on active, paused and completed campaigns only', () => {
    expect(AD_CAMPAIGN_STATUSES.filter(acceptsUpdates)).toEqual(['active', 'paused', 'completed']);
  });
});

describe('daysWithoutUpdate (rule 14)', () => {
  const today = '2026-10-20';
  const days = (
    status: (typeof AD_CAMPAIGN_STATUSES)[number],
    startsOn: string,
    lastUpdateEnd: string | null,
  ) => daysWithoutUpdate({ status, startsOn, lastUpdateEnd, today });

  it('counts from the last update once it ended more than 7 days ago', () => {
    expect(days('active', '2026-09-01', '2026-10-13')).toBeNull();
    expect(days('active', '2026-09-01', '2026-10-12')).toBe(8);
  });

  it('counts from the start when there is no update, from 7 days on', () => {
    expect(days('active', '2026-10-14', null)).toBeNull();
    expect(days('active', '2026-10-13', null)).toBe(7);
  });

  it('is shown on active campaigns only', () => {
    for (const status of ['planned', 'paused', 'completed', 'cancelled'] as const) {
      expect(days(status, '2026-01-01', null)).toBeNull();
    }
  });
});

describe('campaign schemas', () => {
  const create = {
    clientId: id,
    name: ' Ramadan offers ',
    platform: 'meta',
    objective: 'messages',
    budgetMinor: 60_000,
    startsOn: '2026-10-01',
    ownerId: other,
  } as const;

  it('defaults a new campaign to wallet funding, no links and empty notes', () => {
    expect(createCampaignSchema.parse(create)).toEqual({
      ...create,
      name: 'Ramadan offers',
      funding: 'wallet',
      endsOn: null,
      projectId: null,
      retainerId: null,
      taskId: null,
      notes: '',
    });
  });

  it('checks limits: name, budget above zero, notes', () => {
    expect(createCampaignSchema.safeParse({ ...create, name: ' ' }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...create, name: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(createCampaignSchema.safeParse({ ...create, budgetMinor: 0 }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...create, budgetMinor: 1.5 }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...create, notes: 'x'.repeat(2001) }).success).toBe(
      false,
    );
    expect(createCampaignSchema.safeParse({ ...create, startsOn: '2026-13-01' }).success).toBe(
      false,
    );
  });

  it('links a project or a retainer, not both', () => {
    expect(createCampaignSchema.safeParse({ ...create, projectId: id }).success).toBe(true);
    expect(createCampaignSchema.safeParse({ ...create, retainerId: id }).success).toBe(true);
    expect(
      createCampaignSchema.safeParse({ ...create, projectId: id, retainerId: other }).success,
    ).toBe(false);
  });

  it('saves the whole campaign with the loaded updatedAt', () => {
    const { clientId: _, ...fields } = create;
    const update = {
      ...fields,
      funding: 'client_direct',
      endsOn: null,
      projectId: null,
      retainerId: null,
      taskId: null,
      notes: '',
    };
    expect(updateCampaignSchema.safeParse(update).success).toBe(false);
    expect(
      updateCampaignSchema.safeParse({ ...update, updatedAt: '2026-10-04T10:00:00.000Z' }).success,
    ).toBe(true);
  });

  it('takes a status change with an optional reason', () => {
    expect(
      campaignStatusChangeSchema.parse({ to: 'cancelled', reason: ' Client stopped ' }),
    ).toEqual({
      to: 'cancelled',
      reason: 'Client stopped',
    });
    expect(campaignStatusChangeSchema.safeParse({ to: 'planned' }).success).toBe(false);
    expect(
      campaignStatusChangeSchema.safeParse({ to: 'cancelled', reason: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});

describe('campaign update schemas', () => {
  const update = {
    periodStart: '2026-10-01',
    periodEnd: '2026-10-07',
    spendMinor: 20_000,
    reach: 15_000,
    clicks: 900,
    results: 45,
  };

  it('takes non-negative whole metrics and defaults the note', () => {
    expect(campaignUpdateInputSchema.parse(update)).toEqual({ ...update, note: '' });
    expect(
      campaignUpdateInputSchema.safeParse({ ...update, spendMinor: 0, results: 0 }).success,
    ).toBe(true);
    for (const field of ['spendMinor', 'reach', 'clicks', 'results'] as const) {
      expect(campaignUpdateInputSchema.safeParse({ ...update, [field]: -1 }).success).toBe(false);
      expect(campaignUpdateInputSchema.safeParse({ ...update, [field]: 1.5 }).success).toBe(false);
    }
    expect(campaignUpdateInputSchema.safeParse({ ...update, reach: 2_147_483_648 }).success).toBe(
      false,
    );
    expect(campaignUpdateInputSchema.safeParse({ ...update, note: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('patches any subset of the fields without defaults', () => {
    expect(patchCampaignUpdateSchema.parse({ spendMinor: 3_000 })).toEqual({ spendMinor: 3_000 });
    expect(patchCampaignUpdateSchema.parse({})).toEqual({});
  });
});

describe('campaign list query', () => {
  it('defaults to running campaigns, newest change first', () => {
    expect(campaignListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 50,
      status: ['planned', 'active', 'paused'],
      sort: 'updatedAt',
      order: 'desc',
    });
  });

  it('reads repeated statuses and the "my campaigns" toggle', () => {
    expect(campaignListQuerySchema.parse({ status: 'completed', mine: 'true' })).toMatchObject({
      status: ['completed'],
      mine: true,
    });
    expect(campaignListQuerySchema.parse({ status: ['active', 'paused'] }).status).toEqual([
      'active',
      'paused',
    ]);
  });
});
