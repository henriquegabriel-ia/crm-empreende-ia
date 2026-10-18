/**
 * Servidor do E2E (`npm run test:e2e`; item 1.11, docs/arquitetura/1.11.md, seção 12): build de produção no modo `e2e`
 * em E2E_OUT_DIR e `vite preview` em E2E_PORT, com o backend falso da fixture do Playwright. Chamado pelos webServer de
 * playwright.config.ts, que passam as variáveis VITE_ da fixture e, nos servidores da marca, CRM_BRAND_DIR (que só o
 * modo `e2e` aceita no build; scripts/lib/brand.mjs). dist/ (o build normal) não é tocado.
 *
 * Por que o build, e não o servidor de desenvolvimento: medido no achado 1 da revisão do item 1.10, o `vite dev` responde
 * cada carregamento com cerca de 175 módulos, e uma conexão falha de vez em quando sob três navegadores no Windows (a
 * página fica em branco); o build responde com 7 pedidos, sem nenhuma falha em 2.250 carregamentos. Para depurar com o
 * código ao vivo, `PLAYWRIGHT_DEV_SERVER=1` volta aos servidores de desenvolvimento.
 */
import { build, preview } from 'vite';

const port = Number(process.env.E2E_PORT ?? 8096);
const outDir = process.env.E2E_OUT_DIR ?? `dist-e2e/${port}`;

await build({ mode: 'e2e', logLevel: 'warn', build: { outDir, emptyOutDir: true } });
const server = await preview({
  mode: 'e2e',
  logLevel: 'warn',
  build: { outDir },
  preview: { host: '127.0.0.1', port, strictPort: true },
});
server.printUrls();
