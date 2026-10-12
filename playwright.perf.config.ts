import { defineConfig, devices } from '@playwright/test';

/**
 * Benchmark de desempenho com volume (item 0.10 do roteiro), fora do `npm run test:e2e`: build de produção servido
 * pelo `vite preview` (scripts/perf-server.mjs), fixture do E2E com 5 mil contatos, 1 mil empresas, 2 mil
 * oportunidades e 15 mil atividades servida por HTTP, CPU 4x mais lenta e 10 execuções por tela. Rodar com
 * `npm run test:perf`.
 */
const PORT = Number(process.env.PERF_PORT ?? 8097);
/** Backend falso servido por HTTP pelo próprio teste (fixture do E2E com `httpPort`), fora da porta do E2E. */
const BACKEND_PORT = Number(process.env.PERF_BACKEND_PORT ?? 54339);
export default defineConfig({
  testDir: './tests/perf',
  testMatch: '*.perf.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  reporter: [['list']],
  outputDir: 'test-results/perf',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    timezoneId: 'America/Sao_Paulo',
    trace: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'node scripts/perf-server.mjs',
    url: `http://127.0.0.1:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      PERF_PORT: String(PORT),
      VITE_CRM_ENVIRONMENT: 'dedicated',
      VITE_SUPABASE_URL: `http://127.0.0.1:${BACKEND_PORT}`,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_test',
    },
  },
});
