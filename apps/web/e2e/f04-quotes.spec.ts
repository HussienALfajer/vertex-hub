import { grantedPermissions, type MeResponse } from '@vertex-hub/contracts';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { accountManagerMe, employeeMe, financeMe, manager, mockApi, seedIds } from './fixtures';
import { expect, test } from './test';

// F04 quote screens against the mocked API (the real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

const oneOff = ar.quotes.sections.one_off;

test('an account manager builds a quote whose discount needs approval and asks for it', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: ar.nav.label })
    .getByRole('link', { name: ar.nav.quotes })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.quotes.title);

  await page.getByRole('button', { name: ar.quotes.new.action }).click();
  const dialog = page.getByRole('dialog', { name: ar.quotes.new.title });
  await dialog.getByRole('combobox', { name: ar.quotes.form.client }).click();
  // Account managers quote their own clients only.
  await expect(page.getByRole('option', { name: 'عيادة الشفاء' })).toBeHidden();
  await page.getByRole('option', { name: 'مطعم الياسمين' }).click();
  await dialog.getByLabel(ar.quotes.form.title, { exact: true }).fill('هوية وسوشال جديدة');
  await dialog.getByRole('button', { name: ar.quotes.new.create }).click();
  await expect(page).toHaveURL(/\/quotes\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('هوية وسوشال جديدة');

  // One-off: Brand identity; monthly: the Gold social package.
  await page.getByRole('combobox', { name: ar.quotes.builder.addService }).first().click();
  // A one-off section offers one-off services only.
  await expect(page.getByRole('option', { name: 'ريل' })).toBeHidden();
  await page.getByRole('option', { name: 'هوية بصرية' }).click();
  await page.getByRole('combobox', { name: ar.quotes.builder.addPackage }).click();
  await page.getByRole('option', { name: 'باقة السوشال الذهبية' }).click();
  const gold = page.getByRole('group', { name: 'باقة السوشال الذهبية' });
  await expect(
    gold.getByLabel(fill(ar.quotes.builder.quantityOf, { name: 'تصميم سوشال ميديا' })),
  ).toHaveValue('12');

  await page.getByRole('button', { name: ar.quotes.installments.add }).click();
  await page.getByLabel(fill(ar.quotes.installments.name, { n: '1' })).fill('البداية');
  await page.getByLabel(fill(ar.quotes.installments.percent, { n: '1' })).fill('50');
  await page.getByRole('button', { name: ar.quotes.installments.add }).click();
  await page.getByLabel(fill(ar.quotes.installments.name, { n: '2' })).fill('التسليم');
  await expect(page.getByLabel(fill(ar.quotes.installments.percent, { n: '2' }))).toHaveValue('50');
  await page.getByLabel(ar.quotes.builder.termMonths).fill('6');

  // A 15 % one-off discount, typed as a percentage, crosses the 10 % threshold.
  await page
    .getByRole('group', { name: fill(ar.quotes.builder.discountMode, { section: oneOff }) })
    .getByRole('button', { name: '%' })
    .click();
  await page.getByLabel(fill(ar.quotes.builder.discountPercent, { section: oneOff })).fill('15');
  await expect(page.getByText('120.00 USD')).toBeVisible();
  // Percentages carry direction marks, so the badge is matched by its start.
  await expect(page.getByText(/^يحتاج اعتمادًا \(الحد/)).toBeVisible();
  await page.getByRole('button', { name: ar.quotes.builder.save }).click();
  await expect(page.getByText(ar.quotes.builder.saved)).toBeVisible();

  await expect(page.getByText(ar.quotes.approval.neededTitle)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.quotes.send.action })).toBeDisabled();
  await page.getByRole('button', { name: ar.quotes.approval.request }).click();
  await expect(page.getByText(ar.quotes.approval.pendingTitle)).toBeVisible();
  // While pending the draft is read-only.
  await expect(page.getByLabel(ar.quotes.builder.termMonths)).toBeDisabled();
  await expect(page.getByRole('button', { name: ar.quotes.builder.save })).toBeHidden();
});

