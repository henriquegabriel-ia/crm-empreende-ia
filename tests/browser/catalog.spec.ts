import { expect, test, type Locator, type Page, type TestInfo } from './test';
import { readFile } from 'node:fs/promises';
import {
  createFixture,
  DEAL_ITEM_COLUMNS,
  IDS,
  installCrmFixture,
  type FixtureRole,
  type FixtureRow,
  type FixtureState,
} from './fixture';
import { expectTouchTarget } from './touch';

// Item 1.16 (docs/arquitetura/1.16.md): o catálogo de produtos e serviços em Configurações e os itens na oportunidade,
// no desktop e no celular (o projeto mobile-chrome inclui este arquivo). A fixture emula save_deal com a mesma conta da
// tela (src/lib/deal-item-math.ts): os totais conferidos aqui, em centavos exatos, são os do banco.

const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile-chrome';
const OLD = new Date(Date.now() - 10 * 86_400_000).toISOString();
const PRODUCT = {
  traffic: 'cccccccc-cccc-4ccc-8ccc-000000000001',
  setup: 'cccccccc-cccc-4ccc-8ccc-000000000002',
  archived: 'cccccccc-cccc-4ccc-8ccc-000000000003',
} as const;
const ITEM = {
  setup: 'dddddddd-dddd-4ddd-8ddd-000000000001',
  traffic: 'dddddddd-dddd-4ddd-8ddd-000000000002',
} as const;

function product(id: string, fields: Partial<FixtureRow>): FixtureRow {
  return {
    id,
    org_id: IDS.org,
    name: 'Item',
    code: null,
    kind: 'service',
    unit: null,
    price: 0,
    billing: 'one_time',
    archived_at: null,
    created_at: OLD,
    updated_at: OLD,
    ...fields,
  };
}
/** O catálogo: um serviço mensal, uma implantação de cobrança única e um pacote arquivado. */
function withCatalog(state: FixtureState) {
  state.tables.products.push(
    product(PRODUCT.traffic, {
      name: 'Gestão de tráfego',
      code: 'GT-01',
      unit: 'mês',
      price: 2000,
      billing: 'monthly',
    }),
    product(PRODUCT.setup, { name: 'Implantação', code: 'IMP-01', unit: 'un', price: 1500 }),
    product(PRODUCT.archived, { name: 'Pacote antigo', code: 'OLD', kind: 'product', archived_at: OLD, price: 99 }),
  );
  return state;
}
/**
 * A oportunidade da fixture com itens, como save_deal a deixaria: a implantação com 10% de desconto (R$ 1.350,00) e o
 * tráfego mensal (R$ 2.000,00) por 12 meses = R$ 25.350,00.
 */
