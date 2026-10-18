import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readBrand } from '../../scripts/lib/brand.mjs';
import { buildExportFileName } from '../../src/lib/export-file-name';
import { readZip } from '../../src/test/zip-reader';
import {
  createFixture,
  IDS,
  installCrmFixture,
  PRIVACY_IDS,
  withPrivacy,
  type FixtureRole,
  type FixtureState,
} from './fixture';
import { expectTouchTarget } from './touch';

// Item 1.10 (docs/arquitetura/1.10.md, seção 10.4): a LGPD da empresa controladora, no desktop e no celular (o projeto
// mobile-chrome inclui este arquivo). A fixture emula as três RPCs (contact_privacy_summary, anonymize_contact e
// export_contact_data), o carimbo da base legal, a recusa de ações planejadas para quem tem "Não contatar" e os
// gatilhos do contato anonimizado, com as mensagens do banco; o comportamento real está no test:db.

const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile-chrome';
const HELENA = 'Helena Duarte';

async function setup(page: Page, role: FixtureRole = 'owner', prepare?: (state: FixtureState) => void) {
  const state = withPrivacy(createFixture(role));
  prepare?.(state);
  await installCrmFixture(page, { role, state });
  return state;
}
async function openContact(page: Page, id: string) {
  await page.goto(`/contacts?contact=${id}`);
  const panel = page.getByRole('dialog').filter({ has: page.getByText('Relacionamento 360') });
  await expect(panel).toBeVisible();
  return panel;
}
const privacySection = (panel: Locator) => panel.locator('[data-tour="360-privacy"]');
const summary = (panel: Locator) => panel.locator('[data-tour="360-summary"]');
const writes = (state: FixtureState, table: string) =>
  state.requests.filter((request) => request.table === table && !['GET', 'HEAD'].includes(request.method));
/** Espera a animação de entrada do painel ou do diálogo terminar, para a captura mostrar a posição final. */
const settled = (locator: Locator) =>
  locator.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((item) => item.finished)));
async function download(page: Page, trigger: () => Promise<void>) {
  const [file] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { name: file.suggestedFilename(), buffer: await readFile((await file.path())!) };
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
/** A data local (America/Sao_Paulo, a do Playwright) no formato do nome dos arquivos exportados. */
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const text = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes);
const SHORT_DATE = /\d{2}\/\d{2}\/\d{4}/;

