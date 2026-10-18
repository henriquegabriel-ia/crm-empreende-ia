import { test, expect, type Page } from './test';
import { randomUUID } from 'node:crypto';
import { createFixture, IDS, installCrmFixture, withVolume, type FixtureRow, type FixtureState } from './fixture';

// Item 0.10 do roteiro: desempenho mínimo com volume no cliente.
const OTHER_DEAL = '77777777-7777-4777-8777-777777777779';
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const moveMenu = (page: Page, title: string) =>
  page.getByRole('button', { name: `Mover ou alterar situação de ${title}`, exact: true });
const pipelineDealReads = (state: FixtureState) =>
  state.requests.filter((r) => r.table === 'deals' && r.method === 'GET' && r.params.includes('created_at.desc'))
    .length;
/** Segura a resposta de move_deal até `release()`, para ver o quadro antes da resposta do banco. */
function holdMoves(state: FixtureState) {
  let release!: () => void;
  state.holds = new Map([['move_deal', new Promise<void>((resolve) => (release = resolve))]]);
  return () => release();
}
function withSecondDeal(state: FixtureState) {
  const first = state.tables.deals[0];
  state.tables.deals.push({ ...first, id: OTHER_DEAL, title: 'Contrato de suporte', value: 1000 });
  return state;
}
const screenReady = (page: Page, screen: string) =>
  page.evaluate(
    (name) =>
      performance.getEntriesByName('screen-ready').filter((entry) => (entry as PerformanceMark).detail?.screen === name)
        .length,
    screen,
  );

