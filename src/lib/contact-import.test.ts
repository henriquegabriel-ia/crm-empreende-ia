import { describe, expect, it } from 'vitest';
import {
  analyzeContactImport,
  analyzeContactImportInChunks,
  companyKey,
  CONTACT_IMPORT_BATCH_SIZE,
  contactImportBatches,
  contactImportIssues,
  contactImportIssuesCsv,
  distributionMembers,
  IMPORT_MESSAGES,
  IMPORTED_DO_NOT_CONTACT_REASON,
  isScientificNotation,
  joinReasons,
  matchMember,
  MAX_CONTACT_IMPORT_ROWS,
  parseContactStatus,
  parseLegalBasisCell,
  parseYesNo,
  planContactImport,
  readContactSheet,
  textKey,
  type ContactImportContext,
  type ContactImportOptions,
  type ContactSheet,
} from '@/lib/contact-import';
import { MISSING_NAME_COLUMN } from '@/lib/contact-import-headers';
import { MAX_CSV_BYTES, parseCsv } from '@/lib/csv';

const ORG = 'org-1';
const MEMBERS = [
  { id: 'me', name: 'Pessoa de Teste', email: 'owner@example.test', active: true },
  { id: 'bruna', name: 'Bruna Recebedora', email: 'bruna@example.test', active: true },
  { id: 'carla', name: 'Carla Administradora', email: 'carla@example.test', active: true },
  { id: 'fulano', name: 'Fulano Vendedor', email: 'fulano@example.test', active: false },
  { id: 'leitor', name: 'Leitor de Teste', email: 'viewer@example.test', active: true },
];

const encode = (text: string) => new TextEncoder().encode(text);
function sheetOf(text: string): ContactSheet {
  const result = readContactSheet(encode(text), 'planilha.csv');
  if (result.error) throw new Error(result.error);
  return result.sheet;
}
function contextOf(overrides: Partial<ContactImportContext> = {}): ContactImportContext {
  return {
    orgId: ORG,
    existingContacts: [],
    companies: [],
    members: MEMBERS,
    columns: { doNotContact: true, legalBasis: true },
    ...overrides,
  };
}
let sequence = 0;
const newId = () => `id-${++sequence}`;
const ME: ContactImportOptions = { ownerMode: 'me', meId: 'me' };
function plan(
  text: string,
  overrides: Partial<ContactImportContext> = {},
  options: Partial<ContactImportOptions> = {},
) {
  sequence = 0;
  const analysis = analyzeContactImport(sheetOf(text), contextOf(overrides), { newId });
  return { analysis, plan: planContactImport(analysis, { ...ME, ...options }) };
}
const reasonsOf = (result: ReturnType<typeof plan>['plan']) =>
  result.rows.map((row) => `${row.row.line} ${row.status}${row.reasons.length ? `: ${row.reasons.join('; ')}` : ''}`);

describe('readContactSheet', () => {
  it('recusa o arquivo acima de 5 MB, antes de ler', () => {
    expect(readContactSheet(new Uint8Array(MAX_CSV_BYTES + 1), 'grande.csv')).toEqual({
      sheet: null,
      error: IMPORT_MESSAGES.tooLarge,
    });
    expect(readContactSheet(encode('nome\nAna'), 'ok.csv').error).toBeNull();
  });

  it.each([
    ['XLSX', [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]],
    ['ODS', [0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00]],
    ['XLS', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]],
  ])('recusa %s pela assinatura, com o passo a passo para salvar em CSV', (_, bytes) => {
    const result = readContactSheet(new Uint8Array(bytes), 'planilha.xlsx');
    expect(result.error).toBe(IMPORT_MESSAGES.spreadsheet);
    expect(result.error).toContain('CSV UTF-8 (delimitado por vírgulas)');
    expect(result.error).toContain('Valores separados por vírgula (.csv)');
  });

  it('recusa arquivo vazio, só com cabeçalho e com aspas não fechadas', () => {
    expect(readContactSheet(encode(''), 'a.csv').error).toBe(IMPORT_MESSAGES.empty);
    expect(readContactSheet(encode('nome;email\r\n\r\n'), 'a.csv').error).toBe(IMPORT_MESSAGES.empty);
    expect(readContactSheet(encode('nome;email\n"Ana;ana@example.test'), 'a.csv').error).toBe(
      'Há aspas não fechadas no CSV.',
    );
  });

  it('aceita até 5.000 linhas com dados e recusa 5.001, com a contagem', () => {
    const lines = (count: number) => ['nome', ...Array.from({ length: count }, (_, i) => `Pessoa ${i}`)].join('\n');
    expect(readContactSheet(encode(lines(MAX_CONTACT_IMPORT_ROWS)), 'a.csv').sheet?.rows).toHaveLength(5000);
    expect(readContactSheet(encode(lines(5001)), 'a.csv').error).toBe(
      'A planilha tem 5.001 linhas com dados. Importe até 5.000 por vez: divida o arquivo em partes.',
    );
  });

  it('recusa o cabeçalho sem nome e duas colunas para o mesmo campo', () => {
    expect(readContactSheet(encode('email\nana@example.test'), 'a.csv').error).toBe(MISSING_NAME_COLUMN);
    expect(readContactSheet(encode('nome;telefone;celular\nAna;1;2'), 'a.csv').error).toContain(
      '“telefone” e “celular”',
    );
  });

  it('completa as linhas curtas e marca as longas com células preenchidas', () => {
    const sheet = sheetOf('nome;email;telefone\nAna\nBia;bia@example.test;;\nCaio;;;extra');
    expect(sheet.rows.map((row) => [row.cells, row.extraCells])).toEqual([
      [['Ana', '', ''], false],
      [['Bia', 'bia@example.test', ''], false],
      [['Caio', '', ''], true],
    ]);
  });

  // Revisão do item 1.11: o banco recusa o NUL num texto (22P05), e o lote inteiro falharia sem dizer a linha.
  it('tira os caracteres de controle das células e dos cabeçalhos, mantendo o TAB e as quebras das observações', () => {
    const sheet = sheetOf('nome\u0000;observacoes;cidade\u0007\nAna\u0000;"linha 1\nlinha\u000b 2";Re\u001fcife\u007f');
    expect(sheet.headers).toEqual(['nome', 'observacoes', 'cidade']);
    expect(sheet.rows[0].cells).toEqual(['Ana', 'linha 1\nlinha 2', 'Recife']);
    const { plan: result } = plan('nome;email\nAna\u0000;a@example.test\nBia;\u0000');
    expect(result.ready.map((row) => row.payload?.first_name)).toEqual(['Ana', 'Bia']);
    expect(JSON.stringify(result.ready.map((row) => row.payload))).not.toContain('\\u0000');
    // Uma célula só com caracteres de controle além do cabeçalho não conta como célula a mais.
    expect(sheetOf('nome\nAna;\u0000').rows[0].extraCells).toBe(false);
  });

  it('lê Windows-1252, UTF-16 e TAB, com a codificação e o separador', () => {
    const latin = readContactSheet(Buffer.from('Nome;Empresa\r\nJoão;Ação Ltda\r\n', 'latin1'), 'excel.csv').sheet!;
    expect([latin.encoding, latin.separator, latin.rows[0].cells]).toEqual([
      'windows-1252',
      ';',
      ['João', 'Ação Ltda'],
    ]);
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('Nome\tE-mail\r\nÉrica\terica@example.test\r\n', 'utf16le'),
    ]);
    const unicode = readContactSheet(utf16, 'unicode.csv').sheet!;
    expect([unicode.encoding, unicode.separator, unicode.rows[0].cells]).toEqual([
      'utf-16le',
      '\t',
      ['Érica', 'erica@example.test'],
    ]);
  });
});

