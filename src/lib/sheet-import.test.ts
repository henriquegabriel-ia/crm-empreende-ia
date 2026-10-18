import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv';
import { inBatches, mapSheetHeaders, readSheet, SHEET_MESSAGES, sheetCell, sheetIssuesCsv } from '@/lib/sheet-import';

const encode = (text: string) => new TextEncoder().encode(text);

// Item 1.16: o leitor comum (generalizado do 1.11), usado pela importação de contatos e pela do catálogo.
describe('leitor comum de planilhas', () => {
  const map = (headers: readonly string[]) =>
    mapSheetHeaders(
      headers,
      [{ field: 'name' as const, column: 'nome', label: 'Nome', synonyms: ['nome'] }],
      ['name'],
      () => 'Sem nome.',
    );
  it('recusa arquivo vazio com a frase de cada importação, e planilha binária com o passo a passo', () => {
    expect(readSheet(encode(''), 'a.csv', map, { empty: 'Nada aqui.' }).error).toBe('Nada aqui.');
    const xlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(readSheet(xlsx, 'a.xlsx', map, { empty: 'Nada aqui.' }).error).toBe(SHEET_MESSAGES.spreadsheet);
    expect(readSheet(encode('email\nana@example.test'), 'a.csv', map, { empty: 'Nada aqui.' }).error).toBe('Sem nome.');
  });
  it('lê a codificação do Excel, a linha do Excel, as colunas ignoradas e as células além do cabeçalho', () => {
    const latin = new Uint8Array([...'nome;Extra\r\nAção;x\r\n\r\nPão;y;sobra\r\n'].map((char) => char.charCodeAt(0)));
    const sheet = readSheet(latin, 'excel.csv', map, { empty: 'Nada aqui.' }).sheet!;
    expect(sheet.ignored).toEqual(['Extra']);
    expect(sheet.rows.map((row) => [row.line, sheetCell(sheet, row, 'name'), row.extraCells])).toEqual([
      [2, 'Ação', false],
      [4, 'Pão', true],
    ]);
  });
  it('recusa duas colunas para o mesmo campo, nomeando as duas', () => {
    expect(map(['Nome', 'nome']).error).toBe(
      'As colunas “Nome” e “nome” são o mesmo campo do CRM (nome). Deixe só uma e importe de novo.',
    );
  });
  it('divide em lotes e monta a planilha das linhas não importadas sem repetir as colunas de resultado', () => {
    expect(inBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    const csv = sheetIssuesCsv({ headers: ['linha_planilha', 'nome'] }, [
      { line: 3, result: 'Com erro', reason: 'Falta o preço.', cells: ['2', 'Item'] },
    ]);
    expect(parseCsv(csv.replace(/^FEFF/, '')).headers).toEqual([
      'linha_planilha',
      'resultado_importacao',
      'motivo_importacao',
      'nome',
    ]);
  });
});
