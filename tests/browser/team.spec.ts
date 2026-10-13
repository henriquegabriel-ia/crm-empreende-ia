import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createFixture, IDS, installCrmFixture, withTeam, type FixtureState } from './fixture';

// Item 1.2 (docs/arquitetura/1.2.md, seção 10.4): desativar um membro e passar a carteira, reativar, "Passar carteira",
// os seletores sem quem saiu, a marca "(desativado)" e a tela "Seu acesso foi encerrado", no desktop e no celular.

const roleRow = (state: FixtureState, userId: string) => state.tables.user_roles.find((row) => row.user_id === userId)!;
const returnToTab = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
const card = (page: Page, name: string) => page.getByRole('article').filter({ hasText: name });
const section = (page: Page, title: RegExp) => page.getByRole('region', { name: title });

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

/** Fulano já desativado, com a passagem registrada: as oportunidades e a tarefa foram para Bruna; contatos e empresas ficaram. */
function deactivateFulano(state: FixtureState, { keepAccounts = true } = {}) {
  const now = new Date().toISOString();
  roleRow(state, IDS.leaving).deactivated_at = now;
  let deals = 0,
    activities = 0;
  for (const deal of state.tables.deals)
    if (deal.owner_id === IDS.leaving && deal.status === 'open') {
      deal.owner_id = IDS.recipient;
      deals++;
    }
  for (const activity of state.tables.activities)
    if (activity.user_id === IDS.leaving && !activity.completed_at) {
      activity.user_id = IDS.recipient;
      activities++;
    }
  if (!keepAccounts)
    for (const row of [...state.tables.contacts, ...state.tables.companies])
      if (row.owner_id === IDS.leaving) row.owner_id = IDS.recipient;
  state.tables.portfolio_transfers.push({
    id: randomUUID(),
    org_id: IDS.org,
    from_user_id: IDS.leaving,
    to_user_id: IDS.recipient,
    performed_by: IDS.owner,
    deactivation: true,
    accounts_transferred: !keepAccounts,
    deals,
    activities,
    contacts: keepAccounts ? 0 : 1,
    companies: keepAccounts ? 0 : 1,
    invitations: 0,
    created_at: now,
  });
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

test('o dono desativa um colaborador e passa a carteira: contagens, destinatário obrigatório e o pedido certo', async ({
  page,
}) => {
  const state = withTeam(createFixture());
  await installCrmFixture(page, { state });
  await page.goto('/team');
  await expect(section(page, /Pessoas ativas \(5\)/)).toBeVisible();
  await expect(section(page, /Pessoas desativadas/)).toHaveCount(0);
  await card(page, 'Fulano Vendedor').getByRole('button', { name: 'Desativar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Desativar Fulano Vendedor' });
  await expect(dialog.getByRole('list', { name: 'Carteira de Fulano Vendedor' }).getByRole('listitem')).toHaveText([
    '1 oportunidade em aberto',
    '1 atividade pendente',
    '1 contato',
    '1 empresa',
  ]);
  const confirm = dialog.getByRole('button', { name: 'Confirmar desativação' });
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByLabel(/Passar também os contatos e as empresas/)).toBeChecked();
  const recipient = dialog.getByLabel('Quem recebe a carteira *');
  // Só quem está ativo e edita, sem a própria pessoa e sem o leitor.
  await expect(recipient.locator('option')).toHaveText([
    'Escolha uma pessoa',
    'Bruna Recebedora',
    'Carla Administradora',
    'Pessoa de Teste',
  ]);
  await recipient.selectOption({ label: 'Bruna Recebedora' });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.getByText(
      'O acesso de Fulano Vendedor foi desativado. Bruna Recebedora recebeu 1 oportunidade em aberto, 1 atividade pendente, 1 contato e 1 empresa.',
    ),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  const deactivated = section(page, /Pessoas desativadas \(1\)/);
  await expect(deactivated.getByRole('heading', { name: 'Fulano Vendedor (desativado)' })).toBeVisible();
  await expect(deactivated).toContainText(/Acesso desativado em \d{2}\/\d{2}\/\d{4}/);
  await expect(deactivated).toContainText(
    'Carteira passada por Pessoa de Teste para Bruna Recebedora: 1 oportunidade em aberto, 1 atividade pendente, 1 contato e 1 empresa.',
  );
  await expect(section(page, /Pessoas ativas \(4\)/)).toBeVisible();
  expect(state.teamCalls?.find((call) => call.rpc === 'deactivate_member')?.body).toEqual({
    p_user_id: IDS.leaving,
    p_transfer_accounts: true,
    p_recipient_id: IDS.recipient,
  });
  expect(state.tables.deals.filter((deal) => deal.owner_id === IDS.leaving).map((deal) => deal.status)).toEqual([
    'won',
  ]);
});

