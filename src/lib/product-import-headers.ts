import { buildCsv } from '@/lib/csv';
import { mapSheetHeaders, type SheetFieldDefinition, type SheetHeaderMap } from '@/lib/sheet-import';

/**
 * Cabeçalhos da planilha do catálogo (item 1.16; docs/arquitetura/1.16.md, seção 8.2): a fonte única do modelo para
 * baixar, da tela da importação e da leitura do arquivo. Sinônimos já normalizados (sem acento, maiúscula, pontuação
 * nem asterisco), como os de contatos. Nome e preço são obrigatórios; duas colunas para o mesmo campo recusam o arquivo.
 */

export type ProductImportField = 'name' | 'code' | 'kind' | 'unit' | 'price' | 'billing';

export interface ProductImportFieldDefinition extends SheetFieldDefinition<ProductImportField> {
  /** Exemplo de valor, para a tela "Como usar". */
  example: string;
}

export const PRODUCT_IMPORT_FIELDS: readonly ProductImportFieldDefinition[] = [
  {
    field: 'name',
    column: 'nome',
    label: 'Nome',
    synonyms: ['nome', 'produto', 'servico', 'item', 'nome do produto', 'nome do servico'],
    example: 'Gestão de tráfego',
  },
  {
    field: 'code',
    column: 'codigo',
    label: 'Código',
    synonyms: ['codigo', 'cod', 'sku', 'referencia', 'ref'],
    example: 'GT-01',
  },
  { field: 'kind', column: 'tipo', label: 'Tipo', synonyms: ['tipo'], example: 'Serviço' },
  {
    field: 'unit',
    column: 'unidade',
    label: 'Unidade',
    synonyms: ['unidade', 'un', 'und', 'unid', 'medida'],
    example: 'mês',
  },
  {
    field: 'price',
    column: 'preco',
    label: 'Preço',
    synonyms: ['preco', 'valor', 'preco unitario', 'valor unitario', 'preco de venda'],
    example: '2.000,00',
  },
  {
    field: 'billing',
    column: 'cobranca',
    label: 'Cobrança',
    synonyms: ['cobranca', 'recorrencia', 'periodicidade', 'frequencia'],
    example: 'Mensal',
  },
];

/** As 6 colunas do modelo para baixar (`modelo-catalogo.csv`), na ordem da tabela. */
export const PRODUCT_TEMPLATE_HEADERS: readonly string[] = PRODUCT_IMPORT_FIELDS.map((definition) => definition.column);

/** Campos obrigatórios. */
export const REQUIRED_PRODUCT_FIELDS: readonly ProductImportField[] = ['name', 'price'];

export const MISSING_PRODUCT_COLUMN: Record<'name' | 'price', string> = {
  name: 'A primeira linha precisa ser o cabeçalho, com uma coluna para o nome do item (nome, produto ou serviço). Use o modelo para conferir.',
  price: 'A planilha precisa de uma coluna para o preço (preço, valor ou preço unitário). Use o modelo para conferir.',
};

/** Mapeia os cabeçalhos do arquivo para os campos do catálogo. */
export function mapProductHeaders(headers: readonly string[]): SheetHeaderMap<ProductImportField> {
  return mapSheetHeaders(
    headers,
    PRODUCT_IMPORT_FIELDS,
    REQUIRED_PRODUCT_FIELDS,
    (field) => MISSING_PRODUCT_COLUMN[field as 'name' | 'price'],
  );
}

/** O modelo para baixar: as 6 colunas e duas linhas de exemplo (um serviço mensal e uma implantação de cobrança única). */
export function productTemplateCsv(): string {
  const rows: Record<string, string>[] = [
    {
      nome: 'Gestão de tráfego',
      codigo: 'GT-01',
      tipo: 'Serviço',
      unidade: 'mês',
      preco: '2.000,00',
      cobranca: 'Mensal',
    },
    { nome: 'Implantação', codigo: 'IMP-01', tipo: 'Serviço', unidade: 'un', preco: '1.500,00', cobranca: 'Única' },
  ];
  return buildCsv(
    rows,
    PRODUCT_TEMPLATE_HEADERS.map((header) => ({ header, value: (row: Record<string, string>) => row[header] })),
  );
}
