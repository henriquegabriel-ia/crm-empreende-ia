import { describe, expect, it } from 'vitest';
import { analyzeProductImport, readProductSheet } from '@/lib/product-import';
import {
  MISSING_PRODUCT_COLUMN,
  mapProductHeaders,
  PRODUCT_TEMPLATE_HEADERS,
  productTemplateCsv,
} from '@/lib/product-import-headers';

const ids = () => crypto.randomUUID();

// Item 1.16: as colunas e os sinônimos da planilha do catálogo.
describe('cabeçalhos do catálogo', () => {
  it('reconhece os sinônimos sem acento, maiúscula e asterisco', () => {
    const map = mapProductHeaders(['Produto *', 'SKU', 'Tipo', 'Und', 'Valor unitário', 'Recorrência', 'Observação']);
    expect(map.error).toBeNull();
    expect(map.recognized.map((item) => item.field)).toEqual(['name', 'code', 'kind', 'unit', 'price', 'billing']);
    expect(map.ignored).toEqual(['Observação']);
  });
  it('exige o nome e o preço', () => {
    expect(mapProductHeaders(['preco']).error).toBe(MISSING_PRODUCT_COLUMN.name);
    expect(mapProductHeaders(['nome']).error).toBe(MISSING_PRODUCT_COLUMN.price);
    expect(mapProductHeaders(['Preço', 'Valor', 'nome']).error).toContain('são o mesmo campo do CRM (preço)');
  });
  it('o modelo traz as 6 colunas e duas linhas de exemplo que a própria importação aceita', () => {
    expect(PRODUCT_TEMPLATE_HEADERS).toEqual(['nome', 'codigo', 'tipo', 'unidade', 'preco', 'cobranca']);
    const analysis = analyzeProductImport(
      readProductSheet(new TextEncoder().encode(productTemplateCsv()), 'modelo.csv').sheet!,
      [],
      ids,
    );
    expect(analysis).toMatchObject({ ready: 2, duplicates: 0, errors: 0 });
    expect(analysis.rows[0].payload).toMatchObject({
      name: 'Gestão de tráfego',
      code: 'GT-01',
      kind: 'service',
      price: 2000,
      billing: 'monthly',
    });
  });
});
