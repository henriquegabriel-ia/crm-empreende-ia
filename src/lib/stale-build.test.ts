import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STALE_BUILD_RELOAD_KEY,
  consumeStaleBuildMark,
  holdWhileReloading,
  installStaleBuildReload,
  shouldReloadForStaleBuild,
} from '@/lib/stale-build';

// Item 1.7b (docs/arquitetura/1.7b.md, seção 8.3): a aba aberta durante uma publicação recarrega uma vez quando um
// pedaço do app não carrega, e nunca entra em laço. Desde o 1.7a (achado 3 da revisão do 1.7b), sem relógio: a página
// consome a marca ao abrir, e os testes não têm `now` nem `pageStart` para combinar.
function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

// Desligar também limpa o estado do módulo (o recarregamento pedido), para um teste não vazar no seguinte.
const installed: Array<() => void> = [];
afterEach(() => installed.splice(0).forEach((uninstall) => uninstall()));

/** Uma carga de página: instala no início dela, com a mesma sessionStorage da aba. */
function load(storage: ReturnType<typeof memoryStorage> | null, offline = () => false) {
  const target = new EventTarget();
  const reload = vi.fn();
  const uninstall = installStaleBuildReload({ storage, reload, offline, target: target as unknown as Window });
  installed.push(uninstall);
  const fail = () => {
    const event = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  return { reload, fail, uninstall };
}

describe('recarregamento de uma aba antiga (item 1.7b, sem relógio desde o 1.7a)', () => {
  it('as três cargas: a falha recarrega; a nascida do recarregamento não; a aberta à mão depois recarrega de novo', () => {
    const storage = memoryStorage();
    // 1. A aba antiga: a falha grava a marca, impede o erro do Vite e recarrega.
    const first = load(storage);
    const event = first.fail();
    expect(event.defaultPrevented).toBe(true);
    expect(first.reload).toHaveBeenCalledTimes(1);
    expect(storage.values.get(STALE_BUILD_RELOAD_KEY)).toBe('1');
    first.uninstall();
    // 2. A página nascida do recarregamento consome a marca ao abrir; com o pedaço ainda falhando, a tela de erro.
    const second = load(storage);
    expect(storage.values.has(STALE_BUILD_RELOAD_KEY)).toBe(false);
    expect(second.fail().defaultPrevented).toBe(false);
    expect(second.reload).not.toHaveBeenCalled();
    second.uninstall();
    // 3. O Recarregar da tela de erro abre uma página sem a marca: ela volta a ter direito a um recarregamento.
    const third = load(storage);
    expect(third.fail().defaultPrevented).toBe(true);
    expect(third.reload).toHaveBeenCalledTimes(1);
  });

  it('com o pedaço falhando sempre, cada clique em Recarregar dá no máximo duas cargas, sem laço', () => {
    const storage = memoryStorage();
    let loads = 0;
    let reloads = 0;
    let reloaded = true;
    while (reloaded && loads < 10) {
      reloaded = false;
      loads += 1;
      const page = load(storage);
      page.fail();
      if (page.reload.mock.calls.length) {
        reloads += 1;
        reloaded = true;
      }
      page.uninstall();
    }
    expect(loads).toBe(2);
    expect(reloads).toBe(1);
  });

  it('na mesma página, uma segunda falha não recarrega de novo', () => {
    const { reload, fail } = load(memoryStorage());
    fail();
    expect(fail().defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('uma marca ilegível também conta como nascida do recarregamento, e é apagada', () => {
    const storage = memoryStorage({ [STALE_BUILD_RELOAD_KEY]: 'lixo' });
    const { reload, fail } = load(storage);
    expect(storage.values.has(STALE_BUILD_RELOAD_KEY)).toBe(false);
    expect(fail().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('sem conexão, não recarrega nem cancela o erro: a tela de erro diz que está sem conexão', () => {
    const storage = memoryStorage();
    const { reload, fail } = load(storage, () => true);
    expect(fail().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.values.has(STALE_BUILD_RELOAD_KEY)).toBe(false);
  });

  it('sem sessionStorage, ou com ele recusando a leitura, a remoção ou a gravação, não recarrega', () => {
    const noStorage = load(null);
    expect(noStorage.fail().defaultPrevented).toBe(false);
    expect(noStorage.reload).not.toHaveBeenCalled();
    expect(consumeStaleBuildMark(null)).toBeNull();
    const unreadable = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(consumeStaleBuildMark(unreadable)).toBeNull();
    expect(shouldReloadForStaleBuild(unreadable, null)).toBe(false);
    const stuck = {
      getItem: () => '1',
      setItem: () => undefined,
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(consumeStaleBuildMark(stuck)).toBeNull();
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(consumeStaleBuildMark(full)).toBe(false);
    expect(shouldReloadForStaleBuild(full, false)).toBe(false);
  });

  it('desligar remove o ouvinte', () => {
    const { reload, fail, uninstall } = load(memoryStorage());
    uninstall();
    expect(fail().defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('o import cancelado fica pendente durante o recarregamento, sem a tela de erro do React.lazy', async () => {
    const page = { default: 'Contatos' };
    expect(await holdWhileReloading(async () => page)()).toBe(page);
    // Sem recarregamento pedido, o `undefined` segue (e o React.lazy mostra o erro, como antes).
    expect(await holdWhileReloading(async () => undefined)()).toBeUndefined();
    const { fail } = load(memoryStorage());
    fail();
    let settled = false;
    void holdWhileReloading(async () => undefined)().then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
  });
});

// Achado 1 da revisão do 1.7b (corrigido no 1.7a): toda tela lazy de src/App.tsx passa por holdWhileReloading.
describe('as telas lazy de src/App.tsx', () => {
  it('todo lazy( passa por holdWhileReloading', () => {
    const app = readFileSync(path.resolve(__dirname, '..', 'App.tsx'), 'utf8');
    const calls = [...app.matchAll(/\blazy\(([^\n]*)/g)].map((match) => match[1]);
    expect(calls.length).toBeGreaterThan(10);
    for (const call of calls) expect(call).toMatch(/^holdWhileReloading\(\(\) => import\(/);
  });
});
