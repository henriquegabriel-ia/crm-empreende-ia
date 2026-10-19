import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseFetch } from './client';
import { errorMessage } from '@/components/pipeline/data';
import { OFFLINE_REQUEST_MESSAGE, OfflineRequestError } from '@/lib/offline';

const KEY = 'sb_publishable_fixture_test';
const network = vi.fn<typeof fetch>();
let online = true;

beforeEach(() => {
  online = true;
  network
    .mockReset()
    .mockResolvedValue(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', network);
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetch do cliente Supabase sem conexão', () => {
  it('recusa na hora, sem chamar a rede, com a mensagem em pt-BR', async () => {
    online = false;
    const request = createSupabaseFetch(KEY, true)('https://crm.test/rest/v1/deals', { method: 'PATCH' });
    await expect(request).rejects.toBeInstanceOf(OfflineRequestError);
    await expect(request).rejects.toThrow(OFFLINE_REQUEST_MESSAGE);
    expect(network).not.toHaveBeenCalled();
  });

  it('com conexão, envia a chave pública e tira o Bearer das chaves novas', async () => {
    await createSupabaseFetch(KEY, true)('https://crm.test/rest/v1/deals', {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(network).toHaveBeenCalledOnce();
    const headers = new Headers(network.mock.calls[0][1]?.headers);
    expect(headers.get('apikey')).toBe(KEY);
    expect(headers.get('Authorization')).toBeNull();
  });

  it('sem o projeto configurado, continua recusando antes de olhar a conexão', async () => {
    online = false;
    await expect(createSupabaseFetch(KEY, false)('https://crm.test/rest/v1/deals')).rejects.toThrow(
      'O projeto Supabase do CRM ainda não foi configurado.',
    );
    expect(network).not.toHaveBeenCalled();
  });

  it('uma gravação pelo cliente falha na hora com mensagem clara, e volta a funcionar com a conexão', async () => {
    const client = createClient('https://crm.test', KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: createSupabaseFetch(KEY, true) },
    });
    online = false;
    const offline = await client.from('deals').update({ title: 'Sem conexão' }).eq('id', 'deal-1').select('id');
    expect(offline.data).toBeNull();
    expect(offline.error?.message).toContain(OFFLINE_REQUEST_MESSAGE);
    expect(errorMessage(offline.error)).toBe(OFFLINE_REQUEST_MESSAGE);
    const login = await client.auth.signInWithPassword({ email: 'pessoa@example.test', password: 'senha-de-teste' });
    expect(login.error?.message).toBe(OFFLINE_REQUEST_MESSAGE);
    expect(network).not.toHaveBeenCalled();

    online = true;
    const restored = await client.from('deals').update({ title: 'Com conexão' }).eq('id', 'deal-1').select('id');
    expect(restored.error).toBeNull();
    expect(network).toHaveBeenCalledOnce();
  });
});
