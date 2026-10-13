import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readBrand } from '../../scripts/lib/brand.mjs';
import { buildExportFileName } from '../../src/lib/export-file-name';
import { createFixture, IDS, installCrmFixture, type FixtureRow, type FixtureState } from './fixture';

const importLabel = 'Importar arquivo CSV (até 500 contatos)';
const importDialog = (page: Page) => page.getByRole('dialog', { name: 'Revisar importação' });
const contactPosts = (state: FixtureState) =>
  state.requests.filter((request) => request.table === 'contacts' && request.method === 'POST');

async function download(page: Page, trigger: () => Promise<void>) {
  const [file] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { name: file.suggestedFilename(), buffer: await readFile(await file.path()) };
}
function contactWithoutEmail(firstName: string, phone: string): FixtureRow {
  const old = new Date(Date.now() - 86400000).toISOString();
  return {
    id: randomUUID(),
    org_id: IDS.org,
    first_name: firstName,
    last_name: 'Telefone',
    email: null,
    phone,
    company_id: null,
    owner_id: IDS.owner,
    status: 'lead',
    job_title: null,
    source: null,
    notes: null,
    created_at: old,
    updated_at: old,
  };
}

test('exportação de contatos sai com BOM e ponto e vírgula e a reimportação preserva o telefone +55', async ({
  page,
}) => {
  const state = createFixture();
  state.tables.contacts.push(
    contactWithoutEmail('Celular', '+5511999990000'),
    contactWithoutEmail('Fixo', '+55 11 3000-0000'),
  );
  await installCrmFixture(page, { state });
  await page.goto('/settings/integrations');
  const exported = await download(page, () =>
    page.getByRole('button', { name: 'Exportar contatos', exact: true }).click(),
  );
  // O nome acompanha a marca da instância (item 1.6): contatos-empreende-ia.csv com a marca do programa.
  expect(exported.name).toBe(buildExportFileName(readBrand().exportName, 'contatos', 'csv'));
  expect([...exported.buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const lines = exported.buffer.toString('utf8').slice(1).split('\r\n');
  expect(lines[0]).toBe('"first_name";"last_name";"email";"phone"');
  expect(lines).toContain(`"Celular";"Telefone";"";"'+5511999990000"`);
  expect(lines).toContain(`"Fixo";"Telefone";"";"'+55 11 3000-0000"`);
  expect(lines).toContain('"Contato";"Alfa";"alfa@example.test";"11900000000"');
  expect(lines.some((line) => line.includes('de outra organização'))).toBe(false);

  await page.getByLabel(importLabel, { exact: true }).setInputFiles({
    name: exported.name,
    mimeType: 'text/csv',
    buffer: exported.buffer,
  });
  const dialog = importDialog(page);
  await expect(dialog.getByText(/2 novos contatos\. 1 linhas já cadastradas foram ignoradas/)).toBeVisible();
  await expect(dialog.getByText('(11) 99999-0000', { exact: true })).toBeVisible();
  await expect(dialog.getByText('(11) 3000-0000', { exact: true })).toBeVisible();
  await expect(dialog.getByText('não reconhecido', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Confirmar importação de 2 contatos', exact: true }).click();
  await expect(dialog).toBeHidden();
  const written = (contactPosts(state)[0].body as FixtureRow[]).sort((a, b) =>
    String(a.first_name).localeCompare(String(b.first_name)),
  );
  expect(written.map(({ first_name, email, phone }) => ({ first_name, email, phone }))).toEqual([
    { first_name: 'Celular', email: null, phone: '+5511999990000' },
    { first_name: 'Fixo', email: null, phone: '+551130000000' },
  ]);
  expect(JSON.stringify(written)).not.toContain("'");
});

test('modelo de contatos e arquivo do Excel em Windows-1252 com telefone não reconhecido', async ({ page }) => {
  const state = await installCrmFixture(page);
  await page.goto('/settings/integrations');
  const template = await download(page, () =>
    page.getByRole('button', { name: 'Baixar modelo CSV', exact: true }).click(),
  );
  expect(template.name).toBe('modelo-contatos.csv');
  expect(template.buffer.toString('utf8')).toBe('\uFEFF"first_name";"last_name";"email";"phone"');

  const excel = Buffer.from(
    'first_name;last_name;email;phone\r\nJoão;Ação;joao@example.test;(11) 3000-0000\r\nÉrica;;;ramal 22\r\n',
    'latin1',
  );
  await page.getByLabel(importLabel, { exact: true }).setInputFiles({
    name: 'planilha-excel.csv',
    mimeType: 'text/csv',
    buffer: excel,
  });
  const dialog = importDialog(page);
  await expect(dialog.getByText(/1 telefone não foi reconhecido e será importado como está no arquivo/)).toBeVisible();
  await expect(dialog.getByText('João Ação', { exact: true })).toBeVisible();
  await expect(dialog.getByText('não reconhecido', { exact: true })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Confirmar importação de 2 contatos', exact: true }).click();
  await expect(dialog).toBeHidden();
  const written = contactPosts(state)[0].body as FixtureRow[];
  expect(written.map(({ first_name, last_name, phone }) => ({ first_name, last_name, phone }))).toEqual([
    { first_name: 'João', last_name: 'Ação', phone: '+551130000000' },
    { first_name: 'Érica', last_name: null, phone: 'ramal 22' },
  ]);
});

for (const role of ['owner', 'member', 'viewer'] as const) {
  test(`Integrações sem ativação: importar e exportar conforme o papel (${role})`, async ({ page }) => {
    const state = createFixture(role);
    state.tables.integration_configs = [];
    await installCrmFixture(page, { role, state });
    await page.goto('/settings/integrations');
    const exports = [
      page.getByRole('button', { name: 'Exportar contatos', exact: true }),
      page.getByRole('button', { name: 'Exportar reuniões', exact: true }),
    ];
    const importInput = page.getByLabel(importLabel, { exact: true });
    if (role === 'viewer') {
      // Somente leitura não importa nem exporta: a rota mostra a explicação do RequireRole (roteiro, item 0.9).
      await expect(
        page.getByRole('heading', { name: 'Esta tela é para donos, administradores e colaboradores', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Contatos por CSV', exact: true })).toHaveCount(0);
      for (const button of exports) await expect(button).toHaveCount(0);
      await expect(importInput).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Baixar modelo CSV', exact: true })).toHaveCount(0);
      expect(state.requests.filter((request) => request.table === 'integration_configs')).toEqual([]);
      return;
    }
    await expect(page.getByRole('heading', { name: 'Contatos por CSV', exact: true })).toBeVisible();
    // Member: only the export notice.
    await expect(page.getByText(/Exportar contatos fica disponível|Seu acesso é somente para consulta/)).toHaveCount(
      role === 'owner' ? 0 : 1,
    );
    if (role === 'owner') for (const button of exports) await expect(button).toBeVisible();
    else {
      for (const button of exports) await expect(button).toHaveCount(0);
      await expect(page.getByText('Exportar reuniões fica disponível para donos e administradores.')).toBeVisible();
    }
    await expect(importInput).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Baixar modelo CSV', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Habilitar|Desabilitar/ })).toHaveCount(0);
    expect(state.requests.filter((request) => request.table === 'integration_configs')).toEqual([]);
  });
}

test('oportunidade e lançamento aceitam valores no padrão brasileiro com prévia', async ({ page }) => {
  const state = await installCrmFixture(page);
  await page.goto(`/pipeline?deal=${IDS.deal}`);
  await expect(page.getByRole('heading', { name: 'Projeto Exemplo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const dealValue = page.getByLabel('Valor (BRL) *', { exact: true });
  await expect(dealValue).toHaveValue('2.400,00');
  await dealValue.fill('1.234');
  await expect(page.getByText('Prévia: R$ 1.234,00', { exact: true })).toBeVisible();
  await dealValue.fill('1.2345');
  await expect(page.getByText(/Formato não reconhecido/)).toBeVisible();
  await dealValue.fill('R$ 3.500,50');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect.poll(() => state.tables.deals.find((deal) => deal.id === IDS.deal)?.value).toBe(3500.5);

  await page.goto('/financeiro?create=1');
  await page.getByLabel('Descrição *', { exact: true }).fill('Parcela em reais');
  await page.getByLabel('Valor *', { exact: true }).fill('12.5');
  await expect(page.getByText('Prévia: R$ 12,50', { exact: true })).toBeVisible();
  await page.getByLabel('Valor *', { exact: true }).fill('1.200,50');
  await expect(page.getByText('Prévia: R$ 1.200,50', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Salvar lançamento', exact: true }).click();
  await expect
    .poll(() => state.tables.payments.find((row) => row.description === 'Parcela em reais')?.amount)
    .toBe(1200.5);
});
