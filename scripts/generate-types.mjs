#!/usr/bin/env node
// Gera src/integrations/supabase/database.types.ts a partir das migrações, sem Docker, login ou psql:
// sobe o PostgreSQL 17 descartável de `scripts/lib/embedded-db.mjs`, aplica o bootstrap local e todas as
// migrações, lê o schema `public` pelo pg_catalog e grava o tipo `Database` no formato de
// `supabase gen types typescript` (ver `scripts/lib/typegen.mjs`).
// Item 1.8: grava também docs/PERSONALIZAR/exemplos/database.types.ts, com as migrações da base e as do exemplo de
// docs/PERSONALIZAR num banco à parte do mesmo cluster (`TYPE_TARGETS`): o guia mostra o tipo que o aluno ganha, e o
// typecheck do exemplo usa esse arquivo. Toda migração da base regera os dois.
// Uso:
//   npm run gen:types         grava os arquivos (rode depois de criar ou alterar uma migração);
//   npm run gen:types:check   gera em arquivos temporários e compara; sai com 1 se um versionado estiver diferente.
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, TEMP_PREFIXES, isInterrupted, runWithEmbeddedDb, toDisplayPath } from './lib/embedded-db.mjs';
import { TYPE_TARGETS, generateDatabaseTypes, introspectSchema, staleTypesProblem } from './lib/typegen.mjs';

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
const summary = [];

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

// O banco de cada arquivo: o principal com todas as migrações (como sempre); o do exemplo, à parte, só com as da base
// (sem as `_custom_` desta instância) e as do exemplo no fim.
async function prepareDatabase(db, target) {
  if (!target.database) {
    await db.applySchema();
    return;
  }
  const directory = path.join(ROOT, target.exampleMigrations);
  const extraMigrations = (await readdir(directory))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => path.join(directory, name));
  await db.createDatabase(target.database);
  await db.applySchema({ database: target.database, baseOnly: true, quiet: true, extraMigrations });
}

async function syncTarget(db, target, directory) {
  const outputFile = path.join(ROOT, target.file);
  const display = toDisplayPath(outputFile);
  await prepareDatabase(db, target);
  console.log(`Lendo o schema ${SCHEMA} e gerando ${display}`);
  let meta;
  let generated;
  try {
    meta = await db.withSession((client) => introspectSchema(client, SCHEMA), { database: target.database });
    generated = await generateDatabaseTypes(meta, target.header);
  } catch (error) {
    throw new TypegenError(`Falha ao ler o schema ${SCHEMA} ou gerar os tipos: ${error?.message ?? error}`, {
      cause: error,
    });
  }
  const current = await fileStep(`ler ${display}`, () => readCurrent(outputFile));

  if (checkOnly) {
    // Grava num arquivo temporário e compara com o versionado (quebras de linha normalizadas para LF).
    const fresh = await fileStep('gravar o arquivo temporário da comparação', async () => {
      const temporary = path.join(directory, `${target.database ?? 'base'}.database.types.ts`);
      await writeFile(temporary, generated, 'utf8');
      return normalize(await readFile(temporary, 'utf8'));
    });
    const problem = staleTypesProblem({ target: display, generated: fresh, current });
    if (problem) throw new TypegenError(problem);
    summary.push(`${display} está em dia com as migrações.`);
    return;
  }

  if (current !== null && normalize(current) === generated) {
    summary.push(`${display} já estava em dia; nada mudou.`);
    return;
  }
  // Interrompido (Ctrl+C) durante a geração: não grava nada; a saída segue com código 130.
  if (isInterrupted()) return;
  await fileStep(
    `gravar ${display}`,
    () => writeAtomically(outputFile, generated),
    'Confira se o arquivo não está bloqueado por outro programa (editor, antivírus) nem marcado como somente leitura e rode npm run gen:types de novo.',
  );
  summary.push(`${display} gravado (${meta.relations.length} tabelas e views, ${meta.functions.length} funções).`);
}

await runWithEmbeddedDb({
  tempPrefix: TEMP_PREFIXES.genTypes,
  applicationName: 'crm-gen-types',
  async run(db) {
    const directory = checkOnly
      ? await fileStep('criar o diretório temporário da comparação', () =>
          mkdtemp(path.join(tmpdir(), 'crm-gen-types-check-')),
        )
      : null;
    try {
      for (const target of TYPE_TARGETS) {
        await syncTarget(db, target, directory);
        if (isInterrupted()) return;
      }
    } finally {
      if (directory)
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  },
  describeError: (error) => (error instanceof TypegenError ? [error.message] : undefined),
  successMessage: () => `\n${summary.join('\n')} Cluster temporário removido.`,
});
