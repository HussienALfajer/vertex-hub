import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  accountManagerMe,
  employeeMe,
  financeWithoutTwoFactor,
  manager,
  mockApi,
  notificationFor,
  PROJECTS_TODAY,
  screenshot,
  seedIds,
  VALID_LINK_TOKEN,
} from './fixtures';
import { expect, test } from './test';

// RTL screenshots of every screen in both themes: the design review evidence.
for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('login page', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: false });
      await page.goto('/login');
      await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /dark/ : /^$/);
      await expect(page.getByRole('img', { name: ar.app.brand }).last()).toBeVisible();
      await screenshot(page, testInfo, `login-${colorScheme}`);
    });

    test('app shell', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: true });
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: ar.nav.label });
      await expect(nav.getByRole('link', { name: ar.nav.myTasks })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await screenshot(page, testInfo, `shell-${colorScheme}`);
    });

    test('notifications', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(page, {
        signedIn: true,
        streamed: [
          notificationFor(manager, 5950, {
            type: 'task_mentioned',
            actor: { id: seedIds.layan, name: 'ليان الأحمد' },
            subject: { type: 'task', id: seedIds.autumnMenu },
            data: {
              task: {
                title: 'تصاميم منيو الخريف',
                department: 'design',
                client: 'مطعم الياسمين',
                project: 'الهوية البصرية الجديدة',
              },
              excerpt: 'هل نعتمد الصفحة الأولى؟',
            },
          }),
        ],
      });
      await page.goto('/');
      await expect(page.locator('[data-slot="toast"]')).toBeVisible();
      await screenshot(page, testInfo, `notification-toast-${colorScheme}`);

      await page.getByRole('button', { name: /^الإشعارات، / }).click();
      await expect(page.getByRole('dialog', { name: ar.notifications.title })).toBeVisible();
      await screenshot(page, testInfo, `notification-bell-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.goto('/notifications');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.notifications.title);
      await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible();
      await screenshot(page, testInfo, `notifications-${colorScheme}`);

      await page.goto('/notifications/settings');
      await expect(page.getByRole('switch').first()).toBeVisible();
      await screenshot(page, testInfo, `notification-settings-${colorScheme}`);
    });

    test('empty notifications bell', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: true, notifications: [] });
      await page.goto('/');
      await page.getByRole('button', { name: ar.notifications.bell, exact: true }).click();
      await expect(page.getByText(ar.notifications.emptyTitle)).toBeVisible();
      await screenshot(page, testInfo, `notification-bell-empty-${colorScheme}`);
    });

    test('design system components', async ({ page }, testInfo) => {
      // Tall enough for the whole gallery: the shell's sidebar and top bar are sticky.
      await page.setViewportSize({ width: 1280, height: 2900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/design-system');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.designSystem.title);
      await screenshot(page, testInfo, `design-system-${colorScheme}`);

      await page.getByRole('button', { name: ar.designSystem.openMenu }).click();
      await expect(page.getByRole('menuitem', { name: ar.designSystem.menuEdit })).toBeVisible();
      await screenshot(page, testInfo, `dropdown-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: ar.designSystem.openPopover }).click();
      await expect(page.getByRole('dialog', { name: ar.designSystem.popoverTitle })).toBeVisible();
      await screenshot(page, testInfo, `popover-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: ar.designSystem.openDialog }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(page, testInfo, `dialog-${colorScheme}`);
    });

    test('team directory', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/team');
      await expect(page.getByRole('link', { name: /ليان الأحمد/ })).toBeVisible();
      await screenshot(page, testInfo, `team-${colorScheme}`);
    });

    test('user profile (manager view)', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: true });
      await page.goto(`/team/${seedIds.layan}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('ليان الأحمد');
      await screenshot(page, testInfo, `user-profile-${colorScheme}`);
      await page.getByRole('button', { name: ar.users.profile.actions }).click();
      await expect(page.getByRole('menuitem', { name: ar.users.profile.archive })).toBeVisible();
      await screenshot(page, testInfo, `user-actions-${colorScheme}`);
    });

    test('new user and the activation link', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1200 });
      await mockApi(page, { signedIn: true });
      await page.goto('/team/new');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.users.new.title);
      await page.getByLabel(ar.users.form.name).fill('هالة ناصر');
      await page.getByLabel(ar.users.form.email).fill('hala@vertex.example');
      await page.getByRole('combobox', { name: ar.users.form.primaryDepartment }).click();
      await page.getByRole('option', { name: 'التصميم' }).click();
      await page.getByRole('checkbox', { name: ar.roles.account_manager }).click();
      await screenshot(page, testInfo, `new-user-${colorScheme}`);
      await page.getByRole('button', { name: ar.users.form.create }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(page, testInfo, `new-user-link-${colorScheme}`);
    });

    test('departments', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await mockApi(page, { signedIn: true });
      await page.goto('/departments');
      await expect(page.getByRole('heading', { name: 'العمليات الداخلية' })).toBeVisible();
      await screenshot(page, testInfo, `departments-${colorScheme}`);
      await page.goto(`/departments/${seedIds.design}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('التصميم');
      await screenshot(page, testInfo, `department-${colorScheme}`);
    });

    test('my account', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1100 });
      await mockApi(page, { signedIn: true });
      await page.goto('/account');
      await expect(page.getByRole('heading', { name: ar.account.twoFactor.title })).toBeVisible();
      await screenshot(page, testInfo, `account-${colorScheme}`);
    });

    test('activation', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: false });
      await page.goto(`/activate#token=${VALID_LINK_TOKEN}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.activate.title);
      await screenshot(page, testInfo, `activate-${colorScheme}`);
    });

    test('two-factor setup', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: true, me: financeWithoutTwoFactor });
      await page.goto('/setup-two-factor');
      await page.getByLabel(ar.twoFactorSetup.password).fill('my-password-123');
      await page.getByRole('button', { name: ar.twoFactorSetup.start }).click();
      await expect(page.getByRole('img', { name: ar.twoFactorSetup.qrLabel })).toBeVisible();
      await screenshot(page, testInfo, `two-factor-scan-${colorScheme}`);
      await page.getByRole('textbox', { name: ar.twoFactorSetup.code }).pressSequentially('123456');
      await expect(page.getByText('7KQ2M9XA')).toBeVisible();
      await screenshot(page, testInfo, `two-factor-codes-${colorScheme}`);
    });

    test('sign-in code step', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: false, acceptPassword: 'pw', twoFactorOnSignIn: true });
      await page.goto('/login');
      await page.getByLabel(ar.login.email).fill('sara@vertex.example');
      await page.getByLabel(ar.login.password).fill('pw');
      await page.getByRole('button', { name: ar.login.submit }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.login.twoFactor.title);
      await screenshot(page, testInfo, `login-code-${colorScheme}`);
    });

    test('client list', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/clients');
      await expect(page.getByRole('link', { name: /مطعم الياسمين/ })).toBeVisible();
      await screenshot(page, testInfo, `clients-${colorScheme}`);
    });

    test('new client', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1100 });
      await mockApi(page, { signedIn: true });
      await page.goto('/clients/new');
      await page.getByLabel(ar.clients.form.tradeName).fill('مخبز السنابل');
      await page.getByLabel(ar.clients.form.sector, { exact: true }).fill('مخابز');
      await page.getByRole('combobox', { name: ar.clients.form.accountManager }).click();
      await page.getByRole('option', { name: 'ليان الأحمد' }).click();
      await expect(page.getByRole('complementary', { name: ar.clients.new.preview })).toContainText(
        'ليان الأحمد',
      );
      await screenshot(page, testInfo, `new-client-${colorScheme}`);
    });

    test('client profile tabs', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/clients/${seedIds.jasmine}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مطعم الياسمين');
      await screenshot(page, testInfo, `client-contacts-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1300 });
      await page.getByRole('tab', { name: ar.clients.profile.tabs.brandKit }).click();
      await expect(page.getByText('#C9A45C')).toBeVisible();
      await screenshot(page, testInfo, `client-brand-kit-${colorScheme}`);

      await page.getByRole('button', { name: ar.clients.brandKit.edit }).click();
      await expect(
        page.getByRole('heading', { name: ar.clients.brandKit.form.title }),
      ).toBeVisible();
      await screenshot(page, testInfo, `client-brand-kit-form-${colorScheme}`);
      await page.getByRole('button', { name: ar.common.cancel }).click();

      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.getByRole('tab', { name: ar.clients.profile.tabs.platforms }).click();
      await expect(page.getByText('فرع المزة')).toBeVisible();
      await screenshot(page, testInfo, `client-platforms-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1300 });
      await page.getByRole('tab', { name: ar.clients.profile.tabs.communication }).click();
      await expect(page.getByText(/خطة محتوى أكتوبر/)).toBeVisible();
      await screenshot(page, testInfo, `client-communication-${colorScheme}`);
    });

    test('client profile (account manager view)', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto('/clients');
      await expect(page.getByRole('button', { name: ar.clients.filters.mine })).toBeVisible();
      await expect(page.getByRole('link', { name: ar.clients.newClient })).toHaveCount(0);
      await page.goto(`/clients/${seedIds.jasmine}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مطعم الياسمين');
      await page.getByRole('button', { name: ar.clients.profile.edit }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByLabel(ar.clients.form.tradeName)).toBeVisible();
      // Rule 5: the account manager and the healthcare flag are for scope-all holders only.
      await expect(
        dialog.getByRole('combobox', { name: ar.clients.form.accountManager }),
      ).toHaveCount(0);
      await expect(dialog.getByRole('switch')).toHaveCount(0);
      await screenshot(page, testInfo, `client-account-manager-${colorScheme}`);
    });

    test('project list', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto('/projects');
      await expect(page.getByRole('link', { name: /الهوية البصرية الجديدة/ })).toBeVisible();
      await screenshot(page, testInfo, `projects-${colorScheme}`);
    });

    test('new project', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1900 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto(`/projects/new?clientId=${seedIds.jasmine}`);
      await page.getByLabel(ar.projects.form.name).fill('موقع الحجوزات');
      await page.getByRole('combobox', { name: ar.projects.form.projectManager }).click();
      await page.getByRole('option', { name: /كريم الزين/ }).click();
      await page.getByLabel(ar.projects.form.dueDate).fill('2026-12-20');
      await page
        .getByLabel(ar.projects.form.milestoneInstallment.replace('{{position}}', '1'))
        .fill('1500');
      await expect(
        page.getByRole('complementary', { name: ar.projects.new.preview }),
      ).toContainText('كريم الزين');
      await screenshot(page, testInfo, `new-project-${colorScheme}`);
    });

    test('project page tabs', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1400 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto(`/projects/${seedIds.identityProject}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('الهوية البصرية الجديدة');
      await expect(page.getByText(ar.projects.milestones.current).first()).toBeVisible();
      await screenshot(page, testInfo, `project-milestones-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.getByRole('tab', { name: ar.projects.page.tabs.extraWork }).click();
      await expect(page.getByText('تصميم إضافي لإعلان العيد')).toBeVisible();
      await screenshot(page, testInfo, `project-extra-work-${colorScheme}`);

      await page.goto(`/projects/${seedIds.summerMenu}`);
      await expect(page.getByText(ar.projects.page.completedTitle)).toBeVisible();
      await screenshot(page, testInfo, `project-completed-${colorScheme}`);
    });

    test('project page (employee view)', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: employeeMe });
      await page.goto(`/projects/${seedIds.clinicSite}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('موقع العيادة');
      await expect(page.getByRole('button', { name: ar.common.edit })).toHaveCount(0);
      await screenshot(page, testInfo, `project-employee-${colorScheme}`);
    });

    test('client profile projects tab', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto(`/clients/${seedIds.jasmine}?tab=projects`);
      await expect(page.getByRole('link', { name: /حملة الافتتاح/ })).toBeVisible();
      await screenshot(page, testInfo, `client-projects-${colorScheme}`);
    });

    test('retainer list', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto('/retainers');
      await expect(page.getByRole('link', { name: /إدارة السوشيال ميديا/ })).toBeVisible();
      await screenshot(page, testInfo, `retainers-${colorScheme}`);
    });

    test('new retainer', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1900 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto(`/retainers/new?clientId=${seedIds.jasmine}`);
      await page.getByLabel(ar.retainers.form.name).fill('المحتوى الشهري');
      await page.getByLabel(ar.retainers.form.monthlyFee).fill('1500');
      for (const kind of [ar.retainers.kinds.design, ar.retainers.kinds.reel]) {
        await page.getByRole('button', { name: kind, exact: true }).click();
      }
      await page.getByLabel(ar.retainers.lines.quantity.replace('{{position}}', '1')).fill('12');
      await expect(
        page.getByRole('complementary', { name: ar.retainers.new.preview }),
      ).toContainText('1,500.00');
      await screenshot(page, testInfo, `new-retainer-${colorScheme}`);
    });

    test('retainer page tabs', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1500 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto(`/retainers/${seedIds.socialRetainer}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('إدارة السوشيال ميديا');
      const designs = page
        .getByRole('list', { name: ar.retainers.cycle.lines })
        .getByRole('listitem')
        .filter({ hasText: ar.retainers.kinds.design });
      await designs.getByRole('button', { name: ar.retainers.cycle.adjustments_one }).click();
      await screenshot(page, testInfo, `retainer-this-month-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.getByRole('tab', { name: ar.retainers.page.tabs.history }).click();
      await expect(page.getByText(ar.retainers.history.title).first()).toBeVisible();
      await screenshot(page, testInfo, `retainer-history-${colorScheme}`);

      await page.getByRole('button', { name: /آب/ }).click();
      await expect(page.getByRole('dialog').getByText('تغطية افتتاح الفرع')).toBeVisible();
      await screenshot(page, testInfo, `retainer-cycle-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.getByRole('tab', { name: ar.projects.page.tabs.extraWork }).click();
      await expect(page.getByText('ريل إضافي لافتتاح الفرع الثاني')).toBeVisible();
      await screenshot(page, testInfo, `retainer-extra-work-${colorScheme}`);

      await page.goto(`/retainers/${seedIds.adsRetainer}`);
      await expect(page.getByText(ar.retainers.cycle.none.pausedTitle)).toBeVisible();
      await screenshot(page, testInfo, `retainer-paused-${colorScheme}`);
    });

    test('retainer page (employee view)', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1300 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: employeeMe });
      await page.goto(`/retainers/${seedIds.socialRetainer}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('إدارة السوشيال ميديا');
      await expect(page.getByRole('button', { name: ar.common.edit })).toHaveCount(0);
      await screenshot(page, testInfo, `retainer-employee-${colorScheme}`);
    });

    test('client profile retainers tab', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto(`/clients/${seedIds.jasmine}?tab=retainers`);
      await expect(page.getByRole('link', { name: /إدارة السوشيال ميديا/ })).toBeVisible();
      await screenshot(page, testInfo, `client-retainers-${colorScheme}`);
    });

    test('audit log', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/audit');
      await page.getByRole('button', { name: ar.audit.showDetails }).first().click();
      await expect(page.getByRole('cell', { name: ar.audit.fields.manager })).toBeVisible();
      await screenshot(page, testInfo, `audit-${colorScheme}`);
    });

    test('my tasks', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1600 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto('/tasks');
      await expect(
        page.getByRole('region', { name: ar.tasks.my.sections.overdue }).getByRole('link'),
      ).toHaveText('تصاميم منيو الخريف');
      await expect(
        page.getByRole('region', { name: ar.tasks.my.sections.requestedByMe }),
      ).toBeVisible();
      await screenshot(page, testInfo, `my-tasks-${colorScheme}`);
    });

    test('task list', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto('/tasks/list');
      await expect(page.getByRole('link', { name: 'بوستات أسبوع الافتتاح' })).toBeVisible();
      await screenshot(page, testInfo, `task-list-${colorScheme}`);
    });

    test('new task, both modes', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1900 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto(`/tasks/new?clientId=${seedIds.jasmine}`);
      await page.getByRole('combobox', { name: ar.tasks.form.assignee }).click();
      await page.getByRole('option', { name: 'ليان الأحمد' }).click();
      await page.getByLabel(ar.tasks.form.title).fill('تصميم بانر حملة رمضان');
      await page.getByLabel(ar.tasks.form.dueDate).fill('2026-10-14');
      await page.getByRole('switch', { name: ar.tasks.form.clientRequest }).click();
      await page.getByRole('button', { name: ar.tasks.requestScopes.out_of_scope }).click();
      await expect(page.getByText(ar.tasks.form.outOfScopeTitle)).toBeVisible();
      await screenshot(page, testInfo, `new-task-assign-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1300 });
      await page.goto('/tasks/new?mode=request');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.tasks.new.requestTitle);
      await screenshot(page, testInfo, `new-task-request-${colorScheme}`);
    });

    test('task page', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 2000 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto(`/tasks/${seedIds.openingPosts}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('بوستات أسبوع الافتتاح');
      await expect(page.getByText('سأراجع العقد وأرد اليوم.')).toBeVisible();
      await expect(page.getByRole('button', { name: ar.tasks.revisions.decide })).toBeVisible();
      await screenshot(page, testInfo, `task-page-${colorScheme}`);
    });

    test('task files, preview and upload', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1600 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: manager });
      await page.goto(`/tasks/${seedIds.autumnMenu}`);
      const files = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { level: 2, name: ar.tasks.files.title }) });
      await files.getByRole('button', { name: ar.files.versions_two }).click();
      // Thumbnails are decorative (`alt=""`): the cover and the dishes photo.
      await expect(files.locator('img')).toHaveCount(2);
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      await files.scrollIntoViewIfNeeded();
      await screenshot(page, testInfo, `task-files-${colorScheme}`);

      await files.getByRole('button', { name: 'عاين صور الأطباق' }).click();
      await expect(
        page.getByRole('dialog', { name: 'صور الأطباق' }).getByRole('img', { name: 'صور الأطباق' }),
      ).toBeVisible();
      await screenshot(page, testInfo, `file-preview-image-${colorScheme}`);
      await page.keyboard.press('ArrowRight');
      await expect(
        page.getByRole('dialog', { name: 'دليل الهوية' }).locator('iframe'),
      ).toBeVisible();
      await screenshot(page, testInfo, `file-preview-pdf-${colorScheme}`);
      await page.keyboard.press('Escape');

      // An upload that stays under way next to one refused before sending.
      await page.route('**/api/files/uploads', () => {});
      await files.getByRole('button', { name: ar.tasks.files.addDeliverable }).click();
      const dialog = page.getByRole('dialog', { name: ar.tasks.files.addDeliverableTitle });
      await dialog.locator('input[type=file]').setInputFiles([
        { name: 'menu-reel.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048) },
        { name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.alloc(16) },
      ]);
      await expect(dialog.getByRole('progressbar')).toBeVisible();
      await expect(dialog.getByRole('alert')).toHaveText(ar.errors.FILE_TYPE_BLOCKED);
      await screenshot(page, testInfo, `file-upload-${colorScheme}`);
    });

    test('client files, brand files and documents', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1600 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: manager });
      await page.goto(`/clients/${seedIds.jasmine}?tab=files`);
      await expect(page.getByText(/ملفات هذا العميل/)).toBeVisible();
      await expect(page.getByText('عقد الخدمات 2026')).toBeVisible();
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      await screenshot(page, testInfo, `client-files-${colorScheme}`);

      // The uploaded files sit under the kit: the whole tab in one shot.
      await page.setViewportSize({ width: 1280, height: 2000 });
      await page.getByRole('tab', { name: ar.clients.profile.tabs.brandKit }).click();
      await expect(page.getByText('شعار الياسمين', { exact: true })).toBeVisible();
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      await screenshot(page, testInfo, `client-brand-files-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.goto(`/projects/${seedIds.identityProject}?tab=documents`);
      await expect(page.getByText('محضر انطلاق المشروع', { exact: true })).toBeVisible();
      await screenshot(page, testInfo, `project-documents-${colorScheme}`);

      await page.goto(`/retainers/${seedIds.socialRetainer}?tab=documents`);
      await expect(page.getByText('ملحق العقد الشهري', { exact: true })).toBeVisible();
      await screenshot(page, testInfo, `retainer-documents-${colorScheme}`);
    });

    test('task board', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto('/tasks/board');
      await expect(page.getByRole('link', { name: 'بوستات أسبوع الافتتاح' })).toBeVisible();
      await screenshot(page, testInfo, `task-board-${colorScheme}`);
    });

    test('workload', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto('/tasks/workload');
      await expect(page.getByRole('row', { name: /ليان الأحمد/ })).toBeVisible();
      await screenshot(page, testInfo, `workload-${colorScheme}`);
    });

    test('project tasks tab', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1300 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto(`/projects/${seedIds.identityProject}?tab=tasks`);
      await expect(page.getByRole('link', { name: 'تصاميم منيو الخريف' })).toBeVisible();
      await screenshot(page, testInfo, `project-tasks-${colorScheme}`);
    });

    test('client open tasks tab', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto(`/clients/${seedIds.jasmine}?tab=tasks`);
      await expect(page.getByRole('link', { name: 'بوستات أسبوع الافتتاح' })).toBeVisible();
      await screenshot(page, testInfo, `client-tasks-${colorScheme}`);
    });

    test('templates list', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/templates');
      await expect(page.getByRole('link', { name: 'موقع إلكتروني' })).toBeVisible();
      await screenshot(page, testInfo, `templates-${colorScheme}`);
    });

    test('project template page', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 2400 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/templates/${seedIds.websiteTemplate}`);
      await expect(page.getByRole('heading', { name: 'تصميم الواجهات' })).toBeVisible();
      await screenshot(page, testInfo, `template-project-${colorScheme}`);

      await page
        .getByRole('button', { name: ar.templates.editStep.replace('{{title}}', 'تصميم الواجهات') })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(page, testInfo, `template-step-${colorScheme}`);
    });

    test('new template', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1300 });
      await mockApi(page, { signedIn: true });
      await page.goto('/templates/new');
      await page.getByLabel(ar.templates.form.name).fill('شعار سريع');
      await page.getByRole('button', { name: ar.templates.addStage }).click();
      await page.getByLabel(ar.templates.stageName.replace('{{position}}', '1')).fill('التصميم');
      await page
        .getByRole('button', { name: ar.templates.addStepTo.replace('{{stage}}', 'التصميم') })
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(ar.templates.step.title).fill('مسودات الشعار');
      await dialog.getByRole('combobox', { name: ar.templates.step.department }).click();
      await page.getByRole('option', { name: 'التصميم' }).click();
      await dialog.getByLabel(ar.templates.step.dueDay).fill('3');
      await dialog.getByRole('button', { name: ar.templates.step.add }).click();
      await expect(page.getByRole('heading', { name: 'مسودات الشعار' })).toBeVisible();
      await screenshot(page, testInfo, `template-new-${colorScheme}`);
    });

    test('monthly template page', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1700 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/templates/${seedIds.monthlyTemplate}`);
      await expect(page.getByText(ar.templates.warningsTitle)).toBeVisible();
      await screenshot(page, testInfo, `template-monthly-${colorScheme}`);
    });

    test('new project with a template', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1900 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto(`/projects/new?clientId=${seedIds.jasmine}`);
      await page.getByLabel(ar.projects.form.name).fill('موقع الحجوزات');
      await page.getByRole('combobox', { name: ar.templates.picker.project }).click();
      await page.getByRole('option', { name: 'موقع إلكتروني' }).click();
      await expect(
        page.getByLabel(ar.projects.form.milestoneDue.replace('{{position}}', '1')),
      ).toHaveValue('2026-10-14');
      await screenshot(page, testInfo, `project-new-template-${colorScheme}`);
    });

    test('generate dialog for a project', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto(
        `/projects/${seedIds.identityProject}?tab=tasks&generate=${seedIds.websiteTemplate}`,
      );
      const preview = page
        .getByRole('dialog', { name: /هوية/ })
        .getByRole('region', { name: ar.templates.generate.preview });
      await expect(preview.getByText('تصميم الواجهات', { exact: true })).toBeVisible();
      await screenshot(page, testInfo, `template-generate-project-${colorScheme}`);
    });

    test('retainer month generated from its template', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1600 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto(`/retainers/${seedIds.socialRetainer}`);
      const panel = page.getByRole('region', { name: ar.templates.retainer.title });
      await panel.getByRole('button', { name: ar.templates.retainer.generate }).click();
      const dialog = page.getByRole('dialog', { name: ar.templates.generate.cycleTitle });
      await expect(dialog.getByText('تصميم 12')).toBeVisible();
      await screenshot(page, testInfo, `template-generate-cycle-${colorScheme}`);

      await dialog.getByRole('button', { name: /18/ }).click();
      await expect(dialog).toBeHidden();
      // Four more designs (two made by hand already): the line offers two missing tasks.
      const designs = page.getByRole('listitem').filter({ hasText: ar.retainers.kinds.design });
      await designs
        .getByRole('button', {
          name: ar.retainers.cycle.lineActions.replace('{{name}}', ar.retainers.kinds.design),
        })
        .click();
      await page.getByRole('menuitem', { name: ar.retainers.cycle.changeCommitted }).click();
      const committed = page.getByRole('dialog', {
        name: ar.retainers.cycle.committedTitle.replace('{{name}}', ar.retainers.kinds.design),
      });
      await committed.getByLabel(ar.retainers.cycle.committed).fill('16');
      await committed.getByLabel(ar.retainers.cycle.reason).fill('حملة إضافية');
      await committed.getByRole('button', { name: ar.common.save }).click();
      await expect(
        designs.getByRole('button', { name: ar.templates.lines.generateMissing_two }),
      ).toBeVisible();
      await screenshot(page, testInfo, `retainer-month-template-${colorScheme}`);
    });
  });
}

test('the theme toggle switches and remembers the theme', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).not.toHaveClass(/dark/);

  await page.getByRole('button', { name: ar.theme.toDark }).click();
  await expect(html).toHaveClass(/dark/);

  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await page.getByRole('button', { name: ar.theme.toLight }).click();
  await expect(html).not.toHaveClass(/dark/);
});

test('phone layout opens the navigation in a sheet', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, { signedIn: true });
  await page.goto('/');
  await page.getByRole('button', { name: ar.nav.open }).click();
  const nav = page.getByRole('dialog').getByRole('navigation', { name: ar.nav.label });
  await expect(nav).toBeVisible();
  await screenshot(page, testInfo, 'shell-phone-nav');
  // The developer gallery is not listed in a production build.
  await expect(nav.getByRole('link', { name: ar.nav.designSystem })).toHaveCount(0);
  await nav.getByRole('link', { name: ar.nav.audit }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.audit.title);
});

test('phone navigation scrolls to its last link on a short screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 560 });
  await mockApi(page, { signedIn: true });
  await page.goto('/');
  await page.getByRole('button', { name: ar.nav.open }).click();
  const nav = page.getByRole('dialog').getByRole('navigation', { name: ar.nav.label });
  const last = nav.getByRole('link', { name: ar.nav.audit });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
});

test('a long dialog scrolls instead of losing its buttons on a short phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await mockApi(page, { signedIn: true });
  await page.goto(`/clients/${seedIds.jasmine}`);
  await page.getByRole('button', { name: ar.clients.contacts.add }).first().click();
  const dialog = page.getByRole('dialog');
  const box = await dialog.boundingBox();
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(600);
  const save = dialog.getByRole('button', { name: ar.common.save });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
});
