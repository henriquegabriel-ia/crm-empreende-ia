import {
  buildCsv,
  csvEncoding,
  decodeCsvBytes,
  MAX_CSV_BYTES,
  parseCsv,
  spreadsheetFileKind,
  type CsvColumn,
  type CsvEncoding,
  type CsvSeparator,
} from '@/lib/csv';
import {
  IMPORT_RESULT_HEADERS,
  mapContactHeaders,
  normalizeHeader,
  type ContactHeaderMap,
  type ContactHeaderMapping,
  type ContactImportField,
} from '@/lib/contact-import-headers';
import { internationalE164, normalizePhoneBR, phoneToStore } from '@/lib/phone';
import { LEGAL_BASES, LEGAL_BASIS_LABELS, type LegalBasis } from '@/lib/privacy';
import { assignableMembers, isActiveMember, personName } from '@/lib/team-members';

/**
 * Importação de planilha de contatos, corte mínimo (item 1.11; docs/arquitetura/1.11.md). Um caminho só: a importação
 * de "Integrações" (desde o 0.5) lê o arquivo aqui, mostra a prévia e grava em lotes pelo navegador
 * (src/components/contact-import). Nada aqui acessa o banco: a tela lê os contatos cadastrados, as empresas e a equipe
 * e passa como contexto.
 *
 * As etapas, nesta ordem:
 * 1. `readContactSheet`: o arquivo (tamanho, planilha binária recusada, codificação, separador, linhas e cabeçalhos);
 * 2. `analyzeContactImport`: os valores de cada linha, os erros, os repetidos contra os contatos cadastrados, o
 *    responsável da coluna e as empresas, com o id de cada contato e de cada empresa nova gerado aqui e mantido até o
 *    fim (uma nova tentativa reenvia os mesmos ids, e nada duplica);
 * 3. `planContactImport`: as escolhas da prévia (responsável, origem padrão e telefone repetido), a classificação de
 *    cada linha (pronta, repetida ou com erro), a divisão entre pessoas, as empresas novas e o pedido de cada contato;
 * 4. `contactImportBatches`: os lotes de até 500, primeiro as empresas e depois os contatos;
 * 5. `contactImportIssuesCsv`: a planilha dos contatos não importados, que pode ser corrigida e importada de novo.
 *
 * As regras continuam no banco, pelos gatilhos de sempre (responsável ativo, "Não contatar", base legal, índice único
 * do e-mail): esta leitura só explica antes do pedido.
 */

/** Linhas com dados por arquivo. */
export const MAX_CONTACT_IMPORT_ROWS = 5000;
/** Contatos (e empresas) por pedido de gravação. */
export const CONTACT_IMPORT_BATCH_SIZE = 500;
/** Linhas de cada lista da prévia. */
export const PREVIEW_READY_ROWS = 20;
export const PREVIEW_ISSUE_ROWS = 50;

/**
 * Limites de cada campo: os do cadastro onde ele já tem (RecordEditor e os CHECK do banco) e, nos demais, generosos para
 * não cortar dados reais. Acima do limite, a linha tem erro; nada é cortado.
 */
export const CONTACT_IMPORT_LIMITS = {
  first_name: 160,
  last_name: 150,
  email: 254,
  phone: 40,
  company: 200,
  job_title: 150,
  source: 100,
  notes: 2000,
  legal_basis_note: 500,
} as const;

/** Motivo gravado com a marca "Não contatar" que vem da planilha; a data e o autor são do banco. */
export const IMPORTED_DO_NOT_CONTACT_REASON = 'Veio marcado na planilha importada.';

const count = (value: number) => value.toLocaleString('pt-BR');

