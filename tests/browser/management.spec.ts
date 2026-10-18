import { expect, test, type Locator, type Page, type TestInfo } from './test';
import { randomUUID } from 'node:crypto';
import { createFixture, IDS, installCrmFixture, withTeam, type FixtureRow, type FixtureState } from './fixture';

// Item 1.14 (docs/arquitetura/1.14.md): gestão mínima e cadastro básico, no desktop e no celular (o projeto
// mobile-chrome inclui este arquivo). O recorte de uma pessoa em Hoje, Atividades, Tarefas e Agenda, com quem foi
// desativado marcado e o número do menu sempre da conta; "Ganhos por responsável" nos Relatórios, pela data de
// fechamento, no período e no funil; e a origem do contato em lista fixa, com "Outra" e o valor antigo preservado. O
// relógio do navegador começa ao meio-dia de hoje em São Paulo (o fuso do E2E), para "vencida" e "hoje" não dependerem
// da hora da rodada.

const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile-chrome';
const HOUR = 3_600_000;
function noonToday() {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(`${day}T12:00:00-03:00`);
}
const NOON = noonToday();
const at = (hours: number) => new Date(NOON.getTime() + hours * HOUR).toISOString();
const ID = (n: number) => `88888888-8888-4888-8888-1${String(n).padStart(11, '0')}`;

function activity(id: string, title: string, extra: Partial<FixtureRow> = {}): FixtureRow {
  return {
    id,
    org_id: IDS.org,
    title,
    type: 'task',
    body: null,
    due_date: at(-2),
    end_date: null,
    completed_at: null,
    contact_id: null,
    company_id: null,
    deal_id: null,
    user_id: IDS.owner,
    created_by: IDS.owner,
    outcome: null,
    created_at: at(-72),
    updated_at: at(-72),
    ...extra,
  };
}

/**
 * A equipe do item 1.2 com Fulano Vendedor já desativado: a oportunidade em aberto e as tarefas pendentes passaram para
 * Bruna (D9), e o contato e a empresa ficaram com ele, como quando quem desativa desmarca "Passar também os contatos e
 * as empresas". A rotina: duas vencidas da conta (o dono), uma vencida e uma reunião hoje às 15h da Bruna, a ligação
 * já concluída do Fulano e uma reunião da Carla hoje às 17h (na mesma semana da Agenda, qualquer que seja o dia).
 */
function withManagedTeam(state: FixtureState) {
  withTeam(state);
  state.tables.user_roles.find((row) => row.user_id === IDS.leaving)!.deactivated_at = at(-24);
  for (const deal of state.tables.deals)
    if (deal.owner_id === IDS.leaving && deal.status === 'open') deal.owner_id = IDS.recipient;
  state.tables.activities = [
    activity(ID(1), 'Enviar proposta da conta', { due_date: at(-26) }),
    activity(ID(2), 'Retornar orçamento da conta', { due_date: at(-3) }),
    activity(ID(3), 'Cobrar retorno da Bruna', { due_date: at(-5), user_id: IDS.recipient }),
    activity(ID(4), 'Reunião da Bruna', {
      type: 'meeting',
      due_date: at(3),
      end_date: at(4),
      user_id: IDS.recipient,
    }),
    activity(ID(5), 'Ligação feita pelo Fulano', {
      type: 'call',
      due_date: at(-48),
      completed_at: at(-47),
      user_id: IDS.leaving,
    }),
    activity(ID(6), 'Reunião da Carla', {
      type: 'meeting',
      due_date: at(5),
      end_date: at(6),
      user_id: IDS.admin,
    }),
  ];
  return state;
}

async function open(page: Page, state: FixtureState, path: string, theme?: 'light' | 'dark') {
  await page.clock.install({ time: NOON });
  await installCrmFixture(page, { state, theme });
  await page.goto(path);
}
/** O link "Hoje" com os lembretes, no menu lateral do desktop ou na navegação inferior do celular. */
function todayLink(page: Page, testInfo: TestInfo, name: string): Locator {
  const scope = isMobile(testInfo)
    ? page.getByRole('navigation', { name: 'Navegação principal mobile' })
    : page.locator('aside.eia-rail');
  return scope.getByRole('link', { name, exact: true });
}
const statValue = (page: Page, label: string) =>
  page
    .locator('.eia-stat')
    .filter({ has: page.locator('.eia-stat-label', { hasText: new RegExp(`^${label}$`) }) })
    .locator('.eia-stat-value');
