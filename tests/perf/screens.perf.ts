import { expect, test, type Browser } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createFixture, installCrmFixture, withVolume } from '../browser/fixture';

/**
 * Benchmark do item 0.10: tempo até a marca `screen-ready` (useScreenReady) em Hoje e Contatos, contado desde o
 * início da navegação, com o volume sintético na fixture, CPU 4x mais lenta (Emulation.setCPUThrottlingRate) e um
 * contexto novo por execução (sem cache). Meta: p95 abaixo de 2 s. O resultado fica em test-results/perf/.
 *
 * A fixture do E2E é servida por um servidor HTTP local (httpPort), sem a latência de rede nem a RLS de um Supabase
 * real: a medida é do cliente (download e execução do bundle, requisições com preflight de CORS, leitura paginada,
 * cálculos e renderização).
 */
const RUNS = Number(process.env.PERF_RUNS ?? 10);
/** Porta do backend falso; a mesma de VITE_SUPABASE_URL em playwright.perf.config.ts. */
const BACKEND_PORT = Number(process.env.PERF_BACKEND_PORT ?? 54339);
const CPU_SLOWDOWN = 4;
const BUDGET_MS = 2_000;
const SCREENS = [
  { name: 'Hoje', path: '/dashboard', screen: 'dashboard' },
  { name: 'Contatos', path: '/contacts', screen: 'contacts' },
] as const;
type Summary = { runs: number[]; p50: number; p95: number; max: number };
const summaries: Record<string, Summary> = {};

/** Percentil pelo método do posto mais próximo (com 10 execuções, o p95 é a mais lenta). */
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

async function measure(browser: Browser, path: string, screen: string) {
  const context = await browser.newContext();
  const state = createFixture('owner');
  try {
    const page = await context.newPage();
    state.memoizeReads = true;
    withVolume(state);
    // Servida por HTTP, como um backend: a interceptação do Playwright (page.route) acrescentaria um custo que o
    // navegador de quem usa o CRM não tem.
    await installCrmFixture(page, { state, httpPort: BACKEND_PORT });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
    await page.goto(path);
    const handle = await page.waitForFunction(
      (name) => {
        const mark = performance
          .getEntriesByName('screen-ready')
          .find((entry) => (entry as PerformanceMark).detail?.screen === name);
        return mark ? mark.startTime : null;
      },
      screen,
      { timeout: 120_000, polling: 250 },
    );
    const elapsed = Number(await handle.jsonValue());
    // A tela mostrou os dados de verdade, e não um estado vazio ou de erro.
    if (screen === 'contacts') await expect(page.getByText(/^1–25 de 50\d\d/)).toBeVisible();
    else await expect(page.getByRole('heading', { name: /^Fila de atenção · \d+$/ })).toBeVisible();
    return elapsed;
  } finally {
    await context.close();
    await state.stopServer?.();
  }
}

test.describe.configure({ mode: 'serial' });

for (const target of SCREENS)
  test(`${target.name} com volume: p95 abaixo de 2 s com CPU ${CPU_SLOWDOWN}x mais lenta`, async ({ browser }) => {
    const runs: number[] = [];
    for (let run = 0; run < RUNS; run++) runs.push(Math.round(await measure(browser, target.path, target.screen)));
    const summary = { runs, p50: percentile(runs, 50), p95: percentile(runs, 95), max: Math.max(...runs) };
    summaries[target.name] = summary;
    console.log(
      `${target.name}: p50 ${summary.p50} ms · p95 ${summary.p95} ms · máx. ${summary.max} ms · execuções ${runs.join(', ')}`,
    );
    await mkdir('test-results/perf', { recursive: true });
    await writeFile(
      'test-results/perf/resultado.json',
      `${JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          cpuSlowdown: CPU_SLOWDOWN,
          budgetMs: BUDGET_MS,
          volume: { contacts: 5000, companies: 1000, deals: 2000, activities: 15000 },
          screens: summaries,
        },
        null,
        2,
      )}\n`,
    );
    expect(summary.p95, `p95 de ${target.name} (execuções: ${runs.join(', ')} ms)`).toBeLessThan(BUDGET_MS);
  });
