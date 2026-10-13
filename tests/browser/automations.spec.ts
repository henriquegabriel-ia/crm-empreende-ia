import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createFixture, IDS, installCrmFixture, type FixtureState } from './fixture';

// Item 0.7 do roteiro: exclusões que falhavam por vínculo e automações básicas.
const choose = async (page: Page, label: string, option: string) => {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};
const automation = (state: FixtureState) => state.tables.automations[0];

test('editar uma automação ativa não a pausa e grava o filtro de funil e etapa', async ({ page }) => {
  const state = createFixture();
  Object.assign(automation(state), { is_active: true, trigger_type: 'deal_moved' });
  await installCrmFixture(page, { state });
  await page.goto('/automations');
  await expect(page.getByText('Em qualquer etapa de qualquer funil', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Editar automação' });
  await expect(form.getByText('Automação ativa', { exact: true })).toBeVisible();
  await choose(page, 'Funil', 'Comercial');
  await choose(page, 'Etapa de entrada', 'Proposta');
  await form.getByLabel('Criar uma tarefa com o título *', { exact: true }).fill('Enviar proposta');
  await form.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText('Automação atualizada. Ela continua ativa para novos eventos.')).toBeVisible();
  expect(automation(state)).toMatchObject({
    is_active: true,
    pipeline_id: IDS.pipeline,
    stage_id: IDS.stage2,
    task_title: 'Enviar proposta',
  });
  const patch = state.requests.filter((r) => r.method === 'PATCH' && r.table === 'automations').at(-1)!;
  expect(patch.body).not.toHaveProperty('is_active');
  await expect(page.getByText('Ativa', { exact: true })).toBeVisible();
  await expect(page.getByText('Ao entrar na etapa Proposta do funil Comercial', { exact: true })).toBeVisible();
});

test('nova automação de mudança de etapa nasce pausada com o funil e a etapa escolhidos', async ({ page }) => {
  const state = await installCrmFixture(page);
  await page.goto('/automations');
  await page.getByRole('button', { name: 'Nova automação', exact: true }).first().click();
  const form = page.getByRole('dialog', { name: 'Nova automação' });
  await form.getByLabel('Nome *', { exact: true }).fill('Proposta enviada');
  await expect(form.getByRole('combobox', { name: 'Funil', exact: true })).toHaveCount(0);
  await choose(page, 'Quando acontecer *', 'Oportunidade mudou de etapa');
  await expect(form.getByRole('combobox', { name: 'Etapa de entrada', exact: true })).toBeDisabled();
  await choose(page, 'Funil', 'Comercial');
  await choose(page, 'Etapa de entrada', 'Proposta');
  await form.getByLabel('Criar uma tarefa com o título *', { exact: true }).fill('Enviar a proposta');
  await form.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(form).toBeHidden();
  const post = state.requests.filter((r) => r.method === 'POST' && r.table === 'automations').at(-1)!;
  expect(post.body).toMatchObject({
    name: 'Proposta enviada',
    trigger_type: 'deal_moved',
    is_active: false,
    pipeline_id: IDS.pipeline,
    stage_id: IDS.stage2,
  });
  await expect(page.getByText('Ao entrar na etapa Proposta do funil Comercial', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revisar e ativar', exact: true }).first().click();
  const review = page.getByRole('dialog', { name: 'Ativar esta automação?' });
  await expect(review).toContainText('Filtro: Ao entrar na etapa Proposta do funil Comercial.');
  await expect(review).toContainText('Prazo: 1 dia após o evento.');
});

test('administrador vê o detalhe técnico das falhas e exclui uma automação com histórico', async ({ page }) => {
  const state = createFixture();
  const automationId = automation(state).id;
  const failedId = randomUUID();
  state.tables.automation_logs.push(
    {
      id: failedId,
      org_id: IDS.org,
      automation_id: automationId,
      automation_name: 'Retorno após criação',
      deal_id: null,
      activity_id: null,
      status: 'failed',
      error_message: 'Não foi possível criar a tarefa. Revise os vínculos e o responsável.',
      error_detail: '23503: insert or update on table "activities" violates foreign key constraint',
      created_at: new Date().toISOString(),
    },
    {
      id: randomUUID(),
      org_id: IDS.org,
      automation_id: automationId,
      automation_name: 'Retorno após criação',
      deal_id: IDS.deal,
      activity_id: null,
      status: 'success',
      error_message: null,
      error_detail: null,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    },
  );
  await installCrmFixture(page, { state });
  await page.goto('/automations');
  await page.getByRole('button', { name: 'Execuções', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Retorno após criação' });
  await expect(
    history.getByText(
      'Detalhe técnico (só donos e administradores veem): 23503: insert or update on table "activities" violates foreign key constraint',
    ),
  ).toBeVisible();
  await expect(history.getByText('Oportunidade excluída', { exact: true })).toBeVisible();
  await expect(history.getByText('Tarefa excluída', { exact: true })).toBeVisible();
  await expect(history.getByRole('link', { name: 'Abrir oportunidade', exact: true })).toHaveCount(1);
  const logRead = state.requests.find((r) => r.method === 'GET' && r.table === 'automation_logs')!;
  expect(new URLSearchParams(logRead.params).get('select')).not.toMatch(/error_detail|\*/);
  await page.keyboard.press('Escape');
  await expect(history).toBeHidden();

  await page.getByRole('button', { name: 'Excluir Retorno após criação', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Excluir esta automação?' });
  await expect(confirmation).toContainText(
    'o histórico de execuções fica guardado no banco com o nome dela, mas deixa de aparecer nesta tela',
  );
  await confirmation.getByRole('button', { name: 'Excluir automação', exact: true }).click();
  await expect.poll(() => state.tables.automations.length).toBe(0);
  await expect(page.getByRole('heading', { name: 'Crie sua primeira rotina', exact: true })).toBeVisible();
  expect(state.tables.automation_logs).toHaveLength(2);
  expect(state.tables.automation_logs.every((log) => log.automation_id === null)).toBe(true);
  expect(state.tables.automation_logs.every((log) => log.automation_name === 'Retorno após criação')).toBe(true);
});

test('membro consulta as execuções sem detalhe técnico e sem exclusão', async ({ page }) => {
  const state = createFixture('member');
  state.tables.automation_logs.push({
    id: randomUUID(),
    org_id: IDS.org,
    automation_id: automation(state).id,
    automation_name: 'Retorno após criação',
    deal_id: IDS.deal,
    activity_id: null,
    status: 'failed',
    error_message: 'Não foi possível criar a tarefa. Revise os vínculos e o responsável.',
    error_detail: '23503: detalhe que o membro não lê',
    created_at: new Date().toISOString(),
  });
  await installCrmFixture(page, { role: 'member', state });
  await page.goto('/automations');
  await expect(page.getByText('Retorno após criação', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Excluir/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Execuções', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Retorno após criação' });
  await expect(history.getByText('Não foi possível criar a tarefa. Revise os vínculos e o responsável.')).toBeVisible();
  await expect(history.getByText(/Detalhe técnico/)).toHaveCount(0);
  expect(state.requests.filter((r) => r.table === 'automation_log_errors')).toHaveLength(0);
});

test('excluir oportunidade com vínculos mostra as contagens e mantém os registros sem o vínculo', async ({ page }) => {
  const state = createFixture();
  state.tables.automation_logs.push({
    id: randomUUID(),
    org_id: IDS.org,
    automation_id: automation(state).id,
    automation_name: 'Retorno após criação',
    deal_id: IDS.deal,
    activity_id: IDS.activity,
    status: 'success',
    error_message: null,
    error_detail: null,
    created_at: new Date().toISOString(),
  });
  await installCrmFixture(page, { state });
  await page.goto(`/pipeline?deal=${IDS.deal}`);
  const panel = page.getByRole('dialog', { name: 'Projeto Exemplo' });
  await panel.getByRole('button', { name: 'Excluir', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Excluir oportunidade?' });
  await expect(
    confirmation.getByText('2 atividades, 1 recebimento e 1 registro de automação', { exact: true }),
  ).toBeVisible();
  await expect(confirmation).toContainText('2 atividades e 1 recebimento continuam no CRM, sem o vínculo com ela.');
  await expect(confirmation).toContainText('1 registro de automação fica no histórico, sem o vínculo.');
  await confirmation.getByRole('button', { name: 'Desvincular e excluir', exact: true }).click();
  await expect.poll(() => state.tables.deals.some((deal) => deal.id === IDS.deal)).toBe(false);
  await expect(
    page.getByText('Oportunidade excluída. 2 atividades e 1 recebimento ficaram sem o vínculo.'),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/deal=/);
  const rpc = state.requests.find((r) => r.table === 'delete_deal')!;
  expect(rpc.body).toEqual({ p_deal_id: IDS.deal, p_confirm: true });
  expect(state.requests.filter((r) => r.method === 'DELETE' && r.table === 'deals')).toHaveLength(0);
  expect(state.tables.activities.map((a) => [a.id, a.deal_id])).toEqual([
    [IDS.activity, null],
    [IDS.meeting, null],
  ]);
  expect(state.tables.payments.every((p) => p.deal_id === null)).toBe(true);
  expect(state.tables.automation_logs[0]).toMatchObject({ deal_id: null, automation_name: 'Retorno após criação' });
});

test('a ficha 360 conta recebimentos ao avaliar a exclusão e explica o bloqueio', async ({ page }) => {
  const state = createFixture();
  const contactId = randomUUID();
  state.tables.contacts.push({
    id: contactId,
    org_id: IDS.org,
    first_name: 'Cliente',
    last_name: 'Financeiro',
    email: 'financeiro@example.test',
    phone: null,
    company_id: null,
    owner_id: IDS.owner,
    status: 'customer',
    job_title: null,
    source: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  state.tables.payments.push({
    id: randomUUID(),
    org_id: IDS.org,
    deal_id: null,
    contact_id: contactId,
    company_id: null,
    description: 'Mensalidade avulsa',
    amount: 300,
    currency: 'BRL',
    due_date: new Date().toISOString().slice(0, 10),
    paid_at: null,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await installCrmFixture(page, { state });
  await page.goto(`/contacts?contact=${contactId}`);
  const panel = page.getByRole('dialog', { name: 'Cliente Financeiro' });
  await expect(
    panel.getByText('A exclusão está indisponível porque este cadastro tem vínculos: 1 recebimento.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Excluir cadastro', exact: true })).toBeDisabled();
  await expect(panel.getByRole('link', { name: 'Financeiro', exact: true })).toHaveAttribute('href', '/financeiro');
  expect(state.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0);
});
