// Distribuição aos alunos (item 1.7a; docs/arquitetura/1.7a.md, seções 5 a 7): a allowlist com classificação total, a
// conferência contra vazamento (npm run release:check) e a montagem da árvore de cada versão (npm run release:dist).
// Só módulos do Node e o `git`: o workflow .github/workflows/distribuicao.yml roda sem `npm ci`. Os termos pessoais
// (o ref do projeto do dono, os autores do histórico da base e a tabela do registro do ambiente do dono) são lidos em
// tempo de execução e nunca escritos num arquivo distribuído; as mensagens mostram só o começo de cada um.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerProjectRef } from './ai-rules.mjs';
import { BASE_REPOSITORY_VARIABLE } from './base-manifest.mjs';
import { isProgramBrand, readBrand } from './brand.mjs';
import { changelogSections, compareSemver, isDevelopmentVersion, isSemver } from './changelog.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** A variável do repositório de distribuição (nunca CRM_BASE_REPOSITORY, para o noturno do ci.yml não rodar lá). */
export const DISTRIBUTION_REPOSITORY_VARIABLE = 'CRM_DISTRIBUTION_REPOSITORY';
/** A pasta de registros do dono: estado do ambiente de desenvolvimento, fora da distribuição. */
export const OWNER_DOCS_DIR = 'docs/dono';
export const OWNER_REGISTRY_FILE = `${OWNER_DOCS_DIR}/AMBIENTE.md`;
export const DISTRIBUTION_GUIDE_FILE = 'docs/DISTRIBUICAO.md';
export const BETA_TERMS_FILE = 'docs/TERMO-BETA.md';
export const DISTRIBUTION_DESIGN_FILE = 'docs/arquitetura/1.7a.md';
export const BACKUP_WORKFLOW_FILE = '.github/workflows/backup-banco.yml';
export const BRAND_JSON_FILE = 'public/brand/brand.json';
export const VERSION_COMMIT_PREFIX = 'chore: versão ';
export const REHEARSAL_COMMIT_PREFIX = 'ensaio: ';
export const DISTRIBUTION_BRANCH = 'main';
/** Arquivo maior que isto não vai (o maior hoje é a fixture de 5.000 contatos, com cerca de 640 KB). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const rule = (pattern, reason) => Object.freeze({ pattern, reason });

/**
 * O que vai para os alunos (seção 6.2 do desenho). Arquivos da raiz e documentos sempre por nome; pastas de código por
 * padrão. Um documento novo em docs/ entra aqui por nome, nunca por `docs/**`, que alcançaria a pasta do dono.
 */
export const DISTRIBUTION_ALLOWLIST = Object.freeze([
  rule('.env.example', 'modelo das variáveis do frontend, sem valores'),
  rule('.gitattributes', 'fim de linha LF em todos os sistemas'),
  rule('.gitignore', 'o que nunca entra no Git da instância'),
  rule('.nvmrc', 'versão do Node do CI e da hospedagem'),
  rule('.prettierignore', 'formatação'),
  rule('.prettierrc.json', 'formatação'),
  rule('.vercelignore', 'publicação na Vercel'),
  rule('AGENTS.md', 'regras para ferramentas de IA (item 1.8)'),
  rule('CHANGELOG.md', 'notas de cada versão (item 1.7b)'),
  rule('CLAUDE.md', 'importa o AGENTS.md (item 1.8)'),
  rule('DESIGN.md', 'design system do CRM'),
  rule('LICENSE', 'licença da base (item 1.7b)'),
  rule('README.md', 'visão geral do repositório'),
  rule('components.json', 'configuração dos componentes'),
  rule('eslint.config.js', 'lint'),
  rule('index.html', 'página do app'),
  rule('package.json', 'dependências, scripts e versão'),
  rule('package-lock.json', 'versões travadas para o npm ci'),
  rule('playwright.config.ts', 'E2E'),
  rule('playwright.perf.config.ts', 'medição de desempenho'),
  rule('postcss.config.js', 'estilos'),
  rule('tailwind.config.ts', 'estilos'),
  rule('tsconfig.json', 'TypeScript'),
  rule('tsconfig.app.json', 'TypeScript'),
  rule('tsconfig.node.json', 'TypeScript'),
  rule('tsconfig.personalizar.json', 'tipos do exemplo de personalização (item 1.8)'),
  rule('tsconfig.typetests.json', 'testes de tipos'),
  rule('vercel.json', 'cabeçalhos de segurança e reescritas da publicação'),
  rule('vite.config.ts', 'build'),
  rule('vitest.config.ts', 'testes unitários'),
  rule('.github/workflows/ci.yml', 'CI de cada instância'),
  rule('.github/workflows/backup-banco.yml', 'backup agendado, desligado por variável (item 1.5)'),
  rule('.github/workflows/distribuicao.yml', 'conferência contra vazamento (item 1.7a)'),
  rule('src/**', 'código do app'),
  rule('scripts/**', 'scripts do npm run e as conferências'),
  rule('supabase/**', 'migrações, modelos de e-mail, conferências e testes do banco'),
  rule('tests/**', 'E2E e medição de desempenho'),
  rule('public/**', 'marca, fontes e arquivos públicos'),
  rule('docs/ATUALIZACAO.md', 'guia de atualização (item 1.7b)'),
  rule('docs/BACKUP-RESTAURACAO.md', 'backup e restauração (item 1.5)'),
  rule('docs/DISTRIBUICAO.md', 'processo de distribuição (item 1.7a)'),
  rule('docs/ENSAIO-IMPLANTACAO.md', 'ensaio do guia de implantação (item 1.4)'),
  rule('docs/IMPLANTACAO.md', 'guia de implantação (item 1.4)'),
  rule('docs/INTEGRACOES-PENDENTES.md', 'integrações pendentes'),
  rule('docs/LGPD-INSTANCIA.md', 'LGPD da instância (item 1.10)'),
  rule('docs/LICENCA.md', 'explicação da licença (item 1.7b)'),
  rule('docs/MARCA.md', 'trocar a marca (item 1.6)'),
  rule('docs/PROTECAO-ATUALIZACAO.md', 'personalizar sem quebrar a atualização (item 1.13)'),
  // O nome em partes: o teste do item 1.4 reprova documento ou script vivo que cite o índice antigo pelo nome.
  rule(['docs/PUBLICACAO', 'CRM.md'].join('-'), 'índice de redirecionamento dos links antigos (item 1.4)'),
  rule('docs/RECUPERAR-ACESSO-DONO.md', 'recuperar o acesso de dono (item 1.1)'),
  rule('docs/ROADMAP-FINALIZACAO.md', 'roteiro e decisões que os guias citam (seção 6.3 do desenho do 1.7a)'),
  rule('docs/TERMO-BETA.md', 'termo de beta (item 1.7a)'),
  rule('docs/PERSONALIZAR/**', 'guias e exemplo de personalização (item 1.8)'),
  rule('docs/arquitetura/**', 'desenhos técnicos que o AGENTS.md, o config:check e o código citam'),
]);

