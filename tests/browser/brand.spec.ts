import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readBrand } from '../../scripts/lib/brand.mjs';
import { buildExportFileName } from '../../src/lib/export-file-name';
import { installCrmFixture } from './fixture';

// Item 1.6 (docs/arquitetura/1.6.md, seção 10.5): a marca muda sem editar código. Com CRM_BRAND_DIR, o servidor 8098
// serve a marca fictícia de tests/browser/brand/acme (brand.json e três SVG), com o crédito "Feito com Empreende.IA"
// ligado (brand.json), e o 8099 a de tests/browser/brand/acme-sem-logo (sem imagens e com o nome de 60 caracteres), com
// o crédito desligado pela variável (VITE_SHOW_BASE_CREDIT=false). Desktop e celular, salvo indicação.
const ACME = readBrand({ dir: fileURLToPath(new URL('./brand/acme/', import.meta.url)) });
const ACME_NO_LOGO = readBrand({ dir: fileURLToPath(new URL('./brand/acme-sem-logo/', import.meta.url)) });
const CREDIT_ON = 'http://127.0.0.1:8098';
const CREDIT_OFF = 'http://127.0.0.1:8099';
const CREDIT = 'Feito com Empreende.IA';
const MISSING_PAGE = '/pagina-que-nao-existe';

const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile-chrome';

/** Pedidos de imagens da marca do programa (/brand/eia-*, /materials/ e o favicon antigo) feitos pela página. */
function watchProgramAssets(page: Page) {
  const requested: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (/^\/brand\/eia-|^\/materials\/|^\/favicon\.svg$/.test(pathname)) requested.push(pathname);
  });
  return requested;
}

/** Texto visível da página sem o crédito: o nome do programa não pode sobrar em lugar nenhum. */
async function textWithoutCredit(page: Page) {
  return (await page.locator('body').innerText()).split(CREDIT).join('');
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const geometry = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(geometry.scroll, `${label}: documento`).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.body, `${label}: body`).toBeLessThanOrEqual(geometry.width + 1);
}

/** Abre a "Ajuda do CRM": pelo menu lateral no desktop e por "Mais opções → Central de ajuda" no celular. */
async function openHelp(page: Page, testInfo: TestInfo) {
  if (isMobile(testInfo)) {
    await page.getByRole('button', { name: 'Mais opções' }).click();
    await page.getByRole('menuitem', { name: 'Central de ajuda' }).click();
  } else await page.getByRole('button', { name: 'Ajuda', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Ajuda do CRM', exact: true });
  await expect(help.getByRole('heading', { name: 'Perguntas frequentes', exact: true })).toBeVisible();
  return help;
}

/** Logo visível da marca fictícia (o painel da entrada no desktop, o topo do formulário no celular, o menu lateral). */
const visibleLogo = (page: Page) => page.locator('img[src^="/brand/acme-logo-on-"]:visible').first();

/** O logo cabe na caixa de 176 × 48 px (entrada e 404) e não encolhe a ponto de sumir. */
async function expectLogoInBox(page: Page, label: string) {
  const logo = (await visibleLogo(page).boundingBox())!;
  expect(logo.width, `${label}: largura do logo`).toBeLessThanOrEqual(176.5);
  expect(logo.height, `${label}: altura do logo`).toBeLessThanOrEqual(48.5);
  expect(logo.width, `${label}: largura do logo`).toBeGreaterThan(100);
}

/**
 * Nome da marca em texto, sem logo (o Wordmark com `line-clamp-2`): visível, dentro da caixa e em exatamente duas linhas,
 * porque o nome de 60 caracteres não cabe em uma e é cortado na segunda.
 */
async function expectNameInTwoLines(scope: Locator, maxWidth: number, label: string) {
  const name = scope.locator(`span[title="${ACME_NO_LOGO.productName}"]:visible`).first();
  await expect(name, label).toHaveText(ACME_NO_LOGO.productName);
  const box = await name.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      clamped: element.scrollHeight > element.clientHeight + 1,
    };
  });
  expect(box.width, `${label}: largura`).toBeLessThanOrEqual(maxWidth + 0.5);
  expect(box.height, `${label}: até duas linhas`).toBeLessThanOrEqual(2 * box.lineHeight + 1);
  expect(box.height, `${label}: quebra em duas linhas`).toBeGreaterThan(1.5 * box.lineHeight);
  expect(box.clamped, `${label}: cortado na segunda linha`).toBe(true);
}