test('a new currency prices the lines again on save, and its prices wait for that save', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/quotes/${seedIds.shifaDraft}`);
  const gold = page.getByRole('group', { name: 'باقة السوشال الذهبية' });
  await page.getByRole('combobox', { name: ar.quotes.form.currency }).click();
  await page.getByRole('option', { name: ar.quotes.currencies.SYP }).click();
  await expect(page.getByText(ar.quotes.builder.currencyChanged)).toBeVisible();
  // Gold social has no SYP price: 0 until priced by hand after the save.
  await expect(gold.getByLabel(ar.quotes.builder.packagePrice)).toBeDisabled();
  await expect(gold.getByLabel(ar.quotes.builder.packagePrice)).toHaveValue('0');
  await page.getByRole('button', { name: ar.quotes.builder.save }).click();
  await expect(page.getByText(ar.quotes.builder.saved)).toBeVisible();
  await expect(gold.getByLabel(ar.quotes.builder.packagePrice)).toBeEnabled();
  await gold.getByLabel(ar.quotes.builder.packagePrice).fill('6000000');
  await page.getByRole('button', { name: ar.quotes.builder.save }).click();
  await expect(gold.getByLabel(ar.quotes.builder.packagePrice)).toHaveValue('6000000');

  // Removing the section's last line drops its discount, so the draft still saves.
  await page
    .getByRole('button', {
      name: fill(ar.quotes.builder.removeLine, { name: 'باقة السوشال الذهبية' }),
    })
    .click();
  await page.getByRole('button', { name: ar.quotes.builder.save }).click();
  await expect(page.getByText(ar.quotes.builder.saved).first()).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: ar.errors.INVALID_DISCOUNT }),
  ).toBeHidden();
});

test('the General Manager finds drafts awaiting approval and returns one with a note', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/quotes');
  await page.getByRole('button', { name: ar.quotes.filters.awaiting }).click();
  await expect(page.getByRole('link', { name: /حملة رمضان/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /هوية وسوشال الياسمين/ })).toBeHidden();

  await page.getByRole('link', { name: /حملة رمضان/ }).click();
  await page.getByRole('button', { name: ar.quotes.approval.return }).click();
  const dialog = page.getByRole('dialog', { name: ar.quotes.approval.returnTitle });
  await dialog.getByLabel(ar.quotes.approval.note).fill('الخصم كبير، خففه إلى 12٪.');
  await dialog.getByRole('button', { name: ar.quotes.approval.return }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(fill(ar.quotes.approval.returnedTitle, { name: 'سارة الخطيب' })),
  ).toBeVisible();
  await expect(page.getByText('الخصم كبير، خففه إلى 12٪.')).toBeVisible();
});

test('the General Manager approves and sends; the PDF follows', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/quotes/${seedIds.pendingQuote}`);
  await page.getByRole('button', { name: ar.quotes.approval.approve }).click();
  await expect(page.getByText(ar.quotes.approval.approvedTitle)).toBeVisible();

  await page.getByRole('button', { name: ar.quotes.send.action, exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: ar.quotes.send.confirm }).click();
  await expect(page.getByText(ar.quotes.send.done)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.quotes.statuses.sent);
  await expect(page.getByRole('link', { name: ar.quotes.pdf.download })).toBeVisible({
    timeout: 10_000,
  });
});

