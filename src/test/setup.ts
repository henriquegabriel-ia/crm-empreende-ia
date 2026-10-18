import '@testing-library/jest-dom';

// Os testes dos scripts que carregam o Vite (scripts/lib/brand.test.mjs) rodam no ambiente node, sem window.
if (typeof window !== 'undefined')
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

// A caixa de marcar e os botões de opção do Radix medem o tamanho com ResizeObserver, que o jsdom não tem. Sem medir
// nada, os controles funcionam como no navegador (item 1.10: "Já aconteceu" e a próxima ação usam a caixa).
if (typeof window !== 'undefined' && !('ResizeObserver' in globalThis))
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
