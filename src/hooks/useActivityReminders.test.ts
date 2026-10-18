import { createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateCrmTables } from '@/lib/crm-cache';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  auth: { user: { id: 'me' } as { id: string } | null, loading: false },
  org: { orgId: 'org-1' as string | null },
  permissions: { active: true },
}));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: mocks.from } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => mocks.org }));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => mocks.permissions }));
import { REMINDER_COLUMNS, useActivityReminders } from './useActivityReminders';

type Call = [string, ...unknown[]];
/** Pedido ao PostgREST gravado em ordem, respondido com as linhas da vez (ou com o erro, quando a função o devolve). */
function server(rows: () => Record<string, unknown>[] | Error) {
  const requests: Call[][] = [];
  mocks.from.mockImplementation((table: string) => {
    const calls: Call[] = [['from', table]];
    requests.push(calls);
    const builder = {
      select: (...args: unknown[]) => (calls.push(['select', ...args]), builder),
      eq: (...args: unknown[]) => (calls.push(['eq', ...args]), builder),
      is: (...args: unknown[]) => (calls.push(['is', ...args]), builder),
      neq: (...args: unknown[]) => (calls.push(['neq', ...args]), builder),
      lt: (...args: unknown[]) => (calls.push(['lt', ...args]), builder),
      order: (...args: unknown[]) => (calls.push(['order', ...args]), builder),
      range: (...args: unknown[]) => (calls.push(['range', ...args]), builder),
      then: (resolve: (value: unknown) => unknown) => {
        const current = rows();
        if (current instanceof Error)
          return Promise.resolve({ data: null, error: { message: current.message }, count: null }).then(resolve);
        return Promise.resolve({ data: current, error: null, count: current.length }).then(resolve);
      },
    };
    return builder;
  });
  return requests;
}
const at = (hour: number, minute = 0, day = 18) => new Date(2026, 9, day, hour, minute).toISOString();
const activity = (id: string, due: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'task',
  due_date: due,
  completed_at: null,
  user_id: 'me',
  ...extra,
});

