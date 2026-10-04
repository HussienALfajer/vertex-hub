import { describe, expect, it } from 'vitest';
import {
  AD_CAMPAIGN_STATUSES,
  acceptsUpdates,
  adDepositDisplayNumber,
  adWalletBalance,
  budgetUsed,
  campaignListQuerySchema,
  campaignStatusChangeSchema,
  campaignUpdateInputSchema,
  canChangeCampaignStatus,
  costPerResult,
  createCampaignSchema,
  daysWithoutUpdate,
  isLowBalance,
  patchCampaignUpdateSchema,
  periodInOneMonth,
  periodsOverlap,
  recordWalletEntrySchema,
  updateCampaignSchema,
  updateWalletThresholdSchema,
  voidWalletEntrySchema,
  type WalletLedgerItem,
  type WalletSpend,
  walletLedger,
  walletListQuerySchema,
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

describe('adWalletBalance (rule 15)', () => {
  const spend = (spendMinor: number, over: Partial<WalletSpend> = {}): WalletSpend => ({
    spendMinor,
    archived: false,
    funding: 'wallet',
    campaignArchived: false,
    ...over,
  });

  it('adds deposits and takes off refunds and wallet spend', () => {
    expect(
      adWalletBalance(
        [
          { kind: 'deposit', usdMinor: 50_000, voided: false },
          { kind: 'deposit', usdMinor: 10_000, voided: false },
          { kind: 'refund', usdMinor: 5_000, voided: false },
        ],
        [spend(20_000), spend(1_000)],
      ),
    ).toBe(34_000);
  });

  it('ignores void entries, archived updates, direct campaigns and archived campaigns', () => {
    expect(
      adWalletBalance(
        [
          { kind: 'deposit', usdMinor: 50_000, voided: false },
          { kind: 'deposit', usdMinor: 99_000, voided: true },
          { kind: 'refund', usdMinor: 7_000, voided: true },
        ],
        [
          spend(1_000, { archived: true }),
          spend(2_000, { funding: 'client_direct' }),
          spend(3_000, { campaignArchived: true }),
          spend(4_000),
        ],
      ),
    ).toBe(46_000);
  });

  it('goes negative when spend passes the deposits', () => {
    expect(adWalletBalance([{ kind: 'deposit', usdMinor: 100, voided: false }], [spend(300)])).toBe(
      -200,
    );
    expect(adWalletBalance([], [])).toBe(0);
  });
});

describe('isLowBalance (rule 20)', () => {
  it('is below the threshold for a client that uses the wallet', () => {
    expect(isLowBalance(9_999, 10_000, true)).toBe(true);
    expect(isLowBalance(-1, 0, true)).toBe(true);
    expect(isLowBalance(10_000, 10_000, true)).toBe(false);
  });

  it('never alerts without a threshold or without a deposit', () => {
    expect(isLowBalance(-5_000, null, true)).toBe(false);
    expect(isLowBalance(-5_000, 10_000, false)).toBe(false);
  });
});

describe('walletLedger (rule 15)', () => {
  const item = (
    id: string,
    date: string,
    kind: WalletLedgerItem['kind'],
    usdMinor: number,
    voided = false,
  ): WalletLedgerItem => ({ id, date, kind, usdMinor, voided });

  const items = [
    item('c', '2026-09-20', 'spend', 3_000),
    item('a', '2026-09-01', 'deposit', 10_000),
    item('b', '2026-09-10', 'deposit', 5_000, true),
    item('e', '2026-10-02', 'refund', 1_000),
    item('d', '2026-09-20', 'spend', 2_000),
  ];

  it('orders by date then id and keeps a running balance; void entries do not count', () => {
    const { openingMinor, rows } = walletLedger(items);
    expect(openingMinor).toBe(0);
    expect(rows.map((row) => [row.id, row.balanceMinor])).toEqual([
      ['a', 10_000],
      ['b', 10_000],
      ['c', 7_000],
      ['d', 5_000],
      ['e', 4_000],
    ]);
  });

  it('starts from the opening balance before `from` and stops after `to`', () => {
    const { openingMinor, rows } = walletLedger(items, { from: '2026-09-15', to: '2026-09-30' });
    expect(openingMinor).toBe(10_000);
    expect(rows.map((row) => [row.id, row.balanceMinor])).toEqual([
      ['c', 7_000],
      ['d', 5_000],
    ]);
  });
});

describe('wallet schemas', () => {
  const entry = {
    kind: 'deposit',
    occurredOn: '2026-10-01',
    amountMinor: 50_000,
    currency: 'USD',
    method: 'bank_transfer',
  } as const;

  it('defaults the rate, the texts and the proof, and stores blank texts as null', () => {
    expect(recordWalletEntrySchema.parse({ ...entry, reference: '  ' })).toEqual({
      ...entry,
      sypPerUsd: null,
      reference: null,
      note: null,
      proofUploadId: null,
    });
  });

  it('refuses zero amounts, bad rates, unknown kinds and long texts', () => {
    const invalid = [
      { ...entry, amountMinor: 0 },
      { ...entry, sypPerUsd: '0' },
      { ...entry, sypPerUsd: '13000.12345' },
      { ...entry, kind: 'spend' },
      { ...entry, method: 'cheque' },
      { ...entry, reference: 'x'.repeat(201) },
      { ...entry, note: 'x'.repeat(501) },
    ];
    for (const input of invalid) {
      expect(recordWalletEntrySchema.safeParse(input).success).toBe(false);
    }
  });

  it('needs a void reason and accepts a null threshold', () => {
    expect(voidWalletEntrySchema.safeParse({ reason: ' ' }).success).toBe(false);
    expect(voidWalletEntrySchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(updateWalletThresholdSchema.parse({ lowBalanceThresholdMinor: null })).toEqual({
      lowBalanceThresholdMinor: null,
    });
    expect(updateWalletThresholdSchema.safeParse({ lowBalanceThresholdMinor: -1 }).success).toBe(
      false,
    );
  });

  it('lists wallets by balance, lowest first', () => {
    expect(walletListQuerySchema.parse({ low: 'true' })).toEqual({
      page: 1,
      pageSize: 50,
      low: true,
      sort: 'balance',
      order: 'asc',
    });
  });

  it('numbers deposit receipts AD-<year>-<4 digits>', () => {
    expect(adDepositDisplayNumber({ year: 2026, number: 1 })).toBe('AD-2026-0001');
    expect(adDepositDisplayNumber({ year: 2027, number: 12_345 })).toBe('AD-2027-12345');
  });
});
