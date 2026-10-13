import { buildExportFileName } from '@/lib/export-file-name';

/**
 * Marca da instância (item 1.6; docs/arquitetura/1.6.md): vem de public/brand/brand.json, validada e injetada no build
 * pelo plugin crm-brand (scripts/lib/brand.mjs). Nenhum componente escreve o nome, o slogan ou o caminho de uma imagem
 * da marca: use `BRAND`, `exportFileName` e o `BrandFooter` (o teste src/test/brand-literals.test.ts confere).
 */
export interface AppBrand {
  productName: string;
  tagline: string;
  /** E-mail de suporte efetivo: o do brand.json ou, como recuo obsoleto, VITE_SUPPORT_EMAIL. */
  supportEmail: string;
  /** Endereços em /brand, com `?v=` do conteúdo do arquivo; `null` quando o campo está vazio. */
  logoOnLight: string | null;
  logoOnDark: string | null;
  icon: string | null;
  authImage: string | null;
  exportName: string;
  /** Mostra o crédito "Feito com Empreende.IA" (nunca com a marca do programa; VITE_SHOW_BASE_CREDIT sobrepõe). */
  baseCredit: boolean;
}

export const BRAND: AppBrand = __CRM_BRAND__;

/** Crédito da base (D3), igual ao de scripts/lib/brand.mjs e ao dos e-mails do Auth (o teste confere). */
export const BASE_CREDIT_TEXT = 'Feito com Empreende.IA';

/** Primeira letra ou dígito do nome, em maiúscula, para o ícone de uma marca sem imagem; "C" (de CRM) sem nenhuma. */
export function brandMonogram(name: string = BRAND.productName): string {
  const first = name.normalize('NFD').match(/[\p{L}\p{N}]/u)?.[0];
  return first ? first.toLocaleUpperCase('pt-BR') : 'C';
}

/** Nome de um arquivo exportado com a marca da instância: exportFileName('contatos', 'csv') = "contatos-acme.csv". */
export function exportFileName(base: string, extension: string, date?: string): string {
  return buildExportFileName(BRAND.exportName, base, extension, date);
}
