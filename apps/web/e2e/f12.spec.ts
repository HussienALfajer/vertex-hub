import type { Page } from '@playwright/test';
import { addDays, businessDate } from '@vertex-hub/contracts';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { employeeMe, financeMe, manager, mockApi, seedIds } from './fixtures';
import { expect, test } from './test';

// F12 campaign and ad wallet screens against the mocked API (the rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

/** A wallet card's value, by its label. */
const card = (page: Page, label: string) =>
  page.getByRole('region', { name: ar.campaigns.wallet.totals }).locator('[data-slot="card"]', {
    has: page.getByRole('heading', { name: label, exact: true }),
  });

async function pick(
  page: Page,
  scope: ReturnType<Page['getByRole']>,
  label: string,
  option: string,
) {
  await scope.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('a manager records a deposit, starts a wallet campaign and sees the balance drop', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/clients/${seedIds.jasmine}`);
  await page.getByRole('tab', { name: ar.clients.profile.tabs.ads }).click();
  // 500 + 300 deposited, 200 spent.
  await expect(card(page, ar.campaigns.wallet.balance)).toContainText('600.00');
  await expect(page.getByText('AD-2026-0002')).toBeVisible();

  await page.getByRole('button', { name: ar.campaigns.entry.deposit }).click();
  const deposit = page.getByRole('dialog', { name: ar.campaigns.entry.depositTitle });
  await deposit.getByLabel(ar.campaigns.entry.amount).fill('100');
  await expect(deposit.getByText(ar.campaigns.entry.balanceAfter)).toBeVisible();
  await expect(deposit).toContainText('700.00');
  await pick(page, deposit, ar.campaigns.entry.method, ar.invoices.methods.cash);
  await deposit.getByRole('button', { name: ar.campaigns.entry.deposit }).click();
  await expect(card(page, ar.campaigns.wallet.balance)).toContainText('700.00');
  await expect(
    page.getByRole('link', {
      name: fill(ar.campaigns.ledger.receiptOf, { number: 'AD-2026-0004' }),
    }),
  ).toBeVisible();

  // A new campaign from the Ads tab has the client fixed.
  await page.getByRole('button', { name: ar.campaigns.new.action }).click();
  const create = page.getByRole('dialog', { name: ar.campaigns.new.title });
  await expect(create.getByRole('combobox', { name: ar.campaigns.form.client })).toBeHidden();
  await create.getByLabel(ar.campaigns.form.name).fill('حملة العروض الشتوية');
  await pick(page, create, ar.campaigns.form.platform, ar.campaigns.platforms.meta);
  await pick(page, create, ar.campaigns.form.objective, ar.campaigns.objectives.leads);
  await create.getByLabel(ar.campaigns.form.budget).fill('1000');
  await create.getByLabel(ar.campaigns.form.startsOn).fill(businessDate());
  await create.getByRole('button', { name: ar.campaigns.new.create }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('حملة العروض الشتوية');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    ar.campaigns.statuses.planned,
  );

  // Rule 8: the budget left is more than the balance; starting warns and goes on.
  await page.getByRole('button', { name: ar.campaigns.actions.start }).click();
  const start = page.getByRole('dialog', { name: ar.campaigns.confirm.start.title });
  await expect(start.getByText(ar.campaigns.start.shortTitle)).toBeVisible();
  await start.getByRole('button', { name: ar.campaigns.actions.start }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.campaigns.statuses.active);

  await page.getByRole('button', { name: ar.campaigns.updates.add }).first().click();
  const update = page.getByRole('dialog', { name: ar.campaigns.updates.addTitle });
  await update.getByLabel(ar.campaigns.updates.spend).fill('150');
  await update.getByLabel(ar.campaigns.results.leads).fill('30');
  await update.getByLabel(ar.campaigns.updates.reach).fill('9000');
  await update.getByLabel(ar.campaigns.updates.clicks).fill('400');
  await expect(update).toContainText('5.00');
  await update.getByRole('button', { name: ar.campaigns.updates.add }).click();
  const totals = page.getByRole('region', { name: ar.campaigns.totals.label });
  await expect(totals).toContainText('150.00');
  await expect(totals).toContainText(fill(ar.campaigns.budgetUsed, { percent: '15' }));
  // The client's balance drops by the spend.
  await expect(totals).toContainText('550.00');
});

test('an update period crossing a month is refused, and spend over the budget warns', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/campaigns/${seedIds.autumnCampaign}`);
  await page.getByRole('button', { name: ar.campaigns.updates.add }).first().click();
  const update = page.getByRole('dialog', { name: ar.campaigns.updates.addTitle });
  const today = businessDate();
  const lastMonthEnd = addDays(`${today.slice(0, 7)}-01`, -1);
  await update.getByLabel(ar.campaigns.updates.periodStart).fill(lastMonthEnd);
  await update.getByLabel(ar.campaigns.updates.periodEnd).fill(addDays(lastMonthEnd, 1));
  // 200 spent of 600: 500 more goes over the budget.
  await update.getByLabel(ar.campaigns.updates.spend).fill('500');
  await expect(update.getByText(ar.campaigns.updates.overBudgetTitle)).toBeVisible();
  for (const label of [
    ar.campaigns.results.messages,
    ar.campaigns.updates.reach,
    ar.campaigns.updates.clicks,
  ]) {
    await update.getByLabel(label).fill('0');
  }
  await update.getByRole('button', { name: ar.campaigns.updates.add }).click();
  await expect(update.getByRole('alert')).toContainText(ar.errors.PERIOD_CROSSES_MONTH);
});