/** O que fica de fora de propósito, com o motivo. Arquivo que não está aqui nem na allowlist reprova. */
export const DISTRIBUTION_EXCLUDED = Object.freeze([
  rule(`${OWNER_DOCS_DIR}/**`, 'registros do ambiente do dono (estado, ref do projeto, prévias)'),
  rule('.git-blame-ignore-revs', 'aponta um commit do histórico privado, que a distribuição não tem'),
]);

/** O que nunca pode ser distribuído, mesmo que alguém o acrescente à allowlist. */
export const FORBIDDEN_PATHS = Object.freeze([
  `${OWNER_DOCS_DIR}/**`,
  '.claude/**',
  '**/.env',
  '**/.env.*',
  '**/*.local',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/id_rsa*',
  '**/crm-backup-*',
  '**/crm-restauracao*/**',
  '**/*.7z',
  '**/*.zip',
  '**/*.dump',
  'src/custom/**',
  'supabase/migrations/*_custom_*',
  'node_modules/**',
  'dist/**',
  'dist-*/**',
  'supabase/.temp/**',
  'supabase/.branches/**',
  'test-results/**',
  'playwright-report/**',
  '.vercel/**',
  '**/*.log',
  '.git-blame-ignore-revs',
]);
/** As exceções dos proibidos: os modelos de variáveis, sem valores, e a pasta vazia de quem personaliza. */
export const FORBIDDEN_EXCEPTIONS = Object.freeze(['.env.example', 'supabase/.env.example', 'src/custom/.gitkeep']);

/**
 * Caminhos-sentinela: exemplos do que nunca pode ir e que fica fora das pastas de código. Um padrão da allowlist que
 * alcança qualquer um deles é perigoso (`docs/**` alcançaria a pasta do dono) e reprova, mesmo antes de existir um
 * arquivo assim. Os proibidos de dentro de `src/` e de `supabase/` (`src/custom/`, `supabase/.env`, as migrações
 * `_custom_`) ficam de fora desta lista: as duas pastas vão inteiras, e cada arquivo passa por FORBIDDEN_PATHS (correção
 * do desenho, seção 6.1).
 */
export const SENTINEL_PATHS = Object.freeze([
  `${OWNER_DOCS_DIR}/AMBIENTE.md`,
  `${OWNER_DOCS_DIR}/previews/tela.png`,
  '.claude/settings.local.json',
  '.env',
  '.env.local',
  'node_modules/react/index.js',
  'dist/index.html',
  'dist-e2e/8096/index.html',
  'crm-backup-20261019.7z',
  'crm-restauracao/dump.sql',
  'test-results/resultado.json',
  'playwright-report/index.html',
  '.vercel/project.json',
  '.git-blame-ignore-revs',
  'npm-debug.log',
]);

/** Sem estes, a árvore não é uma versão da base. */
export const REQUIRED_FILES = Object.freeze([
  'LICENSE',
  'CHANGELOG.md',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'package.json',
  'package-lock.json',
  BETA_TERMS_FILE,
  'docs/IMPLANTACAO.md',
  'docs/ATUALIZACAO.md',
  BRAND_JSON_FILE,
]);

/** A política completa da base; os testes de integração passam uma menor, sobre um repositório temporário. */
export const DISTRIBUTION_POLICY = Object.freeze({
  allowlist: DISTRIBUTION_ALLOWLIST,
  excluded: DISTRIBUTION_EXCLUDED,
  forbidden: FORBIDDEN_PATHS,
  forbiddenExceptions: FORBIDDEN_EXCEPTIONS,
  sentinels: SENTINEL_PATHS,
  required: REQUIRED_FILES,
});

// ---------------------------------------------------------------------------------------------------------------------
// Padrões

const globCache = new Map();
/**
 * Um padrão no formato do Git, sempre a partir da raiz: `/` separa pastas, `*` e `?` ficam dentro de uma pasta e `**`
 * vale qualquer profundidade (`**​/x` também na raiz; `x/**` tudo dentro de x). Sensível a maiúsculas, como a hospedagem.
 * `path.matchesGlob` não existe no Node 20.
 */
