// Item 1.8 (docs/arquitetura/1.8.md, seções 4.6 e 5.4): as regras para IA (AGENTS.md e CLAUDE.md) e os guias de
// docs/PERSONALIZAR continuam verdadeiros. Reprova: um `npm run` que não existe no package.json, um caminho citado entre
// crases que não existe, uma função ou tabela de public ou private fora do manifesto, o CLAUDE.md sem a importação do
// AGENTS.md, os limites de tamanho, o ref do projeto do dono e o framework pessoal dele; e um bloco de código dos guias
// marcado como trecho do exemplo que não é trecho literal do arquivo do exemplo.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_REPOSITORY_VARIABLE, GUIDE_FILE, MANIFEST_FILE } from './base-manifest.mjs';
import { ROOT } from './embedded-db.mjs';

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const PERSONALIZAR = 'docs/PERSONALIZAR';
const EXAMPLES = `${PERSONALIZAR}/exemplos`;
const GUIDES = readdirSync(path.join(ROOT, PERSONALIZAR))
  .filter((name) => name.endsWith('.md'))
  .map((name) => `${PERSONALIZAR}/${name}`);
const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', ...GUIDES];
export const AGENTS_MAX_LINES = 200;
export const CLAUDE_MAX_LINES = 30;
/** Os comandos da suíte, na ordem do CI (seção 4.4 do desenho), que o AGENTS.md precisa citar. */
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
 * precisa citar (revisão do 1.8, rodada 1: vários tinham ficado de fora sem nenhum teste acusar).
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
];

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
 * genéricos (`<...>`, `*`) e os com espaço.
 */
export function citedPaths(text) {
  const paths = [];
  for (const [, raw] of text.matchAll(/`([^`\n]+)`/g)) {
    const value = raw.trim();
    if (/\s/.test(value) || /[<>*]/.test(value) || /(^|\/)src\/custom\//.test(value) || /_custom_/.test(value))
      continue;
    if (REPO_DIRS.test(value) || ROOT_FILE.test(value)) paths.push(value.replace(/[.,;:]$/, ''));
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
const OWNER_DOC = 'docs/dono/AMBIENTE.md';
const OWNER_REF = existsSync(path.join(ROOT, OWNER_DOC)) ? ownerProjectRef(read(OWNER_DOC)) : null;

/** Cita um projeto Supabase real: o ref do dono, quando conhecido, ou qualquer `<ref de 20 letras>.supabase.co`. */
export function citesProjectRef(text, ref = OWNER_REF) {
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

const manifest = JSON.parse(read(MANIFEST_FILE));
const manifestNames = new Set(
  manifest.objects.map((object) =>
    object.kind === 'function' || object.kind === 'hook' ? object.object.split('(')[0] : object.object,
  ),
);
const scripts = JSON.parse(read('package.json')).scripts;

describe('regras para IA (item 1.8)', () => {
  it.each(RULE_FILES)('%s cita só comandos que existem no package.json', (file) => {
    const missing = citedCommands(read(file)).filter((command) => !(command in scripts));
    expect(missing).toEqual([]);
  });

  it('AGENTS.md cita todos os comandos da suíte, na ordem do CI', () => {
    const all = read('AGENTS.md');
    const text = all.slice(all.indexOf('## Como validar'));
    const positions = SUITE_COMMANDS.map((command) =>
      command === 'test' ? text.indexOf('`npm test`') : text.indexOf(`\`npm run ${command}\``),
    );
    expect(positions.every((position) => position > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('AGENTS.md cita cada invariante das linhas "Do 1.x" do item 1.8', () => {
    const agents = read('AGENTS.md');
    expect(REQUIRED_INVARIANT_TERMS.filter((term) => !agents.includes(term))).toEqual([]);
  });

  it.each(RULE_FILES)('%s cita só caminhos que existem', (file) => {
    const missing = citedPaths(read(file)).filter((cited) => !existsSync(path.join(ROOT, cited)));
    expect(missing).toEqual([]);
  });

  it.each(RULE_FILES)('%s cita só funções e tabelas de public e private que estão no manifesto', (file) => {
    const missing = citedDatabaseObjects(read(file)).filter((name) => !manifestNames.has(name));
    expect(missing).toEqual([]);
  });

  it('CLAUDE.md importa o AGENTS.md e fica curto; AGENTS.md fica dentro do limite e aponta os guias', () => {
    const claude = read('CLAUDE.md');
    const agents = read('AGENTS.md');
    expect(claude.split('\n')).toContain('@AGENTS.md');
    expect(claude.trimEnd().split('\n').length).toBeLessThanOrEqual(CLAUDE_MAX_LINES);
    expect(agents.trimEnd().split('\n').length).toBeLessThanOrEqual(AGENTS_MAX_LINES);
    expect(agents).toContain('docs/PERSONALIZAR/README.md');
    expect(agents).toContain(GUIDE_FILE);
    // O CLAUDE.md não repete os invariantes: eles moram só no AGENTS.md.
    expect(claude).not.toMatch(/org_id|VITE_|service_role/);
  });

  it('nenhum arquivo de regras cita o projeto do dono nem o framework pessoal dele', () => {
    for (const file of RULE_FILES) {
      expect(citesProjectRef(read(file)), file).toBe(false);
      expect(read(file), file).not.toMatch(/\bAIOX\b|\bAIOS\b/);
    }
  });

  it('a conferência do ref reprova um projeto Supabase citado, pelo endereço ou pelo ref do dono', () => {
    expect(ownerProjectRef('| Referência | `abcdefghijklmnopqrst` |')).toBe('abcdefghijklmnopqrst');
    expect(citesProjectRef('https://abcdefghijklmnopqrst.supabase.co', null)).toBe(true);
    expect(citesProjectRef('o ref `abcdefghijklmnopqrst`', 'abcdefghijklmnopqrst')).toBe(true);
    expect(citesProjectRef('`https://<ref>.supabase.co`', null)).toBe(false);
  });

  it('no repositório da base, src/custom fica vazia (a pasta é de quem personaliza)', () => {
    const custom = path.join(ROOT, 'src', 'custom');
    expect(baseCustomFolderProblems(existsSync(custom) ? readdirSync(custom) : [])).toEqual([]);
  });

  it('a recusa de src/custom vale só com CRM_BASE_REPOSITORY=true; no clone, a pasta preenchida passa', () => {
    const files = ['.gitkeep', 'contratos'];
    expect(baseCustomFolderProblems(files, { [BASE_REPOSITORY_VARIABLE]: 'true' })).toEqual(['contratos']);
    expect(baseCustomFolderProblems(files, {})).toEqual([]);
    expect(baseCustomFolderProblems(files, { [BASE_REPOSITORY_VARIABLE]: 'false' })).toEqual([]);
  });

  // As mutações da seção 16.4: cada conferência reprova o erro que ela existe para pegar.
  it('as conferências reprovam um comando inventado, um caminho inexistente, um objeto fora do manifesto e o excesso', () => {
    expect(citedCommands('rode `npm run gen:tipos` e `npm test`')).toEqual(['gen:tipos', 'test']);
    expect('gen:tipos' in scripts).toBe(false);
    expect(citedPaths('veja `src/lib/nao-existe.ts`, `src/custom/x.ts` e `<data>_custom_x.sql`')).toEqual([
      'src/lib/nao-existe.ts',
    ]);
    expect(citedDatabaseObjects('use private.funcao_inventada e public.custom_contratos')).toEqual([
      'private.funcao_inventada',
    ]);
    expect(manifestNames.has('private.funcao_inventada')).toBe(false);
    const long = Array.from({ length: AGENTS_MAX_LINES + 1 }, (_, index) => `linha ${index}`).join('\n');
    expect(long.split('\n').length).toBeGreaterThan(AGENTS_MAX_LINES);
  });
});

