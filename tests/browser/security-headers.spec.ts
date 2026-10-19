import { test, expect, cspViolations, expectCspViolation, type TestInfo } from './test';
import { headersFor } from '../../scripts/lib/security-headers.mjs';
import { createFixture, installCrmFixture } from './fixture';

// Item 1.3 (docs/arquitetura/1.3.md, seção 9.3): o build do E2E é servido com os cabeçalhos do vercel.json (plugin
// crm-security-headers no vite preview), e a guarda de tests/browser/test.ts reprova qualquer cenário com violação de
// CSP. Aqui, os cabeçalhos em si e o que a CSP precisa permitir e recusar, no desktop e no celular (o projeto
// mobile-chrome inclui este arquivo).

const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile-chrome';
// Com PLAYWRIGHT_DEV_SERVER=1, o servidor de desenvolvimento não tem CSP (o React Refresh injeta script inline).
test.skip(process.env.PLAYWRIGHT_DEV_SERVER === '1', 'o servidor de desenvolvimento não aplica os cabeçalhos');

test('o app e /brand/* respondem com os cabeçalhos do vercel.json, sem diferença', async ({ request }) => {
  for (const pathname of ['/', '/pipeline', '/brand/eia-icon.svg', '/theme-init.js']) {
    const response = await request.get(pathname);
    expect(response.status(), pathname).toBe(200);
    const actual = response.headers();
    for (const [key, value] of Object.entries(headersFor(pathname)))
      expect(actual[key.toLowerCase()], `${pathname} ${key}`).toBe(value);
  }
  const brand = (await request.get('/brand/eia-icon.svg')).headers()['content-security-policy'];
  expect(brand).toContain('sandbox');
  expect(brand).not.toContain('script-src');
  const app = (await request.get('/pipeline')).headers()['content-security-policy'];
  expect(app).toContain("frame-ancestors 'none'");
  expect(app).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co");
});

test('a entrada e o Hoje carregam sob a CSP, com a fonte Manrope e o logo da marca', async ({ page }) => {
  await installCrmFixture(page, { signedIn: false });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  const logo = page.locator('img[src*="/brand/"]:visible').first();
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth))
    .toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px Manrope'))).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.fonts].some((font) => font.family.includes('Manrope') && font.status === 'loaded'),
      ),
    )
    .toBe(true);

  await installCrmFixture(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
  expect(cspViolations(page)).toEqual([]);
});

test('o script de tema roda sob a CSP: o tema claro salvo já está no <html> antes do app', async ({ page }) => {
  await installCrmFixture(page, { theme: 'light' });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      (window as unknown as { __themeAtReady: string }).__themeAtReady =
        `${document.documentElement.dataset.eiaTheme}|${document.documentElement.className}`;
    });
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
  const atReady = await page.evaluate(() => (window as unknown as { __themeAtReady: string }).__themeAtReady);
  expect(atReady.split('|')[0]).toBe('light');
  expect(atReady.split('|')[1]).toContain('light');
  expect(atReady.split('|')[1]).not.toMatch(/\bdark\b/);
});

test('um script inline injetado não roda', async ({ page }, testInfo) => {
  // Só a violação do script injetado é esperada; qualquer outra no Hoje reprova pela guarda de tests/browser/test.ts.
  expectCspViolation(testInfo, /inline script.*script-src 'self'/);
  await installCrmFixture(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__inlineRan = true;';
    document.head.appendChild(script);
  });
  await expect.poll(() => cspViolations(page).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __inlineRan?: boolean }).__inlineRan)).toBeUndefined();
  expect(cspViolations(page).join('\n')).toMatch(/inline script.*script-src 'self'/);
});

// Achado 1 da revisão do item 1.3 (corrigido no item 1.13): o vercel.json também manda X-Frame-Options: DENY, que sozinho
// já recusa o quadro. Para o cenário cobrir a CSP, a resposta do quadro passa por page.route sem esse cabeçalho; o teste
// exige a recusa por frame-ancestors (a mensagem do console da página que hospeda o quadro) e compara com a URL aberta
// no quadro. Sem frame-ancestors no vercel.json, o app carregaria no quadro e o teste reprova.
test('o CRM não abre dentro de outro site (frame-ancestors)', async ({ page }, testInfo) => {
  expectCspViolation(testInfo, /frame-ancestors 'none'/);
  const framed = 'http://127.0.0.1:8096/';
  let servedWithoutFrameOptions = false;
  await page.route(framed, async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['x-frame-options'];
    servedWithoutFrameOptions = Boolean(headers['content-security-policy']);
    await route.fulfill({ response, headers });
  });
  await page.goto('about:blank');
  await page.setContent(`<iframe id="crm" src="${framed}" width="800" height="600"></iframe>`);
  await expect.poll(() => cspViolations(page).join('\n')).toMatch(/frame-ancestors 'none'/);
  expect(servedWithoutFrameOptions).toBe(true);
  expect(cspViolations(page).join('\n')).toContain(framed);
  // O quadro fica com a página de erro do navegador, sem o app: nada de #root nem do botão Entrar.
  const frame = page.frameLocator('#crm');
  await expect(frame.locator('#root')).toHaveCount(0);
  await expect(frame.getByRole('button', { name: 'Entrar' })).toHaveCount(0);
});

test('uma imagem de outro site não carrega: a foto do perfil cai nas iniciais', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), 'o avatar do perfil fica no menu lateral do desktop');
  expectCspViolation(testInfo, /imagens\.example.*img-src 'self'/);
  const state = createFixture();
  state.tables.profiles[0].avatar_url = 'https://imagens.example/foto.png';
  await page.context().route('https://imagens.example/**', (route) => route.abort());
  await installCrmFixture(page, { state });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
  await expect.poll(() => cspViolations(page).join('\n')).toMatch(/imagens\.example.*img-src 'self'/);
  await expect(page.locator('img[src="https://imagens.example/foto.png"]')).toHaveCount(0);
  await expect(page.getByText('PT', { exact: true }).first()).toBeVisible();
});