export function globToRegExp(pattern) {
  if (globCache.has(pattern)) return globCache.get(pattern);
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      const atStart = index === 0 || pattern[index - 1] === '/';
      const next = pattern[index + 2];
      if (atStart && next === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const regex = new RegExp(`^${source}$`);
  globCache.set(pattern, regex);
  return regex;
}

export const matchesPattern = (file, pattern) => globToRegExp(pattern).test(file);
const hasWildcard = (pattern) => /[*?]/.test(pattern);
const firstMatch = (file, rules) => rules.find((entry) => matchesPattern(file, entry.pattern)) ?? null;

export function isForbidden(file, policy = DISTRIBUTION_POLICY) {
  if (policy.forbiddenExceptions.includes(file)) return false;
  return policy.forbidden.some((pattern) => matchesPattern(file, pattern));
}

/** Cada arquivo numa classe: incluído (com o motivo), excluído (com o motivo), nas duas listas ou em nenhuma. */
export function classifyFiles(files, policy = DISTRIBUTION_POLICY) {
  const result = { included: [], excluded: [], both: [], unclassified: [] };
  for (const file of [...files].sort()) {
    const allowed = firstMatch(file, policy.allowlist);
    const excluded = firstMatch(file, policy.excluded);
    if (allowed && excluded) result.both.push(file);
    else if (allowed) result.included.push({ file, reason: allowed.reason, pattern: allowed.pattern });
    else if (excluded) result.excluded.push({ file, reason: excluded.reason, pattern: excluded.pattern });
    else result.unclassified.push(file);
  }
  return result;
}

const problem = (file, line, ruleId, message) => ({ file, line, rule: ruleId, message });

/** As regras da classificação (C1; seção 6.1 do desenho), sobre os arquivos do repositório. */
export function classificationProblems(files, policy = DISTRIBUTION_POLICY) {
  const problems = [];
  const classes = classifyFiles(files, policy);
  for (const file of classes.unclassified)
    problems.push(
      problem(
        file,
        0,
        'C1',
        'arquivo sem classificação: acrescente-o à allowlist ou aos excluídos de scripts/lib/distribution.mjs, com o motivo',
      ),
    );
  for (const file of classes.both)
    problems.push(problem(file, 0, 'C1', 'arquivo na allowlist e nos excluídos ao mesmo tempo: deixe uma só'));
  for (const { file } of classes.included)
    if (isForbidden(file, policy)) problems.push(problem(file, 0, 'C1', 'arquivo proibido incluído na distribuição'));
  for (const { pattern } of policy.allowlist) {
    const reached = policy.sentinels.filter(
      (sentinel) => matchesPattern(sentinel, pattern) && isForbidden(sentinel, policy),
    );
    if (reached.length)
      problems.push(
        problem(
          'scripts/lib/distribution.mjs',
          0,
          'C1',
          `o padrão "${pattern}" da allowlist alcança um caminho proibido (${reached[0]}): use nomes ou um padrão mais estreito`,
        ),
      );
    if (!hasWildcard(pattern) && !files.includes(pattern))
      problems.push(
        problem(
          'scripts/lib/distribution.mjs',
          0,
          'C1',
          `o padrão "${pattern}" da allowlist cita um arquivo que não existe: tire-o da lista ou corrija o nome`,
        ),
      );
  }
  const included = new Set(classes.included.map((entry) => entry.file));
  for (const file of policy.required)
    if (!included.has(file)) problems.push(problem(file, 0, 'C1', 'arquivo obrigatório ausente da distribuição'));
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// Termos privados (seção 7.3)

/** Identidades de serviço, que não são pessoas: ficam fora dos termos do histórico. */
export const SERVICE_EMAILS = Object.freeze(['noreply@github.com', 'noreply@anthropic.com']);
const MIN_USERNAME_LENGTH = 6;

/** `abc…`: o começo do termo, para a mensagem nunca mostrar o termo inteiro. */
export const maskTerm = (term) => `${String(term).slice(0, 3)}…`;

/** O caminho com cada termo privado trocado pelo começo dele: um termo no nome do arquivo também não sai inteiro. */
export function maskPath(file, terms = []) {
  let shown = String(file);
  for (const { term } of terms) {
    if (!term) continue;
    const pattern = new RegExp(String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    shown = shown.replace(pattern, maskTerm(term));
  }
  return shown;
}
const maskProblems = (problems, terms) =>
  terms.length ? problems.map((entry) => ({ ...entry, file: maskPath(entry.file, terms) })) : problems;

/** Os termos de `git log --format=%an%n%ae%n%cn%n%ce` (pares nome e e-mail). */
export function historyTerms(log) {
  const lines = String(log ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const terms = new Set();
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const name = lines[index].trim();
    const email = lines[index + 1].trim().toLowerCase();
    if (!email && !name) continue;
    if (SERVICE_EMAILS.includes(email) || /\[bot\]$/i.test(name)) continue;
    if (email) {
      terms.add(email);
      const user = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/.exec(email)?.[1];
      if (user) terms.add(user);
    }
    if (name && (/\s/.test(name) || name.length >= MIN_USERNAME_LENGTH)) terms.add(name);
  }
  return [...terms];
}

/** As linhas `| Termo proibido | \`termo\` |` da seção "Distribuição" do registro do ambiente do dono. */
const REGISTRY_TERM_LINE = /^\| Termo proibido \| `?([^`|\n]+?)`? \|/;
export function registryTerms(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => REGISTRY_TERM_LINE.exec(line)?.[1]?.trim())
    .filter(Boolean);
}

/**
 * As linhas que parecem termos proibidos mas não estão no formato: um termo escrito de outro jeito seria ignorado sem
 * aviso. Contam toda linha de tabela que cita "termo proibido" e toda linha da tabela logo depois do parágrafo
 * "**Termos proibidos.**", fora o cabeçalho "| Campo | Valor |" e o separador.
 */
export function registryTermFormatProblems(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const problems = [];
  let afterHeading = false;
  let inTermsTable = false;
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('**Termos proibidos.**')) {
      afterHeading = true;
      continue;
    }
    const row = line.trimStart().startsWith('|') && !/^\s{4}/.test(line);
    if (afterHeading && row) inTermsTable = true;
    else if (inTermsTable && !row) inTermsTable = afterHeading = false;
    else if (afterHeading && line.trim() && !row) afterHeading = false;
    if (!row || REGISTRY_TERM_LINE.test(line)) continue;
    const header = /^\|\s*Campo\s*\|\s*Valor\s*\|\s*$/.test(line) || /^\|[\s|:-]+\|\s*$/.test(line);
    if ((inTermsTable && !header) || /termo proibido/i.test(line))
      problems.push(
        problem(
          OWNER_REGISTRY_FILE,
          index + 1,
          'C2',
          'linha da tabela de termos proibidos fora do formato "| Termo proibido | `termo` |": o termo seria ignorado',
        ),
      );
  }
  return problems;
}

/**
 * Os termos privados, cada um com a fonte. Só no repositório da base (com o registro do ambiente do dono, ou com
 * CRM_BASE_REPOSITORY=true): no repositório de distribuição e nos clones, os autores do histórico são a identidade do
 * programa ou da empresa, cujo nome aparece nos próprios documentos (correção do desenho, seção 7.3). Lá valem as
 * regras genéricas. `problems` lista o que impede a conferência de valer (a base sem o ref).
 */
export function privateTerms({ root = ROOT, env = process.env, gitLog = null } = {}) {
  const registryPath = path.join(root, OWNER_REGISTRY_FILE);
  const hasRegistry = existsSync(registryPath);
  const base = hasRegistry || env[BASE_REPOSITORY_VARIABLE] === 'true';
  const result = { base, terms: [], problems: [] };
  if (!base) return result;
  const registry = hasRegistry ? readFileSync(registryPath, 'utf8') : '';
  const ref = ownerProjectRef(registry);
  if (!ref)
    result.problems.push(
      problem(
        OWNER_REGISTRY_FILE,
        0,
        'C2',
        'no repositório da base, o registro do ambiente do dono precisa ter a linha "| Referência | `<ref>` |": sem ela, a conferência do ref ficaria desligada',
      ),
    );
  else result.terms.push({ term: ref, source: 'ref do projeto do dono' });
  for (const term of registryTerms(registry)) result.terms.push({ term, source: 'termo do registro do dono' });
  result.problems.push(...registryTermFormatProblems(registry));
  const log = gitLog ?? git(root, ['log', '--format=%an%n%ae%n%cn%n%ce'], { allowFailure: true }).stdout;
  for (const term of historyTerms(log)) result.terms.push({ term, source: 'termo pessoal do histórico' });
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Conteúdo (C2 a C11)

/** Refs de exemplo dos testes e dos guias. */
export const EXAMPLE_PROJECT_REFS = Object.freeze(['abcdefghijklmnopqrst', 'abcdefghijabcdefghij']);
/** Os domínios de exemplo já usados nos testes e nos textos, com o motivo; os reservados (RFC 2606) valem sempre. */
export const EXAMPLE_EMAIL_DOMAINS = Object.freeze({
  'exemplo.com.br': 'exemplo em pt-BR dos guias',
  'suaempresa.com.br': 'marcador da empresa nos guias',
  'empresa.com.br': 'exemplo das mensagens do app',
  'empresa.com': 'placeholder do convite da equipe e testes de e-mail',
  'acme.com.br': 'marca fictícia dos testes',
  'email.com': 'placeholder da tela de entrada',
  'dominio.tld': 'formato de endereço nos guias',
  'b.com': 'testes de codificação de endereço',
  'b.co': 'testes de codificação de endereço',
  'c.com': 'testes de codificação de endereço',
  'y.com': 'testes de codificação de endereço',
});
const RESERVED_EMAIL_DOMAIN = /(^|\.)(example|test|invalid|localhost)$|^example\.(com|net|org)$/;
const SECRET_PATTERNS = Object.freeze([
  [/\bsb_secret_[A-Za-z0-9_-]{20,}/, 'chave secreta do Supabase (sb_secret_)'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, 'JWT'],
  [/\bsbp_[0-9a-f]{40}\b/, 'token pessoal do Supabase (sbp_)'],
  [/\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{30,}/, 'token do GitHub'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'token do GitHub (github_pat_)'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'chave de acesso da AWS'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
  [/\bre_[A-Za-z0-9_]{20,}/, 'chave do Resend (re_), comum como senha do SMTP'],
  [/\bsk_(?:live|test)_[A-Za-z0-9]{20,}/, 'chave secreta (sk_live_ ou sk_test_)'],
  [/(?<![\w-])sk-[A-Za-z0-9_-]{20,}/, 'chave secreta (sk-)'],
  [/\bAIza[0-9A-Za-z_-]{35}/, 'chave do Google (AIza)'],
]);
/** Nos modelos de variáveis, o valor de senha, chave, segredo ou token fica vazio ou é um marcador de exemplo. */
export const ENV_EXAMPLE_FILES = Object.freeze(['.env.example', 'supabase/.env.example']);
const SECRET_VARIABLE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:_PASS|_PASSWORD|_KEY|_SECRET|_TOKEN))\s*=\s*(.*?)\s*$/;
const ENV_PLACEHOLDER = /^(?:|<[^<>]+>|cole-aqui-[a-z0-9-]+|sua-[a-z0-9-]+|seu-[a-z0-9-]+)$/;

/** C4 nos modelos de variáveis: um valor real colado no lugar do marcador. */
export function envExampleProblems(file, text) {
  const problems = [];
  for (const [index, line] of text.split('\n').entries()) {
    const match = SECRET_VARIABLE.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (!ENV_PLACEHOLDER.test(value))
      problems.push(
        problem(
          file,
          index + 1,
          'C4',
          `${match[1]} no modelo precisa ficar vazia ou com um marcador (por exemplo cole-aqui-a-senha), nunca com um valor real`,
        ),
      );
  }
  return problems;
}
const PROJECT_REF_PATTERNS = [
  /\b([a-z]{20})\.supabase\.co\b/g,
  /\bpostgres\.([a-z]{20})\b/g,
  /\bproject\/([a-z]{20})\b/g,
];
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z][A-Za-z0-9-]+)\b/g;
// Windows (C:\Users\<você>), macOS e Linux (/Users/<você>/, /home/<você>/) e o formato do Git Bash e do WSL
// (/c/Users/<você>/, /mnt/c/Users/<você>/), que o Windows produz ao colar um caminho do terminal.
const USER_PATH =
  /\b[A-Za-z]:[\\/]+Users[\\/]+([^\\/\s"'`<>]+)|(?<![\w.])\/(?:Users|home)\/([^/\s"'`<>]+)\/|(?<![\w.])(?:\/mnt)?\/[A-Za-z]\/Users\/([^/\s"'`<>]+)/g;
const ALLOWED_USER_NAMES = new Set(['runner', '%USERPROFILE%', 'Public', 'Default']);
const OWNER_FOLDER_MENTION = /docs[\\/]+dono\b/i;
const LEGACY_MENTION = /legacy-archive|\.git-blame-ignore-revs/;
/** Os documentos que podem citar a pasta do dono, sem link: o guia de distribuição e o desenho do item. */
export const OWNER_FOLDER_DOCS = Object.freeze([DISTRIBUTION_GUIDE_FILE, DISTRIBUTION_DESIGN_FILE]);
const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|ttf|otf|woff2?|eot|7z|zip|gz|pdf)$/i;

/** Arquivo binário: pela extensão ou por um byte nulo. Só passa pelas regras de caminho. */
export const isBinary = (file, bytes) => BINARY_EXTENSIONS.test(file) || (bytes ? bytes.includes(0) : false);

/**
 * Os documentos vivos (os mesmos do teste do 1.7b): README, AGENTS.md, CHANGELOG.md, docs/ fora do roteiro, dos desenhos
 * e da pasta do dono, e os .md de supabase/ e de src/.
 */
export function isLivingDoc(file) {
  if (!file.endsWith('.md')) return false;
  if (['README.md', 'AGENTS.md', 'CHANGELOG.md'].includes(file)) return true;
  if (file.startsWith('docs/'))
    return (
      file !== 'docs/ROADMAP-FINALIZACAO.md' &&
      !file.startsWith('docs/arquitetura/') &&
      !file.startsWith(`${OWNER_DOCS_DIR}/`)
    );
  return file.startsWith('supabase/') || file.startsWith('src/');
}

const lineNumber = (text, index) => text.slice(0, index).split('\n').length;

/** Os alvos dos links Markdown de um texto (inline e definições de referência), com a posição. */
function markdownLinkTargets(text) {
  const targets = [];
  for (const match of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g))
    targets.push({ target: match[1], index: match.index });
  for (const match of text.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm))
    targets.push({ target: match[1], index: match.index });
  return targets;
}

