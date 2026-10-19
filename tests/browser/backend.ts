/**
 * Backend fictício do E2E (item 1.3; docs/arquitetura/1.3.md, seção 9.3): o build aponta VITE_SUPABASE_URL para ele, e a
 * fixture (tests/browser/fixture.ts) responde cada pedido no navegador (page.route), antes do DNS. Um projeto real do
 * Supabase tem uma referência de 20 letras minúsculas, sem hífen: este host nunca existe, então um pedido que escapar da
 * interceptação falha no DNS em vez de ir para a porta de outro projeto. A CSP do vercel.json o cobre
 * (https://*.supabase.co), sem exceção nenhuma no E2E.
 */
export const FIXTURE_BACKEND = 'https://crm-e2e.supabase.co';