export const IMPORT_MESSAGES = {
  tooLarge: 'O arquivo deve ter até 5 MB. Divida a planilha em partes menores.',
  spreadsheet:
    'Este arquivo é uma planilha do Excel ou de outro programa (.xlsx, .xls ou .ods), e o CRM lê só CSV. No Excel, use Arquivo > Salvar como e escolha “CSV UTF-8 (delimitado por vírgulas)”. No Google Planilhas, use Arquivo > Fazer download > Valores separados por vírgula (.csv).',
  empty: 'O arquivo não contém contatos.',
  tooManyRows: (rows: number) =>
    `A planilha tem ${count(rows)} linhas com dados. Importe até ${count(MAX_CONTACT_IMPORT_ROWS)} por vez: divida o arquivo em partes.`,
  missingName: 'Falta o nome: preencha a coluna do nome.',
  nameTooLong: `O nome passa de ${CONTACT_IMPORT_LIMITS.first_name} caracteres.`,
  lastNameTooLong: `O sobrenome passa de ${CONTACT_IMPORT_LIMITS.last_name} caracteres.`,
  invalidEmail: 'E-mail inválido. Use um e-mail por contato, como ana@empresa.com.br.',
  emailTooLong: `O e-mail passa de ${CONTACT_IMPORT_LIMITS.email} caracteres.`,
  phoneTooLong: `O telefone passa de ${CONTACT_IMPORT_LIMITS.phone} caracteres.`,
  scientificPhone: (value: string) =>
    `O Excel trocou o telefone por notação científica (${value}). Formate a coluna como Texto, digite o número de novo e salve.`,
  companyTooLong: `O nome da empresa passa de ${CONTACT_IMPORT_LIMITS.company} caracteres.`,
  jobTitleTooLong: `O cargo passa de ${CONTACT_IMPORT_LIMITS.job_title} caracteres.`,
  sourceTooLong: `A origem passa de ${CONTACT_IMPORT_LIMITS.source} caracteres.`,
  notesTooLong: `As observações passam de ${count(CONTACT_IMPORT_LIMITS.notes)} caracteres.`,
  status: (value: string) =>
    `Relacionamento “${value}” não reconhecido: use Lead, Em prospecção, Cliente ou Encerrado.`,
  doNotContact: 'Use “sim” ou deixe vazio na coluna “Não contatar”.',
  doNotContactMigration:
    'Este CRM ainda não tem a atualização dos canais, e a marca “Não contatar” não seria gravada. Peça a quem administra para aplicar a migração mais recente.',
  legalBasis: (value: string) =>
    `Base legal “${value}” não reconhecida: use Consentimento, Contrato ou pedido da pessoa, Legítimo interesse, Obrigação legal, Exercício de direitos ou deixe vazio.`,
  consentNote:
    'Consentimento precisa do registro de como a pessoa consentiu: preencha a coluna “Registro da base legal”.',
  legalBasisNoteTooLong: `O registro da base legal passa de ${CONTACT_IMPORT_LIMITS.legal_basis_note} caracteres.`,
  extraCells: 'A linha tem mais colunas que o cabeçalho: talvez um ponto e vírgula dentro de um texto sem aspas.',
  ownerDeactivated: (value: string) =>
    `A pessoa “${value}” está desativada na equipe e não recebe contatos. Escolha uma pessoa ativa.`,
  ownerAmbiguous: (value: string) => `Há mais de uma pessoa com o nome “${value}” na equipe: use o e-mail dela.`,
  ownerUnknown: (value: string) =>
    `Responsável “${value}” não encontrado: use o nome ou o e-mail de uma pessoa ativa, como aparece em “Equipe”.`,
  existingEmail: 'Já existe um contato com este e-mail.',
  existingPhone: 'Já existe um contato com este telefone.',
  duplicateDoNotContact:
    'A linha pede “Não contatar”, e o contato que fica no CRM não tem a marca: marque na ficha dele.',
  sheetEmail: (line: number) => `Repetida na planilha: o mesmo e-mail está na linha ${count(line)}.`,
  sheetPhone: (line: number) => `Repetida na planilha: o mesmo telefone está na linha ${count(line)}.`,
  notWritten: 'Não gravada: a importação parou antes desta linha.',
  chooseOwner: 'Escolha a pessoa responsável pelos contatos sem responsável na planilha.',
  chooseDistribution: 'Marque ao menos uma pessoa para distribuir.',
  noReadyRows: 'Nenhuma linha está pronta para importar.',
} as const;

/** Uma linha de dados da planilha: o número no Excel e as células como estão no arquivo (completadas até o cabeçalho). */
export interface ContactSheetRow {
  line: number;
  cells: string[];
  /** A linha tem células preenchidas além do cabeçalho. */
  extraCells: boolean;
}

export interface ContactSheet {
  fileName: string;
  encoding: CsvEncoding;
  separator: CsvSeparator;
  headers: string[];
  mapping: ContactHeaderMapping;
  recognized: ContactHeaderMap['recognized'];
  ignored: string[];
  rows: ContactSheetRow[];
}

export type ContactSheetResult = { sheet: ContactSheet; error: null } | { sheet: null; error: string };

/**
 * Caracteres de controle invisíveis (o NUL, por exemplo), fora o TAB e as quebras de linha das observações. Saem na
 * leitura (revisão do item 1.11): o banco recusa o NUL num texto (22P05), e o lote inteiro falharia sem dizer a linha.
 */
const CONTROL_CHARACTERS = /[^\P{Cc}\t\n\r]/gu;
const withoutControlCharacters = (value: string) => value.replace(CONTROL_CHARACTERS, '');

/**
 * Lê o arquivo escolhido, nesta ordem: tamanho; assinatura de planilha binária; codificação; leitura; arquivo sem
 * cabeçalho ou sem linhas; mais de 5.000 linhas com dados; cabeçalhos. Os caracteres de controle saem das células.
 */
export function readContactSheet(bytes: ArrayBuffer | Uint8Array, fileName: string): ContactSheetResult {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.byteLength > MAX_CSV_BYTES) return { sheet: null, error: IMPORT_MESSAGES.tooLarge };
  if (spreadsheetFileKind(view)) return { sheet: null, error: IMPORT_MESSAGES.spreadsheet };
  const encoding = csvEncoding(view);
  const parsed = parseCsv(decodeCsvBytes(view));
  if (parsed.error) return { sheet: null, error: parsed.error };
  if (!parsed.headers.length || !parsed.rows.length) return { sheet: null, error: IMPORT_MESSAGES.empty };
  if (parsed.rows.length > MAX_CONTACT_IMPORT_ROWS)
    return { sheet: null, error: IMPORT_MESSAGES.tooManyRows(parsed.rows.length) };
  const headers = parsed.headers.map(withoutControlCharacters);
  const map = mapContactHeaders(headers);
  if (map.error) return { sheet: null, error: map.error };
  const rows = parsed.rows.map((cells, index) => ({
    line: parsed.lines[index],
    cells: headers.map((_, column) => withoutControlCharacters(cells[column] ?? '')),
    extraCells: cells.slice(headers.length).some((cell) => withoutControlCharacters(cell).trim() !== ''),
  }));
  return {
    sheet: {
      fileName,
      encoding,
      separator: parsed.separator,
      headers,
      mapping: map.mapping,
      recognized: map.recognized,
      ignored: map.ignored,
      rows,
    },
    error: null,
  };
}

