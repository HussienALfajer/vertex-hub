import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  accountManagerMe,
  employeeMe,
  manager,
  medicalReviewerMe,
  mockApi,
  PROJECTS_TODAY,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F09 review flows against the mocked API (the real rules are covered by apps/api/test).

async function onTasksToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

const hero = (page: Page) => page.locator('section').first();

const section = (page: Page, title: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name: title }) });

/** Clicks a workflow move or a medical action in the task header. */
async function act(page: Page, name: string) {
  await hero(page).getByRole('button', { name, exact: true }).click();
}

test('a healthcare task passes internal review, is returned and then approved by the medical reviewer', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 2000 });
  await onTasksToday(page);
  const api = await mockApi(page, { signedIn: true, me: accountManagerMe });

  // The Design manager writes the text for the client and passes the internal review.
  await page.goto(`/tasks/${seedIds.clinicLogo}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مراجعة شعار العيادة');
  await section(page, ar.tasks.clientText.title)
    .getByRole('button', { name: ar.tasks.clientText.add })
    .click();
  await page.getByRole('dialog').getByLabel(ar.tasks.clientText.label).fill('شعار جديد لعيادتكم.');
  await page.getByRole('dialog').getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.tasks.clientText.saved)).toBeVisible();

  // The client is healthcare: the pass leads to the medical stage, not to the client.
  await act(page, ar.tasks.moves.send_to_client);
  await expect(page.getByText(ar.tasks.moves.done.to_medical)).toBeVisible();
  await expect(hero(page).getByText(ar.tasks.medicalStatus, { exact: true })).toBeVisible();
  await expect(page.getByText(ar.tasks.page.medicalTitle)).toBeVisible();
  const history = section(page, ar.tasks.reviews.title);
  await expect(history.getByText(ar.tasks.reviews.outcomes.passed)).toBeVisible();
  await expect(history.getByText('شعار جديد لعيادتكم.')).toBeVisible();
  // Manage scope may still return it, but the medical pass is not theirs.
  await expect(page.getByRole('button', { name: ar.tasks.medical.approve })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.tasks.moves.return })).toBeVisible();

  // The medical reviewer finds it in My tasks and on the Approvals page, without their own task.
  api.signInAs(medicalReviewerMe);
  await page.goto('/tasks');
  const mine = page.getByRole('region', { name: ar.tasks.my.sections.medicalReview });
  await expect(mine.getByRole('link', { name: 'مراجعة شعار العيادة' })).toBeVisible();
  await expect(mine.getByRole('link', { name: 'مقال عن تبييض الأسنان' })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: ar.nav.label })
    .getByRole('link', { name: ar.nav.approvals })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.approvals.title);
  await expect(page.getByRole('row')).toHaveCount(4);
  await expect(page.getByRole('row', { name: /مقال عن تبييض الأسنان/ })).toContainText(
    ar.approvals.medical.own,
  );
  await page.getByRole('link', { name: 'مراجعة شعار العيادة' }).click();

  // A return needs notes; it is a medical revision, never counted.
  await act(page, ar.tasks.medical.return);
  const returning = page.getByRole('dialog');
  await returning.getByRole('button', { name: ar.tasks.medical.return }).click();
  await expect(returning.getByText(ar.tasks.medical.errors.notes)).toBeVisible();
  await returning.getByLabel(ar.tasks.medical.notes).fill('احذف عبارة «الأفضل في المدينة».');
  await returning.getByRole('button', { name: ar.tasks.medical.return }).click();
  await expect(page.getByText(ar.tasks.medical.returned)).toBeVisible();
  await expect(hero(page).getByText(ar.tasks.statuses.revisions, { exact: true })).toBeVisible();
  await expect(
    section(page, ar.tasks.revisions.title).getByText(ar.tasks.revisions.medical, { exact: true }),
  ).toBeVisible();

  // Resubmitted, it goes through internal review again, then the medical reviewer approves.
  api.signInAs(manager);
  await page.reload();
  await act(page, ar.tasks.moves.resubmit);
  await act(page, ar.tasks.moves.send_to_client);
  await expect(hero(page).getByText(ar.tasks.medicalStatus, { exact: true })).toBeVisible();
  api.signInAs(medicalReviewerMe);
  await page.reload();
  await act(page, ar.tasks.medical.approve);
  const approving = page.getByRole('dialog');
  await expect(approving.getByText('شعار جديد لعيادتكم.')).toBeVisible();
  await approving.getByRole('button', { name: ar.tasks.medical.approve }).click();
  await expect(page.getByText(ar.tasks.medical.approved)).toBeVisible();
  await expect(
    hero(page).getByText(ar.tasks.statuses.awaiting_client, { exact: true }),
  ).toBeVisible();
  await expect(history.getByText(ar.tasks.reviews.stages.medical).first()).toBeVisible();
  await expect(page.getByRole('button', { name: ar.tasks.medical.approve })).toHaveCount(0);
});

test('a medical reviewer never reviews their own task, and others have no medical queue', async ({
  page,
}) => {
  await onTasksToday(page);
  const api = await mockApi(page, { signedIn: true, me: medicalReviewerMe });
  await page.goto(`/tasks/${seedIds.whiteningArticle}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مقال عن تبييض الأسنان');
  await expect(page.getByText(ar.tasks.page.medicalOwnBody)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.tasks.medical.approve })).toHaveCount(0);

  // An employee outside Medical Consultation: no link, and the page shows only what was sent.
  api.signInAs(employeeMe);
  await page.goto('/approvals?tab=medical');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: ar.approvals.tabs.sent })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page
      .getByRole('navigation', { name: ar.nav.label })
      .getByRole('link', { name: ar.nav.approvals }),
  ).toHaveCount(0);
  await page.goto(`/tasks/${seedIds.dentalPost}`);
  await expect(page.getByText(ar.tasks.page.medicalBody)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.tasks.medical.approve })).toHaveCount(0);
});

