import { defineConfig } from '@playwright/test';

const port = 3111;
// The e2e suite runs the real server in example mode (no .env, no credentials) with its own data dir.
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'node server/index.mjs',
    url: `http://localhost:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(port),
      OUR_CASTLE_ENV_FILE: 'none',
      OUR_CASTLE_DATA_DIR: 'test-results/e2e-data',
      PAYPAL_CLIENT_ID: '',
      PAYPAL_CLIENT_SECRET: '',
      AI_API_KEY: '',
    },
  },
});