/** Texto de uma linha só: espaços internos (inclusive o não separável do Excel) reduzidos a um, sem as pontas. */
const singleLine = (value: string) => value.replace(/\s+/g, ' ').trim();
/** Observações: mantêm as quebras de linha, sem as pontas. */
const multiline = (value: string) => value.replace(/\r\n?/g, '\n').trim();

const YES = new Set(['sim', 's', 'x', '1', 'verdadeiro', 'true', 'yes']);
const NO = new Set(['', 'nao', 'n', '0', 'falso', 'false', 'no']);

/** "Não contatar": "sim", "s", "x", "1", "verdadeiro", "true" ou "yes"; vazio, "não", "n", "0", "falso" ou "false". */
export function parseYesNo(value: string): boolean | null {
  const key = normalizeHeader(value);
  if (YES.has(key)) return true;
  if (NO.has(key)) return false;
  return null;
}

const LEGAL_BASIS_BY_TEXT = new Map<string, LegalBasis>([
  ...LEGAL_BASES.map((basis) => [normalizeHeader(basis), basis] as const),
  ...LEGAL_BASES.map((basis) => [normalizeHeader(LEGAL_BASIS_LABELS[basis]), basis] as const),
  ['contrato', 'contract'],
  ['pedido da pessoa', 'contract'],
  ['exercicio regular de direitos', 'exercise_of_rights'],
]);

/** A base legal pelo código ou pelo rótulo, sem diferença de acento e maiúscula; vazia é "não informada". */
export function parseLegalBasisCell(value: string): LegalBasis | null {
  const key = normalizeHeader(value);
  if (!key) return 'not_informed';
  return LEGAL_BASIS_BY_TEXT.get(key) ?? null;
}

const STATUS_BY_TEXT = new Map<string, string>([
  ['lead', 'lead'],
  ['prospect', 'prospect'],
  ['em prospeccao', 'prospect'],
  ['prospeccao', 'prospect'],
  ['customer', 'customer'],
  ['cliente', 'customer'],
  ['churned', 'churned'],
  ['encerrado', 'churned'],
  ['ex cliente', 'churned'],
]);

/** O relacionamento pelo código ou pelo rótulo; vazio é lead. */
export function parseContactStatus(value: string): string | null {
  const key = normalizeHeader(value);
  if (!key) return 'lead';
  return STATUS_BY_TEXT.get(key) ?? null;
}

/** Telefone que o Excel virou número ("5,51E+12"). */
export const isScientificNotation = (value: string) => /^\d+([.,]\d+)?e\+?\d+$/i.test(value.trim());

/**
 * Chave de comparação de um nome: sem acento, maiúscula e pontuação ("Acme Ltda.", "ACME LTDA" e "acme-ltda" casam).
 * Um nome sem letras latinas nem dígitos ("株式会社", "-") vira vazio nessa conta; nesse caso, a chave é o próprio nome,
 * aparado e em minúsculas, para não casar com outro nome que também viraria vazio (revisão do item 1.11).
 */
export const textKey = (value: string | null | undefined) =>
  normalizeHeader(value) || singleLine(value ?? '').toLocaleLowerCase('pt-BR');

/** Chave da empresa (textKey). */
export const companyKey = (name: string | null | undefined) => textKey(name);

/** Chave de e-mail repetido: aparado e minúsculo. */
export const emailKey = (email: string | null | undefined) => (email ?? '').trim().toLowerCase() || null;

/** Chave de telefone repetido: o E.164 reconhecido (Brasil ou outro país com "+"); texto não reconhecido nunca é chave. */
export const phoneKey = (phone: string | null | undefined) =>
  normalizePhoneBR(phone).e164 ?? internationalE164(phone) ?? null;

/** Pessoa da equipe para o responsável: a situação vem de user_roles (item 1.2). */
export interface ImportMember {
  id: string;
  name?: string | null;
  email?: string | null;
  active?: boolean;
}

export type MemberMatch = { id: string; error: null } | { id: null; error: string };

/**
 * A coluna do responsável: o e-mail de uma pessoa da equipe e, depois, o nome exato (sem acento e sem maiúscula, pela
 * chave de textKey: "-" ou "王芳" não casam com uma pessoa de nome "李明"). Pessoa desativada, desconhecida ou com o nome
 * repetido na equipe é erro; sem correspondência parcial.
 */
export function matchMember(value: string, members: readonly ImportMember[]): MemberMatch {
  const typed = singleLine(value);
  const typedKey = textKey(typed);
  const byEmail = members.filter((member) => emailKey(member.email) === typed.toLowerCase());
  const candidates = byEmail.length
    ? byEmail
    : typedKey
      ? members.filter((member) => textKey(personName(member)) === typedKey)
      : [];
  const active = candidates.filter(isActiveMember);
  if (active.length === 1) return { id: active[0].id, error: null };
  if (active.length > 1) return { id: null, error: IMPORT_MESSAGES.ownerAmbiguous(typed) };
  if (candidates.length) return { id: null, error: IMPORT_MESSAGES.ownerDeactivated(typed) };
  return { id: null, error: IMPORT_MESSAGES.ownerUnknown(typed) };
}

/** O que o banco tem: as colunas do 1.9 ("Não contatar") e do 1.10 (base legal) podem faltar num banco antigo. */
export interface ImportColumns {
  doNotContact: boolean;
  legalBasis: boolean;
}

