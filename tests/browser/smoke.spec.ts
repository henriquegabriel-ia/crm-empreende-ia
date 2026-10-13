import { test, expect } from '@playwright/test';
import { readBrand } from '../../scripts/lib/brand.mjs';
import { createFixture, installCrmFixture } from './fixture';

const routes = [
  ['/dashboard', 'Hoje', 'Próximos passos do dia', 'activities'],
  ['/contacts', 'Contatos', 'Relacionamentos que movem o negócio', 'contacts'],
  ['/companies', 'Empresas', 'Sua rede de empresas', 'companies'],
  ['/pipeline', 'Pipeline', 'Projeto Exemplo', 'deals'],
  ['/activities', 'Atividades', 'O trabalho conectado ao relacionamento', 'activities'],
  ['/tasks', 'Tarefas', 'Cada tarefa com um próximo passo', 'activities'],
  ['/agenda', 'Agenda', 'Tempo reservado para boas conversas', 'activities'],
  ['/financeiro', 'Financeiro', 'Recebimentos com contexto.', 'payments'],
  ['/reports', 'Relatórios', 'Previsão ponderada', 'deals'],
  ['/automations', 'Automações', 'Retorno após criação', 'automations'],
  ['/templates', 'Modelos', 'Modelo de exemplo', 'email_templates'],
  ['/team', 'Equipe', 'Convidar uma pessoa', 'invitations'],
  ['/settings', 'Configurações', 'Seu nome', 'organizations'],
  // Integrações não lê dados ao abrir: importar e exportar dependem só do papel (roteiro, item 0.5).
  ['/settings/integrations', 'Integrações', 'Contatos por CSV', null],
  ['/settings/security', 'Segurança', 'Histórico de alterações', 'audit_logs'],
] as const;
for (const [path, title, text] of routes) {
  test(`render ${path}`, async ({ page }) => {
    await installCrmFixture(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Algo deu errado|Falha ao carregar o aplicativo/)).toHaveCount(0);
    expect(errors).toEqual([]);
    await expect(page.getByText('de outra organização', { exact: false })).toHaveCount(0);
  });
}
// Item 1.6: a aba mostra a marca da instância (public/brand/brand.json), qualquer que seja ela.
test('a aba mostra o nome e o ícone da marca da instância', async ({ page }) => {
  const brand = readBrand();
  await installCrmFixture(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(brand.productName);
  const icon = brand.favicon || brand.icon;
  const link = page.locator('link[rel="icon"]');
  if (!icon) await expect(link).toHaveCount(0);
  else {
    await expect(link).toHaveCount(1);
    const href = (await link.getAttribute('href'))!;
    expect(href.startsWith(`/brand/${icon}?v=`)).toBe(true);
    expect(href).toMatch(/\?v=[0-9a-f]{8}$/);
  }
});
for (const [path, , , table] of routes) {
  if (!table) continue;
  test(`erro e recuperação ${path}`, async ({ page }) => {
    const state = await installCrmFixture(page);
    state.failReads.add(table);
    await page.goto(path === '/settings' ? '/settings?tab=organization' : path);
    await expect(page.getByText(/Não foi possível|Falha ao/).first()).toBeVisible({ timeout: 20_000 });
    const retry = page.getByRole('button', { name: 'Tentar novamente', exact: true }).first();
    await expect(retry).toBeVisible();
    state.failReads.clear();
    await retry.click();
    await expect(page.getByText(/Não foi possível|Falha ao/).first()).not.toBeVisible({ timeout: 20_000 });
  });
}
for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 1440, height: 1000 },
  ]) {
    test(`layout ${theme} ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await installCrmFixture(page, { theme });
      for (const [path, title] of routes) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
        const geometry = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        }));
        expect(geometry.scroll, `${path} document overflow`).toBeLessThanOrEqual(geometry.width + 1);
        expect(geometry.body, `${path} body overflow`).toBeLessThanOrEqual(geometry.width + 1);
      }
      await page.goto('/contacts');
      await expect(page.getByText('Contato Alfa', { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`contacts-${theme}-${viewport.width}.png`), fullPage: true });
      await page.goto('/dashboard');
      await expect(page.getByText('Próximos passos do dia', { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`today-${theme}-${viewport.width}.png`), fullPage: true });
    });
  }
}

test('Integrações sem ativação: colaborador importa com prévia de telefone que cabe na tela', async ({ page }) => {
  const state = createFixture('member');
  state.tables.integration_configs = [];
  await installCrmFixture(page, { role: 'member', state });
  await page.goto('/settings/integrations');
  await expect(page.getByRole('button', { name: 'Exportar contatos', exact: true })).toHaveCount(0);
  await page.getByLabel('Importar arquivo CSV (até 500 contatos)', { exact: true }).setInputFiles({
    name: 'contatos.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      '\uFEFFfirst_name;last_name;email;phone\r\nNovo;Celular;novo.celular@example.test;+55 (21) 98765-4321\r\n',
    ),
  });
  const dialog = page.getByRole('dialog', { name: 'Revisar importação' });
  await expect(dialog.getByText('(21) 98765-4321', { exact: true })).toBeVisible();
  const geometry = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  await dialog.getByRole('button', { name: 'Confirmar importação de 1 contatos', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(state.tables.contacts.find((row) => row.email === 'novo.celular@example.test')?.phone).toBe('+5521987654321');
});
