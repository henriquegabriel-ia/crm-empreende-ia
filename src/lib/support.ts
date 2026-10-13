import { BRAND } from '@/lib/brand';

/**
 * E-mail de suporte desta instância: o "supportEmail" de public/brand/brand.json (item 1.6). VITE_SUPPORT_EMAIL ficou
 * obsoleta e só vale como recuo, com aviso no build (scripts/lib/brand.mjs). Vazio esconde "Falar com suporte".
 */
export const SUPPORT_EMAIL = BRAND.supportEmail;