/** O link aponta para a pasta do dono, resolvido a partir da pasta do documento? */
export function linksToOwnerFolder(file, target) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) return false;
  const raw = target.split('#')[0].split('?')[0];
  let clean = raw;
  try {
    clean = decodeURIComponent(raw);
  } catch {
    // Um `%` solto (`100%.md`) não é codificação: vale o alvo como está, sem derrubar a conferência.
  }
  if (!clean) return false;
  const resolved = path.posix.normalize(
    clean.startsWith('/') ? clean.slice(1) : path.posix.join(path.posix.dirname(file), clean),
  );
  return resolved === OWNER_DOCS_DIR || resolved.startsWith(`${OWNER_DOCS_DIR}/`);
}

/** As regras de conteúdo de um arquivo de texto (C2 a C8). `terms` vem de `privateTerms`. */
export function contentProblems(file, text, { terms = [] } = {}) {
  const problems = [];
  const lower = text.toLowerCase();
  const fileLower = file.toLowerCase();
  for (const { term, source } of terms) {
    const needle = term.toLowerCase();
    if (fileLower.includes(needle))
      problems.push(problem(file, 0, 'C2', `${source} no nome do arquivo: ${maskTerm(term)}`));
    let index = lower.indexOf(needle);
    while (index !== -1) {
      problems.push(problem(file, lineNumber(text, index), 'C2', `${source}: ${maskTerm(term)}`));
      index = lower.indexOf(needle, index + needle.length);
    }
  }
  for (const pattern of PROJECT_REF_PATTERNS)
    for (const match of text.matchAll(pattern))
      if (!EXAMPLE_PROJECT_REFS.includes(match[1]))
        problems.push(
          problem(
            file,
            lineNumber(text, match.index),
            'C3',
            `ref de projeto Supabase real (${maskTerm(match[1])}): use <SEU_PROJECT_REF> ou o ref de exemplo abcdefghijklmnopqrst`,
          ),
        );
  for (const [pattern, label] of SECRET_PATTERNS) {
    const global = new RegExp(pattern.source, 'g');
    for (const match of text.matchAll(global))
      problems.push(problem(file, lineNumber(text, match.index), 'C4', `segredo: ${label}`));
  }
  for (const match of text.matchAll(EMAIL)) {
    const domain = match[1].toLowerCase();
    const line = lineNumber(text, match.index);
    if (domain.endsWith('users.noreply.github.com'))
      problems.push(problem(file, line, 'C5', 'endereço noreply do GitHub, que carrega um usuário'));
    else if (/(^|\.)supabase\.com?$/.test(domain) || SERVICE_EMAILS.includes(match[0].toLowerCase())) continue;
    else if (!RESERVED_EMAIL_DOMAIN.test(domain) && !(domain in EXAMPLE_EMAIL_DOMAINS))
      problems.push(
        problem(
          file,
          line,
          'C5',
          `e-mail com domínio real (${maskTerm(domain)}): use um domínio reservado, como nome@empresa.example`,
        ),
      );
  }
  for (const match of text.matchAll(USER_PATH)) {
    const name = match[1] ?? match[2] ?? match[3];
    if (ALLOWED_USER_NAMES.has(name) || name.startsWith('<') || name.startsWith('%') || name.startsWith('$')) continue;
    problems.push(
      problem(file, lineNumber(text, match.index), 'C6', `caminho de usuário real (${maskTerm(name)}): use <você>`),
    );
  }
  if (file.endsWith('.md')) {
    if (!OWNER_FOLDER_DOCS.includes(file)) {
      const found = OWNER_FOLDER_MENTION.exec(text);
      if (found)
        for (const [index, line] of text.split('\n').entries())
          if (OWNER_FOLDER_MENTION.test(line))
            problems.push(
              problem(
                file,
                index + 1,
                'C7',
                'documento distribuível cita a pasta de registros do dono: escreva "o registro do ambiente do dono (fora da distribuição)", sem caminho nem link',
              ),
            );
    }
    for (const { target, index } of markdownLinkTargets(text))
      if (linksToOwnerFolder(file, target))
        problems.push(
          problem(
            file,
            lineNumber(text, index),
            'C7',
            'link para a pasta de registros do dono, que fica fora da distribuição',
          ),
        );
  }
  if (isLivingDoc(file))
    for (const [index, line] of text.split('\n').entries())
      if (LEGACY_MENTION.test(line) && !line.toLowerCase().includes('repositório da base'))
        problems.push(
          problem(
            file,
            index + 1,
            'C8',
            'a tag legacy-archive e o .git-blame-ignore-revs existem só no repositório da base: diga isso na mesma linha ("no repositório da base")',
          ),
        );
  if (ENV_EXAMPLE_FILES.includes(file)) problems.push(...envExampleProblems(file, text));
  return maskProblems(problems, terms);
}

