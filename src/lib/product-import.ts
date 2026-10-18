import { textKey } from '@/lib/contact-import';
import { MAX_BRL_VALUE, parseBRL } from '@/lib/money';
import { mapProductHeaders, type ProductImportField } from '@/lib/product-import-headers';
import {
  inBatches,
  joinReasons,
  readSheet,
  sheetCell,
  SHEET_MESSAGES,
  sheetIssuesCsv,
  type Sheet,
  type SheetIssue,
  type SheetResult,
} from '@/lib/sheet-import';
import type { CatalogProduct, DealItemBilling } from '@/lib/deal-types';

/**
 * Importação do catálogo por planilha (item 1.16; docs/arquitetura/1.16.md, seção 8.3), sobre o leitor comum do 1.11.
 * Nada aqui acessa o banco: a tela lê o catálogo e passa como contexto, e grava os lotes por `insertProductBatch`
 * (src/components/catalog/data.ts), com o id gerado aqui (uma nova tentativa reenvia os mesmos ids, e nada duplica).
 *
 * As etapas: `readProductSheet` (o arquivo); `analyzeProductImport` (valores, erros e repetidas contra o catálogo e
 * contra as linhas anteriores); `productImportBatches` (lotes de até 500, só as prontas); `productImportIssues` e
 * `productImportIssuesCsv` (a planilha dos itens não importados, que pode ser corrigida e importada de novo).
 * A importação não atualiza nem reativa itens existentes (a atualização por planilha é do item 2B.1).
 */

/** Limites dos campos, os mesmos dos CHECK de products. */
export const PRODUCT_IMPORT_LIMITS = { name: 160, code: 40, unit: 20 } as const;

const count = (value: number) => value.toLocaleString('pt-BR');

export const PRODUCT_IMPORT_MESSAGES = {
  empty: 'O arquivo não contém itens do catálogo.',
  missingName: 'Falta o nome: preencha a coluna do nome.',
  nameTooLong: `O nome passa de ${PRODUCT_IMPORT_LIMITS.name} caracteres.`,
  codeTooLong: `O código passa de ${PRODUCT_IMPORT_LIMITS.code} caracteres.`,
  unitTooLong: `A unidade passa de ${PRODUCT_IMPORT_LIMITS.unit} caracteres.`,
  kind: (value: string) => `Tipo “${value}” não reconhecido: use Produto ou Serviço, ou deixe vazio (Produto).`,
  billing: (value: string) => `Cobrança “${value}” não reconhecida: use Única ou Mensal, ou deixe vazio (Única).`,
  missingPrice: 'Falta o preço: preencha a coluna do preço.',
  negativePrice: 'O preço não pode ser negativo.',
  price: (value: string) =>
    `Preço “${value}” não reconhecido: use até duas casas decimais, como 1.500,00, até R$ 999.999.999.999,99.`,
  existingCode: (code: string, archived: boolean) =>
    `Já existe no catálogo${archived ? ', arquivado,' : ''} com o código ${code}.`,
  existingName: (name: string, archived: boolean) =>
    `Já existe no catálogo${archived ? ', arquivado,' : ''} um item sem código com o nome “${name}”.`,
  sheetCode: (line: number) => `Repetida na planilha: o mesmo código está na linha ${count(line)}.`,
  sheetName: (line: number) => `Repetida na planilha: o mesmo nome, sem código, está na linha ${count(line)}.`,
  notWritten: 'Não gravada: a importação parou antes desta linha.',
  noReadyRows: 'Nenhuma linha está pronta para importar.',
} as const;

export type ProductSheet = Sheet<ProductImportField>;

/** Lê o arquivo pelo leitor comum, com os cabeçalhos do catálogo. */
export function readProductSheet(bytes: ArrayBuffer | Uint8Array, fileName: string): SheetResult<ProductImportField> {
  return readSheet(bytes, fileName, mapProductHeaders, { empty: PRODUCT_IMPORT_MESSAGES.empty });
}

/** Texto de uma linha só: espaços internos reduzidos a um, sem as pontas. */
const singleLine = (value: string) => value.replace(/\s+/g, ' ').trim();