test.describe('marca fictícia com o crédito ligado', () => {
  test.use({ baseURL: CREDIT_ON });

  test('a entrada mostra o nome, o ícone, o logo, o slogan e o crédito da marca, sem nada do programa', async ({
    page,
  }, testInfo) => {
    const programAssets = watchProgramAssets(page);
    await installCrmFixture(page, { signedIn: false });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Acesse seu CRM' })).toBeVisible();
    await expect(page).toHaveTitle(ACME.productName);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', ACME.productName);
    // O favicon é o ícone da marca, com o ?v= do conteúdo, servido com o tipo certo.
    const icon = page.locator('link[rel="icon"]');
    await expect(icon).toHaveCount(1);
    const href = (await icon.getAttribute('href'))!;
    expect(href).toMatch(/^\/brand\/acme-icon\.svg\?v=[0-9a-f]{8}$/);
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
    // Tema escuro (o padrão): o logo para fundo escuro, com o nome no texto alternativo.
    await expect(visibleLogo(page)).toHaveAttribute('src', /^\/brand\/acme-logo-on-dark\.svg\?v=[0-9a-f]{8}$/);
    await expect(visibleLogo(page)).toHaveAttribute('alt', ACME.productName);
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByText(ACME.productName, { exact: true })).toBeVisible();
    await expect(footer.getByText(CREDIT, { exact: true })).toBeVisible();
    if (!isMobile(testInfo)) {
      // O painel da entrada: o slogan, sem a arte (authImage vazio) e com o logo para fundo escuro.
      const panel = page.locator('aside.eia-auth-brand');
      await expect(panel.getByText(ACME.tagline, { exact: true })).toBeVisible();
      await expect(panel.locator('img.eia-auth-art')).toHaveCount(0);
    } else {
      // No celular, o logo do topo do formulário acompanha o tema.
      await page.getByRole('button', { name: 'Ativar tema claro' }).click();
      await expect(visibleLogo(page)).toHaveAttribute('src', /^\/brand\/acme-logo-on-light\.svg\?v=/);
    }
    expect(await textWithoutCredit(page)).not.toContain('Empreende');
    expect(await page.locator('img[src^="/brand/eia-"], img[src*="/materials/"]').count()).toBe(0);
    expect(programAssets).toEqual([]);
  });

  test('com sessão: o logo e o ícone no menu, o ícone no celular e a Ajuda com o suporte e o crédito', async ({
    page,
  }, testInfo) => {
    const programAssets = watchProgramAssets(page);
    await installCrmFixture(page, { theme: 'light' });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
    await expect(page).toHaveTitle(ACME.productName);
    if (isMobile(testInfo)) {
      await expect(page.locator('header.eia-page-header img[src^="/brand/acme-icon.svg"]')).toBeVisible();
    } else {
      // Menu expandido: o logo para fundo claro (tema claro); recolhido: o ícone.
      const home = page.getByRole('link', { name: 'Início' });
      await expect(home.locator('img:visible')).toHaveAttribute('src', /^\/brand\/acme-logo-on-light\.svg\?v=/);
      await expect(home.locator('img:visible')).toHaveAttribute('alt', ACME.productName);
      await page.getByRole('button', { name: 'Recolher menu' }).click();
      await expect(home.locator('img')).toHaveAttribute('src', /^\/brand\/acme-icon\.svg\?v=/);
      await page.getByRole('button', { name: 'Expandir menu' }).click();
    }
    expect(await textWithoutCredit(page)).not.toContain('Empreende');
    const help = await openHelp(page, testInfo);
    await expect(help.getByRole('link', { name: 'Falar com suporte' })).toHaveAttribute(
      'href',
      `mailto:${ACME.supportEmail}`,
    );
    await expect(help.getByText(CREDIT, { exact: true })).toBeVisible();
    // A pergunta sobre o crédito existe porque o crédito aparece.
    await expect(help.getByRole('button', { name: `O que significa “${CREDIT}”?`, exact: true })).toBeVisible();
    expect(await textWithoutCredit(page)).not.toContain('Empreende');
    await help.getByRole('searchbox', { name: 'Buscar nas perguntas frequentes' }).fill('logo');
    await expect(help.getByRole('button', { name: 'Como troco o nome e o logo do CRM?', exact: true })).toBeVisible();
    expect(programAssets).toEqual([]);
  });

  test('os arquivos exportados levam o nome da marca (desktop)', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo), 'As exportações são conferidas no desktop.');
    await installCrmFixture(page);
    await page.goto('/settings/integrations');
    const download = async (trigger: () => Promise<void>) => {
      const [file] = await Promise.all([page.waitForEvent('download'), trigger()]);
      return file.suggestedFilename();
    };
    expect(await download(() => page.getByRole('button', { name: 'Exportar contatos', exact: true }).click())).toBe(
      buildExportFileName(ACME.exportName, 'contatos', 'csv'),
    );
    expect(await download(() => page.getByRole('button', { name: 'Exportar reuniões', exact: true }).click())).toBe(
      buildExportFileName(ACME.exportName, 'agenda', 'ics'),
    );
    await page.goto('/reports');
    const report = await download(() => page.getByRole('button', { name: /^(Exportar )?CSV$/ }).click());
    expect(report).toMatch(/^oportunidades-acme-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(report).toBe(buildExportFileName('acme', 'oportunidades', 'csv', report.slice(19, 29)));
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`layout da entrada com a marca fictícia (${theme})`, async ({ page }, testInfo) => {
      const widths = isMobile(testInfo) ? [320, 375] : [1440];
      await installCrmFixture(page, { signedIn: false, theme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        await expect(page.getByRole('heading', { name: 'Acesse seu CRM' })).toBeVisible();
        await expectNoHorizontalScroll(page, `entrada ${width}px`);
        await expectLogoInBox(page, `entrada ${width}px`);
        // O rodapé com o nome longo fica dentro do painel do formulário.
        const panel = (await page.locator('.eia-auth-form-panel').boundingBox())!;
        const footer = (await page.getByRole('contentinfo').boundingBox())!;
        expect(footer.x).toBeGreaterThanOrEqual(panel.x - 0.5);
        expect(footer.x + footer.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
        await page.screenshot({ path: testInfo.outputPath(`marca-entrada-${theme}-${width}.png`), fullPage: true });
      }
    });

    test(`layout de Hoje com a marca fictícia (${theme})`, async ({ page }, testInfo) => {
      const widths = isMobile(testInfo) ? [320, 375] : [1440];
      await installCrmFixture(page, { theme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/dashboard');
        await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
        await expectNoHorizontalScroll(page, `Hoje ${width}px`);
        if (!isMobile(testInfo)) {
          // Menu expandido: o logo cabe na caixa de 128 × 36 px.
          const logo = (await page.getByRole('link', { name: 'Início' }).locator('img:visible').boundingBox())!;
          expect(logo.width).toBeLessThanOrEqual(128.5);
          expect(logo.height).toBeLessThanOrEqual(36.5);
        } else {
          const glyph = (await page.locator('header.eia-page-header img[src^="/brand/acme-icon.svg"]').boundingBox())!;
          expect(glyph.width).toBeLessThanOrEqual(28.5);
        }
        await page.screenshot({ path: testInfo.outputPath(`marca-hoje-${theme}-${width}.png`), fullPage: true });
      }
    });

    // Revisão do item 1.6 (AC-8): a página 404 também mostra o logo do tema na caixa de 176 × 48 px.
    test(`layout da página 404 com a marca fictícia (${theme})`, async ({ page }, testInfo) => {
      const widths = isMobile(testInfo) ? [320, 375] : [1440];
      await installCrmFixture(page, { signedIn: false, theme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(MISSING_PAGE);
        await expect(page.getByRole('heading', { name: 'Página não encontrada', exact: true })).toBeVisible();
        await expect(page).toHaveTitle(ACME.productName);
        await expectNoHorizontalScroll(page, `404 ${width}px`);
        await expect(visibleLogo(page)).toHaveAttribute('src', new RegExp(`^/brand/acme-logo-on-${theme}\\.svg\\?v=`));
        await expectLogoInBox(page, `404 ${width}px`);
        await page.screenshot({ path: testInfo.outputPath(`marca-404-${theme}-${width}.png`), fullPage: true });
      }
    });
  }
});

// Revisão do item 1.6: o 8099 serve a marca sem imagens (o recuo para o nome em texto e o monograma nunca apareciam num
// navegador) e desliga o crédito pela variável, que sobrepõe o "showBaseCredit": true do brand.json dela.
test.describe('marca fictícia sem imagens, com o crédito desligado (VITE_SHOW_BASE_CREDIT=false)', () => {
  test.use({ baseURL: CREDIT_OFF });

  test('a entrada mostra o nome em texto, sem ícone na aba e sem nada da base', async ({ page }, testInfo) => {
    const programAssets = watchProgramAssets(page);
    await installCrmFixture(page, { signedIn: false });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Acesse seu CRM' })).toBeVisible();
    await expect(page).toHaveTitle(ACME_NO_LOGO.productName);
    // Sem "icon" nem "favicon", nenhum <link rel="icon">: a aba fica com o ícone padrão do navegador.
    await expect(page.locator('link[rel="icon"]')).toHaveCount(0);
    // Sem logos, o nome em texto: no painel escuro (desktop) ou no topo do formulário (celular), em qualquer tema.
    const scope = isMobile(testInfo) ? page.locator('.eia-auth-form-panel') : page.locator('aside.eia-auth-brand');
    await expect(scope.locator(`span[title="${ACME_NO_LOGO.productName}"]:visible`)).toHaveCount(1);
    if (!isMobile(testInfo)) await expect(scope.getByText(ACME_NO_LOGO.tagline, { exact: true })).toBeVisible();
    expect(await page.locator('img[src^="/brand/"]').count()).toBe(0);
    await expect(page.getByRole('contentinfo')).toHaveText(ACME_NO_LOGO.productName);
    expect(await page.locator('body').innerText()).not.toContain('Empreende');
    expect(programAssets).toEqual([]);
  });

  test('com sessão, o monograma, Hoje e a Ajuda ficam sem o crédito e sem a pergunta sobre ele', async ({
    page,
  }, testInfo) => {
    const programAssets = watchProgramAssets(page);
    await installCrmFixture(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
    await expect(page).toHaveTitle(ACME_NO_LOGO.productName);
    // Sem ícone, a primeira letra do nome: no cabeçalho (celular) e no menu recolhido (desktop), que no expandido mostra
    // o nome em texto.
    if (isMobile(testInfo)) {
      await expect(page.locator('header.eia-page-header .eia-brand-icon')).toHaveText('A');
    } else {
      const home = page.getByRole('link', { name: 'Início' });
      await expect(home.locator(`span[title="${ACME_NO_LOGO.productName}"]:visible`)).toHaveCount(1);
      await page.getByRole('button', { name: 'Recolher menu' }).click();
      await expect(home.locator('.eia-brand-icon')).toHaveText('A');
      await page.getByRole('button', { name: 'Expandir menu' }).click();
    }
    expect(await page.locator('img[src^="/brand/"]').count()).toBe(0);
    expect(await page.locator('body').innerText()).not.toContain('Empreende');
    const help = await openHelp(page, testInfo);
    await expect(help.getByRole('link', { name: 'Falar com suporte' })).toBeVisible();
    await expect(help.getByText(CREDIT)).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('Empreende');
    await help.getByRole('searchbox', { name: 'Buscar nas perguntas frequentes' }).fill('credito');
    await expect(help.getByRole('button', { name: `O que significa “${CREDIT}”?` })).toHaveCount(0);
    expect(programAssets).toEqual([]);
  });

  // AC-8: o nome de 60 caracteres sem logo quebra em até duas linhas na entrada, na 404 e no menu, sem rolagem lateral.
  for (const theme of ['light', 'dark'] as const) {
    test(`layout da entrada com o nome em texto (${theme})`, async ({ page }, testInfo) => {
      const widths = isMobile(testInfo) ? [320, 375] : [1440];
      await installCrmFixture(page, { signedIn: false, theme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        await expect(page.getByRole('heading', { name: 'Acesse seu CRM' })).toBeVisible();
        await expectNoHorizontalScroll(page, `entrada ${width}px`);
        await expectNameInTwoLines(page.locator('body'), 176, `entrada ${width}px`);
        await page.screenshot({ path: testInfo.outputPath(`nome-entrada-${theme}-${width}.png`), fullPage: true });
      }
    });

    test(`layout da 404 e de Hoje com o nome em texto (${theme})`, async ({ page }, testInfo) => {
      const widths = isMobile(testInfo) ? [320, 375] : [1440];
      await installCrmFixture(page, { theme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(MISSING_PAGE);
        await expect(page.getByRole('heading', { name: 'Página não encontrada', exact: true })).toBeVisible();
        await expectNoHorizontalScroll(page, `404 ${width}px`);
        await expectNameInTwoLines(page.locator('body'), 176, `404 ${width}px`);
        await page.goto('/dashboard');
        await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
        await expectNoHorizontalScroll(page, `Hoje ${width}px`);
        // No menu expandido (desktop), a caixa de 128 px; no celular, o cabeçalho mostra só o monograma.
        if (!isMobile(testInfo))
          await expectNameInTwoLines(page.getByRole('link', { name: 'Início' }), 128, `menu ${width}px`);
        await page.screenshot({ path: testInfo.outputPath(`nome-hoje-${theme}-${width}.png`), fullPage: true });
      }
    });
  }
});
