import { createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: mocks.from } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
import { IncompleteReadError, readCrmPages, useCrmSnapshot } from './useCrmSnapshot';
type Row = { id: string };
const rows = (length: number, prefix = 'r') =>
  Array.from({ length }, (_, i) => ({ id: `${prefix}${String(i).padStart(5, '0')}` }));
/** Servidor com contagem: cada página traz no máximo `cap` linhas, e a primeira traz o total. */
const server = (source: () => Row[], cap = Infinity) =>
  vi.fn(async (from: number, to: number, withCount: boolean) => {
    const current = source();
    return {
      data: current.slice(from, Math.min(to + 1, from + cap)),
      error: null,
      count: withCount ? current.length : null,
    };
  });
/** Os testes do algoritmo usam páginas de 500 linhas; o snapshot usa o padrão (1000, o limite do Supabase). */
const readPages = <T extends Row>(
  request: Parameters<typeof readCrmPages>[0],
  options: { concurrency?: number } = {},
) => readCrmPages<T>(request, { pageSize: 500, ...options });
describe('snapshot completo', () => {
  it('pede páginas de 1000 linhas, o limite padrão de linhas por resposta do Supabase', async () => {
    const request = server(() => rows(2500));
    expect(await readCrmPages(request)).toEqual(rows(2500));
    // Cada página depois da primeira começa na última linha da anterior (sobreposição de 1).
    expect(request.mock.calls).toEqual([
      [0, 999, true],
      [999, 1998, false],
      [1998, 2997, false],
    ]);
  });
  it('lê o total na primeira página e busca as demais em paralelo, na ordem, sem perder registros após 1000 linhas', async () => {
    const expected = rows(1205);
    const started: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const request = vi.fn(async (from: number, to: number, withCount: boolean) => {
      started.push(from);
      // As páginas seguintes só respondem depois que todas começaram: prova que foram pedidas ao mesmo tempo.
      if (!withCount) {
        if (started.length === 3) release();
        await gate;
      }
      return { data: expected.slice(from, to + 1), error: null, count: withCount ? expected.length : null };
    });
    expect(await readPages(request)).toEqual(expected);
    expect(request.mock.calls).toEqual([
      [0, 499, true],
      [499, 998, false],
      [998, 1497, false],
    ]);
  });
  it('limita as páginas simultâneas por tabela', async () => {
    const expected = rows(5000);
    let active = 0,
      peak = 0;
    const request = vi.fn(async (from: number, to: number, withCount: boolean) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { data: expected.slice(from, to + 1), error: null, count: withCount ? expected.length : null };
    });
    expect(await readPages(request, { concurrency: 3 })).toEqual(expected);
    expect(peak).toBe(3);
    // A primeira página e mais 10, que avançam 499 linhas cada; a última veio incompleta e encerra a leitura.
    expect(request).toHaveBeenCalledTimes(11);
    expect(request.mock.calls.at(-1)).toEqual([4990, 5489, false]);
  });
  it('uma última página cheia pede a seguinte: pode haver linhas criadas depois da contagem', async () => {
    const request = server(() => rows(1000));
    expect(await readPages(request)).toEqual(rows(1000));
    expect(request.mock.calls).toEqual([
      [0, 499, true],
      [499, 998, false],
      [998, 1497, false],
    ]);
  });
  it('não trata o limite de linhas do servidor como fim da lista', async () => {
    const expected = rows(1205);
    // Servidor configurado para no máximo 100 linhas por resposta, menos que a página pedida.
    const request = server(() => expected, 100);
    expect(await readPages(request)).toEqual(expected);
    expect(request.mock.calls[1]).toEqual([99, 198, false]);
    expect(request).toHaveBeenCalledTimes(13);
  });
  it('sem contagem e com limite do servidor menor que a página, não para na primeira página', async () => {
    const expected = rows(1205);
    // Servidor sem contagem e com no máximo 500 linhas por resposta; a leitura pede páginas de 1000.
    const request = vi.fn(async (from: number, to: number) => ({
      data: expected.slice(from, Math.min(to + 1, from + 500)),
      error: null,
    }));
    expect(await readCrmPages(request)).toEqual(expected);
    expect(request.mock.calls.map(([from, to]) => [from, to])).toEqual([
      [0, 999],
      [499, 998],
      [998, 1497],
    ]);
  });
  it('linhas criadas durante a leitura não se repetem nem empurram outra para fora', async () => {
    const before = rows(1000);
    let current = before;
    const request = vi.fn(async (from: number, to: number, withCount: boolean) => {
      const result = { data: current.slice(from, to + 1), error: null, count: withCount ? current.length : null };
      // Depois da contagem, alguém cria uma linha que entra no começo da ordem.
      if (withCount) current = [{ id: 'a-nova' }, ...before];
      return result;
    });
    const read = await readPages<Row>(request);
    // r00498 veio nas duas páginas e ficou uma vez; r00999, empurrada para depois do total, veio na última página.
    expect(read).toEqual(before);
    // As páginas seguintes começam numa linha já lida: a leitura não precisou ser refeita.
    expect(request.mock.calls.filter(([, , withCount]) => withCount)).toHaveLength(1);
  });
  it.each([1, 2])(
    'página lida fora de ordem com %i linha(s) criada(s) na faixa dela refaz a leitura em vez de perder uma linha',
    async (created) => {
      let current = rows(1500);
      let reads = 0;
      let laterPageRead!: () => void;
      const laterPage = new Promise<void>((resolve) => (laterPageRead = resolve));
      const request = vi.fn(async (from: number, to: number, withCount: boolean) => {
        if (withCount) reads++;
        // Na primeira leitura, a página que começa em 499 só roda no banco depois da que começa em 998.
        if (reads === 1 && from === 499) await laterPage;
        const result = { data: current.slice(from, to + 1), error: null, count: withCount ? current.length : null };
        if (reads === 1 && from === 998) {
          // Logo depois, alguém cria linhas no meio da faixa da página de 499: as últimas dela passam para a de 998,
          // que já foi lida. Sem a conferência da sobreposição, com 2 linhas criadas a r00999 sumiria em silêncio.
          const inserted = Array.from({ length: created }, (_, i) => ({ id: `r00699${'yz'[i]}` }));
          current = [...current.slice(0, 700), ...inserted, ...current.slice(700)];
          laterPageRead();
        }
        return result;
      });
      const read = await readPages<Row>(request);
      expect(reads).toBe(2);
      expect(read).toEqual(current);
      expect(read.map((row) => row.id)).toContain('r00999');
    },
  );
  it('uma exclusão durante a leitura refaz a leitura em vez de devolver a lista sem uma linha', async () => {
    let current = rows(1000);
    let reads = 0;
    const request = vi.fn(async (from: number, to: number, withCount: boolean) => {
      if (withCount) reads++;
      const result = { data: current.slice(from, to + 1), error: null, count: withCount ? current.length : null };
      // Na primeira leitura, uma linha da primeira página é excluída antes das seguintes.
      if (withCount && reads === 1) current = current.filter((row) => row.id !== 'r00010');
      return result;
    });
    const read = await readPages<Row>(request);
    expect(reads).toBe(2);
    expect(read).toEqual(rows(1000).filter((row) => row.id !== 'r00010'));
  });
  it('falha, sem lista cortada, se a leitura continuar incompleta', async () => {
    const expected = rows(800);
    // O servidor diz que há 900 linhas, mas só entrega 800.
    const request = vi.fn(async (from: number, to: number, withCount: boolean) => ({
      data: expected.slice(from, to + 1),
      error: null,
      count: withCount ? 900 : null,
    }));
    await expect(readPages(request)).rejects.toBeInstanceOf(IncompleteReadError);
    expect(request.mock.calls.filter(([, , withCount]) => withCount)).toHaveLength(2);
  });
  it('sem contagem do servidor, segue página a página até uma incompleta', async () => {
    const expected = rows(1205);
    const request = vi.fn(async (from: number, to: number) => ({ data: expected.slice(from, to + 1), error: null }));
    expect(await readPages(request)).toEqual(expected);
    expect(request.mock.calls.map(([from, to]) => [from, to])).toEqual([
      [0, 499],
      [499, 998],
      [998, 1497],
    ]);
  });
  it('sem contagem, uma lista curta, de uma linha ou vazia termina sem repetir linhas', async () => {
    const three = vi.fn(async (from: number, to: number) => ({ data: rows(3).slice(from, to + 1), error: null }));
    expect(await readCrmPages(three)).toEqual(rows(3));
    // Sem o total, 3 linhas podem ser o limite do servidor: a página seguinte confirma o fim.
    expect(three.mock.calls.map(([from, to]) => [from, to])).toEqual([
      [0, 999],
      [2, 4],
    ]);
    const one = vi.fn(async (from: number, to: number) => ({ data: rows(1).slice(from, to + 1), error: null }));
    expect(await readCrmPages(one)).toEqual(rows(1));
    expect(one.mock.calls.map(([from, to]) => [from, to])).toEqual([
      [0, 999],
      [1, 1],
    ]);
    const empty = vi.fn(async () => ({ data: [], error: null }));
    expect(await readCrmPages(empty)).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);
  });
  it('um erro intermediário falha o snapshot inteiro em vez de publicar contagem parcial', async () => {
    const failure = { message: 'network', code: 'offline' };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: rows(500), error: null, count: 1200 })
      .mockResolvedValueOnce({ data: rows(500), error: null })
      .mockResolvedValueOnce({ data: null, error: failure });
    await expect(readPages(request)).rejects.toBe(failure);
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
