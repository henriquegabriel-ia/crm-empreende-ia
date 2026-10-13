/**
 * Nome dos arquivos exportados (item 1.6): `base[-marca][-data].extensão`, como "contatos-acme.csv" e
 * "oportunidades-acme-2026-10-13.csv". Função pura, sem a marca da instância, para o Playwright importar sem o global
 * do build; nas telas, use `exportFileName`, de src/lib/brand.ts.
 */
export function buildExportFileName(exportName: string, base: string, extension: string, date?: string): string {
  return `${[base, exportName, date].filter(Boolean).join('-')}.${extension}`;
}
