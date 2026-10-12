// A dedicated environment is required before any CRM requests are allowed.
import { createClient } from '@supabase/supabase-js';
import type { CommercialDatabase } from './commercial-types';
import { validCrmBackend } from '@/lib/backend-config';
import { browserOffline, OfflineRequestError } from '@/lib/offline';

export const backendConfigured = validCrmBackend(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, import.meta.env.VITE_CRM_ENVIRONMENT);
const SUPABASE_URL = backendConfigured ? import.meta.env.VITE_SUPABASE_URL : "http://127.0.0.1:54321";
const SUPABASE_PUBLISHABLE_KEY = backendConfigured ? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY : "unconfigured-public-client";


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
    if (!configured) return Promise.reject(new Error("O ambiente exclusivo do CRM ainda não foi configurado."));
    if (browserOffline()) return Promise.reject(new OfflineRequestError());
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );

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

const memoryStorage = new Map<string,string>();
export const supabase = createClient<CommercialDatabase>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  global: {
    fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
  },
  auth: {
    storageKey: "empreende-crm-auth",
    storage: {
      getItem(key) { try { return localStorage.getItem(key); } catch { return memoryStorage.get(key) ?? null; } },
      setItem(key, value) { memoryStorage.set(key,value); try { localStorage.setItem(key, value); } catch { /* session remains in memory */ } },
      removeItem(key) { memoryStorage.delete(key); try { localStorage.removeItem(key); } catch { /* unavailable storage */ } },
    },
    persistSession: true,
    autoRefreshToken: true,
  }
});
