import type { Page } from '@playwright/test';
import type { CreatePost } from '@vertex-hub/contracts';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { accountManagerMe, mockApi, PROJECTS_TODAY, seedIds } from './fixtures';
import { expect, test } from './test';

// F08B PR 3 against the mocked API: the new post wizard, the post page's captions, slides, move
// and publishing pack (the rules themselves are covered by apps/api/test).

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
});

const step = (page: Page, name: keyof typeof ar.content.wizard.steps) =>
  page
    .getByRole('navigation', { name: ar.content.wizard.stepsLabel })
    .getByRole('button', { name: ar.content.wizard.steps[name] })
    .click();

const section = (page: Page, name: string) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) });

const caption = (page: Page, group: keyof typeof ar.content.captionGroups) =>
  page.getByRole('textbox', {
    name: fill(ar.content.captions.caption, { group: ar.content.captionGroups[group] }),
  });

test('the wizard: an idea, a caption per platform, slides and a task, saved in one request', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mockApi(page, { signedIn: true, me: accountManagerMe, content: true });
  await page.goto(`/content/new?clientId=${seedIds.jasmine}&date=2026-10-20`);
  await expect(
    page.getByRole('heading', { level: 1, name: ar.content.wizard.title }),
  ).toBeVisible();

  // Basics: from an idea, four platforms, a best time of the client's.
  await page.getByRole('combobox', { name: ar.content.wizard.fromIdea }).click();
  await page.getByRole('option', { name: 'فطور الجمعة العائلي بصور من المطبخ' }).click();
  await expect(page.getByLabel(ar.content.form.title)).toHaveValue(
    'فطور الجمعة العائلي بصور من المطبخ',
  );
  for (const platform of ['إنستغرام', 'فيسبوك', 'إكس', 'يوتيوب']) {
    await page.getByRole('checkbox', { name: platform, exact: true }).click();
  }
  await expect(page.getByText(ar.content.wizard.bestTimes)).toBeVisible();
  await page
    .getByRole('list', { name: ar.content.wizard.bestTimes })
    .getByRole('button')
    .first()
    .click();
  await expect(page.getByLabel(new RegExp(`^${ar.content.form.publishTime}`))).toHaveValue('09:00');

  // Captions: three groups, a hashtag set, X over its limit, YouTube copied with a title.
  await step(page, 'captions');
  const tabs = page.getByRole('tablist', { name: ar.content.captions.tabsLabel });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await caption(page, 'facebook_instagram').fill('فطور العائلة كل جمعة من مطبخ الياسمين.');
  await page.getByRole('button', { name: ar.content.captions.insert.hashtags }).click();
  await page.getByRole('menuitem', { name: /وسوم الياسمين/ }).click();
  await expect(page.getByRole('textbox', { name: ar.content.form.hashtags })).toHaveValue(
    '#مطعم_الياسمين #دمشق #فطور_شامي',
  );
  await tabs.getByRole('tab', { name: /إكس/ }).click();
  await caption(page, 'x').fill('أ'.repeat(300));
  await expect(page.getByText(/أطول من حد إكس بـ 20 حرف/)).toBeVisible();
  await tabs.getByRole('tab', { name: /يوتيوب/ }).click();
  await page.getByRole('button', { name: ar.content.captions.copyFrom }).click();
  await page.getByRole('menuitem', { name: ar.content.captionGroups.facebook_instagram }).click();
  await expect(caption(page, 'youtube')).toHaveValue('فطور العائلة كل جمعة من مطبخ الياسمين.');
  await page.getByLabel(ar.content.captions.title).fill('فطور الجمعة في الياسمين');

  // Media: three chosen and one pasted, a slide caption, the last moved earlier.
  await step(page, 'media');
  await page.locator('input[type="file"]').setInputFiles(
    ['one', 'two', 'three'].map((name) => ({
      name: `${name}.png`,
      mimeType: 'image/png',
      buffer: PNG,
    })),
  );
  await page.evaluate(
    (bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    },
    [...PNG],
  );
  const slides = page.getByRole('list', { name: ar.content.slides.title }).locator(':scope > li');
  await expect(slides).toHaveCount(4);
  await page
    .getByRole('textbox', { name: fill(ar.content.slides.captionOf, { name: 'الشريحة 2' }) })
    .fill('الطبق الرئيسي');
  await page
    .getByRole('button', { name: fill(ar.content.slides.earlier, { name: 'الشريحة 3' }) })
    .click();
  await expect(slides.nth(1)).toContainText('three.png');
  // The preview beside the steps swipes through the four slides.
  const preview = page.getByRole('complementary', { name: ar.content.preview.title });
  await expect(preview.getByLabel('الشريحة 1 من 4')).toBeVisible();

  // Tasks: a design task for the department's queue.
  await step(page, 'tasks');
  await page.getByRole('button', { name: ar.content.wizard.tasks.add }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: ar.content.wizard.tasks.queue }).click();
  await expect(dialog.getByLabel(ar.tasks.form.title)).toHaveValue(
    'منشور: فطور الجمعة العائلي بصور من المطبخ',
  );
  await dialog.getByRole('button', { name: ar.content.wizard.tasks.keep }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(ar.content.wizard.tasks.queue)).toBeVisible();

  // Review: X's length blocks the submission later, it never blocks the save.
  await step(page, 'review');
  await expect(page.getByText(/نص إكس أطول من حد إكس/)).toBeVisible();
  await expect(page.getByText(ar.content.checks.blocking).first()).toBeVisible();
  const request = page.waitForRequest(
    (r) => r.url().endsWith('/api/content/posts') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: ar.content.wizard.save }).click();
  const sent = (await request).postDataJSON() as CreatePost;
  expect(sent.captions.map((c) => c.group)).toEqual(['facebook_instagram', 'x', 'youtube']);
  expect(sent.captions[2]?.title).toBe('فطور الجمعة في الياسمين');
  expect(sent.files.map((f) => f.slideCaption)).toEqual([null, null, 'الطبق الرئيسي', null]);
  expect(sent.files[1]?.name).toBe('three.png');
  expect(sent.tasks).toHaveLength(1);
  expect(sent.tasks[0]?.assigneeId).toBeNull();
  expect(sent.ideaId).toBeTruthy();

  // The post page: in production with its task, the slides in order, the checks at the top.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'فطور الجمعة العائلي بصور من المطبخ',
  );
  await expect(page.getByRole('heading', { name: ar.content.checks.title })).toBeVisible();
  await expect(page.getByText('الطبق الرئيسي').first()).toBeVisible();

  // Moving it two work days later offers to shift the task, ticked when it would fall after.
  await page.getByRole('button', { name: ar.tasks.actions.more }).click();
  await page.getByRole('menuitem', { name: ar.content.actions.move }).click();
  const move = page.getByRole('dialog');
  await move.getByLabel(ar.content.moveDate.newDate).fill('2026-10-22');
  await expect(move.getByRole('checkbox', { name: ar.content.moveDate.shift })).toBeVisible();
  await move.getByRole('checkbox', { name: ar.content.moveDate.shift }).check();
  await move.getByRole('button', { name: ar.content.actions.move }).click();
  await expect(page.getByText(fill(ar.content.moveDate.doneShifted, { n: '1' }))).toBeVisible();
});

