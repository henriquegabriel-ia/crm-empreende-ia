#!/usr/bin/env node
// Gera os dados de demonstração do CRM (item 1.15): supabase/seed-demo.sql e supabase/seed-demo-remove.sql, a partir
// de scripts/lib/demo-seed.mjs (que parte do gerador do item 0.10). Sem dependências além do Node.
// Uso:
//   npm run seed:demo        grava os dois arquivos (rode depois de mudar o gerador ou o conjunto de demonstração);
//   npm run seed:demo:check  só confere; sai com 1 se algum arquivo versionado não bate com o gerador.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoSeedFiles } from './lib/demo-seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  console.error('Uso: node scripts/build-seed-demo.mjs [--check]');
  process.exit(2);
}

function readCurrent(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

const problems = [];
for (const { file, content } of buildDemoSeedFiles()) {
  const absolute = path.join(ROOT, file);
  const current = readCurrent(absolute);
  if (args[0] === '--check') {
    if (current === content) continue;
    if (current === null) {
      problems.push(`  - ${file}: arquivo ausente`);
      continue;
    }
    const expectedLines = content.split('\n');
    const currentLines = current.split('\n');
    const line = expectedLines.findIndex((text, index) => text !== currentLines[index]);
    problems.push(`  - ${file}: diferente do gerador (primeira diferença na linha ${line + 1})`);
    continue;
  }
  if (current === content) continue;
  // Grava num arquivo vizinho e troca de uma vez, para uma falha no meio não deixar o arquivo truncado.
  const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, absolute);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  console.log(`Gravado ${file}`);
}
if (problems.length) {
  console.error(
    ['Dados de demonstração fora de dia:', ...problems, 'Rode npm run seed:demo e versione o resultado.'].join('\n'),
  );
  process.exit(1);
}
if (args[0] === '--check') console.log('Dados de demonstração em dia com scripts/lib/demo-seed.mjs.');
