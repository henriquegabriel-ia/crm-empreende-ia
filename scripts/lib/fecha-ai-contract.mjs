// Contrato portátil da Fecha IA (roteiro 3.4; supabase/functions/README.md) no Node, sem Deno: o test:db confere as
// respostas reais do receptor (fechaAiReceiverChecks, em scripts/test-database.mjs) com os mesmos schemas e o mesmo hash
// que a Edge Function usa antes de responder. Os arquivos são os de supabase/functions/_shared/, iguais, byte a byte,
// aos do repositório da Fecha IA: aqui eles só são lidos. O TypeScript do projeto tira os tipos (transpileModule, sem
// conferência de tipos, que fica com o `deno check`), e o único import de valor, o de zod, aponta para o node_modules do
// CRM, na mesma versão do import map de supabase/functions/deno.json (fecha-ai-contract.test.mjs confere as duas).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CRM_CONTRACT_FILE = 'supabase/functions/_shared/crm-contract.ts';
export const CRM_CONTRACT_FIXTURES_FILE = 'supabase/functions/_shared/crm-contract-fixtures.ts';
export const FUNCTIONS_IMPORT_MAP_FILE = 'supabase/functions/deno.json';
const IMPORT = /\b(from|import)\s*(["'])([^"']+)\2/g;

/**
 * A entrada ES do zod instalado (exports["."].import): o endereço absoluto que o módulo carregado de um data: URL
 * consegue importar. Sem import.meta.resolve, que o Vitest não tem.
 */
function zodModuleUrl() {
  const manifest = createRequire(import.meta.url).resolve('zod/package.json');
  const entry = JSON.parse(readFileSync(manifest, 'utf8')).exports?.['.']?.import;
  if (typeof entry !== 'string') throw new Error('O zod instalado não tem a entrada ES (exports["."].import).');
  return pathToFileURL(path.join(path.dirname(manifest), entry)).href;
}

/** O JavaScript de um arquivo de _shared/, com o zod do node_modules. Recusa outro import de valor. */
export function sharedModuleSource(file, root = ROOT) {
  const source = readFileSync(path.join(root, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: path.basename(file),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const zod = zodModuleUrl();
  return outputText.replace(IMPORT, (statement, keyword, quote, specifier) => {
    if (specifier !== 'zod')
      throw new Error(`${file} importa ${specifier}; o carregamento no Node só conhece o zod (e imports só de tipo).`);
    return `${keyword} ${JSON.stringify(zod)}`;
  });
}

const loadShared = (file, root) =>
  import(`data:text/javascript;base64,${Buffer.from(sharedModuleSource(file, root), 'utf8').toString('base64')}`);

/** Os exports do contrato (schemas, parseCrmReviewEnvelope, assertCrm...MatchesEnvelope), como módulo ES. */
export const loadCrmContract = (root = ROOT) => loadShared(CRM_CONTRACT_FILE, root);

/** O vetor de conformidade do contrato (CRM_FIXTURE_CONTENT e CRM_FIXTURE_HASH). */
export const loadCrmContractFixtures = (root = ROOT) => loadShared(CRM_CONTRACT_FIXTURES_FILE, root);

/** A versão de zod do import map das funções (npm:zod@X.Y.Z), ou null. */
export function functionsZodVersion(root = ROOT) {
  const imports = JSON.parse(readFileSync(path.join(root, FUNCTIONS_IMPORT_MAP_FILE), 'utf8')).imports ?? {};
  return /^npm:zod@(\d+\.\d+\.\d+)$/.exec(imports.zod ?? '')?.[1] ?? null;
}
