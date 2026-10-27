import type { Page } from '@playwright/test';
import type { CreatePost } from '@vertex-hub/contracts';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { accountManagerMe, employeeMe, mockApi, PROJECTS_TODAY, seedIds } from './fixtures';
import { expect, test } from './test';

// F08B against the mocked API: the new post wizard, the post page's captions, slides, move and
// publishing pack (PR 3); the calendar's day clicks, drags, occasions, gaps and ideas, the
// Planning check, the Grid, the client's settings and snippets, the content settings and the
// quick idea (PR 4). The rules themselves are covered by apps/api/test.

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

const day = (page: Page, date: string) =>
  page.locator(`[data-slot="calendar-day"][data-day="${date}"]`);

test('the calendar: occasions, gaps, a day click, a drag with the move dialog, an idea onto a day', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await mockApi(page, { signedIn: true, content: true });
  await page.goto(`/content?clientId=${seedIds.jasmine}`);
  await expect(page.getByRole('link', { name: /كاروسيل أطباق الخريف/ }).first()).toBeVisible();

  // Rules C6–C8: the occasion on its day, not covered; gap days; posts too close.
  const foodDay = day(page, '2026-10-16').locator('[data-occasion]');
  await expect(foodDay).toHaveAttribute('data-uncovered', 'true');
  await expect(foodDay).toContainText('يوم الغذاء العالمي');
  await expect(page.locator('[data-gap]').first()).toBeVisible();
  await expect(page.getByText(ar.content.planning.tooCloseBadge).first()).toBeVisible();
  await foodDay.click();
  await expect(page.getByRole('dialog').getByText(ar.content.occasions.uncovered)).toBeVisible();
  await page.keyboard.press('Escape');

  // Rule B4: a past day is read-only; a day from today opens the wizard on it.
  await day(page, '2026-10-05').click({ position: { x: 60, y: 90 } });
  await expect(page).toHaveURL(/\/content\?/);
  await day(page, '2026-10-20').hover();
  await page
    .getByRole('button', {
      name: fill(ar.content.calendar.newOn, { date: 'الثلاثاء، 20 تشرين الأول' }),
    })
    .click();
  await expect(page).toHaveURL(/\/content\/new\?.*date=2026-10-20/);
  await expect(page).toHaveURL(new RegExp(`clientId=${seedIds.jasmine}`));
  await page.goBack();

  // Rules B6–B7: a post dragged to another day opens the move dialog on that day.
  await page.getByRole('link', { name: /تهنئة بداية الأسبوع/ }).dragTo(day(page, '2026-10-21'));
  const move = page.getByRole('dialog');
  await expect(move.getByLabel(ar.content.moveDate.newDate)).toHaveValue('2026-10-21');
  await move.getByRole('button', { name: ar.content.actions.move }).click();
  await expect(page.getByText(ar.content.moveDate.done)).toBeVisible();
  await expect(
    day(page, '2026-10-21').getByRole('link', { name: /تهنئة بداية الأسبوع/ }),
  ).toBeVisible();

  // Rule B5: the ideas panel; an idea dragged onto a day opens the wizard from it.
  await page.getByRole('button', { name: ar.content.ideas.toggle }).click();
  const idea = page.locator('[data-ideas-panel] li').filter({ hasText: 'فطور الجمعة العائلي' });
  await expect(idea).toBeVisible();
  await idea.dragTo(day(page, '2026-10-23'));
  await expect(page).toHaveURL(/\/content\/new\?.*date=2026-10-23/);
  await expect(page).toHaveURL(/ideaId=/);
  await expect(page.getByLabel(ar.content.form.title)).toHaveValue(
    'فطور الجمعة العائلي بصور من المطبخ',
  );
});

