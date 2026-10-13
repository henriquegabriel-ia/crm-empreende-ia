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