/** C9: o workflow de backup desligado por variável e com toda credencial vinda de secrets. */
export function backupWorkflowProblems(text, file = BACKUP_WORKFLOW_FILE) {
  const problems = [];
  if (!/^ {4}if: vars\.CRM_BACKUP_ENABLED == 'true'\s*$/m.test(text))
    problems.push(
      problem(
        file,
        0,
        'C9',
        "o job do backup precisa da condição if: vars.CRM_BACKUP_ENABLED == 'true' (desligado por padrão)",
      ),
    );
  const credential =
    /^\s*(DB_URL|ARCHIVE_PASSWORD|RCLONE_CONFIG_CONTENT|CRM_BACKUP_DB_URL|CRM_BACKUP_PASSWORD|CRM_BACKUP_RCLONE_CONFIG)\s*:\s*(.*)$/;
  for (const [index, line] of text.split('\n').entries()) {
    const match = credential.exec(line);
    if (match && !/^\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}\s*$/.test(match[2]))
      problems.push(
        problem(file, index + 1, 'C9', `${match[1]} precisa vir de \${{ secrets.… }}, nunca de um valor no arquivo`),
      );
  }
  return problems;
}

/** C10: a marca distribuída é a do programa, válida. */
export function brandProblems(dir, file = BRAND_JSON_FILE) {
  try {
    const brand = readBrand({ dir });
    return isProgramBrand(brand)
      ? []
      : [problem(file, 0, 'C10', 'a marca distribuída precisa ser a do programa (productName com Empreende IA)')];
  } catch (error) {
    return [problem(file, 0, 'C10', `marca inválida: ${error.message.split('\n')[0]}`)];
  }
}

/** C11: o pacote continua privado e com a licença da base. */
export function packageProblems(text, file = 'package.json') {
  try {
    const pkg = JSON.parse(text);
    const problems = [];
    if (pkg.private !== true) problems.push(problem(file, 0, 'C11', 'package.json precisa de "private": true'));
    if (pkg.license !== 'SEE LICENSE IN LICENSE')
      problems.push(problem(file, 0, 'C11', 'package.json precisa de "license": "SEE LICENSE IN LICENSE"'));
    return problems;
  } catch {
    return [problem(file, 0, 'C11', 'package.json não é um JSON válido')];
  }
}

/**
 * A conferência inteira de uma pasta: a classificação dos arquivos (C1), o conteúdo dos incluídos (C2 a C8) e os
 * arquivos especiais (C9 a C11). `files` são os caminhos relativos a `dir`; `terms` vem de `privateTerms`.
 */
export function distributionProblems({ dir, files, terms = [], policy = DISTRIBUTION_POLICY }) {
  const problems = classificationProblems(files, policy);
  const included = classifyFiles(files, policy).included.map((entry) => entry.file);
  for (const file of included) {
    const absolute = path.join(dir, file);
    const bytes = readFileSync(absolute);
    // Grande demais: reprova sem ler o conteúdo (as expressões de e-mail e segredo levariam minutos num texto assim).
    const tooBig = bytes.length > MAX_FILE_BYTES;
    if (tooBig) problems.push(problem(file, 0, 'C1', `arquivo com mais de ${MAX_FILE_BYTES / 1024 / 1024} MB`));
    if (tooBig || isBinary(file, bytes)) {
      for (const { term, source } of terms)
        if (file.toLowerCase().includes(term.toLowerCase()))
          problems.push(problem(file, 0, 'C2', `${source} no nome do arquivo: ${maskTerm(term)}`));
      continue;
    }
    const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
    problems.push(...contentProblems(file, text, { terms }));
    if (file === BACKUP_WORKFLOW_FILE) problems.push(...backupWorkflowProblems(text));
    if (file === 'package.json') problems.push(...packageProblems(text));
  }
  if (included.includes(BRAND_JSON_FILE)) problems.push(...brandProblems(path.join(dir, 'public', 'brand')));
  return maskProblems(problems, terms);
}

export const formatProblem = ({ file, line, rule: ruleId, message }) =>
  `${file}${line ? `:${line}` : ''} — ${ruleId}: ${message}`;

