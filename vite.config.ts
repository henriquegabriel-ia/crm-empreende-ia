import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { validCrmBackend } from './src/lib/backend-config';
import { brandPlugin } from './scripts/lib/brand.mjs';
import { deploymentEnvCheck } from './scripts/lib/deploy-env.mjs';
import { securityHeadersPlugin } from './scripts/lib/security-headers.mjs';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  // URL e chave pública do Supabase da instância; no build da Vercel (modo deployment), também https:// e coberta pela
  // CSP do vercel.json (item 1.3, scripts/lib/deploy-env.mjs).
  const { error, warnings } = deploymentEnvCheck(env, mode, { validBackend: validCrmBackend });
  for (const warning of warnings) console.warn(`Aviso: ${warning}`);
  if (error) throw new Error(error);
  return {
    server: {
      host: '::',
      port: 8080,
      hmr: {
        overlay: false,
      },
      // Pré-compila a entrada e as telas assim que o servidor sobe: a primeira visita de cada tela no E2E não espera a
      // transformação sob carga (achado 4 da revisão da Ajuda, item 1.2).
      warmup: { clientFiles: ['./src/main.tsx', './src/pages/*.tsx'] },
    },
    // Marca da instância (item 1.6): public/brand/brand.json vira __CRM_BRAND__ e o título e o favicon do index.html;
    // uma marca inválida faz o dev e o build falharem com a lista de problemas (scripts/lib/brand.mjs, docs/MARCA.md).
    // Cabeçalhos de segurança do vercel.json também no vite preview (item 1.3): o E2E roda com a CSP de verdade.
    plugins: [react(), brandPlugin(), securityHeadersPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
