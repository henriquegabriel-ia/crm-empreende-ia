import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv';
import {
  analyzeProductImport,
  parseProductBilling,
  parseProductKind,
  productImportBatches,
  productImportIssues,
  productImportIssuesCsv,
  PRODUCT_IMPORT_MESSAGES,
  readProductSheet,
  type ProductSheet,
} from '@/lib/product-import';

const encode = (text: string) => new TextEncoder().encode(text);
function sheetOf(text: string): ProductSheet {
  const result = readProductSheet(encode(text), 'catalogo.csv');
  if (result.error) throw new Error(result.error);
  return result.sheet;
}
let sequence = 0;
const ids = () => `id-${++sequence}`;

// Item 1.16: a análise, os lotes e a planilha dos itens não importados.
describe('análise da importação do catálogo', () => {
  it('lê tipo e cobrança, com os padrões para a célula vazia', () => {
    expect(['produto', 'P', '', 'Serviço', 'servico', 's'].map(parseProductKind)).toEqual([
      'product',
      'product',
      'product',
      'service',
      'service',
      'service',
    ]);
    expect(parseProductKind('combo')).toBeNull();
    expect(['Única', 'avulsa', 'pontual', '', 'Mensal', 'mensalidade', 'Recorrente'].map(parseProductBilling)).toEqual([
      'one_time',
      'one_time',
      'one_time',
      'one_time',
      'monthly',
      'monthly',
      'monthly',
    ]);
    expect(parseProductBilling('anual')).toBeNull();
  });

  it('junta todos os motivos de erro de uma linha, com a linha do Excel', () => {
    const sheet = sheetOf(
      `nome;codigo;tipo;unidade;preco;cobranca\n;${'C'.repeat(41)};combo;${'u'.repeat(21)};-10;anual\nOk;;;;1,005;\nSem preço;;;;;\n${'N'.repeat(161)};;;;R$ 10;`,
    );
    const { rows } = analyzeProductImport(sheet, [], ids);
    expect(rows[0]).toMatchObject({ line: 2, status: 'error' });
    expect(rows[0].reasons).toEqual([
      PRODUCT_IMPORT_MESSAGES.missingName,
      PRODUCT_IMPORT_MESSAGES.codeTooLong,
      PRODUCT_IMPORT_MESSAGES.kind('combo'),
      PRODUCT_IMPORT_MESSAGES.unitTooLong,
      PRODUCT_IMPORT_MESSAGES.negativePrice,
      PRODUCT_IMPORT_MESSAGES.billing('anual'),
    ]);
    expect(rows[1].reasons).toEqual([PRODUCT_IMPORT_MESSAGES.price('1,005')]);
    expect(rows[2].reasons).toEqual([PRODUCT_IMPORT_MESSAGES.missingPrice]);
    expect(rows[3].reasons).toEqual([PRODUCT_IMPORT_MESSAGES.nameTooLong]);
  });

  it('marca repetidas por código (com o catálogo arquivado) e, sem código, por nome; não atualiza nada', () => {
    const catalog = [
      { name: 'Implantação', code: 'IMP-01', archived_at: null },
      { name: 'Antigo', code: 'OLD', archived_at: '2026-10-01T00:00:00Z' },
      { name: 'Consultoria Avulsa', code: null, archived_at: null },
    ];
    const sheet = sheetOf(
      'nome;codigo;preco\nOutro nome;imp-01;10\nVolta;old;10\nconsultoria avulsa;;10\nNovo;N-1;10\nNovo de novo;n-1 ;10\nSem código;;5\nSEM CÓDIGO;;6\nImplantação;;7',
    );
    const analysis = analyzeProductImport(sheet, catalog, ids);
    expect(analysis.rows.map((row) => [row.status, row.reasons[0] ?? ''])).toEqual([
      ['duplicate', 'Já existe no catálogo com o código IMP-01.'],
      ['duplicate', 'Já existe no catálogo, arquivado, com o código OLD.'],
      ['duplicate', 'Já existe no catálogo um item sem código com o nome “consultoria avulsa”.'],
      ['ready', ''],
      ['duplicate', 'Repetida na planilha: o mesmo código está na linha 5.'],
      ['ready', ''],
      ['duplicate', 'Repetida na planilha: o mesmo nome, sem código, está na linha 7.'],
      // O nome de um item que tem código não conta: só o código o identifica.
      ['ready', ''],
    ]);
    expect(analysis).toMatchObject({ ready: 3, duplicates: 5, errors: 0 });
  });

  it('grava só as prontas, em lotes de 500, com o id da prévia, e lista as não importadas', () => {
    const lines = Array.from({ length: 501 }, (_, index) => `Item ${index};${index};1`).join('\n');
    const sheet = sheetOf(`nome;codigo;preco\n${lines}\n;x;1`);
    const analysis = analyzeProductImport(sheet, [], ids);
    const batches = productImportBatches(analysis);
    expect(batches.map((batch) => batch.length)).toEqual([500, 1]);
    const firstId = batches[0][0].id;
    expect(analyzeProductImport(sheet, [], ids).rows[0].payload!.id).not.toBe(firstId);
    const written = new Set(batches[0].map((row) => row.id));
    const late = new Map([[batches[0][1].id, PRODUCT_IMPORT_MESSAGES.existingCode('1', false)]]);
    const issues = productImportIssues(analysis, written, late);
    expect(issues.map((issue) => [issue.line, issue.result])).toEqual([
      [3, 'Repetida'],
      [502, 'Não gravada'],
      [503, 'Com erro'],
    ]);
    expect(productImportIssues(analysis).map((issue) => issue.result)).toEqual(['Com erro']);
    const csv = parseCsv(productImportIssuesCsv(sheet, issues).replace(/^FEFF/, ''));
    expect(csv.headers).toEqual([
      'linha_planilha',
      'resultado_importacao',
      'motivo_importacao',
      'nome',
      'codigo',
      'preco',
    ]);
    expect(csv.rows[0].slice(0, 3)).toEqual(['3', 'Repetida', 'Já existe no catálogo com o código 1.']);
  });
});