/** Contato cadastrado, com o que a conferência de repetidos usa; `do_not_contact` só quando o banco tem a coluna (1.9). */
export interface ExistingImportContact {
  id: string;
  email: string | null;
  phone: string | null;
  do_not_contact?: boolean | null;
}

export interface ContactImportContext {
  orgId: string;
  existingContacts: readonly ExistingImportContact[];
  companies: readonly { id: string; name: string; created_at: string }[];
  members: readonly ImportMember[];
  columns: ImportColumns;
}

export interface AnalyzeOptions {
  /** Gera os ids (padrão: crypto.randomUUID). */
  newId?: () => string;
  /** Os ids já usados por uma análise anterior desta importação, por posição da linha. */
  rowIds?: ReadonlyMap<number, string>;
  /** Os ids das empresas novas de uma análise anterior, por chave. */
  companyIds?: ReadonlyMap<string, string>;
  /** Só estas linhas (por posição): as que faltam gravar, numa nova análise depois de uma recusa do banco. */
  onlyRows?: ReadonlySet<number>;
}

export interface ImportedContactValues {
  first_name: string;
  last_name: string | null;
  email: string | null;
  /** O que o cadastro grava (phoneToStore): o E.164 reconhecido ou o texto como está. */
  phone: string | null;
  phoneRecognized: boolean;
  company: string | null;
  job_title: string | null;
  source: string | null;
  /** O responsável da coluna, quando ela está preenchida e casa com uma pessoa ativa. */
  ownerId: string | null;
  /** A coluna do responsável está preenchida (a linha não entra na divisão). */
  ownerFromColumn: boolean;
  status: string;
  notes: string | null;
  doNotContact: boolean;
  legalBasis: LegalBasis;
  legalBasisNote: string | null;
}

export interface AnalyzedContactRow {
  /** Posição na planilha (0 é a primeira linha de dados). */
  index: number;
  line: number;
  cells: readonly string[];
  /** Id do contato, gerado na análise e mantido até o fim. */
  id: string;
  values: ImportedContactValues;
  /** Todos os problemas da linha, em pt-BR. */
  errors: string[];
  /** Repetida por um contato cadastrado: pelo e-mail (tem precedência) ou só pelo telefone. */
  existing: 'email' | 'phone' | null;
  /**
   * O contato cadastrado que repete a linha tem "Não contatar" (com o telefone, todos os que têm o número); nulo sem
   * repetida ou quando a leitura não trouxe a marca (banco sem a migração do 1.9).
   */
  existingMarked: boolean | null;
  emailKey: string | null;
  phoneKey: string | null;
  companyKey: string | null;
}

export interface ContactImportAnalysis {
  sheet: ContactSheet;
  orgId: string;
  columns: ImportColumns;
  members: readonly ImportMember[];
  rows: AnalyzedContactRow[];
  /** Empresa cadastrada de cada chave (a mais antiga, com nomes repetidos no CRM). */
  existingCompanies: ReadonlyMap<string, string>;
  /** Id da empresa nova de cada chave sem correspondência (só nasce a que alguma linha pronta cita). */
  newCompanyIds: ReadonlyMap<string, string>;
  /** As colunas de base legal da planilha ficaram de fora porque o banco não tem a migração do 1.10. */
  privacyColumnsIgnored: boolean;
}

