import { expect, test, type Locator, type Page, type TestInfo } from './test';
import { readFile } from 'node:fs/promises';
import {
  buildContactImportFixture,
  IMPORT_FIXTURE_CONSENT_NOTE,
  IMPORT_FIXTURE_DEFAULT_SOURCE,
} from '../../scripts/lib/import-fixture.mjs';
import {
  createFixture,
  IDS,
  installCrmFixture,
  withContactImport,
  type FixtureRow,
  type FixtureState,
} from './fixture';
import { expectTouchTarget, touchRow } from './touch';

// Item 1.11 (docs/arquitetura/1.11.md, seção 11.3): a importação de planilha, no desktop e no celular (o projeto
// mobile-chrome inclui este arquivo). A fixture do navegador emula os gatilhos que a importação usa (responsável ativo,
// "Não contatar", base legal e o índice único do e-mail) e conta cada lote; o comportamento real está no test:db.

const FIXTURE = buildContactImportFixture();
const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile-chrome';
const importLabel = 'Importar arquivo CSV (até 5.000 contatos)';
const dialogOf = (page: Page) => page.getByRole('dialog');
const posts = (state: FixtureState, table: string) =>
  state.requests.filter((request) => request.table === table && request.method === 'POST');
const imported = (state: FixtureState, before: Set<string>) =>
  state.tables.contacts.filter((row) => row.org_id === IDS.org && !before.has(row.id));
const count = (value: number) => value.toLocaleString('pt-BR');

async function setup(page: Page, prepare?: (state: FixtureState) => void, role: 'owner' | 'member' = 'owner') {
  const state = withContactImport(createFixture(role));
  prepare?.(state);
  await installCrmFixture(page, { role, state });
  await page.goto('/settings/integrations');
  return { state, before: new Set(state.tables.contacts.map((row) => row.id)) };
}
async function choose(page: Page, name: string, buffer: Buffer | Uint8Array) {
  await page.getByLabel(importLabel, { exact: true }).setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(buffer),
  });
}
async function download(page: Page, trigger: () => Promise<void>) {
  const [file] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { name: file.suggestedFilename(), buffer: await readFile((await file.path())!) };
}
/**
 * Sem rolagem lateral na página nem dentro do diálogo. O diálogo é fixo e rola por dentro (overflow-y-auto deixa o
 * overflow-x em auto): um transbordo dele vira rolagem interna e não alarga o documento, então ele é medido à parte,
 * como o painel da Ajuda em help.spec.ts (revisão do item 1.11).
 */
async function expectNoHorizontalScroll(page: Page, dialog: Locator, label: string) {
  const geometry = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(geometry.scroll, `${label}: página`).toBeLessThanOrEqual(geometry.width + 1);
  const inner = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(inner, `${label}: diálogo`).toBeLessThanOrEqual(1);
}
/** Os itens de uma lista da prévia que começam com "Linha {n} · ". */
const issueItem = (dialog: Locator, line: number) =>
  dialog.getByRole('listitem').filter({ hasText: `Linha ${count(line)} · ` });
const settled = (locator: Locator) =>
  locator.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((item) => item.finished)));
/** Uma planilha simples em UTF-8 com BOM e ";", com `rows` contatos de e-mail e telefone únicos. */
function sheet(rows: number, extra: (index: number) => string = () => '') {
  const lines = ['nome;email;telefone;responsavel'];
  for (let i = 0; i < rows; i++)
    lines.push(`Pessoa ${i};pessoa.${i}@example.test;11 9${String(30000000 + i)};${extra(i)}`);
  return Buffer.from(`\ufeff${lines.join('\r\n')}\r\n`, 'utf8');
}

