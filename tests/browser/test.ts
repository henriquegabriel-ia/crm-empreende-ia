import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test as base, type Page, type TestInfo } from '@playwright/test';

export { expect } from '@playwright/test';
export type { BrowserContext, Locator, Page, Route, TestInfo } from '@playwright/test';

/**
 * O `test` dos cenários do E2E (item 1.11; docs/arquitetura/1.11.md, seção 12), com três peças automáticas:
 *
 * - **Guarda de infraestrutura.** Um pedido ao servidor do app (as portas 8096, 8098 e 8099 de playwright.config.ts)
 *   que falha na conexão TCP deixava a página em branco, e o teste caía 12 s depois num localizador, sem a causa (achado
 *   1 da revisão do item 1.10). Agora o teste ganha a anotação `infraestrutura`, a saída diz o pedido, a página fecha
 *   na hora e fica uma marca em `test-results/.infraestrutura/`. O backend fictício (tests/browser/backend.ts) não
 *   entra: os testes interrompem os pedidos a ele de propósito; a navegação cancelada (ERR_ABORTED) e o modo offline
 *   também não.
 * - **Nova tentativa só para a infraestrutura.** Localmente, uma nova tentativa só roda se a anterior deixou a marca:
 *   qualquer outra falha recusa a nova tentativa na hora e continua como falha. O relatório mostra o teste que passou na
 *   nova tentativa como instável ("flaky"), e não como aprovado. No CI, vale a decisão do item 0.6 (uma nova tentativa
 *   para qualquer falha).
 * - **Guarda de CSP** (item 1.3; docs/arquitetura/1.3.md, seção 9.3). O build do E2E roda com os cabeçalhos do
 *   vercel.json (plugin crm-security-headers no vite preview). Cada violação da CSP que o navegador escreve no console
 *   ("Content Security Policy"), na página do teste ou numa janela aberta por ela, é guardada, e o teste reprova no fim
 *   com a lista. Um teste que provoca uma violação de propósito chama `expectCspViolation(testInfo, padrão)`
 *   (anotação `csp-esperada` com o padrão) e confere o texto com `cspViolations(page)`: só as violações que casam
 *   com um padrão anotado ficam de fora, e qualquer outra no mesmo cenário ainda reprova.
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

const CSP_VIOLATION = /Content Security Policy/i;
const violations = new WeakMap<Page, string[]>();

const CSP_EXPECTED = 'csp-esperada';

/**
 * Marca uma violação provocada de propósito: a guarda deixa passar só as violações cujo texto casa com `pattern` (sem
 * diferenciar maiúsculas), e as demais continuam reprovando o cenário.
 */
export const expectCspViolation = (testInfo: TestInfo, pattern: RegExp) =>
  testInfo.annotations.push({ type: CSP_EXPECTED, description: pattern.source });

/** As violações de CSP vistas até agora na página do teste e nas janelas abertas por ela. */
export const cspViolations = (page: Page) => [...(violations.get(page) ?? [])];

function guardCsp(page: Page) {
  const seen: string[] = [];
  violations.set(page, seen);
  const watch = (target: Page) =>
    target.on('console', (message) => {
      if (message.type() === 'error' && CSP_VIOLATION.test(message.text())) seen.push(message.text());
    });
  watch(page);
  page.context().on('page', watch);
  return seen;
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
    const seen = guardCsp(page);
    await run(page);
    const expected = testInfo.annotations
      .filter((annotation) => annotation.type === CSP_EXPECTED && annotation.description)
      .map((annotation) => new RegExp(annotation.description as string, 'i'));
    const unexpected = seen.filter((text) => !expected.some((pattern) => pattern.test(text)));
    if (unexpected.length)
      throw new Error(
        [
          `A página violou a CSP do vercel.json (${unexpected.length}):`,
          ...unexpected.map((text) => `  - ${text}`),
          'Libere a origem no vercel.json, com o motivo, ou remova o recurso (README, "Configuração do Auth e cabeçalhos").',
        ].join('\n'),
      );
  },
});
