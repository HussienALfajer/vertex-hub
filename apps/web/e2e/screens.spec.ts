import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  ANNOUNCEMENTS_NOW,
  accountManagerMe,
  announcementIds,
  attendanceCode,
  CONTENT_LINK_TOKEN,
  catalogNotificationsSeed,
  DEVICES_NOW,
  departmentManagerMe,
  EXPIRED_LINK_TOKEN,
  employeeMe,
  financeMe,
  financeWithoutTwoFactor,
  HR_NOW,
  manager,
  managerWithoutMoney,
  medicalReviewerMe,
  mockApi,
  notificationFor,
  OPEN_LINK_TOKEN,
  operationsManagerMe,
  PROJECTS_TODAY,
  plainAccountManagerMe,
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
      await expect(nav.getByRole('link', { name: ar.nav.home })).toHaveAttribute(
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
      await expect(page.getByText(ar.notifications.empty.needs_you.title)).toBeVisible();
      await screenshot(page, testInfo, `notification-bell-empty-${colorScheme}`);
    });

    test('design system components', async ({ page }, testInfo) => {
      // Tall enough for the whole gallery: the shell's sidebar and top bar are sticky.
      await page.setViewportSize({ width: 1280, height: 2900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/design-system');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.designSystem.title);
      await screenshot(page, testInfo, `design-system-${colorScheme}`);
      await page.getByRole('heading', { name: ar.designSystem.calendar }).scrollIntoViewIfNeeded();
      await screenshot(page, testInfo, `design-system-calendar-${colorScheme}`);
      await page.getByRole('heading', { name: ar.designSystem.richText }).scrollIntoViewIfNeeded();
      await screenshot(page, testInfo, `design-system-rich-text-${colorScheme}`);

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

    for (const [width, height, size] of [
      [1280, 900, 'desktop'],
      [390, 844, 'phone'],
    ] as const) {
      // F16 screen 1: the install card on the home page and the guide.
      test(`installing the app (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await mockApi(page, { signedIn: true });
        await page.goto('/');
        await page.evaluate(() => {
          const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
            prompt: async () => undefined,
            userChoice: new Promise(() => undefined),
          });
          window.dispatchEvent(offer);
        });
        await expect(page.getByText(ar.pwa.install.cardTitle)).toBeVisible();
        await screenshot(page, testInfo, `install-card-${size}-${colorScheme}`);

        await page.goto('/install');
        await expect(page.getByRole('heading', { name: ar.pwa.guide.title })).toBeVisible();
        await screenshot(page, testInfo, `install-guide-${size}-${colorScheme}`);
      });

      // F16 rule A5: the offline banner, with the actions turned off.
      test(`offline (${size})`, async ({ page, context }, testInfo) => {
        await page.setViewportSize({ width, height });
        await mockApi(page, { signedIn: true });
        await page.goto('/');
        await expect(page.getByRole('heading', { name: ar.dashboard.title })).toBeVisible();
        await context.setOffline(true);
        await expect(page.getByText(ar.pwa.offline.hint)).toBeVisible();
        await screenshot(page, testInfo, `offline-${size}-${colorScheme}`);
        await context.setOffline(false);
      });
    }

    for (const [width, height, size] of [
      [1280, 900, 'desktop'],
      [390, 844, 'phone'],
    ] as const) {
      // F16 screens 3–4: the bell's inboxes and the page's tabs, with snooze and "Handled by".
      test(`notification inboxes (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await mockApi(page, { signedIn: true });
        await page.goto('/');
        await page.getByRole('button', { name: /^الإشعارات/ }).click();
        const panel = page.getByRole('dialog', { name: ar.notifications.title });
        await expect(panel.getByRole('listitem').first()).toBeVisible();
        await screenshot(page, testInfo, `notification-bell-needs-you-${size}-${colorScheme}`);
        await panel.getByRole('tab', { name: ar.notifications.inboxes.fyi }).click();
        await expect(panel.getByText(/تولّاه/)).toBeVisible();
        await screenshot(page, testInfo, `notification-bell-fyi-${size}-${colorScheme}`);
        await panel
          .getByRole('listitem')
          .first()
          .getByRole('button', { name: ar.notifications.snooze.later })
          .click();
        await expect(page.getByRole('menuitem').first()).toBeVisible();
        await screenshot(page, testInfo, `notification-snooze-${size}-${colorScheme}`);
        await page.keyboard.press('Escape');

        for (const inbox of ['done', 'snoozed'] as const) {
          await page.goto(`/notifications?inbox=${inbox}`);
          await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible();
          await screenshot(page, testInfo, `notifications-${inbox}-${size}-${colorScheme}`);
        }
      });

      // F16 screen 6: the channel policy and the push delivery log.
      // F16 part C: the catalog's new types, with a meeting's "Join" link.
      test(`notification catalog (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await mockApi(page, { signedIn: true, notifications: catalogNotificationsSeed() });
        await page.goto('/notifications?inbox=fyi');
        await expect(page.getByRole('link', { name: ar.notifications.join })).toBeVisible();
        await screenshot(page, testInfo, `notifications-catalog-${size}-${colorScheme}`);
      });

      test(`notification policy (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await mockApi(page, { signedIn: true, me: manager });
        await page.goto('/admin/notification-policy');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          ar.notifications.policy.title,
        );
        await expect(page.getByRole('table').first()).toBeVisible();
        await screenshot(page, testInfo, `notification-policy-${size}-${colorScheme}`);
        await page.goto('/admin/notification-policy?tab=deliveries');
        await expect(page.getByText('410 Gone')).toBeVisible();
        await screenshot(page, testInfo, `push-deliveries-${size}-${colorScheme}`);
      });

      // F16 screen 8: the follow button on the task page.
      test(`follow button (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await mockApi(page, { signedIn: true, me: manager });
        await page.goto(`/tasks/${seedIds.autumnMenu}`);
        await expect(
          page.getByRole('button', { name: new RegExp(ar.notifications.follow.follow) }),
        ).toBeVisible();
        await screenshot(page, testInfo, `task-follow-${size}-${colorScheme}`);
      });

      // F17 part A: People, the employee file tabs with and without pay, and My file.
      test(`employee files (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await page.clock.setFixedTime(new Date(HR_NOW));
        const api = await mockApi(page, { signedIn: true, me: manager });
        await page.goto('/hr/people');
        await expect(page.getByRole('link', { name: /كريم الزين/ })).toBeVisible();
        await screenshot(page, testInfo, `hr-people-${size}-${colorScheme}`);

        await page.goto(`/hr/people/${seedIds.karim}`);
        await expect(page.getByText('01020304050')).toBeVisible();
        await screenshot(page, testInfo, `hr-file-personal-${size}-${colorScheme}`);
        await page.getByRole('tab', { name: ar.hr.file.tabs.contract }).click();
        await expect(page.getByText(ar.hr.fields.remoteWeekdays)).toBeVisible();
        await screenshot(page, testInfo, `hr-file-contract-${size}-${colorScheme}`);
        await page.getByRole('tab', { name: ar.hr.file.tabs.pay }).click();
        await expect(page.getByText(ar.hr.salary.history)).toBeVisible();
        await screenshot(page, testInfo, `hr-file-pay-${size}-${colorScheme}`);
        await page.getByRole('button', { name: ar.hr.salary.add }).click();
        await expect(page.getByRole('dialog', { name: ar.hr.salary.addTitle })).toBeVisible();
        await screenshot(page, testInfo, `hr-salary-dialog-${size}-${colorScheme}`);
        await page.keyboard.press('Escape');

        await page.goto(`/hr/people/${seedIds.layan}`);
        await expect(page.getByText(/آخر يوم عمل/)).toBeVisible();
        await screenshot(page, testInfo, `hr-file-leaving-${size}-${colorScheme}`);

        // Without pay: the Internal Operations manager.
        api.signInAs(operationsManagerMe);
        await page.goto(`/hr/people/${seedIds.karim}`);
        await expect(page.getByRole('tab', { name: ar.hr.file.tabs.personal })).toBeVisible();
        await expect(page.getByRole('tab', { name: ar.hr.file.tabs.pay })).toHaveCount(0);
        await screenshot(page, testInfo, `hr-file-no-pay-${size}-${colorScheme}`);

        api.signInAs(employeeMe);
        await page.goto('/me/file?tab=pay');
        await expect(page.getByText(ar.hr.salary.history)).toBeVisible();
        await screenshot(page, testInfo, `hr-my-file-${size}-${colorScheme}`);
      });

      // F17 part B: HR settings (rules, schedules, holidays) and holidays on the calendar.
      test(`HR settings (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await page.clock.setFixedTime(new Date(HR_NOW));
        const api = await mockApi(page, { signedIn: true, me: manager, holidays: true });
        await page.goto('/hr/settings');
        await expect(page.getByLabel(ar.hr.settings.fields.graceMinutes)).toHaveValue('10');
        await screenshot(page, testInfo, `hr-settings-rules-${size}-${colorScheme}`);

        await page.getByRole('tab', { name: ar.hr.settings.tabs.schedules }).click();
        await expect(page.locator('[data-schedule="دوام مرن"]')).toBeVisible();
        await screenshot(page, testInfo, `hr-schedules-${size}-${colorScheme}`);
        await page.getByRole('button', { name: ar.hr.schedules.add }).click();
        await expect(page.getByRole('dialog', { name: ar.hr.schedules.addTitle })).toBeVisible();
        await screenshot(page, testInfo, `hr-schedule-dialog-${size}-${colorScheme}`);
        await page.keyboard.press('Escape');

        await page.getByRole('tab', { name: ar.hr.settings.tabs.holidays }).click();
        await expect(page.locator('[data-holiday="عيد الأضحى"]')).toBeVisible();
        await screenshot(page, testInfo, `hr-holidays-${size}-${colorScheme}`);
        await page.getByRole('button', { name: ar.hr.holidays.add }).click();
        await expect(page.getByRole('dialog', { name: ar.hr.holidays.addTitle })).toBeVisible();
        await screenshot(page, testInfo, `hr-holiday-dialog-${size}-${colorScheme}`);
        await page.keyboard.press('Escape');

        api.signInAs(employeeMe);
        await page.goto('/calendar?date=2026-05-26');
        await expect(page.getByText('عيد الأضحى').filter({ visible: true }).first()).toBeVisible();
        await screenshot(page, testInfo, `calendar-holiday-${size}-${colorScheme}`);
      });

      // F17 part B: My attendance, the request dialog, Approvals, a request, the Leave tab of a
      // file, "On leave" on the calendar and the leave warning on a task.
      test(`leave (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await page.clock.setFixedTime(new Date(HR_NOW));
        const api = await mockApi(page, { signedIn: true, me: employeeMe, leave: true });
        const r = ar.hr.requests;
        await page.goto('/me/attendance?tab=balances');
        await expect(page.locator('[data-leave-type="annual"]')).toBeVisible();
        await screenshot(page, testInfo, `hr-my-balances-${size}-${colorScheme}`);
        await page.getByRole('button', { name: r.new.title }).click();
        const dialog = page.getByRole('dialog', { name: r.new.title });
        await dialog.getByLabel(r.fields.startsOn, { exact: true }).fill('2026-10-22');
        await dialog.getByLabel(r.fields.endsOn, { exact: true }).fill('2026-10-22');
        await expect(dialog.getByText(r.warnings.short_notice)).toBeVisible();
        await screenshot(page, testInfo, `hr-request-dialog-${size}-${colorScheme}`);
        await page.keyboard.press('Escape');
        await page.getByRole('tab', { name: ar.hr.attendance.tabs.requests }).click();
        await expect(page.locator('[data-request-id]').first()).toBeVisible();
        await screenshot(page, testInfo, `hr-my-requests-${size}-${colorScheme}`);

        api.signInAs(manager);
        await page.goto('/hr/approvals');
        await expect(page.locator('[data-request-id]')).toHaveCount(3);
        await screenshot(page, testInfo, `hr-approvals-${size}-${colorScheme}`);
        await page.locator('[data-request-id]').last().getByRole('link').click();
        await expect(page.getByText(r.work.title)).toBeVisible();
        await screenshot(page, testInfo, `hr-request-${size}-${colorScheme}`);
        await page.getByRole('button', { name: r.decide.reject }).click();
        await expect(page.getByRole('dialog', { name: r.decide.rejectTitle })).toBeVisible();
        await screenshot(page, testInfo, `hr-request-decision-${size}-${colorScheme}`);
        await page.keyboard.press('Escape');

        await page.goto(`/hr/people/${seedIds.karim}?tab=leave`);
        await expect(page.locator('[data-leave-type="sick"]')).toBeVisible();
        await screenshot(page, testInfo, `hr-file-leave-${size}-${colorScheme}`);

        await page.goto('/calendar?date=2026-10-25');
        await expect(
          page.locator('[data-leave-id]').filter({ visible: true }).first(),
        ).toBeVisible();
        await screenshot(page, testInfo, `calendar-leave-${size}-${colorScheme}`);

        await page.goto(`/tasks/${seedIds.dishShoot}`);
        await page.getByRole('button', { name: ar.tasks.actions.more }).click();
        await page.getByRole('menuitem', { name: ar.tasks.actions.edit }).click();
        const edit = page.getByRole('dialog', { name: ar.tasks.edit.title });
        await edit.getByLabel(ar.tasks.form.dueDate).fill('2026-10-26');
        await edit.getByRole('button', { name: ar.common.save }).click();
        await expect(
          page.getByRole('alertdialog', { name: ar.tasks.leaveWarning.title }),
        ).toBeVisible();
        await screenshot(page, testInfo, `task-leave-warning-${size}-${colorScheme}`);
      });

      // F17 part C: My attendance (Today, the month), the entrance code's page, the Today board,
      // items in Approvals, an item and its decision, the file's Attendance tab, the entrance
      // screens in HR settings, and the entrance screen itself.
      test(`attendance (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await page.clock.setFixedTime(new Date(HR_NOW));
        const api = await mockApi(page, { signedIn: true, me: employeeMe });
        const a = ar.hr.attendance;
        await page.goto('/me/attendance');
        await expect(page.getByTestId('today-card').getByTestId('today-notice')).toBeVisible();
        await expect(page.getByTestId('passkey-card')).toBeVisible();
        await screenshot(page, testInfo, `hr-my-today-${size}-${colorScheme}`);
        await page.goto('/me/attendance?tab=month');
        await expect(page.locator('[data-item]').first()).toBeVisible();
        await screenshot(page, testInfo, `hr-my-month-${size}-${colorScheme}`);
        const r = ar.hr.requests;
        await page.getByRole('button', { name: r.new.title }).first().click();
        const dialog = page.getByRole('dialog', { name: r.new.title });
        await dialog.getByRole('button', { name: r.kinds.correction }).click();
        await dialog.getByLabel(r.fields.date).fill('2026-10-20');
        await dialog.getByLabel(r.fields.time).fill('17:10');
        await expect(dialog.getByText(r.preview.ok.correction)).toBeVisible();
        await screenshot(page, testInfo, `hr-request-correction-${size}-${colorScheme}`);
        await page.keyboard.press('Escape');
        await page.goto(`/attend#${attendanceCode()}`);
        await expect(page.getByRole('button', { name: a.attend.confirm })).toBeVisible();
        await screenshot(page, testInfo, `hr-attend-${size}-${colorScheme}`);

        api.signInAs(manager);
        await page.goto('/hr/today');
        await expect(page.getByRole('region', { name: ar.hr.today.groups.field })).toBeVisible();
        await screenshot(page, testInfo, `hr-today-${size}-${colorScheme}`);
        await page.goto('/hr/approvals?view=items');
        await expect(page.locator('[data-item]')).toHaveCount(4);
        await screenshot(page, testInfo, `hr-approvals-items-${size}-${colorScheme}`);
        await page.locator('[data-item]').last().getByRole('link').click();
        await expect(page.getByText('ازدحام على طريق المزة')).toBeVisible();
        await screenshot(page, testInfo, `hr-item-${size}-${colorScheme}`);
        await page.getByRole('button', { name: ar.hr.items.decide }).click();
        await expect(page.getByRole('dialog', { name: ar.hr.items.decideTitle })).toBeVisible();
        await screenshot(page, testInfo, `hr-item-decision-${size}-${colorScheme}`);
        await page.keyboard.press('Escape');
        await page.goto(`/hr/people/${seedIds.nour}?tab=attendance`);
        await expect(page.getByText('Chrome · Android')).toBeVisible();
        await screenshot(page, testInfo, `hr-file-attendance-${size}-${colorScheme}`);
        await page.goto('/hr/settings?tab=screens');
        await expect(page.locator('[data-kiosk="المدخل الرئيسي"]')).toBeVisible();
        await screenshot(page, testInfo, `hr-settings-screens-${size}-${colorScheme}`);
        await page.getByRole('button', { name: ar.hr.kiosks.add }).click();
        const create = page.getByRole('dialog', { name: ar.hr.kiosks.addTitle });
        await create.getByLabel(ar.hr.kiosks.name).fill('مدخل الاستوديو');
        await create.getByRole('button', { name: ar.hr.kiosks.create }).click();
        await expect(page.getByTestId('pairing-code')).toBeVisible();
        await screenshot(page, testInfo, `hr-kiosk-pairing-code-${size}-${colorScheme}`);
      });

      // F17 part D: the month sheet (open, with what is pending), a closed month, and reopening.
      test(`attendance month (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await page.clock.setFixedTime(new Date(HR_NOW));
        await mockApi(page, { signedIn: true, me: manager, leave: true });
        const m = ar.hr.months;
        await page.goto('/hr/months/2026-10');
        await expect(page.getByTestId('month-pending-counts')).toBeVisible();
        await screenshot(page, testInfo, `hr-month-${size}-${colorScheme}`);
        await page.goto('/hr/months/2026-09');
        await page.getByRole('button', { name: m.close }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await screenshot(page, testInfo, `hr-month-close-${size}-${colorScheme}`);
        await page.getByRole('alertdialog').getByRole('button', { name: m.close }).click();
        await expect(page.locator('[data-month-status="closed"]')).toBeVisible();
        await screenshot(page, testInfo, `hr-month-closed-${size}-${colorScheme}`);
        await page.getByRole('button', { name: m.reopen }).click();
        await expect(
          page.getByRole('dialog', { name: new RegExp(m.reopenTitle.split('{{')[0] ?? '') }),
        ).toBeVisible();
        await screenshot(page, testInfo, `hr-month-reopen-${size}-${colorScheme}`);
      });

      test(`entrance screen (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await page.clock.setFixedTime(new Date(HR_NOW));
        await mockApi(page, { signedIn: false });
        await page.goto('/kiosk');
        await expect(page.getByLabel(ar.hr.kiosk.pairingCode)).toBeVisible();
        await screenshot(page, testInfo, `kiosk-pair-${size}-${colorScheme}`);
        await page.getByLabel(ar.hr.kiosk.pairingCode).fill('K7PX4MQ2');
        await page.getByRole('button', { name: ar.hr.kiosk.pair }).click();
        await expect(page.getByTestId('kiosk-code')).toBeVisible();
        await screenshot(page, testInfo, `kiosk-code-${size}-${colorScheme}`);

        await mockApi(page, {
          signedIn: false,
          kiosk: {
            paired: true,
            greeting: {
              direction: 'in',
              firstName: 'كريم',
              partOfDay: 'morning',
              tasksDueToday: 2,
              firstEventAt: '2026-10-21T10:00:00.000Z',
              workedMinutes: null,
            },
          },
        });
        await page.goto('/kiosk');
        await expect(page.getByTestId('attendance-greeting')).toBeVisible();
        await screenshot(page, testInfo, `kiosk-greeting-${size}-${colorScheme}`);
      });

      // F16 screens 9–14: announcements, with the home pin and the critical dialog.
      test(`announcements (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await page.clock.setFixedTime(new Date(ANNOUNCEMENTS_NOW));
        const api = await mockApi(page, { signedIn: true, me: employeeMe, announcements: true });
        await page.goto('/');
        const pinned = page.getByRole('region', { name: ar.announcements.home.title });
        await expect(pinned).toContainText('مواعيد الدوام في رمضان');
        await pinned.scrollIntoViewIfNeeded();
        await screenshot(page, testInfo, `announcements-home-pin-${size}-${colorScheme}`);

        await page.goto('/announcements');
        await expect(page.getByRole('link', { name: 'مواعيد الدوام في رمضان' })).toBeVisible();
        await screenshot(page, testInfo, `announcements-list-${size}-${colorScheme}`);

        await page.goto(`/announcements/${announcementIds.ramadan}`);
        await expect(page.getByText('الساعة العاشرة صباحًا')).toBeVisible();
        await screenshot(page, testInfo, `announcement-page-${size}-${colorScheme}`);
        const poll = page.getByRole('region', { name: 'أي موعد يناسبكم لإفطار الفريق؟' });
        await poll.scrollIntoViewIfNeeded();
        await screenshot(page, testInfo, `announcement-poll-${size}-${colorScheme}`);

        // The author's view: receipts, then the editor with the audience and a poll.
        api.signInAs(manager);
        await page.goto(`/announcements/${announcementIds.ramadan}`);
        const receipts = page.getByRole('heading', { name: ar.announcements.receipts.title });
        await receipts.scrollIntoViewIfNeeded();
        await expect(page.getByRole('row', { name: /كريم الزين/ })).toBeVisible();
        await screenshot(page, testInfo, `announcement-receipts-${size}-${colorScheme}`);

        await page.goto('/announcements/new');
        await page
          .getByLabel(ar.announcements.form.title, { exact: true })
          .fill('جلسة تصوير المنيو');
        await page
          .getByRole('textbox', { name: ar.announcements.form.body })
          .fill('نصوّر منيو الخريف يوم الثلاثاء في الاستوديو.');
        await screenshot(page, testInfo, `announcement-editor-${size}-${colorScheme}`);
        await page
          .getByRole('button', { name: ar.audiences.sources.departments, exact: true })
          .click();
        await page
          .getByRole('combobox', { name: ar.audiences.sources.departments })
          .fill('التصميم');
        await page.getByRole('option', { name: 'التصميم' }).click();
        await expect(page.getByText(ar.audiences.count_one)).toBeVisible();
        await page
          .getByRole('heading', { name: ar.announcements.form.audience, exact: true })
          .evaluate((heading) => heading.scrollIntoView({ block: 'start' }));
        await screenshot(page, testInfo, `announcement-audience-${size}-${colorScheme}`);
        await page.getByRole('switch', { name: ar.announcements.form.addPoll }).click();
        await page.getByLabel(ar.announcements.form.pollQuestion).scrollIntoViewIfNeeded();
        await screenshot(page, testInfo, `announcement-poll-builder-${size}-${colorScheme}`);
        await page.getByRole('button', { name: ar.announcements.templates.start }).click();
        await expect(
          page.getByRole('dialog', { name: ar.announcements.templates.title }),
        ).toContainText('إجازة رسمية');
        await screenshot(page, testInfo, `announcement-templates-${size}-${colorScheme}`);
      });

      test(`critical announcement (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await page.clock.setFixedTime(new Date(ANNOUNCEMENTS_NOW));
        await mockApi(page, { signedIn: true, me: employeeMe, criticalAnnouncement: true });
        await page.goto('/');
        await expect(
          page.getByRole('alertdialog', { name: 'إخلاء المكتب للصيانة غدًا' }),
        ).toBeVisible();
        await screenshot(page, testInfo, `announcement-critical-${size}-${colorScheme}`);
      });
    }

    for (const [width, height, size] of [
      [1280, 900, 'desktop'],
      [390, 844, 'phone'],
    ] as const) {
      test(`signed-in devices (${size})`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await page.clock.setFixedTime(new Date(DEVICES_NOW));
        await mockApi(page, { signedIn: true });
        await page.goto('/account');
        const card = page.getByRole('heading', { name: ar.devices.title });
        await card.scrollIntoViewIfNeeded();
        await expect(page.getByText(ar.devices.thisDevice, { exact: true })).toBeVisible();
        await screenshot(page, testInfo, `devices-${size}-${colorScheme}`);

        await page
          .getByRole('listitem')
          .filter({ hasText: 'Edge · Windows' })
          .first()
          .getByRole('button', { name: ar.devices.signOut })
          .click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await screenshot(page, testInfo, `devices-sign-out-${size}-${colorScheme}`);
        await page.getByRole('button', { name: ar.common.cancel }).click();
        await expect(page.getByRole('alertdialog')).toHaveCount(0);

        await page.getByRole('button', { name: ar.devices.signOutAll }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await screenshot(page, testInfo, `devices-sign-out-all-${size}-${colorScheme}`);
      });
    }

    test('signed out of all devices', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: false });
      await page.goto('/login?signedOut=all');
      await expect(page.getByText(ar.login.signedOut.all)).toBeVisible();
      await screenshot(page, testInfo, `login-signed-out-${colorScheme}`);
    });

    test('activation', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: false });
      await page.goto(`/activate#token=${VALID_LINK_TOKEN}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        ar.activate.activation.title,
      );
      await screenshot(page, testInfo, `activate-${colorScheme}`);
    });

    test('two-factor setup', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: true, me: financeWithoutTwoFactor });
      await page.goto('/setup-two-factor');
      await page.getByLabel(ar.twoFactorSetup.password, { exact: true }).fill('my-password-123');
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
      await page.getByLabel(ar.login.password, { exact: true }).fill('pw');
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

    test('backdated retainer (F05C)', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 2100 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto(`/retainers/new?clientId=${seedIds.jasmine}`);
      await page.getByLabel(ar.retainers.form.name).fill('عقد بأثر رجعي');
      const departments = page.getByLabel(ar.projects.form.departments);
      await departments.fill('التصميم');
      await page.getByRole('option', { name: 'التصميم' }).click();
      await page.getByLabel(ar.retainers.form.monthlyFee).fill('500');
      for (const kind of [ar.retainers.kinds.design, ar.retainers.kinds.reel]) {
        await page.getByRole('button', { name: kind, exact: true }).click();
      }
      await page.getByLabel(ar.retainers.lines.quantity.replace('{{position}}', '1')).fill('12');
      await page.getByLabel(ar.retainers.lines.quantity.replace('{{position}}', '2')).fill('4');
      await page.getByLabel(ar.retainers.form.startDate).fill('2026-07-20');
      const past = page.getByTestId('past-cycles');
      await expect(past.getByRole('listitem')).toHaveCount(2);
      const first = past.getByRole('listitem').first();
      await first.getByRole('button', { name: ar.retainers.past.deliveries.entered }).click();
      await first.getByLabel(ar.retainers.kinds.design).fill('10');
      await first.getByLabel(ar.retainers.kinds.reel).fill('4');
      await past
        .getByRole('listitem')
        .nth(1)
        .getByRole('button', { name: ar.retainers.past.billings.draft_now })
        .click();
      await past.scrollIntoViewIfNeeded();
      await screenshot(page, testInfo, `new-retainer-past-cycles-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.getByRole('button', { name: ar.retainers.form.create }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('عقد بأثر رجعي');
      await page.getByRole('tab', { name: ar.retainers.page.tabs.history }).click();
      await expect(page.getByText(ar.retainers.history.untracked)).toBeVisible();
      await screenshot(page, testInfo, `retainer-history-backdated-${colorScheme}`);
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
      await screenshot(page, testInfo, `retainer-this-cycle-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.getByRole('tab', { name: ar.retainers.page.tabs.history }).click();
      await expect(page.getByText(ar.retainers.history.title).first()).toBeVisible();
      await screenshot(page, testInfo, `retainer-history-${colorScheme}`);

      await page
        .getByRole('button', { name: ar.retainers.history.open.replace('{{cycle}}', 'الدورة 6') })
        .click();
      await expect(page.getByRole('dialog').getByText('تغطية افتتاح الفرع')).toBeVisible();
      await screenshot(page, testInfo, `retainer-cycle-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.getByRole('tab', { name: ar.projects.page.tabs.extraWork }).click();
      await expect(page.getByText('ريل إضافي لافتتاح الفرع الثاني')).toBeVisible();
      await screenshot(page, testInfo, `retainer-extra-work-${colorScheme}`);

      await page.goto(`/retainers/${seedIds.adsRetainer}`);
      await expect(page.getByText(ar.retainers.cycle.none.pausedTitle)).toBeVisible();
      await screenshot(page, testInfo, `retainer-paused-${colorScheme}`);

      // F05C screen 4: reactivating outside a cycle asks when work starts again.
      await page.goto(`/retainers/${seedIds.endedRetainer}`);
      await page.getByRole('button', { name: ar.retainers.actions.reactivate }).click();
      await page.getByRole('dialog').getByRole('button', { name: ar.retainers.resume.now }).click();
      await expect(page.getByRole('dialog').getByText(/دورة كاملة من اليوم/)).toBeVisible();
      await screenshot(page, testInfo, `retainer-resume-${colorScheme}`);
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

    test('retainer terms (F05B)', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 2300 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto(`/retainers/new?clientId=${seedIds.jasmine}`);
      await page.getByLabel(ar.retainers.form.name).fill('عقد ربع سنوي');
      await page.getByRole('switch', { name: ar.retainers.terms.enable }).click();
      await page.getByLabel(ar.retainers.terms.agreedTotal).fill('1000');
      await expect(page.getByText(ar.retainers.terms.balanced)).toBeVisible();
      await screenshot(page, testInfo, `new-retainer-term-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1500 });
      await page.goto(`/retainers/${seedIds.adsRetainer}?tab=contract`);
      await expect(page.getByText(ar.retainers.terms.past)).toBeVisible();
      await screenshot(page, testInfo, `retainer-contract-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.getByRole('button', { name: ar.retainers.terms.add }).click();
      await page.getByRole('dialog').getByLabel(ar.retainers.terms.agreedTotal).fill('90000');
      await screenshot(page, testInfo, `retainer-term-dialog-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: ar.projects.actions.more }).click();
      await page.getByRole('menuitem', { name: ar.retainers.actions.end }).click();
      await page.getByRole('dialog').getByLabel(ar.retainers.end.fee).fill('500000');
      await expect(page.getByRole('dialog').getByLabel(ar.retainers.end.feeReason)).toBeVisible();
      await screenshot(page, testInfo, `retainer-end-fee-${colorScheme}`);
    });

    test('retainer amendments (F05B)', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 2200 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true });
      await page.goto(`/retainers/${seedIds.adsRetainer}?tab=contract`);
      await expect(page.getByTestId('amendment').first()).toBeVisible();
      await screenshot(page, testInfo, `retainer-amendments-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1400 });
      await page.getByRole('button', { name: ar.retainers.amendments.new }).click();
      const dialog = page.getByRole('dialog');
      await dialog
        .getByRole('button', { name: ar.retainers.amendments.directions.decrease })
        .click();
      await dialog.getByLabel(ar.retainers.amendments.amount).fill('5000');
      await expect(dialog.getByTestId('amendment-preview')).toContainText(/25,000\.00/);
      await screenshot(page, testInfo, `retainer-amendment-dialog-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.setViewportSize({ width: 1280, height: 1200 });
      await page.goto(`/retainers/${seedIds.adsRetainer}?tab=billing`);
      await expect(page.getByText(ar.invoices.billing.creditNextCycle)).toBeVisible();
      await screenshot(page, testInfo, `retainer-billing-credit-${colorScheme}`);
    });

    test('retainer amendment needing approval (account manager)', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1400 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto(`/retainers/${seedIds.socialRetainer}?tab=contract`);
      await page.getByRole('button', { name: ar.retainers.amendments.new }).click();
      const dialog = page.getByRole('dialog');
      await dialog
        .getByRole('button', { name: ar.retainers.amendments.directions.decrease })
        .click();
      await dialog.getByLabel(ar.retainers.amendments.amount).fill('200');
      await expect(dialog.getByText(ar.retainers.amendments.needsApproval)).toBeVisible();
      await screenshot(page, testInfo, `retainer-amendment-approval-${colorScheme}`);
    });

    test('retainer terms (employee view)', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1300 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: employeeMe });
      await page.goto(`/retainers/${seedIds.adsRetainer}?tab=contract`);
      await expect(page.getByText(ar.retainers.terms.past)).toBeVisible();
      await screenshot(page, testInfo, `retainer-contract-employee-${colorScheme}`);
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

    test('approvals and the task in the medical stage', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: medicalReviewerMe });
      await page.goto('/approvals');
      await expect(page.getByRole('link', { name: 'منشور التوعية بصحة الأسنان' })).toBeVisible();
      await screenshot(page, testInfo, `approvals-medical-${colorScheme}`);

      await page.goto('/tasks');
      await expect(
        page.getByRole('region', { name: ar.tasks.my.sections.medicalReview }),
      ).toBeVisible();
      await screenshot(page, testInfo, `my-tasks-medical-${colorScheme}`);

      // Text for the client, the reviewed version and the one added after, review history.
      await page.setViewportSize({ width: 1280, height: 2000 });
      await page.goto(`/tasks/${seedIds.dentalPost}`);
      await expect(page.getByRole('button', { name: ar.tasks.medical.approve })).toBeVisible();
      await page.getByRole('button', { name: ar.files.versions_two }).click();
      await expect(page.getByText(ar.tasks.files.inMedicalReview)).toBeVisible();
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      await screenshot(page, testInfo, `task-medical-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole('button', { name: ar.tasks.medical.approve }).click();
      await expect(page.getByRole('dialog').getByText(ar.tasks.medical.snapshot)).toBeVisible();
      await screenshot(page, testInfo, `task-medical-approve-${colorScheme}`);
    });

    test('approval links: ready, new request, sent, request page, task panel, client tab', async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, approvals: true });
      const loaded = () =>
        page.waitForFunction(() => [...document.images].every((image) => image.complete));

      // Ready to send: a client with its ready tasks, and one that cannot be sent anything.
      await page.goto('/approvals?tab=ready');
      const jasmine = page.getByRole('region', { name: 'مطعم الياسمين' });
      await expect(page.getByRole('region', { name: 'عيادة الشفاء' })).toContainText(
        ar.clients.profile.noApprovalTitle,
      );
      await jasmine.getByRole('button', { name: ar.approvals.ready.selectAll }).click();
      await screenshot(page, testInfo, `approvals-ready-${colorScheme}`);

      // The new request, then the link shown once.
      await jasmine.getByRole('button', { name: /^أنشئ رابط اعتماد \(2\)$/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(ar.approvals.request.message).fill('أعمال الأسبوع جاهزة لمراجعتكم.');
      await screenshot(page, testInfo, `approval-request-new-${colorScheme}`);
      await dialog.getByRole('button', { name: ar.approvals.request.create }).click();
      await expect(dialog.getByText(ar.approvals.request.issuedTitle)).toBeVisible();
      await screenshot(page, testInfo, `approval-request-link-${colorScheme}`);
      await dialog.getByRole('button', { name: ar.approvals.request.done }).click();

      await page.goto('/approvals?tab=sent');
      await expect(page.getByRole('row')).toHaveCount(3);
      await screenshot(page, testInfo, `approvals-sent-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1400 });
      await page.goto(`/approvals/requests/${seedIds.openRequest}`);
      await expect(page.getByText('ممتاز، انشروه الخميس.')).toBeVisible();
      await loaded();
      await screenshot(page, testInfo, `approval-request-${colorScheme}`);

      // The task waiting in the link: the Client approval panel beside its details.
      await page.goto(`/tasks/${seedIds.autumnReel}`);
      await expect(
        page.getByRole('heading', { level: 2, name: ar.tasks.approval.title }),
      ).toBeVisible();
      await expect(page.getByText(ar.tasks.files.sentToClient)).toHaveCount(3);
      await loaded();
      await screenshot(page, testInfo, `task-client-approval-${colorScheme}`);

      await page.goto(`/clients/${seedIds.jasmine}?tab=approvals`);
      await expect(page.getByText('غيّروا سعر العرض إلى 45 ألف ليرة.')).toBeVisible();
      await screenshot(page, testInfo, `client-approvals-${colorScheme}`);
    });

    test('the client page at phone width: open, deciding, expired and invalid', async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      // No session: the link is the access.
      await mockApi(page, { signedIn: false, approvals: true });
      await page.goto(`/a/${OPEN_LINK_TOKEN}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا هالة الشامي');
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      await screenshot(page, testInfo, `client-page-open-${colorScheme}`);

      // Decided items show their result: through the link, and recorded by the account manager.
      await page.getByText(ar.approvals.public.recordedByAgency).scrollIntoViewIfNeeded();
      await screenshot(page, testInfo, `client-page-decided-${colorScheme}`);

      await page.getByRole('button', { name: ar.approvals.public.requestChanges }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: ar.approvals.public.sendChanges })
        .click();
      await expect(
        page.getByRole('dialog').getByText(ar.approvals.public.errors.note),
      ).toBeVisible();
      await screenshot(page, testInfo, `client-page-changes-${colorScheme}`);

      await page.goto(`/a/${EXPIRED_LINK_TOKEN}`);
      await expect(page.getByText(ar.approvals.public.expiredTitle)).toBeVisible();
      await screenshot(page, testInfo, `client-page-expired-${colorScheme}`);

      await page.goto('/a/unknown-token');
      await expect(page.getByText(ar.approvals.public.invalidTitle)).toBeVisible();
      await screenshot(page, testInfo, `client-page-invalid-${colorScheme}`);
    });

    test('task sent to the client and the client-response dialog', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 2200 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto(`/tasks/${seedIds.autumnMenu}`);
      await page.getByRole('button', { name: ar.tasks.moves.submit, exact: true }).click();
      await page.getByRole('button', { name: ar.tasks.moves.send_to_client, exact: true }).click();
      await expect(page.getByText(ar.tasks.files.sentToClient)).toHaveCount(2);
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      await screenshot(page, testInfo, `task-sent-${colorScheme}`);

      // Recording the response by hand asks who answered (F09 rule 16).
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole('button', { name: ar.tasks.moves.client_changes, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox').first().fill('كبّروا اسم المطعم على الغلاف.');
      await dialog.getByRole('button', { name: ar.tasks.moves.client_changes }).click();
      await expect(dialog.getByText(ar.tasks.move.errors.contact)).toBeVisible();
      await dialog.getByRole('combobox', { name: ar.tasks.move.responder }).click();
      await expect(page.getByRole('option').nth(1)).toBeVisible();
      await screenshot(page, testInfo, `task-client-response-${colorScheme}`);
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

    test('catalog services', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/catalog');
      await expect(
        page.getByRole('cell', { name: 'تصميم سوشال ميديا', exact: true }),
      ).toBeVisible();
      await screenshot(page, testInfo, `catalog-services-${colorScheme}`);

      await page.getByRole('button', { name: ar.catalog.services.new }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(page, testInfo, `catalog-service-dialog-${colorScheme}`);
    });

    test('catalog packages', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/catalog?tab=packages');
      await expect(page.getByRole('heading', { name: 'باقة السوشال الذهبية' })).toBeVisible();
      await screenshot(page, testInfo, `catalog-packages-${colorScheme}`);

      await page
        .getByRole('button', {
          name: ar.catalog.actions.replace('{{name}}', 'باقة السوشال الذهبية'),
        })
        .click();
      await page.getByRole('menuitem', { name: ar.catalog.edit }).click();
      await expect(page.getByRole('dialog')).toContainText('تصميم سوشال ميديا');
      await screenshot(page, testInfo, `catalog-package-dialog-${colorScheme}`);
    });

    test('quote settings', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/catalog/settings');
      await expect(page.getByLabel(ar.quotes.settings.companyDetails)).toHaveValue(/Vertex Media/);
      await screenshot(page, testInfo, `quote-settings-${colorScheme}`);
    });

    test('quote list', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/quotes');
      await expect(page.getByRole('link', { name: /هوية وسوشال الياسمين/ })).toBeVisible();
      await screenshot(page, testInfo, `quotes-list-${colorScheme}`);

      await page.getByRole('button', { name: ar.quotes.new.action }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(page, testInfo, `quote-new-dialog-${colorScheme}`);
    });

    test('quote list (Finance: no "My clients")', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(page, { signedIn: true, me: financeMe });
      await page.goto('/quotes');
      await expect(page.getByRole('link', { name: /هوية وسوشال الياسمين/ })).toBeVisible();
      await expect(
        page.getByRole('button', { name: ar.quotes.filters.mine, exact: true }),
      ).toHaveCount(0);
      await screenshot(page, testInfo, `quotes-list-finance-${colorScheme}`);
    });

    test('quote builder', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1600 });
      await mockApi(page, { signedIn: true });
      // A Shifa draft whose monthly discount crosses the threshold.
      await page.goto(`/quotes/${seedIds.shifaDraft}`);
      await expect(page.getByText(ar.quotes.approval.neededTitle)).toBeVisible();
      await screenshot(page, testInfo, `quote-builder-${colorScheme}`);

      // A draft awaiting the General Manager's decision: read-only with the banner.
      await page.goto(`/quotes/${seedIds.pendingQuote}`);
      await expect(page.getByText(ar.quotes.approval.pendingTitle)).toBeVisible();
      await screenshot(page, testInfo, `quote-builder-pending-${colorScheme}`);
    });

    test('quote page', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1300 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/quotes/${seedIds.sentQuote}`);
      await expect(page.getByRole('link', { name: ar.quotes.pdf.download })).toBeVisible();
      await screenshot(page, testInfo, `quote-sent-${colorScheme}`);
    });

    test('accept dialog and accepted quote', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1300 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/quotes/${seedIds.sentQuote}`);
      await page.getByRole('button', { name: ar.quotes.accept.action }).click();
      const accept = page.getByRole('dialog');
      for (const step of ['response', 'project', 'retainer'] as const) {
        await expect(accept.getByText(ar.quotes.accept.steps[step], { exact: true })).toBeVisible();
        await screenshot(page, testInfo, `quote-accept-${step}-${colorScheme}`);
        await accept.getByRole('button', { name: ar.common.next }).click();
      }
      await expect(accept.getByRole('button', { name: ar.quotes.accept.submit })).toBeVisible();
      await screenshot(page, testInfo, `quote-accept-summary-${colorScheme}`);
      await accept.getByRole('button', { name: ar.quotes.accept.submit }).click();
      await expect(page).toHaveURL(/\/projects\/[^/]+$/);

      await page.goto(`/quotes/${seedIds.sentQuote}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        ar.quotes.statuses.accepted,
      );
      await screenshot(page, testInfo, `quote-accepted-${colorScheme}`);
    });

    test('client quotes tab', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/clients/${seedIds.jasmine}?tab=quotes`);
      await expect(page.getByRole('link', { name: /هوية وسوشال الياسمين/ })).toBeVisible();
      await screenshot(page, testInfo, `client-quotes-${colorScheme}`);
    });

    test('leads board, list and the lead dialog with duplicates', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/leads?view=board');
      await expect(page.getByRole('link', { name: 'عيادة النور لطب الأسنان' })).toBeVisible();
      await screenshot(page, testInfo, `leads-board-${colorScheme}`);

      await page.goto('/leads?view=list');
      await expect(page.getByRole('table')).toBeVisible();
      await screenshot(page, testInfo, `leads-list-${colorScheme}`);

      await page.getByRole('button', { name: ar.leads.newLead }).click();
      const dialog = page.getByRole('dialog', { name: ar.leads.form.newTitle });
      await dialog.getByLabel(ar.leads.form.contactName).fill('أحمد');
      await dialog.getByLabel(ar.leads.form.companyName).fill('مطعم الياسمين');
      await dialog.getByLabel(ar.leads.form.phone).fill('+963944111222');
      await expect(dialog.getByRole('list', { name: ar.leads.duplicates.title })).toBeVisible();
      await screenshot(page, testInfo, `lead-dialog-duplicates-${colorScheme}`);
    });

    test('leads board on a phone', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await mockApi(page, { signedIn: true });
      await page.goto('/leads?view=board');
      await page.getByRole('tab', { name: new RegExp(ar.leads.stages.contacted) }).click();
      await expect(page.getByRole('link', { name: 'عيادة النور لطب الأسنان' })).toBeVisible();
      await screenshot(page, testInfo, `leads-board-phone-${colorScheme}`);
    });

    test('lead page: open, won and lost; convert, lose and the accept step 0', async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 1440, height: 1100 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/leads/${seedIds.noorLead}`);
      await expect(page.getByText('أرسل صور العيادة وطلب عرضاً للباقة الذهبية.')).toBeVisible();
      await screenshot(page, testInfo, `lead-open-${colorScheme}`);

      await page.getByRole('button', { name: ar.leads.actions.convert }).click();
      const convert = page.getByRole('dialog');
      await expect(convert.getByLabel(ar.clients.form.tradeName)).toHaveValue(
        'عيادة النور لطب الأسنان',
      );
      await screenshot(page, testInfo, `lead-convert-new-${colorScheme}`);
      await convert.getByRole('tab', { name: ar.leads.convert.modes.existing }).click();
      await convert.getByRole('combobox', { name: ar.leads.convert.client }).click();
      await page.getByRole('option', { name: 'متجر النخبة' }).click();
      await expect(convert.getByText(ar.leads.convert.reactivates)).toBeVisible();
      await screenshot(page, testInfo, `lead-convert-existing-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.goto(`/leads/${seedIds.rashaqaLead}`);
      await page.getByRole('button', { name: ar.leads.actions.more }).click();
      await page.getByRole('menuitem', { name: ar.leads.actions.lose }).click();
      await expect(page.getByRole('dialog').getByText('Q-2026-0005')).toBeVisible();
      await screenshot(page, testInfo, `lead-lose-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.goto(`/leads/${seedIds.wonLead}`);
      await expect(page.getByRole('link', { name: ar.leads.page.openClient })).toBeVisible();
      await screenshot(page, testInfo, `lead-won-${colorScheme}`);

      await page.goto(`/leads/${seedIds.lostLead}`);
      await expect(page.getByText('الميزانية أقل من نصف العرض.')).toBeVisible();
      await screenshot(page, testInfo, `lead-lost-${colorScheme}`);

      await page.goto(`/quotes/${seedIds.leadQuote}`);
      await page.getByRole('button', { name: ar.quotes.accept.action }).click();
      await expect(
        page.getByRole('dialog').getByText(ar.quotes.accept.steps.client, { exact: true }),
      ).toBeVisible();
      await screenshot(page, testInfo, `quote-accept-client-${colorScheme}`);
    });

    test('invoice list', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/invoices');
      await expect(page.getByRole('link', { name: ar.invoices.draftNumber }).first()).toBeVisible();
      await screenshot(page, testInfo, `invoices-to-issue-${colorScheme}`);

      await page.getByRole('tab', { name: ar.invoices.tabs.open }).click();
      await expect(page.getByRole('link', { name: 'INV-2026-0001' })).toBeVisible();
      await screenshot(page, testInfo, `invoices-open-${colorScheme}`);

      await page.getByRole('button', { name: ar.invoices.new.action }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(page, testInfo, `invoice-new-dialog-${colorScheme}`);
    });

    test('invoice editor', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1300 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/invoices/${seedIds.designDraft}`);
      await expect(page.getByRole('button', { name: ar.invoices.issue.action })).toBeVisible();
      await screenshot(page, testInfo, `invoice-editor-${colorScheme}`);

      await page.getByRole('button', { name: ar.invoices.editor.addBillable }).click();
      await expect(page.getByRole('dialog')).toContainText('تصميم إضافي لإعلان العيد');
      await screenshot(page, testInfo, `invoice-billable-picker-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: ar.invoices.issue.action }).click();
      await expect(page.getByRole('dialog')).toContainText(ar.invoices.issue.title);
      await screenshot(page, testInfo, `invoice-issue-dialog-${colorScheme}`);
    });

    test('invoice page with payments', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/invoices/${seedIds.overdueInvoice}`);
      await expect(page.getByText('RC-2026-0001')).toBeVisible();
      await screenshot(page, testInfo, `invoice-page-${colorScheme}`);

      // A payment of the USD invoice in the other currency, at its rate.
      await page.getByRole('button', { name: ar.invoices.payments.action }).click();
      const pay = page.getByRole('dialog');
      await pay.getByRole('combobox', { name: ar.invoices.payments.currency }).click();
      await page.getByRole('option', { name: ar.invoices.currencies.SYP }).click();
      await pay.getByRole('button', { name: ar.invoices.payments.payTheRest }).click();
      await expect(pay.getByText(ar.invoices.payments.balanceAfter)).toBeVisible();
      await screenshot(page, testInfo, `invoice-payment-dialog-${colorScheme}`);
    });

    test('invoice settings', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await mockApi(page, { signedIn: true });
      await page.goto('/invoices/settings');
      // The stored `118.5000` without trailing zeros.
      await expect(page.getByLabel(ar.invoices.settings.sypPerUsd)).toHaveValue('118.5');
      await screenshot(page, testInfo, `invoice-settings-${colorScheme}`);
    });

    test('client invoices tab with statement', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1900 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/clients/${seedIds.jasmine}?tab=invoices`);
      await expect(page.getByText(ar.invoices.statement.closing)).toBeVisible();
      await screenshot(page, testInfo, `client-invoices-${colorScheme}`);
    });

    test('project billing', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1900 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/projects/${seedIds.identityProject}?tab=billing`);
      await expect(page.getByText('خطوط مرخّصة للهوية')).toBeVisible();
      await screenshot(page, testInfo, `project-billing-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole('button', { name: ar.invoices.expenses.add }).click();
      await expect(page.getByRole('dialog')).toContainText(ar.invoices.expenses.addTitle);
      await screenshot(page, testInfo, `project-expense-dialog-${colorScheme}`);
    });

    test('campaigns and ad budgets', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/campaigns');
      await expect(page.getByRole('link', { name: 'حملة رسائل الخريف' })).toBeVisible();
      await screenshot(page, testInfo, `campaigns-${colorScheme}`);

      await page.getByRole('button', { name: ar.campaigns.new.action }).click();
      await expect(page.getByRole('dialog')).toContainText(ar.campaigns.new.title);
      await screenshot(page, testInfo, `campaign-new-dialog-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.getByRole('tab', { name: ar.campaigns.tabs.budgets }).click();
      await expect(page.getByText(ar.campaigns.wallet.lowBadge)).toBeVisible();
      await screenshot(page, testInfo, `ad-budgets-${colorScheme}`);
    });

    test('campaign page with updates', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/campaigns/${seedIds.autumnCampaign}`);
      await expect(page.getByText(ar.campaigns.months.heading)).toBeVisible();
      await screenshot(page, testInfo, `campaign-page-${colorScheme}`);

      // Spend beyond the budget and the balance: both warnings, before saving.
      await page.getByRole('button', { name: ar.campaigns.updates.add }).first().click();
      const update = page.getByRole('dialog');
      await update.getByLabel(ar.campaigns.updates.spend).fill('700');
      await update.getByLabel(ar.campaigns.results.messages).fill('120');
      await expect(update.getByText(ar.campaigns.updates.walletNegativeTitle)).toBeVisible();
      await screenshot(page, testInfo, `campaign-update-dialog-${colorScheme}`);
    });

    test('client ads tab', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1300 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/clients/${seedIds.jasmine}?tab=ads`);
      await expect(page.getByText('AD-2026-0002')).toBeVisible();
      await screenshot(page, testInfo, `client-ads-${colorScheme}`);

      // A deposit in SYP, converted at its rate.
      await page.getByRole('button', { name: ar.campaigns.entry.deposit }).click();
      const deposit = page.getByRole('dialog');
      await deposit.getByRole('combobox', { name: ar.campaigns.entry.currency }).click();
      await page.getByRole('option', { name: ar.invoices.currencies.SYP }).click();
      await deposit.getByLabel(ar.campaigns.entry.amount).fill('1185000');
      await expect(deposit.getByText(ar.campaigns.entry.usd)).toBeVisible();
      await screenshot(page, testInfo, `ad-deposit-dialog-${colorScheme}`);
    });

    test('retainer billing', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1400 });
      await mockApi(page, { signedIn: true });
      await page.goto(`/retainers/${seedIds.socialRetainer}?tab=billing`);
      // The heading, not the header's fee label of the same words.
      await expect(page.getByRole('heading', { name: ar.invoices.billing.charges })).toBeVisible();
      await screenshot(page, testInfo, `retainer-billing-${colorScheme}`);
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

    test('content calendar: month, week and the phone agenda', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1500 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, content: true });
      await page.goto('/content');
      await expect(page.getByRole('link', { name: /كاروسيل أطباق الخريف/ })).toBeVisible();
      // The fifth post of the day hides behind "+1".
      await expect(page.getByRole('button', { name: /اعرض 1 أخرى/ })).toBeVisible();
      await screenshot(page, testInfo, `content-month-${colorScheme}`);

      await page.getByRole('button', { name: /اعرض 1 أخرى/ }).click();
      await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(5);
      await screenshot(page, testInfo, `content-day-list-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.getByRole('button', { name: ar.calendar.views.week }).click();
      await expect(page).toHaveURL(/view=week/);
      await expect(page.getByRole('link', { name: /ريل كواليس المطبخ/ })).toBeVisible();
      await screenshot(page, testInfo, `content-week-${colorScheme}`);

      await page.setViewportSize({ width: 390, height: 1400 });
      await page.goto('/content');
      await expect(page.getByRole('link', { name: 'كاروسيل أطباق الخريف' })).toBeVisible();
      await screenshot(page, testInfo, `content-agenda-phone-${colorScheme}`);
    });

    test('company calendar: month, week and the phone agenda', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1500 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, calendar: true });
      await page.goto('/calendar');
      await expect(page.getByRole('link', { name: /أطباق الخريف/ })).toBeVisible();
      await expect(page.getByText('خطة محتوى تشرين الثاني').first()).toBeVisible();
      await screenshot(page, testInfo, `calendar-month-${colorScheme}`);

      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.getByRole('button', { name: ar.calendar.views.week }).click();
      await expect(page).toHaveURL(/view=week/);
      await expect(page.getByRole('link', { name: /منتجات ركن القهوة/ })).toBeVisible();
      await screenshot(page, testInfo, `calendar-week-${colorScheme}`);

      await page.setViewportSize({ width: 390, height: 1600 });
      await page.goto('/calendar');
      await expect(page.getByRole('link', { name: 'أطباق الخريف' })).toBeVisible();
      await screenshot(page, testInfo, `calendar-agenda-phone-${colorScheme}`);
    });

    test('shoot form with a conflict warning', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 2300 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe, calendar: true });
      await page.goto(`/shoots/${seedIds.autumnShoot}/edit`);
      await expect(page.getByLabel(ar.calendar.form.title)).toHaveValue('أطباق الخريف');
      await expect(page.getByText(ar.calendar.form.conflictsBody)).toBeVisible();
      await page.getByRole('button', { name: ar.calendar.form.addExternal }).click();
      await screenshot(page, testInfo, `shoot-form-${colorScheme}`);
    });

    test('shoot page on a phone and the close dialog', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 2200 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: employeeMe, calendar: true });
      await page.goto(`/shoots/${seedIds.autumnShoot}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('أطباق الخريف');
      await expect(page.getByRole('checkbox')).toHaveCount(5);
      await screenshot(page, testInfo, `shoot-page-phone-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1300 });
      await page.goto(`/shoots/${seedIds.coffeeShoot}`);
      await page.getByRole('button', { name: ar.calendar.actions.close }).click();
      await expect(page.getByRole('dialog').getByLabel(ar.calendar.close.taskTitle)).toHaveValue(
        'مونتاج: منتجات ركن القهوة',
      );
      await screenshot(page, testInfo, `shoot-close-dialog-${colorScheme}`);
    });

    test('meeting page and the meeting dialog', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, calendar: true });
      await page.goto(`/meetings/${seedIds.contentMeeting}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('خطة محتوى تشرين الثاني');
      await expect(page.getByRole('link', { name: '+963944555666' })).toBeVisible();
      await screenshot(page, testInfo, `meeting-page-${colorScheme}`);

      await page.getByRole('button', { name: ar.calendar.meetings.actions.edit }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByLabel(ar.calendar.meetings.form.title)).toHaveValue(
        'خطة محتوى تشرين الثاني',
      );
      await expect(dialog.getByText(ar.calendar.meetings.form.conflictsBody)).toBeVisible();
      await screenshot(page, testInfo, `meeting-dialog-${colorScheme}`);
    });

    test('my posts', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, content: true });
      await page.goto('/content?tab=mine');
      await expect(
        page.getByRole('region', { name: ar.content.my.sections.overdue }).getByRole('link'),
      ).toHaveText('ستوري عرض الغداء');
      await expect(
        page.getByRole('region', { name: ar.content.my.sections.toReview }),
      ).toBeVisible();
      await screenshot(page, testInfo, `my-posts-${colorScheme}`);
    });

    test('client content tab and the new post dialog', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1700 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe, content: true });
      await page.goto(`/clients/${seedIds.jasmine}?tab=content`);
      await expect(page.getByRole('link', { name: /شكر لضيوف الافتتاح/ })).toBeVisible();
      await expect(page.getByText(/^منشورات تشرين/)).toBeVisible();
      await screenshot(page, testInfo, `client-content-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1300 });
      await page.getByRole('button', { name: ar.content.actions.new }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(ar.content.form.title).fill('عرض الفطور الشامي');
      await dialog.getByRole('checkbox', { name: /إنستغرام/ }).click();
      await dialog
        .getByRole('textbox', { name: new RegExp(`^${ar.content.form.caption}`) })
        .fill('فطور شامي كامل كل جمعة.');
      await screenshot(page, testInfo, `new-post-${colorScheme}`);
    });

    test('post page: in production, linking a task, approved, medical stage, published', async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 1280, height: 1700 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      const api = await mockApi(page, { signedIn: true, me: accountManagerMe, content: true });
      await page.goto(`/content/posts/${seedIds.openingPost}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('عرض افتتاح الفرع الثاني');
      await expect(
        page.getByRole('link', { name: 'تصميم عرض الافتتاح', exact: true }),
      ).toBeVisible();
      await screenshot(page, testInfo, `post-in-production-${colorScheme}`);

      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.getByRole('button', { name: ar.content.tasks.link }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('تصميم قائمة المشروبات')).toBeVisible();
      await screenshot(page, testInfo, `link-task-${colorScheme}`);
      await dialog.getByRole('tab', { name: ar.content.link.tabs.request }).click();
      await dialog.getByRole('combobox', { name: ar.content.link.cycleLine }).click();
      await page.getByRole('option', { name: /تقرير شهري/ }).click();
      await screenshot(page, testInfo, `request-post-task-${colorScheme}`);
      await page.keyboard.press('Escape');

      // With the client: the account manager records the answer given by phone (rule 24).
      await page.setViewportSize({ width: 1280, height: 1300 });
      await page.goto(`/content/posts/${seedIds.weekendOffer}`);
      await page.getByRole('button', { name: ar.content.moves.client_changes }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(page, testInfo, `post-awaiting-client-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.goto(`/content/posts/${seedIds.followersContest}`);
      await expect(page.getByText('أجّل العميل المسابقة إلى الشهر القادم.')).toBeVisible();
      await screenshot(page, testInfo, `post-cancelled-${colorScheme}`);

      api.signInAs(manager);
      await page.setViewportSize({ width: 1280, height: 1500 });
      await page.goto(`/content/posts/${seedIds.autumnCarousel}`);
      await expect(page.getByRole('button', { name: ar.content.moves.publish })).toBeVisible();
      await expect(page.getByText('يقطين مشوي', { exact: true })).toBeVisible();
      await screenshot(page, testInfo, `post-approved-${colorScheme}`);
      await page.getByRole('button', { name: ar.content.moves.publish }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(page, testInfo, `publish-post-${colorScheme}`);
      await page.keyboard.press('Escape');

      api.signInAs(medicalReviewerMe);
      await page.setViewportSize({ width: 1280, height: 1200 });
      await page.goto(`/content/posts/${seedIds.dentalTips}`);
      await expect(page.getByRole('button', { name: ar.tasks.medical.approve })).toBeVisible();
      await screenshot(page, testInfo, `post-medical-${colorScheme}`);

      await page.goto(`/content/posts/${seedIds.coffeeDay}`);
      await expect(page.getByRole('link', { name: /instagram\.com/ })).toBeVisible();
      await screenshot(page, testInfo, `post-published-${colorScheme}`);
    });

    test('posts in approvals: queues, send month, request page, post panel, client page', async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      const api = await mockApi(page, { signedIn: true, me: medicalReviewerMe, content: true });
      // Off-screen thumbnails load lazily (the calendar behind a dialog, the media strip).
      const loaded = () =>
        page.waitForFunction(() =>
          [...document.images].every((image) => {
            const box = image.getBoundingClientRect();
            const shown =
              box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
            return image.complete || !shown;
          }),
        );

      // The medical queue with a post beside the tasks.
      await page.goto('/approvals');
      await expect(page.getByRole('link', { name: 'نصائح العناية بالأسنان' })).toBeVisible();
      await screenshot(page, testInfo, `approvals-medical-posts-${colorScheme}`);

      // Ready to send with posts, and the Month picker.
      api.signInAs(accountManagerMe);
      await page.goto('/approvals?tab=ready');
      const jasmine = page.getByRole('region', { name: 'مطعم الياسمين' });
      await expect(jasmine.getByRole('link', { name: 'ريل تحضير القهوة' })).toBeVisible();
      await jasmine.getByRole('checkbox', { name: /ريل تحضير القهوة/ }).click();
      await screenshot(page, testInfo, `approvals-ready-posts-${colorScheme}`);

      // "Send month for approval" on the client's Content tab, then its dialog.
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.goto(`/clients/${seedIds.jasmine}?tab=content`);
      const send = page.getByRole('button', { name: /^أرسل الشهر للاعتماد \(1\)$/ });
      await expect(send).toBeEnabled();
      await screenshot(page, testInfo, `client-content-send-month-${colorScheme}`);
      await send.click();
      await expect(page.getByRole('dialog').getByText(ar.approvals.request.preview)).toBeVisible();
      await loaded();
      await screenshot(page, testInfo, `approval-request-posts-new-${colorScheme}`);
      await page.keyboard.press('Escape');

      // The month link's request page with its post items.
      await page.setViewportSize({ width: 1280, height: 1300 });
      await page.goto(`/approvals/requests/${seedIds.contentRequest}`);
      await expect(
        page.getByRole('link', { name: 'المنشور: كاروسيل حلويات الجمعة' }),
      ).toBeVisible();
      await loaded();
      await screenshot(page, testInfo, `approval-request-posts-${colorScheme}`);

      // The post waiting in the link: its Client approval panel.
      await page.goto(`/content/posts/${seedIds.sweetsCarousel}`);
      await expect(
        page.getByRole('heading', { level: 2, name: ar.tasks.approval.title }),
      ).toBeVisible();
      await loaded();
      await screenshot(page, testInfo, `post-client-approval-${colorScheme}`);

      // The client page at phone width: the content plan and "Approve all".
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/a/${CONTENT_LINK_TOKEN}`);
      await expect(
        page.getByRole('heading', { level: 2, name: ar.approvals.public.contentPlan }),
      ).toBeVisible();
      await loaded();
      await page
        .getByRole('heading', { level: 2, name: ar.approvals.public.contentPlan })
        .scrollIntoViewIfNeeded();
      await screenshot(page, testInfo, `client-page-content-plan-${colorScheme}`);
      await page.getByRole('button', { name: /^اعتمد الكل/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(page, testInfo, `client-page-approve-all-${colorScheme}`);
    });

    test('task page with the Post line', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1300 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe, content: true });
      await page.goto(`/tasks/${seedIds.openingDesign}`);
      await expect(page.getByRole('link', { name: 'عرض افتتاح الفرع الثاني' })).toBeVisible();
      await expect(page.getByText(ar.content.taskPost.hint)).toBeVisible();
      await screenshot(page, testInfo, `task-post-line-${colorScheme}`);
    });

    // F15: the home page per role, the reports and the monthly client report.
    for (const [name, me] of [
      ['general-manager', manager],
      ['department-manager', departmentManagerMe],
      ['account-manager', plainAccountManagerMe],
      ['finance', financeMe],
      ['employee', employeeMe],
    ] as const) {
      test(`home page for the ${name}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 1440, height: 1600 });
        await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
        await mockApi(page, { signedIn: true, me });
        await page.goto('/');
        await expect(
          page.getByRole('region', { name: ar.dashboard.work.title, exact: true }),
        ).toBeVisible();
        await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
        await screenshot(page, testInfo, `home-${name}-${colorScheme}`);
      });
    }

    test('home page on a phone', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: manager });
      await page.goto('/');
      const company = page.getByRole('region', { name: ar.dashboard.company.title, exact: true });
      await company.getByRole('button', { name: ar.dashboard.company.title }).click();
      await expect(company.getByText(ar.dashboard.company.activeRetainers)).toBeHidden();
      await screenshot(page, testInfo, `home-phone-${colorScheme}`);
    });

    test('reports index', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: true, me: manager });
      await page.goto('/reports');
      await expect(page.getByRole('heading', { name: ar.reports.client.title })).toBeVisible();
      await screenshot(page, testInfo, `reports-${colorScheme}`);
    });

    test('department productivity report', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1200 });
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto('/reports/productivity');
      await expect(page.getByRole('row', { name: /التصميم/ }).first()).toBeVisible();
      await screenshot(page, testInfo, `report-productivity-${colorScheme}`);
    });

    test('revenue report by client and by service', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: true, me: financeMe });
      await page.goto('/reports/revenue');
      await expect(page.getByRole('row', { name: /مطعم الياسمين/ })).toBeVisible();
      await screenshot(page, testInfo, `report-revenue-client-${colorScheme}`);
      await page.getByRole('tab', { name: ar.reports.revenue.byService }).click();
      await expect(page.getByText(ar.reports.revenue.unclassified)).toBeVisible();
      await screenshot(page, testInfo, `report-revenue-service-${colorScheme}`);
    });

    test('overdue invoices report', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(page, { signedIn: true, me: financeMe });
      await page.goto('/reports/overdue-invoices');
      await expect(page.getByRole('row', { name: /مطعم الياسمين/ })).toBeVisible();
      await screenshot(page, testInfo, `report-overdue-invoices-${colorScheme}`);
    });

    test('monthly client report', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 2400 });
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto(`/clients/${seedIds.jasmine}/report`);
      await expect(
        page.getByRole('heading', { name: ar.reports.client.sections.adBudget }),
      ).toBeVisible();
      await screenshot(page, testInfo, `client-report-${colorScheme}`);
    });

    test('cycle report (F05C)', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 2400 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: accountManagerMe });
      await page.goto(`/retainers/${seedIds.socialRetainer}?tab=history`);
      await page
        .getByRole('link', { name: ar.reports.cycle.openOf.replace('{{cycle}}', 'الدورة 7') })
        .click();
      await expect(
        page.getByRole('heading', { name: ar.reports.cycle.deliverables }),
      ).toBeVisible();
      await screenshot(page, testInfo, `cycle-report-${colorScheme}`);
    });

    test('contract settings (F05C)', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 2200 });
      await mockApi(page, { signedIn: true, me: manager });
      await page.goto('/settings/contracts');
      await expect(
        page.getByRole('heading', { name: ar.retainers.contractSettings.articles.title }),
      ).toBeVisible();
      await screenshot(page, testInfo, `contract-settings-${colorScheme}`);
    });

    test('contract editor and issued contract with annexes (F05C)', async ({ page }, testInfo) => {
      const contracts = ar.retainers.contracts;
      await page.setViewportSize({ width: 1280, height: 2400 });
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await mockApi(page, { signedIn: true, me: manager });
      await page.goto(`/retainers/${seedIds.adsRetainer}?tab=contract`);
      await page
        .getByRole('region', { name: ar.retainers.terms.name.replace('{{number}}', '2') })
        .getByRole('button', { name: contracts.prepare })
        .click();
      // The draft before a signatory is chosen: missing fields flagged, issuing blocked.
      await expect(page.getByTestId('party-signatoryName')).toContainText(contracts.requiredField);
      await screenshot(page, testInfo, `contract-editor-${colorScheme}`);

      await page.getByLabel(contracts.signatory).click();
      await page.getByRole('option', { name: /د. رامي حسن/ }).click();
      await page.getByRole('button', { name: contracts.save }).click();
      await expect(page.getByText(contracts.saved)).toBeVisible();
      await page.getByRole('button', { name: contracts.issue }).click();
      await expect(page.getByText(contracts.issueEmpty)).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 1000 });
      await screenshot(page, testInfo, `contract-issue-dialog-${colorScheme}`);
      await page.getByRole('button', { name: contracts.issueAction }).click();

      await page.goto(`/retainers/${seedIds.adsRetainer}?tab=contract`);
      const amendment = page
        .getByTestId('amendment')
        .filter({ hasText: ar.retainers.amendments.name.replace('{{number}}', '2') });
      await amendment.getByRole('button', { name: ar.retainers.amendments.approve }).click();
      await amendment.getByRole('button', { name: contracts.issueAnnex }).click();
      await page.getByRole('button', { name: contracts.issueAnnexAction }).click();
      await expect(page.getByTestId('annex')).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 2400 });
      await page
        .getByRole('region', { name: contracts.title })
        .getByRole('link', { name: contracts.open })
        .click();
      await expect(page.getByTestId('annex')).toBeVisible();
      await screenshot(page, testInfo, `contract-issued-${colorScheme}`);
    });

    test('contact dialog with and without the national ID (F05C)', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await mockApi(page, { signedIn: true, me: manager });
      await page.goto(`/clients/${seedIds.jasmine}`);
      await page.getByRole('button', { name: ar.clients.contacts.add }).first().click();
      await expect(page.getByLabel(ar.clients.contacts.form.nationalId)).toBeVisible();
      await screenshot(page, testInfo, `contact-dialog-national-id-${colorScheme}`);

      await mockApi(page, { signedIn: true, me: managerWithoutMoney });
      await page.goto(`/clients/${seedIds.jasmine}`);
      await page.getByRole('button', { name: ar.clients.contacts.add }).first().click();
      await expect(page.getByLabel(ar.clients.contacts.form.fatherName)).toBeVisible();
      await screenshot(page, testInfo, `contact-dialog-${colorScheme}`);
    });

    test('invoice services dialog', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: true, me: manager });
      await page.goto(`/invoices/${seedIds.overdueInvoice}`);
      await page.getByRole('button', { name: ar.invoices.services.action }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(page, testInfo, `invoice-services-dialog-${colorScheme}`);
    });

    test('forgot password, form and confirmation', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: false });
      await page.goto('/forgot-password');
      await expect(page.getByRole('heading', { name: ar.forgotPassword.title })).toBeVisible();
      await screenshot(page, testInfo, `forgot-password-${colorScheme}`);
      await page.getByLabel(ar.login.email).fill('sara@vertex.example');
      await page.getByRole('button', { name: ar.forgotPassword.submit }).click();
      await expect(page.getByText(ar.forgotPassword.sentTitle)).toBeVisible();
      await screenshot(page, testInfo, `forgot-password-sent-${colorScheme}`);
    });

    test('send by email dialog and email history', async ({ page }, testInfo) => {
      await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
      await page.setViewportSize({ width: 1280, height: 1400 });
      await mockApi(page, { signedIn: true, me: financeMe });
      await page.goto(`/invoices/${seedIds.overdueInvoice}`);
      await expect(page.getByRole('heading', { name: ar.email.history.title })).toBeVisible();
      await expect(page.getByText('535 5.7.8 Authentication failed')).toBeVisible();
      await screenshot(page, testInfo, `email-history-${colorScheme}`);
      await page.getByRole('button', { name: ar.email.send.action }).click();
      await expect(page.getByRole('dialog').getByLabel(ar.email.send.subject)).not.toBeEmpty();
      await screenshot(page, testInfo, `send-email-dialog-${colorScheme}`);
    });

    test('email log', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: true, me: manager });
      await page.goto('/emails');
      await expect(page.getByRole('row')).toHaveCount(5);
      await screenshot(page, testInfo, `email-log-${colorScheme}`);
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
