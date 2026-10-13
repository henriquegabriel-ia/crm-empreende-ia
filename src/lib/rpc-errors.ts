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
