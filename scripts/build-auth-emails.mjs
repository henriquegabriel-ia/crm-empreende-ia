#!/usr/bin/env node
// Gera os modelos de e-mail do Supabase Auth do CRM em supabase/templates/ a partir da marca em
// supabase/templates/brand.json: os oito .html, subjects.json e config-snippet.toml (ver
// scripts/lib/auth-emails.mjs e supabase/templates/README.md). Sem dependências além do Node.
// Uso:
//   npm run emails:build     grava os arquivos (rode depois de trocar a marca no brand.json);
//   npm run emails:check     só confere; sai com 1 se algum arquivo versionado não bate com o gerador;
//   npm run emails:preview   grava supabase/templates/preview.html (ignorado pelo Git) com valores fictícios.
import { mkdirSync, readFileSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BrandError,
  PREVIEW_FILE,
  ROOT,
  TEMPLATES_DIR,
  buildAuthEmails,
  buildPreview,
  compareWithDirectory,
  isLogoPath,
  readBrand,
} from './lib/auth-emails.mjs';

const USAGE = 'Uso: node scripts/build-auth-emails.mjs [--check | --preview]';
const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== '--check' && arg !== '--preview')) {
  console.error(USAGE);
  process.exit(2);
}
const mode = args[0] === '--check' ? 'check' : args[0] === '--preview' ? 'preview' : 'build';
const display = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const directory = display(TEMPLATES_DIR);

function fail(lines) {
  console.error(lines.join('\n'));
  process.exit(1);
}

// Grava num arquivo vizinho e troca de uma vez, para uma falha no meio não deixar o arquivo truncado.
function writeAtomically(file, content) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function readCurrent(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

let brand;
let files;
try {
  brand = readBrand();
  files = buildAuthEmails(brand);
} catch (error) {
  if (error instanceof BrandError)
    fail([
      `${directory}/${error.message}`,
      `  Corrija ${directory}/brand.json (campos explicados em ${directory}/README.md).`,
    ]);
  throw error;
}

if (mode === 'check') {
  const problems = compareWithDirectory(files);
  if (problems.length) {
    const lines = [`Modelos de e-mail fora de dia em ${directory}/:`];
    for (const problem of problems) {
      lines.push(`  - ${problem.name}: ${problem.reason}`);
      if (problem.line) {
        lines.push(`      primeira diferença na linha ${problem.line}:`);
        lines.push(`        gerado:     ${problem.expected}`);
        lines.push(`        versionado: ${problem.actual}`);
      } else if (problem.expected) {
        lines.push(`      esperado ${problem.expected}, encontrado ${problem.actual}`);
      }
    }
    lines.push(
      `  Rode npm run emails:build e faça commit dos arquivos gerados. Não edite os .html à mão: a marca fica em ${directory}/brand.json e o texto em scripts/lib/auth-emails.mjs.`,
    );
    fail(lines);
  }
  console.log(`${directory}: ${files.size} arquivos em dia com brand.json e o gerador.`);
} else if (mode === 'preview') {
  writeAtomically(PREVIEW_FILE, buildPreview(brand, files));
  console.log(
    `${display(PREVIEW_FILE)} gerado com valores fictícios. Abra no navegador:\n  ${pathToFileURL(PREVIEW_FILE).href}`,
  );
} else {
  mkdirSync(TEMPLATES_DIR, { recursive: true });
  const changed = [];
  for (const [name, content] of files) {
    const file = path.join(TEMPLATES_DIR, name);
    if (readCurrent(file) === content) continue;
    writeAtomically(file, content);
    changed.push(name);
  }
  const extra = compareWithDirectory(files).filter((problem) => problem.reason.startsWith('sobrando'));
  console.log(
    changed.length
      ? `${directory}: ${changed.length} de ${files.size} arquivos gravados (${changed.join(', ')}).`
      : `${directory}: os ${files.size} arquivos já estavam em dia; nada mudou.`,
  );
  // O comando só confere o arquivo local; o e-mail busca o logo no site publicado.
  if (isLogoPath(brand.logoUrl))
    console.log(
      `Logo: os e-mails buscam {{ .SiteURL }}${brand.logoUrl} no site publicado. Antes de colar os modelos no painel, publique o frontend com public${brand.logoUrl} e abra <Site URL>${brand.logoUrl} no navegador.`,
    );
  if (extra.length)
    fail([
      `Sobrando em ${directory}/: ${extra.map((problem) => problem.name).join(', ')}. O gerador não produz esses modelos; apague-os ou inclua-os em scripts/lib/auth-emails.mjs.`,
    ]);
}
