import { test as base, expect, type Page } from '@playwright/test';
import openapi from '../src/lib/api/openapi.json' with { type: 'json' };

/*
 * The `test` every spec uses: Playwright's, failing a test when the mocked API drifts from the real
 * one or the page breaks unseen. The mock (`fixtures.ts`) answers only requests the API document
 * (`openapi.json`, generated from the API) declares, and reports any request it has no answer for.
 */

/** Requests of a page the mock could not answer, or that the API does not declare. */
const problems = new WeakMap<Page, string[]>();

export function reportApiProblem(page: Page, problem: string): void {
  const list = problems.get(page) ?? [];
  list.push(problem);
  problems.set(page, list);
}

const declared = Object.entries(openapi.paths as Record<string, Record<string, unknown>>).map(
  ([path, operations]) => ({
    pattern: new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`),
    methods: new Set(Object.keys(operations).map((method) => method.toUpperCase())),
  }),
);

/**
 * Whether the real API has this route (Better Auth's own routes are outside its document). Express
 * answers `HEAD` on every `GET` route, without the body.
 */
export function isDeclaredEndpoint(method: string, path: string): boolean {
  if (path.startsWith('/api/auth/')) return true;
  const asked = method === 'HEAD' ? 'GET' : method;
  return declared.some((route) => route.pattern.test(path) && route.methods.has(asked));
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(`Page error: ${error.message}`));
    // Base UI reports misuse (a link acting as a button, a label on a non-label) as errors.
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().startsWith('Base UI')) {
        failures.push(`Console: ${message.text()}`);
      }
    });
    await use(page);
    expect([...failures, ...(problems.get(page) ?? [])]).toEqual([]);
  },
});

export { expect };
