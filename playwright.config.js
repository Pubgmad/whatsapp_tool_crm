import { defineConfig, devices } from '@playwright/test';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const e2ePort = Number(process.env.E2E_PORT || 3100);
const e2eBase = process.env.E2E_BASE_URL || `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: e2eBase, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run start -- -p ${e2ePort}`,
        url: `${e2eBase}/login`,
        env: { ...process.env, APP_URL: e2eBase, E2E_BASE_URL: e2eBase, LOGIN_RATE_LIMIT: process.env.LOGIN_RATE_LIMIT || '1000' },
        reuseExistingServer: true,
        timeout: 120000
      },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 15'] } }
  ]
});