test.describe('fixture de 5.000 linhas', () => {
  test('prévia, divisão entre duas pessoas, gravação em lotes e o resultado no banco', async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const { state, before } = await setup(page);
    const expected = FIXTURE.expected;
    await choose(page, 'contatos-5000.csv', FIXTURE.bytes);
    const dialog = dialogOf(page);
    await expect(dialog.getByRole('heading', { name: 'Revisar importação' })).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText(
      `“contatos-5000.csv”: ${count(expected.rows)} linhas. ${count(expected.ready)} prontas para importar, ${count(expected.duplicates)} repetidas e ${count(expected.errors)} com erro.`,
    );
    await expect(dialog).toContainText(
      'Arquivo no formato CSV comum do Excel. Confira os acentos nos nomes; se algum aparecer trocado, salve a planilha como CSV UTF-8 e escolha o arquivo de novo.',
    );
    await expect(dialog).toContainText('Nome completo → Nome, E-mail → E-mail, Celular → Telefone, Empresa → Empresa');
    await expect(dialog).toContainText('Colunas ignoradas: Data de nascimento.');
    const warnings = dialog.getByRole('status');
    await expect(warnings).toContainText(`${expected.unrecognizedPhones} telefones não foram reconhecidos`);
    await expect(warnings).toContainText(`${count(expected.newCompanies)} empresas novas:`);
    await expect(warnings).toContainText(`${expected.doNotContact} contatos chegam marcados “Não contatar”.`);
    await expect(warnings).toContainText(`${expected.consents} contatos com consentimento`);
    // As prontas: as primeiras 20, com a contagem do resto (revisão do item 1.11).
    await expect(dialog.getByRole('tabpanel').getByRole('listitem')).toHaveCount(20);
    await expect(dialog.getByRole('tabpanel')).toContainText('Prévia das primeiras 20.');
    // As linhas com erro, com o número da linha do Excel, quem é a linha e o motivo.
    await dialog.getByRole('tab', { name: `Com erro (${expected.errors})` }).click();
    await expect(dialog.getByRole('tabpanel').getByRole('listitem')).toHaveCount(expected.errors);
    await expect(dialog.getByRole('tabpanel')).not.toContainText('na planilha de contatos não importados');
    await expect(issueItem(dialog, expected.errorLines['Responsável desativado'])).toContainText(
      'A pessoa “Fulano Vendedor” está desativada na equipe e não recebe contatos. Escolha uma pessoa ativa.',
    );
    await expect(issueItem(dialog, expected.errorLines['Notação científica'])).toContainText(
      'notação científica (5,51E+12)',
    );
    await dialog.getByRole('tab', { name: `Repetidas (${expected.duplicates})` }).click();
    await expect(dialog.getByText('Já existe um contato com este telefone.', { exact: false }).first()).toBeVisible();
    // Divisão entre Bruna e Carla, com a contagem por pessoa.
    const importButton = dialog.getByRole('button', { name: `Importar ${count(expected.ready)} contatos` });
    await dialog.getByRole('radio', { name: 'Distribuir igualmente entre' }).click();
    await expect(importButton).toBeDisabled();
    await expect(importButton).toHaveAccessibleDescription('Marque ao menos uma pessoa para distribuir.');
    await dialog.getByRole('checkbox', { name: 'Carla Administradora' }).click();
    await dialog.getByRole('checkbox', { name: 'Bruna Recebedora' }).click();
    await expect(dialog).toContainText(
      `Bruna Recebedora: ${count(expected.distribution.bruna)} · Carla Administradora: ${count(expected.distribution.carla)}`,
    );
    await expect(dialog.getByRole('checkbox', { name: 'Fulano Vendedor' })).toHaveCount(0);
    await dialog
      .getByLabel('Origem dos contatos sem origem na planilha (opcional)')
      .fill(IMPORT_FIXTURE_DEFAULT_SOURCE);
    if (isMobile(testInfo))
      for (const control of [
        touchRow(dialog.getByRole('radio', { name: 'Distribuir igualmente entre' })),
        touchRow(dialog.getByRole('checkbox', { name: 'Bruna Recebedora' })),
        importButton,
      ])
        await expectTouchTarget(control, 'controle da prévia');
    expect(posts(state, 'contacts')).toHaveLength(0);
    await importButton.click();
    await expect(dialog.getByRole('heading', { name: 'Importação concluída' })).toBeVisible({ timeout: 60_000 });
    await expect(dialog).toContainText(
      `${count(expected.ready)} contatos importados. ${count(expected.newCompanies)} empresas criadas. ${expected.duplicates} repetidas e ${expected.errors} com erro ficaram de fora.`,
    );
    // Um pedido de empresas e dez de contatos, cada um com até 500 linhas, na ordem.
    expect(posts(state, 'companies').map((request) => (request.body as unknown[]).length)).toEqual([
      expected.newCompanies,
    ]);
    const sizes = posts(state, 'contacts').map((request) => (request.body as unknown[]).length);
    expect(sizes).toHaveLength(10);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(500);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(expected.ready);
    const companyPost = state.requests.findIndex(
      (request) => request.table === 'companies' && request.method === 'POST',
    );
    const firstContactPost = state.requests.findIndex(
      (request) => request.table === 'contacts' && request.method === 'POST',
    );
    expect(companyPost).toBeLessThan(firstContactPost);
    // No banco emulado: os contatos, os responsáveis, as empresas, a base legal, a marca e a origem padrão.
    const rows = imported(state, before);
    expect(rows).toHaveLength(expected.ready);
    const owned = (id: string) => rows.filter((row) => row.owner_id === id).length;
    expect(owned(IDS.recipient)).toBe(expected.distribution.bruna + expected.ownerColumn.bruna);
    expect(owned(IDS.admin)).toBe(expected.distribution.carla + expected.ownerColumn.carla);
    expect(rows.filter((row) => row.company_id === IDS.company)).toHaveLength(expected.linkedToExampleCompany);
    const marked = rows.filter((row) => row.do_not_contact);
    expect(marked).toHaveLength(expected.doNotContact);
    for (const row of marked)
      expect(row).toMatchObject({
        do_not_contact_reason: 'Veio marcado na planilha importada.',
        do_not_contact_by: IDS.owner,
        do_not_contact_at: expect.any(String),
      });
    const consents = rows.filter((row) => row.legal_basis === 'consent');
    expect(consents).toHaveLength(expected.consents);
    for (const row of consents) expect(row.legal_basis_note).toBe(IMPORT_FIXTURE_CONSENT_NOTE);
    expect(rows.filter((row) => row.legal_basis === 'legitimate_interest')).toHaveLength(expected.legitimateInterest);
    expect(rows.filter((row) => row.legal_basis === 'contract')).toHaveLength(expected.contract);
    // Sem a coluna, o padrão da empresa ("Não informada" nesta fixture), carimbado pelo banco.
    expect(rows.filter((row) => row.legal_basis === 'not_informed').length).toBe(
      expected.ready - expected.consents - expected.legitimateInterest - expected.contract,
    );
    expect(rows.every((row) => row.legal_basis_by === IDS.owner)).toBe(true);
    expect(rows.filter((row) => row.source === IMPORT_FIXTURE_DEFAULT_SOURCE)).toHaveLength(expected.withoutSource);
    const created = state.tables.companies.filter(
      (row) => row.org_id === IDS.org && !['Empresa Exemplo', 'Empresa do Fulano'].includes(String(row.name)),
    );
    expect(created).toHaveLength(expected.newCompanies);
    // "Abrir Contatos" leva à lista pelos mais recentes.
    await dialog.getByRole('link', { name: 'Abrir Contatos' }).click();
    await expect(page).toHaveURL(/\/contacts\?sort=updated$/);
    await expect(dialogOf(page)).toHaveCount(0);
  });
});

