import type { Locator } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { employeeMe, imageId, mockApi, portraitPng, seedIds } from './fixtures';
import { expect, test } from './test';

// F01C flows against the mocked API (the real rules are covered by apps/api/test/images.test.ts).

const t = ar.images;

/** An avatar showing a loaded image: the initial shows while there is none. */
const avatarImage = (scope: Locator, image = '/api/images/') =>
  scope.locator(`[data-slot="avatar"] img[src*="${image}"]`);

test('an employee adds their photo from My account: pick, move, zoom and save', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/account');
  const card = page.getByRole('heading', { name: t.addPhoto.title });
  await expect(card).toBeVisible();

  await page.getByRole('button', { name: t.actions.user.add }).first().click();
  const dialog = page.getByRole('dialog', { name: t.dialog.title.user });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'portrait.png',
    mimeType: 'image/png',
    buffer: portraitPng(),
  });
  const frame = dialog.getByRole('application', { name: t.dialog.frame });
  await expect(frame).toBeVisible();
  // A portrait fills the round frame: it moves up and down, and zooms in.
  await frame.focus();
  await page.keyboard.press('ArrowDown');
  const zoom = dialog.getByRole('slider', { name: t.dialog.zoom });
  await zoom.focus();
  await page.keyboard.press('ArrowUp');
  await expect(zoom).toHaveAttribute('aria-valuetext', '101٪');

  const saved = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' && request.url().endsWith(`/api/users/${seedIds.karim}/image`),
  );
  await dialog.getByRole('button', { name: ar.common.save }).click();
  expect((await saved).postDataJSON()).toEqual({ source: { uploadId: expect.any(String) } });
  await expect(dialog).toBeHidden();
  // The new photo shows at once on My account and in the header, and the card is gone.
  await expect(avatarImage(page.getByRole('main'))).toBeVisible();
  await expect(avatarImage(page.getByRole('banner'))).toBeVisible();
  await expect(card).toBeHidden();

  // Removing it asks first and brings the initial back.
  await page.getByRole('button', { name: t.actions.remove }).click();
  await page
    .getByRole('alertdialog', { name: t.remove.user.title })
    .getByRole('button', { name: t.actions.remove })
    .click();
  await expect(avatarImage(page.getByRole('main'))).toHaveCount(0);
});

test('"Not now" hides the card in this browser', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/account');
  await page.getByRole('button', { name: t.addPhoto.notNow }).click();
  await expect(page.getByRole('heading', { name: t.addPhoto.title })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: ar.account.title })).toBeVisible();
  await expect(page.getByRole('heading', { name: t.addPhoto.title })).toBeHidden();
});

test('a GIF is refused before anything is uploaded', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/account');
  let uploads = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/files/uploads')) uploads += 1;
  });
  await page.getByRole('button', { name: t.actions.user.add }).first().click();
  const dialog = page.getByRole('dialog', { name: t.dialog.title.user });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'moving.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('GIF89a'),
  });
  await expect(dialog.getByRole('alert')).toHaveText(ar.errors.IMAGE_TYPE_NOT_ALLOWED);
  // A file the browser cannot open is refused the same way, in place.
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(dialog.getByRole('alert')).toHaveText(t.dialog.cannotOpen);
  expect(uploads).toBe(0);
});

test('the team list shows photos, and user managers filter those without one', async ({ page }) => {
  await mockApi(page, { signedIn: true, images: true });
  await page.goto('/team');
  const sara = page.getByRole('row').filter({ hasText: 'سارة الخطيب' });
  await expect(avatarImage(sara, imageId(1))).toBeVisible();

  await page.getByRole('combobox', { name: ar.users.photo }).click();
  await page.getByRole('option', { name: ar.users.withoutPhoto }).click();
  await expect(page).toHaveURL(/photo=without/);
  await expect(page.getByRole('row').filter({ hasText: 'كريم الزين' })).toBeVisible();
  await expect(sara).toHaveCount(0);
});

test('the filter is for user managers only', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe, images: true });
  await page.goto('/team');
  await expect(page.getByRole('row').filter({ hasText: 'سارة الخطيب' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: ar.users.photo })).toHaveCount(0);
});