const cellOf = (sheet: ContactSheet, row: ContactSheetRow, field: ContactImportField) => {
  const column = sheet.mapping[field];
  return column === undefined ? '' : (row.cells[column] ?? '');
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function analyzeRow(
  sheet: ContactSheet,
  row: ContactSheetRow,
  index: number,
  id: string,
  context: ContactImportContext,
  known: KnownContacts,
): AnalyzedContactRow {
  const errors: string[] = [];
  const text = (field: ContactImportField) => cellOf(sheet, row, field);
  const firstName = singleLine(text('first_name'));
  if (!firstName) errors.push(IMPORT_MESSAGES.missingName);
  else if (firstName.length > CONTACT_IMPORT_LIMITS.first_name) errors.push(IMPORT_MESSAGES.nameTooLong);
  const lastName = singleLine(text('last_name'));
  if (lastName.length > CONTACT_IMPORT_LIMITS.last_name) errors.push(IMPORT_MESSAGES.lastNameTooLong);
  const email = text('email').trim().toLowerCase();
  if (email && email.length > CONTACT_IMPORT_LIMITS.email) errors.push(IMPORT_MESSAGES.emailTooLong);
  else if (email && !EMAIL_PATTERN.test(email)) errors.push(IMPORT_MESSAGES.invalidEmail);
  const typedPhone = text('phone').trim();
  const stored = phoneToStore(typedPhone);
  if (typedPhone && isScientificNotation(typedPhone)) errors.push(IMPORT_MESSAGES.scientificPhone(typedPhone));
  else if ((stored.value ?? '').length > CONTACT_IMPORT_LIMITS.phone) errors.push(IMPORT_MESSAGES.phoneTooLong);
  const company = singleLine(text('company'));
  if (company.length > CONTACT_IMPORT_LIMITS.company) errors.push(IMPORT_MESSAGES.companyTooLong);
  const jobTitle = singleLine(text('job_title'));
  if (jobTitle.length > CONTACT_IMPORT_LIMITS.job_title) errors.push(IMPORT_MESSAGES.jobTitleTooLong);
  const source = singleLine(text('source'));
  if (source.length > CONTACT_IMPORT_LIMITS.source) errors.push(IMPORT_MESSAGES.sourceTooLong);
  const ownerText = singleLine(text('owner'));
  let ownerId: string | null = null;
  if (ownerText) {
    const match = matchMember(ownerText, context.members);
    if (match.error) errors.push(match.error);
    else ownerId = match.id;
  }
  const statusText = singleLine(text('status'));
  const status = parseContactStatus(statusText);
  if (!status) errors.push(IMPORT_MESSAGES.status(statusText));
  const notes = multiline(text('notes'));
  if (notes.length > CONTACT_IMPORT_LIMITS.notes) errors.push(IMPORT_MESSAGES.notesTooLong);
  const doNotContactText = singleLine(text('do_not_contact'));
  const doNotContact = parseYesNo(doNotContactText);
  if (doNotContact === null) errors.push(IMPORT_MESSAGES.doNotContact);
  else if (doNotContact && !context.columns.doNotContact) errors.push(IMPORT_MESSAGES.doNotContactMigration);
  let legalBasis: LegalBasis = 'not_informed';
  let legalBasisNote: string | null = null;
  // Sem a migração do 1.10, as colunas de base legal ficam de fora (com o aviso da prévia), e o consentimento não se
  // aplica: o banco nem tem onde gravar.
  if (context.columns.legalBasis) {
    const basisText = singleLine(text('legal_basis'));
    const basis = parseLegalBasisCell(basisText);
    if (!basis) errors.push(IMPORT_MESSAGES.legalBasis(basisText));
    else legalBasis = basis;
    const note = text('legal_basis_note').trim();
    if (note.length > CONTACT_IMPORT_LIMITS.legal_basis_note) errors.push(IMPORT_MESSAGES.legalBasisNoteTooLong);
    if (basis === 'consent' && !note) errors.push(IMPORT_MESSAGES.consentNote);
    legalBasisNote = note || null;
  }
  if (row.extraCells) errors.push(IMPORT_MESSAGES.extraCells);
  const keys = { email: email && EMAIL_PATTERN.test(email) ? email : null, phone: phoneKey(typedPhone) };
  const existing =
    keys.email && known.emails.has(keys.email) ? 'email' : keys.phone && known.phones.has(keys.phone) ? 'phone' : null;
  const existingMarked =
    existing === 'email'
      ? (known.emails.get(keys.email!) ?? null)
      : existing === 'phone'
        ? (known.phones.get(keys.phone!) ?? null)
        : null;
  return {
    index,
    line: row.line,
    cells: row.cells,
    id,
    values: {
      first_name: firstName,
      last_name: lastName || null,
      email: email || null,
      phone: stored.value,
      phoneRecognized:
        !stored.value || stored.kind === 'mobile' || stored.kind === 'landline' || stored.kind === 'international',
      company: company || null,
      job_title: jobTitle || null,
      source: source || null,
      ownerId,
      ownerFromColumn: Boolean(ownerText),
      status: status ?? 'lead',
      notes: notes || null,
      doNotContact: Boolean(doNotContact),
      legalBasis,
      legalBasisNote,
    },
    errors,
    existing,
    existingMarked,
    emailKey: keys.email,
    phoneKey: keys.phone,
    companyKey: company ? companyKey(company) || null : null,
  };
}

/** As chaves dos contatos cadastrados, cada uma com a marca "Não contatar" (nula quando a leitura não a trouxe). */
interface KnownContacts {
  emails: Map<string, boolean | null>;
  phones: Map<string, boolean | null>;
}

function knownContacts(contacts: readonly ExistingImportContact[]): KnownContacts {
  const known: KnownContacts = { emails: new Map(), phones: new Map() };
  const add = (map: Map<string, boolean | null>, key: string | null, marked: boolean | null) => {
    if (!key) return;
    // Com o telefone de vários contatos, a marca vale só quando todos a têm.
    const current = map.get(key);
    map.set(key, current === undefined ? marked : current === null || marked === null ? null : current && marked);
  };
  for (const contact of contacts) {
    const marked = typeof contact.do_not_contact === 'boolean' ? contact.do_not_contact : null;
    add(known.emails, emailKey(contact.email), marked);
    add(known.phones, phoneKey(contact.phone), marked);
  }
  return known;
}

/** Linhas analisadas por vez antes de ceder a vez à tela. */
export const ANALYSIS_CHUNK_SIZE = 500;

/**
 * A análise como um gerador que cede a vez a cada ANALYSIS_CHUNK_SIZE linhas: a versão síncrona roda até o fim, e a da
 * tela espera um instante entre os pedaços. As duas dão o mesmo resultado.
 */
function* analysisSteps(
  sheet: ContactSheet,
  context: ContactImportContext,
  options: AnalyzeOptions,
): Generator<void, ContactImportAnalysis> {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const known = knownContacts(context.existingContacts);
  // Empresa cadastrada por chave: com nomes repetidos no CRM, a mais antiga (e o id como desempate).
  const existingCompanies = new Map<string, string>();
  const oldestFirst = [...context.companies].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  for (const company of oldestFirst) {
    const key = companyKey(company.name);
    if (key && !existingCompanies.has(key)) existingCompanies.set(key, company.id);
  }
  const rows: AnalyzedContactRow[] = [];
  const newCompanyIds = new Map<string, string>();
  for (const [index, row] of sheet.rows.entries()) {
    if (options.onlyRows && !options.onlyRows.has(index)) continue;
    const analyzed = analyzeRow(sheet, row, index, options.rowIds?.get(index) ?? newId(), context, known);
    rows.push(analyzed);
    const key = analyzed.companyKey;
    if (key && !existingCompanies.has(key) && !newCompanyIds.has(key))
      newCompanyIds.set(key, options.companyIds?.get(key) ?? newId());
    if (rows.length % ANALYSIS_CHUNK_SIZE === 0) yield;
  }
  const privacyColumnsIgnored =
    !context.columns.legalBasis &&
    (sheet.mapping.legal_basis !== undefined || sheet.mapping.legal_basis_note !== undefined);
  return {
    sheet,
    orgId: context.orgId,
    columns: context.columns,
    members: context.members,
    rows,
    existingCompanies,
    newCompanyIds,
    privacyColumnsIgnored,
  };
}

/** Analisa a planilha inteira de uma vez (síncrona e sem efeito colateral além dos ids gerados). */
export function analyzeContactImport(
  sheet: ContactSheet,
  context: ContactImportContext,
  options: AnalyzeOptions = {},
): ContactImportAnalysis {
  const steps = analysisSteps(sheet, context, options);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** A mesma análise, cedendo a vez à tela a cada 500 linhas, para o celular não travar com 5 mil linhas. */
export async function analyzeContactImportInChunks(
  sheet: ContactSheet,
  context: ContactImportContext,
  options: AnalyzeOptions = {},
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
): Promise<ContactImportAnalysis> {
  const steps = analysisSteps(sheet, context, options);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    await pause();
  }
}

export type OwnerMode = 'me' | 'other' | 'distribute';

export interface ContactImportOptions {
  /** Responsável dos contatos sem responsável na planilha: quem importa, outra pessoa ou a divisão. */
  ownerMode: OwnerMode;
  /** Quem importa. */
  meId: string;
  otherOwnerId?: string | null;
  /** Pessoas marcadas em "Distribuir igualmente entre"; só as ativas contam, na ordem alfabética da lista. */
  distributeIds?: readonly string[];
  /** Origem dos contatos sem origem na planilha. */
  defaultSource?: string;
  /** "Importar também as linhas com telefone repetido". */
  includePhoneDuplicates?: boolean;
}

/** O pedido de cada contato: todas as linhas de um lote com as mesmas chaves (seção 4.4 do desenho). */
export interface ContactPayload {
  id: string;
  org_id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_id: string | null;
  owner_id: string | null;
  status: string;
  job_title: string | null;
  source: string | null;
  notes: string | null;
  do_not_contact?: boolean;
  do_not_contact_reason?: string | null;
  legal_basis?: LegalBasis;
  legal_basis_note?: string | null;
}

export interface CompanyPayload {
  id: string;
  org_id: string;
  name: string;
  owner_id: string | null;
}

export type ImportRowStatus = 'ready' | 'duplicate' | 'error';

export interface PlannedContactRow {
  row: AnalyzedContactRow;
  status: ImportRowStatus;
  reasons: string[];
  ownerId: string | null;
  companyId: string | null;
  payload: ContactPayload | null;
  /** Sem a opção do telefone, a linha seria repetida só pelo telefone. */
  phoneOnlyDuplicate: boolean;
}

export interface ContactImportPlan {
  rows: PlannedContactRow[];
  ready: PlannedContactRow[];
  duplicates: PlannedContactRow[];
  errors: PlannedContactRow[];
  /** Empresas novas, na ordem da primeira linha pronta que cita cada uma. */
  companies: CompanyPayload[];
  /** Contagem por pessoa de "Distribuir igualmente entre", na ordem da lista. */
  distribution: { id: string; count: number }[];
  /** Alguma linha pronta depende da escolha do responsável (sem a coluna ou com a célula vazia). */
  needsOwnerChoice: boolean;
  /** Linhas repetidas só pelo telefone (sem a opção); a prévia oferece a opção quando há alguma. */
  phoneDuplicateCount: number;
  /** Com a opção, as linhas repetidas só pelo telefone que entram. */
  importedPhoneDuplicates: number;
  unrecognizedPhones: number;
  doNotContact: number;
  /** Repetidas que pedem "Não contatar" sem a marca no contato que fica no CRM (a prévia avisa: a marca é na ficha). */
  duplicateDoNotContact: number;
  consents: number;
  /** Por que "Importar" fica desabilitado, ou nulo. */
  blocked: string | null;
}

interface Classified {
  status: ImportRowStatus;
  reasons: string[];
  phoneOnlyDuplicate: boolean;
}

/**
 * Classificação, linha a linha e na ordem da planilha: (1) o e-mail ou o telefone casam com um contato cadastrado:
 * repetida, mesmo com outros erros; (2) com erro; (3) o e-mail ou o telefone casam com uma linha pronta anterior:
 * repetida, com a linha dela; (4) pronta, e as chaves dela passam a valer para as seguintes. Com a opção do telefone,
 * as repetidas só pelo telefone (cadastradas ou da planilha) seguem como as demais; o e-mail nunca. Uma repetida que pede
 * "Não contatar" quando o contato que fica no CRM não tem a marca ganha o motivo que manda marcar na ficha (revisão do
 * item 1.11: a importação não muda contatos cadastrados, e o pedido de oposição não pode sumir sem aviso).
 */
function classify(rows: readonly AnalyzedContactRow[], includePhoneDuplicates: boolean): Classified[] {
  const emails = new Map<string, { line: number; marked: boolean }>();
  const phones = new Map<string, { line: number; marked: boolean }>();
  const duplicate = (
    row: AnalyzedContactRow,
    reason: string,
    marked: boolean | null,
    phoneOnly: boolean,
  ): Classified => ({
    status: 'duplicate',
    reasons: row.values.doNotContact && marked === false ? [reason, IMPORT_MESSAGES.duplicateDoNotContact] : [reason],
    phoneOnlyDuplicate: phoneOnly,
  });
  return rows.map((row) => {
    if (row.existing === 'email') return duplicate(row, IMPORT_MESSAGES.existingEmail, row.existingMarked, false);
    if (row.existing === 'phone' && !includePhoneDuplicates)
      return duplicate(row, IMPORT_MESSAGES.existingPhone, row.existingMarked, true);
    if (row.errors.length) return { status: 'error', reasons: row.errors, phoneOnlyDuplicate: false };
    const byEmail = row.emailKey ? emails.get(row.emailKey) : undefined;
    if (byEmail) return duplicate(row, IMPORT_MESSAGES.sheetEmail(byEmail.line), byEmail.marked, false);
    const byPhone = row.phoneKey ? phones.get(row.phoneKey) : undefined;
    if (byPhone && !includePhoneDuplicates)
      return duplicate(row, IMPORT_MESSAGES.sheetPhone(byPhone.line), byPhone.marked, true);
    const own = { line: row.line, marked: row.values.doNotContact };
    if (row.emailKey) emails.set(row.emailKey, own);
    if (row.phoneKey && !phones.has(row.phoneKey)) phones.set(row.phoneKey, own);
    return { status: 'ready', reasons: [], phoneOnlyDuplicate: row.existing === 'phone' || byPhone !== undefined };
  });
}

/** As pessoas da divisão: só as ativas marcadas, na ordem alfabética da lista (assignableMembers). */
export function distributionMembers(members: readonly ImportMember[], selected: readonly string[]): string[] {
  const chosen = new Set(selected);
  return assignableMembers(members)
    .filter((member) => chosen.has(member.id))
    .map((member) => member.id);
}

/**
 * O plano da importação com as escolhas da prévia: recalculado a cada mudança de opção, sem reler o arquivo nem o banco,
 * e congelado ao confirmar.
 */
export function planContactImport(analysis: ContactImportAnalysis, options: ContactImportOptions): ContactImportPlan {
  const includePhone = Boolean(options.includePhoneDuplicates);
  const withoutOption = includePhone ? classify(analysis.rows, false) : null;
  const classified = classify(analysis.rows, includePhone);
  const active = new Set(analysis.members.filter(isActiveMember).map((member) => member.id));
  const distributeIds = distributionMembers(analysis.members, options.distributeIds ?? []);
  const defaultSource = singleLine(options.defaultSource ?? '').slice(0, CONTACT_IMPORT_LIMITS.source) || null;
  const needsOwnerChoice = analysis.rows.some(
    (row, position) => classified[position].status === 'ready' && !row.values.ownerFromColumn,
  );
  let blocked: string | null = null;
  if (needsOwnerChoice && options.ownerMode === 'distribute' && !distributeIds.length)
    blocked = IMPORT_MESSAGES.chooseDistribution;
  if (needsOwnerChoice && options.ownerMode === 'other' && (!options.otherOwnerId || !active.has(options.otherOwnerId)))
    blocked = IMPORT_MESSAGES.chooseOwner;
  const counts = new Map(distributeIds.map((id) => [id, 0]));
  let turn = 0;
  const ownerFor = (row: AnalyzedContactRow): string | null => {
    if (row.values.ownerFromColumn) return row.values.ownerId;
    if (options.ownerMode === 'other') return options.otherOwnerId ?? null;
    if (options.ownerMode === 'distribute') {
      if (!distributeIds.length) return null;
      const id = distributeIds[turn++ % distributeIds.length];
      counts.set(id, (counts.get(id) ?? 0) + 1);
      return id;
    }
    return options.meId;
  };
  const companies = new Map<string, CompanyPayload>();
  const rows: PlannedContactRow[] = analysis.rows.map((row, position) => {
    const { status, reasons, phoneOnlyDuplicate } = classified[position];
    const wouldBePhoneDuplicate = withoutOption ? withoutOption[position].phoneOnlyDuplicate : phoneOnlyDuplicate;
    if (status !== 'ready')
      return {
        row,
        status,
        reasons,
        ownerId: null,
        companyId: null,
        payload: null,
        phoneOnlyDuplicate: wouldBePhoneDuplicate,
      };
    const ownerId = ownerFor(row);
    let companyId: string | null = null;
    const key = row.companyKey;
    if (key) {
      companyId = analysis.existingCompanies.get(key) ?? null;
      if (!companyId) {
        companyId = analysis.newCompanyIds.get(key) ?? null;
        // A empresa nova nasce com o nome da primeira linha pronta que a cita e o responsável do primeiro contato dela.
        if (companyId && !companies.has(key))
          companies.set(key, {
            id: companyId,
            org_id: analysis.orgId,
            name: row.values.company ?? '',
            owner_id: ownerId,
          });
      }
    }
    const values = row.values;
    const payload: ContactPayload = {
      id: row.id,
      org_id: analysis.orgId,
      first_name: values.first_name,
      last_name: values.last_name,
      email: values.email,
      phone: values.phone,
      company_id: companyId,
      owner_id: ownerId,
      status: values.status,
      job_title: values.job_title,
      source: values.source ?? defaultSource,
      notes: values.notes,
      ...(analysis.columns.doNotContact
        ? {
            do_not_contact: values.doNotContact,
            do_not_contact_reason: values.doNotContact ? IMPORTED_DO_NOT_CONTACT_REASON : null,
          }
        : {}),
      ...(analysis.columns.legalBasis
        ? { legal_basis: values.legalBasis, legal_basis_note: values.legalBasisNote }
        : {}),
    };
    return { row, status, reasons, ownerId, companyId, payload, phoneOnlyDuplicate: wouldBePhoneDuplicate };
  });
  const ready = rows.filter((row) => row.status === 'ready');
  if (!ready.length) blocked = IMPORT_MESSAGES.noReadyRows;
  return {
    rows,
    ready,
    duplicates: rows.filter((row) => row.status === 'duplicate'),
    errors: rows.filter((row) => row.status === 'error'),
    companies: [...companies.values()],
    distribution: distributeIds.map((id) => ({ id, count: counts.get(id) ?? 0 })),
    needsOwnerChoice,
    phoneDuplicateCount: rows.filter((row) => row.phoneOnlyDuplicate).length,
    importedPhoneDuplicates: includePhone ? ready.filter((row) => row.phoneOnlyDuplicate).length : 0,
    unrecognizedPhones: ready.filter((row) => !row.row.values.phoneRecognized).length,
    doNotContact: ready.filter((row) => row.payload?.do_not_contact).length,
    duplicateDoNotContact: rows.filter(
      (row) => row.status === 'duplicate' && row.reasons.includes(IMPORT_MESSAGES.duplicateDoNotContact),
    ).length,
    consents: ready.filter((row) => row.payload?.legal_basis === 'consent').length,
    blocked,
  };
}

/** Divide uma lista em lotes de até `size`. */
export function inBatches<T>(items: readonly T[], size = CONTACT_IMPORT_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) batches.push(items.slice(start, start + size));
  return batches;
}

