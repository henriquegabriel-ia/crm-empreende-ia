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
// Marcas fictícias do E2E de marca (item 1.6), com CRM_BRAND_DIR (scripts/lib/brand.mjs): a Acme, com brand.json e três
// SVG, e uma segunda, sem imagens e com o nome de 60 caracteres (revisão do item 1.6: o nome em texto em até duas
// linhas).
const ACME_BRAND_DIR = 'tests/browser/brand/acme';
const ACME_NO_LOGO_BRAND_DIR = 'tests/browser/brand/acme-sem-logo';
/**
 * Servidores do app (item 1.11; achado 1 da revisão do item 1.10): o build de produção no modo e2e, servido pelo
 * vite preview (scripts/e2e-server.mjs), um por porta e numa pasta própria de dist-e2e/. O servidor de desenvolvimento
 * respondia cada carregamento com cerca de 175 módulos, e uma conexão falhava de vez em quando sob três navegadores no
 * Windows (página em branco). Para depurar com o código ao vivo, PLAYWRIGHT_DEV_SERVER=1 volta ao npm run dev.
 */
const LIVE_CODE = process.env.PLAYWRIGHT_DEV_SERVER === '1';
const appServer = (port: number, outDir: string, env: Record<string, string> = {}) =>
  LIVE_CODE
    ? {
        command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
        url: `http://127.0.0.1:${port}`,
        timeout: 60_000,
        reuseExistingServer: false,
        env: { ...SERVER_ENV, ...env },
      }
    : {
        command: 'node scripts/e2e-server.mjs',
        url: `http://127.0.0.1:${port}`,
        timeout: 120_000,
        reuseExistingServer: false,
        env: { ...SERVER_ENV, ...env, E2E_PORT: String(port), E2E_OUT_DIR: outDir },
      };

// Artifacts stay inside the repository, in folders already ignored by Git, on every OS.
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  // Uma nova tentativa. No CI, para qualquer falha (decisão do item 0.6). Localmente, só para a falha de conexão com o
  // servidor do app, que a guarda de tests/browser/test.ts anota (infraestrutura): qualquer outra falha recusa a nova
  // tentativa na hora e continua como falha, e o teste que passa na nova tentativa aparece como instável (flaky) no
  // relatório. Nada é repetido em silêncio (item 1.11; seção 12 do desenho).
  retries: 1,
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
    // (team, item 1.2), a marca da instância (brand, item 1.6), os canais com o registro (channels, item 1.9; a
    // "Saída da F1" pede o E2E dos canais no desktop e no celular), a privacidade (privacy, item 1.10: a exportação e
    // a anonimização no desktop e no celular), a importação de planilha (import, item 1.11), os lembretes no menu
    // (reminders, item 1.12: o número ao lado de "Hoje" no desktop e no celular), a gestão mínima (management, item
    // 1.14: o recorte de uma pessoa, os ganhos por responsável e a origem do contato) e o catálogo com os itens da
    // oportunidade (catalog, item 1.16).
    {
      name: 'mobile-chrome',
      testMatch: [
        'smoke.spec.ts',
        'entry.spec.ts',
        'team.spec.ts',
        'brand.spec.ts',
        'channels.spec.ts',
        'privacy.spec.ts',
        'import.spec.ts',
        'reminders.spec.ts',
        'management.spec.ts',
        'catalog.spec.ts',
      ],
      use: { ...devices['Pixel 7'] },
    },
  ],
  // 8096: a marca da instância (public/brand). 8098: a marca fictícia com logos e o crédito ligado (brand.json). 8099: a
  // marca fictícia sem imagens, com o crédito desligado pela variável (VITE_SHOW_BASE_CREDIT=false). Os dois só servem
  // brand.spec.ts. As portas 8097 e 54339 são do test:perf.
  webServer: [
    appServer(8096, 'dist-e2e/instancia'),
    appServer(8098, 'dist-e2e/acme', { CRM_BRAND_DIR: ACME_BRAND_DIR }),
    appServer(8099, 'dist-e2e/acme-sem-logo', {
      CRM_BRAND_DIR: ACME_NO_LOGO_BRAND_DIR,
      VITE_SHOW_BASE_CREDIT: 'false',
    }),
  ],
});