test('finance reads and funds but does not manage campaigns; refunds stay within the balance', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: financeMe });
  await page.goto(`/campaigns/${seedIds.autumnCampaign}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('حملة رسائل الخريف');
  await expect(page.getByRole('button', { name: ar.campaigns.updates.add })).toBeHidden();
  await expect(page.getByRole('button', { name: ar.campaigns.actions.pause })).toBeHidden();

  await page.goto(`/clients/${seedIds.jasmine}?tab=ads`);
  await expect(page.getByRole('button', { name: ar.campaigns.threshold.edit })).toBeHidden();
  await expect(page.getByRole('button', { name: ar.campaigns.new.action })).toBeHidden();

  await page.getByRole('button', { name: ar.campaigns.entry.refund }).click();
  const refund = page.getByRole('dialog', { name: ar.campaigns.entry.refundTitle });
  await refund.getByLabel(ar.campaigns.entry.amount).fill('700');
  await expect(refund.getByText(ar.campaigns.entry.exceedsTitle)).toBeVisible();
  await refund.getByLabel(ar.campaigns.entry.amount).fill('100');
  await expect(refund.getByText(ar.campaigns.entry.exceedsTitle)).toBeHidden();
  await pick(page, refund, ar.campaigns.entry.method, ar.invoices.methods.cash);
  await refund.getByRole('button', { name: ar.campaigns.entry.refund }).click();
  await expect(card(page, ar.campaigns.wallet.balance)).toContainText('500.00');

  // Voiding the SYP deposit keeps it listed, struck, and lowers the balance.
  await page
    .getByRole('button', { name: fill(ar.campaigns.void.actionOf, { entry: 'AD-2026-0002' }) })
    .click();
  const voiding = page.getByRole('dialog', {
    name: fill(ar.campaigns.void.depositTitle, { number: 'AD-2026-0002' }),
  });
  await voiding.getByLabel(ar.campaigns.void.reason).fill('سُجّل مرتين');
  await voiding.getByRole('button', { name: ar.campaigns.void.confirm }).click();
  await expect(card(page, ar.campaigns.wallet.balance)).toContainText('200.00');
  await expect(page.getByRole('row', { name: /AD-2026-0002/ })).toContainText(
    ar.campaigns.ledger.voided,
  );
});

test('the Ad budgets tab flags low balances; employees see no campaigns', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: ar.nav.label })
    .getByRole('link', { name: ar.nav.campaigns })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.campaigns.title);
  await expect(page.getByRole('link', { name: 'حملة رسائل الخريف' })).toBeVisible();
  // A direct campaign is marked as paid by the client.
  await expect(page.getByRole('row', { name: /زيارات قائمة الطعام/ })).toContainText(
    ar.campaigns.funding.client_direct,
  );

  await page.getByRole('tab', { name: ar.campaigns.tabs.budgets }).click();
  await page.getByRole('button', { name: ar.campaigns.wallets.onlyLow }).click();
  await expect(page.getByRole('row', { name: /عيادة الشفاء/ })).toContainText(
    ar.campaigns.wallet.lowBadge,
  );
  await expect(page.getByRole('link', { name: 'مطعم الياسمين' })).toBeHidden();
  await page.getByRole('link', { name: 'عيادة الشفاء' }).click();
  await expect(page.getByRole('tab', { name: ar.clients.profile.tabs.ads })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  api.signInAs(employeeMe);
  await page.goto('/');
  await expect(
    page
      .getByRole('navigation', { name: ar.nav.label })
      .getByRole('link', { name: ar.nav.campaigns }),
  ).toBeHidden();
  await page.goto('/campaigns');
  await expect(page).not.toHaveURL(/\/campaigns/);
  // An Ads link (an owner's ad_budget_low) opens the first tab for users who cannot read campaigns.
  await page.goto(`/clients/${seedIds.jasmine}?tab=ads`);
  await expect(page.getByRole('tab', { name: ar.clients.profile.tabs.ads })).toBeHidden();
  await expect(page.getByRole('tab', { name: ar.clients.profile.tabs.contacts })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
