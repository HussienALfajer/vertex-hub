import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  accountManagerMe,
  employeeMe,
  financeMe,
  manager,
  mockApi,
  operationsManagerMe,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F03 against the mocked API (the real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

const column = (page: import('@playwright/test').Page, stage: keyof typeof ar.leads.stages) =>
  page.getByRole('list', { name: ar.leads.board.stages }).getByRole('listitem', {
    name: ar.leads.stages[stage],
    exact: true,
  });

const card = (
  page: import('@playwright/test').Page,
  stage: keyof typeof ar.leads.stages,
  leadId: string,
) => column(page, stage).locator(`[data-lead="${leadId}"]`);

/** Drops on the column's header, clear of the toasts at the bottom of the screen. */
const onHeader = { targetPosition: { x: 40, y: 20 } };

/** The stage badge beside the lead page's heading. */
const stageOf = (page: import('@playwright/test').Page) => page.locator('h1 + [data-stage]');

test('a new lead warns about a duplicate, saves anyway, and is archived from the list', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/leads?view=board');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.leads.title);
  await page.getByRole('button', { name: ar.leads.newLead }).click();
  const dialog = page.getByRole('dialog', { name: ar.leads.form.newTitle });
  await dialog.getByLabel(ar.leads.form.contactName).fill('أحمد');
  await dialog.getByLabel(ar.leads.form.phone).fill('+963 944 111 222');
  // Rule 2: the open lead with the same phone shows, as a warning only.
  const matches = dialog.getByRole('list', { name: ar.leads.duplicates.title });
  await expect(matches.getByRole('link', { name: 'عيادة النور لطب الأسنان' })).toBeVisible();
  await dialog.getByRole('combobox', { name: ar.leads.form.interests }).click();
  await page.getByRole('option', { name: 'باقة السوشال الذهبية' }).click();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: ar.leads.form.create }).click();
  await expect(page.getByText(ar.leads.form.created)).toBeVisible();
  await expect(column(page, 'new').getByRole('link', { name: 'أحمد', exact: true })).toBeVisible();

  await page.getByRole('button', { name: ar.leads.view.list }).click();
  await expect(page).toHaveURL(/view=list/);
  await page.getByRole('button', { name: fill(ar.leads.actions.menu, { name: 'أحمد' }) }).click();
  await page.getByRole('menuitem', { name: ar.leads.actions.archive }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: ar.leads.actions.archive })
    .click();
  await expect(page.getByText(ar.leads.archive.archived)).toBeVisible();
  await expect(page.getByRole('link', { name: 'أحمد', exact: true })).toHaveCount(0);
});