describe('leitores de valor', () => {
  it.each([
    ['sim', true],
    ['S', true],
    ['x', true],
    ['1', true],
    ['Verdadeiro', true],
    ['TRUE', true],
    ['yes', true],
    ['', false],
    ['Não', false],
    ['n', false],
    ['0', false],
    ['falso', false],
    ['false', false],
    ['talvez', null],
  ])('Não contatar: %s → %s', (value, expected) => {
    expect(parseYesNo(value)).toBe(expected);
  });

  it.each([
    ['', 'not_informed'],
    ['Não informada', 'not_informed'],
    ['nao informada', 'not_informed'],
    ['consent', 'consent'],
    ['Consentimento', 'consent'],
    ['Contrato ou pedido da pessoa', 'contract'],
    ['contrato', 'contract'],
    ['pedido da pessoa', 'contract'],
    ['LEGÍTIMO INTERESSE', 'legitimate_interest'],
    ['legitimo interesse', 'legitimate_interest'],
    ['legitimate_interest', 'legitimate_interest'],
    ['Obrigação legal', 'legal_obligation'],
    ['Exercício de direitos', 'exercise_of_rights'],
    ['exercicio regular de direitos', 'exercise_of_rights'],
    ['marketing', null],
  ])('base legal: %s → %s', (value, expected) => {
    expect(parseLegalBasisCell(value)).toBe(expected);
  });

  it.each([
    ['', 'lead'],
    ['Lead', 'lead'],
    ['prospect', 'prospect'],
    ['Em prospecção', 'prospect'],
    ['prospecção', 'prospect'],
    ['Cliente', 'customer'],
    ['customer', 'customer'],
    ['Encerrado', 'churned'],
    ['ex-cliente', 'churned'],
    ['churned', 'churned'],
    ['VIP', null],
  ])('relacionamento: %s → %s', (value, expected) => {
    expect(parseContactStatus(value)).toBe(expected);
  });

  it('reconhece a notação científica do Excel', () => {
    expect(isScientificNotation('5,51E+12')).toBe(true);
    expect(isScientificNotation('5.51e12')).toBe(true);
    expect(isScientificNotation('5511999990000')).toBe(false);
    expect(isScientificNotation('+55 11 99999-0000')).toBe(false);
  });

  it('a chave da empresa ignora acento, caixa e pontuação', () => {
    expect(companyKey('Acme Ltda.')).toBe(companyKey('ACME LTDA'));
    expect(companyKey('acme-ltda')).toBe('acme ltda');
    expect(companyKey('Ação')).toBe('acao');
    expect(companyKey('Acme')).not.toBe(companyKey('Acme Ltda'));
  });

  // Revisão do item 1.11: "株式会社", "🍕" e "-" viravam a chave vazia, e casavam entre si ou sumiam sem aviso.
  it('um nome sem letras latinas nem dígitos tem a própria chave, nunca a vazia', () => {
    expect(textKey('株式会社')).toBe('株式会社');
    expect(textKey(' 🍕 ')).toBe('🍕');
    expect(textKey('-')).toBe('-');
    expect(textKey('王芳')).not.toBe(textKey('李明'));
    expect(textKey('')).toBe('');
    expect(companyKey('ACME LTDA')).toBe(textKey('Acme Ltda.'));
  });
});

