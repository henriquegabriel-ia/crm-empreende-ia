import { defineConfig, devices } from '@playwright/test';

// Backend fictício do E2E: as requisições a ele são respondidas pela fixture (tests/browser/fixture.ts). As variáveis da
// marca vão sempre definidas, mesmo vazias, para o .env.local de quem roda não vazar para o teste (process.env vence o
// arquivo; item 1.6).
const SERVER_ENV = {
  VITE_CRM_ENVIRONMENT: 'dedicated',
  VITE_SUPABASE_URL: 'http://127.0.0.1:54329',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_test',
  VITE_SHOW_BASE_CREDIT: '',
  VITE_SUPPORT_EMAIL: '',
};
// Marcas fictícias do E2E de marca (item 1.6), servidas pelo servidor de desenvolvimento com CRM_BRAND_DIR
// (scripts/lib/brand.mjs): a Acme, com brand.json e três SVG, e uma segunda, sem imagens e com o nome de 60 caracteres
// (revisão do item 1.6: o nome em texto em até duas linhas).
const ACME_BRAND_DIR = 'tests/browser/brand/acme';
const ACME_NO_LOGO_BRAND_DIR = 'tests/browser/brand/acme-sem-logo';
const devServer = (port: number, env: Record<string, string> = {}) => ({
  command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
  url: `http://127.0.0.1:${port}`,
  timeout: 60_000,
  reuseExistingServer: false,
  env: { ...SERVER_ENV, ...env },
});

// Artifacts stay inside the repository, in folders already ignored by Git, on every OS.
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  // Uma nova tentativa só no CI (decisão do item 0.6), para uma falha intermitente do servidor de desenvolvimento não
  // derrubar a esteira; localmente, sem nova tentativa, a instabilidade continua aparecendo (achado 4 da revisão da
  // Ajuda, item 1.2).
  retries: process.env.CI ? 1 : 0,
  workers: 3,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:8096',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Celular: as telas do CRM (smoke), as de entrada e de convite (entry, item 1.1), a Equipe com a desativação
    // (team, item 1.2) e a marca da instância (brand, item 1.6).
    {
      name: 'mobile-chrome',
      testMatch: ['smoke.spec.ts', 'entry.spec.ts', 'team.spec.ts', 'brand.spec.ts'],
      use: { ...devices['Pixel 7'] },
    },
  ],
  // 8096: a marca da instância (public/brand). 8098: a marca fictícia com logos e o crédito ligado (brand.json). 8099: a
  // marca fictícia sem imagens, com o crédito desligado pela variável (VITE_SHOW_BASE_CREDIT=false). Os dois só servem
  // brand.spec.ts. As portas 8097 e 54339 são do test:perf.
  webServer: [
    devServer(8096),
    devServer(8098, { CRM_BRAND_DIR: ACME_BRAND_DIR }),
    devServer(8099, { CRM_BRAND_DIR: ACME_NO_LOGO_BRAND_DIR, VITE_SHOW_BASE_CREDIT: 'false' }),
  ],
});