test('the Planning check, My posts at risk, and a client month bar, grid, settings and snippets', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await mockApi(page, { signedIn: true, me: accountManagerMe, content: true });

  // Rule C10: Jasmine's next 14 days, its pillar balance and commitments.
  await page.goto('/content?tab=planning');
  const jasmine = page.locator(`[data-planning-client="${seedIds.jasmine}"]`);
  await expect(jasmine.locator('[data-issue="gap"]').first()).toBeVisible();
  await expect(jasmine.locator('[data-commitments]')).toContainText(
    ar.content.planning.commitments.reel,
  );

  // My posts: the responsible's open posts close to their date and not approved.
  await page.getByRole('tab', { name: ar.content.tabs.mine }).click();
  await expect(
    page.getByRole('region', { name: ar.content.my.sections.atRisk }).getByRole('link').first(),
  ).toBeVisible();

  // The client's Content tab: the balance and commitments, then the Grid.
  await page.goto(`/clients/${seedIds.jasmine}?tab=content`);
  await expect(page.locator('[data-pillar-balance]')).toBeVisible();
  await expect(page.locator('[data-commitments]')).toContainText('/ 8');
  await page.getByRole('button', { name: ar.calendar.views.grid }).click();
  await expect(page.locator('[data-grid] li').first()).toBeVisible();
  await page.getByRole('button', { name: ar.calendar.views.month, exact: true }).click();

  // Settings: targets must sum to 100, then they show against the month's balance.
  await page.getByRole('button', { name: ar.content.clientSettings.open }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('توعية').fill('40');
  await settings.getByLabel('ترويج').fill('30');
  await settings.getByRole('button', { name: ar.common.save }).click();
  await expect(settings.getByText(ar.content.clientSettings.targetsError)).toBeVisible();
  await settings.getByLabel('ترفيه').fill('20');
  await settings.getByLabel('خلف الكواليس').fill('10');
  await expect(settings.getByText(fill(ar.content.clientSettings.sum, { n: '100' }))).toBeVisible();
  await settings.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.content.clientSettings.saved)).toBeVisible();
  await expect(page.locator('[data-pillar-balance]')).toContainText('40%');

  // Snippets: a new hashtag set for the client.
  await page.getByRole('button', { name: ar.content.snippets.open }).click();
  const snippets = page.getByRole('dialog');
  await snippets.getByRole('button', { name: ar.content.snippets.add }).click();
  const form = page.getByRole('dialog', { name: ar.content.snippets.addTitle });
  await form.getByLabel(ar.content.snippets.name).fill('وسوم رمضان');
  await form.getByLabel(ar.content.snippets.body).fill('#رمضان_كريم #الياسمين');
  await form.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.content.snippets.saved)).toBeVisible();
  await expect(snippets.getByText('وسوم رمضان')).toBeVisible();
});

test('content settings: a pillar, Ramadan confirmed, best times', async ({ page }) => {
  test.setTimeout(90_000);
  await mockApi(page, { signedIn: true, content: true });
  await page.goto('/content/settings');
  await expect(
    page.getByRole('heading', { level: 1, name: ar.content.settings.title }),
  ).toBeVisible();

  await page.getByRole('button', { name: ar.content.settings.addPillar }).click();
  const pillar = page.getByRole('dialog');
  await pillar.getByLabel(ar.content.settings.pillarName).fill('تعليمي');
  await pillar.getByRole('button', { name: fill(ar.content.settings.colorN, { n: '5' }) }).click();
  await pillar.getByRole('button', { name: ar.common.save }).click();
  await expect(page.locator('[data-pillars]').getByText('تعليمي')).toBeVisible();

  await page
    .getByRole('button', { name: fill(ar.content.settings.confirmDate, { name: 'رمضان' }) })
    .click();
  const confirm = page.getByRole('dialog');
  await confirm.getByLabel(ar.content.settings.startDate).fill('2027-02-09');
  await confirm.getByRole('button', { name: ar.content.settings.confirmAction }).click();
  await expect(page.getByText(ar.content.settings.dateConfirmed)).toBeVisible();
  await expect(page.locator(`[data-occasion-row]`).filter({ hasText: 'رمضان' })).toContainText(
    ar.content.occasions.confirmed,
  );

  await page
    .getByRole('button', { name: fill(ar.content.times.addWindow, { platform: 'إكس' }) })
    .click();
  await page.getByRole('button', { name: ar.content.settings.saveTimes }).click();
  await expect(page.getByText(ar.content.settings.timesSaved)).toBeVisible();
});

test('any employee adds an idea from the top bar; the content settings are read-only for them', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: employeeMe, content: true });
  await page.goto('/content/settings');
  await expect(page.getByText(ar.content.settings.readOnly)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.content.settings.addPillar })).toHaveCount(0);
  await page.getByRole('button', { name: ar.content.ideas.quick }).click();
  const idea = page.getByRole('dialog');
  await idea.getByLabel(ar.content.ideas.text).fill('مسابقة صور الزبائن في العيد');
  await idea.getByRole('button', { name: ar.content.ideas.addAction }).click();
  await expect(page.getByText(ar.content.ideas.added)).toBeVisible();
});
