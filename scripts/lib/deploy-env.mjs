// Conferência das variáveis do frontend no build (item 1.3; docs/arquitetura/1.3.md, seções 6.4 e 7), extraída do
// vite.config.ts para ser testada sem subir o Vite. `validBackend` é o `validCrmBackend` de src/lib/backend-config.ts
// (TypeScript, que o vite.config.ts importa e repassa).
import { readVercelConfig, supabaseOriginProblem } from './security-headers.mjs';

export const BACKEND_ERROR =
  'Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY com o projeto Supabase desta instância. Chaves privilegiadas não podem entrar no frontend.';
export const RETIRED_ENVIRONMENT_WARNING =
  'VITE_CRM_ENVIRONMENT foi aposentada no item 1.3 e não faz mais nada; pode removê-la da hospedagem e do .env.local.';

/**
 * Devolve `{ error, warnings }` para o modo do build. A URL e a chave são conferidas no modo `deployment` (o build da
 * Vercel) ou sempre que a chave existe; no `deployment`, a URL também precisa ser https:// e coberta pelo connect-src da
 * CSP do vercel.json. VITE_CRM_ENVIRONMENT, definida com qualquer valor, só avisa: nenhuma instância quebra.
 */
export function deploymentEnvCheck(env, mode, { validBackend, config } = {}) {
  const warnings = [];
  if (env.VITE_CRM_ENVIRONMENT !== undefined) warnings.push(RETIRED_ENVIRONMENT_WARNING);
  const checked = mode === 'deployment' || Boolean(env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (checked && !validBackend(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY))
    return { error: BACKEND_ERROR, warnings };
  if (mode === 'deployment') {
    const problem = supabaseOriginProblem(env.VITE_SUPABASE_URL, config ?? readVercelConfig());
    if (problem) return { error: problem, warnings };
  }
  return { error: null, warnings };
}
