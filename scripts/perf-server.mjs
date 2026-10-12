/**
 * Servidor do benchmark de desempenho (`npm run test:perf`, item 0.10 do roteiro): build de produção em dist-perf/ e
 * `vite preview`, com o backend falso da fixture do Playwright. Chamado pelo webServer de playwright.perf.config.ts,
 * que passa as variáveis VITE_ da fixture; dist/ (o build normal) não é tocado.
 */
import { build, preview } from 'vite';

const outDir = 'dist-perf';
const port = Number(process.env.PERF_PORT ?? 8097);

await build({ mode: 'production', logLevel: 'warn', build: { outDir, emptyOutDir: true } });
const server = await preview({
  logLevel: 'warn',
  build: { outDir },
  preview: { host: '127.0.0.1', port, strictPort: true },
});
server.printUrls();