test.describe('base legal', () => {
  test('o cadastro novo usa o padrão da empresa sem enviar a base, e o consentimento exige o registro', async ({
    page,
  }) => {
    const state = await setup(page);
    await page.goto('/contacts?action=new');
    const form = page.getByRole('dialog', { name: 'Novo contato' });
    await expect(form.getByLabel('Base legal', { exact: true })).toContainText('Padrão da empresa: Legítimo interesse');
    await expect(form.getByLabel('Registro da base legal (opcional)')).toHaveAccessibleDescription(
      'Ex.: marcou a caixa do formulário do site em 10/10/2026. Não escreva dados sensíveis, como saúde ou religião.',
    );
    await form.getByLabel('Nome *').fill('Nina');
    await form.getByLabel('Sobrenome').fill('Prado');
    await form.getByRole('button', { name: 'Salvar cadastro' }).click();
    await expect(form).toBeHidden();
    const created = writes(state, 'contacts').at(-1)!.body as Record<string, unknown>;
    for (const key of ['legal_basis', 'legal_basis_note', 'legal_basis_at', 'legal_basis_by'])
      expect(created, key).not.toHaveProperty(key);
    const nina = state.tables.contacts.find((row) => row.first_name === 'Nina')!;
    expect(nina).toMatchObject({ legal_basis: 'legitimate_interest', legal_basis_by: IDS.owner });
    const panel = await openContact(page, nina.id);
    await expect(summary(panel)).toContainText('Legítimo interesse');
    await expect(summary(panel)).toContainText(/Registrada por Pessoa de Teste em \d{2}\/\d{2}\/\d{4}\./);
    await panel.getByRole('button', { name: 'Editar cadastro' }).click();
    const edit = page.getByRole('dialog', { name: 'Editar contato' });
    await edit.getByLabel('Base legal', { exact: true }).click();
    await page.getByRole('option', { name: 'Consentimento', exact: true }).click();
    await edit.getByRole('button', { name: 'Salvar cadastro' }).click();
    await expect(edit.getByRole('alert')).toHaveText('Descreva como a pessoa consentiu.');
    const note = edit.getByLabel('Como a pessoa consentiu *');
    await expect(note).toHaveAttribute('aria-invalid', 'true');
    await note.fill('Assinou a ficha na feira em 12/10/2026.');
    await edit.getByRole('button', { name: 'Salvar cadastro' }).click();
    await expect(edit).toBeHidden();
    expect(writes(state, 'contacts').at(-1)!.body).toEqual(
      expect.objectContaining({ legal_basis: 'consent', legal_basis_note: 'Assinou a ficha na feira em 12/10/2026.' }),
    );
    await expect(summary(panel)).toContainText('Consentimento');
    await expect(summary(panel)).toContainText('Assinou a ficha na feira em 12/10/2026.');
  });

  test('Somente leitura vê a base legal, sem editar e sem a seção "Privacidade"', async ({ page }) => {
    await setup(page, 'viewer');
    const panel = await openContact(page, PRIVACY_IDS.helena);
    await expect(summary(panel)).toContainText('Consentimento');
    await expect(summary(panel)).toContainText('Marcou a caixa do formulário do site em 01/10/2026.');
    await expect(summary(panel)).toContainText(/Registrada por Pessoa de Teste em/);
    await expect(summary(panel)).not.toContainText('Defina em');
    await expect(panel.getByRole('button', { name: 'Editar cadastro' })).toHaveCount(0);
    await expect(privacySection(panel)).toHaveCount(0);
  });
});

test.describe('padrão da empresa', () => {
  test('o dono troca o padrão, com o carimbo do banco, e o guia marca a etapa', async ({ page }) => {
    const state = await setup(page, 'owner', (fixture) => {
      Object.assign(
        fixture.tables.organizations.find((row) => row.id === IDS.org)!,
        {
          default_legal_basis: 'not_informed',
          default_legal_basis_at: null,
          default_legal_basis_by: null,
        },
      );
    });
    await page.goto('/settings?tab=organization');
    const select = page.getByRole('combobox', { name: 'Base legal padrão dos contatos novos' });
    await expect(select).toHaveValue('not_informed');
    const openGuide = () => page.evaluate(() => window.dispatchEvent(new Event('empreende-crm:open-onboarding')));
    await openGuide();
    const guide = page.getByRole('dialog', { name: 'Configurar CRM', exact: true });
    const step = guide.getByRole('button', { name: 'Etapa 3: Defina a base legal dos contatos' });
    await expect(step).toHaveText('3');
    await step.click();
    await expect(guide.getByRole('button', { name: 'Escolher a base legal' })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);
    await select.selectOption('contract');
    await page.getByRole('button', { name: 'Salvar organização' }).click();
    await expect(page.getByText(/^Definida por Pessoa de Teste em \d{2}\/\d{2}\/\d{4}\.$/)).toBeVisible();
    expect(writes(state, 'organizations').at(-1)!.body).toEqual({
      name: 'Organização de Teste A',
      default_legal_basis: 'contract',
    });
    await openGuide();
    await expect(guide.getByRole('button', { name: 'Etapa 3: Defina a base legal dos contatos' })).toContainText(
      'Verificada',
    );
  });

  test('o colaborador lê o padrão, sem mudar, e o guia diz quem escolhe', async ({ page }) => {
    await setup(page, 'member');
    await page.goto('/settings?tab=organization');
    const select = page.getByRole('combobox', { name: 'Base legal padrão dos contatos novos' });
    await expect(select).toHaveValue('legitimate_interest');
    await expect(select).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event('empreende-crm:open-onboarding')));
    const guide = page.getByRole('dialog', { name: 'Configurar CRM', exact: true });
    await guide.getByRole('button', { name: /^Etapa 3:/ }).click();
    await expect(guide.getByRole('button', { name: 'Escolher a base legal' })).toBeDisabled();
    await expect(guide).toContainText('A base legal padrão é escolhida por donos e administradores.');
  });
});

