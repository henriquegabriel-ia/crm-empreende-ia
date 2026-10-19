import { expect, test, type Page } from './test';
import { installCrmFixture } from './fixture';
import {
  OFFLINE_BANNER_MESSAGE,
  OFFLINE_ERROR_BACK_TITLE,
  OFFLINE_ERROR_TEXT,
  OFFLINE_ERROR_TITLE,
} from '../../src/lib/offline';

// Item 1.7b (docs/arquitetura/1.7b.md, seções 8.3 e 12.3): uma aba aberta antes de uma publicação nova pede um pedaço
// do app que não existe mais, e a reescrita do vercel.json responde com o index.html. A rota do teste imita isso no
// pedaço da tela de Contatos: na primeira vez, a página recarrega sozinha e a tela abre; com o pedaço falhando sempre,
// a tela de erro aparece depois de um único recarregamento, sem laço; sem conexão, não recarrega. Item 1.7a (achados 3 e 4
// da revisão do 1.7b): a página nascida do recarregamento consome a marca, e a tela de erro sem conexão diz isso e só
// deixa recarregar quando a conexão volta, no desktop e no celular (os dois primeiros cenários ficam no desktop).

// Com PLAYWRIGHT_DEV_SERVER=1, o servidor de desenvolvimento não tem os pedaços do build.
test.skip(process.env.PLAYWRIGHT_DEV_SERVER === '1', 'o servidor de desenvolvimento não divide o build em pedaços');

const CONTACTS_CHUNK = /\/assets\/Contacts-[\w-]+\.js$/;

/** Responde o pedaço de Contatos com o index.html, como a hospedagem depois de uma publicação nova. */
async function serveStaleChunk(page: Page, times: number) {
  let served = 0;
  await page.route(CONTACTS_CHUNK, async (route) => {
    if (served >= times) return route.fallback();
    served += 1;
    const index = await page.request.get('/');
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: { 'Cache-Control': 'no-store' },
      body: await index.text(),
    });
  });
  return () => served;
}

/** Conta as cargas completas da página (o recarregamento é uma carga nova do documento). */
function countLoads(page: Page) {
  let loads = 0;
  page.on('load', () => (loads += 1));
  return () => loads;
}

/** Marca na sessionStorage (que sobrevive ao recarregamento) se a tela de erro chegou a aparecer, mesmo por um instante. */
async function watchErrorScreen(page: Page) {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.body?.textContent?.includes('Algo deu errado')) sessionStorage.setItem('test:saw-error', '1');
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  return () => page.evaluate(() => sessionStorage.getItem('test:saw-error') === '1');
}

async function openContactsFromMenu(page: Page) {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Contatos', exact: true }).first().click();
}

test('com o pedaço antigo da tela, a aba recarrega uma vez e a tela abre', async ({ page, isMobile }) => {
  test.skip(isMobile, 'o recarregamento é o mesmo no celular; o cenário fica no desktop');
  await page.setViewportSize({ width: 1280, height: 900 });
  await installCrmFixture(page);
  const served = await serveStaleChunk(page, 1);
  const loads = countLoads(page);
  const sawError = await watchErrorScreen(page);
  await openContactsFromMenu(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Contatos', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/contacts$/);
  await expect(page.getByText('Algo deu errado', { exact: true })).toHaveCount(0);
  expect(served()).toBe(1);
  // A carga do /dashboard e a do recarregamento.
  expect(loads()).toBe(2);
  // A página nascida do recarregamento consumiu a marca ao abrir (sem comparar relógios).
  expect(await page.evaluate(() => sessionStorage.getItem('crm:stale-build-reload'))).toBeNull();
  // Enquanto a página recarrega, a tela fica no "Carregando tela…": a tela de erro não pisca.
  expect(await sawError()).toBe(false);
});

test('com o pedaço falhando sempre, a tela de erro aparece depois de um único recarregamento', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'o recarregamento é o mesmo no celular; o cenário fica no desktop');
  await page.setViewportSize({ width: 1280, height: 900 });
  await installCrmFixture(page);
  await serveStaleChunk(page, Number.POSITIVE_INFINITY);
  const loads = countLoads(page);
  await openContactsFromMenu(page);
  await expect(page.getByText('Algo deu errado', { exact: true })).toBeVisible();
  // Espera o suficiente para um laço aparecer, se existisse.
  await page.waitForTimeout(1_500);
  await expect(page.getByText('Algo deu errado', { exact: true })).toBeVisible();
  expect(loads()).toBe(2);
});

test('sem conexão, a aba não recarrega: a tela de erro diz isso e só deixa recarregar com a conexão de volta', async ({
  page,
  context,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1280, height: 900 });
  await installCrmFixture(page);
  const loads = countLoads(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Contatos', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: OFFLINE_ERROR_TITLE, exact: true })).toBeVisible();
  await expect(page.getByText(OFFLINE_ERROR_TEXT, { exact: true })).toBeVisible();
  await expect(page.getByText('Algo deu errado', { exact: true })).toHaveCount(0);
  await expect(page.getByText(OFFLINE_BANNER_MESSAGE, { exact: true })).toBeVisible();
  const reloadButton = page.getByRole('button', { name: 'Recarregar', exact: true });
  await expect(reloadButton).toBeDisabled();
  expect(loads()).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('crm:stale-build-reload'))).toBeNull();
  // A conexão volta: o botão habilita, sem recarregar sozinho, e a tela diz isso (não "Algo deu errado").
  await context.setOffline(false);
  await expect(reloadButton).toBeEnabled();
  await expect(page.getByRole('heading', { name: OFFLINE_ERROR_BACK_TITLE, exact: true })).toBeVisible();
  await expect(page.getByText('Algo deu errado', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(loads()).toBe(1);
  // Recarregar, agora, abre a tela.
  await reloadButton.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Contatos', exact: true })).toBeVisible();
  expect(loads()).toBe(2);
});