test.describe('planilhas', () => {
  test('baixa os contatos não importados, corrigidos e importados de novo', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo), 'download de planilha só no desktop');
    const { state } = await setup(page);
    const text = [
      'Nome;E-mail;Telefone;Cidade',
      'Ana;ana.nova@example.test;;Recife',
      ';sem.nome@example.test;;Olinda',
      'Bia;alfa@example.test;;Natal',
      '=Caio;caio@;;Salvador',
    ].join('\r\n');
    await choose(page, 'clientes.csv', Buffer.from(text, 'utf8'));
    const dialog = dialogOf(page);
    await expect(dialog).toContainText('“clientes.csv”: 4 linhas. 1 pronta para importar, 1 repetida e 2 com erro.');
    const file = await download(page, () =>
      dialog.getByRole('button', { name: 'Baixar contatos não importados' }).click(),
    );
    expect(file.name).toMatch(/^contatos-nao-importados-.+\.csv$/);
    expect([...file.buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = file.buffer.toString('utf8').slice(1).split('\r\n');
    expect(lines[0]).toBe(
      '"linha_planilha";"resultado_importacao";"motivo_importacao";"Nome";"E-mail";"Telefone";"Cidade"',
    );
    expect(lines.slice(1)).toEqual([
      '"3";"Com erro";"Falta o nome: preencha a coluna do nome.";"";"sem.nome@example.test";"";"Olinda"',
      '"4";"Repetida";"Já existe um contato com este e-mail.";"Bia";"alfa@example.test";"";"Natal"',
      `"5";"Com erro";"E-mail inválido. Use um e-mail por contato, como ana@empresa.com.br.";"'=Caio";"caio@";"";"Salvador"`,
    ]);
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    // Corrigida no "Excel" do teste: o nome e o e-mail; as três colunas do resultado são ignoradas na volta.
    const fixed = file.buffer
      .toString('utf8')
      .replace('"";"sem.nome@example.test"', '"Sônia";"sem.nome@example.test"')
      .replace('"caio@"', '"caio@example.test"');
    await choose(page, 'contatos-nao-importados.csv', Buffer.from(fixed, 'utf8'));
    await expect(dialog).toContainText('3 linhas. 2 prontas para importar, 1 repetida e 0 com erro.');
    await expect(dialog).toContainText('Colunas ignoradas: Cidade.');
    await dialog.getByRole('button', { name: 'Importar 2 contatos' }).click();
    await expect(dialog.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();
    expect(state.tables.contacts.find((row) => row.email === 'sem.nome@example.test')?.first_name).toBe('Sônia');
    expect(state.tables.contacts.find((row) => row.email === 'caio@example.test')?.first_name).toBe('=Caio');
  });

  test('a opção do telefone repetido deixa entrar as linhas repetidas só pelo telefone', async ({ page }) => {
    const { state, before } = await setup(page);
    const text = [
      'nome;email;telefone',
      'Recepção A;a@acme.example;(11) 3333-4444',
      'Recepção B;b@acme.example;11 3333-4444',
      'Antigo;c@acme.example;+55 11 98888-0001',
      'Repetida;A@ACME.EXAMPLE;',
    ].join('\n');
    await choose(page, 'empresa.csv', Buffer.from(text, 'utf8'));
    const dialog = dialogOf(page);
    await expect(dialog).toContainText('4 linhas. 1 pronta para importar, 3 repetidas e 0 com erro.');
    await dialog.getByRole('checkbox', { name: 'Importar também as linhas com telefone repetido (2)' }).click();
    await expect(dialog).toContainText('4 linhas. 3 prontas para importar, 1 repetida e 0 com erro.');
    await expect(dialog.getByRole('status')).toContainText('O telefone de 2 contatos já existe no CRM ou na planilha.');
    await dialog.getByRole('button', { name: 'Importar 3 contatos' }).click();
    await expect(dialog.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();
    expect(imported(state, before).map((row) => row.first_name)).toEqual(['Recepção A', 'Recepção B', 'Antigo']);
  });

  test('o CSV do Google (UTF-8 com vírgula), e as recusas de XLSX, de 5.001 linhas e de duas colunas de telefone', async ({
    page,
  }) => {
    const { state, before } = await setup(page);
    await choose(
      page,
      'google.csv',
      Buffer.from('Nome,E-mail,WhatsApp\nJoão Ação,joao@example.test,(21) 98765-4321\n', 'utf8'),
    );
    const dialog = dialogOf(page);
    await expect(dialog).toContainText('1 linha. 1 pronta para importar, 0 repetidas e 0 com erro.');
    await expect(dialog).not.toContainText('Arquivo no formato');
    await dialog.getByRole('button', { name: 'Importar 1 contato', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    expect(imported(state, before)).toMatchObject([{ first_name: 'João Ação', phone: '+5521987654321' }]);
    const alert = page.getByRole('alert');
    // O seletor mostra também as planilhas que o CRM recusa com o passo a passo (revisão do item 1.11).
    await expect(page.getByLabel(importLabel, { exact: true })).toHaveAttribute(
      'accept',
      '.csv,.txt,.xlsx,.xls,.ods,text/csv,text/plain',
    );
    await choose(page, 'planilha.xlsx', Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]));
    await expect(alert).toContainText(
      'Este arquivo é uma planilha do Excel ou de outro programa (.xlsx, .xls ou .ods)',
    );
    await expect(alert).toContainText('CSV UTF-8 (delimitado por vírgulas)');
    await choose(page, 'grande.csv', sheet(5001));
    await expect(alert).toHaveText(
      'A planilha tem 5.001 linhas com dados. Importe até 5.000 por vez: divida o arquivo em partes.',
    );
    await choose(page, 'dois.csv', Buffer.from('Nome;Telefone;Celular\nAna;1;2\n', 'utf8'));
    await expect(alert).toHaveText(
      'As colunas “Telefone” e “Celular” são o mesmo campo do CRM (telefone). Deixe só uma e importe de novo.',
    );
    await expect(dialog).toHaveCount(0);
  });

  test('exportar e importar num CRM vazio devolve a marca e o consentimento', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo), 'exportação de planilha só no desktop');
    const { state } = await setup(page, (fixture) => {
      const alfa = fixture.tables.contacts.find((row) => row.id === IDS.contact)!;
      Object.assign(alfa, {
        do_not_contact: true,
        do_not_contact_at: new Date().toISOString(),
        do_not_contact_by: IDS.owner,
        do_not_contact_reason: 'Pediu por e-mail.',
        legal_basis: 'consent',
        legal_basis_note: 'Assinou a ficha da feira em 02/10/2026.',
      });
    });
    const file = await download(page, () =>
      page.getByRole('button', { name: 'Exportar contatos', exact: true }).click(),
    );
    const header = file.buffer.toString('utf8').slice(1).split('\r\n')[0];
    expect(header).toBe('"nome";"sobrenome";"email";"telefone";"nao_contatar";"base_legal";"registro_base_legal"');
    // O CRM vazio: sem os contatos da organização.
    state.tables.contacts = state.tables.contacts.filter((row) => row.org_id !== IDS.org);
    await choose(page, file.name, file.buffer);
    const dialog = dialogOf(page);
    await expect(dialog).toContainText('repetidas e 0 com erro.');
    await dialog.getByRole('button', { name: /^Importar \d+ contatos?$/ }).click();
    await expect(dialog.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();
    const alfa = state.tables.contacts.find((row) => row.email === 'alfa@example.test')!;
    expect(alfa).toMatchObject({
      first_name: 'Contato',
      last_name: 'Alfa',
      do_not_contact: true,
      do_not_contact_reason: 'Veio marcado na planilha importada.',
      legal_basis: 'consent',
      legal_basis_note: 'Assinou a ficha da feira em 02/10/2026.',
    });
  });
});