/** Os lotes da gravação: primeiro as empresas novas, depois os contatos, até 500 por pedido. */
export function contactImportBatches(plan: ContactImportPlan) {
  return {
    companies: inBatches(plan.companies),
    contacts: inBatches(plan.ready.map((row) => row.payload!)),
  };
}

export type IssueResult = 'Repetida' | 'Com erro' | 'Não gravada';

/** Os motivos de uma linha numa frase só: cada um já termina com ponto. */
export const joinReasons = (reasons: readonly string[]) => reasons.join(' ');

export interface ContactImportIssue {
  line: number;
  result: IssueResult;
  reason: string;
  cells: readonly string[];
}

/**
 * As linhas que não entraram: repetidas, com erro e, depois da gravação, as prontas ainda não gravadas (`written` tem
 * os ids gravados; na prévia, sem gravação, fica nulo e as prontas não entram). `extra` acrescenta as que o banco
 * recusou durante a gravação (e-mail cadastrado no meio).
 */
export function contactImportIssues(
  plan: ContactImportPlan,
  written: ReadonlySet<string> | null = null,
  extra: ReadonlyMap<string, string> = new Map(),
): ContactImportIssue[] {
  return plan.rows.flatMap((planned): ContactImportIssue[] => {
    const { row } = planned;
    const late = extra.get(row.id);
    if (late) return [{ line: row.line, result: 'Repetida', reason: late, cells: row.cells }];
    if (planned.status === 'duplicate')
      return [{ line: row.line, result: 'Repetida', reason: joinReasons(planned.reasons), cells: row.cells }];
    if (planned.status === 'error')
      return [{ line: row.line, result: 'Com erro', reason: joinReasons(planned.reasons), cells: row.cells }];
    if (written && !written.has(row.id))
      return [{ line: row.line, result: 'Não gravada', reason: IMPORT_MESSAGES.notWritten, cells: row.cells }];
    return [];
  });
}

