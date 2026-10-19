// Item 1.8 (docs/arquitetura/1.8.md, seções 4.6 e 5.4): as regras para IA (AGENTS.md e CLAUDE.md) e os guias de
// docs/PERSONALIZAR continuam verdadeiros; desde o item 1.4, também os comandos e caminhos dos guias de quem implanta
// (docs/IMPLANTACAO.md e docs/ENSAIO-IMPLANTACAO.md). As conferências moram em scripts/lib/ai-rules.mjs e passam pelos
// arquivos reais e por fixtures de mutação (achado 2 da revisão do 1.8): cada uma reprova o erro que ela existe para pegar.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENTS_MAX_LINES,
  CLAUDE_MAX_LINES,
  aiRulesProblems,
  baseCustomFolderProblems,
  citedCommands,
  citedDatabaseObjects,
  citedPaths,
  citesProjectRef,
  exampleSnippets,
  futureItemReferences,
  guideReferenceProblems,
  ownerProjectRef,
  unpinnedSupabaseCli,
} from './ai-rules.mjs';
import { SUPABASE_CLI_VERSION } from './supabase-config.mjs';
import { BASE_REPOSITORY_VARIABLE, GUIDE_FILE, MANIFEST_FILE } from './base-manifest.mjs';
import { ROOT } from './embedded-db.mjs';

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const PERSONALIZAR = 'docs/PERSONALIZAR';
const EXAMPLES = `${PERSONALIZAR}/exemplos`;
const GUIDES = readdirSync(path.join(ROOT, PERSONALIZAR))
  .filter((name) => name.endsWith('.md'))
  .map((name) => `${PERSONALIZAR}/${name}`);
const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', ...GUIDES];
/**
 * Os guias de quem implanta (item 1.4, AC-2), desde o item 1.7b o de atualização e o da licença e, desde o 1.7a, o de
 * distribuição e o termo de beta: os comandos e os caminhos citados existem.
 */
const DEPLOY_GUIDES = [
  'docs/IMPLANTACAO.md',
  'docs/ENSAIO-IMPLANTACAO.md',
  'docs/ATUALIZACAO.md',
  'docs/LICENCA.md',
  'docs/DISTRIBUICAO.md',
  'docs/TERMO-BETA.md',
];
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-e2e',
  'dist-perf',
  'test-results',
  'playwright-report',
]);
const markdownUnder = (dir) =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRS.has(entry.name)) return [];
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return markdownUnder(relative);
    return entry.name.endsWith('.md') ? [relative] : [];
  });
/**
 * Os documentos vivos do achado 7 do 1.4 e do AC-6 do 1.7b: README, AGENTS.md, CHANGELOG.md, docs/ (fora o roteiro, os
 * desenhos e os documentos do dono, que registram o passado), docs/PERSONALIZAR e os .md de supabase/ e de src/.
 */
const LIVING_DOCS = [
  'README.md',
  'AGENTS.md',
  'CHANGELOG.md',
  ...markdownUnder('docs').filter(
    (file) =>
      file !== 'docs/ROADMAP-FINALIZACAO.md' && !file.startsWith('docs/arquitetura/') && !file.startsWith('docs/dono/'),
  ),
  ...markdownUnder('supabase'),
  ...markdownUnder('src'),
];
const OWNER_DOC = 'docs/dono/AMBIENTE.md';
const OWNER_REF = existsSync(path.join(ROOT, OWNER_DOC)) ? ownerProjectRef(read(OWNER_DOC)) : null;

const manifest = JSON.parse(read(MANIFEST_FILE));
const manifestNames = new Set(
  manifest.objects.map((object) =>
    object.kind === 'function' || object.kind === 'hook' ? object.object.split('(')[0] : object.object,
  ),
);
const scripts = JSON.parse(read('package.json')).scripts;
const exists = (cited) => existsSync(path.join(ROOT, cited));
const real = () => ({
  agents: read('AGENTS.md'),
  claude: read('CLAUDE.md'),
  guides: Object.fromEntries(GUIDES.map((file) => [file, read(file)])),
  scripts,
  manifestNames,
  exists,
});

