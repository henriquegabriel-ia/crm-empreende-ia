import { describe, expect, it } from 'vitest';
import {
  buildCsv,
  csvByteLength,
  csvCell,
  decodeCsvBytes,
  detectCsvSeparator,
  parseCsv,
  type CsvColumn,
} from '@/lib/csv';

const single: CsvColumn<{ value: unknown }>[] = [{ header: 'valor', value: (row) => row.value }];
const numbered: CsvColumn<{ line: number; value: string }>[] = [
  { header: 'linha', value: (row) => row.line },
  { header: 'valor', value: (row) => row.value },
];
const roundTrip = (values: string[]) => {
  const parsed = parseCsv(
    buildCsv(
      values.map((value, line) => ({ line, value })),
      numbered,
    ),
  );
  if (parsed.error) throw new Error(parsed.error);
  return parsed.rows.map((row) => row[1]);
};

describe('csvCell: neutralização de fórmulas', () => {
  it.each([
    '=HYPERLINK("https://example.com")',
    '+SUM(A1:A9)',
    '+55 11 99999-0000',
    '-42',
    '@SUM(A1)',
    '  =1+1',
    '\t=1+1',
    '\tTexto',
    '\rTexto',
    '\n=1+1',
    '\uFEFF=1+1',
    "'=já neutralizado",
  ])('prefixa apóstrofo em %j', (value) => expect(csvCell(value)).toMatch(/^"'/));

  it.each(['Ana', '55 11 99999-0000', "'texto com apóstrofo", 'R$ 1.500,00', '1500', ''])(
    'mantém %j sem prefixo',
    (value) => expect(csvCell(value)).toBe(`"${value}"`),
  );

  it('preserva separadores, quebras de linha e aspas como texto dentro da célula', () => {
    expect(csvCell('Empresa "A"; filial\nSão Paulo')).toBe('"Empresa ""A""; filial\nSão Paulo"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(12.5)).toBe('"12.5"');
  });
});

describe('buildCsv: formato do Excel em português', () => {
  it('usa BOM UTF-8, ponto e vírgula e CRLF, com cabeçalho pelas colunas', () => {
    const csv = buildCsv(
      [{ name: 'Empresa;A', value: 100 }],
      [
        { header: 'Nome', value: (row) => row.name },
        { header: 'Valor', value: (row) => row.value },
      ],
    );
    expect(csv).toBe('\uFEFF"Nome";"Valor"\r\n"Empresa;A";"100"');
    expect(Array.from(new TextEncoder().encode(csv).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('gera só o cabeçalho quando não há linhas', () => {
    expect(buildCsv([], single)).toBe('\uFEFF"valor"');
  });
});

describe('parseCsv', () => {
  it('detecta o separador pelo cabeçalho, ignorando o que está entre aspas', () => {
    expect(detectCsvSeparator('a;b;c\n1,2;3;4')).toBe(';');
    expect(detectCsvSeparator('a,b,c\n1;2,3,4')).toBe(',');
    expect(detectCsvSeparator('"nome, completo";email')).toBe(';');
    expect(detectCsvSeparator('"nome; completo",email')).toBe(',');
    expect(detectCsvSeparator('\uFEFFfirst_name;email')).toBe(';');
    expect(detectCsvSeparator('first_name')).toBe(',');
  });

  it('lê aspas, aspas escapadas, quebras de linha internas, BOM e CRLF', () => {
    const result = parseCsv('\uFEFF"Nome";"Obs"\r\n"Ana ""A""";"linha 1\r\nlinha 2"\r\nBruno;sem aspas\r\n');
    expect(result).toEqual({
      separator: ';',
      headers: ['Nome', 'Obs'],
      rows: [
        ['Ana "A"', 'linha 1\r\nlinha 2'],
        ['Bruno', 'sem aspas'],
      ],
      error: null,
    });
  });

  it('aceita vírgula, LF e CR isolado, e ignora linhas vazias', () => {
    const result = parseCsv('a,b\n1,2\r\r\n3,4\r5,6');
    expect(result.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
  });

  it('recusa aspas não fechadas', () => {
    expect(parseCsv('a;b\n"1;2')).toEqual({
      separator: ';',
      headers: [],
      rows: [],
      error: 'Há aspas não fechadas no CSV.',
    });
  });

  it('devolve cabeçalho vazio para um arquivo vazio', () => {
    expect(parseCsv('')).toEqual({ separator: ',', headers: [], rows: [], error: null });
    expect(parseCsv('\uFEFF')).toEqual({ separator: ',', headers: [], rows: [], error: null });
  });

  it('remove o apóstrofo só quando ele neutraliza uma fórmula', () => {
    const result = parseCsv("a;b;c;d\n'+55 11 99999-0000;'=1+1;'texto;''=x");
    expect(result.rows[0]).toEqual(['+55 11 99999-0000', '=1+1', "'texto", "'=x"]);
  });

  it('faz o round-trip exato de valores com fórmula, telefone, acento, aspas e separadores', () => {
    const values = [
      '+55 11 99999-0000',
      '+5511999990000',
      '=HYPERLINK("https://example.com")',
      '-42',
      '@SUM(A1)',
      '  =1+1',
      '\t=1+1',
      '\uFEFF=1+1',
      "'=já neutralizado",
      "''+duplo",
      "'texto",
      'Ação; "citação", vírgula',
      'linha 1\r\nlinha 2',
      'São Paulo',
      '',
    ];
    expect(roundTrip(values)).toEqual(values);
  });

  it('remove espaços das pontas, que a exportação não usa para dados', () => {
    expect(roundTrip(['  Ana  ', '\t'])).toEqual(['Ana', '']);
  });
});

describe('arquivos em UTF-8 e no formato do Excel', () => {
  it('mede o limite em bytes, e não em caracteres', () => {
    expect(csvByteLength('abc')).toBe(3);
    expect(csvByteLength('ção')).toBe(5);
    expect(csvByteLength('🧑')).toBe(4);
    expect(csvByteLength('\uFEFF')).toBe(3);
  });

  it('lê UTF-8 com ou sem BOM', () => {
    const utf8 = new TextEncoder().encode('first_name;email\nJoão;joao@example.test');
    expect(decodeCsvBytes(utf8)).toBe('first_name;email\nJoão;joao@example.test');
    const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8]);
    expect(decodeCsvBytes(withBom.buffer)).toBe('first_name;email\nJoão;joao@example.test');
  });

  it('cai para Windows-1252 quando o arquivo não é UTF-8 válido, como o CSV salvo pelo Excel', () => {
    const windows1252 = Uint8Array.from([
      0x4a, 0x6f, 0xe3, 0x6f, 0x3b, 0x41, 0xe7, 0xe3, 0x6f, 0x3b, 0xc9, 0x72, 0x69, 0x63, 0x61,
    ]);
    expect(decodeCsvBytes(windows1252)).toBe('João;Ação;Érica');
  });
});