test('depois da desativação: novo responsável no Pipeline, "(desativado)" no histórico e seletores sem quem saiu', async ({
  page,
}) => {
  const state = withTeam(createFixture());
  deactivateFulano(state);
  await installCrmFixture(page, { state });
  await page.goto('/pipeline?status=all');
  await expect(page.getByRole('article', { name: 'Contrato do Fulano' })).toContainText('Bruna Recebedora');
  await expect(page.getByRole('article', { name: 'Venda ganha pelo Fulano' })).toContainText(
    'Fulano Vendedor (desativado)',
  );
  // O filtro lista os ativos e, depois, quem foi desativado, marcado: o histórico continua filtrável.
  expect(await selectOptions(page, page.getByRole('combobox', { name: 'Filtrar responsável' }))).toEqual([
    'Todos os responsáveis',
    'Sem responsável',
    'Bruna Recebedora',
    'Carla Administradora',
    'Leitor de Teste',
    'Pessoa de Teste',
    'Fulano Vendedor (desativado)',
  ]);
  await page.goto('/pipeline?create=1');
  const dealForm = page.getByRole('dialog', { name: 'Nova oportunidade' });
  const dealOwners = await selectOptions(page, dealForm.getByLabel(/^Responsável/));
  expect(dealOwners).toContain('Bruna Recebedora');
  expect(dealOwners.some((option) => option.includes('Fulano'))).toBe(false);
  await page.goto('/tasks?action=new');
  const activityForm = page.getByRole('dialog', { name: 'Nova atividade' });
  const owners = await selectOptions(page, activityForm.getByLabel('Responsável'));
  expect(owners).toContain('Bruna Recebedora');
  expect(owners.some((option) => option.includes('Fulano'))).toBe(false);
  // O contato que ficou com Fulano mostra o valor marcado, que pode ser trocado.
  const contact = state.tables.contacts.find((row) => row.owner_id === IDS.leaving)!;
  await page.goto(`/contacts?contact=${contact.id}`);
  const sheet = page.getByRole('dialog', { name: 'Cliente do Fulano' });
  await expect(sheet).toContainText('Fulano Vendedor (desativado)');
  await sheet.getByRole('button', { name: 'Editar cadastro', exact: true }).click();
  const editor = page.getByRole('dialog', { name: /Editar contato/ });
  const contactOwners = await selectOptions(page, editor.getByLabel('Responsável'));
  expect(contactOwners.at(-1)).toBe('Fulano Vendedor (desativado)');
  expect(contactOwners.filter((option) => option.includes('Fulano'))).toHaveLength(1);
  // Relatórios marcam quem saiu na tabela e no CSV, e chamam o funil de funil (achado 9 da revisão da Ajuda).
  await page.goto('/reports');
  await expect(page.getByRole('row').filter({ hasText: 'Venda ganha pelo Fulano' })).toContainText(
    'Fulano Vendedor (desativado)',
  );
  await expect(page.getByRole('combobox', { name: 'Filtrar funil' })).toContainText('Todos os funis');
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /^(Exportar )?CSV$/ }).click(),
  ]);
  const csv = (await readFile(await file.path())).toString('utf8');
  expect(csv).toContain('"Oportunidade";"Funil"');
  expect(csv).toMatch(/"Venda ganha pelo Fulano";.*"Fulano Vendedor \(desativado\)"/);
});