function withItemsDeal(state: FixtureState, status: 'open' | 'won' = 'open') {
  const deal = state.tables.deals.find((row) => row.id === IDS.deal)!;
  Object.assign(deal, {
    status,
    value: 25350,
    item_count: 2,
    one_time_value: 1350,
    monthly_value: 2000,
    contract_months: 12,
    ...(status === 'won' ? { probability: 100, closed_at: new Date().toISOString() } : {}),
  });
  const base = { org_id: IDS.org, deal_id: IDS.deal, created_at: OLD, updated_at: OLD };
  state.tables.deal_items.push(
    {
      ...base,
      id: ITEM.setup,
      product_id: PRODUCT.setup,
      position: 0,
      name: 'Implantação',
      quantity: 1,
      unit: 'un',
      unit_price: 1500,
      discount_type: 'percent',
      discount_value: 10,
      billing: 'one_time',
      line_total: 1350,
    },
    {
      ...base,
      id: ITEM.traffic,
      product_id: PRODUCT.traffic,
      position: 1,
      name: 'Gestão de tráfego',
      quantity: 1,
      unit: 'mês',
      unit_price: 2000,
      discount_type: null,
      discount_value: 0,
      billing: 'monthly',
      line_total: 2000,
    },
  );
  return state;
}
async function open(page: Page, state: FixtureState, path: string, role?: FixtureRole, theme?: 'light' | 'dark') {
  await installCrmFixture(page, { state, role, theme });
  await page.goto(path);
}
async function download(page: Page, trigger: () => Promise<void>) {
  const [file] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { name: file.suggestedFilename(), text: (await readFile(await file.path())).toString('utf8').slice(1) };
}
/** Escolhe um item do catálogo pela busca, no seletor "Produto ou serviço" do cartão. */
async function pickProduct(page: Page, card: Locator, search: string, option: string) {
  await card.getByRole('combobox', { name: 'Produto ou serviço' }).click();
  await page.getByLabel('Buscar no catálogo por nome ou código').fill(search);
  await page.getByRole('option', { name: new RegExp(`^${option}`) }).click();
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
/** O conteúdo rolável do painel lateral ou do diálogo não rola para o lado. */
async function expectNoInnerScroll(scope: Locator, label: string) {
  const overflow = await scope.evaluate((element) => {
    const scrollers = [element, ...element.querySelectorAll<HTMLElement>('*')].filter(
      // Campos de texto rolam o próprio texto, e o texto só para leitor de tela (sr-only) tem 1 px de largura.
      (node) =>
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) &&
        node.clientWidth > 1 &&
        node.scrollWidth > node.clientWidth + 1 &&
        getComputedStyle(node).overflowX !== 'visible',
    );
    return scrollers.map((node) => `${node.tagName}.${node.className}`.slice(0, 80));
  });
  expect(overflow, `${label}: rolagem lateral interna`).toEqual([]);
}
const card = (page: Page, index: number) => page.locator('[data-deal-item]').nth(index);
const saveDealCalls = (state: FixtureState) => state.saveDealCalls ?? [];

