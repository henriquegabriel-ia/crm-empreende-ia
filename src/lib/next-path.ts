/** Destino depois de entrar quando não há link a retomar: a tela Hoje. */
export const DEFAULT_AFTER_LOGIN = '/dashboard';

const MAX_NEXT_LENGTH = 2048;
const BASE = 'https://crm.invalid';

/**
 * Valida o destino guardado em ?next=: só caminhos internos, começando com uma única "/". Recusa URLs absolutas,
 * "//outro-site" e "/\outro-site" (que o navegador trata como outro site), caracteres de controle, textos muito longos
 * e a própria tela de entrada ("/"). Devolve o caminho normalizado (caminho, consulta e âncora) ou null.
 *
 * A regra vale também depois de normalizar: segmentos de ponto como "/.//outro-site", "/..//outro-site" e
 * "/%2e//outro-site" viram "//outro-site", que o React Router e o navegador tratam como outro site.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_NEXT_LENGTH) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return null;
  }
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || url.pathname === '/' || url.pathname.startsWith('//')) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Monta `path` com ?invite= e ?next=, este só quando for um caminho interno válido. Usado no retorno ao login, no
 * destino do convite e no link de confirmação por e-mail, para o deep link sobreviver a todo o fluxo de entrada.
 */
export function authPath(path: string, params: { invite?: string | null; next?: string | null }): string {
  const search = new URLSearchParams();
  if (params.invite) search.set('invite', params.invite);
  const next = safeNextPath(params.next);
  if (next) search.set('next', next);
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