test.describe('gravação', () => {
  test('um e-mail cadastrado no meio vira repetida, e a importação termina', async ({ page }) => {
    const { state, before } = await setup(page, (fixture) => {
      fixture.beforeWrite = (table, call, rows, current) => {
        if (table !== 'contacts' || call !== 2) return;
        // Um colega cadastra, antes do lote 2, um contato com o e-mail de uma linha dele.
        current.tables.contacts.push({ ...rows[10], id: crypto.randomUUID(), first_name: 'Do colega' } as FixtureRow);
      };
    });
    await choose(page, 'mil.csv', sheet(1200));
    const dialog = dialogOf(page);
    await dialog.getByRole('button', { name: 'Importar 1.200 contatos' }).click();
    await expect(dialog.getByRole('heading', { name: 'Importação concluída' })).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText('1.199 contatos importados. 1 repetida e 0 com erro ficou de fora.');
    expect(posts(state, 'contacts').map((request) => (request.body as unknown[]).length)).toEqual([500, 500, 499, 200]);
    expect(imported(state, before).filter((row) => row.first_name !== 'Do colega')).toHaveLength(1199);
  });

  test('a pessoa desativada no meio volta à prévia, e "Continuar importação" termina', async ({ page }) => {
    const { state, before } = await setup(page, (fixture) => {
      fixture.beforeWrite = (table, call, _rows, current) => {
        if (table === 'contacts' && call === 2)
          current.tables.user_roles.find((row) => row.user_id === IDS.recipient)!.deactivated_at =
            new Date().toISOString();
      };
    });
    await choose(page, 'divisao.csv', sheet(1000));
    const dialog = dialogOf(page);
    await dialog.getByRole('radio', { name: 'Distribuir igualmente entre' }).click();
    await dialog.getByRole('checkbox', { name: 'Bruna Recebedora' }).click();
    await dialog.getByRole('checkbox', { name: 'Carla Administradora' }).click();
    await dialog.getByRole('button', { name: 'Importar 1.000 contatos' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'A importação parou: A pessoa escolhida como responsável foi desativada. Escolha outra pessoa em “Responsável”. 500 contatos já foram gravados. Confira a prévia dos que faltam e use “Continuar importação”.',
      { timeout: 30_000 },
    );
    // A Bruna saiu da divisão: as 500 que faltam ficam com a Carla.
    await expect(dialog.getByRole('checkbox', { name: 'Bruna Recebedora' })).toHaveCount(0);
    await expect(dialog).toContainText('Carla Administradora: 500');
    await dialog.getByRole('button', { name: 'Continuar importação de 500 contatos' }).click();
    await expect(dialog.getByRole('heading', { name: 'Importação concluída' })).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText('1.000 contatos importados.');
    const rows = imported(state, before);
    expect(rows).toHaveLength(1000);
    expect(new Set(rows.map((row) => row.email)).size).toBe(1000);
    expect(rows.filter((row) => row.owner_id === IDS.admin)).toHaveLength(750);
  });

  test('a resposta perdida e "Parar": "Continuar importação" grava o que falta, sem duplicar', async ({ page }) => {
    const { state, before } = await setup(page, (fixture) => {
      fixture.beforeWrite = (table, call, _rows, current) => {
        if (table === 'contacts' && call === 2) current.loseNextWriteResponse.add('contacts');
      };
    });
    await choose(page, 'perdida.csv', sheet(1600));
    const dialog = dialogOf(page);
    await dialog.getByRole('button', { name: 'Importar 1.600 contatos' }).click();
    await expect(dialog.getByRole('heading', { name: 'Importação parada' })).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole('alert')).toContainText('A gravação de um lote não foi confirmada.');
    await expect(dialog).toContainText('500 de 1.600 contatos gravados.');
    // A gravação do lote 2 entrou: a nova tentativa recebe menos ids de volta e conta os ausentes como gravados.
    let release: () => void = () => undefined;
    state.holds = new Map([['contacts', new Promise<void>((resolve) => (release = resolve))]]);
    await dialog.getByRole('button', { name: 'Continuar importação' }).click();
    await expect(dialog.getByRole('heading', { name: 'Importando contatos' })).toBeVisible();
    await expect(dialog.getByRole('progressbar', { name: 'Importação de contatos' })).toHaveAttribute(
      'aria-valuemax',
      '1600',
    );
    // O "Voltar" do navegador (e o do celular) não tira a pessoa da gravação (revisão do item 1.11).
    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/integrations$/);
    await expect(dialog.getByRole('heading', { name: 'Importando contatos' })).toBeVisible();
    await expect(page.getByText('A importação continua')).toBeVisible();
    await dialog.getByRole('button', { name: 'Parar' }).click();
    await expect(dialog.getByRole('button', { name: 'Parando…' })).toBeDisabled();
    release();
    await expect(dialog.getByRole('heading', { name: 'Importação parada' })).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText('1.000 de 1.600 contatos gravados.');
    // Fechar com contatos por gravar pede confirmação (revisão do item 1.11).
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'contatos que faltam' })).toContainText(
      '600 contatos que faltam não serão gravados.',
    );
    await expect(dialog.getByRole('button', { name: 'Fechar sem gravar' })).toBeVisible();
    state.holds = undefined;
    await dialog.getByRole('button', { name: 'Continuar importação' }).click();
    await expect(dialog.getByRole('heading', { name: 'Importação concluída' })).toBeVisible({ timeout: 30_000 });
    const rows = imported(state, before);
    expect(rows).toHaveLength(1600);
    expect(new Set(rows.map((row) => row.id)).size).toBe(1600);
    expect(posts(state, 'contacts').map((request) => (request.body as unknown[]).length)).toEqual([
      500, 500, 500, 500, 100,
    ]);
  });
});

