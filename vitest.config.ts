import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { PROGRAM_BRAND, appBrand, normalizeBrand } from './scripts/lib/brand.mjs';

export default defineConfig({
  plugins: [react()],
  // Os testes usam sempre a marca do programa, sem o hash das imagens: trocar a marca da instância (public/brand) não
  // reprova nenhum teste (item 1.6, docs/arquitetura/1.6.md, seção 10).
  define: {
    __CRM_BRAND__: JSON.stringify(appBrand(normalizeBrand(PROGRAM_BRAND, { checkFiles: false }), { hashes: false })),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
