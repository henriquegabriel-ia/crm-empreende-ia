// O projeto Supabase da instância (URL e chave pública) precisa estar configurado antes de qualquer pedido do CRM.
import { createClient } from '@supabase/supabase-js';
import type { CommercialDatabase } from './commercial-types';
import { validCrmBackend } from '@/lib/backend-config';
import { browserOffline, OfflineRequestError } from '@/lib/offline';

export const backendConfigured = validCrmBackend(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
const SUPABASE_URL = backendConfigured ? import.meta.env.VITE_SUPABASE_URL : 'http://127.0.0.1:54321';
const SUPABASE_PUBLISHABLE_KEY = backendConfigured
  ? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  : 'unconfigured-public-client';

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

/**
 * Exportada para os testes; `configured` só muda neles.
 * Sem conexão (navigator.onLine === false), recusa na hora com OfflineRequestError: a gravação falha com uma
 * mensagem em pt-BR em vez de ficar esperando, e nada fica guardado para enviar depois (o CRM não tem modo offline).
 */
export function createSupabaseFetch(supabaseKey: string, configured = backendConfigured): typeof fetch {
  return (input, init) => {
    if (!configured) return Promise.reject(new Error('O projeto Supabase do CRM ainda não foi configurado.'));
    if (browserOffline()) return Promise.reject(new OfflineRequestError());
    const headers = new Headers(typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }

    headers.set('apikey', supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

const memoryStorage = new Map<string, string>();
export const supabase = createClient<CommercialDatabase>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  global: {
    fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
  },
  auth: {
    storageKey: 'empreende-crm-auth',
    storage: {
      getItem(key) {
        try {
          return localStorage.getItem(key);
        } catch {
          return memoryStorage.get(key) ?? null;
        }
      },
      setItem(key, value) {
        memoryStorage.set(key, value);
        try {
          localStorage.setItem(key, value);
        } catch {
          /* session remains in memory */
        }
      },
      removeItem(key) {
        memoryStorage.delete(key);
        try {
          localStorage.removeItem(key);
        } catch {
          /* unavailable storage */
        }
      },
    },
    persistSession: true,
    autoRefreshToken: true,
    // Fluxo implícito, declarado e não herdado do padrão da biblioteca (docs/arquitetura/1.1.md, seções 16.5 e 16.21).
    // Num link do Auth que volta pelo GET /verify (os modelos de e-mail padrão do Supabase), só o fluxo implícito abre a
    // sessão na mesma transação que confirma a conta, e é ela que grava a prova do e-mail; no PKCE, a sessão nasce
    // noutro pedido, na troca do código, e a pessoa precisaria de outro link para voltar com senha.
    flowType: 'implicit',
  },
});
