/// <reference types="vite/client" />

/** Marca da instância, injetada pelo plugin crm-brand (scripts/lib/brand.mjs). Use `BRAND`, de src/lib/brand.ts. */
declare const __CRM_BRAND__: import('./lib/brand').AppBrand;

/** Versão da base (SemVer), injetada pelo plugin crm-version (scripts/lib/app-version.mjs). Use `APP_VERSION`. */
declare const __CRM_VERSION__: string;