test('cards move by menu and by dragging; a lead with a sent quote snaps back', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/leads?view=board');

  // Lost from the card's menu (the path a drop on the Lost column takes) opens the lose dialog.
  await column(page, 'meeting')
    .getByRole('button', { name: fill(ar.leads.board.moveTo, { name: 'متجر لمسة' }) })
    .click();
  await page.getByRole('menuitem', { name: ar.leads.actions.lose }).click();
  await expect(
    page.getByRole('dialog', { name: fill(ar.leads.lose.title, { name: 'متجر لمسة' }) }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  // The keyboard way: "Move to…" on the card.
  await column(page, 'contacted')
    .getByRole('button', { name: fill(ar.leads.board.moveTo, { name: 'عيادة النور لطب الأسنان' }) })
    .click();
  await page.getByRole('menuitem', { name: ar.leads.stages.meeting }).click();
  await expect(
    column(page, 'meeting').getByRole('link', { name: 'عيادة النور لطب الأسنان' }),
  ).toBeVisible();

  // Dragging: New → Contacted.
  await card(page, 'new', seedIds.sindyanLead).dragTo(column(page, 'contacted'), onHeader);
  await expect(
    column(page, 'contacted').getByRole('link', { name: 'مطعم السنديان' }),
  ).toBeVisible();

  // Rule 5: out of Quote sent only without a sent quote; the card stays and says why.
  await card(page, 'quote_sent', seedIds.rashaqaLead).dragTo(column(page, 'meeting'), onHeader);
  await expect(page.getByText(ar.errors.LEAD_HAS_SENT_QUOTE)).toBeVisible();
  await expect(column(page, 'quote_sent').getByRole('link', { name: 'صالة رشاقة' })).toBeVisible();
});

test('an activity sets the next follow-up; a loss rejects the sent quote and reopening returns it', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/leads/${seedIds.rashaqaLead}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('صالة رشاقة');
  await expect(page.getByText('Q-2026-0005')).toBeVisible();

  await page.getByRole('button', { name: ar.leads.activity.log }).first().click();
  const log = page.getByRole('dialog', { name: ar.leads.activity.logTitle });
  await log.getByRole('button', { name: ar.clients.notes.channels.whatsapp }).click();
  await log.getByLabel(ar.clients.notes.summary).fill('طلب تخفيضاً على الباقة.');
  await log.getByRole('button', { name: ar.leads.activity.log }).click();
  await expect(page.getByText(ar.leads.activity.logged)).toBeVisible();
  await expect(page.getByText('طلب تخفيضاً على الباقة.')).toBeVisible();

  await page.getByRole('button', { name: ar.leads.actions.more }).click();
  await page.getByRole('menuitem', { name: ar.leads.actions.lose }).click();
  const lose = page.getByRole('dialog', {
    name: fill(ar.leads.lose.title, { name: 'صالة رشاقة' }),
  });
  // Rule 8: the sent quote will be recorded as rejected.
  await expect(lose.getByText('Q-2026-0005')).toBeVisible();
  await lose.getByRole('button', { name: ar.leads.lose.submit }).click();
  await expect(
    page.getByText(fill(ar.leads.page.lostTitle, { reason: ar.leads.lossReasons.price })),
  ).toBeVisible();
  await expect(page.getByText(ar.quotes.statuses.rejected)).toBeVisible();

  await page.getByRole('button', { name: ar.leads.actions.reopen }).first().click();
  const reopen = page.getByRole('dialog', {
    name: fill(ar.leads.reopen.title, { name: 'صالة رشاقة' }),
  });
  await reopen.getByRole('button', { name: ar.leads.reopen.submit }).click();
  await expect(page.getByText(ar.leads.reopen.done)).toBeVisible();
  await expect(stageOf(page)).toHaveText(ar.leads.stages.contacted);
});

test('a lead is converted by linking an ended client, which becomes active', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/leads/${seedIds.sindyanLead}`);
  // An overdue lead is edited without a new date (rule 7).
  await page.getByRole('button', { name: ar.leads.actions.edit }).click();
  const edit = page.getByRole('dialog', { name: ar.leads.form.editTitle });
  await edit.getByLabel(ar.leads.form.email).fill('rami@sindyan.example');
  await edit.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.leads.form.saved)).toBeVisible();
  await expect(page.getByRole('link', { name: 'rami@sindyan.example' })).toBeVisible();

  await page.getByRole('button', { name: ar.leads.actions.convert }).click();
  const convert = page.getByRole('dialog', {
    name: fill(ar.leads.convert.title, { name: 'مطعم السنديان' }),
  });
  // Edge case 6: a taken name offers to link the client that holds it.
  await convert.getByLabel(ar.clients.form.tradeName).fill('متجر النخبة');
  await convert.getByRole('button', { name: ar.leads.convert.submit }).click();
  await expect(convert.getByText(ar.errors.CLIENT_NAME_TAKEN)).toBeVisible();
  await convert.getByRole('button', { name: ar.leads.convert.linkInstead }).click();
  await expect(convert.getByRole('combobox', { name: ar.leads.convert.client })).toHaveText(
    'متجر النخبة',
  );
  await expect(convert.getByText(ar.leads.convert.reactivates)).toBeVisible();
  await convert.getByRole('button', { name: ar.leads.convert.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${seedIds.nukhba}`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('متجر النخبة');
  await expect(page.getByText(ar.clients.statuses.active).first()).toBeVisible();
  // Screen 7: the client names the lead it came from.
  await expect(page.getByRole('link', { name: 'مطعم السنديان' })).toBeVisible();
});

