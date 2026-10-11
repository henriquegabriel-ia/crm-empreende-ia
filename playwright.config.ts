import { defineConfig, devices } from '@playwright/test';

// Artifacts stay inside the repository, in folders already ignored by Git, on every OS.
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  retries: 0,
  workers: 3,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: { baseURL: 'http://127.0.0.1:8096', timezoneId: 'America/Sao_Paulo', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', testMatch: 'smoke.spec.ts', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 8096 --strictPort',
    url: 'http://127.0.0.1:8096',
    timeout: 30_000,
    reuseExistingServer: false,
    env: { VITE_CRM_ENVIRONMENT: 'dedicated', VITE_SUPABASE_URL: 'http://127.0.0.1:54329', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_test' },
  },
});
