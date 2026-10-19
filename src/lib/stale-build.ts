import { browserOffline } from '@/lib/offline';

/**
 * Aba aberta durante uma publicação nova (item 1.7b; docs/arquitetura/1.7b.md, seção 8.3). A hospedagem troca todos os
 * arquivos de uma vez, e a reescrita do vercel.json devolve o index.html no lugar de um pedaço antigo do app: ao abrir
 * uma tela ainda não carregada, o import falha, e o Vite avisa com o evento `vite:preloadError`. Na primeira falha, a
 * página recarrega sozinha (e passa a usar a versão nova). Recarrega no máximo uma vez por carga de página: a página
 * aberta por esse recarregamento (marca gravada até 10 s antes do início dela) não recarrega de novo, por mais lenta
 * que seja a conexão, e a falha segue para a tela de erro de sempre, sem laço. Sem conexão, não recarrega (o navegador
 * trocaria o CRM pela página de erro de rede dele): a tela de erro e o aviso de sem conexão do item 0.9 aparecem. Sem
 * sessionStorage (navegação privada restrita), também não recarrega: sem a marca, não há como evitar um laço.
 */
export const STALE_BUILD_RELOAD_KEY = 'crm:stale-build-reload';
export const STALE_BUILD_RELOAD_WINDOW_MS = 10_000;

interface StaleBuildOptions {
  /** Onde fica a marca do último recarregamento; `null` quando o navegador não oferece sessionStorage. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload?: () => void;
  now?: () => number;
  /** Instante (ms desde 1970) em que a carga desta página começou: `performance.timeOrigin`. */
  pageStart?: number;
  offline?: () => boolean;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

// Ligada quando o recarregamento foi pedido: o import cancelado espera a página nova (holdWhileReloading).
let reloadRequested = false;

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function currentPageStart(): number {
  return typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)
    ? performance.timeOrigin
    : Date.now();
}

/**
 * Decide, numa falha de carregamento de um pedaço do app, se recarrega: `true` quando gravou a marca e o chamador deve
 * recarregar; `false` quando esta página já recarregou ou nasceu de um recarregamento (marca a partir de 10 s antes do
 * início dela) ou quando a marca não pode ser lida ou gravada.
 */
export function shouldReloadForStaleBuild(
  storage: StaleBuildOptions['storage'],
  now: number,
  pageStart: number = currentPageStart(),
): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(STALE_BUILD_RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && last >= pageStart - STALE_BUILD_RELOAD_WINDOW_MS) return false;
    storage.setItem(STALE_BUILD_RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Liga o recarregamento uma vez, em src/main.tsx; devolve a função que desliga (para os testes). */
export function installStaleBuildReload({
  storage = sessionStorageOrNull(),
  reload = () => window.location.reload(),
  now = () => Date.now(),
  pageStart = currentPageStart(),
  offline = browserOffline,
  target = window,
}: StaleBuildOptions = {}): () => void {
  const onPreloadError = (event: Event) => {
    if (offline()) return;
    if (!shouldReloadForStaleBuild(storage, now(), pageStart)) return;
    // Cancelado, o Vite não relança o erro e o import resolve com `undefined`; holdWhileReloading segura a tela no
    // "Carregando tela…" até o documento novo, sem passar pela tela de erro.
    event.preventDefault();
    reloadRequested = true;
    reload();
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => {
    target.removeEventListener('vite:preloadError', onPreloadError);
    reloadRequested = false;
  };
}

/**
 * Envolve o import de uma tela lazy (src/App.tsx): quando o recarregamento foi pedido, o import cancelado fica pendente
 * em vez de entregar `undefined` ao React.lazy, que lançaria um erro e mostraria "Algo deu errado" até a página trocar.
 */
export function holdWhileReloading<T>(load: () => Promise<T>): () => Promise<T> {
  return async () => {
    const loaded = await load();
    if (loaded === undefined && reloadRequested) return new Promise<T>(() => undefined);
    return loaded;
  };
}
