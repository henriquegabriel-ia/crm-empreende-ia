import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STALE_BUILD_RELOAD_KEY,
  STALE_BUILD_RELOAD_WINDOW_MS,
  holdWhileReloading,
  installStaleBuildReload,
  shouldReloadForStaleBuild,
} from '@/lib/stale-build';

// Item 1.7b (docs/arquitetura/1.7b.md, seção 8.3): a aba aberta durante uma publicação recarrega uma vez quando um
// pedaço do app não carrega, e nunca entra em laço.
function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

// Desligar também limpa o estado do módulo (o recarregamento pedido), para um teste não vazar no seguinte.
const installed: Array<() => void> = [];
afterEach(() => installed.splice(0).forEach((uninstall) => uninstall()));

function setup(
  options: { storage?: ReturnType<typeof memoryStorage> | null; start?: number; offline?: () => boolean } = {},
) {
  const target = new EventTarget();
  const reload = vi.fn();
  // A página começou a carregar 500 ms antes da primeira falha.
  let clock = options.start ?? 1_000_000;
  const storage = options.storage === undefined ? memoryStorage() : options.storage;
  const uninstall = installStaleBuildReload({
    storage,
    reload,
    now: () => clock,
    pageStart: clock - 500,
    offline: options.offline ?? (() => false),
    target: target as unknown as Window,
  });
  installed.push(uninstall);
  const fail = () => {
    const event = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  return { reload, fail, storage, uninstall, advance: (ms: number) => (clock += ms) };
}

describe('recarregamento de uma aba antiga (item 1.7b)', () => {
  it('na primeira falha, grava a marca, impede o erro do Vite e recarrega', () => {
    const { reload, fail, storage } = setup();
    const event = fail();
    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage?.values.get(STALE_BUILD_RELOAD_KEY)).toBe('1000000');
  });

  it('uma segunda falha em menos de 10 s segue para a tela de erro, sem novo recarregamento', () => {
    const { reload, fail, advance } = setup();
    fail();
    advance(STALE_BUILD_RELOAD_WINDOW_MS - 1);
    const second = fail();
    expect(second.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a marca de um recarregamento anterior, na mesma aba, vale depois do recarregamento (a página nova)', () => {
    const storage = memoryStorage({ [STALE_BUILD_RELOAD_KEY]: String(1_000_000 - 2_000) });
    const { reload, fail } = setup({ storage });
    expect(fail().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('na mesma página, não recarrega de novo nem depois de 10 s (no máximo uma vez por carga)', () => {
    const { reload, fail, advance } = setup();
    fail();
    advance(STALE_BUILD_RELOAD_WINDOW_MS * 6);
    expect(fail().defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('numa página aberta depois, sem relação com o recarregamento anterior, uma nova publicação recarrega de novo', () => {
    // A marca é de mais de 10 s antes do início desta página: ela não nasceu daquele recarregamento.
    const storage = memoryStorage({
      [STALE_BUILD_RELOAD_KEY]: String(1_000_000 - 500 - STALE_BUILD_RELOAD_WINDOW_MS - 1),
    });
    const { reload, fail } = setup({ storage });
    expect(fail().defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('com a conexão lenta (mais de 10 s entre o recarregamento e a nova falha), não entra em laço', () => {
    // Achado da revisão do 1.7b: o pedaço falha sempre e cada carga leva 12 s até a falha. Uma carga nova só existe
    // quando a anterior recarregou (a mesma aba, a mesma sessionStorage); sem laço, a segunda já não recarrega.
    const storage = memoryStorage();
    let clock = 1_000_000;
    let reloads = 0;
    let loads = 0;
    let reloaded = true;
    while (reloaded && loads < 5) {
      reloaded = false;
      loads += 1;
      const target = new EventTarget();
      const pageStart = clock;
      clock += 12_000;
      const uninstall = installStaleBuildReload({
        storage,
        reload: () => {
          reloads += 1;
          reloaded = true;
        },
        now: () => clock,
        pageStart,
        offline: () => false,
        target: target as unknown as Window,
      });
      target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
      uninstall();
      clock += 50;
    }
    expect(loads).toBe(2);
    expect(reloads).toBe(1);
  });

  it('sem conexão, não recarrega nem cancela o erro: a tela de erro e o aviso de sem conexão aparecem', () => {
    const { reload, fail, storage } = setup({ offline: () => true });
    expect(fail().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(storage?.values.has(STALE_BUILD_RELOAD_KEY)).toBe(false);
  });

  it('sem sessionStorage, ou com ele recusando a leitura ou a gravação, não recarrega', () => {
    const noStorage = setup({ storage: null });
    expect(noStorage.fail().defaultPrevented).toBe(false);
    expect(noStorage.reload).not.toHaveBeenCalled();
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    expect(shouldReloadForStaleBuild(throwing, 5)).toBe(false);
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(shouldReloadForStaleBuild(full, 5)).toBe(false);
  });

  it('uma marca inválida não impede o recarregamento, e desligar remove o ouvinte', () => {
    const storage = memoryStorage({ [STALE_BUILD_RELOAD_KEY]: 'lixo' });
    const { reload, fail, uninstall } = setup({ storage });
    expect(fail().defaultPrevented).toBe(true);
    uninstall();
    fail();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('o import cancelado fica pendente durante o recarregamento, sem a tela de erro do React.lazy', async () => {
    const page = { default: 'Contatos' };
    expect(await holdWhileReloading(async () => page)()).toBe(page);
    // Sem recarregamento pedido, o `undefined` segue (e o React.lazy mostra o erro, como antes).
    expect(await holdWhileReloading(async () => undefined)()).toBeUndefined();
    const { fail } = setup();
    fail();
    let settled = false;
    void holdWhileReloading(async () => undefined)().then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
  });
});
