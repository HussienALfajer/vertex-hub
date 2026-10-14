import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { employeeMe, financeMe, mockApi, PROJECTS_TODAY, seedIds } from './fixtures';
import { expect, test } from './test';

// F05C PR 5 contract screens against the mocked API (the real rules are covered by apps/api/test).

const contracts = ar.retainers.contracts;

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value), text);

async function onProjectsToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

const scan = { name: 'signed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') };

/** Prepares the active term's contract of the ads retainer and lands on its editor. */
async function prepareTermContract(page: Page) {
  await page.goto(`/retainers/${seedIds.adsRetainer}?tab=contract`);
  const term = page.getByRole('region', { name: fill(ar.retainers.terms.name, { number: '2' }) });
  await term.getByRole('button', { name: contracts.prepare }).click();
  await expect(page.getByRole('heading', { name: contracts.draftName, level: 1 })).toBeVisible();
}

test('a manager prepares, edits and issues a term contract, then uploads the signed copy (K2–K5)', async ({
  page,
}) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await prepareTermContract(page);

  // No signatory yet (no contact has final approval): issuing is blocked and says why.
  await expect(page.getByTestId('party-signatoryName')).toContainText(contracts.requiredField);
  await page.getByRole('button', { name: contracts.issue }).click();
  const issue = page.getByRole('dialog', { name: contracts.issueTitle });
  await expect(issue.getByText(contracts.issueRequired)).toBeVisible();
  await expect(issue.getByRole('button', { name: contracts.issueAction })).toBeDisabled();
  await issue.getByRole('button', { name: ar.common.cancel }).click();

  // Choose the signatory, edit an article and add one, then save.
  await page.getByLabel(contracts.signatory).click();
  await page.getByRole('option', { name: /د. رامي حسن/ }).click();
  const articles = ar.retainers.contractSettings.articles;
  await page.getByLabel(fill(articles.titleLabel, { position: '1' })).fill('موضوع العقد ونطاقه');
  // Drag article 3 onto article 2 by its grip (the up/down buttons are the keyboard way).
  const rows = page.getByRole('listitem').filter({ has: page.getByTestId('article-grip') });
  await rows.nth(2).getByTestId('article-grip').dragTo(rows.nth(1));
  await expect(page.getByLabel(fill(articles.titleLabel, { position: '2' }))).toHaveValue(
    'الأتعاب وطريقة الدفع',
  );
  await page.getByRole('button', { name: articles.add }).click();
  await page.getByLabel(fill(articles.titleLabel, { position: '4' })).fill('مدة العقد');
  await page.getByLabel(fill(articles.bodyLabel, { position: '4' })).fill('{term}');
  // Issuing waits for the changes to be saved.
  await expect(page.getByRole('button', { name: contracts.issue })).toBeDisabled();
  await page.getByRole('button', { name: contracts.save }).click();
  await expect(page.getByText(contracts.saved)).toBeVisible();
  await expect(page.getByTestId('party-signatoryName')).toContainText('د. رامي حسن');

  await page.getByRole('button', { name: contracts.preview, exact: true }).click();
  await expect(page.getByRole('link', { name: contracts.openPreview })).toBeVisible();

  // The issue dialog lists the fields that print empty; issuing gives the year's number.
  await page.getByRole('button', { name: contracts.issue }).click();
  await expect(issue.getByText(contracts.issueEmpty)).toBeVisible();
  await expect(issue.getByText(ar.retainers.contracts.clientFields.fatherName)).toBeVisible();
  await issue.getByRole('button', { name: contracts.issueAction }).click();
  await expect(
    page.getByRole('heading', {
      name: fill(contracts.name, { number: 'VM-CCS-2026-001' }),
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'المادة 1 — موضوع العقد ونطاقه' })).toBeVisible();
  await expect(page.getByRole('button', { name: contracts.save })).toHaveCount(0);

  await page.getByRole('button', { name: contracts.uploadSigned }).click();
  const signed = page.getByRole('dialog');
  await signed.locator('input[type=file]').setInputFiles(scan);
  await signed.getByRole('button', { name: contracts.saveSigned }).click();
  await expect(page.getByText(contracts.signedSaved)).toBeVisible();
  await expect(page.getByText(contracts.statuses.signed, { exact: true })).toBeVisible();
});

test('an applied amendment of a covered cycle gets an annex (K10)', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await prepareTermContract(page);
  await page.getByLabel(contracts.signatory).click();
  await page.getByRole('option', { name: /د. رامي حسن/ }).click();
  await page.getByRole('button', { name: contracts.save }).click();
  await expect(page.getByText(contracts.saved)).toBeVisible();
  await page.getByRole('button', { name: contracts.issue }).click();
  await page.getByRole('button', { name: contracts.issueAction }).click();
  await expect(page.getByText(fill(contracts.issued, { number: 'VM-CCS-2026-001' }))).toBeVisible();

  await page
    .getByRole('link', { name: fill(contracts.backTo, { name: 'الإعلانات الممولة' }) })
    .click();
  const section = page.getByRole('region', { name: contracts.title });
  await expect(section.getByTestId('contract')).toContainText('VM-CCS-2026-001');

  // The pending amendment of cycle 6 is approved and applied: the contract covers its cycle.
  const amendment = page
    .getByTestId('amendment')
    .filter({ hasText: fill(ar.retainers.amendments.name, { number: '2' }) });
  await expect(amendment.getByRole('button', { name: contracts.issueAnnex })).toHaveCount(0);
  await amendment.getByRole('button', { name: ar.retainers.amendments.approve }).click();
  await amendment.getByRole('button', { name: contracts.issueAnnex }).click();
  await page.getByRole('button', { name: contracts.issueAnnexAction }).click();
  await expect(page.getByText(contracts.annexIssued)).toBeVisible();
  await expect(
    amendment.getByText(fill(contracts.annexedIn, { annex: '1', number: 'VM-CCS-2026-001' })),
  ).toBeVisible();
  await expect(section.getByTestId('annex')).toContainText(
    fill(contracts.annexName, { annex: '1' }),
  );
});

test('Finance reads contracts without actions; users without money access see none (G3)', async ({
  page,
}) => {
  await onProjectsToday(page);
  const api = await mockApi(page, { signedIn: true });
  await prepareTermContract(page);

  await api.signInAs(financeMe);
  await page.goto(`/retainers/${seedIds.adsRetainer}?tab=contract`);
  const section = page.getByRole('region', { name: contracts.title });
  await expect(section.getByTestId('contract')).toContainText(contracts.draftName);
  await expect(page.getByRole('button', { name: contracts.prepare })).toHaveCount(0);
  await expect(section.getByRole('button', { name: contracts.issue })).toHaveCount(0);
  await section.getByRole('link', { name: contracts.openDraft }).click();
  await expect(page.getByText(contracts.draftReadOnly)).toBeVisible();
  await expect(page.getByRole('button', { name: contracts.save })).toHaveCount(0);

  await api.signInAs(employeeMe);
  await page.goto(`/retainers/${seedIds.adsRetainer}?tab=contract`);
  await expect(page.getByRole('heading', { name: ar.retainers.amendments.title })).toBeVisible();
  await expect(page.getByRole('region', { name: contracts.title })).toHaveCount(0);
});
