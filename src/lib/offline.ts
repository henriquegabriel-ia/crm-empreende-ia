/**
 * O CRM não tem modo offline: nada fica guardado para enviar depois. Sem conexão, as requisições ao Supabase são
 * recusadas na hora, com esta mensagem, em vez de esperar uma resposta que não vem.
 */
export const OFFLINE_BANNER_MESSAGE = 'Sem conexão. As alterações não serão salvas até a conexão voltar.';
export const OFFLINE_REQUEST_MESSAGE =
  'Sem conexão com a internet. Nada foi salvo nem enviado; tente novamente quando a conexão voltar.';
/**
 * Na tela de entrada (entrar, cadastrar, link por e-mail e recuperar senha) não há o que salvar: só repetir. Usada por
 * authErrorMessage (src/lib/auth-errors.ts), que traduz os demais erros do Auth.
 */
export const OFFLINE_AUTH_MESSAGE = 'Sem conexão com a internet. Conecte-se e tente de novo.';
/**
 * A tela de erro (src/components/ErrorBoundary.tsx) sem conexão: uma tela ainda não aberta não carrega, e "Recarregar"
 * só volta quando a conexão voltar (achado 4 da revisão do 1.7b, corrigido no 1.7a).
 */
export const OFFLINE_ERROR_TITLE = 'Esta tela não abriu sem conexão';
export const OFFLINE_ERROR_TEXT = 'Confira a internet. Quando a conexão voltar, use Recarregar.';
/** A mesma tela quando a conexão volta: o erro foi a falta de conexão, e não um erro inesperado. */
export const OFFLINE_ERROR_BACK_TITLE = 'A conexão voltou';
export const OFFLINE_ERROR_BACK_TEXT = 'Use Recarregar para abrir a tela.';

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