test('a client gets its logo from the brand files, zoomed out to fit', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/clients/${seedIds.jasmine}`);
  // Rule 7: no logo is taken automatically; the header offers to choose one.
  await page.getByRole('button', { name: t.actions.client.add }).click();
  const dialog = page.getByRole('dialog', { name: t.dialog.title.client });
  await dialog.getByRole('tab', { name: t.dialog.tabs.brand }).click();
  await dialog.getByRole('button', { name: 'شعار الياسمين' }).click();

  const zoom = dialog.getByRole('slider', { name: t.dialog.zoom });
  await zoom.focus();
  await page.keyboard.press('Home');
  await expect(dialog.getByText(t.dialog.fitHint)).toBeVisible();
  const saved = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' && request.url().endsWith(`/api/clients/${seedIds.jasmine}/image`),
  );
  await dialog.getByRole('button', { name: ar.common.save }).click();
  expect((await saved).postDataJSON()).toEqual({
    source: { uploadId: expect.any(String), brandVersionId: expect.any(String) },
  });
  await expect(dialog).toBeHidden();
  await expect(avatarImage(page.getByRole('main'))).toBeVisible();
  await expect(page.getByRole('button', { name: t.actions.client.change })).toBeVisible();
});

test('a client without logos in its brand files points to the brand kit', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/clients/${seedIds.shifa}`);
  await page.getByRole('button', { name: t.actions.client.add }).click();
  const dialog = page.getByRole('dialog', { name: t.dialog.title.client });
  await dialog.getByRole('tab', { name: t.dialog.tabs.brand }).click();
  await expect(dialog.getByText(t.dialog.noLogos)).toBeVisible();
  await dialog.getByRole('link', { name: t.dialog.openBrandKit }).click();
  await expect(page).toHaveURL(/tab=brand-kit/);
});

test('those who cannot manage the client see its logo without the actions', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe, images: true });
  await page.goto(`/clients/${seedIds.jasmine}`);
  await expect(avatarImage(page.getByRole('main'), imageId(10)).first()).toBeVisible();
  await expect(page.getByRole('button', { name: t.actions.client.change })).toHaveCount(0);
});

test('a project shows its client’s logo until it gets its own image, and returns to it', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, images: true });
  await page.goto(`/projects/${seedIds.identityProject}`);
  const main = page.getByRole('main');
  await expect(main.getByText(t.clientLogo, { exact: true })).toBeVisible();
  await expect(avatarImage(main, imageId(10)).first()).toBeVisible();

  await page.getByRole('button', { name: t.actions.project.useOwn }).click();
  const dialog = page.getByRole('dialog', { name: t.dialog.title.project });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: portraitPng(800, 600),
  });
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(dialog).toBeHidden();
  await expect(main.getByText(t.clientLogo, { exact: true })).toBeHidden();

  await page.getByRole('button', { name: t.actions.remove }).click();
  await page
    .getByRole('alertdialog', { name: t.remove.project.title })
    .getByRole('button', { name: t.actions.remove })
    .click();
  await expect(main.getByText(t.clientLogo, { exact: true })).toBeVisible();
});

test('photos and logos show across the app: task list and projects list', async ({ page }) => {
  await mockApi(page, { signedIn: true, images: true });
  await page.goto('/tasks/list');
  const layan = page.getByRole('row').filter({ hasText: 'ليان الأحمد' }).first();
  await expect(avatarImage(layan, imageId(3))).toBeVisible();
  await page.goto('/projects');
  await expect(avatarImage(page.getByRole('main'), imageId(10)).first()).toBeVisible();
});

test('a save the connection drops says so in place, and the photo can be saved again', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/account');
  await page.getByRole('button', { name: t.actions.user.add }).first().click();
  const dialog = page.getByRole('dialog', { name: t.dialog.title.user });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'portrait.png',
    mimeType: 'image/png',
    buffer: portraitPng(),
  });
  await page.route(`**/api/users/${seedIds.karim}/image`, (route) => route.abort(), { times: 1 });
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(dialog.getByRole('alert')).toHaveText(t.dialog.network);
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(dialog).toBeHidden();
  await expect(avatarImage(page.getByRole('main'))).toBeVisible();
});
