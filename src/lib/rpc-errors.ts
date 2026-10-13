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
