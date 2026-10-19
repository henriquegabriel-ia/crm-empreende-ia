#!/usr/bin/env node
// Restaura um backup do CRM num projeto Supabase NOVO (item 1.5; guia em docs/BACKUP-RESTAURACAO.md, desenho em
// docs/arquitetura/1.5.md, seção 6). Windows, macOS e Linux, sem psql, Docker nem PostgreSQL instalado.
//
// Antes: projeto novo, o repositório na versão de migrações do backup, `npx supabase link` e `npx supabase db push`, e o
// arquivo crm-backup-<data>.7z extraído (com a senha) numa pasta fora do repositório.
//
// Uso (PowerShell), colando a conexão do Session pooler do projeto NOVO quando o Read-Host pedir (assim ela não fica no
// histórico do terminal, que o PSReadLine grava em arquivo):
//   $env:CRM_RESTORE_DB_URL = Read-Host 'Cole a conexão'
//   npm run backup:restore -- --dir "$env:USERPROFILE\crm-restauracao" --confirm <ref do projeto novo>
//   npm run backup:restore -- --dir "$env:USERPROFILE\crm-restauracao" --confirm <ref do projeto novo> --apply
//   Remove-Item Env:CRM_RESTORE_DB_URL
// No macOS e no Linux: read -rs CRM_RESTORE_DB_URL && export CRM_RESTORE_DB_URL, no começo, e unset CRM_RESTORE_DB_URL,
// no fim (o resto é igual).
// Sem --apply, grava tudo, confere e desfaz os dados (ensaio; as sequências do Auth podem ficar adiantadas). Com --apply, só confirma depois de todas as conferências.
// A conexão vem só da variável de ambiente; CRM_RESTORE_SSL_CA aponta o certificado do projeto quando o Node não aceita a
// cadeia do Supabase (Database → Settings → SSL Configuration). A verificação do certificado nunca é desligada.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  RestoreError,
  connectionProblems,
  parseDump,
  parseHistoryVersions,
  readBackupDir,
  restoreFailureMessage,
  runRestore,
} from './lib/backup-restore.mjs';

const USAGE =
  'Uso: npm run backup:restore -- --dir <pasta extraída do backup> --confirm <ref do projeto novo> [--apply]';

function parseArgs(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dir' || arg === '--confirm') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return null;
      options[arg.slice(2)] = value;
      index += 1;
    } else return null;
  }
  return options.dir ? options : null;
}

// A conexão sem sslmode e afins, que o pg leria por cima da configuração de TLS daqui.
function connectionConfig(url, caFile) {
  const parsed = new URL(url);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) parsed.searchParams.delete(key);
  const ssl = { rejectUnauthorized: true };
  if (caFile) ssl.ca = readFileSync(caFile, 'utf8');
  return { connectionString: parsed.toString(), ssl, application_name: 'crm-backup-restore' };
}

const print = (line = '') => process.stdout.write(`${line}\n`);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error(USAGE);
    return 2;
  }
  const url = process.env.CRM_RESTORE_DB_URL;
  const problem = connectionProblems(url, options.confirm);
  if (problem) throw new RestoreError(problem);
  print(`Lendo o backup em ${options.dir}`);
  const backup = readBackupDir(options.dir);
  const statements = parseDump(backup.data);
  const versions = parseHistoryVersions(backup.history);
  print(
    `  Backup de ${backup.info.createdAt ?? '(data desconhecida)'}, commit ${backup.info.commit ?? '(desconhecido)'}, ${versions.length} migrações, ${statements.length} comandos.`,
  );
  const client = new pg.Client(connectionConfig(url, process.env.CRM_RESTORE_SSL_CA));
  try {
    await client.connect();
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/certificate|self[- ]signed/i.test(message))
      throw new RestoreError(
        `O Node não aceitou o certificado do banco (${message}). Baixe o certificado em Database → Settings → SSL Configuration, no painel do projeto novo, e rode de novo com $env:CRM_RESTORE_SSL_CA = '<caminho do arquivo .crt>' (no macOS e no Linux, export CRM_RESTORE_SSL_CA='<caminho do arquivo .crt>').`,
      );
    throw new RestoreError(`Não foi possível conectar ao projeto novo: ${message}. Confira CRM_RESTORE_DB_URL.`);
  }
  try {
    const outcome = await runRestore({ client, backup, apply: options.apply, print });
    if (outcome.code !== 0) {
      console.error(outcome.message);
      return outcome.code;
    }
    return 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    // Falha antes da restauração (argumentos, conexão, leitura do backup): nada foi gravado. As falhas durante e depois
    // dela, com o estado confirmado ou desconhecido, saem de runRestore (achado 5 da revisão do 1.5).
    console.error(restoreFailureMessage(error));
    process.exit(1);
  },
);
