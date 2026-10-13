import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  configured: true,
  response: { status: 200, body: [{ has_organization: true }] as unknown },
  calls: [] as { url: URL; method: string }[],
}));

vi.mock('@/integrations/supabase/client', () => ({
  get backendConfigured() {
    return fixture.configured;
  },
}));
// O cliente real do Supabase, com um fetch falso: confere a chamada HTTP da RPC sem backend.
vi.mock('@/integrations/supabase/crm-client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const crmDb = createClient('https://instance-status.test', 'sb_publishable_fixture_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        fixture.calls.push({ url: new URL(String(input)), method: init?.method ?? 'GET' });
        // Como o PostgREST: com .single(), a linha única vem como objeto.
        const single = new Headers(init?.headers).get('accept')?.includes('application/vnd.pgrst.object+json');
        const body = fixture.response.body;
        return new Response(JSON.stringify(single && Array.isArray(body) ? body[0] : body), {
          status: fixture.response.status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  return { crmDb };
});

import { INSTANCE_STATUS_KEY, useInstanceStatus } from './useInstanceStatus';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return { client, ...renderHook(() => useInstanceStatus(), { wrapper }) };
}

beforeEach(() => {
  fixture.configured = true;
  fixture.response = { status: 200, body: [{ has_organization: true }] };
  fixture.calls = [];
});

describe('useInstanceStatus', () => {
  it('lê public.instance_status pela RPC, fora do espaço de uma organização', async () => {
    const { result, client } = setup();
    expect(result.current.checking).toBe(true);
    expect(result.current.hasOrganization).toBeNull();
    await waitFor(() => expect(result.current.hasOrganization).toBe(true));
    expect(result.current.checking).toBe(false);
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0].url.pathname).toBe('/rest/v1/rpc/instance_status');
    expect(fixture.calls[0].method).toBe('POST');
    expect(INSTANCE_STATUS_KEY).toEqual(['instance-status']);
    expect(client.getQueryState(INSTANCE_STATUS_KEY)?.status).toBe('success');
  });

  it('instância vazia', async () => {
    fixture.response = { status: 200, body: [{ has_organization: false }] };
    const { result } = setup();
    await waitFor(() => expect(result.current.hasOrganization).toBe(false));
  });

  it('função ausente (banco sem a migração) vira null, sem nova tentativa', async () => {
    fixture.response = {
      status: 404,
      body: { code: 'PGRST202', message: 'Could not find the function public.instance_status without parameters' },
    };
    const { result } = setup();
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.hasOrganization).toBeNull();
    expect(result.current.unavailable).toBe(true);
    expect(result.current.readFailed).toBe(false);
    expect(fixture.calls).toHaveLength(1);
  });

  it('falha de leitura vira null depois de uma nova tentativa, distinta da função ausente', async () => {
    fixture.response = { status: 503, body: { code: 'PGRST000', message: 'Falha intencional de teste' } };
    const { result } = setup();
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.hasOrganization).toBeNull();
    expect(result.current.readFailed).toBe(true);
    expect(result.current.unavailable).toBe(false);
    expect(fixture.calls).toHaveLength(2);
    fixture.response = { status: 200, body: [{ has_organization: true }] };
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.hasOrganization).toBe(true));
    expect(result.current.readFailed).toBe(false);
  });

  it('uma releitura com falha mantém o último valor lido, sem virar falha de leitura', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.hasOrganization).toBe(true));
    fixture.response = { status: 503, body: { code: 'PGRST000', message: 'Falha intencional de teste' } };
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.rechecking).toBe(false));
    expect(fixture.calls).toHaveLength(3);
    expect(result.current.hasOrganization).toBe(true);
    expect(result.current.readFailed).toBe(false);
  });

  it('refresh relê na hora e devolve o valor novo', async () => {
    fixture.response = { status: 200, body: [{ has_organization: false }] };
    const { result } = setup();
    await waitFor(() => expect(result.current.hasOrganization).toBe(false));
    fixture.response = { status: 200, body: [{ has_organization: true }] };
    let latest: boolean | null = null;
    await act(async () => {
      latest = await result.current.refresh();
    });
    expect(latest).toBe(true);
    await waitFor(() => expect(result.current.hasOrganization).toBe(true));
    expect(fixture.calls).toHaveLength(2);
  });

  it('sem backend configurado, não chama o Supabase', async () => {
    fixture.configured = false;
    const { result } = setup();
    expect(result.current.checking).toBe(false);
    expect(result.current.hasOrganization).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fixture.calls).toHaveLength(0);
  });
});
