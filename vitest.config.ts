import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { readPackageVersion } from './scripts/lib/app-version.mjs';
import { PROGRAM_BRAND, appBrand, normalizeBrand } from './scripts/lib/brand.mjs';

export default defineConfig({
  plugins: [react()],
  // Os testes usam sempre a marca do programa, sem o hash das imagens: trocar a marca da instância (public/brand) não
  // reprova nenhum teste (item 1.6, docs/arquitetura/1.6.md, seção 10).
  define: {
    __CRM_BRAND__: JSON.stringify(appBrand(normalizeBrand(PROGRAM_BRAND, { checkFiles: false }), { hashes: false })),
    // A versão do package.json, pela mesma leitura do build (item 1.7b): o rodapé da Ajuda nos testes é o do build.
    __CRM_VERSION__: JSON.stringify(readPackageVersion()),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Item 1.8: os testes do exemplo de docs/PERSONALIZAR rodam com os da base.
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.test.mjs',
      'docs/PERSONALIZAR/exemplos/**/*.test.{ts,tsx}',
    ],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