describe('regras para IA (item 1.8)', () => {
  it('os arquivos reais passam em todas as conferências', () => {
    expect(aiRulesProblems(real())).toEqual([]);
  });

  it.each(DEPLOY_GUIDES)('%s cita só comandos e caminhos que existem (item 1.4)', (file) => {
    expect(guideReferenceProblems(file, read(file), { scripts, exists })).toEqual([]);
  });

  it('AGENTS.md aponta os guias de personalização, o de implantação e o de atualização', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('docs/PERSONALIZAR/README.md');
    expect(agents).toContain(GUIDE_FILE);
    expect(agents).toContain('docs/IMPLANTACAO.md');
    expect(agents).toContain('docs/ATUALIZACAO.md');
    expect(agents).toContain('CHANGELOG.md');
  });

  // Item 1.7b (AC-6): o sentido contrário. O guia de proteção aponta o de atualização nas seções 1 e 6, e o CHANGELOG
  // onde fala das notas da versão.
  it('o guia de proteção aponta o de atualização (seções 1 e 6) e o CHANGELOG nas notas da versão', () => {
    const protection = read('docs/PROTECAO-ATUALIZACAO.md');
    const section = (heading) => {
      const start = protection.indexOf(`\n## ${heading}\n`);
      expect(start, heading).toBeGreaterThan(-1);
      const next = protection.indexOf('\n## ', start + 1);
      return protection.slice(start, next === -1 ? undefined : next);
    };
    for (const heading of ['1. O que a base promete', '6. Atualizar a base']) {
      const text = section(heading);
      expect(text, heading).toContain('](ATUALIZACAO.md');
      expect(text, heading).toMatch(/notas (da|de cada) versão, no \[`CHANGELOG\.md`\]\(\.\.\/CHANGELOG\.md\)/);
    }
  });

  // Item 1.7b (AC-5): o guia de atualização aponta para o de proteção nas seções que ele não repete.
  it('o guia de atualização aponta o de proteção (seções 1, 5, 6, 7 e 8) e cobre os pontos do desenho', () => {
    const update = read('docs/ATUALIZACAO.md');
    for (const anchor of [
      '#1-o-que-a-base-promete',
      '#5-conferir-o-banco-db-drift-check',
      '#6-atualizar-a-base',
      '#7-quando-a-atualização-para',
      '#8-para-quem-mantém-a-base',
    ])
      expect(update, anchor).toContain(`PROTECAO-ATUALIZACAO.md${anchor}`);
    for (const fragment of [
      'git fetch upstream --tags',
      'git merge --no-ff vX.Y.Z',
      'public/brand/brand.json',
      'supabase/config.toml',
      '_custom_',
      'src/custom/',
      'custom:',
      '--include-all',
      'db push --dry-run',
      'npm run config:push',
      'npm run verify-instance',
      'supabase/instance-check.sql',
      'supabase/db-drift-check.sql',
      'Backup do banco',
      'Instant Rollback',
      '## 11. Quando a base recriou uma função que você alterou',
      '## Para quem mantém a base: lançar uma versão',
      '## Regras desta instância',
    ])
      expect(update, fragment).toContain(fragment);
    // A ordem: banco (etapa 7), Auth (8) e só então o frontend (9).
    expect(update.indexOf('## 7. Banco')).toBeLessThan(update.indexOf('## 8. Acesso (Auth)'));
    expect(update.indexOf('## 8. Acesso (Auth)')).toBeLessThan(update.indexOf('## 9. Publicar o frontend'));
    // Sem repetir a mensagem da guarda nem os dois caminhos, que moram no guia de proteção.
    expect(update).not.toContain('base_overwrite_consents');
  });

  // Item 1.7a (AC-9; docs/arquitetura/1.7a.md, seção 10): o lançamento aponta o guia de distribuição, e ele cobre o
  // processo inteiro. O docs:links só pega o link quebrado; aqui, o removido.
  it('o lançamento aponta o guia de distribuição, e ele cobre as seções do desenho', () => {
    const update = read('docs/ATUALIZACAO.md');
    const start = update.indexOf('## Para quem mantém a base: lançar uma versão');
    const end = update.indexOf('\n## ', start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(update.slice(start, end === -1 ? undefined : end)).toContain('](DISTRIBUICAO.md)');
    const guide = read('docs/DISTRIBUICAO.md');
    const headings = [...guide.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(headings).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const fragment of [
      '## 5. Primeira vez',
      '## 6. Antes de enviar',
      '## 11. Cópias anteriores à distribuição',
      'CRM_DISTRIBUTION_REPOSITORY',
      'Allow forking',
      '--allow-unrelated-histories',
      'tag -a',
      'git -c user.name=',
      'não aceita pull request',
      '--rehearsal',
      '--verify',
    ])
      expect(guide, fragment).toContain(fragment);
  });

  // Item 1.7b: o conflito no config.toml (fora do bloco dos modelos) tem uma regra só nos dois guias.
  it('o guia de atualização e o de marca resolvem do mesmo jeito o conflito no config.toml', () => {
    const update = read('docs/ATUALIZACAO.md');
    const brand = read('docs/MARCA.md');
    expect(update).toContain('git checkout --theirs -- supabase/config.toml');
    expect(brand).not.toContain('sem aceitar um lado inteiro');
    expect(brand).toContain('fique com a versão da base');
    expect(brand).toContain('](ATUALIZACAO.md#5-conflitos)');
  });

  // Achado 1 da revisão do 1.8: a função própria usada numa política, num DEFAULT ou numa view também precisa do grant.
  it('a regra do grant execute cobre a função usada numa política, num DEFAULT de coluna e numa view', () => {
    const rule = read('AGENTS.md')
      .split('\n')
      .find((line) => line.includes('grant execute ... to authenticated'));
    expect(rule).toMatch(/política/);
    expect(rule).toMatch(/DEFAULT/);
    expect(rule).toMatch(/view/);
    expect(rule).toContain('42501');
    const entity = read(`${PERSONALIZAR}/ENTIDADE.md`);
    expect(entity).toMatch(/função sua usada numa política RLS, num `DEFAULT` de coluna ou numa view/);
  });

  it('nenhum arquivo de regras cita o projeto do dono nem o framework pessoal dele', () => {
    for (const file of [...RULE_FILES, ...DEPLOY_GUIDES]) {
      expect(citesProjectRef(read(file), OWNER_REF), file).toBe(false);
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

  it('os extratores ignoram o que é de quem personaliza e os arquivos locais da instância', () => {
    expect(citedCommands('rode `npm run gen:tipos` e `npm test`')).toEqual(['gen:tipos', 'test']);
    expect(
      citedPaths('veja `src/lib/nao-existe.ts`, `src/custom/x.ts`, `<data>_custom_x.sql` e `supabase/.env`'),
    ).toEqual(['src/lib/nao-existe.ts']);
    expect(citedDatabaseObjects('use private.funcao_inventada e public.custom_contratos')).toEqual([
      'private.funcao_inventada',
    ]);
  });

  // As mutações da seção 16.4 do desenho do 1.8, cada uma numa fixture, pela mesma conferência dos arquivos reais.
  const mutations = [
    [
      'o AGENTS.md com 201 linhas',
      (input) => ({
        ...input,
        agents: `${input.agents.trimEnd()}\n${Array.from({ length: AGENTS_MAX_LINES }, (_, index) => `- linha ${index}`).join('\n')}\n`,
      }),
      `acima do limite de ${AGENTS_MAX_LINES}`,
    ],
    [
      'o CLAUDE.md com 31 linhas',
      (input) => ({
        ...input,
        claude: `${input.claude.trimEnd()}\n${Array.from({ length: CLAUDE_MAX_LINES }, () => '').join('\n')}x\n`,
      }),
      `acima do limite de ${CLAUDE_MAX_LINES}`,
    ],
    [
      'o CLAUDE.md sem @AGENTS.md',
      (input) => ({ ...input, claude: input.claude.replace('@AGENTS.md', 'Leia o AGENTS.md.') }),
      'não importa o AGENTS.md',
    ],
    [
      'um comando inventado',
      (input) => ({ ...input, agents: `${input.agents}\nRode \`npm run gen:tipos\`.\n` }),
      'npm run gen:tipos, que não existe',
    ],
    [
      'um caminho inexistente',
      (input) => ({ ...input, agents: `${input.agents}\nVeja \`src/lib/nao-existe.ts\`.\n` }),
      'src/lib/nao-existe.ts, que não existe',
    ],
    [
      'uma função fora do manifesto',
      (input) => ({ ...input, agents: `${input.agents}\nUse private.funcao_inventada.\n` }),
      'private.funcao_inventada, que não está no manifesto',
    ],
    [
      'um comando da suíte fora da ordem',
      (input) => ({
        ...input,
        agents: input.agents
          .replace('`npm run format:check`', '`npm run format`')
          .replace('`npm run test:e2e`', '`npm run test:e2e` e `npm run format:check`'),
      }),
      'fora da ordem do CI',
    ],
    [
      'um invariante esquecido',
      (input) => ({ ...input, agents: input.agents.replaceAll('TEAM_VIEWER_ROLES', 'PAPEIS') }),
      'não cita os invariantes: TEAM_VIEWER_ROLES',
    ],
  ];
  it.each(mutations)('reprova %s', (_label, mutate, fragment) => {
    const problems = aiRulesProblems(mutate(real()));
    expect(problems.join('\n')).toContain(fragment);
  });

  // Achado 7 da revisão do 1.4 (corrigido no 1.7b): os guias usam o CLI fixado, o mesmo do npm run config:push.
  it('os documentos vivos usam o Supabase CLI fixado em todo comando', () => {
    expect(LIVING_DOCS.length).toBeGreaterThan(20);
    expect(LIVING_DOCS).toContain('docs/ATUALIZACAO.md');
    const problems = LIVING_DOCS.flatMap((file) =>
      unpinnedSupabaseCli(read(file), SUPABASE_CLI_VERSION).map((problem) => `${file}: ${problem}`),
    );
    expect(problems).toEqual([]);
    expect(read('docs/IMPLANTACAO.md')).toContain(`npx supabase@${SUPABASE_CLI_VERSION} db push`);
  });

  // Achado da revisão do 1.7b: as mensagens que os scripts e o SQL gerado mostram também usam o CLI fixado (montadas
  // com SUPABASE_CLI_VERSION, que aqui é trocada pelo valor, como no texto que a pessoa lê).
  it('as mensagens dos scripts e a conferência da instância gerada usam o Supabase CLI fixado', () => {
    const files = [
      'scripts/lib/instance-check.mjs',
      'scripts/lib/backup-restore.mjs',
      'scripts/lib/supabase-config.mjs',
      'scripts/supabase-config.mjs',
      'scripts/restore-backup.mjs',
      'supabase/instance-check.sql',
    ];
    const problems = files.flatMap((file) =>
      unpinnedSupabaseCli(
        read(file)
          .replaceAll('${SUPABASE_CLI_VERSION}', SUPABASE_CLI_VERSION)
          .replaceAll('<SUPABASE_CLI_VERSION>', SUPABASE_CLI_VERSION),
        SUPABASE_CLI_VERSION,
      ).map((problem) => `${file}: ${problem}`),
    );
    expect(problems).toEqual([]);
    expect(read('supabase/instance-check.sql')).toContain(
      `npx supabase@${SUPABASE_CLI_VERSION} db push (etapa 4 do guia)`,
    );
  });

  it('a conferência do CLI reprova o comando sem a versão ou com outra versão, e deixa a proibição do config push', () => {
    expect(unpinnedSupabaseCli('rode `npx supabase db push`', '2.119.0')).toEqual([
      'npx supabase db push sem a versão (use npx supabase@2.119.0 db push)',
    ]);
    expect(unpinnedSupabaseCli('npx.cmd supabase login', '2.119.0')).toHaveLength(1);
    expect(unpinnedSupabaseCli('npx supabase@2.100.0 link --project-ref x', '2.119.0')).toEqual([
      'npx supabase@2.100.0 link com outra versão (o CLI fixado é 2.119.0)',
    ]);
    expect(
      unpinnedSupabaseCli('npx supabase@2.119.0 db push e npx supabase@2.119.0 migration list', '2.119.0'),
    ).toEqual([]);
    expect(unpinnedSupabaseCli('Nunca rode `npx supabase config push` direto', '2.119.0')).toEqual([]);
  });

  // AC-6 do 1.7b e AC-9 do 1.7a: nenhum documento vivo fala do item 1.7b nem do 1.7a como coisa futura (os guias
  // apontam o que eles entregaram).
  it('nenhum documento vivo cita o "item 1.7b" nem o "item 1.7a" como coisa futura', () => {
    const found = LIVING_DOCS.flatMap((file) =>
      ['1.7b', '1.7a'].flatMap((item) => futureItemReferences(read(file), item).map((line) => `${file}: ${line}`)),
    );
    expect(found).toEqual([]);
    expect(futureItemReferences('As tags chegam com o item 1.7a do roteiro.', '1.7a')).toHaveLength(1);
    // As frases que os guias tinham antes do item reprovam; citar o item como origem do que já existe, não.
    for (const sentence of [
      'O guia de atualização chega com o item 1.7b do roteiro.',
      'O passo a passo fica no guia de atualização, item 1.7b do roteiro.',
      'A variável sai numa versão futura (item 1.7b).',
      'As notas de cada versão (item 1.7b) dizem o que muda.',
      'O passo a passo chega com o item 1.7b (`docs/ATUALIZACAO.md`, ainda não publicado).',
    ])
      expect(futureItemReferences(sentence), sentence).toHaveLength(1);
    expect(futureItemReferences('O rodapé mostra a versão (item 1.7b), e o resto fica igual.')).toEqual([]);
  });

  it('a conferência dos guias de implantação reprova um comando e um caminho inventados', () => {
    const problems = guideReferenceProblems(
      'docs/IMPLANTACAO.md',
      'Rode `npm run verificar` e abra `supabase/nao-existe.sql`.',
      {
        scripts,
        exists,
      },
    );
    expect(problems).toEqual([
      'docs/IMPLANTACAO.md cita npm run verificar, que não existe no package.json',
      'docs/IMPLANTACAO.md cita supabase/nao-existe.sql, que não existe no repositório',
    ]);
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

  // Achado 4 da revisão do 1.8: o CI não pega SQL destrutivo dentro de uma migração _custom_.
  it('o guia do Lovable não promete que o CI pega tudo e manda rodar as duas conferências', () => {
    const lovable = read(`${PERSONALIZAR}/LOVABLE.md`);
    expect(lovable).not.toContain('reprova no push');
    expect(lovable).toContain('supabase/instance-check.sql');
    expect(lovable).toContain('supabase/db-drift-check.sql');
    expect(lovable).toContain('drop policy');
  });

  // Achado 8 da revisão do 1.8: cada lista do menu no formato dela, e a rota citada existe.
  it('o guia da tela traz um exemplo por lista do menu, no formato de cada uma, e cita uma rota que existe', () => {
    const tela = read(`${PERSONALIZAR}/TELA.md`);
    expect(tela).toContain("{ title: 'Contratos', url: '/contratos', icon: FileSignature }, // custom: contratos");
    expect(tela).toContain("{ title: 'Contratos', url: '/contratos' }, // custom: contratos");
    expect(tela).toContain("['Contratos', '/contratos'], // custom: contratos");
    expect(tela).toContain('`moreItems`');
    expect(tela).toContain('`/templates` (menu “Templates”)');
    expect(read('src/components/layout/MobileBottomNav.tsx')).toMatch(
      /const moreItems = \[\n\s+\{ title: '[^']+', url: '[^']+' \},/,
    );
    expect(read('src/components/CommandPalette.tsx')).toMatch(/\['Hoje', '\/dashboard'\],/);
    expect(read('src/components/shell/AppRail.tsx')).toMatch(/\{ title: 'Templates', url: '\/templates', icon: \w+ \}/);
    expect(read('src/App.tsx')).toContain('path="/templates"');
  });

  // Achado 1 da revisão do 1.7b (corrigido no 1.7a): a tela própria também passa por holdWhileReloading, como as da base.
  it('todo lazy( dos guias de personalização passa por holdWhileReloading, e o AGENTS.md diz isso', () => {
    const lazyCalls = GUIDES.flatMap((file) =>
      [...read(file).matchAll(/\blazy\(([^\n]*)/g)].map((match) => ({ file, call: match[1] })),
    );
    expect(lazyCalls.length).toBeGreaterThan(0);
    for (const { file, call } of lazyCalls) expect(call, file).toMatch(/^holdWhileReloading\(\(\) => import\(/);
    expect(read(`${PERSONALIZAR}/TELA.md`)).toContain('@/lib/stale-build');
    expect(read('AGENTS.md')).toContain('lazy(holdWhileReloading(() => import(...)))');
  });
});

// Achado 6 da revisão do 1.7b (corrigido no 1.7a): a etapa 2 do guia de atualização cobre a instância Free sem o
// workflow de backup, o padrão de aula e beta.
describe('a cópia de segurança do guia de atualização (achado 6 do 1.7b)', () => {
  it('a etapa 2 tem os três casos, com o Free sem dados reais, e aponta o guia de backup', () => {
    const update = read('docs/ATUALIZACAO.md');
    const start = update.indexOf('## 2. Cópia de segurança');
    const step = update.slice(start, update.indexOf('\n## 3.', start));
    expect(step).toContain('Com o workflow ligado');
    expect(step).toContain('numa instância Pro');
    expect(step).toContain('sem dados reais');
    expect(step).toContain('](BACKUP-RESTAURACAO.md)');
    expect(step).toMatch(/Deu certo se: [^\n]*workflow[^\n]*Pro[^\n]*Free sem dados reais/);
  });
});
