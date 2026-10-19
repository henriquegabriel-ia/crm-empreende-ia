#!/usr/bin/env node
// Gera supabase/base-manifest.json e supabase/db-drift-check.sql a partir das migrações (item 1.13; desenho em
// docs/arquitetura/1.13.md, seção 5), sem Docker, login ou psql: sobe o PostgreSQL 17 descartável de
// `scripts/lib/embedded-db.mjs`, aplica o bootstrap local e todas as migrações, lê private.base_fingerprints() e grava
// os dois arquivos (`scripts/lib/base-manifest.mjs`). Nunca aponte este script para um banco remoto.
// Uso:
//   npm run manifest:build   grava os arquivos (rode depois de criar ou alterar uma migração da base, junto do gen:types);
//   npm run manifest:check   gera e compara; sai com 1 se algum versionado estiver diferente ou ausente.
// O manifesto descreve só a base: as migrações <data>_custom_<nome>.sql de quem personaliza uma instância ficam de fora
// do cluster e da lista de migrações, e os objetos delas aparecem como extras no check (docs/PROTECAO-ATUALIZACAO.md).
// Numa instância personalizada, o build e o check dão o mesmo resultado que na base.
import { readdirSync } from 'node:fs';
import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DRIFT_CHECK_FILE,
  MANIFEST_FILE,
  ManifestError,
  baseRepositoryProblems,
  buildManifest,
  readBaseMigrationNames,
  renderDriftCheck,
  renderManifest,
  syncGeneratedFiles,
} from './lib/base-manifest.mjs';
import { MIGRATIONS_DIR, ROOT, TEMP_PREFIXES, isInterrupted, runWithEmbeddedDb } from './lib/embedded-db.mjs';

const USAGE = 'Uso: node scripts/build-base-manifest.mjs [--check]';
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--check')) {
  console.error(USAGE);
  process.exit(2);
}
const checkOnly = args.includes('--check');
let summary = '';

// No repositório da base (CRM_BASE_REPOSITORY=true), uma migração _custom_ é recusada antes de subir o banco (achado 3 da
// revisão do 1.13).
const baseProblems = baseRepositoryProblems(readdirSync(path.join(ROOT, MIGRATIONS_DIR)));
if (baseProblems.length) {
  console.error(baseProblems.join('\n'));
  process.exit(1);
}

// Falhas de leitura ou gravação (arquivo bloqueado pelo editor ou antivírus, sem permissão, disco cheio) viram
// ManifestError, para a mensagem apontar o arquivo e não o PostgreSQL temporário.
async function fileStep(description, action, hint) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    const lines = [`Não foi possível ${description}: ${error?.message ?? error}`];
    if (hint) lines.push(`  ${hint}`);
    throw new ManifestError(lines.join('\n'), { cause: error });
  }
}

async function readCurrent(relative) {
  try {
    return await readFile(path.join(ROOT, relative), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

// Grava num arquivo vizinho e troca de uma vez, para uma falha no meio não deixar o arquivo truncado.
async function writeAtomically(relative, content) {
  const file = path.join(ROOT, relative);
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
  tempPrefix: TEMP_PREFIXES.manifest,
  applicationName: 'crm-manifest',
  async run(db) {
    await db.applySchema({ baseOnly: true });
    console.log('Lendo private.base_fingerprints() e gerando o manifesto e o check de drift');
    const { rows, postgresMajor } = await db.withSession(async (client) => ({
      rows: (await client.query('select * from private.base_fingerprints()')).rows,
      postgresMajor: Math.trunc(
        Number((await client.query('show server_version_num')).rows[0].server_version_num) / 10000,
      ),
    }));
    const migrationFiles = await fileStep(`listar ${MIGRATIONS_DIR}`, () => readdir(path.join(ROOT, MIGRATIONS_DIR)));
    const manifest = buildManifest({ rows, migrationFiles, postgresMajor, baseMigrations: readBaseMigrationNames() });
    const files = [
      { path: MANIFEST_FILE, content: renderManifest(manifest) },
      { path: DRIFT_CHECK_FILE, content: renderDriftCheck(manifest) },
    ];
    summary = await syncGeneratedFiles({
      files,
      checkOnly,
      read: (relative) => fileStep(`ler ${relative}`, () => readCurrent(relative)),
      write: async (relative, content) => {
        // Interrompido (Ctrl+C) durante a geração: não grava nada; a saída segue com código 130.
        if (isInterrupted()) return;
        await fileStep(
          `gravar ${relative}`,
          () => writeAtomically(relative, content),
          'Confira se o arquivo não está bloqueado por outro programa (editor, antivírus) nem marcado como somente leitura e rode npm run manifest:build de novo.',
        );
      },
    });
    if (!checkOnly) summary += ` ${manifest.objects.length} objetos, ${manifest.migrations.length} migrações.`;
  },
  describeError: (error) => (error instanceof ManifestError ? [error.message] : undefined),
  successMessage: () => `\n${summary} Cluster temporário removido.`,
});
