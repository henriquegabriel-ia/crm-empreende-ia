#!/usr/bin/env node
// Confere os links relativos de todos os documentos Markdown do repositório: cada arquivo ou pasta citado
// precisa existir e cada âncora (#seção) precisa corresponder a um título do documento de destino, com o
// mesmo identificador que o GitHub gera. Links externos (http, https, mailto, tel) não são consultados.
// Uso: npm run docs:links. Sai com código 1 e lista arquivo, linha e motivo de cada link quebrado.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IGNORED_DIRS = new Set([
  '.git',
  '.claude',
  '.vercel',
  'node_modules',
  'dist',
  'dist-perf',
  'dist-e2e',
  'coverage',
  'test-results',
  'playwright-report',
]);
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const toDisplayPath = (absolute) => path.relative(ROOT, absolute).split(path.sep).join('/');
const lineAt = (text, index) => text.slice(0, index).split('\n').length;
const blank = (match) => match.replace(/[^\n]/g, ' ');

function markdownFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) found.push(...markdownFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found.sort();
}

// Troca blocos de código e comentários HTML (e, com `inline`, trechos em crase) por espaços, preservando
// as posições, para que exemplos em código não sejam lidos como links e as linhas relatadas continuem certas.
function withoutCode(text, { inline = true } = {}) {
  const blocks = text
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
  return inline ? blocks.replace(/``[^\n]*?``/g, blank).replace(/`[^`\n]*`/g, blank) : blocks;
}

// Mesmo algoritmo do github-slugger: minúsculas, sem pontuação e cada espaço vira hífen.
function slugify(heading) {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const text = withoutCode(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), { inline: false });
  const anchors = new Set();
  const seen = new Map();
  for (const match of text.matchAll(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    const base = slugify(match[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  for (const match of text.matchAll(/<a\s[^>]*(?:name|id)="([^"]+)"/gi)) anchors.add(match[1].toLowerCase());
  anchorCache.set(file, anchors);
  return anchors;
}

function linksOf(text) {
  const links = [];
  const patterns = [
    /\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g,
    /^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]*>|\S+)/gm,
    /<(?:a|img)\s[^>]*?(?:href|src)="([^"]+)"/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) links.push({ target: match[1], index: match.index });
  }
  return links;
}

function check(file) {
  const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const text = withoutCode(raw);
  const problems = [];
  let count = 0;
  for (const { target: rawTarget, index } of linksOf(text)) {
    const target = rawTarget.replace(/^<|>$/g, '').trim();
    if (!target || EXTERNAL.test(target)) continue;
    count += 1;
    const hashAt = target.indexOf('#');
    const pathPart = hashAt === -1 ? target : target.slice(0, hashAt);
    const anchor = hashAt === -1 ? '' : target.slice(hashAt + 1);
    let decodedPath;
    let decodedAnchor;
    try {
      decodedPath = decodeURIComponent(pathPart);
      decodedAnchor = decodeURIComponent(anchor).toLowerCase();
    } catch {
      problems.push({ line: lineAt(raw, index), target, reason: 'codificação inválida' });
      continue;
    }
    const resolved = !decodedPath
      ? file
      : decodedPath.startsWith('/')
        ? path.join(ROOT, decodedPath)
        : path.resolve(path.dirname(file), decodedPath);
    if (!existsSync(resolved)) {
      problems.push({ line: lineAt(raw, index), target, reason: 'arquivo ou pasta inexistente' });
      continue;
    }
    const isMarkdown = statSync(resolved).isFile() && resolved.toLowerCase().endsWith('.md');
    if (decodedAnchor && isMarkdown && !anchorsOf(resolved).has(decodedAnchor)) {
      problems.push({ line: lineAt(raw, index), target, reason: `seção #${decodedAnchor} não encontrada` });
    }
  }
  return { count, problems };
}

const files = markdownFiles(ROOT);
let total = 0;
const broken = [];
for (const file of files) {
  const { count, problems } = check(file);
  total += count;
  for (const problem of problems) broken.push({ file: toDisplayPath(file), ...problem });
}

if (broken.length) {
  console.error(`Links quebrados: ${broken.length}`);
  for (const { file, line, target, reason } of broken) console.error(`- ${file}:${line} → ${target} (${reason})`);
  process.exit(1);
}
console.log(`Links relativos conferidos: ${total} em ${files.length} documentos Markdown, todos válidos.`);
