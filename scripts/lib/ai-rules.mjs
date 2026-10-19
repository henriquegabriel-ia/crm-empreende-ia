// Regras para IA (item 1.8; docs/arquitetura/1.8.md, seções 4.6 e 5.4) e guias de quem implanta (item 1.4): as
// conferências puras que o teste ai-rules.test.mjs aplica aos arquivos reais e a fixtures de mutação. Reprovam um
// `npm run` que não existe no package.json, um caminho citado entre crases que não existe, uma função ou tabela de public
// ou private fora do manifesto, o CLAUDE.md sem a importação do AGENTS.md, os limites de tamanho, os comandos da suíte
// fora da ordem do CI e um invariante do roteiro que o AGENTS.md deixou de citar. Achado 2 da revisão do 1.8: antes, a
// conferência de tamanho e a da importação moravam só no teste dos arquivos reais, e as mutações não passavam por elas.
import { BASE_REPOSITORY_VARIABLE } from './base-manifest.mjs';

export const AGENTS_MAX_LINES = 200;
export const CLAUDE_MAX_LINES = 30;
/** Os comandos da suíte, na ordem do CI (seção 4.4 do desenho do 1.8), que o AGENTS.md precisa citar. */
export const SUITE_COMMANDS = [
  'format:check',
  'docs:links',
  'lint:ci',
  'typecheck',
  'test',
  'test:db',
  'gen:types:check',
  'manifest:check',
  'emails:check',
  'build',
  'test:e2e',
];

/**
 * Os termos-chave dos invariantes das linhas "Do 1.x" do item 1.8 no roteiro e da seção 4.3 do desenho, que o AGENTS.md
 * precisa citar (revisão do 1.8, rodada 1: vários tinham ficado de fora sem nenhum teste acusar). Achado 1 da revisão do
 * 1.8 (corrigido no 1.4): a regra do `grant execute` cobre a função usada numa política e num DEFAULT de coluna.
 */
export const REQUIRED_INVARIANT_TERMS = [
  'private.custom_',
  'private.assert_base_definition',
  'private.current_org()',
  'profiles.org_id',
  'enable_confirmations',
  'npm run config:push',
  "'unsafe-eval'",
  'public/theme-init.js',
  'readOwnerFilter',
  'leadSourceLabel',
  'TEAM_VIEWER_ROLES',
  'activityReminders',
  'snapshot de Hoje',
  'aria-hidden',
  'src/lib/contact-import.ts',
  'mesmas chaves',
  'scripts/e2e-server.mjs',
  'public.anonymize_contact',
  'private.guard_anonymized_contact',
  'private.refuse_do_not_contact_action',
  'security definer',
  'src/lib/channels.ts',
  'public.complete_activity',
  'contact-model.ts',
  'exportFileName',
  'nomes da equipe',
  'BrandFooter',
  'public/brand/',
  'tokens do design system',
  'private.portfolio_counts',
  'private.role_change_allowed',
  'DEMO_SCHEMA',
  'RESTORE_SEEDED_TABLES',
  'SAVE_DEAL_CREATE_FIELDS',
  'SAVE_DEAL_EDIT_FIELDS',
  'public.create_invitation',
  'private.provision_organization',
  'private.instance_status',
  'private.email_proven',
  'private.discard_unproven_password',
  'private.record_email_proof',
  'VITE_',
  'npm run emails:build',
  'num `DEFAULT` de coluna',
];

/**
 * Arquivos que cada instância cria no próprio computador e que o repositório nunca tem (o `supabase/.env` do
 * config:check, o `.env.txt` que o Bloco de Notas grava por engano, o `.env.local` do Supabase local e o projeto ligado
 * pelo CLI): os guias de quem implanta os citam, e a conferência dos caminhos os aceita.
 */
export const INSTANCE_LOCAL_FILES = Object.freeze([
  'supabase/.env',
  'supabase/.env.txt',
  'supabase/.env.local',
  'supabase/.temp/project-ref',
]);

/** Os scripts citados como `npm run <nome>` ou `npm test`. */
export function citedCommands(text) {
  const commands = [...text.matchAll(/\bnpm run ([a-z][\w:-]*)/g)].map((match) => match[1]);
  if (/\bnpm test\b/.test(text)) commands.push('test');
  return [...new Set(commands)];
}

const REPO_DIRS = /^(src|scripts|supabase|docs|public|tests|\.github)\//;
const ROOT_FILE = /^[A-Za-z0-9_.-]+\.(md|json|ts|mjs|js|toml|html)$/;
/**
 * Os textos entre crases com cara de caminho do repositório, fora os do aluno (`src/custom/`, `*_custom_*`), os
 * genéricos (`<...>`, `*`), os com espaço e os arquivos locais de cada instância (INSTANCE_LOCAL_FILES).
 */