test('o histórico marca quem saiu: filtro dos Relatórios, lista de Contatos, atividades concluídas e movimentações', async ({
  page,
}) => {
  const state = withTeam(createFixture());
  deactivateFulano(state, { keepAccounts: true });
  // Uma ligação que Fulano concluiu e a movimentação em que ele ganhou a venda: o histórico continua no nome dele.
  const won = state.tables.deals.find((row) => row.title === 'Venda ganha pelo Fulano')!;
  const call = {
    ...state.tables.activities.find((row) => row.id === IDS.activity)!,
    id: randomUUID(),
    type: 'call',
    title: 'Ligação concluída por Fulano',
    user_id: IDS.leaving,
    created_by: IDS.leaving,
    contact_id: null,
    company_id: null,
    deal_id: null,
    completed_at: new Date().toISOString(),
  };
  state.tables.activities.push(call);
  state.tables.deal_stage_history.push({
    id: randomUUID(),
    org_id: IDS.org,
    deal_id: won.id,
    from_stage_id: IDS.stage,
    to_stage_id: IDS.stage2,
    from_status: 'open',
    to_status: 'won',
    changed_by: IDS.leaving,
    created_at: new Date().toISOString(),
  });
  await installCrmFixture(page, { state });
  // Relatórios: o filtro de responsável lista os ativos e, depois, quem saiu, marcado (como o do Pipeline).
  await page.goto('/reports');
  expect(await selectOptions(page, page.getByRole('combobox', { name: 'Filtrar responsável' }))).toEqual([
    'Todos os responsáveis',
    'Sem responsável',
    'Bruna Recebedora',
    'Carla Administradora',
    'Leitor de Teste',
    'Pessoa de Teste',
    'Fulano Vendedor (desativado)',
  ]);
  // Contatos: a coluna "Responsável" da lista.
  await page.goto('/contacts');
  await expect(page.getByRole('row').filter({ hasText: 'Cliente do Fulano' })).toContainText(
    'Fulano Vendedor (desativado)',
  );
  // Atividades: a lista das concluídas e o detalhe.
  await page.goto('/activities?status=completed');
  await expect(page.getByRole('listitem').filter({ hasText: 'Ligação concluída por Fulano' })).toContainText(
    'Fulano Vendedor (desativado)',
  );
  await page.goto(`/activities?status=completed&activity=${call.id}`);
  const detail = page.getByRole('dialog', { name: 'Ligação concluída por Fulano' });
  await expect(detail.locator('dt', { hasText: 'Responsável' }).locator('xpath=following-sibling::dd[1]')).toHaveText(
    'Fulano Vendedor (desativado)',
  );
  // Pipeline: o autor da movimentação, no histórico da oportunidade.
  await page.goto(`/pipeline?status=all&deal=${won.id}`);
  const panel = page.getByRole('dialog', { name: 'Venda ganha pelo Fulano' });
  const history = panel
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Histórico de movimentações' }) });
  await expect(history.getByRole('listitem').filter({ hasText: 'Ganha' })).toContainText(
    'Fulano Vendedor (desativado)',
  );
});