describe('matchMember', () => {
  const ana = [
    { id: 'a1', name: 'Ana Lima', email: 'ana.lima@example.test', active: true },
    { id: 'a2', name: 'Ana Souza', email: 'ana.souza@example.test', active: true },
  ];
  it('casa pelo e-mail e pelo nome exato, sem acento nem maiúscula', () => {
    expect(matchMember('carla@example.test', MEMBERS)).toEqual({ id: 'carla', error: null });
    expect(matchMember('CARLA@EXAMPLE.TEST', MEMBERS)).toEqual({ id: 'carla', error: null });
    expect(matchMember('bruna  recebedora', MEMBERS)).toEqual({ id: 'bruna', error: null });
    expect(matchMember('Pessoa de Teste', MEMBERS)).toEqual({ id: 'me', error: null });
  });
  it('aceita qualquer papel ativo, também somente leitura', () => {
    expect(matchMember('Leitor de Teste', MEMBERS)).toEqual({ id: 'leitor', error: null });
  });
  it('recusa a pessoa desativada, pelo nome e pelo e-mail', () => {
    // Sem gênero (revisão do item 1.11): a frase concorda com "pessoa", e não com o nome digitado.
    expect(matchMember('Fulano Vendedor', MEMBERS)).toEqual({
      id: null,
      error: 'A pessoa “Fulano Vendedor” está desativada na equipe e não recebe contatos. Escolha uma pessoa ativa.',
    });
    expect(matchMember('fulano@example.test', MEMBERS).error).toBe(
      'A pessoa “fulano@example.test” está desativada na equipe e não recebe contatos. Escolha uma pessoa ativa.',
    );
  });
  it('"-" ou um nome em outra escrita não casam com uma pessoa cujo nome não tem letras latinas', () => {
    const team = [
      { id: 'li', name: '李明', email: 'li@example.test', active: true },
      { id: 'ana', name: 'Ana Lima', email: 'ana@example.test', active: true },
    ];
    expect(matchMember('-', team)).toEqual({ id: null, error: IMPORT_MESSAGES.ownerUnknown('-') });
    expect(matchMember('王芳', team)).toEqual({ id: null, error: IMPORT_MESSAGES.ownerUnknown('王芳') });
    expect(matchMember('李明', team)).toEqual({ id: 'li', error: null });
    expect(matchMember('li@example.test', team)).toEqual({ id: 'li', error: null });
  });
  it('recusa o nome repetido na equipe e a correspondência parcial', () => {
    expect(
      matchMember('Ana Lima', [...ana, { id: 'a3', name: 'Ana Lima', email: 'outra@example.test', active: true }]),
    ).toEqual({
      id: null,
      error: 'Há mais de uma pessoa com o nome “Ana Lima” na equipe: use o e-mail dela.',
    });
    expect(matchMember('ana', ana)).toEqual({
      id: null,
      error: 'Responsável “ana” não encontrado: use o nome ou o e-mail de uma pessoa ativa, como aparece em “Equipe”.',
    });
  });
  it('com um nome repetido entre uma ativa e uma desativada, fica a ativa', () => {
    expect(
      matchMember('Ana Lima', [ana[0], { id: 'a4', name: 'Ana Lima', email: 'antiga@example.test', active: false }]),
    ).toEqual({ id: 'a1', error: null });
  });
});