export function citedPaths(text) {
  const paths = [];
  for (const [, raw] of text.matchAll(/`([^`\n]+)`/g)) {
    const value = raw.trim();
    if (/\s/.test(value) || /[<>*]/.test(value) || /(^|\/)src\/custom\//.test(value) || /_custom_/.test(value))
      continue;
    const cited = value.replace(/[.,;:]$/, '');
    if (INSTANCE_LOCAL_FILES.includes(cited)) continue;
    if (REPO_DIRS.test(value) || ROOT_FILE.test(value)) paths.push(cited);
  }
  return [...new Set(paths)];
}

/** Os objetos `public.<nome>` e `private.<nome>` citados, sem os `custom_*` de quem personaliza. */
export function citedDatabaseObjects(text) {
  return [
    ...new Set(
      [...text.matchAll(/\b(public|private)\.([a-z_][a-z0-9_]*)\b/g)]
        .map((match) => `${match[1]}.${match[2]}`)
        .filter((name) => !name.split('.')[1].startsWith('custom_')),
    ),
  ];
}

/** Os blocos de código precedidos de `<!-- exemplo: <caminho em exemplos/> -->`. */
export function exampleSnippets(guide) {
  return [...guide.matchAll(/<!-- exemplo: ([^\s]+) -->\s*\n```[a-z]*\n([\s\S]*?)```/g)].map((match) => ({
    file: match[1],
    code: match[2],
  }));
}

/**
 * O ref do projeto do dono, lido em tempo de execução de `docs/dono/AMBIENTE.md` (o literal só pode aparecer em
 * docs/dono/). Nos clones sem esse arquivo, sobra a conferência genérica de `<ref>.supabase.co`.
 */
export function ownerProjectRef(text) {
  return text?.match(/\| Referência \| `([a-z]{20})` \|/)?.[1] ?? null;
}

/** Cita um projeto Supabase real: o ref do dono, quando conhecido, ou qualquer `<ref de 20 letras>.supabase.co`. */
export function citesProjectRef(text, ref = null) {
  return /\b[a-z]{20}\.supabase\.co\b/.test(text) || (ref !== null && text.includes(ref));
}

/**
 * Os arquivos de `src/custom` que a base não pode ter. Só no repositório da base (`CRM_BASE_REPOSITORY=true`, como a
 * recusa das migrações `_custom_` em `baseRepositoryProblems`): no clone de quem personaliza, a pasta é dele.
 */
export function baseCustomFolderProblems(files, env = process.env) {
  if (env[BASE_REPOSITORY_VARIABLE] !== 'true') return [];
  return files.filter((name) => name !== '.gitkeep');
}

const lineCount = (text) => text.trimEnd().split('\n').length;

/**
 * Os comandos e os caminhos citados por um guia que não existem (AC-2 do item 1.4, para os guias de quem implanta, e o
 * mesmo critério das regras para IA). `exists(caminho)` responde se o caminho existe no repositório.
 */
export function guideReferenceProblems(file, text, { scripts, exists }) {
  const problems = [];
  for (const command of citedCommands(text))
    if (!(command in scripts)) problems.push(`${file} cita npm run ${command}, que não existe no package.json`);
  for (const cited of citedPaths(text))
    if (!exists(cited)) problems.push(`${file} cita ${cited}, que não existe no repositório`);
  return problems;
}

/**
 * Todos os problemas das regras para IA, de uma vez: `agents` e `claude` são os textos do AGENTS.md e do CLAUDE.md,
 * `guides` é `{ caminho: texto }` dos guias de docs/PERSONALIZAR, `scripts` são os do package.json, `manifestNames` é o
 * conjunto dos nomes do manifesto (funções sem a assinatura) e `exists(caminho)` responde pelo repositório.
 */
export function aiRulesProblems({ agents, claude, guides = {}, scripts, manifestNames, exists }) {
  const problems = [];
  const files = { 'AGENTS.md': agents, 'CLAUDE.md': claude, ...guides };
  for (const [file, text] of Object.entries(files)) {
    problems.push(...guideReferenceProblems(file, text, { scripts, exists }));
    for (const name of citedDatabaseObjects(text))
      if (!manifestNames.has(name)) problems.push(`${file} cita ${name}, que não está no manifesto da base`);
  }
  if (lineCount(agents) > AGENTS_MAX_LINES)
    problems.push(`AGENTS.md tem ${lineCount(agents)} linhas, acima do limite de ${AGENTS_MAX_LINES}`);
  if (lineCount(claude) > CLAUDE_MAX_LINES)
    problems.push(`CLAUDE.md tem ${lineCount(claude)} linhas, acima do limite de ${CLAUDE_MAX_LINES}`);
  if (
    !claude
      .split('\n')
      .map((line) => line.trim())
      .includes('@AGENTS.md')
  )
    problems.push('CLAUDE.md não importa o AGENTS.md (a linha @AGENTS.md)');
  if (/org_id|VITE_|service_role/.test(claude))
    problems.push(
      'CLAUDE.md repete invariantes do AGENTS.md (org_id, VITE_ ou service_role): eles moram só no AGENTS.md',
    );
  const validation = agents.indexOf('## Como validar');
  const section = validation === -1 ? '' : agents.slice(validation);
  const positions = SUITE_COMMANDS.map((command) =>
    command === 'test' ? section.indexOf('`npm test`') : section.indexOf(`\`npm run ${command}\``),
  );
  const missing = SUITE_COMMANDS.filter((_, index) => positions[index] === -1);
  if (missing.length) problems.push(`AGENTS.md não cita na seção "Como validar": ${missing.join(', ')}`);
  else if (positions.some((position, index) => index > 0 && position < positions[index - 1]))
    problems.push('AGENTS.md cita os comandos da suíte fora da ordem do CI');
  const absentTerms = REQUIRED_INVARIANT_TERMS.filter((term) => !agents.includes(term));
  if (absentTerms.length) problems.push(`AGENTS.md não cita os invariantes: ${absentTerms.join(', ')}`);
  return problems;
}
