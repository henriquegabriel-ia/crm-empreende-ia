import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeDealItems, dealItemDraft } from '@/lib/deal-logic';
import type { CatalogProduct, DealItemDraft } from '@/lib/deal-types';
import { DealItemsEditor } from './DealItemsEditor';
import { firstDealItemErrorId } from './deal-item-fields';

const archived: CatalogProduct = {
  id: 'old',
  org_id: 'org',
  name: 'Pacote antigo',
  code: 'OLD',
  kind: 'product',
  unit: 'un',
  price: 10,
  billing: 'one_time',
  archived_at: '2026-10-05T12:00:00.000Z',
  created_at: '2026-10-01T12:00:00.000Z',
  updated_at: '2026-10-05T12:00:00.000Z',
};
const draft = (fields: Partial<DealItemDraft>): DealItemDraft => ({ ...dealItemDraft(), ...fields });

function mount(drafts: DealItemDraft[], months = '', products: CatalogProduct[] = [], onChange = vi.fn()) {
  const computation = computeDealItems(drafts, months, { products });
  render(
    <DealItemsEditor
      idPrefix="t"
      drafts={drafts}
      months={months}
      computation={computation}
      products={products}
      showErrors
      onChange={onChange}
    />,
  );
  return { onChange, computation };
}

afterEach(cleanup);

// Item 1.16: o editor de itens (docs/arquitetura/1.16.md, seção 7.2).
describe('editor de itens', () => {
  it('mostra o total da linha com o bruto e o desconto, e os totais com a mensalidade', () => {
    mount(
      [
        draft({
          id: 'a',
          name: 'Implantação',
          quantity: '2',
          unit_price: '500,00',
          discount_type: 'percent',
          discount_value: '10',
        }),
        draft({ id: 'b', name: 'Gestão', unit_price: '2.000,00', billing: 'monthly' }),
      ],
      '12',
    );
    expect(screen.getByText('2 × R$ 500,00 − 10% = R$ 900,00')).toBeInTheDocument();
    expect(screen.getByText('1 × R$ 2.000,00 = R$ 2.000,00 por mês')).toBeInTheDocument();
    expect(screen.getByText('R$ 2.000,00/mês')).toBeInTheDocument();
    // R$ 900,00 + R$ 2.000,00 × 12.
    expect(screen.getByText('R$ 24.900,00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover item Implantação' })).toBeInTheDocument();
  });

  it('o item com produto arquivado mostra "(arquivado)" e o erro da RPC num item novo', () => {
    const drafts = [draft({ id: 'n', product_id: 'old', name: 'Pacote antigo', unit_price: '10,00' })];
    const { computation } = mount(drafts, '', [archived]);
    expect(screen.getByRole('combobox', { name: 'Produto ou serviço' })).toHaveTextContent(
      'Pacote antigo (OLD) (arquivado)',
    );
    expect(
      screen.getByText('“Pacote antigo” foi arquivado no catálogo. Escolha outro item ou use um item avulso.'),
    ).toBeInTheDocument();
    expect(firstDealItemErrorId('t', drafts, computation)).toBe('t-n-product_id');
  });

  it('remover o último item mensal limpa os meses; com 100 itens, "Adicionar item" fica desabilitado', () => {
    const { onChange } = mount([draft({ id: 'm', name: 'Mensal', unit_price: '1', billing: 'monthly' })], '6');
    fireEvent.click(screen.getByRole('button', { name: 'Remover item Mensal' }));
    expect(onChange).toHaveBeenCalledWith([], '');
    cleanup();
    mount(
      Array.from({ length: 100 }, (_, index) => draft({ id: `x${index}`, name: `Item ${index}`, unit_price: '1' })),
    );
    expect(screen.getByRole('button', { name: 'Adicionar item' })).toBeDisabled();
    expect(screen.getByText('Uma oportunidade tem no máximo 100 itens.')).toBeInTheDocument();
  });
});
