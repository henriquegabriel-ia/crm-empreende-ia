/**
 * Versão da base em uso (item 1.7b; docs/arquitetura/1.7b.md, seção 8): a do package.json, conferida e injetada no
 * build pelo plugin crm-version (scripts/lib/app-version.mjs). Aparece no rodapé da "Ajuda do CRM"; a mesma versão vai
 * na meta crm-version da página, que o `npm run verify-instance` compara com o repositório.
 */
export const APP_VERSION: string = __CRM_VERSION__;