test('a new version, once sent, supersedes the previous one', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/quotes/${seedIds.sentQuote}`);
  await page.getByRole('button', { name: ar.quotes.versions.new }).click();
  await expect(page.getByText(ar.quotes.versions.created)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.quotes.statuses.draft);
  await expect(page.getByText('Q-2026-0001 v2')).toBeVisible();

  await page.getByRole('button', { name: ar.quotes.send.action, exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: ar.quotes.send.confirm }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.quotes.statuses.sent);
  const versions = page.getByRole('heading', { name: ar.quotes.versions.title }).locator('..');
  await expect(versions).toContainText(ar.quotes.statuses.superseded);
});

test('an expired quote is extended, then rejected with a reason', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/quotes/${seedIds.expiredQuote}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.quotes.statuses.expired);
  await page.getByRole('button', { name: ar.quotes.extend.action }).click();
  const extend = page.getByRole('dialog', { name: ar.quotes.extend.title });
  await extend.getByRole('button', { name: ar.quotes.extend.action }).click();
  await expect(extend).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.quotes.statuses.sent);

  await page.getByRole('button', { name: ar.quotes.reject.action }).click();
  const reject = page.getByRole('dialog', {
    name: fill(ar.quotes.reject.title, { number: 'Q-2026-0004' }),
  });
  await reject.getByRole('combobox', { name: ar.quotes.reject.reason }).click();
  await page.getByRole('option', { name: ar.quotes.rejectionReasons.price }).click();
  await reject.getByRole('button', { name: ar.quotes.reject.action }).click();
  await expect(reject).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.quotes.statuses.rejected);
  await expect(page.getByRole('heading', { name: ar.quotes.response.title })).toBeVisible();
});

test('quote settings: the threshold is the General Manager’s; others read', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto('/catalog/settings');
  await expect(page.getByText(ar.quotes.settings.readOnlyTitle)).toBeVisible();
  await expect(page.getByLabel(ar.quotes.settings.threshold)).not.toBeEditable();

  api.signInAs(manager);
  await page.goto('/catalog/settings');
  await page.getByLabel(ar.quotes.settings.threshold).fill('12');
  await page.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.quotes.settings.saved)).toBeVisible();
  await expect(page.getByLabel(ar.quotes.settings.threshold)).toHaveValue('12');
});

test('account managers see their clients’ quotes only; employees see none', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto(`/quotes/${seedIds.expiredQuote}`);
  await expect(page.getByText(ar.quotes.notFound)).toBeVisible();

  api.signInAs(employeeMe);
  await page.goto('/quotes');
  await expect(page).not.toHaveURL(/\/quotes/);
  await expect(
    page.getByRole('navigation', { name: ar.nav.label }).getByRole('link', { name: ar.nav.quotes }),
  ).toBeHidden();
});

test('"My clients" is for account managers; Finance and the General Manager see every quote', async ({
  page,
}) => {
  const api = await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto('/quotes');
  const mine = page.getByRole('button', { name: ar.quotes.filters.mine, exact: true });
  await expect(mine).toBeVisible();

  // The seeded General Manager is an account manager too.
  const generalManager: MeResponse = {
    ...manager,
    roles: ['general_manager', 'employee'],
    permissions: grantedPermissions({ roles: ['general_manager', 'employee'], departments: [] }),
  };
  for (const me of [financeMe, generalManager]) {
    api.signInAs(me);
    await page.goto('/quotes');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(mine).toHaveCount(0);
  }
});

test('"Clear filters" gives the focus to the search field', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/quotes?search=Q-2026');
  await page.getByRole('button', { name: ar.quotes.filters.clear }).click();
  await expect(page.getByRole('button', { name: ar.quotes.filters.clear })).toHaveCount(0);
  await expect(page.getByLabel(ar.quotes.search)).toBeFocused();
});

test('the client profile shows the Quotes tab to quote readers covering the client', async ({
  page,
}) => {
  const api = await mockApi(page, { signedIn: true, me: accountManagerMe });
  const quotesTab = page.getByRole('tab', { name: ar.clients.profile.tabs.quotes });
  await page.goto(`/clients/${seedIds.jasmine}`);
  await expect(quotesTab).toBeVisible();

  // Another account manager's client: no tab, and a link to it opens the first tab.
  await page.goto(`/clients/${seedIds.shifa}?tab=quotes`);
  await expect(page.getByRole('tab', { name: ar.clients.profile.tabs.contacts })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(quotesTab).toHaveCount(0);

  api.signInAs(financeMe);
  await page.goto(`/clients/${seedIds.shifa}`);
  await expect(quotesTab).toBeVisible();
});
