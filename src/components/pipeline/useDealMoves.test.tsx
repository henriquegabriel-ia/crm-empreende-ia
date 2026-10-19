import { createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Deal } from '@/lib/deal-types';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { rpc: mocks.rpc } }));
import { dealsQueryKey, useDealMoves } from './useDealMoves';

const deal = (id: string, extra: Partial<Deal> = {}): Deal => ({
  id,
  org_id: 'org',
  pipeline_id: 'p',
  stage_id: 'stage-a',
  title: id,
  value: 1000,
  currency: 'BRL',
  contact_id: null,
  company_id: null,
  owner_id: 'owner',
  close_date: null,
  probability: null,
  status: 'open',
  lost_reason: null,
  closed_at: null,
  stage_entered_at: '2026-09-01T10:00:00.000Z',
  created_at: '2026-09-01T10:00:00.000Z',
  updated_at: '2026-09-01T10:00:00.000Z',
  ...extra,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function setup(rows: Deal[]) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(dealsQueryKey('org'), rows);
  // Outras consultas do cache: o snapshot lê oportunidades; o papel da pessoa, não.
  cache.setQueryData(['crm', 'org', 'snapshot', 'user'], { deals: rows });
  cache.setQueryData(['crm', 'org', 'permissions', 'user'], ['owner']);
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: cache }, children);
  const hook = renderHook(() => useDealMoves('org'), { wrapper });
  const row = (id: string) => cache.getQueryData<Deal[]>(dealsQueryKey('org'))!.find((item) => item.id === id)!;
  const invalidated = (key: unknown[]) => cache.getQueryState(key)?.isInvalidated;
  return { cache, hook, row, invalidated };
}

