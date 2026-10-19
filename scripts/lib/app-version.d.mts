/** Tipos de scripts/lib/app-version.mjs, para o vite.config.ts e o E2E em TypeScript. */
import type { Plugin } from 'vite';

export const VERSION_META_NAME: string;
export class AppVersionError extends Error {}
export function readAppVersion(pkg: { version?: unknown } | null | undefined): string;
export function readPackageVersion(root?: string): string;
export function versionFromHtml(html: string | null | undefined): string | null;
export function versionPlugin(options?: { version?: string }): Plugin;