test('o administrador cadastra, edita, arquiva e reativa itens do catálogo, com o código único', async ({
  page,
}, testInfo) => {
  const state = createFixture();
  await open(page, state, '/settings?tab=catalog');
  await expect(page.getByText('Nenhum item no catálogo.')).toBeVisible();
  const create = page.getByRole('button', { name: 'Novo item', exact: true });
  if (isMobile(testInfo)) await expectTouchTarget(create, 'Novo item');
  await create.click();
  let dialog = page.getByRole('dialog', { name: 'Novo item do catálogo' });
  await dialog.getByLabel('Nome *', { exact: true }).fill('Consultoria mensal');
  await dialog.getByLabel('Código', { exact: true }).fill('CM-01');
  await dialog.getByLabel('Serviço', { exact: true }).click();
  await dialog.getByLabel('Unidade', { exact: true }).fill('mês');
  await dialog.getByLabel('Preço (R$) *', { exact: true }).fill('3.000,00');
  await expect(dialog.getByText('Prévia: R$ 3.000,00')).toBeVisible();
  await dialog.getByLabel('Mensal', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Criar item', exact: true }).click();
  await expect(dialog).toBeHidden();
  const list = page.getByRole('list', { name: 'Itens do catálogo' });
  const row = list.getByRole('listitem').filter({ hasText: 'Consultoria mensal' });
  await expect(row).toContainText('R$ 3.000,00/mês');
  await expect(row).toContainText('Serviço · mês');
  expect(state.tables.products[0]).toMatchObject({ code: 'CM-01', kind: 'service', billing: 'monthly', price: 3000 });

  // Editar grava só a versão lida (0.8).
  await page.getByRole('button', { name: 'Editar Consultoria mensal' }).click();
  dialog = page.getByRole('dialog', { name: 'Editar item do catálogo' });
  await dialog.getByLabel('Preço (R$) *', { exact: true }).fill('3.200,00');
  await dialog.getByRole('button', { name: 'Salvar item', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText('R$ 3.200,00/mês');
  const patch = state.requests.filter((request) => request.table === 'products' && request.method === 'PATCH').at(-1)!;
  expect(patch.params).toContain('updated_at=eq.');

  // O mesmo código, com outra caixa, é recusado com a mensagem e o preenchimento preservado.
  await create.click();
  dialog = page.getByRole('dialog', { name: 'Novo item do catálogo' });
  await dialog.getByLabel('Nome *', { exact: true }).fill('Outra consultoria');
  await dialog.getByLabel('Código', { exact: true }).fill('cm-01');
  await dialog.getByLabel('Preço (R$) *', { exact: true }).fill('10');
  await dialog.getByRole('button', { name: 'Criar item', exact: true }).click();
  await expect(dialog.getByText('Já existe um item com o código “cm-01”.')).toBeVisible();
  await expect(dialog.getByLabel('Nome *', { exact: true })).toHaveValue('Outra consultoria');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

  // Arquivar tira dos ativos; o filtro "Arquivados" mostra, e "Reativar" devolve.
  await page.getByRole('button', { name: 'Arquivar Consultoria mensal' }).click();
  await expect(row).toBeHidden();
  await page.getByLabel('Situação', { exact: true }).selectOption('archived');
  await expect(row).toContainText('Arquivado');
  await page.getByRole('button', { name: 'Reativar Consultoria mensal' }).click();
  await expect(row).toBeHidden();
  await page.getByLabel('Situação', { exact: true }).selectOption('active');
  await expect(row).toContainText('Ativo');
});

test('o colaborador consulta o catálogo, sem alterar', async ({ page }) => {
  const state = withItemsDeal(withCatalog(createFixture('member')));
  await open(page, state, '/settings?tab=catalog', 'member');
  await expect(
    page.getByText('Somente donos e administradores alteram o catálogo. Você pode consultá-lo.'),
  ).toBeVisible();
  await expect(page.getByText('Gestão de tráfego', { exact: true })).toBeVisible();
  for (const name of ['Novo item', 'Importar planilha', 'Baixar modelo', 'Editar Gestão de tráfego'])
    await expect(page.getByRole('button', { name })).toHaveCount(0);
});

test('excluir um item do catálogo já usado numa oportunidade pede para arquivar', async ({ page }) => {
  const owner = withItemsDeal(withCatalog(createFixture()));
  await open(page, owner, '/settings?tab=catalog');
  await page.getByRole('button', { name: 'Excluir Implantação' }).click();
  await page
    .getByRole('dialog', { name: 'Excluir item do catálogo?' })
    .getByRole('button', { name: 'Excluir item' })
    .click();
  await expect(
    page.getByText('Este item já foi usado em oportunidades. Arquive para tirá-lo das escolhas.'),
  ).toBeVisible();
  expect(owner.tables.products.some((row) => row.id === PRODUCT.setup)).toBe(true);
});

test('nova oportunidade com item do catálogo e avulso, descontos e meses: os totais no formulário, no painel, no quadro e nos Relatórios', async ({
  page,
}, testInfo) => {
  const state = withCatalog(createFixture());
  await open(page, state, '/pipeline?create=1');
  const form = page.getByRole('dialog', { name: 'Nova oportunidade' });
  await form.getByLabel('Nome da oportunidade *', { exact: true }).fill('Contrato Acme');
  await form.getByRole('button', { name: 'Adicionar itens', exact: true }).click();
  // O arquivado não é oferecido.
  await card(page, 0).getByRole('combobox', { name: 'Produto ou serviço' }).click();
  await page.getByLabel('Buscar no catálogo por nome ou código').fill('old');
  await expect(page.getByText('Nenhum item encontrado.')).toBeVisible();
  await page.keyboard.press('Escape');
  await pickProduct(page, card(page, 0), 'gt-0', 'Gestão de tráfego');
  await expect(card(page, 0).getByLabel('Preço unitário (R$) *', { exact: true })).toHaveValue('2.000,00');
  await expect(card(page, 0).getByLabel('Cobrança', { exact: true })).toHaveValue('monthly');
  await card(page, 0).getByLabel('Desconto', { exact: true }).selectOption('percent');
  await card(page, 0).getByLabel('Desconto (%)', { exact: true }).fill('10');
  await expect(card(page, 0).locator('[data-deal-item-total]')).toContainText(
    '1 × R$ 2.000,00 − 10% = R$ 1.800,00 por mês',
  );
  await form.getByRole('button', { name: 'Adicionar item', exact: true }).click();
  await card(page, 1).getByLabel('Nome do item *', { exact: true }).fill('Treinamento da equipe');
  await card(page, 1).getByLabel('Quantidade *', { exact: true }).fill('1,5');
  await card(page, 1).getByLabel('Preço unitário (R$) *', { exact: true }).fill('1.000,00');
  await card(page, 1).getByLabel('Desconto', { exact: true }).selectOption('amount');
  await card(page, 1).getByLabel('Desconto (R$)', { exact: true }).fill('150,00');
  await expect(card(page, 1).locator('[data-deal-item-total]')).toContainText(
    '1,5 × R$ 1.000,00 − R$ 150,00 = R$ 1.350,00',
  );
  if (isMobile(testInfo))
    await expectTouchTarget(
      card(page, 1).getByRole('button', { name: 'Remover item Treinamento da equipe' }),
      'Remover',
    );
  await form.getByLabel('Meses do contrato *', { exact: true }).fill('12');
  // R$ 1.350,00 único + R$ 1.800,00 × 12 = R$ 22.950,00.
  await expect(form.locator('[data-contract-value]')).toHaveText('R$ 22.950,00');
  await form.getByRole('button', { name: 'Criar oportunidade', exact: true }).click();
  await expect(form).toBeHidden();
  const [call] = saveDealCalls(state);
  expect(call.p_version).toBeUndefined();
  expect(call.p_contract_months).toBe(12);
  expect(call.p_fields).not.toHaveProperty('value');
  expect(call.p_items).toEqual([
    expect.objectContaining({
      product_id: PRODUCT.traffic,
      quantity: '1.000',
      unit_price: '2000.00',
      discount_type: 'percent',
      discount_value: '10.00',
      billing: 'monthly',
      position: 0,
    }),
    expect.objectContaining({
      product_id: null,
      name: 'Treinamento da equipe',
      quantity: '1.500',
      unit_price: '1000.00',
      discount_type: 'amount',
      discount_value: '150.00',
      billing: 'one_time',
      position: 1,
    }),
  ]);

  const panel = page.getByRole('dialog', { name: 'Contrato Acme' });
  await expect(panel.getByText('R$ 22.950,00').first()).toBeVisible();
  await expect(panel.getByText('R$ 1.350,00 único + R$ 1.800,00/mês × 12 meses')).toBeVisible();
  const items = panel.getByRole('list', { name: 'Itens da oportunidade' });
  await expect(items.getByRole('listitem')).toHaveCount(2);
  await expect(items).toContainText('Treinamento da equipe');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('article', { name: 'Contrato Acme' })).toContainText('R$ 22.950,00');
  await page.goto('/reports');
  await expect(page.getByRole('row').filter({ hasText: 'Contrato Acme' })).toContainText('R$ 22.950,00');
});

test('"Editar itens" no painel: o conflito com o colega mantém os itens, e remover todos volta ao valor manual', async ({
  page,
}) => {
  const state = withItemsDeal(withCatalog(createFixture()));
  await open(page, state, `/pipeline?deal=${IDS.deal}`);
  const panel = page.getByRole('dialog', { name: 'Projeto Exemplo' });
  await expect(panel.getByText('R$ 1.350,00 único + R$ 2.000,00/mês × 12 meses')).toBeVisible();
  await panel.getByRole('button', { name: 'Editar itens', exact: true }).click();
  await card(page, 0).getByLabel('Quantidade *', { exact: true }).fill('2');
  // Um colega muda a oportunidade logo antes da gravação: a versão lida deixa de valer.
  state.beforeSaveDeal = (current) => {
    current.tables.deals.find((row) => row.id === IDS.deal)!.updated_at = new Date().toISOString();
    current.beforeSaveDeal = undefined;
  };
  await panel.getByRole('button', { name: 'Salvar itens', exact: true }).click();
  await expect(panel.getByText(/Esta oportunidade mudou ou não está mais disponível/)).toBeVisible();
  await expect(card(page, 0).getByLabel('Quantidade *', { exact: true })).toHaveValue('2');
  expect(state.tables.deal_items.find((row) => row.id === ITEM.setup)!.quantity).toBe(1);
  await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await panel.getByRole('button', { name: 'Editar itens', exact: true }).click();
  await card(page, 0).getByLabel('Quantidade *', { exact: true }).fill('2');
  await panel.getByRole('button', { name: 'Salvar itens', exact: true }).click();
  await expect(page.getByText('Itens salvos.')).toBeVisible();
  // R$ 2.700,00 único + R$ 2.000,00 × 12 = R$ 26.700,00, com os mesmos ids.
  await expect(panel.getByText('R$ 2.700,00 único + R$ 2.000,00/mês × 12 meses')).toBeVisible();
  expect(state.tables.deal_items.map((row) => row.id).sort()).toEqual([ITEM.setup, ITEM.traffic]);
  expect(state.tables.deals.find((row) => row.id === IDS.deal)!.value).toBe(26700);

  // Remover todos os itens no formulário: o valor volta, com o do contrato, e o valor digitado é gravado.
  await panel.getByRole('button', { name: 'Editar', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Editar oportunidade' });
  await form.getByRole('button', { name: 'Remover item Implantação' }).click();
  await form.getByRole('button', { name: 'Remover item Gestão de tráfego' }).click();
  await expect(form.getByLabel('Valor (BRL) *', { exact: true })).toHaveValue('26.700,00');
  await form.getByLabel('Valor (BRL) *', { exact: true }).fill('5.000,00');
  await form.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(form).toBeHidden();
  const last = saveDealCalls(state).at(-1)!;
  expect(last).toMatchObject({ p_items: [], p_fields: expect.objectContaining({ value: 5000 }) });
  const updated = page.getByRole('dialog', { name: 'Projeto Exemplo' });
  await expect(
    updated.getByText(
      'Nenhum item. O valor desta oportunidade não é calculado por itens e pode ser mudado em “Editar”.',
    ),
  ).toBeVisible();
  await expect(updated.getByText('R$ 5.000,00').first()).toBeVisible();
});

test('quem tem "Somente leitura" vê os itens e os totais, sem editar', async ({ page }) => {
  const state = withItemsDeal(withCatalog(createFixture('viewer')));
  await open(page, state, `/pipeline?deal=${IDS.deal}`, 'viewer');
  const panel = page.getByRole('dialog', { name: 'Projeto Exemplo' });
  await expect(panel.getByRole('list', { name: 'Itens da oportunidade' }).getByRole('listitem')).toHaveCount(2);
  await expect(panel.getByText('R$ 25.350,00').first()).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Editar itens' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Adicionar itens' })).toHaveCount(0);
});

test('Relatórios mostram "Mensalidades ganhas", "inclui R$ X/mês × os meses" e baixam as oportunidades e os itens', async ({
  page,
}, testInfo) => {
  const state = withItemsDeal(withCatalog(createFixture()), 'won');
  await open(page, state, '/reports');
  await expect(page.locator('.eia-stat-label', { hasText: 'Mensalidades ganhas' })).toBeVisible();
  // A dica do número cabe sem corte (o StatStrip corta numa linha), e a explicação completa aparece inteira abaixo.
  const hint = page.getByText('Já incluídas no valor ganho', { exact: true });
  await expect(hint).toBeVisible();
  expect(await hint.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(page.getByText(/O valor das ganhas já soma cada mensalidade × os meses do contrato/)).toBeVisible();
  const wins = page.getByRole('list', { name: 'Ganhos por responsável' }).getByRole('listitem');
  await expect(wins.first()).toContainText('R$ 25.350,00');
  await expect(wins.first()).toContainText('inclui R$ 2.000,00/mês × os meses');
  test.skip(isMobile(testInfo), 'As planilhas baixadas são conferidas no desktop.');
  const menu = page.getByRole('button', { name: /CSV/ });
  const deals = await download(page, async () => {
    await menu.click();
    await page.getByRole('menuitem', { name: 'Oportunidades', exact: true }).click();
  });
  const [dealsHeader, ...dealRows] = deals.text.split('\r\n');
  expect(dealsHeader).toContain('"Valor BRL";"Total único BRL";"Mensalidade BRL";"Meses do contrato"');
  expect(dealRows.find((line) => line.includes('Projeto Exemplo'))).toContain('"25350,00";"1350,00";"2000,00";"12"');
  const items = await download(page, async () => {
    await menu.click();
    await page.getByRole('menuitem', { name: 'Itens das oportunidades' }).click();
  });
  expect(items.name).toMatch(/^itens-oportunidades.*\.csv$/);
  const [header, ...rows] = items.text.split('\r\n').filter(Boolean);
  expect(header).toBe(
    '"Oportunidade";"Funil";"Etapa";"Responsável";"Situação atual";"Fechada em";"Item";"Código";"Tipo";"Quantidade";"Unidade";"Preço unitário BRL";"Desconto";"Cobrança";"Total da linha BRL";"Meses do contrato"',
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain('"Implantação";"IMP-01";"Serviço";"1";"un";"1500,00";"10%";"Única";"1350,00";"12"');
  expect(rows[1]).toContain('"Gestão de tráfego";"GT-01";"Serviço";"1";"mês";"2000,00";"";"Mensal";"2000,00";"12"');
});

test('importa o catálogo por planilha do Excel, com a prévia, a gravação e os não importados', async ({
  page,
}, testInfo) => {
  const state = withCatalog(createFixture());
  await open(page, state, '/settings?tab=catalog');
  await expect(page.getByText('Gestão de tráfego', { exact: true })).toBeVisible();
  const csv = [
    'Produto;SKU;Tipo;Unidade;Preço;Recorrência',
    'Consultoria avançada;C-1;Serviço;hora;250,00;Única',
    'Gestão;gt-01;Serviço;mês;2.000,00;Mensal',
    'Sem preço;;Produto;un;;',
    'Brinde;;;un;10;',
  ].join('\r\n');
  // O CSV comum do Excel no Windows: Windows-1252, com ponto e vírgula.
  await page.locator('[data-catalog-file]').setInputFiles({
    name: 'catalogo.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'latin1'),
  });
  const dialog = page.getByRole('dialog', { name: 'Revisar importação do catálogo' });
  await expect(dialog).toContainText('2 prontas para importar, 1 repetida e 1 com erro');
  expect(state.requests.some((request) => request.table === 'products' && request.method === 'POST')).toBe(false);
  await dialog.getByRole('tab', { name: /Repetidas/ }).click();
  await expect(dialog.getByText('Já existe no catálogo com o código GT-01.')).toBeVisible();
  await dialog.getByRole('tab', { name: /Com erro/ }).click();
  await expect(dialog.getByText(/Falta o preço/)).toBeVisible();
  if (!isMobile(testInfo)) {
    const issues = await download(page, () =>
      dialog.getByRole('button', { name: 'Baixar itens não importados', exact: true }).click(),
    );
    expect(issues.name).toMatch(/^catalogo-nao-importados.*\.csv$/);
    expect(issues.text).toContain('Repetida');
    expect(issues.text).toContain('Com erro');
  }
  await dialog.getByRole('button', { name: 'Importar 2 itens', exact: true }).click();
  // O nome do diálogo acompanha o estado (o título de cada um).
  const result = page.getByRole('dialog', { name: 'Importação concluída' });
  await expect(result).toBeVisible();
  await result.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.getByText('Consultoria avançada', { exact: true })).toBeVisible();
  await expect(page.getByText('Brinde', { exact: true })).toBeVisible();
  expect(state.tables.products.find((row) => row.name === 'Brinde')).toMatchObject({
    kind: 'product',
    billing: 'one_time',
    price: 10,
  });
});

test('num banco sem a migração, o catálogo explica o que falta e a oportunidade nasce pelo caminho de sempre', async ({
  page,
}) => {
  const state = createFixture();
  state.catalogMissing = true;
  for (const deal of state.tables.deals) for (const column of DEAL_ITEM_COLUMNS) delete deal[column];
  await open(page, state, '/settings?tab=catalog');
  const missing =
    'Este CRM ainda não tem a atualização do catálogo. Peça a quem administra para aplicar a migração mais recente.';
  await expect(page.getByText(missing)).toBeVisible();
  await page.goto('/pipeline?create=1');
  const form = page.getByRole('dialog', { name: 'Nova oportunidade' });
  await form.getByLabel('Nome da oportunidade *', { exact: true }).fill('Contrato sem itens');
  await form.getByRole('button', { name: 'Adicionar itens', exact: true }).click();
  await expect(form.getByText(missing)).toBeVisible();
  await form.getByLabel('Valor (BRL) *', { exact: true }).fill('1.500,00');
  await form.getByRole('button', { name: 'Criar oportunidade', exact: true }).click();
  await expect(form).toBeHidden();
  expect(saveDealCalls(state)).toHaveLength(0);
  expect(state.tables.deals.find((row) => row.title === 'Contrato sem itens')).toMatchObject({ value: 1500 });
  await expect(page.getByRole('dialog', { name: 'Contrato sem itens' }).getByText('R$ 1.500,00').first()).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 375, height: 812 },
    { width: 1440, height: 1000 },
  ]) {
    test(`catálogo, editor de itens e painel sem rolagem lateral (${theme}, ${viewport.width}px)`, async ({
      page,
    }, testInfo) => {
      test.skip(isMobile(testInfo), 'As larguras são conferidas no projeto do desktop.');
      await page.setViewportSize(viewport);
      const longName = 'Implantação' + 'X'.repeat(70);
      const state = withItemsDeal(withCatalog(createFixture()));
      state.tables.products.push(
        product('cccccccc-cccc-4ccc-8ccc-000000000004', { name: longName, code: 'LONGO', price: 10 }),
      );
      state.tables.deal_items[0].name = longName;
      await open(page, state, '/settings?tab=catalog', undefined, theme);
      await expect(page.getByText(longName, { exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page, 'Catálogo');
      await page.screenshot({ path: testInfo.outputPath(`catalogo-${theme}-${viewport.width}.png`), fullPage: true });
      // O diálogo do item, com um nome longo sem espaços.
      await page.getByRole('button', { name: 'Novo item', exact: true }).click();
      const productDialog = page.getByRole('dialog', { name: 'Novo item do catálogo' });
      await productDialog.getByLabel('Nome *', { exact: true }).fill(longName);
      await expectNoHorizontalScroll(page, 'Novo item');
      await expectNoInnerScroll(productDialog, 'Novo item');
      await productDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(productDialog).toBeHidden();
      // A revisão da importação, com o nome longo nas linhas prontas e o rodapé que quebra a linha.
      await page.locator('[data-catalog-file]').setInputFiles({
        name: 'catalogo.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          ['Nome;Código;Preço', `${longName}Novo;NOVO-LONGO;10,00`, 'Sem preço;;'].join('\r\n'),
          'utf8',
        ),
      });
      const review = page.getByRole('dialog', { name: 'Revisar importação do catálogo' });
      await expect(review).toContainText('1 pronta para importar');
      await expectNoHorizontalScroll(page, 'Revisar importação do catálogo');
      await expectNoInnerScroll(review, 'Revisar importação do catálogo');
      await page.screenshot({ path: testInfo.outputPath(`importacao-catalogo-${theme}-${viewport.width}.png`) });
      await review.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(review).toBeHidden();
      await page.goto(`/pipeline?deal=${IDS.deal}`);
      const panel = page.getByRole('dialog', { name: 'Projeto Exemplo' });
      await expect(panel.getByRole('list', { name: 'Itens da oportunidade' })).toContainText(longName);
      await expectNoHorizontalScroll(page, 'Painel com itens');
      await expectNoInnerScroll(panel, 'Painel com itens');
      await panel.getByRole('button', { name: 'Editar', exact: true }).click();
      const form = page.getByRole('dialog', { name: 'Editar oportunidade' });
      await expect(card(page, 0).getByLabel('Nome do item *', { exact: true })).toHaveValue(longName);
      await card(page, 0).scrollIntoViewIfNeeded();
      await expectNoHorizontalScroll(page, 'Editor de itens');
      await expectNoInnerScroll(form, 'Editor de itens');
      await page.screenshot({ path: testInfo.outputPath(`editor-itens-${theme}-${viewport.width}.png`) });
    });
  }
}