describe('kanban: trava por oportunidade e atualização otimista', () => {
  it('muda a etapa na hora, trava só a oportunidade movida e reconcilia com a linha devolvida por move_deal', async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    const other = deferred<{ data: unknown; error: null }>();
    mocks.rpc.mockReset().mockReturnValueOnce(pending.promise).mockReturnValueOnce(other.promise);
    const { hook, row, invalidated } = setup([deal('a'), deal('b')]);
    let first!: Promise<Deal | null>;
    act(() => {
      first = hook.result.current.move({ deal: deal('a'), stageId: 'stage-b', status: 'open' });
    });
    await waitFor(() => expect(row('a').stage_id).toBe('stage-b'));
    expect(hook.result.current.moving.has('a')).toBe(true);
    expect(hook.result.current.moving.has('b')).toBe(false);
    // A versão continua a lida até a resposta do banco.
    expect(row('a').updated_at).toBe('2026-09-01T10:00:00.000Z');
    // Um segundo movimento da mesma oportunidade é ignorado enquanto o primeiro não volta.
    await act(async () => {
      expect(await hook.result.current.move({ deal: row('a'), stageId: 'stage-a', status: 'open' })).toBeNull();
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    // Outra oportunidade pode ser movida ao mesmo tempo.
    let second!: Promise<Deal | null>;
    act(() => {
      second = hook.result.current.move({ deal: deal('b'), stageId: 'stage-b', status: 'won' });
    });
    await waitFor(() => expect(row('b').status).toBe('won'));
    expect(row('b')).toMatchObject({ probability: 100, stage_id: 'stage-b' });
    expect(hook.result.current.moving).toEqual(new Set(['a', 'b']));
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'move_deal', {
      p_deal_id: 'a',
      p_stage_id: 'stage-b',
      p_status: 'open',
      p_lost_reason: null,
    });

    const saved = deal('a', {
      stage_id: 'stage-b',
      stage_entered_at: '2026-10-11T12:00:00.123456+00:00',
      updated_at: '2026-10-11T12:00:00.123456+00:00',
    });
    await act(async () => {
      pending.resolve({ data: saved, error: null });
      expect(await first).toEqual(saved);
    });
    expect(row('a')).toEqual(saved);
    expect(hook.result.current.moving).toEqual(new Set(['b']));
    // O que lê oportunidades recarrega em segundo plano; a lista do Pipeline já veio do banco, e o papel não muda.
    expect(invalidated(['crm', 'org', 'snapshot', 'user'])).toBe(true);
    expect(invalidated([...dealsQueryKey('org')])).toBe(false);
    expect(invalidated(['crm', 'org', 'permissions', 'user'])).toBe(false);
    await act(async () => {
      other.resolve({ data: deal('b', { stage_id: 'stage-b', status: 'won', probability: 100 }), error: null });
      await second;
    });
    expect(hook.result.current.moving.size).toBe(0);
  });

  it('numa falha, devolve só a oportunidade que falhou, libera a trava e relê a lista quando nada mais está em andamento', async () => {
    const failing = deferred<{ data: null; error: { message: string } }>();
    const ok = deferred<{ data: unknown; error: null }>();
    mocks.rpc.mockReset().mockReturnValueOnce(failing.promise).mockReturnValueOnce(ok.promise);
    const { hook, row, invalidated } = setup([deal('a'), deal('b')]);
    let failed!: Promise<Deal | null>;
    act(() => {
      failed = hook.result.current.move({ deal: deal('a'), stageId: 'stage-b', status: 'lost', lostReason: ' Preço ' });
    });
    await waitFor(() => expect(row('a').status).toBe('lost'));
    expect(row('a')).toMatchObject({ lost_reason: 'Preço', probability: 0 });
    expect(row('a').closed_at).not.toBeNull();
    let other!: Promise<Deal | null>;
    act(() => {
      other = hook.result.current.move({ deal: deal('b'), stageId: 'stage-b', status: 'open' });
    });
    await waitFor(() => expect(row('b').stage_id).toBe('stage-b'));
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'move_deal', {
      p_deal_id: 'a',
      p_stage_id: 'stage-b',
      p_status: 'lost',
      p_lost_reason: 'Preço',
    });
    await act(async () => {
      failing.resolve({ data: null, error: { message: 'Oportunidade indisponível ou sem acesso.' } });
      await expect(failed).rejects.toEqual({ message: 'Oportunidade indisponível ou sem acesso.' });
    });
    expect(row('a')).toEqual(deal('a'));
    expect(row('b').stage_id).toBe('stage-b');
    expect(hook.result.current.moving).toEqual(new Set(['b']));
    // A gravação pode ter sido feita com a resposta perdida: o snapshot recarrega já; a lista do Pipeline espera a
    // outra movimentação, para não trazer a etapa antiga do card ainda não confirmado.
    expect(invalidated(['crm', 'org', 'snapshot', 'user'])).toBe(true);
    expect(invalidated([...dealsQueryKey('org')])).toBe(false);
    await act(async () => {
      ok.resolve({ data: deal('b', { stage_id: 'stage-b' }), error: null });
      await other;
    });
    expect(row('b').stage_id).toBe('stage-b');
    expect(invalidated([...dealsQueryKey('org')])).toBe(true);
    expect(invalidated(['crm', 'org', 'permissions', 'user'])).toBe(false);
  });

  // Item 1.13: a recusa de uma regra da empresa (gancho private.custom_validate_deal) chega ao Pipeline como o banco a
  // mandou, e a etapa volta; o Pipeline mostra a mensagem por errorMessage (data.test.ts).
  it('a recusa de uma regra da empresa (P0001) desfaz a mudança otimista e chega como o banco a mandou', async () => {
    const refusal = { code: 'P0001', message: 'Regra da empresa: oportunidade acima de R$ 10.000 precisa de empresa.' };
    mocks.rpc.mockReset().mockResolvedValueOnce({ data: null, error: refusal });
    const { hook, row } = setup([deal('a')]);
    await act(async () => {
      await expect(hook.result.current.move({ deal: deal('a'), stageId: 'stage-b', status: 'open' })).rejects.toEqual(
        refusal,
      );
    });
    expect(row('a')).toEqual(deal('a'));
  });

  it('uma exceção da requisição (resposta perdida) também desfaz a mudança otimista e relê a lista', async () => {
    mocks.rpc.mockReset().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { hook, row, invalidated } = setup([deal('a')]);
    await act(async () => {
      await expect(hook.result.current.move({ deal: deal('a'), stageId: 'stage-b', status: 'open' })).rejects.toThrow(
        'Failed to fetch',
      );
    });
    expect(row('a')).toEqual(deal('a'));
    expect(hook.result.current.moving.size).toBe(0);
    expect(invalidated([...dealsQueryKey('org')])).toBe(true);
  });

  it('resposta sem a linha esperada mantém a otimista e manda reler as oportunidades', async () => {
    mocks.rpc.mockReset().mockResolvedValueOnce({ data: null, error: null });
    const { hook, row, invalidated } = setup([deal('a')]);
    await act(async () => {
      await hook.result.current.move({ deal: deal('a'), stageId: 'stage-b', status: 'open' });
    });
    expect(row('a').stage_id).toBe('stage-b');
    expect(invalidated([...dealsQueryKey('org')])).toBe(true);
  });
});
