/** Tipos de scripts/lib/verify-instance.mjs, para o E2E em TypeScript (tests/browser/verify-instance.spec.ts). */
import type { VercelConfig } from './security-headers.mjs';

export type VerifyStatus = 'ok' | 'fail' | 'warn';
export interface VerifyCheck {
  id: string;
  title: string;
  status: VerifyStatus;
  detail: string;
}
export interface VerifyResult {
  checks: VerifyCheck[];
  approved: boolean;
  local: boolean;
}
export interface VerifyOptions {
  siteUrl: string;
  supabaseUrl: string;
  publishableKey: string;
  fetch?: typeof fetch;
  config?: VercelConfig;
  timeoutMs?: number;
  allowLocal?: boolean;
}

export const DEFAULT_TIMEOUT_MS: number;
export const USER_AGENT: string;
export const GUIDE: string;
export const SPA_ROUTES: readonly string[];
export const BRAND_IMAGE_FIELDS: readonly string[];
export const CHECK_TITLES: Readonly<Record<string, string>>;
export const VERIFY_USAGE: string;
export function maskKey(key: string | undefined): string;
export function keyProblem(key: string | undefined): string | null;
export function urlProblems(value: string, options?: { name?: string; local?: boolean }): string[];
export function headerProblems(
  expected: Record<string, string>,
  received: Headers | Record<string, string>,
  options?: { where?: string },
): string[];
export function robotsClosesSite(text: string): boolean;
export function verifyInstance(options: VerifyOptions): Promise<VerifyResult>;
export function formatVerifyReport(
  result: VerifyResult,
  options?: { siteUrl?: string; supabaseUrl?: string; publishableKey?: string },
): string;
export class VerifyInputError extends Error {
  problems: string[];
}