test('a quote written on a lead is sent, then accepted with a new client, landing on the project', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto(`/leads/${seedIds.noorLead}`);
  await page.getByRole('button', { name: ar.leads.quotes.new }).first().click();
  const create = page.getByRole('dialog', { name: ar.quotes.new.title });
  // The lead is fixed: no client picker.
  await expect(create.getByRole('combobox', { name: ar.quotes.form.client })).toHaveCount(0);
  await create.getByLabel(ar.quotes.form.title, { exact: true }).fill('هوية وسوشال النور');
  await create.getByRole('button', { name: ar.quotes.new.create }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('هوية وسوشال النور');
  await expect(page.getByText(ar.leads.badge)).toBeVisible();

  await page.getByRole('combobox', { name: ar.quotes.builder.addService }).first().click();
  await page.getByRole('option', { name: 'هوية بصرية' }).click();
  await page.getByRole('combobox', { name: ar.quotes.builder.addPackage }).click();
  await page.getByRole('option', { name: 'باقة السوشال الذهبية' }).click();
  await page.getByRole('button', { name: ar.quotes.installments.add }).click();
  await page.getByLabel(fill(ar.quotes.installments.name, { n: '1' })).fill('دفعة واحدة');
  await page.getByLabel(fill(ar.quotes.installments.percent, { n: '1' })).fill('100');
  await page.getByLabel(ar.quotes.builder.termMonths).fill('6');
  await page.getByRole('button', { name: ar.quotes.builder.save }).click();
  await expect(page.getByText(ar.quotes.builder.saved)).toBeVisible();
  await page.getByRole('button', { name: ar.quotes.send.action, exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: ar.quotes.send.confirm }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.quotes.statuses.sent);

  // Rule 14: sending moved the lead to Quote sent.
  await page.goto(`/leads/${seedIds.noorLead}`);
  await expect(stageOf(page)).toHaveText(ar.leads.stages.quote_sent);
  await page.getByRole('link', { name: 'هوية وسوشال النور' }).click();

  await page.getByRole('button', { name: ar.quotes.accept.action }).click();
  const accept = page.getByRole('dialog', {
    name: fill(ar.quotes.accept.title, { number: 'Q-2026-0006' }),
  });
  // Step 0 (rule 11): a new client from the lead, Layan its account manager by default.
  await expect(accept.getByText(ar.quotes.accept.steps.client, { exact: true })).toBeVisible();
  await expect(accept.getByLabel(ar.clients.form.tradeName)).toHaveValue('عيادة النور لطب الأسنان');
  await expect(accept.getByRole('combobox', { name: ar.clients.form.accountManager })).toHaveText(
    'ليان الأحمد',
  );
  await accept.getByRole('button', { name: ar.common.next }).click();
  await accept.getByRole('button', { name: ar.common.next }).click();
  await accept.getByRole('button', { name: ar.common.next }).click();
  await accept.getByRole('button', { name: ar.common.next }).click();
  await expect(
    accept.getByText(fill(ar.leads.convert.summaryNew, { name: 'عيادة النور لطب الأسنان' })),
  ).toBeVisible();
  await accept.getByRole('button', { name: ar.quotes.accept.submit }).click();
  await expect(page.getByText(ar.quotes.accept.done)).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('هوية وسوشال النور');

  // The lead is won, with the new client.
  await page.goto(`/leads/${seedIds.noorLead}`);
  await expect(
    page.getByText(fill(ar.leads.page.wonTitle, { name: 'عيادة النور لطب الأسنان' })),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: ar.leads.activity.log })).toHaveCount(0);
});

test('the quote list shows a lead quote with its badge, for lead readers with a link', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: financeMe });
  await page.goto('/quotes');
  const row = page.getByRole('row', { name: /باقة سوشال صالة رشاقة/ });
  await expect(row.getByText(ar.leads.badge)).toBeVisible();
  // Finance reads quotes, not leads: the name is not a link and there is no Leads entry.
  await expect(row.getByRole('link', { name: 'صالة رشاقة', exact: true })).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: ar.nav.label });
  await expect(nav.getByRole('link', { name: ar.nav.leads })).toHaveCount(0);
});

test('the Operations manager reads leads and quotes them, with no lead actions', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: operationsManagerMe });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: ar.nav.label })
    .getByRole('link', { name: ar.nav.leads })
    .click();
  await expect(page.getByRole('button', { name: ar.leads.newLead })).toHaveCount(0);
  await page.goto(`/leads/${seedIds.noorLead}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عيادة النور لطب الأسنان');
  await expect(page.getByRole('button', { name: ar.leads.quotes.new }).first()).toBeVisible();
  for (const action of [ar.leads.activity.log, ar.leads.actions.edit, ar.leads.actions.convert]) {
    await expect(page.getByRole('button', { name: action })).toHaveCount(0);
  }
});

test('users without lead access see no Leads entry and are sent home', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/leads');
  await expect(page).not.toHaveURL(/\/leads/);
  const nav = page.getByRole('navigation', { name: ar.nav.label });
  await expect(nav.getByRole('link', { name: ar.nav.leads })).toHaveCount(0);
});
