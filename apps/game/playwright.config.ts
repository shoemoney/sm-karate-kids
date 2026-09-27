import { defineConfig, devices } from '@playwright/test';

/**
 * Portrait phone is the baseline, so it is also the default project. The
 * desktop project exists to prove the layout adapts, not the other way round.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'phone-portrait',
      use: {
        ...devices['iPhone 12'],
        // Chromium is the only engine with a WebGPU backend to fall back from.
        defaultBrowserType: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // Spawned as a direct node process, not through pnpm. A pnpm wrapper does
    // not forward SIGTERM to vite, so Playwright's teardown waits on a server
    // that never dies and the whole run hangs after the last test reports.
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173',
    cwd: import.meta.dirname,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: process.env['CI'] === undefined,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    timeout: 120_000,
  },
});