describe('validação das linhas', () => {
  it('aplica cada regra com a mensagem dela e junta todos os motivos da linha', () => {
    const long = (size: number) => 'a'.repeat(size);
    const text = [
      'nome;sobrenome;email;telefone;empresa;cargo;origem;responsavel;relacionamento;observacoes;nao_contatar;base_legal;registro_base_legal',
      `;${long(151)};ana@;5,51E+12;${long(201)};${long(151)};${long(101)};Ninguém;VIP;${long(2001)};talvez;marketing;${long(501)}`,
      `${long(161)};;;${'1'.repeat(41)};;;;fulano@example.test;;;;consentimento;`,
      'Bia;;bia@example.test;;;;;;;;;;',
    ].join('\n');
    const { plan: result } = plan(text);
    expect(result.rows[0].reasons).toEqual([
      IMPORT_MESSAGES.missingName,
      IMPORT_MESSAGES.lastNameTooLong,
      IMPORT_MESSAGES.invalidEmail,
      'O Excel trocou o telefone por notação científica (5,51E+12). Formate a coluna como Texto, digite o número de novo e salve.',
      IMPORT_MESSAGES.companyTooLong,
      IMPORT_MESSAGES.jobTitleTooLong,
      IMPORT_MESSAGES.sourceTooLong,
      IMPORT_MESSAGES.ownerUnknown('Ninguém'),
      'Relacionamento “VIP” não reconhecido: use Lead, Em prospecção, Cliente ou Encerrado.',
      'As observações passam de 2.000 caracteres.',
      IMPORT_MESSAGES.doNotContact,
      IMPORT_MESSAGES.legalBasis('marketing'),
      IMPORT_MESSAGES.legalBasisNoteTooLong,
    ]);
    expect(result.rows[1].reasons).toEqual([
      'O nome passa de 160 caracteres.',
      IMPORT_MESSAGES.phoneTooLong,
      IMPORT_MESSAGES.ownerDeactivated('fulano@example.test'),
      IMPORT_MESSAGES.consentNote,
    ]);
    expect(result.rows.map((row) => row.status)).toEqual(['error', 'error', 'ready']);
    expect(IMPORT_MESSAGES.consentNote).toBe(
      'Consentimento precisa do registro de como a pessoa consentiu: preencha a coluna “Registro da base legal”.',
    );
  });

  it('o número da linha é o do Excel, com linhas em branco e uma célula de três linhas antes', () => {
    const text =
      'nome;observacoes\r\nAna;"primeira\r\nsegunda\r\nterceira"\r\n\r\n;sem nome\r\n\r\n\r\nBia;\r\n;de novo';
    const { plan: result } = plan(text);
    expect(reasonsOf(result)).toEqual([
      '2 ready',
      `4 error: ${IMPORT_MESSAGES.missingName}`,
      '7 ready',
      `8 error: ${IMPORT_MESSAGES.missingName}`,
    ]);
    expect(result.rows[0].payload?.notes).toBe('primeira\nsegunda\nterceira');
  });

  it('recusa a linha com mais células preenchidas que o cabeçalho', () => {
    const { plan: result } = plan('nome;email\nAna;ana@example.test;Rua 1; casa 2');
    expect(result.rows[0].reasons).toEqual([IMPORT_MESSAGES.extraCells]);
  });

  it('reduz os espaços internos (também o não separável) e mantém as quebras das observações', () => {
    const { plan: result } = plan(
      'nome;sobrenome;empresa;observacoes\n  Ana\u00a0 Maria  ; Souza ; Acme  Ltda ;"linha 1\nlinha 2"',
    );
    expect(result.ready[0].payload).toMatchObject({
      first_name: 'Ana Maria',
      last_name: 'Souza',
      notes: 'linha 1\nlinha 2',
    });
    expect(result.companies[0].name).toBe('Acme Ltda');
  });

  it('"Nome completo" vai inteiro para o nome', () => {
    const { plan: result } = plan('Nome completo;E-mail\nAna Maria Souza;ANA@Example.test ');
    expect(result.ready[0].payload).toMatchObject({
      first_name: 'Ana Maria Souza',
      last_name: null,
      email: 'ana@example.test',
    });
  });
});