test.describe('papéis e bancos antigos', () => {
  test('colaborador importa com "Não contatar" e a base legal', async ({ page }) => {
    const { state, before } = await setup(page, undefined, 'member');
    await choose(
      page,
      'colaborador.csv',
      Buffer.from('nome;nao_contatar;base_legal\nPaula;sim;Legítimo interesse\nRui;;\n', 'utf8'),
    );
    const dialog = dialogOf(page);
    await dialog.getByRole('button', { name: 'Importar 2 contatos' }).click();
    await expect(dialog.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();
    expect(imported(state, before)).toMatchObject([
      { first_name: 'Paula', do_not_contact: true, legal_basis: 'legitimate_interest', owner_id: IDS.owner },
      { first_name: 'Rui', do_not_contact: false, legal_basis: 'not_informed' },
    ]);
  });

  test('sem a migração do 1.10, as colunas de base legal ficam de fora; sem a do 1.9, a marca vira erro', async ({
    page,
  }) => {
    const { state, before } = await setup(page, (fixture) => {
      fixture.missingColumns = new Set(['legal_basis', 'legal_basis_note', 'legal_basis_at', 'legal_basis_by']);
    });
    const text = 'nome;nao_contatar;base_legal;registro_base_legal\nPaula;sim;Consentimento;\nRui;;;\n';
    await choose(page, 'antigo.csv', Buffer.from(text, 'utf8'));
    const dialog = dialogOf(page);
    await expect(dialog.getByRole('status')).toContainText(
      'As colunas base_legal e registro_base_legal ficam de fora. Este CRM ainda não tem a atualização de privacidade (LGPD).',
    );
    await expect(dialog).toContainText('2 linhas. 2 prontas para importar');
    await dialog.getByRole('button', { name: 'Importar 2 contatos' }).click();
    await expect(dialog.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();
    const written = posts(state, 'contacts')[0].body as Record<string, unknown>[];
    expect(written.every((row) => !('legal_basis' in row) && 'do_not_contact' in row)).toBe(true);
    expect(imported(state, before).map((row) => [row.first_name, row.do_not_contact])).toEqual([
      ['Paula', true],
      ['Rui', false],
    ]);
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    state.missingColumns = new Set(['do_not_contact', 'legal_basis', 'legal_basis_note']);
    await choose(
      page,
      'antigo.csv',
      Buffer.from(text.replace('Paula', 'Paula Dois').replace('Rui', 'Rui Dois'), 'utf8'),
    );
    await expect(dialog).toContainText('2 linhas. 1 pronta para importar, 0 repetidas e 1 com erro.');
    await dialog.getByRole('tab', { name: 'Com erro (1)' }).click();
    await expect(dialog).toContainText(
      'Este CRM ainda não tem a atualização dos canais, e a marca “Não contatar” não seria gravada.',
    );
  });
});

test.describe('layout', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`prévia, gravação e resultado sem rolagem lateral (${theme})`, async ({ page }, testInfo) => {
      const state = withContactImport(createFixture());
      await installCrmFixture(page, { state, theme });
      const widths = isMobile(testInfo) ? [320, 375] : [1440];
      // Um nome de arquivo longo, sem espaços nem hífens, como os que o Excel e as pessoas criam.
      const fileName = (width: number) => `Planilha_de_Leads_Outubro_2026_final_revisada_${width}.csv`;
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/settings/integrations');
        const rows = Array.from(
          { length: 30 },
          (_, i) =>
            `Pessoa ${width}-${i} com um nome comprido;p${width}.${i}@example.test;(11) 9${String(40000000 + width * 100 + i)};${i % 3 ? '' : 'Empresa Nova Bastante Comprida Ltda.'};;${i === 2 ? 'Fulano Vendedor' : ''}`,
        );
        await choose(
          page,
          fileName(width),
          Buffer.from(['nome;email;telefone;empresa;cargo;responsavel', ...rows].join('\n'), 'utf8'),
        );
        const dialog = dialogOf(page);
        await expect(dialog.getByRole('heading', { name: 'Revisar importação' })).toBeVisible();
        await dialog.getByRole('radio', { name: 'Distribuir igualmente entre' }).click();
        await dialog.getByRole('checkbox', { name: 'Bruna Recebedora' }).click();
        await settled(dialog);
        await expectNoHorizontalScroll(page, dialog, `prévia ${width}px`);
        await dialog.getByRole('tab', { name: 'Com erro (1)' }).click();
        await expectNoHorizontalScroll(page, dialog, `prévia com erro ${width}px`);
        await dialog.getByRole('tab', { name: 'Prontas (29)' }).click();
        await page.screenshot({ path: testInfo.outputPath(`importacao-previa-${theme}-${width}.png`) });
        if (isMobile(testInfo)) {
          for (const name of ['Você', 'Outra pessoa', 'Distribuir igualmente entre'])
            await expectTouchTarget(touchRow(dialog.getByRole('radio', { name })), `${name} ${width}px`);
          await expectTouchTarget(
            touchRow(dialog.getByRole('checkbox', { name: 'Carla Administradora' })),
            `caixa ${width}px`,
          );
          for (const name of ['Baixar contatos não importados', 'Cancelar', 'Importar 29 contatos'])
            await expectTouchTarget(dialog.getByRole('button', { name }), `${name} ${width}px`);
          for (const name of ['Prontas (29)', 'Repetidas (0)', 'Com erro (1)'])
            await expectTouchTarget(dialog.getByRole('tab', { name }), `${name} ${width}px`);
        }
        let release: () => void = () => undefined;
        state.holds = new Map([['contacts', new Promise<void>((resolve) => (release = resolve))]]);
        await dialog.getByRole('button', { name: 'Importar 29 contatos' }).click();
        await expect(dialog.getByRole('heading', { name: 'Importando contatos' })).toBeVisible();
        await settled(dialog);
        await expectNoHorizontalScroll(page, dialog, `gravação ${width}px`);
        await page.screenshot({ path: testInfo.outputPath(`importacao-gravacao-${theme}-${width}.png`) });
        if (isMobile(testInfo))
          await expectTouchTarget(dialog.getByRole('button', { name: 'Parar' }), `Parar ${width}px`);
        release();
        state.holds = undefined;
        await expect(dialog.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();
        await settled(dialog);
        await expectNoHorizontalScroll(page, dialog, `resultado ${width}px`);
        await page.screenshot({ path: testInfo.outputPath(`importacao-resultado-${theme}-${width}.png`) });
        if (isMobile(testInfo))
          for (const name of ['Baixar contatos não importados', 'Fechar'])
            await expectTouchTarget(dialog.getByRole('button', { name }), `${name} ${width}px`);
        await dialog.getByRole('button', { name: 'Fechar' }).click();
        await expect(dialog).toHaveCount(0);
      }
    });
  }
});
