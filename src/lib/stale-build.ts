import { browserOffline } from '@/lib/offline';

/**
 * Aba aberta durante uma publicação nova (item 1.7b; docs/arquitetura/1.7b.md, seção 8.3). A hospedagem troca todos os
 * arquivos de uma vez, e a reescrita do vercel.json devolve o index.html no lugar de um pedaço antigo do app: ao abrir
 * uma tela ainda não carregada, o import falha, e o Vite avisa com o evento `vite:preloadError`. Na primeira falha, a
 * página grava uma marca no sessionStorage e recarrega sozinha (e passa a usar a versão nova).
 *
 * Sem laço e sem relógio (achado 3 da revisão do 1.7b, corrigido no 1.7a; docs/arquitetura/1.7a.md, seção 13): toda
 * página **consome** a marca ao abrir (lê e apaga). A página que a encontrou nasceu do recarregamento e não recarrega de
 * novo, por mais lenta que seja a conexão ou por mais que o relógio do computador mude: a falha segue para a tela de
 * erro de sempre. Uma página aberta à mão depois (o botão Recarregar da tela de erro) já não acha a marca e volta a ter
 * direito a um recarregamento: no máximo duas cargas por clique. Sem conexão, não recarrega (o navegador trocaria o CRM
 * pela página de erro de rede dele): a tela de erro diz que está sem conexão. Sem sessionStorage (navegação privada
 * restrita), também não recarrega: sem a marca, não há como evitar um laço.
 */
export const STALE_BUILD_RELOAD_KEY = 'crm:stale-build-reload';

type MarkStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface StaleBuildOptions {
  /** Onde fica a marca do recarregamento; `null` quando o navegador não oferece sessionStorage. */
  storage?: MarkStorage | null;
  reload?: () => void;
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

/**
 * Lê e apaga a marca, no início da página: `true` quando esta página nasceu do recarregamento (a marca existia, com
 * qualquer valor, mesmo ilegível); `null` quando a marca não pode ser lida ou apagada (sem recarregamento, então).
 */
export function consumeStaleBuildMark(storage: MarkStorage | null | undefined): boolean | null {
  if (!storage) return null;
  try {
    const found = storage.getItem(STALE_BUILD_RELOAD_KEY) !== null;
    if (found) storage.removeItem(STALE_BUILD_RELOAD_KEY);
    return found;
  } catch {
    return null;
  }
}

/**
 * Decide, numa falha de carregamento de um pedaço do app, se recarrega: `true` quando gravou a marca e o chamador deve
 * recarregar; `false` quando esta página nasceu de um recarregamento (`bornFromReload`), quando a marca não pôde ser
 * lida no início (`null`) ou quando não pode ser gravada agora.
 */
export function shouldReloadForStaleBuild(
  storage: MarkStorage | null | undefined,
  bornFromReload: boolean | null,
): boolean {
  if (!storage || bornFromReload !== false) return false;
  try {
    storage.setItem(STALE_BUILD_RELOAD_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** Liga o recarregamento uma vez, em src/main.tsx, no início da página; devolve a função que desliga (para os testes). */
export function installStaleBuildReload({
  storage = sessionStorageOrNull(),
  reload = () => window.location.reload(),
  offline = browserOffline,
  target = window,
}: StaleBuildOptions = {}): () => void {
  const bornFromReload = consumeStaleBuildMark(storage);
  const onPreloadError = (event: Event) => {
    if (offline() || reloadRequested) return;
    if (!shouldReloadForStaleBuild(storage, bornFromReload)) return;
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
 * Envolve o import de uma tela lazy (src/App.tsx e as telas próprias de docs/PERSONALIZAR/TELA.md): quando o
 * recarregamento foi pedido, o import cancelado fica pendente em vez de entregar `undefined` ao React.lazy, que lançaria
 * um erro e mostraria "Algo deu errado" até a página trocar.
 */
export function holdWhileReloading<T>(load: () => Promise<T>): () => Promise<T> {
  return async () => {
    const loaded = await load();
    if (loaded === undefined && reloadRequested) return new Promise<T>(() => undefined);
    return loaded;
  };
}