/** Opções de um seletor do DS (Radix), na ordem em que aparecem; fecha o seletor no fim. */
async function selectOptions(page: Page, trigger: Locator) {
  await trigger.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const texts = (await listbox.getByRole('option').allInnerTexts()).map((text) => text.trim());
  await page.keyboard.press('Escape');
  await expect(listbox).toBeHidden();
  return texts;
}
async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
}
/**
 * Abre a criação pelo botão do topo (no celular, só o ícone, com o nome acessível da tela), confere o "Responsável" com
 * que a atividade nova começa e fecha sem gravar.
 */
async function expectNewActivityOwner(page: Page, button: RegExp, owner: string) {
  await page.getByRole('button', { name: button }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Responsável', { exact: true })).toHaveText(owner);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
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
const PEOPLE = ['Bruna Recebedora', 'Carla Administradora', 'Leitor de Teste', 'Fulano Vendedor (desativado)'];

test('Hoje mostra a rotina de outra pessoa, inclusive de quem saiu, e o número do menu continua o da conta', async ({
  page,
}, testInfo) => {
  const state = withManagedTeam(createFixture());
  await open(page, state, '/dashboard');
  const menuLabel = 'Hoje, 2 atividades vencidas';
  await expect(todayLink(page, testInfo, menuLabel)).toBeVisible();
  const routine = page.getByRole('combobox', { name: 'Recorte da rotina' });
  await expect(routine).toHaveText('Minha rotina');
  await expect(statValue(page, 'Vencidas')).toHaveText('2');
  // A própria conta fica em "Minha rotina"; as pessoas ativas vêm em ordem alfabética, e quem saiu, por último e marcado.
  expect(await selectOptions(page, routine)).toEqual(['Minha rotina', 'Toda a organização', ...PEOPLE]);

  await choose(page, routine, 'Bruna Recebedora');
  await expect(page).toHaveURL(new RegExp(`owner=${IDS.recipient}`));
  await expect(page.getByText('Você está vendo a rotina de Bruna Recebedora.')).toBeVisible();
  // A vencida das 7h e a reunião das 15h são de hoje; só a das 7h venceu.
  await expect(statValue(page, 'Vencidas')).toHaveText('1');
  await expect(statValue(page, 'Para hoje')).toHaveText('2');
  const day = page.locator('[data-tour="today-activities"]');
  await expect(
    day.getByText('O número ao lado de “Hoje”, no menu, continua contando só as suas.', { exact: false }),
  ).toBeVisible();
  for (const title of ['Cobrar retorno da Bruna', 'Reunião da Bruna'])
    await expect(day.getByRole('button', { name: title, exact: true })).toBeVisible();
  await expect(day.getByRole('button', { name: 'Enviar proposta da conta', exact: true })).toHaveCount(0);
  // O menu não muda: o número é sempre o da conta que usa o CRM.
  await expect(todayLink(page, testInfo, menuLabel)).toBeVisible();
  // A atividade nova nasce na rotina que está na tela (revisão do item 1.14).
  await expectNewActivityOwner(page, /^Nova atividade$/, 'Bruna Recebedora');

  // Quem saiu: as tarefas passaram para Bruna, mas o contato ficou com ele, e a fila mostra a carteira que ficou.
  await choose(page, routine, 'Fulano Vendedor (desativado)');
  await expect(routine).toContainText('(desativado)');
  await expect(page.getByText('Você está vendo a rotina de Fulano Vendedor (desativado).')).toBeVisible();
  await expect(statValue(page, 'Vencidas')).toHaveText('0');
  const attention = page.locator('[data-tour="today-attention"]');
  await expect(attention.getByRole('listitem').filter({ hasText: 'Cliente do Fulano' }).first()).toContainText(
    'Contato ativo com responsável desativado.',
  );
  await expect(attention.getByText('Enviar proposta da conta')).toHaveCount(0);
  // Sem pendências até hoje, o estado vazio cita a pessoa; as pendentes dela passaram para Bruna (D9), e "Ver atividades"
  // abre "Todas", com o histórico (revisão do item 1.14). A atividade nova começa com a conta, porque ele saiu.
  await expect(
    day.getByText('Fulano Vendedor (desativado) não tem atividades pendentes com prazo até hoje.', { exact: false }),
  ).toBeVisible();
  await expect(day.getByRole('link', { name: /Ver atividades/ })).toHaveAttribute(
    'href',
    `/activities?owner=${IDS.leaving}&status=all`,
  );
  await expectNewActivityOwner(page, /^Nova atividade$/, 'Pessoa de Teste');

  // "Ver atividades" leva a Atividades com a mesma pessoa.
  await choose(page, routine, 'Bruna Recebedora');
  await day.getByRole('link', { name: /Ver atividades/ }).click();
  await expect(page).toHaveURL(new RegExp(`/activities\\?owner=${IDS.recipient}&status=pending`));
  await expect(page.getByRole('combobox', { name: 'Responsável pelas atividades' })).toHaveText('Bruna Recebedora');
  await expect(page.getByRole('status').filter({ hasText: 'de 2 atividades' })).toBeVisible();
  await expect(todayLink(page, testInfo, menuLabel)).toBeVisible();
  // Em Atividades e na Agenda, a criação também começa com a pessoa escolhida (no celular, o botão de Atividades se chama
  // "Criar").
  await expectNewActivityOwner(page, /^(Nova atividade|Criar)$/, 'Bruna Recebedora');
  await page.goto(`/agenda?owner=${IDS.recipient}`);
  await expectNewActivityOwner(page, /^Novo compromisso$/, 'Bruna Recebedora');
});

test('Atividades, Tarefas e Agenda filtram por pessoa, com o histórico de quem saiu, para qualquer papel', async ({
  page,
}, testInfo) => {
  // Somente leitura também escolhe uma pessoa: hoje toda a equipe vê a carteira de todos (D11).
  const state = withManagedTeam(createFixture('viewer'));
  await open(page, state, `/activities?owner=${IDS.leaving}`);
  const owner = page.getByRole('combobox', { name: 'Responsável pelas atividades' });
  await expect(owner).toContainText('Fulano Vendedor');
  await expect(owner).toContainText('(desativado)');
  // Em "Pendentes", quem saiu não tem nada (as pendentes passaram a quem recebeu a carteira, D9): o estado vazio explica
  // e leva ao histórico (revisão do item 1.14).
  await expect(page.getByText('Nenhuma atividade pendente com esta pessoa')).toBeVisible();
  await page.getByRole('button', { name: 'Ver o histórico', exact: true }).click();
  await expect(page).toHaveURL(/status=all/);
  const situation = page.getByRole('combobox', { name: 'Situação das atividades' });
  await expect(situation).toHaveText('Todas');
  await expect(page.getByRole('button', { name: 'Ligação feita pelo Fulano', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'de 1 atividades' })).toBeVisible();
  // O outro caminho que a Ajuda ensina: "Concluídas / notas".
  await choose(page, situation, 'Concluídas / notas');
  await expect(page).toHaveURL(/status=completed/);
  await expect(page.getByRole('button', { name: 'Ligação feita pelo Fulano', exact: true })).toBeVisible();
  // A conta do leitor fica em "Minhas atividades"; o dono (Pessoa de Teste) entra na lista.
  expect(await selectOptions(page, owner)).toEqual([
    'Toda a organização',
    'Minhas atividades',
    'Sem responsável',
    'Bruna Recebedora',
    'Carla Administradora',
    'Pessoa de Teste',
    'Fulano Vendedor (desativado)',
  ]);
  await choose(page, owner, 'Pessoa de Teste');
  await expect(page).toHaveURL(new RegExp(`owner=${IDS.owner}`));
  await expect(page.getByText('Nenhuma atividade nestes filtros')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).first().click();
  await expect(owner).toHaveText('Toda a organização');

  await page.goto(`/tasks?owner=${IDS.recipient}`);
  await expect(page.getByRole('combobox', { name: 'Responsável pelas atividades' })).toHaveText('Bruna Recebedora');
  await expect(page.getByRole('button', { name: 'Cobrar retorno da Bruna', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar proposta da conta', exact: true })).toHaveCount(0);

  await page.goto('/agenda');
  const agendaOwner = page.getByRole('combobox', { name: 'Responsável pelos compromissos' });
  await expect(agendaOwner).toHaveText('Toda a organização');
  await choose(page, agendaOwner, 'Bruna Recebedora');
  await expect(page).toHaveURL(new RegExp(`owner=${IDS.recipient}`));
  await expect(page.getByRole('button', { name: 'Reunião da Bruna', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reunião da Carla', exact: true })).toHaveCount(0);
  await choose(page, agendaOwner, 'Carla Administradora');
  await expect(page.getByRole('button', { name: 'Reunião da Carla', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reunião da Bruna', exact: true })).toHaveCount(0);
  // O leitor não tem rotina própria: o menu continua sem número, qualquer que seja a pessoa escolhida.
  await expect(todayLink(page, testInfo, 'Hoje')).toBeVisible();
});

/** Datas fixas no fuso do E2E: os Relatórios recortam pelo dia local do navegador. */
const local = (day: string, hour = 15) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00-03:00`).toISOString();
const PIPELINE_2 = '55555555-5555-4555-8555-555555555556';
const STAGE_3 = '66666666-6666-4666-8666-666666666668';
/**
 * Ganhas para "Ganhos por responsável", sobre a equipe de `withTeam`: em agosto, duas da Bruna (uma criada em julho), a
 * do Fulano (que saiu) e a da Carla no funil "Pós-venda"; em setembro, uma da Bruna criada em agosto; uma perdida em
 * agosto e as em aberto, que não contam.
 */
function withWins(state: FixtureState) {
  state.tables.user_roles.find((row) => row.user_id === IDS.leaving)!.deactivated_at = local('2026-09-01');
  const base = state.tables.deals.find((row) => row.id === IDS.deal)!;
  const won = (
    title: string,
    owner: string,
    value: number,
    closed: string,
    created: string,
    pipeline = IDS.pipeline,
  ) => ({
    ...base,
    id: randomUUID(),
    title,
    owner_id: owner,
    value,
    status: 'won',
    probability: 100,
    pipeline_id: pipeline,
    stage_id: pipeline === IDS.pipeline ? IDS.stage2 : STAGE_3,
    contact_id: null,
    company_id: null,
    created_at: created,
    updated_at: closed,
    closed_at: closed,
  });
  const fulano = state.tables.deals.find((row) => row.title === 'Venda ganha pelo Fulano')!;
  Object.assign(fulano, { closed_at: local('2026-08-20'), created_at: local('2026-08-01'), value: 2400 });
  state.tables.pipelines.push({ ...state.tables.pipelines[0], id: PIPELINE_2, name: 'Pós-venda', is_default: false });
  state.tables.pipeline_stages.push({
    ...state.tables.pipeline_stages[0],
    id: STAGE_3,
    pipeline_id: PIPELINE_2,
    name: 'Renovação',
  });
  state.tables.deals.push(
    won('Venda da Bruna em agosto', IDS.recipient, 1000, local('2026-08-05'), local('2026-08-01')),
    won('Venda da Bruna criada em julho', IDS.recipient, 3000.5, local('2026-08-25'), local('2026-07-10')),
    won('Venda da Bruna em setembro', IDS.recipient, 700, local('2026-09-02'), local('2026-08-15')),
    won('Renovação da Carla', IDS.admin, 5000, local('2026-08-12'), local('2026-08-01'), PIPELINE_2),
    {
      ...won('Perdida em agosto', IDS.owner, 9000, local('2026-08-10'), local('2026-08-01')),
      status: 'lost',
      probability: 0,
      lost_reason: 'Preço',
    },
  );
  return state;
}
const winsRows = (page: Page) =>
  page.getByRole('list', { name: 'Ganhos por responsável' }).getByRole('listitem').allInnerTexts();
const normalized = (texts: string[]) => texts.map((text) => text.replace(/\s+/g, ' ').trim());

test('Relatórios mostram os ganhos por responsável pela data de fechamento, no período e no funil', async ({
  page,
}) => {
  const state = withWins(withTeam(createFixture()));
  await open(page, state, '/reports?from=2026-08-01&to=2026-08-31');
  await expect(page.getByRole('heading', { name: 'Ganhos por responsável' })).toBeVisible();
  // Ativos primeiro, pelo maior valor; quem saiu depois, marcado. A venda criada em julho conta em agosto (fechamento),
  // e a criada em agosto e ganha em setembro, não; perdidas e em aberto não contam.
  await expect
    .poll(async () => normalized(await winsRows(page)))
    .toEqual([
      'Carla Administradora (1 oportunidade) R$ 5.000,00',
      'Bruna Recebedora (2 oportunidades) R$ 4.000,50',
      'Fulano Vendedor (desativado) (1 oportunidade) R$ 2.400,00',
    ]);
  // O funil recorta também os ganhos: "Comercial" tira a renovação da Carla, no "Pós-venda".
  await choose(page, page.getByRole('combobox', { name: 'Filtrar funil' }), 'Comercial');
  await expect
    .poll(async () => normalized(await winsRows(page)))
    .toEqual([
      'Bruna Recebedora (2 oportunidades) R$ 4.000,50',
      'Fulano Vendedor (desativado) (1 oportunidade) R$ 2.400,00',
    ]);
  // Setembro: só a venda da Bruna fechada em setembro.
  await page.getByLabel('Período de', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Até', { exact: true }).fill('2026-09-30');
  await expect
    .poll(async () => normalized(await winsRows(page)))
    .toEqual(['Bruna Recebedora (1 oportunidade) R$ 700,00']);
  // O responsável escolhido recorta o painel como o resto da tela.
  await page.goto('/reports?from=2026-08-01&to=2026-08-31&owner=' + IDS.leaving);
  await expect
    .poll(async () => normalized(await winsRows(page)))
    .toEqual(['Fulano Vendedor (desativado) (1 oportunidade) R$ 2.400,00']);
  await page.goto('/reports?from=2026-10-01&to=2026-10-31&pipeline=' + PIPELINE_2);
  await expect(page.getByText('Nenhuma oportunidade ganha neste recorte.')).toBeVisible();
});

/** Contatos com origens: o valor antigo fora da lista, um "whatsapp" minúsculo de uma planilha, um da lista e um vazio. */
function withSources(state: FixtureState) {
  const alfa = state.tables.contacts.find((row) => row.id === IDS.contact)!;
  Object.assign(alfa, { source: 'Feira de março' });
  const base = { ...alfa, company_id: null, email: null, phone: null };
  state.tables.contacts.push(
    { ...base, id: randomUUID(), first_name: 'Beto', last_name: 'Zap', source: 'whatsapp' },
    { ...base, id: randomUUID(), first_name: 'Clara', last_name: 'Indicada', source: 'Indicação' },
    { ...base, id: randomUUID(), first_name: 'Davi', last_name: 'Sem Origem', source: null },
  );
  return state;
}
const contactNames = (page: Page) =>
  page
    .locator('[data-tour="contacts-list"] tbody tr')
    .evaluateAll((rows) => rows.map((row) => row.querySelector('td button')?.textContent?.trim() ?? ''));

test('a origem do contato usa a lista, mantém o valor antigo em “Outra” e filtra em Contatos', async ({ page }) => {
  const state = withSources(createFixture());
  await open(page, state, '/contacts?columns=source,owner');
  const table = page.locator('[data-tour="contacts-list"] table');
  await expect(table.getByRole('columnheader', { name: 'Origem' })).toBeVisible();
  // A da lista aparece pelo nome dela ("whatsapp" vira "WhatsApp"); a de fora, como foi escrita.
  await expect(table.getByRole('row').filter({ hasText: 'Beto Zap' })).toContainText('WhatsApp');
  await expect(table.getByRole('row').filter({ hasText: 'Contato Alfa' })).toContainText('Feira de março');
  const filter = page.getByRole('combobox', { name: 'Filtrar origem' });
  expect(await selectOptions(page, filter)).toEqual([
    'Todas as origens',
    'WhatsApp',
    'Telefone',
    'E-mail',
    'Site',
    'Indicação',
    'Outras origens',
    'Sem origem',
  ]);
  await choose(page, filter, 'Outras origens');
  await expect(page).toHaveURL(/source=other/);
  await expect.poll(() => contactNames(page)).toEqual(['Contato Alfa']);
  await choose(page, filter, 'WhatsApp');
  await expect.poll(() => contactNames(page)).toEqual(['Beto Zap']);
  await choose(page, filter, 'Sem origem');
  await expect.poll(() => contactNames(page)).toEqual(['Davi Sem Origem']);
  await page.getByRole('button', { name: 'Limpar filtros' }).first().click();
  await expect(filter).toHaveText('Todas as origens');
  await expect.poll(async () => (await contactNames(page)).length).toBe(4);

  // Editar: o valor antigo abre em "Outra", com o texto; trocar pela lista grava o nome dela.
  await page.goto(`/contacts?contact=${IDS.contact}`);
  const panel = page.getByRole('dialog', { name: 'Contato Alfa' });
  await expect(panel.getByText('Feira de março')).toBeVisible();
  await panel.getByRole('button', { name: 'Editar cadastro', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar contato' });
  const source = editor.getByRole('combobox', { name: 'Origem', exact: true });
  await expect(source).toHaveText('Outra');
  await expect(editor.getByLabel('Outra origem', { exact: true })).toHaveValue('Feira de março');
  await choose(page, source, 'Indicação');
  await expect(editor.getByLabel('Outra origem', { exact: true })).toHaveCount(0);
  await editor.getByLabel('Cargo', { exact: true }).fill('Compradora');
  await editor.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  await expect(editor).toBeHidden();
  const patch = state.requests.filter((request) => request.table === 'contacts' && request.method === 'PATCH').at(-1)!;
  expect(patch.body).toMatchObject({ source: 'Indicação', job_title: 'Compradora' });
  const updated = page.getByRole('dialog', { name: 'Contato Alfa' });
  await expect(updated.getByText('Indicação', { exact: true })).toBeVisible();
  await expect(updated.getByText('Compradora', { exact: true })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 375, height: 812 },
    { width: 1440, height: 1000 },
  ]) {
    test(`recorte de pessoa, ganhos por responsável e origem sem rolagem horizontal (${theme}, ${viewport.width}px)`, async ({
      page,
    }, testInfo) => {
      test.skip(isMobile(testInfo), 'As larguras são conferidas no projeto do desktop.');
      await page.setViewportSize(viewport);
      const state = withSources(withWins(withManagedTeam(createFixture())));
      await open(page, state, `/dashboard?owner=${IDS.leaving}`, theme);
      const routine = page.getByRole('combobox', { name: 'Recorte da rotina' });
      await expect(routine).toContainText('(desativado)');
      await expectNoHorizontalScroll(page, 'Hoje com a rotina de quem saiu');
      // A marca "(desativado)" fica dentro do seletor, sem ser cortada.
      const [box, mark] = await Promise.all([
        routine.boundingBox(),
        routine.getByText('(desativado)', { exact: false }).boundingBox(),
      ]);
      expect(mark!.x + mark!.width).toBeLessThanOrEqual(box!.x + box!.width);
      await page.screenshot({
        path: testInfo.outputPath(`hoje-pessoa-${theme}-${viewport.width}.png`),
        fullPage: true,
      });
      await page.goto(`/agenda?owner=${IDS.leaving}`);
      await expect(page.getByRole('combobox', { name: 'Responsável pelos compromissos' })).toContainText(
        '(desativado)',
      );
      await expectNoHorizontalScroll(page, 'Agenda com quem saiu');
      await page.goto('/reports?from=2026-08-01&to=2026-08-31');
      const wins = page.getByRole('list', { name: 'Ganhos por responsável' });
      await expect(wins).toBeVisible();
      await expectNoHorizontalScroll(page, 'Relatórios com os ganhos por responsável');
      // Cada linha cabe na largura: o nome quebra, e o valor fica inteiro ao lado.
      for (const row of await wins.getByRole('listitem').all()) {
        const [line, value] = await Promise.all([row.boundingBox(), row.locator('span').last().boundingBox()]);
        expect(value!.x + value!.width).toBeLessThanOrEqual(line!.x + line!.width + 1);
      }
      await wins.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`ganhos-${theme}-${viewport.width}.png`) });
      await page.goto('/contacts?source=other&columns=source,owner');
      await expect(page.getByRole('combobox', { name: 'Filtrar origem' })).toHaveText('Outras origens');
      await expectNoHorizontalScroll(page, 'Contatos com o filtro de origem');
      await page.goto(`/contacts?contact=${IDS.contact}`);
      await page
        .getByRole('dialog', { name: 'Contato Alfa' })
        .getByRole('button', { name: 'Editar cadastro', exact: true })
        .click();
      const editor = page.getByRole('dialog', { name: 'Editar contato' });
      const other = editor.getByLabel('Outra origem', { exact: true });
      await other.scrollIntoViewIfNeeded();
      await expect(other).toBeInViewport();
      await expectNoHorizontalScroll(page, 'Editar cadastro com "Outra"');
      await page.screenshot({ path: testInfo.outputPath(`origem-${theme}-${viewport.width}.png`) });
    });
  }
}
