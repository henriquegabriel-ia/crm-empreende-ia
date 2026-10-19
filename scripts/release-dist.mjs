#!/usr/bin/env node
// Monta a árvore de uma versão para o repositório de distribuição aos alunos (item 1.7a; docs/arquitetura/1.7a.md,
// seção 5; processo em docs/DISTRIBUICAO.md). Copia só os arquivos da allowlist (scripts/lib/distribution.mjs), com o
// conteúdo da pasta de trabalho da base, e faz um commit "chore: versão X.Y.Z" com a identidade do programa, sem a
// configuração pessoal do Git de quem roda. Nunca envia nem cria tag: mostra os comandos do @devops.
// Uso:
//   npm run release:dist -- --out <pasta> --author "Nome <e-mail>" [--rehearsal] [--verify] [--e2e]
//   npm run release:dist -- --list
// --out: uma pasta nova (primeira versão) ou um clone do repositório de distribuição (versões seguintes), sempre fora
// do repositório da base. --rehearsal: ensaio numa pasta nova, aceitando a versão .0 e mudanças sem commit. --verify:
// npm ci, a conferência e a suíte da Qualidade num clone local do commit gerado (o que os alunos recebem, e não a pasta
// de trabalho), ao lado da pasta e apagado no fim se tudo passar; --e2e acrescenta o test:e2e (portas 8096, 8098 e 8099:
// nunca ao mesmo tempo que o E2E da base).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  DISTRIBUTION_REPOSITORY_VARIABLE,
  DistributionError,
  ROOT,
  buildDistribution,
  classificationProblems,
  classifyFiles,
  devopsSteps,
  formatProblem,
  git,
  workingTreeFiles,
} from './lib/distribution.mjs';
import { BASE_REPOSITORY_VARIABLE } from './lib/base-manifest.mjs';

const USAGE =
  'Uso: npm run release:dist -- --out <pasta> --author "Nome <e-mail>" [--rehearsal] [--verify] [--e2e]\n' +
  '     npm run release:dist -- --list';
const args = process.argv.slice(2);
const options = { list: false, rehearsal: false, verify: false, e2e: false, out: null, author: null };
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--list') options.list = true;
  else if (arg === '--rehearsal') options.rehearsal = true;
  else if (arg === '--verify') options.verify = true;
  else if (arg === '--e2e') options.e2e = options.verify = true;
  else if ((arg === '--out' || arg === '--author') && args[index + 1] !== undefined)
    options[arg.slice(2)] = args[++index];
  else {
    console.error(USAGE);
    process.exit(2);
  }
}

if (options.list) {
  const files = workingTreeFiles(ROOT);
  const classes = classifyFiles(files);
  const byReason = (entries) => {
    const groups = new Map();
    for (const { file, reason } of entries) groups.set(reason, [...(groups.get(reason) ?? []), file]);
    return groups;
  };
  console.log(`Incluídos (${classes.included.length}):`);
  for (const [reason, group] of byReason(classes.included)) {
    console.log(`  ${reason} (${group.length})`);
    for (const file of group) console.log(`    ${file}`);
  }
  console.log(`Excluídos (${classes.excluded.length}):`);
  for (const [reason, group] of byReason(classes.excluded))
    console.log(`  ${reason}: ${group.length} ${group.length === 1 ? 'arquivo' : 'arquivos'}`);
  const problems = classificationProblems(files);
  if (problems.length) {
    console.error(`Problemas da classificação (${problems.length}):`);
    for (const entry of problems) console.error(`  ${formatProblem(entry)}`);
    process.exit(1);
  }
  console.log('Todos os arquivos estão classificados.');
  process.exit(0);
}

let summary;
try {
  summary = buildDistribution({
    root: ROOT,
    out: options.out,
    author: options.author,
    rehearsal: options.rehearsal,
  });
} catch (error) {
  if (!(error instanceof DistributionError)) throw error;
  console.error(`Distribuição recusada, nada foi escrito: ${error.message}`);
  process.exit(1);
}

const megabytes = (summary.bytes / 1024 / 1024).toFixed(1);
console.log(
  [
    `Versão ${summary.version}${summary.rehearsal ? ' (ENSAIO: não publicar)' : ''}${summary.previousVersion ? `, depois da ${summary.previousVersion}` : ' (primeira versão nesta pasta)'}.`,
    `${summary.files} arquivos, ${megabytes} MB, em ${summary.out}.`,
    `Commit da distribuição: ${summary.commit.slice(0, 12)}; da base: ${summary.baseCommit.slice(0, 12)}${summary.baseDirty ? ' (com mudanças sem commit: ensaio)' : ''}.`,
  ].join('\n'),
);

if (options.verify) {
  // Um clone do commit: um arquivo que ficou na pasta e fora do commit não chega aos alunos, e aqui também não.
  const verifyDir = mkdtempSync(path.join(path.dirname(summary.out), `${path.basename(summary.out)}-verificacao-`));
  git(path.dirname(verifyDir), ['clone', '-q', '--no-hardlinks', summary.out, verifyDir]);
  console.log(`\nConferência num clone do commit gerado, em ${verifyDir}.`);
  const env = { ...process.env, [DISTRIBUTION_REPOSITORY_VARIABLE]: 'true' };
  delete env[BASE_REPOSITORY_VARIABLE];
  const steps = [
    'npm ci',
    `npm run release:check -- --dist .${summary.rehearsal ? ' --rehearsal' : ''}`,
    'npm run format:check',
    'npm run docs:links',
    'npm run lint:ci',
    'npm run typecheck',
    'npm test',
    'npm run test:db',
    'npm run gen:types:check',
    'npm run manifest:check',
    'npm run emails:check',
    'npm run build',
    ...(options.e2e ? ['npm run test:e2e'] : []),
  ];
  for (const command of steps) {
    console.log(`\n> ${command}`);
    const started = Date.now();
    const result = spawnSync(command, { cwd: verifyDir, env, stdio: 'inherit', shell: true });
    const seconds = Math.round((Date.now() - started) / 1000);
    if (result.status !== 0) {
      console.error(
        `\nFalhou na árvore gerada: ${command} (${seconds} s). Corrija na base e gere de novo; o clone fica em ${verifyDir} para conferir.`,
      );
      process.exit(1);
    }
    console.log(`ok: ${command} (${seconds} s)`);
  }
  rmSync(verifyDir, { recursive: true, force: true });
  console.log('\nA árvore gerada passou em todos os passos (o clone da conferência foi apagado).');
}

if (summary.rehearsal) {
  console.log('\nEnsaio: esta pasta nunca vai para o repositório de distribuição. Apague-a quando terminar.');
} else {
  console.log('\nPróximos passos do @devops (o script não envia nem cria tag; docs/DISTRIBUICAO.md):');
  for (const step of devopsSteps(summary)) console.log(`  ${step}`);
}