test.describe('exportação', () => {
  test('o dono confirma, baixa o .zip com o nome da marca, e a ficha e "Segurança" registram', async ({ page }) => {
    // Uma ligação da oportunidade dela com outro contato, no formato do registro do item 1.9: o nome e o e-mail dele
    // saem do pacote.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const state = await setup(page, 'owner', (fixture) => {
      fixture.tables.activities.push({
        id: 'dddddddd-0000-4000-8000-0000000000f1',
        org_id: IDS.org,
        type: 'call',
        title: 'Ligação para Igor Lima',
        body: 'Igor (igor.lima@example.test) disse que a Helena aprovou.',
        contact_id: PRIVACY_IDS.igor,
        company_id: null,
        deal_id: PRIVACY_IDS.deal,
        user_id: IDS.owner,
        created_by: IDS.owner,
        due_date: yesterday,
        end_date: null,
        completed_at: yesterday,
        outcome: 'answered',
        created_at: yesterday,
        updated_at: yesterday,
      });
    });
    const panel = await openContact(page, PRIVACY_IDS.helena);
    const section = privacySection(panel);
    await expect(section.getByRole('status')).toHaveText('Nenhuma exportação ou anonimização registrada.');
    await section.getByRole('button', { name: 'Exportar dados deste contato' }).click();
    const confirm = page.getByRole('dialog', { name: `Exportar os dados de ${HELENA}?` });
    await expect(confirm).toContainText('Os nomes da equipe não vão no arquivo.');
    await expect(confirm).toContainText('apague o arquivo do seu computador depois');
    const file = await download(page, () => confirm.getByRole('button', { name: 'Exportar dados' }).click());
    await expect(confirm).toBeHidden();
    // O nome segue a marca e não leva o nome da pessoa.
    expect(file.name).toBe(buildExportFileName(readBrand().exportName, 'dados-contato-dddddddd', 'zip', today()));
    const entries = readZip(file.buffer);
    expect(entries.map((entry) => entry.name)).toEqual([
      'LEIA-ME.txt',
      'dados.json',
      'contato.csv',
      'atividades.csv',
      'oportunidades.csv',
      'recebimentos.csv',
    ]);
    const entry = (name: string) => entries.find((item) => item.name === name)!;
    const json = JSON.parse(text(entry('dados.json').data));
    expect(json.empresa_controladora).toEqual({ nome: 'Organização de Teste A' });
    expect(json.contato).toMatchObject({
      id: PRIVACY_IDS.helena,
      nome: 'Helena',
      sobrenome: 'Duarte',
      email: 'helena.duarte@example.test',
      telefone: '+5511977776666',
      base_legal: 'Consentimento',
      registro_da_base_legal: 'Marcou a caixa do formulário do site em 01/10/2026.',
      nao_contatar: false,
    });
    expect(json.empresa_vinculada).toEqual({ id: PRIVACY_IDS.company, nome: 'Ateliê Aurora' });
    // As atividades com a pessoa e as da oportunidade dela, com o vínculo; a do outro contato sem os dados dele.
    expect(
      json.atividades.map((item: { titulo: string; vinculo: string }) => `${item.titulo} · ${item.vinculo}`).sort(),
    ).toEqual(
      [
        'Helena gostou do portfólio · Com a pessoa',
        'Ligação para Helena Duarte · Com a pessoa',
        'WhatsApp para Helena · Com a pessoa',
        'Revisar a proposta com o financeiro · Sem contato, na oportunidade',
        'Ligação para [anonimizado] · Com outro contato da oportunidade',
      ].sort(),
    );
    expect(
      json.atividades.find((item: { vinculo: string }) => item.vinculo === 'Com outro contato da oportunidade')
        .detalhes,
    ).toBe('[anonimizado] ([anonimizado]) disse que a Helena aprovou.');
    expect(json.oportunidades).toEqual([
      expect.objectContaining({ titulo: 'Proposta Helena Duarte', funil: 'Comercial', etapa: 'Entrada', valor: 5000 }),
    ]);
    expect(json.recebimentos).toEqual([expect.objectContaining({ descricao: 'Entrada Helena Duarte', valor: 1500 })]);
    // Nenhum nome nem id da equipe no pacote.
    const everything = entries.map((item) => text(item.data)).join('\n');
    for (const team of ['Pessoa de Teste', 'Leitor de Teste', IDS.owner, IDS.viewer])
      expect(everything, team).not.toContain(team);
    for (const other of ['Igor', 'igor.lima@example.test', PRIVACY_IDS.igor])
      expect(everything, other).not.toContain(other);
    expect(text(entry('LEIA-ME.txt').data)).toContain('foram trocados por "[anonimizado]"');
    expect(text(entry('LEIA-ME.txt').data)).toContain('Organização de Teste A');
    for (const name of ['contato.csv', 'atividades.csv', 'oportunidades.csv', 'recebimentos.csv']) {
      expect([...entry(name).data.subarray(0, 3)], name).toEqual([0xef, 0xbb, 0xbf]);
      expect(text(entry(name).data).split('\r\n')[0], name).toContain('";"');
    }
    await expect(section.getByRole('status')).toHaveText(
      /^Dados exportados por Pessoa de Teste em \d{2}\/\d{2}\/\d{4}\.$/,
    );
    expect(state.tables.privacy_actions).toEqual([
      expect.objectContaining({ action: 'export', contact_id: PRIVACY_IDS.helena, performed_by: IDS.owner }),
    ]);
    await page.goto('/settings/security');
    const log = page.getByRole('region', { name: 'Exportações e anonimizações' });
    const row = log.getByRole('row').filter({ hasText: 'Exportação' });
    await expect(row).toContainText(HELENA);
    await expect(row).toContainText('Pessoa de Teste');
    await expect(row.getByRole('link', { name: HELENA })).toHaveAttribute(
      'href',
      `/contacts?contact=${PRIVACY_IDS.helena}`,
    );
  });
});

