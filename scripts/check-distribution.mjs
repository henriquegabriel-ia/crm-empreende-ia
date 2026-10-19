#!/usr/bin/env node
// Conferência contra vazamento da distribuição aos alunos (item 1.7a; docs/arquitetura/1.7a.md, seção 7). Só módulos do
// Node e o `git`: o workflow .github/workflows/distribuicao.yml roda sem `npm ci`.
// Uso:
//   npm run release:check                         o repositório atual (classificação e conteúdo dos incluídos)
//   npm run release:check -- --dist <pasta>       uma árvore gerada pelo npm run release:dist, antes do envio
//   npm run release:check -- --dist <pasta> --rehearsal   aceita o commit único de ensaio (o --verify do ensaio)
// No repositório de distribuição (CRM_DISTRIBUTION_REPOSITORY=true), sem --dist, confere também o histórico e as tags
// dele, menos num pull request (GITHUB_EVENT_NAME=pull_request): lá o checkout é o commit de merge do GitHub, e vale
// só o conteúdo (a distribuição não aceita PR; docs/DISTRIBUICAO.md, seção 9).
// Sai com 0 ou com 1 e a lista "arquivo:linha — regra: motivo". Nenhuma mensagem mostra um termo privado inteiro.
import path from 'node:path';
import {
  DISTRIBUTION_REPOSITORY_VARIABLE,
  ROOT,
  checkDistributionFolder,
  distributionHistoryChecked,
  distributionProblems,
  formatProblem,
  privateTerms,
  workingTreeFiles,
} from './lib/distribution.mjs';

const USAGE = 'Uso: npm run release:check [-- --dist <pasta> [--rehearsal]]';
const args = process.argv.slice(2);
let dist = null;
let rehearsal = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--dist' && args[index + 1]) dist = path.resolve(args[++index]);
  else if (args[index] === '--rehearsal') rehearsal = true;
  else {
    console.error(USAGE);
    process.exit(2);
  }
}
if (rehearsal && !dist) {
  console.error(USAGE);
  process.exit(2);
}

const terms = privateTerms({ root: ROOT });
const problems = [...terms.problems];
const distributionRepository = process.env[DISTRIBUTION_REPOSITORY_VARIABLE] === 'true';
let label;
if (dist || distributionRepository) {
  const dir = dist ?? ROOT;
  const history = Boolean(dist) || distributionHistoryChecked();
  label = `na árvore em ${dir}${history ? '' : ' (pull request: só o conteúdo, sem o histórico)'}`;
  problems.push(...checkDistributionFolder({ dir, terms: terms.terms, allowRehearsal: rehearsal, history }));
} else {
  label = 'no repositório';
  problems.push(...distributionProblems({ dir: ROOT, files: workingTreeFiles(ROOT), terms: terms.terms }));
}

const scope = terms.base
  ? `${terms.terms.length} termos privados do repositório da base`
  : 'só as regras genéricas, fora do repositório da base';
if (problems.length) {
  console.error(`Distribuição reprovada ${label} (${problems.length}; ${scope}):`);
  for (const entry of problems) console.error(`  ${formatProblem(entry)}`);
  console.error('Regras e exceções: scripts/lib/distribution.mjs; processo: docs/DISTRIBUICAO.md.');
  process.exit(1);
}
console.log(`Distribuição sem vazamento ${label} (${scope}).`);
if (rehearsal) console.log('Commit de ensaio aceito só para conferir a árvore: ele nunca é enviado.');
