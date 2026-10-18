import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test as base, type Page, type TestInfo } from '@playwright/test';

export { expect } from '@playwright/test';
export type { BrowserContext, Locator, Page, Route, TestInfo } from '@playwright/test';

/**
 * O `test` dos cenários do E2E (item 1.11; docs/arquitetura/1.11.md, seção 12), com duas peças automáticas:
 *
 * - **Guarda de infraestrutura.** Um pedido ao servidor do app (as portas 8096, 8098 e 8099 de playwright.config.ts)
 *   que falha na conexão TCP deixava a página em branco, e o teste caía 12 s depois num localizador, sem a causa (achado
 *   1 da revisão do item 1.10). Agora o teste ganha a anotação `infraestrutura`, a saída diz o pedido, a página fecha
 *   na hora e fica uma marca em `test-results/.infraestrutura/`. O backend falso (54329) não entra: os testes
 *   interrompem os pedidos a ele de propósito; a navegação cancelada (ERR_ABORTED) e o modo offline também não.
 * - **Nova tentativa só para a infraestrutura.** Localmente, uma nova tentativa só roda se a anterior deixou a marca:
 *   qualquer outra falha recusa a nova tentativa na hora e continua como falha. O relatório mostra o teste que passou na
 *   nova tentativa como instável ("flaky"), e não como aprovado. No CI, vale a decisão do item 0.6 (uma nova tentativa
 *   para qualquer falha).
 */

const APP_ORIGIN = /^http:\/\/127\.0\.0\.1:(8096|8098|8099)\//;
const CONNECTION_FAILURE = /^net::ERR_CONNECTION_(FAILED|REFUSED|RESET|CLOSED)$/;
const MARKS = path.resolve('test-results', '.infraestrutura');
const markOf = (testInfo: TestInfo) => path.join(MARKS, testInfo.testId);
const hasMark = (testInfo: TestInfo) => {
  try {
    return statSync(markOf(testInfo)).isFile();
  } catch {
    return false;
  }
};

function guardAppServer(page: Page, testInfo: TestInfo) {
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? '';
    if (!APP_ORIGIN.test(request.url()) || !CONNECTION_FAILURE.test(failure)) return;
    const description = `falha de conexão com o servidor de teste: ${failure} ${new URL(request.url()).pathname}`;
    testInfo.annotations.push({ type: 'infraestrutura', description });
    mkdirSync(MARKS, { recursive: true });
    writeFileSync(markOf(testInfo), `${description}\n`);
    console.error(`[infraestrutura] ${description}`);
    void page.close().catch(() => undefined);
  });
}

export const test = base.extend<{ infrastructureRetry: void }>({
  infrastructureRetry: [
    // eslint-disable-next-line no-empty-pattern -- o Playwright exige o objeto das dependências, aqui sem nenhuma
    async ({}, run, testInfo) => {
      if (testInfo.retry > 0 && !process.env.CI) {
        if (!hasMark(testInfo))
          throw new Error(
            'Nova tentativa recusada: a tentativa anterior falhou por outro motivo que não a conexão com o servidor de teste, e falhas reais não são repetidas.',
          );
        rmSync(markOf(testInfo), { force: true });
        testInfo.annotations.push({
          type: 'infraestrutura',
          description: 'nova tentativa depois de uma falha de conexão com o servidor de teste',
        });
      }
      await run();
    },
    { auto: true },
  ],
  page: async ({ page }, run, testInfo) => {
    guardAppServer(page, testInfo);
    await run(page);
  },
});
