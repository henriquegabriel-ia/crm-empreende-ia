import { createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: mocks.from } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
import { readCrmPages, useCrmSnapshot } from './useCrmSnapshot';
describe('snapshot completo', () => {
  it('continua além do limite e não perde registros após 1000 linhas', async () => {
    const expected = Array.from({ length: 1205 }, (_, id) => ({ id }));
    const request = vi.fn(async (from, to) => ({ data: expected.slice(from, to + 1), error: null }));
    expect(await readCrmPages(request)).toEqual(expected);
    expect(request.mock.calls).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
  });
  it('um erro intermediário falha o snapshot inteiro em vez de publicar contagem parcial', async () => {
    const failure = { message: 'network', code: 'offline' };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null })
      .mockResolvedValueOnce({ data: null, error: failure });
    await expect(readCrmPages(request)).rejects.toBe(failure);
  });
});
describe('snapshot atualizado entre colegas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    focusManager.setFocused(undefined);
  });
  it('recarrega ao voltar para a aba quando os dados têm mais de 30 s, mesmo com o padrão do app desligado', async () => {
    mocks.from.mockImplementation(() => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        range: async () => ({ data: [], error: null }),
      };
      return chain;
    });
    // Mesmo padrão do App: dados frescos por 5 min e sem recarregar no foco.
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: cache }, children);
    const { result } = renderHook(() => useCrmSnapshot(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const reads = () => mocks.from.mock.calls.filter(([table]) => table === 'contacts').length;
    const returnToTab = () =>
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
    expect(reads()).toBe(1);
    // Voltar antes de 30 s não recarrega.
    returnToTab();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(reads()).toBe(1);
    const loadedAt = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(loadedAt + 31_000);
    returnToTab();
    await waitFor(() => expect(reads()).toBe(2));
    // Sem recarga periódica.
    expect(cache.getQueryCache().getAll()[0].options).not.toHaveProperty('refetchInterval');
  });
});
