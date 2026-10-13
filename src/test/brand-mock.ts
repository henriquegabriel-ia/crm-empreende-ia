import type { AppBrand } from '@/lib/brand';

/**
 * Marca fictícia dos testes de componentes (item 1.6), no formato do objeto que o build injeta. Os testes copiam estes
 * campos para o objeto que o `vi.mock('@/lib/brand')` entrega como BRAND e trocam os que precisam antes de renderizar.
 */
export const ACME_BRAND: Readonly<AppBrand> = Object.freeze({
  productName: 'Acme Soluções Comerciais · CRM',
  tagline: 'Vendas organizadas, clientes por perto.',
  supportEmail: 'suporte@acme.example',
  logoOnLight: '/brand/acme-logo-on-light.svg?v=11111111',
  logoOnDark: '/brand/acme-logo-on-dark.svg?v=22222222',
  icon: '/brand/acme-icon.svg?v=33333333',
  authImage: null,
  exportName: 'acme',
  baseCredit: true,
});

/** Volta o objeto da marca simulada à marca fictícia, com os campos trocados. */
export function resetMockBrand(target: Record<string, unknown>, overrides: Partial<AppBrand> = {}) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, ACME_BRAND, overrides);
}
