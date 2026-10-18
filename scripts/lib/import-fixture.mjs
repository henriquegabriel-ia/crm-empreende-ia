/**
 * Fixture sintética da importação de planilha (item 1.11; docs/arquitetura/1.11.md, seção 11.3): 5.000 linhas com dados,
 * no formato do "CSV (separado por vírgulas)" do Excel em português (Windows-1252, ";" e CRLF), com cabeçalhos
 * sinônimos, uma coluna ignorada, repetidas e erros conhecidos e duas linhas em branco no meio. Os nomes, os e-mails,
 * as empresas, os cargos, as origens e as situações saem do gerador do item 0.10 (scripts/lib/volume-data.mjs, com a
 * semente fixa); os telefones são montados pela posição da linha, para nenhum repetir por acaso.
 *
 * `buildContactImportFixture()` devolve os bytes do arquivo, as linhas, os contatos que o teste acrescenta à fixture do
 * navegador (`existing`, com telefones gravados no formato antigo) e as contagens esperadas (`expected`), calculadas aqui
 * pela construção de cada linha, sem usar o código do app: o teste do Vitest (import-fixture.test.mjs) confere que a
 * análise do app chega às mesmas contagens, e o E2E (tests/browser/import.spec.ts) confere a prévia e a gravação.
 *
 * O contexto é o da fixture do navegador com `withContactImport` (tests/browser/fixture.ts): o contato "Contato Alfa"
 * (alfa@example.test) e a "Empresa Exemplo" da base, a equipe do item 1.2 (Bruna Recebedora, Carla Administradora e o
 * Fulano Vendedor, desativado) e os contatos de `existing`.
 *
 * Regenerar o arquivo versionado: `node scripts/lib/import-fixture.mjs --write` (o teste compara os bytes).
 *
 * Arquivo em JavaScript puro (ESM, sem dependências), como o gerador do 0.10, para rodar no Node, no Vitest e no
 * Playwright sem compilação.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateVolumeData } from './volume-data.mjs';

export const IMPORT_FIXTURE_FILE = 'tests/browser/import/contatos-5000.csv';
export const IMPORT_FIXTURE_ROWS = 5000;
export const IMPORT_FIXTURE_HEADERS = Object.freeze([
  'Nome completo',
  'E-mail',
  'Celular',
  'Empresa',
  'Cargo',
  'Origem',
  'Responsável',
  'Situação',
  'Observações',
  'Não contatar',
  'Base legal',
  'Registro da base legal',
  'Data de nascimento',
]);
/** Origem padrão que o E2E escreve na prévia, para as linhas sem origem. */
export const IMPORT_FIXTURE_DEFAULT_SOURCE = 'Planilha de outubro';
export const IMPORT_FIXTURE_CONSENT_NOTE = 'Marcou a caixa do formulário do site em 01/10/2026.';

/** Contatos que o teste acrescenta à fixture do navegador: telefones gravados nos formatos antigos. */
export const IMPORT_FIXTURE_EXISTING = Object.freeze([
  { first_name: 'Já', last_name: 'Cadastrada', email: 'ja.cadastrada@example.test', phone: null },
  { first_name: 'Telefone', last_name: 'Antigo', email: null, phone: '(11) 98888-0001' },
  { first_name: 'Telefone', last_name: 'Sem Máscara', email: null, phone: '11988880002' },
]);

const MESSAGES = Object.freeze({
  existingEmail: 'Já existe um contato com este e-mail.',
  existingPhone: 'Já existe um contato com este telefone.',
  sheetEmail: 'Repetida na planilha (e-mail)',
  sheetPhone: 'Repetida na planilha (telefone)',
  missingName: 'Sem nome',
  invalidEmail: 'E-mail inválido',
  scientificPhone: 'Notação científica',
  unknownOwner: 'Responsável não encontrado',
  deactivatedOwner: 'Responsável desativado',
  status: 'Relacionamento não reconhecido',
  doNotContact: 'Não contatar inválido',
  legalBasis: 'Base legal não reconhecida',
  consentNote: 'Consentimento sem registro',
  nameTooLong: 'Nome longo',
  extraCells: 'Colunas a mais',
});

const DDDS = ['11', '21', '31', '41', '47', '48', '51', '61', '62', '71', '81', '85', '92'];
const STATUS_TEXT = { lead: '', prospect: 'Em prospecção', customer: 'Cliente', churned: 'Encerrado' };

/** Telefone único da linha i, num dos formatos que as pessoas digitam. */
function phoneOf(i) {
  const ddd = DDDS[i % DDDS.length];
  const number = `9${String(20000000 + i).padStart(8, '0')}`;
  switch (i % 5) {
    case 0:
      return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    case 1:
      return `${ddd} ${number}`;
    case 2:
      return `+55 ${ddd} ${number.slice(0, 5)}-${number.slice(5)}`;
    case 3:
      return `${ddd}${number}`;
    default:
      return `0${ddd} ${number.slice(0, 5)} ${number.slice(5)}`;
  }
}
/** O E.164 do telefone de phoneOf. */
const e164Of = (i) => `+55${DDDS[i % DDDS.length]}9${String(20000000 + i).padStart(8, '0')}`;

