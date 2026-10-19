/** Tipos de scripts/lib/deploy-env.mjs, para o vite.config.ts. */
import type { VercelConfig } from './security-headers.mjs';

export const BACKEND_ERROR: string;
export const RETIRED_ENVIRONMENT_WARNING: string;
export function deploymentEnvCheck(
  env: Record<string, string | undefined>,
  mode: string,
  options: { validBackend: (url: unknown, key: unknown) => boolean; config?: VercelConfig },
): { error: string | null; warnings: string[] };
