#!/usr/bin/env node
// Gera src/integrations/supabase/database.types.ts a partir das migrações, sem Docker, login ou psql:
// sobe o PostgreSQL 17 descartável de `scripts/lib/embedded-db.mjs`, aplica o bootstrap local e todas as
// migrações, lê o schema `public` pelo pg_catalog e grava o tipo `Database` no formato de
// `supabase gen types typescript` (ver `scripts/lib/typegen.mjs`).
// Uso:
//   npm run gen:types         grava o arquivo (rode depois de criar ou alterar uma migração);
//   npm run gen:types:check   gera num arquivo temporário e compara; sai com 1 se o versionado estiver diferente.
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, TEMP_PREFIXES, isInterrupted, runWithEmbeddedDb, toDisplayPath } from './lib/embedded-db.mjs';
import { generateDatabaseTypes, introspectSchema } from './lib/typegen.mjs';

const OUTPUT_FILE = path.join(ROOT, 'src/integrations/supabase/database.types.ts');
const SCHEMA = 'public';
const USAGE = 'Uso: node scripts/generate-types.mjs [--check]';

class TypegenError extends Error {}

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--check')) {
  console.error(USAGE);
  process.exit(2);
}
const checkOnly = args.includes('--check');
const normalize = (text) => text.replace(/\r\n/g, '\n');
let summary = '';

// Primeira linha diferente, para a mensagem de erro apontar onde olhar.
function firstDifference(expected, actual) {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < length; index += 1) {
    if (expectedLines[index] !== actualLines[index])
      return [
        `  Primeira diferença na linha ${index + 1}:`,
        `    gerado:     ${expectedLines[index] ?? '(fim do arquivo)'}`,
        `    versionado: ${actualLines[index] ?? '(fim do arquivo)'}`,
      ];
  }
  return [];
}

// Falhas de leitura ou gravação (arquivo bloqueado pelo editor ou antivírus, sem permissão, disco cheio)
// viram TypegenError, para a mensagem apontar o arquivo e não o PostgreSQL temporário.
async function fileStep(description, action, hint) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof TypegenError) throw error;
    const lines = [`Não foi possível ${description}: ${error?.message ?? error}`];
    if (hint) lines.push(`  ${hint}`);
    throw new TypegenError(lines.join('\n'), { cause: error });
  }
}

async function readCurrent(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

// Grava num arquivo vizinho e troca de uma vez, para uma falha no meio não deixar o arquivo truncado.
async function writeAtomically(file, content) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

await runWithEmbeddedDb({
  tempPrefix: TEMP_PREFIXES.genTypes,
  applicationName: 'crm-gen-types',
  async run(db) {
    await db.applySchema();
    console.log(`Lendo o schema ${SCHEMA} e gerando os tipos`);
    let meta;
    let generated;
    try {
      meta = await db.withSession((client) => introspectSchema(client, SCHEMA));
      generated = await generateDatabaseTypes(meta);
    } catch (error) {
      throw new TypegenError(`Falha ao ler o schema ${SCHEMA} ou gerar os tipos: ${error?.message ?? error}`, {
        cause: error,
      });
    }
    const target = toDisplayPath(OUTPUT_FILE);
    const current = await fileStep(`ler ${target}`, () => readCurrent(OUTPUT_FILE));

    if (checkOnly) {
      // Grava num arquivo temporário e compara com o versionado (quebras de linha normalizadas para LF).
      const directory = await fileStep('criar o diretório temporário da comparação', () =>
        mkdtemp(path.join(tmpdir(), 'crm-gen-types-check-')),
      );
      try {
        const fresh = await fileStep('gravar o arquivo temporário da comparação', async () => {
          const temporary = path.join(directory, 'database.types.ts');
          await writeFile(temporary, generated, 'utf8');
          return normalize(await readFile(temporary, 'utf8'));
        });
        if (current === null)
          throw new TypegenError(`${target} não existe. Rode npm run gen:types e faça commit do arquivo.`);
        if (fresh !== normalize(current)) {
          throw new TypegenError(
            [
              `${target} está diferente do que as migrações geram (arquivo editado à mão ou migração sem tipos).`,
              ...firstDifference(fresh, normalize(current)),
              '  Rode npm run gen:types e faça commit do arquivo gerado. Não edite database.types.ts à mão.',
            ].join('\n'),
          );
        }
      } finally {
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
      }
      summary = `${target} está em dia com as migrações.`;
      return;
    }

    if (current !== null && normalize(current) === generated) {
      summary = `${target} já estava em dia; nada mudou.`;
      return;
    }
    // Interrompido (Ctrl+C) durante a geração: não grava nada; a saída segue com código 130.
    if (isInterrupted()) return;
    await fileStep(
      `gravar ${target}`,
      () => writeAtomically(OUTPUT_FILE, generated),
      'Confira se o arquivo não está bloqueado por outro programa (editor, antivírus) nem marcado como somente leitura e rode npm run gen:types de novo.',
    );
    summary = `${target} gravado (${meta.relations.length} tabelas e views, ${meta.functions.length} funções).`;
  },
  describeError: (error) => (error instanceof TypegenError ? [error.message] : undefined),
  successMessage: () => `\n${summary} Cluster temporário removido.`,
});