/** Chave de empresa como a do app (sem acento, maiúscula e pontuação), refeita aqui para a contagem esperada. */
const companyKey = (name) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Windows-1252 dos caracteres usados: ASCII, Latin-1 e as aspas e o travessão não aparecem. */
function windows1252(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new Error(`Caractere fora do Windows-1252 na fixture: ${text[i]}`);
    bytes[i] = code;
  }
  return bytes;
}

/**
 * Monta a fixture. As linhas especiais ficam em posições fixas e substituem os campos de uma linha comum; cada linha
 * diz em que categoria a prévia deve classificá-la (`ready`, `duplicate` ou `error`, com o motivo).
 */
export function buildContactImportFixture() {
  const volume = generateVolumeData({
    orgId: 'fixture-org',
    ownerIds: ['fixture-owner'],
    stages: [{ id: 'fixture-stage', pipeline_id: 'fixture-pipeline' }],
    counts: { companies: 300, contacts: IMPORT_FIXTURE_ROWS, deals: 0, activities: 0 },
  });
  const companyById = new Map(volume.companies.map((company) => [company.id, company.name]));
  const rows = volume.contacts.map((contact, i) => {
    const company = contact.company_id ? companyById.get(contact.company_id) : '';
    const legal =
      i % 40 === 3
        ? 'legitimate_interest'
        : i % 40 === 5
          ? 'Contrato ou pedido da pessoa'
          : i % 40 === 9
            ? 'Consentimento'
            : '';
    return {
      line: 0,
      category: 'ready',
      reason: null,
      cells: {
        name: `${contact.first_name} ${contact.last_name}`,
        // Uma linha em cada 23 sem e-mail.
        email: i % 23 === 11 ? '' : contact.email,
        // Uma em cada 17 sem telefone e uma em cada 97 com um telefone que o CRM não reconhece.
        phone: i % 17 === 4 ? '' : i % 97 === 13 ? 'ramal 22' : phoneOf(i),
        company: i % 61 === 7 ? 'EMPRESA EXEMPLO' : i % 29 === 0 && company ? company.toUpperCase() : (company ?? ''),
        jobTitle: contact.job_title ?? '',
        source: contact.source ?? '',
        owner: i % 10 === 0 ? 'Bruna Recebedora' : i % 10 === 1 ? 'carla@example.test' : '',
        status: STATUS_TEXT[contact.status],
        notes: i % 50 === 0 ? 'Prefere WhatsApp.\r\nLigar depois das 14h.' : '',
        doNotContact: i % 50 === 7 ? 'sim' : '',
        legal,
        note: legal === 'Consentimento' ? IMPORT_FIXTURE_CONSENT_NOTE : '',
        birth: `${String((i % 28) + 1).padStart(2, '0')}/0${(i % 9) + 1}/19${70 + (i % 30)}`,
        extra: '',
      },
    };
  });
  const special = (i, fields, category, reason) => {
    Object.assign(rows[i].cells, fields);
    rows[i].category = category;
    rows[i].reason = reason;
  };
  // Repetidas contra os contatos cadastrados: pelo e-mail (com outra caixa e espaços) e pelo telefone nos formatos antigos.
  special(
    120,
    { email: ' ALFA@example.test ', doNotContact: '', legal: '', note: '' },
    'duplicate',
    MESSAGES.existingEmail,
  );
  special(
    121,
    { email: 'Ja.Cadastrada@Example.test', doNotContact: '', legal: '', note: '' },
    'duplicate',
    MESSAGES.existingEmail,
  );
  special(
    122,
    { phone: '+55 11 98888-0001', email: '', doNotContact: '', legal: '', note: '' },
    'duplicate',
    MESSAGES.existingPhone,
  );
  special(
    123,
    { phone: '(11) 98888-0002', email: '', doNotContact: '', legal: '', note: '' },
    'duplicate',
    MESSAGES.existingPhone,
  );
  // A repetida tem precedência sobre o erro: e-mail cadastrado e nome vazio.
  special(124, { email: 'alfa@example.test', name: '' }, 'duplicate', MESSAGES.existingEmail);
  // Repetidas dentro do arquivo: o e-mail da linha 300 (com outra caixa) e o telefone da linha 301.
  special(
    2300,
    { email: rows[300].cells.email.toUpperCase(), doNotContact: '', legal: '', note: '' },
    'duplicate',
    MESSAGES.sheetEmail,
  );
  special(
    2301,
    { phone: phoneOf(301).replace(/\D/g, ''), email: '', doNotContact: '', legal: '', note: '' },
    'duplicate',
    MESSAGES.sheetPhone,
  );
  special(
    2302,
    { phone: e164Of(302), email: '', doNotContact: '', legal: '', note: '' },
    'duplicate',
    MESSAGES.sheetPhone,
  );
  // Um erro de cada regra.
  special(3000, { name: '' }, 'error', MESSAGES.missingName);
  special(3001, { email: 'contato@' }, 'error', MESSAGES.invalidEmail);
  special(3002, { phone: '5,51E+12' }, 'error', MESSAGES.scientificPhone);
  special(3003, { owner: 'Ninguém da Silva' }, 'error', MESSAGES.unknownOwner);
  special(3004, { owner: 'Fulano Vendedor' }, 'error', MESSAGES.deactivatedOwner);
  special(3005, { status: 'VIP' }, 'error', MESSAGES.status);
  special(3006, { doNotContact: 'talvez' }, 'error', MESSAGES.doNotContact);
  special(3007, { legal: 'marketing', note: '' }, 'error', MESSAGES.legalBasis);
  special(3008, { legal: 'Consentimento', note: '' }, 'error', MESSAGES.consentNote);
  special(3009, { name: `Nome ${'muito '.repeat(26)}longo` }, 'error', MESSAGES.nameTooLong);
  special(3010, { extra: 'Rua das Flores, 10' }, 'error', MESSAGES.extraCells);

  // O texto do arquivo: o cabeçalho é a linha 1, e duas linhas em branco entram antes das linhas 1001 e 4001 de dados.
  const lines = [IMPORT_FIXTURE_HEADERS.map(csvCell).join(';')];
  let excelLine = 1;
  rows.forEach((row, i) => {
    if (i === 1000 || i === 4000) {
      lines.push('');
      excelLine++;
    }
    const c = row.cells;
    const cells = [
      c.name,
      c.email,
      c.phone,
      c.company,
      c.jobTitle,
      c.source,
      c.owner,
      c.status,
      c.notes,
      c.doNotContact,
      c.legal,
      c.note,
      c.birth,
    ];
    if (c.extra) cells.push(c.extra);
    lines.push(cells.map(csvCell).join(';'));
    excelLine++;
    row.line = excelLine;
  });
  const text = lines.join('\r\n') + '\r\n';

  // Contagens esperadas, pela construção.
  const ready = rows.filter((row) => row.category === 'ready');
  const byReason = (category) => {
    const counts = {};
    for (const row of rows.filter((item) => item.category === category))
      counts[row.reason] = (counts[row.reason] ?? 0) + 1;
    return counts;
  };
  const existingCompanyKeys = new Set(['empresa exemplo', 'empresa do fulano']);
  const newCompanies = new Map();
  for (const row of ready) {
    const key = row.cells.company ? companyKey(row.cells.company) : '';
    if (key && !existingCompanyKeys.has(key) && !newCompanies.has(key)) newCompanies.set(key, row.cells.company);
  }
  const distributed = ready.filter((row) => !row.cells.owner).length;
  const expected = {
    rows: rows.length,
    ready: ready.length,
    duplicates: rows.length - ready.length - rows.filter((row) => row.category === 'error').length,
    errors: rows.filter((row) => row.category === 'error').length,
    duplicateReasons: byReason('duplicate'),
    errorReasons: byReason('error'),
    newCompanies: newCompanies.size,
    linkedToExampleCompany: ready.filter((row) => row.cells.company === 'EMPRESA EXEMPLO').length,
    unrecognizedPhones: ready.filter((row) => row.cells.phone === 'ramal 22').length,
    doNotContact: ready.filter((row) => row.cells.doNotContact === 'sim').length,
    consents: ready.filter((row) => row.cells.legal === 'Consentimento').length,
    legitimateInterest: ready.filter((row) => row.cells.legal === 'legitimate_interest').length,
    contract: ready.filter((row) => row.cells.legal === 'Contrato ou pedido da pessoa').length,
    withoutSource: ready.filter((row) => !row.cells.source).length,
    ownerColumn: {
      bruna: ready.filter((row) => row.cells.owner === 'Bruna Recebedora').length,
      carla: ready.filter((row) => row.cells.owner === 'carla@example.test').length,
    },
    // "Distribuir igualmente entre" Bruna e Carla: rodízio na ordem da planilha, Bruna primeiro (ordem alfabética).
    distribution: { bruna: Math.ceil(distributed / 2), carla: Math.floor(distributed / 2) },
    errorLines: Object.fromEntries(rows.filter((row) => row.category === 'error').map((row) => [row.reason, row.line])),
    duplicateLines: rows.filter((row) => row.category === 'duplicate').map((row) => row.line),
  };
  return {
    bytes: windows1252(text),
    text,
    headers: IMPORT_FIXTURE_HEADERS,
    rows,
    existing: IMPORT_FIXTURE_EXISTING,
    expected,
  };
}

if (process.argv.includes('--write') && path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const { bytes, expected } = buildContactImportFixture();
  writeFileSync(path.join(root, IMPORT_FIXTURE_FILE), bytes);
  console.log(
    `${IMPORT_FIXTURE_FILE}: ${expected.rows} linhas (${expected.ready} prontas, ${expected.duplicates} repetidas e ${expected.errors} com erro).`,
  );
}