describe('repetidas', () => {
  const existing = [
    { id: 'c1', email: 'Ana@Example.test ', phone: null },
    { id: 'c2', email: null, phone: '(11) 98888-0001' },
    { id: 'c3', email: null, phone: '11988880002' },
    { id: 'c4', email: null, phone: '+55 11 3000-0000' },
    { id: 'c5', email: null, phone: 'ramal 22' },
    // O anonimizado não tem e-mail nem telefone e nunca casa.
    { id: 'c6', email: null, phone: null },
  ];
  const text = [
    'nome;email;telefone',
    'Ana;ana@example.test;',
    'Bia;;+5511988880001',
    'Caio;;11 98888-0002',
    'Davi;;(11) 3000-0000',
    'Eva;eva@example.test;ramal 22',
    'Fábio;FABIO@example.test;11977770001',
    'Gil;fabio@example.test;',
    'Hugo;;(11) 97777-0001',
    'Ivo;ivo@;+5511988880001',
    'Jair;;ramal 22',
  ].join('\n');

  it('casa o e-mail com outra caixa ou espaços e o telefone normalizado, também contra os formatos antigos', () => {
    const { plan: result } = plan(text, { existingContacts: existing });
    expect(reasonsOf(result)).toEqual([
      `2 duplicate: ${IMPORT_MESSAGES.existingEmail}`,
      `3 duplicate: ${IMPORT_MESSAGES.existingPhone}`,
      `4 duplicate: ${IMPORT_MESSAGES.existingPhone}`,
      `5 duplicate: ${IMPORT_MESSAGES.existingPhone}`,
      // Telefone não reconhecido nunca é chave.
      '6 ready',
      '7 ready',
      '8 duplicate: Repetida na planilha: o mesmo e-mail está na linha 7.',
      '9 duplicate: Repetida na planilha: o mesmo telefone está na linha 7.',
      // A repetida tem precedência sobre o erro.
      `10 duplicate: ${IMPORT_MESSAGES.existingPhone}`,
      '11 ready',
    ]);
    expect(result.phoneDuplicateCount).toBe(5);
  });

  it('com "Importar também as linhas com telefone repetido", as repetidas só pelo telefone entram e as pelo e-mail não', () => {
    const { plan: result } = plan(text, { existingContacts: existing }, { includePhoneDuplicates: true });
    expect(reasonsOf(result)).toEqual([
      `2 duplicate: ${IMPORT_MESSAGES.existingEmail}`,
      '3 ready',
      '4 ready',
      '5 ready',
      '6 ready',
      '7 ready',
      '8 duplicate: Repetida na planilha: o mesmo e-mail está na linha 7.',
      '9 ready',
      `10 error: ${IMPORT_MESSAGES.invalidEmail}`,
      '11 ready',
    ]);
    expect(result.phoneDuplicateCount).toBe(5);
    expect(result.importedPhoneDuplicates).toBe(4);
  });

  // Revisão do item 1.11: a importação não muda o contato cadastrado, e o pedido de oposição da repetida não some.
  it('a repetida que pede "Não contatar" sem a marca no contato que fica no CRM ganha o motivo e conta no aviso', () => {
    const marked = [
      { id: 'c1', email: 'ana@example.test', phone: null, do_not_contact: false },
      { id: 'c2', email: 'bia@example.test', phone: null, do_not_contact: true },
      { id: 'c3', email: null, phone: '11988880001', do_not_contact: false },
    ];
    const rows = [
      'nome;email;telefone;nao_contatar',
      'Ana;ana@example.test;;sim',
      'Bia;bia@example.test;;sim',
      'Caio;;(11) 98888-0001;sim',
      'Davi;davi@example.test;;',
      'Davi de novo;davi@example.test;;sim',
      'Eva;eva@example.test;;sim',
      'Eva de novo;eva@example.test;;sim',
      'Fábio;ana@example.test;;',
    ].join('\n');
    const { plan: result } = plan(rows, { existingContacts: marked });
    const asks = IMPORT_MESSAGES.duplicateDoNotContact;
    expect(reasonsOf(result)).toEqual([
      `2 duplicate: ${IMPORT_MESSAGES.existingEmail}; ${asks}`,
      `3 duplicate: ${IMPORT_MESSAGES.existingEmail}`,
      `4 duplicate: ${IMPORT_MESSAGES.existingPhone}; ${asks}`,
      '5 ready',
      `6 duplicate: Repetida na planilha: o mesmo e-mail está na linha 5.; ${asks}`,
      '7 ready',
      '8 duplicate: Repetida na planilha: o mesmo e-mail está na linha 7.',
      `9 duplicate: ${IMPORT_MESSAGES.existingEmail}`,
    ]);
    expect(result.duplicateDoNotContact).toBe(3);
    expect(contactImportIssues(result)[0].reason).toBe(`${IMPORT_MESSAGES.existingEmail} ${asks}`);
    // Sem a marca na leitura (banco sem a migração do 1.9), só o caso de dentro da planilha.
    const unknown = plan(rows, {
      existingContacts: marked.map((contact) => ({ id: contact.id, email: contact.email, phone: contact.phone })),
    }).plan;
    expect(unknown.duplicateDoNotContact).toBe(1);
    // Com o telefone de dois contatos, a marca vale só quando os dois a têm.
    const shared = plan('nome;telefone;nao_contatar\nGil;11977770001;sim', {
      existingContacts: [
        { id: 'p1', email: null, phone: '11977770001', do_not_contact: true },
        { id: 'p2', email: null, phone: '+5511977770001', do_not_contact: false },
      ],
    }).plan;
    expect(shared.duplicateDoNotContact).toBe(1);
  });

  it('uma linha que entra pela opção passa a valer como chave do e-mail para as seguintes', () => {
    const rows =
      'nome;email;telefone\nAna;ana@example.test;11999990001\nBia;bia@example.test;11999990001\nCaio;bia@example.test;';
    expect(reasonsOf(plan(rows).plan)).toEqual([
      '2 ready',
      '3 duplicate: Repetida na planilha: o mesmo telefone está na linha 2.',
      '4 ready',
    ]);
    expect(reasonsOf(plan(rows, {}, { includePhoneDuplicates: true }).plan)).toEqual([
      '2 ready',
      '3 ready',
      '4 duplicate: Repetida na planilha: o mesmo e-mail está na linha 3.',
    ]);
  });
});

