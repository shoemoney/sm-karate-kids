import { test as base } from '@playwright/test';

/**
 * The arcade API is part of the page's environment in production, so every
 * test gets a stand-in for it. Without one, the tournament's run-token request
 * fails and the browser logs a resource error — which is environment noise,
 * not a game bug, and should not be something the "no console errors" checks
 * have to learn to ignore.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/api/games/karate-kids/**', async (route) => {
      const url = route.request().url();
      if (url.endsWith('/runs')) {
        await route.fulfill({ status: 201, json: { runToken: 'test-token', scoreVersion: 1 } });
      } else if (url.endsWith('/scores') && route.request().method() === 'GET') {
        await route.fulfill({ status: 200, json: { scores: [], scoreVersion: 1, order: 'highest' } });
      } else {
        await route.fulfill({ status: 201, json: { accepted: true, replayed: false, rank: 1, scoreVersion: 1 } });
      }
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
