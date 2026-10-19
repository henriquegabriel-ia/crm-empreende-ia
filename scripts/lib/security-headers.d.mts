/** Tipos de scripts/lib/security-headers.mjs, para o vite.config.ts e o E2E em TypeScript. */
import type { Plugin } from 'vite';

export interface VercelHeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}
export interface VercelConfig {
  installCommand?: string;
  buildCommand?: string;
  outputDirectory?: string;
  headers?: VercelHeaderRule[];
  rewrites?: { source: string; destination: string }[];
  [key: string]: unknown;
}

export const ROOT: string;
export const VERCEL_FILE: string;
export const APP_SOURCE: string;
export const BRAND_SOURCE: string;
export function readVercelConfig(root?: string): VercelConfig;
export function sourceMatches(source: string, pathname: string): boolean;
export function rulesFor(pathname: string, config?: VercelConfig): VercelHeaderRule[];
export function headersFor(pathname: string, config?: VercelConfig): Record<string, string>;
export function parseCsp(value: string): Map<string, string[]>;
export function cspAllows(
  csp: string | Map<string, string[]>,
  directive: string,
  target: string,
  selfOrigin?: string,
): boolean;
export function appCsp(config?: VercelConfig): string;
export function supabaseOriginProblem(supabaseUrl: string | undefined, config?: VercelConfig): string | null;
export function previewCsp(csp: string, supabaseUrl: string | undefined): { csp: string; warning: string | null };
export function previewHeadersFor(
  pathname: string,
  supabaseUrl: string | undefined,
  config?: VercelConfig,
): Record<string, string>;
export function securityHeadersPlugin(options?: { root?: string }): Plugin;
