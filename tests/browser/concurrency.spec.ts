import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { IDS, installCrmFixture, type FixtureRow, type FixtureState } from './fixture';

// Item 0.8 do roteiro: concorrência e dados atualizados entre colegas.
/** Outra pessoa salva o registro depois que a tela o leu: os campos mudam e a versão avança, como no banco. */
function colleagueSaves(row: FixtureRow, fields: Record<string, unknown>) {
  Object.assign(row, fields, { updated_at: new Date(Date.now() + 1000).toISOString() });
}
const find = (state: FixtureState, table: string, id: string) => state.tables[table].find((row) => row.id === id)!;
const guardedPatches = (state: FixtureState, table: string) =>
  state.requests.filter((request) => request.table === table && request.method === 'PATCH');
/** O TanStack Query trata o evento visibilitychange da janela como "voltou para a aba". */
const returnToTab = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

test('edição concorrente de contato mostra o conflito, preserva o rascunho e não sobrescreve', async ({ page }) => {
  const state = await installCrmFixture(page);
  const contact = find(state, 'contacts', IDS.contact);
  const read = String(contact.updated_at);
  await page.goto(`/contacts?contact=${IDS.contact}`);
  const panel = page.getByRole('dialog', { name: 'Contato Alfa' });
  await panel.getByRole('button', { name: 'Editar cadastro', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'Editar contato' });
  await editor.getByLabel('Nome *', { exact: true }).fill('Meu rascunho');
  colleagueSaves(contact, { first_name: 'Contato do colega' });
  await editor.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Este contato mudou ou não está mais disponível');
  await expect(editor.getByLabel('Nome *', { exact: true })).toHaveValue('Meu rascunho');
  expect(contact.first_name).toBe('Contato do colega');
  expect(new URLSearchParams(guardedPatches(state, 'contacts')[0].params).get('updated_at')).toBe(`eq.${read}`);
  // Recarregada, a ficha mostra a versão do colega; reabrir o cadastro a carrega, e ela pode ser salva.
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const updated = page.getByRole('dialog', { name: 'Contato do colega Alfa' });
  await updated.getByRole('button', { name: 'Editar cadastro', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Editar contato' });
  await expect(editor.getByLabel('Nome *', { exact: true })).toHaveValue('Contato do colega');
  await editor.getByLabel('Sobrenome', { exact: true }).fill('Revisado');
  await editor.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  await expect(editor).toBeHidden();
  expect(contact).toMatchObject({ first_name: 'Contato do colega', last_name: 'Revisado' });
});

test('edição concorrente de empresa mostra o conflito em vez de sobrescrever', async ({ page }) => {
  const state = await installCrmFixture(page);
  const company = find(state, 'companies', IDS.company);
  await page.goto(`/companies?company=${IDS.company}`);
  const panel = page.getByRole('dialog', { name: 'Empresa Exemplo' });
  await panel.getByRole('button', { name: 'Editar cadastro', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar cadastro de empresa' });
  await editor.getByLabel('Segmento', { exact: true }).fill('Meu segmento');
  colleagueSaves(company, { industry: 'Segmento do colega' });
  await editor.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Esta empresa mudou ou não está mais disponível');
  await expect(editor.getByLabel('Segmento', { exact: true })).toHaveValue('Meu segmento');
  expect(company.industry).toBe('Segmento do colega');
});

test('ficha 360 conclui pela guarda de versão e não desfaz a mudança do colega', async ({ page }) => {
  const state = await installCrmFixture(page, { role: 'member' });
  const activity = find(state, 'activities', IDS.activity);
  await page.goto(`/contacts?contact=${IDS.contact}`);
  const item = page.locator(`#activity-${IDS.activity}`);
  await expect(item.getByRole('heading', { name: 'Retorno de teste', exact: true })).toBeVisible();
  const completed = new Date().toISOString();
  colleagueSaves(activity, { completed_at: completed });
  await item.getByRole('button', { name: 'Concluir', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Esta atividade mudou' })).toBeVisible();
  expect(activity.completed_at).toBe(completed);
  const patch = guardedPatches(state, 'activities')[0];
  expect(new URLSearchParams(patch.params).has('updated_at')).toBe(true);
  // Recarregada, a ficha mostra a conclusão do colega e permite reabrir a versão atual.
  await expect(item.getByRole('button', { name: 'Reabrir', exact: true })).toBeVisible();
  await item.getByRole('button', { name: 'Reabrir', exact: true }).click();
  await expect.poll(() => activity.completed_at).toBeNull();
});

test('Configurações recusa sobrescrever etapa e regra alteradas por outra pessoa', async ({ page }) => {
  const state = await installCrmFixture(page);
  const stage = find(state, 'pipeline_stages', IDS.stage);
  await page.goto('/settings?tab=pipelines');
  await page.getByRole('button', { name: 'Editar Entrada', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Configurar etapa' });
  await editor.getByLabel('Nome', { exact: true }).fill('Minha etapa');
  colleagueSaves(stage, { name: 'Etapa do colega' });
  await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Esta etapa mudou ou não está mais disponível');
  await expect(editor.getByLabel('Nome', { exact: true })).toHaveValue('Minha etapa');
  expect(stage.name).toBe('Etapa do colega');

  await page.goto('/settings?tab=attention');
  const rule = state.tables.risk_rules.find((row) => row.type === 'overdue')!;
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Atividades vencidas' }) });
  await form.getByRole('combobox', { name: 'Prioridade', exact: true }).selectOption('2');
  colleagueSaves(rule, { priority: 3 });
  await form.getByRole('button', { name: 'Salvar regra', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Esta regra mudou' })).toBeVisible();
  expect(rule.priority).toBe(3);
  await form.getByRole('button', { name: 'Carregar versão atual', exact: true }).click();
  await expect(form.getByRole('combobox', { name: 'Prioridade', exact: true })).toHaveValue('3');
  await form.getByRole('combobox', { name: 'Prioridade', exact: true }).selectOption('2');
  await form.getByRole('button', { name: 'Salvar regra', exact: true }).click();
  await expect.poll(() => rule.priority).toBe(2);
});

test('Pipeline e Hoje mostram o que o colega fez ao voltar para a aba, sem recarga periódica', async ({ page }) => {
  await page.clock.install();
  const state = await installCrmFixture(page);
  const reads = (table: string) =>
    state.requests.filter((request) => request.table === table && request.method === 'GET').length;
  await page.goto('/pipeline');
  await expect(page.getByText('Projeto Exemplo', { exact: true }).first()).toBeVisible();
  colleagueSaves(find(state, 'deals', IDS.deal), { title: 'Projeto renomeado pelo colega' });
  const before = reads('deals');
  // Voltar logo em seguida não recarrega: os dados ainda têm menos de 30 s.
  await returnToTab(page);
  await page.clock.runFor(1000);
  expect(reads('deals')).toBe(before);
  await page.clock.fastForward(31_000);
  // Sem refetchInterval, ficar na aba não recarrega.
  await page.waitForTimeout(500);
  expect(reads('deals')).toBe(before);
  await returnToTab(page);
  await expect(page.getByText('Projeto renomeado pelo colega', { exact: true }).first()).toBeVisible();

  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Retorno de teste', exact: true })).toBeVisible();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  state.tables.activities.push({
    id: randomUUID(),
    org_id: IDS.org,
    title: 'Retorno atribuído pelo colega',
    type: 'task',
    body: null,
    due_date: yesterday,
    end_date: null,
    completed_at: null,
    contact_id: IDS.contact,
    company_id: null,
    deal_id: null,
    user_id: IDS.owner,
    created_by: IDS.viewer,
    created_at: yesterday,
    updated_at: yesterday,
  });
  await page.clock.fastForward(31_000);
  await returnToTab(page);
  await expect(page.getByRole('button', { name: 'Retorno atribuído pelo colega', exact: true })).toBeVisible();
});