test('a draft comes back after a reload, and Start over clears it', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe, content: true });
  await page.goto(`/content/new?clientId=${seedIds.jasmine}`);
  await page.getByLabel(ar.content.form.title).fill('مسودة محفوظة');
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByText(ar.tasks.wizard.restored.title)).toBeVisible();
  await expect(page.getByLabel(ar.content.form.title)).toHaveValue('مسودة محفوظة');
  await page.getByRole('button', { name: ar.tasks.wizard.startOver }).click();
  await expect(page.getByLabel(ar.content.form.title)).toHaveValue('');
});

test('the post page: captions per group, slides arranged, and the publishing pack', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe, content: true });

  // An approved carousel: its pack copies the captions and downloads the media.
  await page.goto(`/content/posts/${seedIds.autumnCarousel}`);
  const pack = section(page, ar.content.pack.title);
  await expect(pack.getByRole('link', { name: ar.content.pack.download })).toHaveAttribute(
    'href',
    `/api/content/posts/${seedIds.autumnCarousel}/pack`,
  );
  await expect(section(page, ar.content.preview.title).getByRole('tab')).toHaveCount(2);

  // A post in production: its captions are edited per group, its slides arranged.
  await page.goto(`/content/posts/${seedIds.openingPost}`);
  await page.getByRole('button', { name: ar.tasks.actions.more }).click();
  await page.getByRole('menuitem', { name: ar.content.actions.editContent }).click();
  const dialog = page.getByRole('dialog');
  await caption(page, 'facebook_instagram').fill('افتتاح الفرع الثاني في المزة.');
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.content.edit.saved)).toBeVisible();
  await expect(page.getByText('افتتاح الفرع الثاني في المزة.').first()).toBeVisible();

  await page.getByRole('button', { name: ar.content.slides.arrange }).click();
  const arrange = page.getByRole('dialog');
  await arrange
    .getByRole('textbox', { name: fill(ar.content.slides.captionOf, { name: 'الشريحة 1' }) })
    .fill('العرض كاملًا');
  await arrange.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.content.slides.saved)).toBeVisible();
  await expect(page.getByText('العرض كاملًا').first()).toBeVisible();
});
