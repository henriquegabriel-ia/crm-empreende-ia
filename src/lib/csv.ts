/**
 * Implementação única de CSV do CRM.
 *
 * Exportação: ";" como separador, BOM UTF-8 e quebra de linha CRLF, o que o Excel em português abre com
 * colunas e acentos corretos. Toda célula vai entre aspas, e uma célula que o editor de planilhas poderia
 * executar como fórmula (começando com =, +, -, @, TAB, CR ou LF, mesmo depois de espaços) ganha um
 * apóstrofo na frente.
 *
 * Leitura: separador ";" ou "," detectado pelo cabeçalho, aspas com "" escapado, quebras de linha dentro
 * de aspas, BOM e CRLF. As células voltam sem espaços nas pontas e sem o apóstrofo de neutralização, então
 * exportar e reimportar devolve o mesmo texto, inclusive um telefone "+55 11 99999-0000".
 */

export type CsvSeparator = ';' | ',';

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export interface CsvParseResult {
  separator: CsvSeparator;
  headers: string[];
  rows: string[][];
  /** Motivo da recusa do arquivo inteiro; com erro, `headers` e `rows` vêm vazios. */
  error: string | null;
}

/** Limite de tamanho dos arquivos importados, em bytes. */
export const MAX_CSV_BYTES = 2_000_000;

/**
 * Começo de célula que precisa de neutralização. Os apóstrofos iniciais entram na regra para que um texto
 * que já começa com "'=" ganhe outro apóstrofo e volte igual na leitura.
 */
const NEEDS_NEUTRALIZATION = /^'*(?:[\s\uFEFF]*[=+\-@]|[\t\r\n])/;

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (NEEDS_NEUTRALIZATION.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [
    columns.map((column) => csvCell(column.header)).join(';'),
    ...rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(';')),
  ];
  return '\uFEFF' + lines.join('\r\n');
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv<T>(filename: string, rows: readonly T[], columns: readonly CsvColumn<T>[]) {
  downloadText(filename, buildCsv(rows, columns));
}

/** Tamanho do texto em UTF-8, a mesma medida do arquivo em disco. */
export function csvByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * Lê os bytes de um arquivo CSV. Arquivos salvos pelo Excel em português costumam vir em Windows-1252,
 * e não em UTF-8; nesse caso, a leitura em UTF-8 falharia nos acentos ("Jo�o").
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** ";" quando o cabeçalho tem algum ";" e pelo menos tantos ";" quanto "," fora de aspas; senão ",". */
export function detectCsvSeparator(text: string): CsvSeparator {
  let quoted = false;
  let semicolons = 0;
  let commas = 0;
  for (const char of text.replace(/^\uFEFF/, '')) {
    if (char === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (char === '\n' || char === '\r') break;
    else if (char === ';') semicolons++;
    else if (char === ',') commas++;
  }
  return semicolons > 0 && semicolons >= commas ? ';' : ',';
}

/**
 * Remove os espaços das pontas e o apóstrofo de neutralização. O conteúdo protegido pelo apóstrofo mantém
 * os espaços ou TAB do início, que fazem parte do texto exportado.
 */
function cellValue(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith("'")) return text;
  const neutralized = raw.trimStart();
  return NEEDS_NEUTRALIZATION.test(neutralized) ? neutralized.slice(1).trimEnd() : text;
}

/** Linhas totalmente vazias são ignoradas; as células voltam sem espaços nas pontas. */
export function parseCsv(text: string): CsvParseResult {
  const source = text.replace(/^\uFEFF/, '');
  const separator = detectCsvSeparator(source);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cellValue(cell));
    if (row.some(Boolean)) records.push(row);
    row = [];
    cell = '';
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === separator && !quoted) {
      row.push(cellValue(cell));
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index++;
      endRow();
    } else cell += char;
  }
  endRow();
  if (quoted) return { separator, headers: [], rows: [], error: 'Há aspas não fechadas no CSV.' };
  return { separator, headers: records.shift() ?? [], rows: records, error: null };
}