test('corrida: a carteira mudou entre a abertura e a confirmação, e o diálogo pede o destinatário', async ({
  page,
}) => {
  const state = withTeam(createFixture());
  await installCrmFixture(page, { state });
  await page.goto('/team');
  await card(page, 'Bruna Recebedora').getByRole('button', { name: 'Desativar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Desativar Bruna Recebedora' });
  await expect(
    dialog.getByText('Bruna Recebedora não tem oportunidades em aberto, atividades pendentes, contatos nem empresas.'),
  ).toBeVisible();
  // Um colega atribui uma oportunidade a Bruna antes da confirmação.
  const deal = state.tables.deals.find((row) => row.id === IDS.deal)!;
  state.assignBeforeNextDeactivation = { ...deal, id: randomUUID(), title: 'Atribuída durante a confirmação' };
  await dialog.getByRole('button', { name: 'Confirmar desativação' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'A carteira de Bruna Recebedora mudou desde que você abriu esta confirmação. Confira as contagens e confirme de novo.',
  );
  await expect(dialog.getByRole('list', { name: 'Carteira de Bruna Recebedora' })).toHaveText(
    '1 oportunidade em aberto',
  );
  await expect(dialog.getByRole('button', { name: 'Confirmar desativação' })).toBeDisabled();
  await dialog.getByLabel('Quem recebe a carteira *').selectOption({ label: 'Carla Administradora' });
  await dialog.getByRole('button', { name: 'Confirmar desativação' }).click();
  await expect(
    page.getByText(
      'O acesso de Bruna Recebedora foi desativado. Carla Administradora recebeu 1 oportunidade em aberto.',
    ),
  ).toBeVisible();
  expect(state.tables.deals.find((row) => row.title === 'Atribuída durante a confirmação')?.owner_id).toBe(IDS.admin);
});

// Achados 6 e 8 da revisão do item 1.2 (corrigidos no item 1.6): o filtro de responsável cabe "Todos os responsáveis"
// e mantém a marca "(desativado)" no valor escolhido; o de situação diz "Todas as situações", inteiro.
test('os filtros de responsável e de situação mostram o rótulo inteiro e a marca de quem saiu', async ({
  page,
}, testInfo) => {
  const state = withTeam(createFixture());
  deactivateFulano(state, { keepAccounts: true });
  // Um nome longo, que não cabe no seletor: o nome corta, e a marca continua inteira.
  const LONG = 'Fulano Vendedor de Oliveira Albuquerque';
  state.tables.profiles.find((row) => row.id === IDS.leaving)!.name = LONG;
  await installCrmFixture(page, { state });
  const mobile = testInfo.project.name === 'mobile-chrome';
  /** O texto "(desativado)" aparece inteiro dentro da área visível do valor exibido do seletor. */
  const markVisible = (trigger: Locator) =>
    trigger.evaluate((element) => {
      const value = element.querySelector(':scope > span')!;
      const box = value.getBoundingClientRect();
      const walker = document.createTreeWalker(value, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const start = node.textContent!.indexOf('(desativado)');
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + '(desativado)'.length);
        const mark = range.getBoundingClientRect();
        return (
          mark.width > 0 &&
          mark.left >= box.left - 1 &&
          mark.right <= box.right + 1 &&
          mark.top >= box.top - 1 &&
          mark.bottom <= box.bottom + 1
        );
      }
      return false;
    });
  /** O valor exibido do seletor cabe sem corte: nem reticências na largura, nem a segunda linha escondida. */
  const fits = (trigger: Locator) =>
    trigger.evaluate((element) => {
      const value = element.querySelector(':scope > span')!;
      return value.scrollWidth <= value.clientWidth + 1 && value.scrollHeight <= value.clientHeight + 1;
    });
  for (const path of ['/reports', '/pipeline?status=all']) {
    await page.goto(path);
    const owner = page.getByRole('combobox', { name: 'Filtrar responsável' });
    await expect(owner).toHaveText('Todos os responsáveis');
    expect(await fits(owner), `${path}: "Todos os responsáveis" sem corte`).toBe(true);
    await owner.click();
    await page.getByRole('option', { name: `${LONG} (desativado)` }).click();
    await expect(owner).toContainText('Fulano Vendedor');
    // A marca fica fora do corte do nome: o retângulo do texto "(desativado)" cabe inteiro no valor exibido, sem ir
    // para uma linha escondida nem passar da borda.
    expect(await markVisible(owner), `${path}: "(desativado)" visível no valor escolhido`).toBe(true);
    if (path.startsWith('/pipeline')) {
      const status = page.getByRole('combobox', { name: 'Filtrar situação' });
      await expect(status).toHaveText('Todas as situações');
      expect(await fits(status), 'Pipeline: "Todas as situações" sem corte').toBe(true);
    }
  }
  if (!mobile) {
    for (const [path, label] of [
      ['/financeiro', 'Filtrar situação'],
      ['/automations', 'Filtrar situação'],
    ] as const) {
      await page.goto(path);
      const status = page.getByRole('combobox', { name: label });
      await expect(status).toHaveText('Todas as situações');
      expect(await fits(status), `${path}: "Todas as situações" sem corte`).toBe(true);
    }
  }
});