describe('responsável e divisão', () => {
  it('a coluna leva o responsável; as linhas sem ela seguem a escolha', () => {
    const text = 'nome;responsavel\nAna;Bruna Recebedora\nBia;\nCaio;carla@example.test';
    expect(plan(text).plan.ready.map((row) => row.ownerId)).toEqual(['bruna', 'me', 'carla']);
    expect(plan(text, {}, { ownerMode: 'other', otherOwnerId: 'carla' }).plan.ready.map((row) => row.ownerId)).toEqual([
      'bruna',
      'carla',
      'carla',
    ]);
  });

  // Revisão do item 1.11: sem linha pronta, "Importar" fica desabilitado com o motivo.
  it('sem nenhuma linha pronta, só repetidas ou só com erro, a importação fica bloqueada com o motivo', () => {
    const onlyDuplicates = plan('nome;email\nAna;ana@example.test', {
      existingContacts: [{ id: 'c1', email: 'ana@example.test', phone: null }],
    }).plan;
    expect([onlyDuplicates.ready.length, onlyDuplicates.blocked]).toEqual([0, IMPORT_MESSAGES.noReadyRows]);
    const onlyErrors = plan('nome;email\n;sem-nome@example.test\nBia;bia@').plan;
    expect([onlyErrors.ready.length, onlyErrors.blocked]).toEqual([0, 'Nenhuma linha está pronta para importar.']);
  });

  it('"Outra pessoa" sem ninguém (ou com uma pessoa desativada) e a divisão sem ninguém marcado bloqueiam', () => {
    const text = 'nome\nAna';
    expect(plan(text, {}, { ownerMode: 'other', otherOwnerId: null }).plan.blocked).toBe(IMPORT_MESSAGES.chooseOwner);
    expect(plan(text, {}, { ownerMode: 'other', otherOwnerId: 'fulano' }).plan.blocked).toBe(
      IMPORT_MESSAGES.chooseOwner,
    );
    expect(plan(text, {}, { ownerMode: 'distribute', distributeIds: [] }).plan.blocked).toBe(
      'Marque ao menos uma pessoa para distribuir.',
    );
    expect(plan(text, {}, { ownerMode: 'distribute', distributeIds: ['fulano'] }).plan.blocked).toBe(
      IMPORT_MESSAGES.chooseDistribution,
    );
    expect(plan('nome;responsavel\nAna;Bruna Recebedora', {}, { ownerMode: 'distribute' }).plan).toMatchObject({
      blocked: null,
      needsOwnerChoice: false,
    });
  });

  it('a divisão segue a ordem da planilha e a ordem alfabética da lista, só com pessoas ativas', () => {
    expect(distributionMembers(MEMBERS, ['carla', 'fulano', 'bruna'])).toEqual(['bruna', 'carla']);
    const text = ['nome;responsavel', 'A;', 'B;', 'C;Pessoa de Teste', 'D;', 'E;', 'F;'].join('\n');
    const { plan: result } = plan(text, {}, { ownerMode: 'distribute', distributeIds: ['carla', 'bruna'] });
    expect(result.ready.map((row) => row.ownerId)).toEqual(['bruna', 'carla', 'me', 'bruna', 'carla', 'bruna']);
    expect(result.distribution).toEqual([
      { id: 'bruna', count: 3 },
      { id: 'carla', count: 2 },
    ]);
  });

  it.each([1, 2, 3, 7])(
    'cada uma de %i pessoas fica com a mesma quantidade, com diferença de no máximo 1',
    (people) => {
      const members = Array.from({ length: people }, (_, i) => ({
        id: `p${i}`,
        name: `Pessoa ${String(i).padStart(2, '0')}`,
        email: `p${i}@example.test`,
        active: true,
      }));
      for (const rows of [0, 1, 10, 4881]) {
        const text =
          ['nome', ...Array.from({ length: rows }, (_, i) => `Contato ${i}`)].join('\n') + (rows ? '' : '\nX');
        const { plan: result } = plan(
          text,
          { members },
          {
            ownerMode: 'distribute',
            distributeIds: members.map((member) => member.id),
          },
        );
        const counts = result.distribution.map((item) => item.count);
        const total = rows || 1;
        expect(counts.reduce((sum, value) => sum + value, 0)).toBe(total);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      }
    },
  );

  it('a divisão é recalculada com a opção do telefone, e as linhas com a coluna ficam fora da conta', () => {
    const text = 'nome;telefone;responsavel\nA;11999990001;\nB;11999990001;\nC;;Carla Administradora\nD;;';
    const options = { ownerMode: 'distribute', distributeIds: ['bruna', 'carla'] } as const;
    expect(plan(text, {}, options).plan.distribution).toEqual([
      { id: 'bruna', count: 1 },
      { id: 'carla', count: 1 },
    ]);
    expect(plan(text, {}, { ...options, includePhoneDuplicates: true }).plan.distribution).toEqual([
      { id: 'bruna', count: 2 },
      { id: 'carla', count: 1 },
    ]);
  });
});

describe('empresas', () => {
  it('uma empresa com nome em outra escrita ou só com símbolo é ligada pelo próprio nome, e não fica sem vínculo', () => {
    const text = ['nome;empresa', 'Bia;株式会社', 'Caio;🍕', 'Davi;株式会社', 'Eva;Kyoto'].join('\n');
    const { plan: result, analysis } = plan(text, {
      companies: [{ id: 'kyoto', name: 'KYOTO', created_at: '2026-01-01T00:00:00Z' }],
    });
    expect(result.companies.map((company) => company.name)).toEqual(['株式会社', '🍕']);
    expect(result.ready.map((row) => row.companyId)).toEqual([
      analysis.newCompanyIds.get('株式会社'),
      analysis.newCompanyIds.get('🍕'),
      analysis.newCompanyIds.get('株式会社'),
      'kyoto',
    ]);
    // A empresa cadastrada com nome em outra escrita também casa.
    const again = plan('nome;empresa\nFábio;株式会社', {
      companies: [{ id: 'kk', name: '株式会社', created_at: '2026-01-01T00:00:00Z' }],
    }).plan;
    expect([again.ready[0].companyId, again.companies]).toEqual(['kk', []]);
  });

  const companies = [
    { id: 'acme-new', name: 'ACME', created_at: '2026-10-02T10:00:00Z' },
    { id: 'acme-old', name: 'Acme', created_at: '2026-01-02T10:00:00Z' },
    { id: 'beta', name: 'Beta Serviços Ltda.', created_at: '2026-01-02T10:00:00Z' },
  ];
  it('liga pelo nome normalizado, à mais antiga, e cria a nova uma vez, com o nome da primeira linha pronta e o responsável do primeiro contato', () => {
    const text = [
      'nome;email;empresa;responsavel',
      'A;a@example.test;acme;',
      'B;b@example.test;BETA SERVIÇOS LTDA;',
      'C;c@example.test;Gama;Carla Administradora',
      'D;d@example.test;gama;',
      'E;e@example.test;Delta;',
      'F;;Épsilon;Ninguém',
      'G;a@example.test;Zeta;',
    ].join('\n');
    const { plan: result, analysis } = plan(text, { companies });
    expect(result.ready.map((row) => row.companyId)).toEqual([
      'acme-old',
      'beta',
      analysis.newCompanyIds.get('gama'),
      analysis.newCompanyIds.get('gama'),
      analysis.newCompanyIds.get('delta'),
    ]);
    // Só nasce empresa para linhas prontas: "Épsilon" (com erro) e "Zeta" (repetida) ficam fora.
    expect(result.companies).toEqual([
      { id: analysis.newCompanyIds.get('gama'), org_id: ORG, name: 'Gama', owner_id: 'carla' },
      { id: analysis.newCompanyIds.get('delta'), org_id: ORG, name: 'Delta', owner_id: 'me' },
    ]);
  });
});