describe('os guias de docs/PERSONALIZAR (item 1.8)', () => {
  it('apontam para Personalizar sem quebrar a atualização', () => {
    for (const guide of GUIDES.filter((file) => !file.endsWith('LOVABLE.md')))
      expect(read(guide), guide).toContain('PROTECAO-ATUALIZACAO.md');
    expect(GUIDES.map((file) => path.basename(file)).sort()).toEqual([
      'CAMPO.md',
      'ENTIDADE.md',
      'LOVABLE.md',
      'README.md',
      'TELA.md',
    ]);
  });

  it.each(['CAMPO.md', 'ENTIDADE.md', 'TELA.md'])(
    'cada bloco de %s marcado como trecho do exemplo é um trecho literal do arquivo',
    (name) => {
      const snippets = exampleSnippets(read(`${PERSONALIZAR}/${name}`));
      expect(snippets.length).toBeGreaterThan(0);
      for (const { file, code } of snippets) expect(read(`${EXAMPLES}/${file}`), file).toContain(code);
    },
  );

  it('o conferidor dos trechos reprova um bloco diferente do arquivo', () => {
    const [snippet] = exampleSnippets(
      '<!-- exemplo: supabase/migrations/20261101090000_custom_cnpj.sql -->\n\n```sql\nalter table public.companies add column custom_cpf text;\n```\n',
    );
    expect(snippet.file).toBe('supabase/migrations/20261101090000_custom_cnpj.sql');
    expect(read(`${EXAMPLES}/${snippet.file}`)).not.toContain(snippet.code);
  });

  it('o modelo de tabela do guia de proteção é o mesmo da migração do exemplo', () => {
    const normalize = (text) => text.replace(/\s+/g, ' ').trim();
    const segment = (text) => {
      const start = text.indexOf('create table public.custom_contratos(');
      const lastPolicy = text.lastIndexOf('create policy custom_contratos_');
      return normalize(text.slice(start, text.indexOf(';', lastPolicy) + 1));
    };
    const migration = read(`${EXAMPLES}/supabase/migrations/20261101091000_custom_contratos.sql`);
    expect(segment(read(GUIDE_FILE))).toBe(segment(migration));
    expect(segment(migration)).toContain('create policy custom_contratos_delete');
  });
});