test('o administrador não desativa nem reativa donos, e ninguém desativa o próprio acesso', async ({ page }) => {
  const state = withTeam(createFixture('admin'));
  // Carla vira dona; um dono antigo, desativado.
  roleRow(state, IDS.admin).role = 'owner';
  state.tables.profiles.push({
    id: randomUUID(),
    org_id: IDS.org,
    name: 'Dono Antigo',
    email: 'dono-antigo@example.test',
    avatar_url: null,
  });
  const oldOwner = state.tables.profiles.at(-1)!;
  state.tables.user_roles.push({
    id: randomUUID(),
    org_id: IDS.org,
    user_id: oldOwner.id,
    role: 'owner',
    deactivated_at: new Date().toISOString(),
  });
  await installCrmFixture(page, { state, role: 'admin' });
  await page.goto('/team');
  await expect(card(page, 'Pessoa de Teste (você)').getByRole('button', { name: 'Desativar' })).toHaveCount(0);
  await expect(card(page, 'Carla Administradora').getByRole('button', { name: 'Desativar' })).toHaveCount(0);
  await expect(card(page, 'Carla Administradora').getByRole('button', { name: 'Alterar papel' })).toHaveCount(0);
  await expect(card(page, 'Fulano Vendedor').getByRole('button', { name: 'Desativar' })).toBeVisible();
  const old = card(page, 'Dono Antigo (desativado)');
  await expect(old.getByRole('button', { name: 'Reativar' })).toHaveCount(0);
  await expect(old.getByRole('button', { name: 'Passar carteira' })).toBeVisible();
});

