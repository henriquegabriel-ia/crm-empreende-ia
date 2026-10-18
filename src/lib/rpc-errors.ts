import { isOfflineRequestError, OFFLINE_REQUEST_MESSAGE } from '@/lib/offline';

/**
 * Recusa explicada pelo banco: as RPCs da base recusam com `raise exception` (código P0001) e a mensagem em pt-BR, que
 * a tela mostra como está. Sem conexão, a mensagem de sempre. As demais falhas (permissão, rede, função ausente num
 * banco ainda sem a migração) viram `fallback`, sem texto técnico em inglês.
 */
export function rpcRefusalMessage(error: unknown, fallback: string): string {
  if (isOfflineRequestError(error)) return OFFLINE_REQUEST_MESSAGE;
  if (typeof error !== 'object' || error === null) return fallback;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === 'P0001' && typeof message === 'string' && message.trim() ? message : fallback;
}

/** Item 1.9: o frontend novo num banco ainda sem a migração dos canais. */
export const CHANNELS_MIGRATION_MISSING =
  'Este CRM ainda não tem a atualização dos canais. Peça a quem administra para aplicar a migração mais recente.';

/**
 * Sinais de um banco sem 20261013110000_channel_interactions.sql: a RPC complete_activity ausente (PGRST202), uma
 * coluna nova ausente (outcome, do_not_contact: PGRST204 no cache do PostgREST ou 42703) ou o CHECK antigo de tipo
 * recusando WhatsApp e visita (23514 em activities_type_check).
 */
export function channelsMigrationMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === 'PGRST202' || code === 'PGRST204' || code === '42703') return true;
  return code === '23514' && typeof message === 'string' && message.includes('activities_type_check');
}

/** Item 1.10: o frontend novo num banco ainda sem a migração de privacidade (LGPD). */
export const PRIVACY_MIGRATION_MISSING =
  'Este CRM ainda não tem a atualização de privacidade (LGPD). Peça a quem administra para aplicar a migração mais recente.';

/** Nomes que só existem com 20261013120000_contact_privacy.sql: as colunas, a tabela e as três RPCs. */
const PRIVACY_OBJECTS = /legal_basis|anonymiz|privacy_actions|contact_privacy_summary|export_contact_data/;

/**
 * Sinais de um banco sem 20261013120000_contact_privacy.sql: uma RPC de privacidade ausente (PGRST202), uma coluna nova
 * ausente (legal_basis, anonymized_at, default_legal_basis: PGRST204 no cache do PostgREST ou 42703) ou a tabela
 * privacy_actions ausente (PGRST205 ou 42P01). A mensagem precisa citar um desses nomes: a mesma falha em outra coluna
 * não é a migração de privacidade.
 */
export function privacyMigrationMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (!['PGRST202', 'PGRST204', 'PGRST205', '42703', '42P01'].includes(String(code))) return false;
  return typeof message === 'string' && PRIVACY_OBJECTS.test(message);
}

/** Item 1.16: o frontend novo num banco ainda sem a migração do catálogo (20261019100000_product_catalog.sql). */
export const CATALOG_MIGRATION_MISSING =
  'Este CRM ainda não tem a atualização do catálogo. Peça a quem administra para aplicar a migração mais recente.';

/** Nomes que só existem com a migração do catálogo: as tabelas, a RPC e as colunas novas de deals. */
const CATALOG_OBJECTS = /products|deal_items|save_deal|item_count|one_time_value|monthly_value|contract_months/;

/**
 * Sinais de um banco sem 20261019100000_product_catalog.sql: a tabela products ou deal_items ausente (42P01 ou
 * PGRST205), a RPC save_deal ausente (PGRST202) ou uma coluna nova de deals ausente (PGRST204 ou 42703). A mensagem
 * precisa citar um desses nomes: a mesma falha em outro objeto não é a migração do catálogo.
 */
export function catalogMigrationMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (!['PGRST202', 'PGRST204', 'PGRST205', '42703', '42P01'].includes(String(code))) return false;
  return typeof message === 'string' && CATALOG_OBJECTS.test(message);
}
