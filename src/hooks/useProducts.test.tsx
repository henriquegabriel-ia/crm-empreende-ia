import { createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadProducts: vi.fn(), loadDealItems: vi.fn() }));
vi.mock('@/components/pipeline/deal-items-data', () => ({
  loadProducts: mocks.loadProducts,
  loadDealItems: mocks.loadDealItems,
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));

import { activeProducts, useProducts } from './useProducts';
import { useDealItems } from './useDealItems';
import type { CatalogProduct } from '@/lib/deal-types';

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } }) },
    children,
  );

const product = (id: string, archived_at: string | null = null) => ({ id, name: id, archived_at }) as CatalogProduct;

beforeEach(() => {
  mocks.loadProducts.mockReset();
  mocks.loadDealItems.mockReset();
});

// Item 1.16: o catálogo e os itens da oportunidade nas chaves ['crm', orgId, 'products'] e [..., 'deal-items', dealId].
describe('consultas do catálogo e dos itens', () => {
  it('lê o catálogo e separa os ativos para o seletor', async () => {
    mocks.loadProducts.mockResolvedValue([product('a'), product('b', '2026-10-10T10:00:00Z')]);
    const { result } = renderHook(() => useProducts(), { wrapper });
    await waitFor(() => expect(result.current.products).toHaveLength(2));
    expect(mocks.loadProducts).toHaveBeenCalledWith('org-1');
    expect(activeProducts(result.current.products).map((item) => item.id)).toEqual(['a']);
    expect(result.current.missing).toBe(false);
  });

  it('reconhece o banco sem a migração sem tentar de novo', async () => {
    mocks.loadProducts.mockRejectedValue({ code: 'PGRST205', message: "Could not find the table 'public.products'" });
    const { result } = renderHook(() => useProducts(), { wrapper });
    await waitFor(() => expect(result.current.missing).toBe(true));
    expect(mocks.loadProducts).toHaveBeenCalledTimes(1);
  });

  it('lê os itens só com a oportunidade e quando pedido', async () => {
    mocks.loadDealItems.mockResolvedValue([{ id: 'i1' }]);
    const { result } = renderHook(() => useDealItems('deal-1'), { wrapper });
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'i1' }]));
    expect(mocks.loadDealItems).toHaveBeenCalledWith('org-1', 'deal-1');
    renderHook(() => useDealItems(null), { wrapper });
    renderHook(() => useDealItems('deal-2', { enabled: false }), { wrapper });
    expect(mocks.loadDealItems).toHaveBeenCalledTimes(1);
  });
});
