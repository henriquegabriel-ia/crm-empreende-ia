import { test, expect, type Page } from './test';
import { readFile } from 'node:fs/promises';
import { createFixture, IDS, installCrmFixture } from './fixture';

// Item 0.6 do roteiro: data de fechamento (closed_at) e probabilidade que herda a etapa.
const WON_ID = '77777777-7777-4777-8777-777777777778';
// O navegador do teste roda em America/Sao_Paulo (playwright.config.ts); os dias são calculados no mesmo fuso.
const saoPauloDay = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
const ptBR = (day: string) => day.split('-').reverse().join('/');
const stat = (page: Page, label: string) =>
  page.locator('.eia-stat').filter({ has: page.getByText(label, { exact: true }) });

test('venda criada em agosto e ganha em outubro aparece em outubro nos Relatórios', async ({ page }) => {
  const state = createFixture();
  state.tables.deals.push({
    id: WON_ID,
    org_id: IDS.org,
    pipeline_id: IDS.pipeline,
    stage_id: IDS.stage2,
    title: 'Venda de agosto ganha em outubro',
    value: 5000,
    currency: 'BRL',
    contact_id: IDS.contact,
    company_id: IDS.company,
    owner_id: IDS.owner,
    close_date: null,
    probability: 100,
    status: 'won',
    lost_reason: null,
    closed_at: '2026-10-05T15:00:00.000Z',
    stage_entered_at: '2026-08-20T15:00:00.000Z',
    created_at: '2026-08-10T15:00:00.000Z',
    updated_at: '2026-10-05T15:00:00.000Z',
  });
  await installCrmFixture(page, { state });

  await page.goto('/reports?from=2026-10-01&to=2026-10-31');
  await expect(page.getByLabel('Período de', { exact: true })).toHaveValue('2026-10-01');
  await expect(page.getByText('Base de data: fechamento', { exact: true })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Venda de agosto ganha em outubro' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('05/10/2026');
  await expect(page.getByRole('img', { name: /^Ganha: 1 de \d+$/ })).toBeVisible();
  await expect(stat(page, 'Ganhas')).toContainText(/R\$\s5\.000,00/);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar CSV', exact: true }).click(),
  ]);
  const csv = (await readFile(await file.path())).toString('utf8');
  expect(csv).toContain('"Criada em";"Fechada em"');
  expect(csv).toMatch(/"Venda de agosto ganha em outubro";.*"10\/08\/2026,? 12:00:00";"05\/10\/2026,? 12:00:00"/);

  await page.goto('/reports?from=2026-08-01&to=2026-08-31');
  await expect(page.getByText('Base de data: fechamento', { exact: true })).toBeVisible();
  await expect(page.getByText('Venda de agosto ganha em outubro', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: /^Ganha: 0 de \d+$/ })).toBeVisible();
});

test('ganhar pela interface grava a data de fechamento e a edição corrige o dia', async ({ page }) => {
  const state = await installCrmFixture(page);
  await page.goto(`/pipeline?deal=${IDS.deal}`);
  const panel = page.getByRole('dialog', { name: 'Projeto Exemplo' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('10% (da etapa)', { exact: true })).toBeVisible();
  await expect(panel.getByText('Fechada em', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: /Mover ou alterar situação/ }).click();
  await page.getByRole('menuitem', { name: 'Marcar como ganha', exact: true }).click();
  await expect.poll(() => state.tables.deals.find((d) => d.id === IDS.deal)?.status).toBe('won');
  const deal = state.tables.deals.find((d) => d.id === IDS.deal)!;
  expect(deal.probability).toBe(100);
  const today = saoPauloDay(new Date());
  expect(saoPauloDay(new Date(String(deal.closed_at)))).toBe(today);
  await expect(panel.getByText('Fechada em', { exact: true })).toBeVisible();
  await expect(panel.getByText('100%', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Editar', exact: true }).click();
  const closedAt = page.getByLabel('Fechada em *', { exact: true });
  await expect(closedAt).toHaveValue(today);
  await expect(page.getByLabel('Probabilidade (%)', { exact: true })).toBeDisabled();
  const realDay = saoPauloDay(new Date(Date.now() - 3 * 86_400_000));
  await closedAt.fill(realDay);
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect
    .poll(() => saoPauloDay(new Date(String(state.tables.deals.find((d) => d.id === IDS.deal)?.closed_at))))
    .toBe(realDay);
  const patch = state.requests.filter((r) => r.method === 'PATCH' && r.table === 'deals').at(-1)!;
  expect(patch.body).toMatchObject({ probability: 100 });
  expect(saoPauloDay(new Date(String((patch.body as { closed_at: string }).closed_at)))).toBe(realDay);
  await expect(panel.getByText(ptBR(realDay), { exact: true })).toBeVisible();
});

test('probabilidade em branco herda a etapa e a previsão ponderada acompanha a mudança de etapa', async ({ page }) => {
  const state = await installCrmFixture(page);
  await page.goto('/pipeline');
  await expect(page.getByText('Projeto Exemplo', { exact: true }).first()).toBeVisible();
  // 2.400,00 × 10% (etapa Entrada), porque a oportunidade não define probabilidade.
  await expect(stat(page, 'Previsão ponderada')).toContainText(/R\$\s240,00/);
  await page.getByRole('button', { name: 'Mover ou alterar situação de Projeto Exemplo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Proposta', exact: true }).click();
  await expect.poll(() => state.tables.deals.find((d) => d.id === IDS.deal)?.stage_id).toBe(IDS.stage2);
  expect(state.tables.deals.find((d) => d.id === IDS.deal)?.probability).toBeNull();
  // Agora 2.400,00 × 50% (etapa Proposta).
  await expect(stat(page, 'Previsão ponderada')).toContainText(/R\$\s1\.200,00/);

  await page.goto('/pipeline?create=1');
  await page.getByLabel('Nome da oportunidade *', { exact: true }).fill('Herdando da etapa');
  await page.getByLabel('Valor (BRL) *', { exact: true }).fill('1.000');
  const probability = page.getByLabel('Probabilidade (%)', { exact: true });
  await expect(probability).toHaveValue('');
  await expect(page.getByText('Da etapa: 10%', { exact: true })).toBeVisible();
  // Criar já ganha avisa que o fechamento é o dia do cadastro; voltar para "Em aberto" tira o aviso.
  const status = page.getByLabel('Situação', { exact: true });
  await status.click();
  await page.getByRole('option', { name: 'Ganha', exact: true }).click();
  await expect(status).toHaveAccessibleDescription(
    'Será registrada como ganha hoje. A data de fechamento não pode ser anterior ao cadastro, então uma venda de dias anteriores entra nos Relatórios hoje.',
  );
  await status.click();
  await page.getByRole('option', { name: 'Em aberto', exact: true }).click();
  await expect(page.getByText(/Será registrada como/)).toHaveCount(0);
  await expect(probability).toHaveValue('');
  await page.getByRole('button', { name: 'Criar oportunidade', exact: true }).click();
  const created = page.getByRole('dialog', { name: 'Herdando da etapa' });
  await expect(created).toBeVisible();
  const post = state.requests.filter((r) => r.method === 'POST' && r.table === 'deals').at(-1)!;
  expect(post.body).toMatchObject({ title: 'Herdando da etapa', value: 1000, probability: null });
  expect(post.body).not.toHaveProperty('closed_at');
  await expect(created.getByText('10% (da etapa)', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  // 2.400,00 × 50% + 1.000,00 × 10%.
  await expect(stat(page, 'Previsão ponderada')).toContainText(/R\$\s1\.300,00/);
});