test.describe('anonimização', () => {
  test('o resumo, a palavra, a faixa do anonimizado e o que muda nas outras telas', async ({ page }) => {
    const state = await setup(page);
    const helena = state.tables.contacts.find((row) => row.id === PRIVACY_IDS.helena)!;
    const version = String(helena.updated_at);
    const panel = await openContact(page, PRIVACY_IDS.helena);
    await privacySection(panel).getByRole('button', { name: 'Anonimizar contato' }).click();
    const dialog = page.getByRole('dialog', { name: 'Anonimizar este contato?' });
    await expect(dialog.getByRole('list', { name: 'O que sai' }).getByRole('listitem')).toHaveText([
      'Nome, e-mail, telefone, cargo, observações, a empresa, o motivo do “Não contatar” e o registro da base legal; da origem, saem o nome, o e-mail e o telefone.',
      '2 atividades com a pessoa ficam sem título e sem anotações.',
      '1 ação pendente com a pessoa será excluída, inclusive as das oportunidades; combine de novo a próxima ação dessas oportunidades.',
      '1 oportunidade e 1 recebimento deixam de apontar para a pessoa, e o nome, o e-mail e o telefone dela saem dos títulos.',
      '2 outros registros citam o nome completo, o e-mail ou o telefone e também serão ajustados.',
    ]);
    await expect(dialog).toContainText('1 oportunidade continua em aberto, sem o contato.');
    await expect(dialog).toContainText('Esta ação não pode ser desfeita.');
    const confirm = dialog.getByRole('button', { name: 'Anonimizar contato' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Digite ANONIMIZAR para confirmar').fill('anonimizar');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toBeHidden();
    // A anonimização vai com a versão lida no resumo (o updated_at do contato).
    expect(state.privacyCalls).toContainEqual({
      rpc: 'contact_privacy_summary',
      body: { p_contact_id: PRIVACY_IDS.helena },
    });
    expect(state.privacyCalls!.filter((call) => call.rpc === 'anonymize_contact')).toEqual([
      { rpc: 'anonymize_contact', body: { p_contact_id: PRIVACY_IDS.helena, p_version: version } },
    ]);
    // A ficha congelada: a faixa, sem canais, sem editar, sem criar ação e sem a seção "Privacidade".
    const band = panel.getByRole('region', { name: 'Contato anonimizado' });
    await expect(band).toContainText(/Anonimizado por Pessoa de Teste em \d{2}\/\d{2}\/\d{4}\./);
    await expect(panel.getByRole('group', { name: /^Canais de/ })).toHaveCount(0);
    await expect(panel.getByRole('region', { name: 'Não contatar' })).toHaveCount(0);
    for (const name of ['Editar cadastro', 'Criar ação', 'Registrar nota', 'Marcar como não contatar'])
      await expect(panel.getByRole('button', { name, exact: true }), name).toHaveCount(0);
    await expect(privacySection(panel)).toHaveCount(0);
    const timeline = panel.locator('[data-tour="360-timeline"]');
    await expect(timeline.getByRole('heading', { name: 'Ligação (contato anonimizado)' })).toBeVisible();
    await expect(timeline.getByRole('heading', { name: 'Nota (contato anonimizado)' })).toBeVisible();
    await expect(timeline.getByRole('heading', { name: 'WhatsApp para Helena' })).toHaveCount(0);
    await expect(timeline.getByRole('button', { name: /^(Editar|Reabrir)$/ })).toHaveCount(0);
    await expect(timeline).not.toContainText('Helena');
    // O diretório: a etiqueta "Anonimizado", e Helena não aparece mais.
    await page.goto('/contacts');
    const anonymized = page.getByRole('row').filter({ hasText: 'Contato anonimizado' });
    await expect(anonymized).toHaveCount(2);
    for (const row of await anonymized.all()) await expect(row).toContainText('Anonimizado');
    await expect(page.getByRole('row').filter({ hasText: 'Helena' })).toHaveCount(0);
    // A oportunidade sem o nome, com o valor; o recebimento e as observações de outro contato também.
    await page.goto(`/pipeline?deal=${PRIVACY_IDS.deal}`);
    const deal = page.getByRole('dialog', { name: 'Proposta [anonimizado]' });
    await expect(deal).toContainText('Não vinculado');
    expect(state.tables.payments.find((row) => row.id === PRIVACY_IDS.payment)).toMatchObject({
      description: 'Entrada [anonimizado]',
      contact_id: null,
      amount: 1500,
    });
    expect(state.tables.contacts.find((row) => row.id === PRIVACY_IDS.igor)).toMatchObject({
      notes: 'Indicado por [anonimizado].',
      source: 'Indicação de [anonimizado]',
    });
    // "Segurança" registra quem anonimizou, com o contato pelo nome atual.
    await page.goto('/settings/security');
    const row = page
      .getByRole('region', { name: 'Exportações e anonimizações' })
      .getByRole('row')
      .filter({ hasText: 'Anonimização' });
    await expect(row).toContainText('Contato anonimizado');
    await expect(row).toContainText('Pessoa de Teste');
  });

  test('o contato mudou desde o resumo: a mensagem, o resumo recarregado e a palavra limpa', async ({ page }) => {
    const state = await setup(page, 'admin', (fixture) => {
      fixture.touchBeforeNextAnonymization = PRIVACY_IDS.helena;
    });
    const panel = await openContact(page, PRIVACY_IDS.helena);
    await privacySection(panel).getByRole('button', { name: 'Anonimizar contato' }).click();
    const dialog = page.getByRole('dialog', { name: 'Anonimizar este contato?' });
    const word = dialog.getByLabel('Digite ANONIMIZAR para confirmar');
    const confirm = dialog.getByRole('button', { name: 'Anonimizar contato' });
    await expect(dialog.getByRole('list', { name: 'O que sai' })).toBeVisible();
    const summaries = () => state.privacyCalls!.filter((call) => call.rpc === 'contact_privacy_summary').length;
    const before = summaries();
    await word.fill('ANONIMIZAR');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Este contato mudou desde o resumo. Confira o resumo atualizado e confirme de novo.',
    );
    await expect(word).toHaveValue('');
    await expect(confirm).toBeDisabled();
    // O resumo é lido de novo, com a versão nova.
    await expect.poll(summaries).toBeGreaterThan(before);
    await word.fill('ANONIMIZAR');
    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(panel.getByRole('region', { name: 'Contato anonimizado' })).toBeVisible();
    expect(state.tables.contacts.find((row) => row.id === PRIVACY_IDS.helena)).toMatchObject({
      first_name: 'Contato anonimizado',
      email: null,
      anonymized_by: IDS.owner,
    });
  });
});

test.describe('papéis', () => {
  for (const role of ['member', 'viewer'] as const)
    test(`${role === 'member' ? 'colaborador' : 'somente leitura'} não vê a seção "Privacidade" nem os registros`, async ({
      page,
    }) => {
      await setup(page, role);
      const panel = await openContact(page, PRIVACY_IDS.helena);
      await expect(summary(panel)).toContainText('Consentimento');
      await expect(privacySection(panel)).toHaveCount(0);
      await expect(panel.getByRole('button', { name: 'Exportar dados deste contato' })).toHaveCount(0);
      await page.goto('/settings/security');
      await expect(page.getByRole('region', { name: 'Exportações e anonimizações' })).toContainText(
        'Disponível para donos e administradores.',
      );
    });
});

test.describe('"Não contatar"', () => {
  test('"Já aconteceu" travada para a ligação, a recusa do banco ao reabrir o plano e "Combinar ação" só com Tarefa', async ({
    page,
  }) => {
    const state = await setup(page);
    const panel = await openContact(page, PRIVACY_IDS.marta);
    await panel.getByRole('button', { name: 'Criar ação' }).click();
    const form = page.getByRole('dialog', { name: 'Nova atividade' });
    await form.getByLabel('Tipo').click();
    await page.getByRole('option', { name: 'Ligação', exact: true }).click();
    const happened = form.getByRole('checkbox', { name: 'Já aconteceu' });
    await expect(happened).toBeChecked();
    await expect(happened).toBeDisabled();
    await expect(happened).toHaveAccessibleDescription(
      'Este contato está marcado como “Não contatar”: o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele. Registre aqui o que já aconteceu, ou escolha Tarefa.',
    );
    await expect(form.getByLabel('Quando aconteceu *')).not.toHaveValue('');
    await form.getByLabel('Título *').fill('Ligação recebida da Marta');
    await form.getByLabel('Resultado').click();
    await page.getByRole('option', { name: 'Atendeu', exact: true }).click();
    await form.getByRole('button', { name: 'Salvar atividade' }).click();
    await expect(form).toBeHidden();
    const received = state.tables.activities.find((row) => row.title === 'Ligação recebida da Marta')!;
    expect(received).toMatchObject({ type: 'call', contact_id: PRIVACY_IDS.marta, outcome: 'answered' });
    expect(received.completed_at).toBe(received.due_date);
    const timeline = panel.locator('[data-tour="360-timeline"]');
    await expect(timeline.getByText('Ligação · Concluída · Atendeu')).toBeVisible();
    // Trocar a tarefa já agendada por uma ligação é recusado pelo banco, com a mensagem dele.
    const task = timeline.getByRole('listitem').filter({ hasText: 'Preparar o contrato da Marta' });
    await task.getByRole('button', { name: 'Editar' }).click();
    const edit = page.getByRole('dialog', { name: 'Editar atividade' });
    await edit.getByLabel('Tipo').click();
    await page.getByRole('option', { name: 'Ligação', exact: true }).click();
    await edit.getByRole('button', { name: 'Salvar atividade' }).click();
    await expect(edit.getByRole('alert')).toHaveText(
      'Este contato está marcado como “Não contatar”: o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele. Registre como concluído o que já aconteceu, ou use uma tarefa para o trabalho interno.',
    );
    expect(state.tables.activities.find((row) => row.id === PRIVACY_IDS.martaTask)).toMatchObject({ type: 'task' });
    await edit.getByRole('button', { name: 'Cancelar' }).click();
    // Na oportunidade da Marta, "Combinar ação" só oferece Tarefa.
    await page.goto(`/pipeline?deal=${PRIVACY_IDS.martaDeal}`);
    const deal = page.getByRole('dialog', { name: 'Renovação da Marta' });
    await deal.getByRole('button', { name: 'Combinar ação' }).click();
    const type = deal.getByLabel('Tipo');
    await expect(type).toHaveAccessibleDescription(/o contato desta oportunidade está marcado como “Não contatar”/);
    await type.click();
    for (const name of ['Ligação', 'WhatsApp', 'E-mail', 'Reunião', 'Visita'])
      await expect(page.getByRole('option', { name, exact: true }), name).toBeDisabled();
    await expect(page.getByRole('option', { name: 'Tarefa', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await deal.getByRole('button', { name: 'Salvar ação' }).click();
    await expect(deal.getByRole('listitem').filter({ hasText: 'Retorno para Marta Marcada' })).toContainText('Tarefa');
  });
});

test.describe('planilha de contatos', () => {
  test('leva nao_contatar e base_legal e deixa de fora os anonimizados', async ({ page }, testInfo) => {
    // As exportações são conferidas no desktop, como nos demais testes de arquivos.
    test.skip(isMobile(testInfo), 'exportação de planilha só no desktop');
    await setup(page);
    await page.goto('/settings/integrations');
    const file = await download(page, () =>
      page.getByRole('button', { name: 'Exportar contatos', exact: true }).click(),
    );
    const lines = file.buffer.toString('utf8').slice(1).split('\r\n');
    expect(lines[0]).toBe('"first_name";"last_name";"email";"phone";"nao_contatar";"base_legal"');
    expect(lines).toContain(`"Marta";"Marcada";"marta@example.test";"'+5511966665555";"sim";"Legítimo interesse"`);
    expect(lines).toContain(`"Helena";"Duarte";"helena.duarte@example.test";"'+5511977776666";"";"Consentimento"`);
    expect(lines).toContain('"Contato";"Alfa";"alfa@example.test";"11900000000";"";"Não informada"');
    expect(lines.some((line) => line.includes('Contato anonimizado'))).toBe(false);
  });
});

test.describe('layout', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`seção "Privacidade", diálogos, faixa do anonimizado e base legal sem rolagem lateral (${theme})`, async ({
      page,
    }, testInfo) => {
      const state = withPrivacy(createFixture());
      await installCrmFixture(page, { state, theme });
      const widths = isMobile(testInfo) ? [320, 375] : [1440];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        const panel = await openContact(page, PRIVACY_IDS.helena);
        const section = privacySection(panel);
        await section.scrollIntoViewIfNeeded();
        await expect(section.getByRole('status')).toHaveText('Nenhuma exportação ou anonimização registrada.');
        await settled(panel);
        await expectNoHorizontalScroll(page, `ficha ${width}px`);
        await section.screenshot({ path: testInfo.outputPath(`privacidade-secao-${theme}-${width}.png`) });
        if (isMobile(testInfo))
          for (const name of ['Exportar dados deste contato', 'Anonimizar contato'])
            await expectTouchTarget(section.getByRole('button', { name }), `${name} ${width}px`);
        await section.getByRole('button', { name: 'Exportar dados deste contato' }).click();
        const exporting = page.getByRole('dialog', { name: `Exportar os dados de ${HELENA}?` });
        await expect(exporting).toBeVisible();
        await settled(exporting);
        await expectNoHorizontalScroll(page, `exportação ${width}px`);
        await page.screenshot({ path: testInfo.outputPath(`privacidade-exportar-${theme}-${width}.png`) });
        if (isMobile(testInfo))
          for (const name of ['Cancelar', 'Exportar dados'])
            await expectTouchTarget(exporting.getByRole('button', { name, exact: true }), `${name} ${width}px`);
        await exporting.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await expect(exporting).toBeHidden();
        await section.getByRole('button', { name: 'Anonimizar contato' }).click();
        const anonymizing = page.getByRole('dialog', { name: 'Anonimizar este contato?' });
        await expect(anonymizing.getByRole('list', { name: 'O que sai' })).toBeVisible();
        await anonymizing.getByLabel('Digite ANONIMIZAR para confirmar').fill('ANONIMIZAR');
        await expect(anonymizing.getByRole('button', { name: 'Anonimizar contato' })).toBeEnabled();
        await settled(anonymizing);
        await expectNoHorizontalScroll(page, `anonimização ${width}px`);
        // O diálogo cabe na tela, com rolagem interna: o botão de confirmar é alcançável.
        const box = (await anonymizing.boundingBox())!;
        expect(box.height, 'diálogo dentro da tela').toBeLessThanOrEqual(800);
        await page.screenshot({ path: testInfo.outputPath(`privacidade-anonimizar-${theme}-${width}.png`) });
        if (isMobile(testInfo)) {
          for (const name of ['Cancelar', 'Anonimizar contato'])
            await expectTouchTarget(anonymizing.getByRole('button', { name, exact: true }), `${name} ${width}px`);
          await expectTouchTarget(
            anonymizing.getByLabel('Digite ANONIMIZAR para confirmar'),
            `campo da palavra ${width}px`,
          );
        }
        await anonymizing.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await expect(anonymizing).toBeHidden();
        // O campo da base legal no cadastro.
        await panel.getByRole('button', { name: 'Editar cadastro' }).click();
        const edit = page.getByRole('dialog', { name: 'Editar contato' });
        const basis = edit.getByLabel('Base legal', { exact: true });
        await basis.scrollIntoViewIfNeeded();
        await expect(edit.getByLabel('Como a pessoa consentiu *')).toBeVisible();
        await settled(edit);
        await expectNoHorizontalScroll(page, `base legal ${width}px`);
        if (isMobile(testInfo)) await expectTouchTarget(basis, `base legal ${width}px`);
        await edit.screenshot({ path: testInfo.outputPath(`privacidade-base-legal-${theme}-${width}.png`) });
        await edit.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await expect(edit).toBeHidden();
        // A faixa do contato anonimizado.
        const frozen = await openContact(page, PRIVACY_IDS.anonymized);
        await expect(frozen.getByRole('region', { name: 'Contato anonimizado' })).toBeVisible();
        await settled(frozen);
        await expectNoHorizontalScroll(page, `anonimizado ${width}px`);
        await page.screenshot({ path: testInfo.outputPath(`privacidade-anonimizado-${theme}-${width}.png`) });
      }
    });
  }
});
