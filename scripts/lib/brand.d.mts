/** Tipos de scripts/lib/brand.mjs, para os testes em TypeScript (Vitest e Playwright) e o vite.config.ts. */
import type { Plugin } from 'vite';

/** O brand.json como o aluno escreve: todos os campos, menos productName, são opcionais. */
export interface BrandInput {
  productName: string;
  shortName?: string;
  tagline?: string;
  supportEmail?: string;
  logoOnLight?: string;
  logoOnDark?: string;
  icon?: string;
  favicon?: string;
  authImage?: string;
  emailLogo?: string;
  emailLogoWidth?: number;
  exportName?: string;
  showBaseCredit?: boolean;
}

/** O brand.json validado, com todos os campos preenchidos. */
export type Brand = Required<BrandInput>;

/** Objeto público que vai para o navegador (`__CRM_BRAND__`); igual ao `AppBrand` de src/lib/brand.ts. */
export interface AppBrand {
  productName: string;
  tagline: string;
  supportEmail: string;
  logoOnLight: string | null;
  logoOnDark: string | null;
  icon: string | null;
  authImage: string | null;
  exportName: string;
  baseCredit: boolean;
}

export type Env = Record<string, string | undefined>;

export declare const ROOT: string;
export declare const BRAND_DIR: string;
export declare const BRAND_FILE: string;
export declare const LEGACY_EMAIL_BRAND_FILE: string;
export declare const BASE_CREDIT_TEXT: 'Feito com Empreende.IA';
export declare const PROGRAM_BRAND: Readonly<Brand>;
export declare const PROGRAM_ASSETS: readonly string[];
export declare const BRAND_FIELDS: readonly (keyof Brand)[];
export declare const MAX_IMAGE_BYTES: 1048576;
export declare const EMAIL_PATTERN: RegExp;
export declare const NAME_MARKER: '%CRM_BRAND_NAME%';
export declare const ICON_MARKER: '<!-- %CRM_BRAND_ICON% -->';
export declare const UTF16_FILE_MESSAGE: string;
export declare function isUtf16Text(bytes: Uint8Array): boolean;

export declare class BrandError extends Error {
  constructor(problems: string[], options?: { file?: string; title?: string; hint?: string | null });
  file: string;
  problems: string[];
  static join(errors: BrandError[]): BrandError;
}

export declare function displayPath(file: string): string;
export declare function isHttpsUrl(value: string): boolean;
export declare function exportSlug(name: string): string;
export declare function exportFileNameFor(exportName: string, base: string, extension: string, date?: string): string;
export declare function isProgramBrand(brand: Pick<Brand, 'productName'>): boolean;
export declare function svgHasScript(svg: string): boolean;
export declare function svgRefusal(
  content: string | Uint8Array,
): { reason: 'encoding' | 'script' } | { reason: 'active'; found: string } | null;
export declare function svgHasExternalReference(svg: string): boolean;
export declare function normalizeBrand(input: unknown, options?: { dir?: string; checkFiles?: boolean }): Brand;
export declare function readBrand(options?: { dir?: string }): Brand;
export declare function brandEnvProblems(env?: Env, options?: { build?: boolean; customDir?: string }): string[];
export declare function resolveCredit(
  brand: Brand,
  env?: Env,
): { show: boolean; source: 'programa' | 'brand.json' | 'VITE_SHOW_BASE_CREDIT' };
export declare function resolveSupportEmail(
  brand: Brand,
  env?: Env,
): { email: string; source: 'brand.json' | 'VITE_SUPPORT_EMAIL' | null; warnings: string[] };
export declare function brandAssetUrl(name: string, options?: { dir?: string; hashes?: boolean }): string | null;
export declare function appBrand(brand: Brand, options?: { dir?: string; env?: Env; hashes?: boolean }): AppBrand;
export declare function escapeHtml(value: unknown): string;
export declare function brandHtml(html: string, brand: Brand, options?: { dir?: string; hashes?: boolean }): string;
export declare function brandWarnings(brand: Brand, options?: { dir?: string; env?: Env }): string[];
export declare function loadBrandState(options?: {
  root?: string;
  env?: Env;
  command?: 'serve' | 'build';
  isPreview?: boolean;
  customDir?: string;
}): {
  dir: string;
  custom: boolean;
  brand: Brand;
  app: AppBrand;
  credit: ReturnType<typeof resolveCredit>;
  warnings: string[];
  summary: string;
};
/** Middleware do servidor de desenvolvimento com CRM_BRAND_DIR: serve só os arquivos da pasta, pelo nome exato. */
export declare function brandDirMiddleware(
  dir: string,
): (
  request: { url?: string },
  response: { statusCode: number; setHeader(name: string, value: string): void; end(body?: Uint8Array): void },
  next: () => void,
) => void;
export declare function brandPlugin(): Plugin;
