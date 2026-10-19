#!/usr/bin/env node
// Gera os modelos de e-mail do Supabase Auth do CRM em supabase/templates/ a partir da marca da instância em
// public/brand/brand.json (item 1.6) e das opções do Auth em supabase/config.toml (otp_expiry, otp_length e
// double_confirm_changes, desde o item 1.3): os oito .html e subjects.json, mais a região dos modelos no próprio
// config.toml, entre as marcas (ver scripts/lib/auth-emails.mjs, supabase/templates/README.md e docs/MARCA.md). Sem
// dependências além do Node.
// Uso:
//   npm run emails:build     grava os arquivos e a região (rode depois de trocar a marca ou as opções do Auth);
//   npm run emails:check     só confere; sai com 1 se algum arquivo versionado ou a região não bate com o gerador;
//   npm run emails:preview   grava supabase/templates/preview.html (ignorado pelo Git) com valores fictícios.
import { mkdirSync, readFileSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BrandError,
  CONFIG_FILE,
  PREVIEW_FILE,
  ROOT,
  TEMPLATES_DIR,
  buildAuthEmails,
  buildPreview,
  compareWithDirectory,
  configTemplateRegion,
  isLogoPath,
  readBrand,
} from './lib/auth-emails.mjs';
import {
  TEMPLATE_REGION_END,
  TEMPLATE_REGION_START,
  replaceTemplateRegion,
  templateRegion,
} from './lib/supabase-config.mjs';

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
  // A mensagem já diz o arquivo (public/brand/brand.json, supabase/config.toml ou um arquivo antigo) e o que fazer.
  if (error instanceof BrandError) fail([error.message]);
  throw error;
}

const config = display(CONFIG_FILE);
const configText = readCurrent(CONFIG_FILE) ?? '';
const region = configTemplateRegion(files);
const missingMarks = [
  `${config} não tem as marcas da região dos modelos de e-mail. Acrescente, entre a tabela [auth.email.smtp] e a [auth.sms], as duas linhas:`,
  `  ${TEMPLATE_REGION_START}`,
  `  ${TEMPLATE_REGION_END}`,
  'e rode npm run emails:build de novo.',
];

if (mode === 'check') {
  const problems = compareWithDirectory(files);
  const current = templateRegion(configText);
  if (current === null) fail(missingMarks);
  const regionStale = current !== region;
  if (regionStale && !problems.length)
    fail([
      `A região dos modelos de e-mail em ${config} está defasada.`,
      `  Rode npm run emails:build e faça commit do ${config}. Não edite entre as marcas: o texto vem de scripts/lib/auth-emails.mjs e da marca.`,
    ]);
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
    if (regionStale) lines.push(`  - ${config}: a região dos modelos de e-mail está defasada`);
    lines.push(
      `  Rode npm run emails:build e faça commit dos arquivos gerados. Não edite os .html à mão: a marca fica em public/brand/brand.json, as opções do Auth em ${config} ([auth.email]) e o texto em scripts/lib/auth-emails.mjs.`,
    );
    fail(lines);
  }
  console.log(
    `${directory}: ${files.size} arquivos e a região dos modelos em ${config} em dia com public/brand/brand.json, ${config} e o gerador.`,
  );
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
  if (templateRegion(configText) === null) fail(missingMarks);
  if (templateRegion(configText) !== region) {
    writeAtomically(CONFIG_FILE, replaceTemplateRegion(configText, region));
    changed.push(`região dos modelos em ${config}`);
  }
  const extra = compareWithDirectory(files).filter((problem) => problem.reason.startsWith('sobrando'));
  console.log(
    changed.length
      ? `${directory}: ${changed.length} de ${files.size + 1} itens gravados (${changed.join(', ')}).`
      : `${directory}: os ${files.size} arquivos e a região dos modelos em ${config} já estavam em dia; nada mudou.`,
  );
  // O comando só confere o arquivo local; o e-mail busca o logo no site publicado.
  if (isLogoPath(brand.logoUrl))
    console.log(
      `Logo: os e-mails buscam {{ .SiteURL }}${brand.logoUrl} no site publicado. Antes de colar os modelos no painel, publique o frontend com public${brand.logoUrl} e abra <Site URL>${brand.logoUrl} no navegador.`,
    );
  if (extra.length)
    fail([
      `Sobrando em ${directory}/: ${extra.map((problem) => problem.name).join(', ')}. O gerador não produz esses arquivos; apague-os (o config-snippet.toml saiu no item 1.3: os blocos ficam no ${config}) ou inclua os modelos em scripts/lib/auth-emails.mjs.`,
    ]);
}