const KIND_BY_TEXT = new Map<string, CatalogProduct['kind']>([
  ['', 'product'],
  ['produto', 'product'],
  ['p', 'product'],
  ['servico', 'service'],
  ['s', 'service'],
]);
const BILLING_BY_TEXT = new Map<string, DealItemBilling>([
  ['', 'one_time'],
  ['unica', 'one_time'],
  ['avulsa', 'one_time'],
  ['pontual', 'one_time'],
  ['mensal', 'monthly'],
  ['mensalidade', 'monthly'],
  ['recorrente', 'monthly'],
]);

/** Tipo: "produto", "p", "serviço", "servico", "s"; vazio = Produto. Nulo para outro texto. */
export function parseProductKind(value: string): CatalogProduct['kind'] | null {
  return KIND_BY_TEXT.get(textKey(value)) ?? null;
}

/** Cobrança: "única", "unica", "avulsa", "pontual"; "mensal", "mensalidade", "recorrente"; vazio = Única. */
export function parseProductBilling(value: string): DealItemBilling | null {
  return BILLING_BY_TEXT.get(textKey(value)) ?? null;
}

/** Chave do código repetido: aparado, sem diferença de maiúsculas (o índice único do banco); vazio = sem código. */
export const productCodeKey = (code: string | null | undefined) => (code ?? '').trim().toLowerCase() || null;

export interface ProductImportValues {
  id: string;
  name: string;
  code: string | null;
  kind: CatalogProduct['kind'];
  unit: string | null;
  price: number;
  billing: DealItemBilling;
}

export type ProductImportStatus = 'ready' | 'duplicate' | 'error';

export interface AnalyzedProductRow {
  line: number;
  cells: readonly string[];
  status: ProductImportStatus;
  reasons: string[];
  /** Só nas prontas: o pedido de gravação, com o id gerado aqui. */
  payload: ProductImportValues | null;
}

export interface ProductImportAnalysis {
  rows: AnalyzedProductRow[];
  ready: number;
  duplicates: number;
  errors: number;
}

/**
 * Analisa as linhas: os erros (todos os motivos juntos), depois as repetidas contra o catálogo (arquivado ou não) e
 * contra as linhas anteriores. Repetida é a linha com o código de um item existente ou, sem código, com o mesmo nome
 * (`textKey`) de um item sem código. Uma linha com erro não conta como anterior para a repetição.
 */