test('colaborador vê as duas listas, sem ações e sem os detalhes da passagem', async ({ page }) => {
  const state = withTeam(createFixture('member'));
  deactivateFulano(state);
  await installCrmFixture(page, { state, role: 'member' });
  await page.goto('/team');
  await expect(section(page, /Pessoas ativas/)).toBeVisible();
  const deactivated = section(page, /Pessoas desativadas \(1\)/);
  await expect(deactivated).toContainText('Fulano Vendedor (desativado)');
  await expect(deactivated).toContainText(/Acesso desativado em/);
  await expect(deactivated).not.toContainText('Carteira passada');
  await expect(page.getByRole('button', { name: /^(Desativar|Reativar|Passar carteira|Alterar papel)$/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByText(/Convidar pessoas, alterar papéis e desativar acessos fica com donos e administradores/),
  ).toBeVisible();
});

test('reativa com o papel escolhido, e a pessoa volta às ativas sem a carteira passada', async ({ page }) => {
  const state = withTeam(createFixture());
  deactivateFulano(state);
  await installCrmFixture(page, { state });
  await page.goto('/team');
  await card(page, 'Fulano Vendedor (desativado)').getByRole('button', { name: 'Reativar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reativar Fulano Vendedor' });
  await expect(dialog).toContainText('A carteira que passou para outra pessoa continua com ela');
  await expect(dialog.getByLabel('Novo papel')).toHaveValue('member');
  await dialog.getByLabel('Novo papel').selectOption('viewer');
  await dialog.getByRole('button', { name: 'Confirmar reativação' }).click();
  await expect(page.getByText('O acesso de Fulano Vendedor foi reativado.')).toBeVisible();
  await expect(section(page, /Pessoas desativadas/)).toHaveCount(0);
  await expect(card(page, 'Fulano Vendedor')).toContainText('Somente leitura');
  expect(roleRow(state, IDS.leaving)).toMatchObject({ role: 'viewer', deactivated_at: null });
  expect(state.tables.deals.find((row) => row.title === 'Contrato do Fulano')?.owner_id).toBe(IDS.recipient);
});

test('"Passar carteira" leva os contatos e as empresas que ficaram com quem saiu', async ({ page }) => {
  const state = withTeam(createFixture());
  deactivateFulano(state, { keepAccounts: true });
  await installCrmFixture(page, { state });
  await page.goto('/team');
  await card(page, 'Fulano Vendedor (desativado)').getByRole('button', { name: 'Passar carteira' }).click();
  const dialog = page.getByRole('dialog', { name: 'Passar a carteira de Fulano Vendedor' });
  await expect(dialog.getByRole('list', { name: 'Carteira de Fulano Vendedor' }).getByRole('listitem')).toHaveText([
    '1 contato',
    '1 empresa',
  ]);
  await expect(dialog).not.toContainText('será revogado');
  await dialog.getByLabel('Quem recebe a carteira *').selectOption({ label: 'Carla Administradora' });
  await dialog.getByRole('button', { name: 'Confirmar passagem' }).click();
  await expect(page.getByText('Carla Administradora recebeu 1 contato e 1 empresa.')).toBeVisible();
  expect(state.teamCalls?.find((call) => call.rpc === 'transfer_portfolio')?.body).toEqual({
    p_user_id: IDS.leaving,
    p_transfer_accounts: true,
    p_recipient_id: IDS.admin,
  });
  expect(state.tables.contacts.some((row) => row.owner_id === IDS.leaving)).toBe(false);
});

test('Hoje reúne num item os muitos contatos que ficaram com quem saiu, com link para a Equipe', async ({ page }) => {
  const state = withTeam(createFixture());
  deactivateFulano(state, { keepAccounts: true });
  const kept = state.tables.contacts.find((row) => row.owner_id === IDS.leaving)!;
  for (let i = 1; i <= 11; i++)
    state.tables.contacts.push({
      ...kept,
      id: randomUUID(),
      first_name: `Cliente ${i}`,
      email: `cliente-${i}@example.test`,
    });
  await installCrmFixture(page, { state });
  await page.goto('/dashboard?owner=all');
  const attention = page.locator('[data-tour="today-attention"]');
  const item = attention
    .getByRole('listitem')
    .filter({ hasText: 'Fulano Vendedor (desativado): 12 contatos sem responsável ativo' });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('donos e administradores usam “Passar carteira”');
  // Os 12 contatos não aparecem um a um, e o resto da fila continua à vista.
  await expect(attention.getByRole('link', { name: 'Cliente do Fulano' })).toHaveCount(0);
  await expect(attention.getByRole('link', { name: 'Cliente 1', exact: true })).toHaveCount(0);
  await item.getByRole('link', { name: 'Ver na Equipe' }).click();
  await expect(page).toHaveURL(/\/team$/);
  await expect(
    card(page, 'Fulano Vendedor (desativado)').getByRole('button', { name: 'Passar carteira' }),
  ).toBeVisible();
});

test('convites mostram quem os criou, e mudar o papel avisa quais serão revogados', async ({ page }) => {
  const state = withTeam(createFixture());
  await installCrmFixture(page, { state });
  await page.goto('/team');
  const row = page.getByText('convidado-pela-carla@example.test', { exact: true }).locator('xpath=..');
  await expect(row).toContainText(/Criado por Carla Administradora em \d{2}\/\d{2}\/\d{4}/);
  await card(page, 'Carla Administradora').getByRole('button', { name: 'Alterar papel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Alterar permissão' });
  await expect(dialog).not.toContainText('será revogado');
  await dialog.getByRole('combobox').selectOption('viewer');
  await expect(dialog).toContainText(
    'O convite pendente criado por Carla Administradora será revogado, porque o novo papel não permite criá-lo.',
  );
  await dialog.getByRole('button', { name: 'Confirmar alteração' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('convidado-pela-carla@example.test', { exact: true })).toHaveCount(0);
  // O convite para o e-mail de quem foi desativado orienta a reativar.
  roleRow(state, IDS.leaving).deactivated_at = new Date().toISOString();
  await page.getByLabel('E-mail da pessoa').fill('fulano@example.test');
  await page.getByRole('button', { name: 'Criar convite' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Esta pessoa está desativada. Para devolver o acesso, use “Reativar” em “Equipe”.',
  );
});

test('a conta desativada vê "Seu acesso foi encerrado" ao entrar, e "Sair da conta" vai à entrada sem destino', async ({
  page,
}) => {
  const state = createFixture('member');
  roleRow(state, IDS.owner).deactivated_at = '2026-10-13T15:00:00.000Z';
  await installCrmFixture(page, { state, role: 'member' });
  await page.goto('/pipeline?deal=' + IDS.deal);
  await expect(page.getByRole('heading', { level: 1, name: 'Seu acesso foi encerrado' })).toBeVisible();
  await expect(page.getByText(/desativou o seu acesso a este CRM em 13\/10\/2026/)).toBeVisible();
  await expect(page.getByText('owner@example.test')).toBeVisible();
  await expect(page.getByText('Projeto Exemplo')).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await expect(page.getByRole('heading', { name: 'Acesse seu CRM' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
});

test('com o CRM aberto, a desativação aparece ao voltar para a aba, os dados somem e "Verificar de novo" reabre', async ({
  page,
}) => {
  await page.clock.install();
  const state = createFixture('member');
  await installCrmFixture(page, { state, role: 'member' });
  await page.goto('/pipeline');
  await expect(page.getByRole('article', { name: 'Projeto Exemplo' })).toBeVisible();
  roleRow(state, IDS.owner).deactivated_at = new Date().toISOString();
  // Antes de 30 s, voltar para a aba não relê o papel.
  await returnToTab(page);
  await page.clock.runFor(1000);
  await expect(page.getByRole('article', { name: 'Projeto Exemplo' })).toBeVisible();
  await page.clock.fastForward(31_000);
  await returnToTab(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Seu acesso foi encerrado' })).toBeVisible();
  await expect(page.getByText('Projeto Exemplo')).toHaveCount(0);
  // Ainda desativada, "Verificar de novo" diz que nada mudou, em vez de só voltar ao normal.
  await page.getByRole('button', { name: 'Verificar de novo' }).click();
  await expect(
    page.getByText('Seu acesso continua encerrado. Se acha que é um engano, fale com quem administra o CRM.'),
  ).toBeVisible();
  // Reativada, a pessoa confere de novo e volta ao CRM, que lê tudo outra vez.
  roleRow(state, IDS.owner).deactivated_at = null;
  const reads = state.requests.filter((request) => request.table === 'deals').length;
  await page.getByRole('button', { name: 'Verificar de novo' }).click();
  await expect(page.getByRole('article', { name: 'Projeto Exemplo' })).toBeVisible();
  expect(state.requests.filter((request) => request.table === 'deals').length).toBeGreaterThan(reads);
});

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 1440, height: 1000 },
  ]) {
    test(`Equipe, desativação e acesso encerrado sem rolagem horizontal (${theme}, ${viewport.width}px)`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      const state = withTeam(createFixture());
      roleRow(state, IDS.admin).deactivated_at = new Date().toISOString();
      await installCrmFixture(page, { state, theme });
      await page.goto('/team');
      await expect(section(page, /Pessoas desativadas \(1\)/)).toBeVisible();
      await expectNoHorizontalScroll(page, 'Equipe com as duas listas');
      await page.screenshot({ path: testInfo.outputPath(`equipe-${theme}-${viewport.width}.png`), fullPage: true });
      await card(page, 'Fulano Vendedor').getByRole('button', { name: 'Desativar' }).click();
      const dialog = page.getByRole('dialog', { name: 'Desativar Fulano Vendedor' });
      await expect(dialog.getByLabel('Quem recebe a carteira *')).toBeVisible();
      await expectNoHorizontalScroll(page, 'diálogo de desativação');
      const confirm = dialog.getByRole('button', { name: 'Confirmar desativação' });
      await confirm.scrollIntoViewIfNeeded();
      await expect(confirm).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`desativar-${theme}-${viewport.width}.png`) });
      await page.keyboard.press('Escape');
      roleRow(state, IDS.owner).deactivated_at = new Date().toISOString();
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: 'Seu acesso foi encerrado' })).toBeVisible();
      await expectNoHorizontalScroll(page, 'acesso encerrado');
      await page.screenshot({
        path: testInfo.outputPath(`acesso-encerrado-${theme}-${viewport.width}.png`),
        fullPage: true,
      });
    });
  }
}