test('what was sent is marked, a withdrawn task is sent again, and a response names its contact', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 2000 });
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto(`/tasks/${seedIds.autumnMenu}`);
  await act(page, ar.tasks.moves.submit);
  await act(page, ar.tasks.moves.send_to_client);
  await expect(
    hero(page).getByText(ar.tasks.statuses.awaiting_client, { exact: true }),
  ).toBeVisible();

  // The pass kept both deliverables; they are what the client has.
  const files = section(page, ar.tasks.files.title);
  await expect(files.getByText(ar.tasks.files.sentToClient)).toHaveCount(2);
  const history = section(page, ar.tasks.reviews.title);
  await expect(history.getByText('غلاف المنيو v2')).toBeVisible();

  // Ready to send shows on My tasks for the client's account manager.
  await page.goto('/tasks');
  await expect(
    page
      .getByRole('region', { name: ar.tasks.my.sections.readyToSend })
      .getByRole('link', { name: 'تصاميم منيو الخريف' }),
  ).toBeVisible();

  // Only its own section lists it.
  await expect(
    page
      .getByRole('region', { name: ar.tasks.my.sections.waiting })
      .getByRole('link', { name: 'تصاميم منيو الخريف' }),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole('region', { name: ar.tasks.my.sections.requestedByMe })
      .getByRole('link', { name: 'تصاميم منيو الخريف' }),
  ).toHaveCount(0);

  // Withdrawn for re-review, it is sent again; the response is recorded with who answered.
  await page.goto(`/tasks/${seedIds.autumnMenu}`);
  await act(page, ar.tasks.moves.withdraw);
  const withdrawing = page.getByRole('dialog');
  await withdrawing.getByLabel(ar.tasks.move.optionalNote).fill('أُضيفت صفحة ثالثة.');
  await withdrawing.getByRole('button', { name: ar.tasks.moves.withdraw }).click();
  await expect(
    hero(page).getByText(ar.tasks.statuses.internal_review, { exact: true }),
  ).toBeVisible();
  await expect(files.getByText(ar.tasks.files.sentToClient)).toHaveCount(0);
  await act(page, ar.tasks.moves.send_to_client);
  await act(page, ar.tasks.moves.client_approved);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: ar.tasks.move.responder }).click();
  // Contacts with final approval come first and say so.
  await expect(page.getByRole('option').nth(1)).toContainText('اعتماد نهائي');
  await page.getByRole('option').nth(1).click();
  await dialog.getByRole('button', { name: ar.tasks.moves.client_approved }).click();
  const responses = section(page, ar.tasks.responses.title);
  await expect(responses.getByText(ar.tasks.responses.decisions.approved)).toBeVisible();
  await expect(responses.getByText(ar.tasks.responses.channels.manual)).toBeVisible();
  await expect(responses.getByText('غلاف المنيو v2')).toBeVisible();
});

test('the task list filters the medical stage, and the audit log reads F09 entries in Arabic', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await onTasksToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto('/tasks/list');
  await page.getByRole('button', { name: ar.tasks.filters.medicalReview }).click();
  await expect(page).toHaveURL(/reviewStage=medical/);
  await expect(page.getByRole('row')).toHaveCount(3);
  await expect(
    page.getByRole('row', { name: /منشور التوعية/ }).getByText(ar.tasks.medicalBadge),
  ).toBeVisible();

  await page.goto('/audit');
  const reviewed = page.getByRole('listitem').filter({ hasText: ar.audit.actions.task.reviewed });
  await reviewed.getByRole('button', { name: ar.audit.showDetails }).click();
  await expect(reviewed.getByText(ar.tasks.reviews.stages.medical)).toBeVisible();
  await expect(reviewed.getByText(ar.tasks.reviews.outcomes.passed)).toBeVisible();
  await expect(reviewed.getByText('منشور التوعية v1')).toBeVisible();
  const responded = page
    .getByRole('listitem')
    .filter({ hasText: ar.audit.actions.task.client_response_recorded });
  await expect(responded.getByText('د. رامي حسن')).toBeVisible();
  await responded.getByRole('button', { name: ar.audit.showDetails }).click();
  await expect(responded.getByText(ar.tasks.responses.decisions.changes_requested)).toBeVisible();
  await expect(responded.getByText(ar.audit.via.approval_link, { exact: true })).toBeVisible();
});
