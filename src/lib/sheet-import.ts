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
import { IMPORT_RESULT_HEADERS, normalizeHeader, UNNAMED_COLUMN } from '@/lib/contact-import-headers';

/**
 * O leitor comum das planilhas importadas (item 1.16, generalizado do leitor de contatos do 1.11; docs/arquitetura/1.16.md,
 * seção 8.1): tamanho, planilha binária recusada com o passo a passo, codificação, separador, 5.000 linhas com dados,
 * caracteres de controle fora, número da linha do Excel e células além do cabeçalho. Cada importação passa o próprio
 * mapeamento de cabeçalhos e as frases que citam o que ela importa ("O arquivo não contém contatos."). Também ficam aqui
 * os lotes da gravação e a planilha das linhas não importadas, com as mesmas colunas `linha_planilha`,
 * `resultado_importacao` e `motivo_importacao` em todas as importações.
 */

/** Linhas com dados por arquivo. */
export const MAX_SHEET_ROWS = 5000;
/** Registros por pedido de gravação. */
export const SHEET_IMPORT_BATCH_SIZE = 500;

const count = (value: number) => value.toLocaleString('pt-BR');

/** O separador de colunas pelo nome, como na frase da linha com colunas a mais. */
const SEPARATOR_NAMES: Record<CsvSeparator, string> = { ';': 'um ponto e vírgula', ',': 'uma vírgula', '\t': 'um TAB' };

/** As frases do leitor que valem para qualquer importação. */
export const SHEET_MESSAGES = {
  tooLarge: 'O arquivo deve ter até 5 MB. Divida a planilha em partes menores.',
  spreadsheet:
    'Este arquivo é uma planilha do Excel ou de outro programa (.xlsx, .xls ou .ods), e o CRM lê só CSV. No Excel, use Arquivo > Salvar como (no Microsoft 365 com o salvamento automático ligado, Arquivo > Salvar uma Cópia) e escolha “CSV UTF-8 (delimitado por vírgulas)”. No Google Planilhas, use Arquivo > Fazer download > Valores separados por vírgula (.csv).',
  tooManyRows: (rows: number) =>
    `A planilha tem ${count(rows)} linhas com dados. Importe até ${count(MAX_SHEET_ROWS)} por vez: divida o arquivo em partes.`,
  /** O separador que a leitura detectou (revisão do item 1.11, achado 16: o CSV do Google Planilhas usa vírgula). */
  extraCells: (separator: CsvSeparator) =>
    `A linha tem mais colunas que o cabeçalho: talvez ${SEPARATOR_NAMES[separator]} dentro de um texto sem aspas.`,
} as const;

/** Uma linha de dados da planilha: o número no Excel e as células como estão no arquivo (completadas até o cabeçalho). */
export interface SheetRow {
  line: number;
  cells: string[];
  /** A linha tem células preenchidas além do cabeçalho. */
  extraCells: boolean;
}

/** O mapeamento dos cabeçalhos de uma importação para os campos dela. */
export interface SheetHeaderMap<F extends string> {
  /** Índice da coluna de cada campo reconhecido. */
  mapping: Partial<Record<F, number>>;
  /** Colunas reconhecidas, na ordem do arquivo: o cabeçalho como está e o campo do CRM. */
  recognized: { header: string; field: F; label: string }[];
  /** Colunas desconhecidas, como estão no arquivo ("(sem nome)" para o cabeçalho vazio). */
  ignored: string[];
  /** Motivo da recusa do arquivo, ou nulo. */
  error: string | null;
}

export interface Sheet<F extends string> {
  fileName: string;
  encoding: CsvEncoding;
  separator: CsvSeparator;
  headers: string[];
  mapping: Partial<Record<F, number>>;
  recognized: SheetHeaderMap<F>['recognized'];
  ignored: string[];
  rows: SheetRow[];
}

export type SheetResult<F extends string> = { sheet: Sheet<F>; error: null } | { sheet: null; error: string };

/**
 * Caracteres de controle invisíveis (o NUL, por exemplo), fora o TAB e as quebras de linha das observações. Saem na
 * leitura (revisão do item 1.11): o banco recusa o NUL num texto (22P05), e o lote inteiro falharia sem dizer a linha.
 */
const CONTROL_CHARACTERS = /[^\P{Cc}\t\n\r]/gu;
const withoutControlCharacters = (value: string) => value.replace(CONTROL_CHARACTERS, '');

export interface ReadSheetOptions {
  /** O arquivo sem cabeçalho ou sem linhas com dados ("O arquivo não contém contatos."). */
  empty: string;
  /** Mais linhas que o limite; o padrão é `SHEET_MESSAGES.tooManyRows`. */
  tooManyRows?: (rows: number) => string;
}

/**
 * Lê o arquivo escolhido, nesta ordem: tamanho; assinatura de planilha binária; codificação; leitura; arquivo sem
 * cabeçalho ou sem linhas; mais de 5.000 linhas com dados; cabeçalhos (`mapHeaders`). Os caracteres de controle saem
 * das células.
 */