describe('pedido', () => {
  const header = 'nome;email;telefone;origem;nao_contatar;base_legal;registro_base_legal';
  const text = [
    header,
    'Ana;ana@example.test;(11) 99999-0000;Feira;sim;Consentimento;Formulário do site em 01/10/2026',
    'Bia;;ramal 22;;;;',
    'Caio;;+1 415 555 0100;;;legitimo interesse;',
  ].join('\n');

  it('todas as linhas com as mesmas chaves, telefone em E.164, status lead, origem padrão só nas vazias e nenhum carimbo', () => {
    const { plan: result } = plan(text, {}, { defaultSource: '  Lista da feira ' });
    const payloads = result.ready.map((row) => row.payload!);
    const keys = Object.keys(payloads[0]).sort();
    for (const payload of payloads) expect(Object.keys(payload).sort()).toEqual(keys);
    expect(keys).toEqual(
      [
        'id',
        'org_id',
        'first_name',
        'last_name',
        'email',
        'phone',
        'company_id',
        'owner_id',
        'status',
        'job_title',
        'source',
        'notes',
        'do_not_contact',
        'do_not_contact_reason',
        'legal_basis',
        'legal_basis_note',
      ].sort(),
    );
    expect(payloads).toEqual([
      {
        id: 'id-1',
        org_id: ORG,
        first_name: 'Ana',
        last_name: null,
        email: 'ana@example.test',
        phone: '+5511999990000',
        company_id: null,
        owner_id: 'me',
        status: 'lead',
        job_title: null,
        source: 'Feira',
        notes: null,
        do_not_contact: true,
        do_not_contact_reason: IMPORTED_DO_NOT_CONTACT_REASON,
        legal_basis: 'consent',
        legal_basis_note: 'Formulário do site em 01/10/2026',
      },
      expect.objectContaining({
        phone: 'ramal 22',
        source: 'Lista da feira',
        do_not_contact: false,
        do_not_contact_reason: null,
        legal_basis: 'not_informed',
        legal_basis_note: null,
      }),
      expect.objectContaining({ phone: '+1 415 555 0100', legal_basis: 'legitimate_interest' }),
    ]);
    expect(JSON.stringify(payloads)).not.toMatch(/legal_basis_at|legal_basis_by|do_not_contact_at|do_not_contact_by/);
    expect(result).toMatchObject({ unrecognizedPhones: 1, doNotContact: 1, consents: 1 });
  });

  it('sem as colunas da privacidade no banco, as chaves também são iguais em todas as linhas e a marca vira erro', () => {
    const { plan: result, analysis } = plan(text, { columns: { doNotContact: false, legalBasis: false } });
    expect(analysis.privacyColumnsIgnored).toBe(true);
    expect(result.rows[0].reasons).toEqual([IMPORT_MESSAGES.doNotContactMigration]);
    const payloads = result.ready.map((row) => row.payload!);
    expect(payloads).toHaveLength(2);
    for (const payload of payloads)
      expect(Object.keys(payload).sort()).toEqual(
        [
          'id',
          'org_id',
          'first_name',
          'last_name',
          'email',
          'phone',
          'company_id',
          'owner_id',
          'status',
          'job_title',
          'source',
          'notes',
        ].sort(),
      );
  });

  it('o relacionamento da planilha vai no status', () => {
    const { plan: result } = plan('nome;situação\nAna;Cliente\nBia;Em prospecção\nCaio;');
    expect(result.ready.map((row) => row.payload?.status)).toEqual(['customer', 'prospect', 'lead']);
  });

  it('o id de cada linha é gerado na análise e mantido numa nova análise', () => {
    const sheet = sheetOf('nome;empresa\nAna;Nova\nBia;Nova');
    const first = analyzeContactImport(sheet, contextOf(), { newId });
    const again = analyzeContactImport(sheet, contextOf(), {
      newId: () => 'outro',
      rowIds: new Map(first.rows.map((row) => [row.index, row.id])),
      companyIds: first.newCompanyIds,
      onlyRows: new Set([1]),
    });
    expect(again.rows.map((row) => [row.index, row.id])).toEqual([[1, first.rows[1].id]]);
    expect(again.newCompanyIds.get('nova')).toBe(first.newCompanyIds.get('nova'));
  });
});

