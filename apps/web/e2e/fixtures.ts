import type { Page, TestInfo } from '@playwright/test';
import type { HealthResponse, MeResponse } from '@vertex-hub/contracts';

/*
 * The E2E suite covers the SPA alone: API responses are mocked here with the shared contract
 * types, and the API is exercised by its own integration tests.
 */

export const healthy: HealthResponse = {
  status: 'ok',
  checks: { database: 'up' },
  timestamp: '2026-09-28T10:00:00.000Z',
};

export const manager: MeResponse = {
  user: {
    id: '01920000-0000-7000-8000-000000000001',
    name: 'سارة الخطيب',
    email: 'sara@vertex.example',
    image: null,
  },
  roles: ['general_manager', 'account_manager'],
  permissions: ['users.read', 'users.manage', 'clients.read', 'clients.manage'],
};

/** Mocks the API. `signedIn` decides whether /api/me finds a session; sign-in flips it on. */
export async function mockApi(
  page: Page,
  options: { signedIn: boolean; acceptPassword?: string },
): Promise<void> {
  let signedIn = options.signedIn;
  await page.route('**/api/health', (route) => route.fulfill({ json: healthy }));
  await page.route('**/api/me', (route) =>
    signedIn
      ? route.fulfill({ json: manager })
      : route.fulfill({ status: 401, json: { message: 'Unauthorized', statusCode: 401 } }),
  );
  await page.route('**/api/auth/sign-in/email', async (route) => {
    const body = route.request().postDataJSON() as { email: string; password: string };
    if (body.password !== options.acceptPassword) {
      return route.fulfill({
        status: 401,
        json: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
      });
    }
    signedIn = true;
    return route.fulfill({ json: { redirect: false, token: 'test-token', user: manager.user } });
  });
  await page.route('**/api/auth/sign-out', (route) => {
    signedIn = false;
    return route.fulfill({ json: { success: true } });
  });
}

/** Viewport screenshot kept in the test output and attached to the HTML report. */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
