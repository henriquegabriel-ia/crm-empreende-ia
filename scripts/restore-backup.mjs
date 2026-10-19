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
//   npm run backup:restore -- --dir "C:\Users\<você>\Documents\crm-restauracao" --confirm <ref do projeto novo>
//   npm run backup:restore -- --dir "C:\Users\<você>\Documents\crm-restauracao" --confirm <ref do projeto novo> --apply
//   Remove-Item Env:CRM_RESTORE_DB_URL
// No macOS e no Linux: read -rs CRM_RESTORE_DB_URL && export CRM_RESTORE_DB_URL, no começo, e unset CRM_RESTORE_DB_URL,
// no fim (o resto é igual).
// Sem --apply, grava tudo, confere e desfaz (ensaio). Com --apply, só confirma depois de todas as conferências.
// A conexão vem só da variável de ambiente; CRM_RESTORE_SSL_CA aponta o certificado do projeto quando o Node não aceita a
// cadeia do Supabase (Database → Settings → SSL Configuration). A verificação do certificado nunca é desligada.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  RestoreError,
  connectionProblems,
  driftSummary,
  parseDump,
  parseHistoryVersions,
  readBackupDir,
  restoreBackup,
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
    const result = await restoreBackup({ client, backup, apply: options.apply, log: (line) => print(`- ${line}`) });
    print('');
    print('Linhas por tabela:');
    for (const { table, rows } of result.counts) print(`  ${table}: ${rows}`);
    if (result.skipped.length) {
      print('');
      print(
        `Atenção: ficaram de fora os dados de recursos da plataforma ligados no painel do Supabase (${result.skipped.join(', ')}).`,
      );
      print(
        '  Eles não são da base do CRM: se a empresa ligou esses recursos no painel, recrie no projeto novo os jobs, webhooks ou filas que ela usava (docs/BACKUP-RESTAURACAO.md).',
      );
    }
    print(`Tempo: ${(result.elapsedMs / 1000).toFixed(1)} s.`);
    if (!result.applied) {
      print('');
      print('Ensaio concluído: nada foi gravado. Rode de novo com --apply para restaurar.');
      return 0;
    }
    print('');
    print('Restauração concluída e confirmada.');
    const drift = await driftSummary(client);
    if (drift[0]?.detalhe) print(`Conferência de drift: ${drift[0].detalhe}`);
    if (drift.length > 1)
      print(
        `  ${drift.length - 1} linha(s) além do resumo: elas vêm do schema (do db push), não dos dados. Cole supabase/db-drift-check.sql no SQL Editor para ver o detalhe.`,
      );
    print('');
    print('Falta fazer (docs/BACKUP-RESTAURACAO.md):');
    print('  1. npm run config:push no projeto novo (configuração do Auth).');
    print('  2. Na Vercel, a URL e a chave pública do projeto novo, e um deploy novo.');
    print('  3. Todos entram de novo: as sessões não fazem parte do backup.');
    print(
      `  4. Refaça as anonimizações atendidas depois de ${result.createdAt ?? 'a data do backup'} (a lista fica fora do CRM).`,
    );
    print('  5. Apague a pasta extraída do backup e esvazie a lixeira.');
    return 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    if (error instanceof RestoreError) console.error(error.message);
    else console.error(`Falha inesperada na restauração: ${error?.stack ?? error}`);
    console.error('Nada foi gravado no projeto.');
    process.exit(1);
  },
);