export function analyzeProductImport(
  sheet: ProductSheet,
  catalog: readonly Pick<CatalogProduct, 'name' | 'code' | 'archived_at'>[],
  newId: () => string = () => crypto.randomUUID(),
): ProductImportAnalysis {
  const codes = new Map<string, { code: string; archived: boolean }>();
  const names = new Map<string, boolean>();
  for (const product of catalog) {
    const key = productCodeKey(product.code);
    if (key) codes.set(key, { code: product.code!.trim(), archived: !!product.archived_at });
    else names.set(textKey(product.name), !!product.archived_at);
  }
  const sheetCodes = new Map<string, number>();
  const sheetNames = new Map<string, number>();
  const rows = sheet.rows.map((row): AnalyzedProductRow => {
    const cell = (field: ProductImportField) => sheetCell(sheet, row, field);
    const reasons: string[] = [];
    const name = singleLine(cell('name'));
    const code = singleLine(cell('code')) || null;
    const unit = singleLine(cell('unit')) || null;
    const kindText = singleLine(cell('kind'));
    const billingText = singleLine(cell('billing'));
    const priceText = cell('price').trim();
    if (!name) reasons.push(PRODUCT_IMPORT_MESSAGES.missingName);
    else if (name.length > PRODUCT_IMPORT_LIMITS.name) reasons.push(PRODUCT_IMPORT_MESSAGES.nameTooLong);
    if (code && code.length > PRODUCT_IMPORT_LIMITS.code) reasons.push(PRODUCT_IMPORT_MESSAGES.codeTooLong);
    const kind = parseProductKind(kindText);
    if (!kind) reasons.push(PRODUCT_IMPORT_MESSAGES.kind(kindText));
    if (unit && unit.length > PRODUCT_IMPORT_LIMITS.unit) reasons.push(PRODUCT_IMPORT_MESSAGES.unitTooLong);
    const price = priceText ? parseBRL(priceText) : null;
    if (!priceText) reasons.push(PRODUCT_IMPORT_MESSAGES.missingPrice);
    else if (/^-/.test(priceText.replace(/^R\$\s*/i, ''))) reasons.push(PRODUCT_IMPORT_MESSAGES.negativePrice);
    else if (price === null || price > MAX_BRL_VALUE) reasons.push(PRODUCT_IMPORT_MESSAGES.price(priceText));
    const billing = parseProductBilling(billingText);
    if (!billing) reasons.push(PRODUCT_IMPORT_MESSAGES.billing(billingText));
    if (row.extraCells) reasons.push(SHEET_MESSAGES.extraCells(sheet.separator));
    if (reasons.length) return { line: row.line, cells: row.cells, status: 'error', reasons, payload: null };
    const codeKey = productCodeKey(code);
    const duplicate: string[] = [];
    if (codeKey) {
      const existing = codes.get(codeKey);
      if (existing) duplicate.push(PRODUCT_IMPORT_MESSAGES.existingCode(existing.code, existing.archived));
      else if (sheetCodes.has(codeKey)) duplicate.push(PRODUCT_IMPORT_MESSAGES.sheetCode(sheetCodes.get(codeKey)!));
      else sheetCodes.set(codeKey, row.line);
    } else {
      const nameKey = textKey(name);
      if (names.has(nameKey)) duplicate.push(PRODUCT_IMPORT_MESSAGES.existingName(name, names.get(nameKey)!));
      else if (sheetNames.has(nameKey)) duplicate.push(PRODUCT_IMPORT_MESSAGES.sheetName(sheetNames.get(nameKey)!));
      else sheetNames.set(nameKey, row.line);
    }
    if (duplicate.length)
      return { line: row.line, cells: row.cells, status: 'duplicate', reasons: duplicate, payload: null };
    return {
      line: row.line,
      cells: row.cells,
      status: 'ready',
      reasons: [],
      payload: { id: newId(), name, code, kind: kind!, unit, price: price!, billing: billing! },
    };
  });
  return {
    rows,
    ready: rows.filter((row) => row.status === 'ready').length,
    duplicates: rows.filter((row) => row.status === 'duplicate').length,
    errors: rows.filter((row) => row.status === 'error').length,
  };
}

/** Os lotes da gravação: só as prontas, até 500 por pedido. */
export function productImportBatches(analysis: ProductImportAnalysis): ProductImportValues[][] {
  return inBatches(analysis.rows.flatMap((row) => (row.payload ? [row.payload] : [])));
}

/**
 * As linhas que não entraram: repetidas, com erro e, depois da gravação, as prontas ainda não gravadas (`written` tem os
 * ids gravados; na prévia, nulo). `extra` acrescenta as que o banco recusou durante a gravação (código cadastrado no
 * meio por um colega), pelo id.
 */
export function productImportIssues(
  analysis: ProductImportAnalysis,
  written: ReadonlySet<string> | null = null,
  extra: ReadonlyMap<string, string> = new Map(),
): SheetIssue[] {
  return analysis.rows.flatMap((row): SheetIssue[] => {
    const late = row.payload ? extra.get(row.payload.id) : undefined;
    if (late) return [{ line: row.line, result: 'Repetida', reason: late, cells: row.cells }];
    if (row.status === 'duplicate')
      return [{ line: row.line, result: 'Repetida', reason: joinReasons(row.reasons), cells: row.cells }];
    if (row.status === 'error')
      return [{ line: row.line, result: 'Com erro', reason: joinReasons(row.reasons), cells: row.cells }];
    if (written && row.payload && !written.has(row.payload.id))
      return [{ line: row.line, result: 'Não gravada', reason: PRODUCT_IMPORT_MESSAGES.notWritten, cells: row.cells }];
    return [];
  });
}

/** A planilha "itens não importados" (`catalogo-nao-importados.csv`), com as colunas comuns e as originais. */
export function productImportIssuesCsv(sheet: ProductSheet, issues: readonly SheetIssue[]): string {
  return sheetIssuesCsv(sheet, issues);
}