test('kanban move o card na hora, trava só ele e aplica a linha devolvida por move_deal', async ({ page }) => {
  const state = withSecondDeal(createFixture());
  const release = holdMoves(state);
  await installCrmFixture(page, { state });
  await page.goto('/pipeline');
  const entry = page.getByRole('region', { name: 'Etapa Entrada' });
  const proposal = page.getByRole('region', { name: 'Etapa Proposta' });
  await expect(entry.getByRole('article', { name: 'Projeto Exemplo' })).toBeVisible();
  const readsBefore = pipelineDealReads(state);
  const requestsBefore = state.requests.length;
  await moveMenu(page, 'Projeto Exemplo').click();
  await page.getByRole('menuitem', { name: 'Proposta', exact: true }).click();

  // Antes da resposta do banco: o card já está em Proposta, travado; o outro continua livre.
  const moved = proposal.getByRole('article', { name: 'Projeto Exemplo' });
  await expect(moved).toBeVisible();
  await expect(moved).toHaveAttribute('aria-busy', 'true');
  await expect(entry.getByRole('article', { name: 'Projeto Exemplo' })).toHaveCount(0);
  await expect(moveMenu(page, 'Projeto Exemplo')).toBeDisabled();
  // O card foi montado de novo na coluna de destino: o foco volta para ele, em vez de cair no body.
  await expect(moved.getByRole('button', { name: 'Projeto Exemplo', exact: true })).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Salvando a movimentação de Projeto Exemplo' })).toHaveCount(
    1,
  );
  await expect(moveMenu(page, 'Contrato de suporte')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Nova oportunidade', exact: true })).toBeEnabled();
  expect(state.tables.deals.find((d) => d.id === IDS.deal)?.stage_id).toBe(IDS.stage);
  // O outro card pode ser movido enquanto o primeiro espera a resposta.
  await moveMenu(page, 'Contrato de suporte').click();
  await page.getByRole('menuitem', { name: 'Proposta', exact: true }).click();
  await expect(proposal.getByRole('article', { name: 'Contrato de suporte' })).toHaveAttribute('aria-busy', 'true');
  await expect(moved).toHaveAttribute('aria-busy', 'true');

  release();
  await expect.poll(() => state.tables.deals.find((d) => d.id === IDS.deal)?.stage_id).toBe(IDS.stage2);
  await expect.poll(() => state.tables.deals.find((d) => d.id === OTHER_DEAL)?.stage_id).toBe(IDS.stage2);
  await expect(proposal.getByRole('article', { name: 'Contrato de suporte' })).not.toHaveAttribute('aria-busy');
  await expect(moved).not.toHaveAttribute('aria-busy');
  await expect(moveMenu(page, 'Projeto Exemplo')).toBeEnabled();
  // Uma confirmação para cada movimentação.
  await expect(page.getByText('Etapa atualizada.', { exact: true })).toHaveCount(2);
  // A linha veio na resposta de move_deal: a lista de oportunidades e as referências do quadro não foram relidas.
  await page.waitForTimeout(300);
  expect(pipelineDealReads(state)).toBe(readsBefore);
  // Invalidação por chave: só o que lê tabelas alteradas pela movimentação recarrega (as próximas ações, que uma
  // automação pode criar, e a evidência do guia inicial); o papel da pessoa e as referências do quadro, não.
  const after = state.requests.slice(requestsBefore).filter((r) => r.method === 'GET');
  expect(after.some((r) => r.table === 'activities' && r.params.includes('deal_id=not.is.null'))).toBe(true);
  expect(after.filter((r) => r.table === 'user_roles' || r.params.includes('order=name'))).toEqual([]);
  // A versão gravada pelo banco já está no cache: editar em seguida não dá falso conflito.
  await moved.getByRole('button', { name: 'Projeto Exemplo', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Projeto Exemplo' });
  await panel.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Nome da oportunidade *', { exact: true }).fill('Projeto Exemplo revisado');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect.poll(() => state.tables.deals.find((d) => d.id === IDS.deal)?.title).toBe('Projeto Exemplo revisado');
});

test('falha ao mover devolve o card à etapa de origem e mostra o motivo', async ({ page }) => {
  const state = withSecondDeal(createFixture());
  const release = holdMoves(state);
  state.failWrites.add('move_deal');
  await installCrmFixture(page, { state });
  await page.goto('/pipeline');
  const entry = page.getByRole('region', { name: 'Etapa Entrada' });
  const proposal = page.getByRole('region', { name: 'Etapa Proposta' });
  await moveMenu(page, 'Projeto Exemplo').click();
  await page.getByRole('menuitem', { name: 'Proposta', exact: true }).click();
  await expect(proposal.getByRole('article', { name: 'Projeto Exemplo' })).toBeVisible();
  release();
  await expect(entry.getByRole('article', { name: 'Projeto Exemplo' })).toBeVisible();
  await expect(proposal.getByRole('article', { name: 'Projeto Exemplo' })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Falha intencional de teste' })).toBeVisible();
  expect(state.tables.deals.find((d) => d.id === IDS.deal)?.stage_id).toBe(IDS.stage);
  // O card volta a aceitar movimentação, e o outro nunca foi travado.
  await expect(moveMenu(page, 'Projeto Exemplo')).toBeEnabled();
  await expect(moveMenu(page, 'Contrato de suporte')).toBeEnabled();
});

test('movimentação gravada com a resposta perdida: o quadro relê a lista e mostra a etapa do banco', async ({
  page,
}) => {
  const state = createFixture();
  state.loseNextWriteResponse.add('move_deal');
  await installCrmFixture(page, { state });
  await page.goto('/pipeline');
  const entry = page.getByRole('region', { name: 'Etapa Entrada' });
  const proposal = page.getByRole('region', { name: 'Etapa Proposta' });
  await expect(entry.getByRole('article', { name: 'Projeto Exemplo' })).toBeVisible();
  const readsBefore = pipelineDealReads(state);
  await moveMenu(page, 'Projeto Exemplo').click();
  await page.getByRole('menuitem', { name: 'Proposta', exact: true }).click();
  // A resposta não chegou, mas o banco gravou: depois da falha, a lista é relida e o card fica na etapa gravada.
  await expect.poll(() => pipelineDealReads(state)).toBeGreaterThan(readsBefore);
  expect(state.tables.deals.find((d) => d.id === IDS.deal)?.stage_id).toBe(IDS.stage2);
  const moved = proposal.getByRole('article', { name: 'Projeto Exemplo' });
  await expect(moved).toBeVisible();
  await expect(moved).not.toHaveAttribute('aria-busy');
  await expect(entry.getByRole('article', { name: 'Projeto Exemplo' })).toHaveCount(0);
  // A versão relida é a do banco: editar em seguida não dá falso conflito.
  await moved.getByRole('button', { name: 'Projeto Exemplo', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Projeto Exemplo' });
  await panel.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Nome da oportunidade *', { exact: true }).fill('Projeto Exemplo revisado');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect.poll(() => state.tables.deals.find((d) => d.id === IDS.deal)?.title).toBe('Projeto Exemplo revisado');
});

test('Hoje agrupa muitos contatos sem próxima ação num item com link para o diretório filtrado', async ({ page }) => {
  const state = createFixture();
  const contact = (name: string, created: string): FixtureRow => ({
    id: randomUUID(),
    org_id: IDS.org,
    first_name: name,
    last_name: 'Importado',
    email: null,
    phone: null,
    company_id: null,
    owner_id: IDS.owner,
    status: 'lead',
    job_title: null,
    source: null,
    notes: null,
    created_at: created,
    updated_at: created,
  });
  // 12 contatos importados há 3 dias e 3 importados há 1 hora, todos sem atividade.
  for (let i = 1; i <= 12; i++) state.tables.contacts.push(contact(`Antigo ${i}`, hoursAgo(72)));
  for (let i = 1; i <= 3; i++) state.tables.contacts.push(contact(`Recente ${i}`, hoursAgo(1)));
  await installCrmFixture(page, { state });
  await page.goto('/dashboard');
  const queue = page.locator('[data-tour="today-attention"]');
  const group = queue.getByRole('link', { name: '12 contatos sem próxima ação', exact: true });
  await expect(group).toBeVisible();
  await expect(group).toHaveAttribute('href', '/contacts?scope=no-action');
  await expect(queue.getByText(/há mais de 1 dia/)).toBeVisible();
  await expect(queue.getByText(/Antigo \d+ Importado|Recente \d+ Importado/)).toHaveCount(0);
  // A atividade vencida continua visível, e não escondida por 12 itens de contato.
  await expect(queue.getByRole('link', { name: 'Retorno de teste', exact: true })).toBeVisible();
  expect(await screenReady(page, 'dashboard')).toBe(1);

  await queue.getByRole('link', { name: 'Ver contatos sem próxima ação', exact: true }).click();
  await expect(page).toHaveURL(/\/contacts\?scope=no-action/);
  await expect(page.getByRole('button', { name: 'Sem próxima ação', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // O diretório lista todos os contatos sem próxima ação, inclusive os importados há 1 hora.
  await expect(page.getByText(/^1–15 de 15/)).toBeVisible();
  // Navegação dentro do app: a montagem escondida do RouteTransition não marca a tela pronta; só a visível.
  expect(await screenReady(page, 'contacts')).toBe(1);
});

test('Contatos lê mais de 2 mil registros em páginas paralelas, sem cortar, e marca a tela pronta', async ({
  page,
}) => {
  const state = createFixture();
  withVolume(state, { counts: { companies: 40, contacts: 2200, deals: 80, activities: 700 } });
  await installCrmFixture(page, { state });
  await page.goto('/contacts');
  await expect(page.getByText(/^1–25 de 2201/)).toBeVisible();
  const offsets = state.requests
    .filter((r) => r.table === 'contacts' && r.method === 'GET' && r.params.includes('select=*'))
    .map((r) => Number(new URLSearchParams(r.params).get('offset')));
  // Páginas de 1000 linhas: a primeira com o total e as outras duas em paralelo, cada uma começando na última linha
  // da anterior (a sobreposição que confere a continuidade).
  expect(offsets.sort((a, b) => a - b)).toEqual([0, 999, 1998]);
  expect(await screenReady(page, 'contacts')).toBe(1);
  // A busca acha um contato da última página, pelo nome da empresa (índice por id).
  const last = state.tables.contacts.findLast((c) => c.org_id === IDS.org && c.company_id)!;
  const company = state.tables.companies.find((c) => c.id === last.company_id)!;
  await page.getByLabel('Pesquisar por nome, e-mail, telefone ou empresa').fill(String(last.email));
  await expect(page.getByRole('cell', { name: String(company.name) })).toBeVisible();
});