const RESULT_KEYS = new Set<string>(IMPORT_RESULT_HEADERS.map((header) => normalizeHeader(header)));

/**
 * A planilha "contatos não importados" (BOM, ";", CRLF e a neutralização de fórmulas de buildCsv): `linha_planilha`,
 * `resultado_importacao` e `motivo_importacao`, seguidas das colunas originais, na ordem e com os valores do arquivo.
 * As três colunas de uma planilha de não importados escolhida de novo não se repetem.
 */
export function contactImportIssuesCsv(sheet: ContactSheet, issues: readonly ContactImportIssue[]): string {
  const originals = sheet.headers
    .map((header, column) => ({ header, column }))
    .filter(({ header }) => !RESULT_KEYS.has(normalizeHeader(header)));
  const columns: CsvColumn<ContactImportIssue>[] = [
    { header: IMPORT_RESULT_HEADERS[0], value: (issue) => issue.line },
    { header: IMPORT_RESULT_HEADERS[1], value: (issue) => issue.result },
    { header: IMPORT_RESULT_HEADERS[2], value: (issue) => issue.reason },
    ...originals.map(({ header, column }) => ({
      header,
      value: (issue: ContactImportIssue) => issue.cells[column] ?? '',
    })),
  ];
  return buildCsv(issues, columns);
}

/** Nome da pessoa para a prévia ("Bruna Recebedora"), ou o e-mail. */
export function importMemberName(members: readonly ImportMember[], id: string | null | undefined): string {
  const member = id ? members.find((person) => person.id === id) : undefined;
  return member ? personName(member) || 'Pessoa sem nome' : 'Sem responsável';
}
