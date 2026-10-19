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
  guideReferenceProblems,
  ownerProjectRef,
} from './ai-rules.mjs';
import { BASE_REPOSITORY_VARIABLE, GUIDE_FILE, MANIFEST_FILE } from './base-manifest.mjs';
import { ROOT } from './embedded-db.mjs';

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const PERSONALIZAR = 'docs/PERSONALIZAR';
const EXAMPLES = `${PERSONALIZAR}/exemplos`;
const GUIDES = readdirSync(path.join(ROOT, PERSONALIZAR))
  .filter((name) => name.endsWith('.md'))
  .map((name) => `${PERSONALIZAR}/${name}`);
const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', ...GUIDES];
/** Os guias de quem implanta (item 1.4, AC-2): os comandos e os caminhos citados existem. */
const DEPLOY_GUIDES = ['docs/IMPLANTACAO.md', 'docs/ENSAIO-IMPLANTACAO.md'];
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

  it('AGENTS.md aponta os guias de personalização e o de implantação', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('docs/PERSONALIZAR/README.md');
    expect(agents).toContain(GUIDE_FILE);
    expect(agents).toContain('docs/IMPLANTACAO.md');
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
});