export function readSheet<F extends string>(
  bytes: ArrayBuffer | Uint8Array,
  fileName: string,
  mapHeaders: (headers: readonly string[]) => SheetHeaderMap<F>,
  { empty, tooManyRows = SHEET_MESSAGES.tooManyRows }: ReadSheetOptions,
): SheetResult<F> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.byteLength > MAX_CSV_BYTES) return { sheet: null, error: SHEET_MESSAGES.tooLarge };
  if (spreadsheetFileKind(view)) return { sheet: null, error: SHEET_MESSAGES.spreadsheet };
  const encoding = csvEncoding(view);
  const parsed = parseCsv(decodeCsvBytes(view));
  if (parsed.error) return { sheet: null, error: parsed.error };
  if (!parsed.headers.length || !parsed.rows.length) return { sheet: null, error: empty };
  if (parsed.rows.length > MAX_SHEET_ROWS) return { sheet: null, error: tooManyRows(parsed.rows.length) };
  const headers = parsed.headers.map(withoutControlCharacters);
  const map = mapHeaders(headers);
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

/** Um campo de uma importação: os sinônimos aceitos, já normalizados por `normalizeHeader`. */
export interface SheetFieldDefinition<F extends string> {
  field: F;
  /** Nome da coluna no modelo. */
  column: string;
  /** Como o campo aparece na prévia. */
  label: string;
  synonyms: readonly string[];
}

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase('pt-BR') + text.slice(1);
const RESULT_HEADERS = new Set<string>(IMPORT_RESULT_HEADERS.map((header) => normalizeHeader(header)));

/**
 * Mapeia os cabeçalhos pelos sinônimos de cada campo, com as regras do 1.11: duas colunas para o mesmo campo recusam o
 * arquivo, nomeando as duas; colunas desconhecidas são ignoradas e listadas (as três colunas da planilha de não
 * importados, não); falta de um campo obrigatório recusa com `missingError(campo)`.
 */
export function mapSheetHeaders<F extends string>(
  headers: readonly string[],
  definitions: readonly SheetFieldDefinition<F>[],
  required: readonly F[],
  missingError: (field: F) => string,
): SheetHeaderMap<F> {
  const bySynonym = new Map<string, SheetFieldDefinition<F>>(
    definitions.flatMap((definition) => definition.synonyms.map((synonym) => [synonym, definition] as const)),
  );
  const mapping: Partial<Record<F, number>> = {};
  const recognized: SheetHeaderMap<F>['recognized'] = [];
  const ignored: string[] = [];
  for (const [index, raw] of headers.entries()) {
    const header = raw.trim();
    const key = normalizeHeader(header);
    const definition = bySynonym.get(key);
    if (!definition) {
      if (!RESULT_HEADERS.has(key)) ignored.push(header || UNNAMED_COLUMN);
      continue;
    }
    const previous = mapping[definition.field];
    if (previous !== undefined)
      return {
        mapping: {},
        recognized: [],
        ignored: [],
        error: `As colunas “${headers[previous].trim()}” e “${header}” são o mesmo campo do CRM (${lowerFirst(definition.label)}). Deixe só uma e importe de novo.`,
      };
    mapping[definition.field] = index;
    recognized.push({ header, field: definition.field, label: definition.label });
  }
  const missing = required.find((field) => mapping[field] === undefined);
  if (missing !== undefined) return { mapping: {}, recognized: [], ignored: [], error: missingError(missing) };
  return { mapping, recognized, ignored, error: null };
}

/** A célula de um campo numa linha, ou vazio quando a coluna não veio. */
export function sheetCell<F extends string>(sheet: Pick<Sheet<F>, 'mapping'>, row: SheetRow, field: F): string {
  const column = sheet.mapping[field];
  return column === undefined ? '' : (row.cells[column] ?? '');
}

/** Divide uma lista em lotes de até `size`. */
export function inBatches<T>(items: readonly T[], size = SHEET_IMPORT_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) batches.push(items.slice(start, start + size));
  return batches;
}

export type IssueResult = 'Repetida' | 'Com erro' | 'Não gravada';

/** Os motivos de uma linha numa frase só: cada um já termina com ponto. */
export const joinReasons = (reasons: readonly string[]) => reasons.join(' ');

/** Uma linha que não entrou na importação. */
export interface SheetIssue {
  line: number;
  result: IssueResult;
  reason: string;
  cells: readonly string[];
}

const RESULT_KEYS = new Set<string>(IMPORT_RESULT_HEADERS.map((header) => normalizeHeader(header)));

/**
 * A planilha das linhas não importadas (BOM, ";", CRLF e a neutralização de fórmulas de buildCsv): `linha_planilha`,
 * `resultado_importacao` e `motivo_importacao`, seguidas das colunas originais, na ordem e com os valores do arquivo.
 * As três colunas de uma planilha de não importados escolhida de novo não se repetem.
 */
export function sheetIssuesCsv(sheet: Pick<Sheet<string>, 'headers'>, issues: readonly SheetIssue[]): string {
  const originals = sheet.headers
    .map((header, column) => ({ header, column }))
    .filter(({ header }) => !RESULT_KEYS.has(normalizeHeader(header)));
  const columns: CsvColumn<SheetIssue>[] = [
    { header: IMPORT_RESULT_HEADERS[0], value: (issue) => issue.line },
    { header: IMPORT_RESULT_HEADERS[1], value: (issue) => issue.result },
    { header: IMPORT_RESULT_HEADERS[2], value: (issue) => issue.reason },
    ...originals.map(({ header, column }) => ({
      header,
      value: (issue: SheetIssue) => issue.cells[column] ?? '',
    })),
  ];
  return buildCsv(issues, columns);
}