describe('lotes', () => {
  it('lotes de até 500, primeiro as empresas', () => {
    const text = ['nome;empresa', ...Array.from({ length: 1203 }, (_, i) => `Pessoa ${i};Empresa ${i % 600}`)].join(
      '\n',
    );
    const { plan: result } = plan(text);
    const batches = contactImportBatches(result);
    expect(batches.contacts.map((batch) => batch.length)).toEqual([500, 500, 203]);
    expect(batches.companies.map((batch) => batch.length)).toEqual([500, 100]);
    expect(CONTACT_IMPORT_BATCH_SIZE).toBe(500);
    expect(batches.contacts.flat().map((payload) => payload.id)).toEqual(result.ready.map((row) => row.row.id));
  });
});

describe('planilha de contatos não importados', () => {
  it('traz a linha, o resultado e o motivo seguidos das colunas originais, com os valores originais', () => {
    const text = [
      'Nome completo;E-mail;Cidade',
      'Ana;ana@example.test;=Recife',
      ';sem-nome@example.test;Olinda',
      'Caio;ana@example.test;Natal',
      'Davi;davi@example.test;Salvador',
    ].join('\r\n');
    const { plan: result, analysis } = plan(text);
    const written = new Set([result.ready[0].row.id]);
    const issues = contactImportIssues(result, written);
    expect(issues.map((issue) => [issue.line, issue.result, issue.reason])).toEqual([
      [3, 'Com erro', IMPORT_MESSAGES.missingName],
      [4, 'Repetida', 'Repetida na planilha: o mesmo e-mail está na linha 2.'],
      [5, 'Não gravada', IMPORT_MESSAGES.notWritten],
    ]);
    const csv = contactImportIssuesCsv(analysis.sheet, issues);
    expect(
      csv.startsWith(
        '\ufeff"linha_planilha";"resultado_importacao";"motivo_importacao";"Nome completo";"E-mail";"Cidade"\r\n',
      ),
    ).toBe(true);
    expect(csv).toContain(
      '"3";"Com erro";"Falta o nome: preencha a coluna do nome.";"";"sem-nome@example.test";"Olinda"',
    );
    const late = contactImportIssues(
      result,
      written,
      new Map([[result.ready[1].row.id, IMPORT_MESSAGES.existingEmail]]),
    );
    expect(late.at(-1)).toMatchObject({ line: 5, result: 'Repetida', reason: IMPORT_MESSAGES.existingEmail });
  });

  // Revisão do item 1.11: cada motivo termina com ponto, e a junção com "; " deixava ".; ".
  it('junta os motivos da linha com espaço, sem ".; "', () => {
    const { plan: result } = plan('nome;email;responsavel\n;ana@;Ninguém');
    const [issue] = contactImportIssues(result);
    expect(issue.reason).toBe(
      [IMPORT_MESSAGES.missingName, IMPORT_MESSAGES.invalidEmail, IMPORT_MESSAGES.ownerUnknown('Ninguém')].join(' '),
    );
    expect(issue.reason).not.toContain('.;');
    expect(joinReasons(['Um.', 'Dois.'])).toBe('Um. Dois.');
  });

  it('neutraliza fórmulas e, importada de novo, ignora as três colunas e só as corrigidas entram', () => {
    const text = 'nome;email;cidade\n=Ana;ana@example.test;Recife\n;bia@example.test;Olinda';
    const { plan: result, analysis } = plan(text, {
      existingContacts: [{ id: 'c1', email: 'ana@example.test', phone: null }],
    });
    const csv = contactImportIssuesCsv(analysis.sheet, contactImportIssues(result));
    expect(csv).toContain(`"'=Ana"`);
    const parsed = parseCsv(csv);
    expect(parsed.rows.map((row) => row.slice(3))).toEqual([
      ['=Ana', 'ana@example.test', 'Recife'],
      ['', 'bia@example.test', 'Olinda'],
    ]);
    const fixed = csv.replace('"";"bia@example.test"', '"Bia";"bia@example.test"');
    const again = readContactSheet(encode(fixed), 'contatos-nao-importados.csv').sheet!;
    expect(again.ignored).toEqual(['cidade']);
    const replan = planContactImport(
      analyzeContactImport(
        again,
        contextOf({ existingContacts: [{ id: 'c1', email: 'ana@example.test', phone: null }] }),
      ),
      ME,
    );
    expect(replan.rows.map((row) => row.status)).toEqual(['duplicate', 'ready']);
    // A planilha gerada de novo não repete as três colunas.
    expect(contactImportIssuesCsv(again, contactImportIssues(replan)).split('\r\n')[0]).toBe(
      '\ufeff"linha_planilha";"resultado_importacao";"motivo_importacao";"nome";"email";"cidade"',
    );
  });
});

describe('análise em pedaços', () => {
  it('dá o mesmo resultado da síncrona e cede a vez a cada 500 linhas', async () => {
    const text = ['nome;email', ...Array.from({ length: 1234 }, (_, i) => `P${i};p${i % 1000}@example.test`)].join(
      '\n',
    );
    const sheet = sheetOf(text);
    let ids = 0;
    const sync = analyzeContactImport(sheet, contextOf(), { newId: () => `x${++ids}` });
    ids = 0;
    let pauses = 0;
    const chunked = await analyzeContactImportInChunks(sheet, contextOf(), { newId: () => `x${++ids}` }, async () => {
      pauses++;
    });
    expect(chunked).toEqual(sync);
    expect(pauses).toBe(2);
  });
});
