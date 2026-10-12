/**
 * O CRM não tem modo offline: nada fica guardado para enviar depois. Sem conexão, as requisições ao Supabase são
 * recusadas na hora, com esta mensagem, em vez de esperar uma resposta que não vem.
 */
export const OFFLINE_BANNER_MESSAGE = 'Sem conexão. As alterações não serão salvas até a conexão voltar.';
export const OFFLINE_REQUEST_MESSAGE =
  'Sem conexão com a internet. Nada foi salvo nem enviado; tente novamente quando a conexão voltar.';
/** Na tela de entrada (entrar, cadastrar, link por e-mail e recuperar senha) não há o que salvar: só repetir. */
export const OFFLINE_AUTH_MESSAGE = 'Sem conexão com a internet. Conecte-se e tente de novo.';

export class OfflineRequestError extends Error {
  constructor() {
    super(OFFLINE_REQUEST_MESSAGE);
    this.name = 'OfflineRequestError';
  }
}

/** `navigator.onLine === false` é o único sinal confiável de falta de conexão; `true` não garante acesso ao servidor. */
export function browserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Reconhece a recusa por falta de conexão em qualquer formato que chegue à tela: o próprio erro, o objeto de erro do
 * PostgREST (que grava "OfflineRequestError: <mensagem>") ou o erro do Auth (que repete a mensagem).
 */
export function isOfflineRequestError(error: unknown): boolean {
  if (error instanceof OfflineRequestError) return true;
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : '';
  return message.includes(OFFLINE_REQUEST_MESSAGE);
}

/** Texto do erro do Auth na tela de entrada: sem conexão, a recusa pensada para gravações vira OFFLINE_AUTH_MESSAGE. */
export function authErrorMessage(error: { message: string }): string {
  return isOfflineRequestError(error) ? OFFLINE_AUTH_MESSAGE : error.message;
}