// ---------------------------------------------------------------------------------------------------------------------
// Git

/**
 * O ambiente do `git` sem a configuração pessoal de quem roda: sem a global (um arquivo vazio temporário), sem a do
 * sistema e sem variáveis que apontem outro repositório. A identidade vem só do `--author`.
 */
export function isolatedGitEnv(env = process.env, { emptyConfig, author } = {}) {
  const clean = { ...env };
  for (const key of Object.keys(clean))
    if (/^GIT_/.test(key) && !['GIT_EXEC_PATH', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS'].includes(key))
      delete clean[key];
  clean.GIT_CONFIG_GLOBAL = emptyConfig;
  clean.GIT_CONFIG_NOSYSTEM = '1';
  clean.GIT_TERMINAL_PROMPT = '0';
  if (author) {
    clean.GIT_AUTHOR_NAME = author.name;
    clean.GIT_AUTHOR_EMAIL = author.email;
    clean.GIT_COMMITTER_NAME = author.name;
    clean.GIT_COMMITTER_EMAIL = author.email;
  }
  return clean;
}

export function git(cwd, args, { env = process.env, allowFailure = false, input } = {}) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) {
    if (allowFailure) return { status: 1, stdout: '', stderr: String(result.error.message) };
    throw new Error(`git ${args.join(' ')}: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure)
    throw new Error(`git ${args.join(' ')} falhou: ${(result.stderr || result.stdout).trim()}`);
  return result;
}

/** Os arquivos da pasta de trabalho: versionados e novos ainda não ignorados, sem os apagados. */
export function workingTreeFiles(root, env = process.env) {
  const listed = git(
    root,
    ['-c', 'core.quotepath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      env,
    },
  ).stdout;
  return [...new Set(listed.split('\0').filter(Boolean))].filter((file) => existsSync(path.join(root, file))).sort();
}

/** Os versionados com modo de link simbólico (120000) ou submódulo (160000), que a distribuição recusa. */
export function specialModeFiles(root, env = process.env) {
  const staged = git(root, ['ls-files', '-s', '-z'], { env }).stdout;
  return staged
    .split('\0')
    .filter(Boolean)
    .map((entry) => /^(\d{6}) [0-9a-f]+ \d+\t(.+)$/.exec(entry))
    .filter((match) => match && (match[1] === '120000' || match[1] === '160000'))
    .map((match) => match[2]);
}

/** O histórico de uma distribuição: só commits `chore: versão …` (ou o de ensaio aceito), com a identidade igual. */
export function distributionHistoryProblems({ log, packageVersion, terms = [], allowRehearsal = false }) {
  const problems = [];
  const commits = String(log ?? '')
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, an, ae, cn, ce, subject] = entry.split('\x1f');
      return { hash, an, ae, cn, ce, subject };
    });
  if (!commits.length) problems.push(problem('.git', 0, 'H1', 'a distribuição não tem nenhum commit'));
  for (const [index, commit] of commits.entries()) {
    const short = commit.hash.slice(0, 7);
    const rehearsal = commit.subject.startsWith(REHEARSAL_COMMIT_PREFIX);
    if (rehearsal && !(allowRehearsal && index === 0 && commits.length === 1))
      problems.push(
        problem('.git', 0, 'H1', `commit ${short} é de ensaio ("${commit.subject}"): nunca envie um ensaio`),
      );
    else if (!rehearsal && !commit.subject.startsWith(VERSION_COMMIT_PREFIX))
      problems.push(
        problem(
          '.git',
          0,
          'H1',
          `commit ${short} não é de versão ("${commit.subject.slice(0, 60)}"): esta pasta não parece a distribuição (é a base?)`,
        ),
      );
    if (commit.an !== commit.cn || commit.ae !== commit.ce)
      problems.push(problem('.git', 0, 'H1', `commit ${short} com autor e committer diferentes`));
    for (const { term, source } of terms)
      if (`${commit.an}\n${commit.ae}\n${commit.cn}\n${commit.ce}`.toLowerCase().includes(term.toLowerCase()))
        problems.push(problem('.git', 0, 'H1', `commit ${short} com ${source}: ${maskTerm(term)}`));
  }
  const top = commits[0];
  if (top && !top.subject.startsWith(REHEARSAL_COMMIT_PREFIX)) {
    const version = top.subject.slice(VERSION_COMMIT_PREFIX.length).trim();
    if (version !== packageVersion)
      problems.push(
        problem(
          '.git',
          0,
          'H1',
          `o commit do topo é da versão ${version}, mas o package.json está em ${packageVersion}`,
        ),
      );
  }
  return problems;
}

export const HISTORY_FORMAT = '%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%s%x1e';
// No for-each-ref, o byte vai como %1f (sem o x do formato do git log).
export const TAG_FORMAT =
  '%(refname:short)%1f%(objecttype)%1f%(taggername)%1f%(taggeremail)%1f%(*authorname)%1f%(*authoremail)%1e';

/**
 * As tags de uma distribuição (`git for-each-ref refs/tags --format=TAG_FORMAT`): anotadas, com quem criou a tag igual
 * ao autor do commit dela (a identidade do programa) e sem termo pessoal. O `git tag -a` usa a identidade de quem roda,
 * e a tag vai junto com o clone dos alunos.
 */
export function distributionTagProblems({ refs, terms = [] }) {
  const problems = [];
  const tags = String(refs ?? '')
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, type, taggerName, taggerEmail, authorName, authorEmail] = entry.split('\x1f');
      return { name, type, taggerName, taggerEmail: taggerEmail.replace(/^<|>$/g, ''), authorName, authorEmail };
    });
  for (const tag of tags) {
    const shown = maskPath(tag.name, terms);
    if (tag.type !== 'tag') {
      problems.push(
        problem('.git', 0, 'H2', `a tag ${shown} não é anotada: use git tag -a, com a identidade do programa`),
      );
      continue;
    }
    const identity = `${tag.taggerName}\n${tag.taggerEmail}`.toLowerCase();
    const found = terms.find(({ term }) => identity.includes(term.toLowerCase()));
    if (found) problems.push(problem('.git', 0, 'H2', `a tag ${shown} tem ${found.source}: ${maskTerm(found.term)}`));
    if (tag.taggerName !== tag.authorName || tag.taggerEmail !== tag.authorEmail.replace(/^<|>$/g, ''))
      problems.push(
        problem(
          '.git',
          0,
          'H2',
          `a tag ${shown} foi criada por outra identidade, não a do commit da versão: apague-a (git tag -d) e crie de novo com git -c user.name=… -c user.email=… tag -a`,
        ),
      );
  }
  return problems;
}

/**
 * A conferência de uma árvore gerada (`release:check -- --dist <pasta>`): todo arquivo versionado dela na allowlist e
 * sem proibido, o conteúdo, o histórico e as tags. Os termos vêm do repositório de quem roda (a base). `history: false`
 * confere só o conteúdo: num pull request do repositório de distribuição, o checkout é o commit de merge que o GitHub
 * cria, que nunca é de versão (a distribuição não aceita PR; a correção sai na versão seguinte da base).
 */
export function checkDistributionFolder({
  dir,
  terms = [],
  allowRehearsal = false,
  history = true,
  policy = DISTRIBUTION_POLICY,
}) {
  if (!existsSync(path.join(dir, '.git')))
    return [problem(dir, 0, 'H1', 'a pasta não é um repositório Git (rode o npm run release:dist antes)')];
  const env = isolatedGitEnv(process.env, { emptyConfig: emptyGitConfig() });
  const files = git(dir, ['-c', 'core.quotepath=false', 'ls-files', '-z'], { env }).stdout.split('\0').filter(Boolean);
  const problems = [];
  for (const { file } of classifyFiles(files, policy).excluded)
    problems.push(problem(file, 0, 'C1', 'arquivo excluído pela allowlist está na distribuição'));
  const status = git(dir, ['status', '--porcelain'], { env }).stdout.trim();
  if (status) problems.push(problem(dir, 0, 'H1', 'a pasta tem mudanças sem commit: o que vai é o commit, confira'));
  problems.push(...distributionProblems({ dir, files, terms, policy }));
  if (history) {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const log = git(dir, ['log', `--format=${HISTORY_FORMAT}`], { env, allowFailure: true }).stdout;
    problems.push(...distributionHistoryProblems({ log, packageVersion: pkg.version, terms, allowRehearsal }));
    const refs = git(dir, ['for-each-ref', 'refs/tags', `--format=${TAG_FORMAT}`], { env, allowFailure: true }).stdout;
    problems.push(...distributionTagProblems({ refs, terms }));
  }
  return maskProblems(problems, terms);
}

/** No repositório de distribuição, o histórico só é conferido fora de pull request (ver checkDistributionFolder). */
export const distributionHistoryChecked = (env = process.env) => env.GITHUB_EVENT_NAME !== 'pull_request';

let emptyConfigPath = null;
/** Um arquivo de configuração do Git vazio, criado uma vez por processo na pasta temporária do sistema. */
export function emptyGitConfig() {
  if (emptyConfigPath && existsSync(emptyConfigPath)) return emptyConfigPath;
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-dist-git-'));
  emptyConfigPath = path.join(dir, 'gitconfig');
  writeFileSync(emptyConfigPath, '');
  mkdirSync(path.join(dir, 'hooks'));
  return emptyConfigPath;
}
const emptyHooksDir = () => path.join(path.dirname(emptyGitConfig()), 'hooks');

// ---------------------------------------------------------------------------------------------------------------------
// release:dist (seção 5)

export class DistributionError extends Error {}

/** `Nome <e-mail>` → `{ name, email }`, ou `null`. */
export function parseAuthor(value) {
  const match = /^\s*([^<>]*[^<>\s])\s*<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>\s*$/.exec(String(value ?? ''));
  return match ? { name: match[1], email: match[2] } : null;
}

/** O autor recusado por ser (ou conter) um termo pessoal. */
export function authorTermProblem(author, terms) {
  const identity = `${author.name}\n${author.email}`.toLowerCase();
  const found = terms.find(({ term }) => identity.includes(term.toLowerCase()));
  return found
    ? `O autor tem um ${found.source} (${maskTerm(found.term)}): use a identidade do programa, por exemplo "Base do CRM <base@<domínio do programa>>".`
    : null;
}

const isInside = (child, parent) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

function removeEmptyDirs(dir, root) {
  if (dir === root || !existsSync(dir)) return;
  if (readdirSync(dir).length === 0) {
    rmSync(dir, { recursive: true });
    removeEmptyDirs(path.dirname(dir), root);
  }
}

/**
 * Monta a árvore de uma versão (seção 5.2 do desenho). Recusa tudo antes de escrever (seção 5.3). Devolve o resumo.
 * `root` é o repositório da base; `out`, a pasta da distribuição; `author`, `Nome <e-mail>`. Nunca envia nem cria tag.
 */
export function buildDistribution({
  root = ROOT,
  out,
  author: authorText,
  rehearsal = false,
  env = process.env,
  policy = DISTRIBUTION_POLICY,
  log = () => undefined,
}) {
  const refuse = (message) => {
    throw new DistributionError(message);
  };
  if (!out) refuse('Falta --out <pasta>: a pasta da distribuição, fora do repositório da base.');
  const author = parseAuthor(authorText);
  if (!author)
    refuse('Falta --author "Nome <e-mail>" com a identidade do programa (autor e committer do commit da versão).');
  const target = path.resolve(out);
  const base = path.resolve(root);
  const gitEnv = isolatedGitEnv(env, { emptyConfig: emptyGitConfig(), author });
  const top = git(base, ['rev-parse', '--show-toplevel'], { env: gitEnv, allowFailure: true });
  if (top.status !== 0) refuse('A distribuição só sai de um repositório Git da base.');
  if (isInside(target, base))
    refuse(
      'A pasta da distribuição precisa ficar fora do repositório da base: dentro dele, o Vitest, o ESLint e o docs:links leriam a cópia.',
    );
  if (isInside(base, target))
    refuse('O repositório da base está dentro da pasta da distribuição: escolha outra pasta.');

  // 1. Base.
  const pkg = JSON.parse(readFileSync(path.join(base, 'package.json'), 'utf8'));
  const version = pkg.version;
  if (!isSemver(version)) refuse(`A versão ${version} do package.json não é SemVer.`);
  const dirty = git(base, ['status', '--porcelain'], { env: gitEnv }).stdout.trim();
  if (dirty && !rehearsal)
    refuse('A base tem mudanças sem commit: faça o commit (ou use --rehearsal para um ensaio numa pasta nova).');
  if (!rehearsal) {
    if (isDevelopmentVersion(version))
      refuse(
        `A versão ${version} termina em .0 e nunca é distribuída: lance a versão na base antes (docs/ATUALIZACAO.md, "Para quem mantém a base"), ou use --rehearsal para um ensaio.`,
      );
    const published = changelogSections(readFileSync(path.join(base, 'CHANGELOG.md'), 'utf8')).find(
      (section) => section.version,
    );
    if (published?.version !== version)
      refuse(
        `O package.json está em ${version}, mas a última versão com data do CHANGELOG.md é ${published?.version ?? 'nenhuma'}.`,
      );
  }
  const termsInfo = privateTerms({ root: base, env });
  if (!rehearsal && (!termsInfo.base || termsInfo.problems.length))
    refuse('A distribuição só sai do repositório da base, com o registro do ambiente do dono e o ref do projeto.');
  const authorProblem = authorTermProblem(author, termsInfo.terms);
  if (authorProblem) refuse(authorProblem);

  // 2 e 3. Arquivos e conteúdo.
  const special = specialModeFiles(base, gitEnv);
  if (special.length)
    refuse(
      `Link simbólico ou submódulo não vai na distribuição: ${special.map((file) => maskPath(file, termsInfo.terms)).join(', ')}.`,
    );
  const files = workingTreeFiles(base, gitEnv);
  const problems = [
    ...termsInfo.problems,
    ...distributionProblems({ dir: base, files, terms: termsInfo.terms, policy }),
  ];
  if (problems.length)
    refuse(
      `A conferência reprovou (${problems.length}):\n${problems.map((entry) => `  ${formatProblem(entry)}`).join('\n')}`,
    );
  const included = classifyFiles(files, policy).included.map((entry) => entry.file);

  // 4. Pasta de destino.
  let mode = 'first';
  let previousVersion = null;
  if (existsSync(target)) {
    if (!statSync(target).isDirectory()) refuse(`${target} existe e não é uma pasta.`);
    const entries = readdirSync(target);
    if (entries.length && !entries.includes('.git'))
      refuse(
        'Pasta não vazia que não é uma distribuição: use uma pasta nova (primeira versão) ou um clone do repositório de distribuição.',
      );
    if (entries.includes('.git')) {
      mode = 'next';
      if (rehearsal) refuse('Ensaio só em pasta nova: o commit de ensaio nunca entra no repositório de distribuição.');
      const subject = git(target, ['log', '-1', '--format=%s'], { env: gitEnv, allowFailure: true }).stdout.trim();
      let distPkg = null;
      try {
        distPkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
      } catch {
        distPkg = null;
      }
      if (!subject.startsWith(VERSION_COMMIT_PREFIX) || distPkg?.name !== pkg.name)
        refuse(
          'Não parece o repositório de distribuição: o commit do topo precisa ser "chore: versão …", com o mesmo package.json.',
        );
      const changes = git(target, ['status', '--porcelain', '--untracked-files=all'], { env: gitEnv }).stdout.trim();
      if (changes)
        refuse('Pasta com mudanças: confira e rode git reset --hard e git clean -fd nela antes de gerar a versão.');
      previousVersion = subject.slice(VERSION_COMMIT_PREFIX.length).trim();
      const tag = git(target, ['tag', '--list', `v${version}`], { env: gitEnv }).stdout.trim();
      if (!isSemver(previousVersion) || compareSemver(version, previousVersion) <= 0 || tag)
        refuse(
          `A versão ${version} já foi distribuída (a distribuição está em ${previousVersion}): lance uma versão nova na base.`,
        );
    }
  }

  // 5. Cópia.
  if (mode === 'first') mkdirSync(target, { recursive: true });
  else {
    const tracked = git(target, ['-c', 'core.quotepath=false', 'ls-files', '-z'], { env: gitEnv })
      .stdout.split('\0')
      .filter(Boolean);
    for (const file of tracked) {
      rmSync(path.join(target, file), { force: true });
      removeEmptyDirs(path.dirname(path.join(target, file)), target);
    }
  }
  let bytes = 0;
  for (const file of included) {
    const destination = path.join(target, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(base, file), destination);
    bytes += statSync(destination).size;
  }

  // 6. Commit, com a configuração pessoal isolada.
  const config = [
    '-c',
    `user.name=${author.name}`,
    '-c',
    `user.email=${author.email}`,
    '-c',
    'core.autocrlf=false',
    '-c',
    'commit.gpgsign=false',
    '-c',
    `core.hooksPath=${emptyHooksDir()}`,
    '-c',
    `init.defaultBranch=${DISTRIBUTION_BRANCH}`,
  ];
  if (mode === 'first') {
    const init = git(target, [...config, 'init', '-b', DISTRIBUTION_BRANCH], { env: gitEnv, allowFailure: true });
    if (init.status !== 0) {
      git(target, [...config, 'init'], { env: gitEnv });
      git(target, ['symbolic-ref', 'HEAD', `refs/heads/${DISTRIBUTION_BRANCH}`], { env: gitEnv });
    }
  }
  // A identidade do programa também na configuração local da pasta: o `git tag -a` do @devops e qualquer commit feito
  // ali usam ela, e não a pessoal (o .git/config não vai no envio).
  git(target, ['config', '--local', 'user.name', author.name], { env: gitEnv });
  git(target, ['config', '--local', 'user.email', author.email], { env: gitEnv });
  // Os apagados pelo `add -A`; os copiados pela lista exata, com `-f`: um arquivo versionado na base com `git add -f`,
  // que o .gitignore copiado ignora, entraria na pasta e ficaria fora do commit.
  git(target, [...config, 'add', '-A'], { env: gitEnv });
  git(target, [...config, '--literal-pathspecs', 'add', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], {
    env: gitEnv,
    input: `${included.join('\0')}\0`,
  });
  const staged = git(target, ['-c', 'core.quotepath=false', 'ls-files', '-z'], { env: gitEnv })
    .stdout.split('\0')
    .filter(Boolean)
    .sort();
  const expected = [...included].sort();
  if (staged.length !== expected.length || staged.some((file, index) => file !== expected[index]))
    throw new Error(
      `O commit da versão teria arquivos diferentes dos copiados (${staged.length} no índice, ${expected.length} copiados): apague a pasta (ou rode git reset --hard e git clean -fd nela) e confira.`,
    );
  const message = rehearsal
    ? [`${REHEARSAL_COMMIT_PREFIX}${version} (não publicar)`]
    : [`${VERSION_COMMIT_PREFIX}${version}`, 'Base do CRM. O que mudou e o que fazer ao atualizar: CHANGELOG.md.'];
  git(target, [...config, 'commit', '--no-verify', '-q', ...message.flatMap((part) => ['-m', part])], { env: gitEnv });
  const commit = git(target, ['rev-parse', 'HEAD'], { env: gitEnv }).stdout.trim();
  const baseCommit = git(base, ['rev-parse', 'HEAD'], { env: gitEnv }).stdout.trim();
  log(`Versão ${version}${rehearsal ? ' (ensaio)' : ''}: ${included.length} arquivos.`);
  return {
    version,
    previousVersion,
    mode,
    rehearsal,
    files: included.length,
    bytes,
    commit,
    baseCommit,
    baseDirty: Boolean(dirty),
    out: target,
    author,
  };
}

/**
 * Os passos do @devops depois da geração (seção 10 do desenho, passos 5 a 8), que o script só mostra. A tag leva a
 * identidade do programa explícita: sem ela, o `git tag -a` grava o nome e o e-mail pessoais de quem roda.
 */
export function devopsSteps({ version, mode, author = { name: '<nome do programa>', email: '<e-mail do programa>' } }) {
  return [
    `cd "<pasta da distribuição>"`,
    'git log --format="%h %an <%ae> %s"   (só commits de versão, com a identidade do programa)',
    ...(mode === 'first' ? ['git remote add origin https://github.com/<organização>/<repositório>.git'] : []),
    `git -c user.name="${author.name}" -c user.email="${author.email}" tag -a v${version} -m "v${version}"`,
    'npm run release:check -- --dist "<pasta da distribuição>"   (no repositório da base: confere também a tag)',
    `git push origin ${DISTRIBUTION_BRANCH}`,
    `git push origin v${version}`,
  ];
}