let client: QueryClient;
const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.auth.user = { id: 'me' };
  mocks.auth.loading = false;
  mocks.org.orgId = 'org-1';
  mocks.permissions.active = true;
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('lembretes do menu (item 1.12)', () => {
  it('lê só as cinco colunas das pendentes da pessoa, sem nota, com prazo antes do fim do dia local', async () => {
    const requests = server(() => [activity('a', at(9)), activity('b', at(15)), activity('c', at(11, 0, 17))]);
    const { result } = renderHook(() => useActivityReminders(), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ overdue: 2, upcoming: 1, total: 3 }));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual([
      ['from', 'activities'],
      ['select', REMINDER_COLUMNS, { count: 'exact' }],
      ['eq', 'org_id', 'org-1'],
      ['eq', 'user_id', 'me'],
      ['is', 'completed_at', null],
      ['neq', 'type', 'note'],
      ['lt', 'due_date', new Date(2026, 9, 19).toISOString()],
      ['order', 'id'],
      ['range', 0, 999],
    ]);
    expect(REMINDER_COLUMNS).toBe('id,type,due_date,completed_at,user_id');
    // A chave diz o que a consulta lê, para a invalidação por tabela (CRM_QUERY_READS).
    expect(client.getQueryCache().find({ queryKey: ['crm', 'org-1', 'reminders', 'me', '2026-10-18'] })).toBeTruthy();
  });

  it('sem organização, sem conta ou sem papel ativo (antes da leitura do papel ou desativada), não pede nada', async () => {
    const requests = server(() => []);
    mocks.org.orgId = null;
    const { result, rerender } = renderHook(() => useActivityReminders(), { wrapper });
    mocks.org.orgId = 'org-1';
    mocks.auth.user = null;
    rerender();
    mocks.auth.user = { id: 'me' };
    mocks.permissions.active = false;
    rerender();
    await act(async () => undefined);
    expect(result.current).toBeNull();
    expect(requests).toHaveLength(0);
    mocks.permissions.active = true;
    rerender();
    await waitFor(() => expect(requests).toHaveLength(1));
  });

  it('o horário que passa troca uma próxima por vencida sem reler, ao voltar para a aba', async () => {
    const requests = server(() => [activity('a', at(12, 30))]);
    const { result } = renderHook(() => useActivityReminders(), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ overdue: 0, upcoming: 1, total: 1 }));
    vi.setSystemTime(new Date(2026, 9, 18, 12, 31));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toEqual({ overdue: 1, upcoming: 0, total: 1 });
    expect(requests).toHaveLength(1);
  });

  it('na virada do dia, relê com o novo fim do dia e mantém o número anterior até a resposta', async () => {
    let rows = [activity('a', at(15))];
    const requests = server(() => rows);
    const { result } = renderHook(() => useActivityReminders(), { wrapper });
    await waitFor(() => expect(result.current).toMatchObject({ total: 1 }));
    rows = [activity('a', at(15)), activity('b', at(9, 0, 19))];
    vi.setSystemTime(new Date(2026, 9, 19, 0, 1));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // Antes da nova resposta, a leitura anterior continua, recalculada para o novo horário (a de ontem venceu).
    expect(result.current).toEqual({ overdue: 1, upcoming: 0, total: 1 });
    await waitFor(() => expect(result.current).toEqual({ overdue: 1, upcoming: 1, total: 2 }));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContainEqual(['lt', 'due_date', new Date(2026, 9, 20).toISOString()]);
  });

  it('concluir ou criar uma atividade (gravação em activities) relê o número', async () => {
    let rows = [activity('a', at(9)), activity('b', at(10))];
    const requests = server(() => rows);
    const { result } = renderHook(() => useActivityReminders(), { wrapper });
    await waitFor(() => expect(result.current).toMatchObject({ overdue: 2 }));
    rows = [activity('b', at(10))];
    await act(async () => {
      await invalidateCrmTables(client, ['activities']);
    });
    await waitFor(() => expect(result.current).toMatchObject({ overdue: 1 }));
    expect(requests).toHaveLength(2);
    // Gravar outra tabela que não muda atividades não relê.
    await act(async () => {
      await invalidateCrmTables(client, ['email_templates']);
    });
    expect(requests).toHaveLength(2);
  });

  // Revisão do item 1.12: a falta do número não pode passar por "nenhuma pendência" quando a leitura falhou.
  it('a leitura que falha sem nenhuma anterior dá "unavailable"; com uma anterior, o número dela continua', async () => {
    let rows: Record<string, unknown>[] | Error = new Error('Failed to fetch');
    const requests = server(() => rows);
    const { result } = renderHook(() => useActivityReminders(), { wrapper });
    // Antes da resposta, nulo (como sem lembrete); com a falha, o estado próprio.
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe('unavailable'));
    // A gravação de uma atividade (ou a volta para a aba) tenta de novo; com a resposta, o número.
    rows = [activity('a', at(9))];
    await act(async () => {
      await invalidateCrmTables(client, ['activities']);
    });
    await waitFor(() => expect(result.current).toEqual({ overdue: 1, upcoming: 0, total: 1 }));
    // Uma releitura que falha depois mantém o número da leitura anterior, e não o "?".
    rows = new Error('Failed to fetch');
    await act(async () => {
      await invalidateCrmTables(client, ['activities']);
    });
    await waitFor(() => expect(requests).toHaveLength(3));
    await waitFor(() =>
      expect(client.getQueryState(['crm', 'org-1', 'reminders', 'me', '2026-10-18'])?.status).toBe('error'),
    );
    expect(result.current).toEqual({ overdue: 1, upcoming: 0, total: 1 });
  });

  it('volta a ler ao voltar para a aba, como os dados de trabalho da equipe (0.8)', () => {
    server(() => []);
    renderHook(() => useActivityReminders(), { wrapper });
    const query = client.getQueryCache().find({ queryKey: ['crm', 'org-1', 'reminders', 'me', '2026-10-18'] })!;
    const options = query.options as { staleTime?: number; refetchOnWindowFocus?: boolean };
    expect(options.staleTime).toBe(30_000);
    expect(options.refetchOnWindowFocus).toBe(true);
  });
});
