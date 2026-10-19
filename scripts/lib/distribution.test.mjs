// Item 1.7a (docs/arquitetura/1.7a.md, seções 6, 7, 9 e 18.1): a allowlist com classificação total e a conferência
// contra vazamento, por fixture (uma por regra, a que reprova e a que passa) e, no repositório da base ou no de
// distribuição, pelos arquivos reais. A montagem da árvore com o git real fica em release-dist.test.mjs.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_REPOSITORY_VARIABLE } from './base-manifest.mjs';
import {
  BETA_TERMS_FILE,
  DISTRIBUTION_ALLOWLIST,
  DISTRIBUTION_EXCLUDED,
  DISTRIBUTION_GUIDE_FILE,
  DISTRIBUTION_POLICY,
  DISTRIBUTION_REPOSITORY_VARIABLE,
  EXAMPLE_PROJECT_REFS,
  FORBIDDEN_PATHS,
  OWNER_REGISTRY_FILE,
  REQUIRED_FILES,
  ROOT,
  SENTINEL_PATHS,
  authorTermProblem,
  backupWorkflowProblems,
  binaryContentProblems,
  brandProblems,
  classificationProblems,
  classifyFiles,
  contentProblems,
  distributionHistoryChecked,
  distributionHistoryProblems,
  distributionProblems,
  distributionTagProblems,
  envExampleProblems,
  formatProblem,
  globToRegExp,
  historyTerms,
  isBinary,
  isForbidden,
  isLivingDoc,
  linksToOwnerFolder,
  maskPath,
  maskTerm,
  matchesPattern,
  packageProblems,
  parseAuthor,
  privateTerms,
  registryTermFormatProblems,
  registryTerms,
  workingTreeFiles,
} from './distribution.mjs';

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
// As fixtures que reprovam são montadas em partes: escritas inteiras, este próprio arquivo reprovaria na conferência
// dos arquivos reais (ele vai na distribuição).
const join = (...parts) => parts.join('');
const FAKE_REF = join('qwertyuiop', 'asdfghjklz');
const REAL_DOMAIN = join('empresareal', '.com.br');
const NOREPLY = join('users.', 'noreply.github.com');
const rules = (problems) => problems.map((entry) => entry.rule);
const messages = (problems) => problems.map(formatProblem).join('\n');

describe('os padrões da allowlist (seção 6.1)', () => {
  it.each([
    ['src/**', 'src/App.tsx', true],
    ['src/**', 'src/components/help/faq-content.ts', true],
    ['src/**', 'srcx/App.tsx', false],
    ['src/**', 'src', false],
    ['docs/*.md', 'docs/IMPLANTACAO.md', true],
    ['docs/*.md', 'docs/arquitetura/1.1.md', false],
    ['**/.env', '.env', true],
    ['**/.env', 'supabase/.env', true],
    ['**/.env.*', 'supabase/.env.local', true],
    ['**/*.local', 'a/b/c.local', true],
    ['supabase/migrations/*_custom_*', 'supabase/migrations/20990101000000_custom_x.sql', true],
    ['supabase/migrations/*_custom_*', 'supabase/migrations/sub/20990101000000_custom_x.sql', false],
    ['dist-*/**', 'dist-e2e/8096/index.html', true],
    ['LICENSE', 'LICENSE', true],
    ['LICENSE', 'license', false],
    ['.git-blame-ignore-revs', '.git-blame-ignore-revs', true],
    ['docs/a.md', 'docsxa.md', false],
    ['tsconfig?.json', 'tsconfig1.json', true],
  ])('%s com %s: %s', (pattern, file, expected) => {
    expect(matchesPattern(file, pattern)).toBe(expected);
  });

  it('o ponto e os outros caracteres especiais são literais', () => {
    expect(globToRegExp('.env.example').test('xenvxexample')).toBe(false);
    expect(globToRegExp('a+b(c).md').test('a+b(c).md')).toBe(true);
  });

  it('os proibidos valem com as exceções dos modelos de variáveis', () => {
    expect(isForbidden('.env.example')).toBe(false);
    expect(isForbidden('supabase/.env.example')).toBe(false);
    expect(isForbidden('src/custom/.gitkeep')).toBe(false);
    expect(isForbidden('src/custom/contratos/x.tsx')).toBe(true);
    expect(isForbidden('docs/dono/AMBIENTE.md')).toBe(true);
    expect(isForbidden('.claude/settings.json')).toBe(true);
    expect(isForbidden('supabase/.env')).toBe(true);
    expect(isForbidden('src/App.tsx')).toBe(false);
  });
});

// Uma política pequena para as fixtures da classificação.
const SMALL = {
  ...DISTRIBUTION_POLICY,
  allowlist: [
    { pattern: 'README.md', reason: 'r' },
    { pattern: 'src/**', reason: 'código' },
    { pattern: 'docs/GUIA.md', reason: 'guia' },
  ],
  excluded: [{ pattern: 'docs/dono/**', reason: 'dono' }],
  required: ['README.md'],
};
const SMALL_FILES = ['README.md', 'src/a.ts', 'docs/GUIA.md', 'docs/dono/AMBIENTE.md'];

describe('a classificação total (C1)', () => {
  it('a fixture válida passa, com cada arquivo numa classe e o motivo', () => {
    expect(classificationProblems(SMALL_FILES, SMALL)).toEqual([]);
    const classes = classifyFiles(SMALL_FILES, SMALL);
    expect(classes.included.map((entry) => [entry.file, entry.reason])).toEqual([
      ['README.md', 'r'],
      ['docs/GUIA.md', 'guia'],
      ['src/a.ts', 'código'],
    ]);
    expect(classes.excluded.map((entry) => entry.file)).toEqual(['docs/dono/AMBIENTE.md']);
  });

  it.each([
    [
      'um arquivo sem classificação',
      { files: [...SMALL_FILES, 'docs/NOVO.md'] },
      'docs/NOVO.md — C1: arquivo sem classificação',
    ],
    [
      'um arquivo nas duas listas',
      { policy: { ...SMALL, excluded: [...SMALL.excluded, { pattern: 'src/a.ts', reason: 'x' }] } },
      'src/a.ts — C1: arquivo na allowlist e nos excluídos',
    ],
    [
      'um arquivo proibido incluído',
      { files: [...SMALL_FILES, 'src/custom/contratos/x.tsx'] },
      'src/custom/contratos/x.tsx — C1: arquivo proibido incluído',
    ],
    [
      'um padrão perigoso (docs/**), pelos caminhos-sentinela',
      { policy: { ...SMALL, allowlist: [...SMALL.allowlist, { pattern: 'docs/**', reason: 'tudo' }] } },
      'o padrão "docs/**" da allowlist alcança um caminho proibido (docs/dono/AMBIENTE.md)',
    ],
    [
      'um padrão desatualizado',
      { policy: { ...SMALL, allowlist: [...SMALL.allowlist, { pattern: 'docs/SUMIU.md', reason: 'x' }] } },
      'o padrão "docs/SUMIU.md" da allowlist cita um arquivo que não existe',
    ],
    [
      'um obrigatório ausente',
      { policy: { ...SMALL, required: ['README.md', 'LICENSE'] } },
      'LICENSE — C1: arquivo obrigatório ausente',
    ],
  ])('reprova %s', (_label, { files = SMALL_FILES, policy = SMALL }, fragment) => {
    expect(messages(classificationProblems(files, policy))).toContain(fragment);
  });

  it('a política real: nenhum padrão alcança um sentinela, a pasta do dono é proibida e o termo é obrigatório', () => {
    for (const { pattern } of DISTRIBUTION_ALLOWLIST)
      for (const sentinel of SENTINEL_PATHS)
        expect(matchesPattern(sentinel, pattern), `${pattern} × ${sentinel}`).toBe(false);
    expect(FORBIDDEN_PATHS).toContain('docs/dono/**');
    expect(DISTRIBUTION_EXCLUDED.map((entry) => entry.pattern)).toEqual(['docs/dono/**', '.git-blame-ignore-revs']);
    expect(REQUIRED_FILES).toContain(BETA_TERMS_FILE);
    expect(DISTRIBUTION_ALLOWLIST.every((entry) => entry.reason)).toBe(true);
    expect(DISTRIBUTION_ALLOWLIST.some((entry) => entry.pattern === 'docs/**')).toBe(false);
  });

  // As linhas "Do 1.x" do item 1.7a no roteiro: cada caminho citado está na allowlist (e src/custom nunca).
  it('os caminhos das linhas "Do 1.x" do item 1.7a estão incluídos', () => {
    const roadmap = read('docs/ROADMAP-FINALIZACAO.md');
    const item = roadmap.slice(roadmap.indexOf('**1.7a Distribuição antecipada'), roadmap.indexOf('**1.7b Licença'));
    const lines = item.split('\n').filter((line) => line.trim().startsWith('- Do 1.'));
    expect(lines.length).toBeGreaterThanOrEqual(6);
    const cited = [
      ...new Set(
        lines.flatMap((line) => [...line.matchAll(/`([^`\s]+)`/g)].map((match) => match[1].replace(/\.\*$/, '.mjs'))),
      ),
    ].filter((value) => /^(?:[\w.-]+\/|[A-Z]+[\w.-]*$|tsconfig)/.test(value) && !value.startsWith('src/custom'));
    expect(cited).toContain('docs/PERSONALIZAR/**');
    expect(cited).toContain('supabase/backup/**');
    const included = (file) =>
      DISTRIBUTION_ALLOWLIST.some(({ pattern }) => matchesPattern(file, pattern) || pattern === file);
    for (const value of cited) {
      const sample = value.replace('**', 'x/y.md').replace('*', 'restore');
      expect(included(sample), value).toBe(true);
    }
    expect(DISTRIBUTION_ALLOWLIST.some(({ pattern }) => matchesPattern('src/custom/x.tsx', pattern))).toBe(true);
    expect(isForbidden('src/custom/x.tsx')).toBe(true);
  });
});

const TERMS = [
  { term: 'zyxwvutsrqponmlkjihg', source: 'ref do projeto do dono' },
  { term: 'pessoa.dona@pessoal.example', source: 'termo pessoal do histórico' },
  { term: 'Pessoa Dona', source: 'termo pessoal do histórico' },
];

describe('a conferência do conteúdo (C2 a C8)', () => {
  it.each([
    ['C2', 'o ref do dono', 'scripts/x.mjs', 'const ref = "ZYXWVUTSRQPONMLKJIHG";'],
    ['C2', 'um e-mail do histórico', 'src/x.ts', 'autor: pessoa.dona@pessoal.example'],
    ['C2', 'um nome do histórico', 'README.md', 'Feito por pessoa dona, em 2026.'],
    ['C3', 'um ref real num endereço', 'docs/A.md', `https://${FAKE_REF}.supabase.co`],
    ['C3', 'um ref real na conexão', 'scripts/x.mjs', `postgresql://postgres.${FAKE_REF}:x@host/db`],
    ['C3', 'um ref real no painel', 'docs/A.md', `https://supabase.com/dashboard/project/${FAKE_REF}`],
    ['C4', 'uma chave sb_secret_', 'src/x.ts', `const k = "${join('sb_', 'secret_')}0123456789abcdefghijKLMN";`],
    ['C4', 'um JWT', 'src/x.ts', join('eyJ', 'hbGciOiJIUzI1NiJ9.', 'eyJ', 'yb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJlLWZha2U')],
    ['C4', 'um token pessoal do Supabase', 'x.md', `sbp_${'a1'.repeat(20)}`],
    ['C4', 'um token do GitHub', 'x.md', `ghp_${'A'.repeat(36)}`],
    ['C4', 'um github_pat_', 'x.md', `github_pat_${'A'.repeat(30)}`],
    ['C4', 'uma chave da AWS', 'x.md', join('AK', 'IAABCDEFGHIJKLMNOP')],
    ['C4', 'uma chave privada', 'x.md', join('-----BEGIN RSA ', 'PRIVATE KEY-----')],
    ['C4', 'uma chave do Resend (senha do SMTP)', 'docs/A.md', join('smtp pass re', '_AbCdEf123456789012345678')],
    ['C4', 'uma chave sk_live_', 'src/x.ts', join('sk', '_live_', 'A1b2C3d4E5f6G7h8I9j0K1l2')],
    ['C4', 'uma chave sk-', 'src/x.ts', join('"sk', '-proj-', 'A1b2C3d4E5f6G7h8I9j0K1l2"')],
    ['C4', 'uma chave do Google', 'src/x.ts', join('AI', 'za', 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q')],
    ['C4', 'uma senha real no modelo de variáveis', 'supabase/.env.example', 'SUPABASE_AUTH_SMTP_PASS=minhaSenha123'],
    ['C5', 'um e-mail de domínio real', 'src/x.ts', `contato@${REAL_DOMAIN}`],
    ['C5', 'um noreply do GitHub', 'x.md', `123+alguem@${NOREPLY}`],
    ['C6', 'um caminho do Windows', 'x.md', join('C:\\', 'Users\\fulano\\projeto')],
    ['C6', 'um caminho do Windows escapado', 'x.mjs', join("'C:\\\\", 'Users\\\\fulano\\\\projeto', "'")],
    ['C6', 'um caminho do macOS', 'x.md', join('abra /', 'Users/fulano/projeto')],
    ['C6', 'um caminho do Linux', 'x.md', join('abra /', 'home/fulano/projeto')],
    ['C6', 'um caminho do Git Bash', 'docs/arquitetura/x.md', join('cd /c/', 'Users/fulano/CLAUDE/x')],
    ['C6', 'um caminho do WSL', 'docs/arquitetura/x.md', join('cd /mnt/c/', 'Users/fulano/x')],
    ['C6', 'um caminho do Windows em minúsculas', 'x.md', join('c:\\', 'users\\fulano\\projeto')],
    ['C6', 'um caminho do Windows em maiúsculas', 'x.md', join('C:\\', 'USERS\\FULANO\\projeto')],
    ['C6', 'um caminho do WSL em minúsculas', 'x.md', join('cd /mnt/c/', 'users/fulano/x')],
    ['C7', 'a pasta do dono citada', 'docs/GUIA.md', 'Veja `docs/dono/AMBIENTE.md`.'],
    [
      'C7',
      'um link relativo para a pasta do dono',
      'docs/arquitetura/9.9.md',
      'Veja [o ambiente](../dono/AMBIENTE.md).',
    ],
    ['C7', 'o link no guia de distribuição', DISTRIBUTION_GUIDE_FILE, 'Veja [o ambiente](dono/AMBIENTE.md).'],
    ['C8', 'a tag legacy-archive como disponível', 'README.md', 'Consulte a tag `legacy-archive`.'],
    ['C8', 'o .git-blame-ignore-revs como disponível', 'docs/PERSONALIZAR/X.md', 'Use o `.git-blame-ignore-revs`.'],
  ])('%s reprova %s', (rule, _label, file, text) => {
    expect(rules(contentProblems(file, text, { terms: TERMS }))).toContain(rule);
  });

  it.each([
    ['o ref de exemplo', 'scripts/x.mjs', 'https://abcdefghijklmnopqrst.supabase.co e postgres.abcdefghijabcdefghij'],
    ['o marcador do ref', 'docs/A.md', 'https://<SEU_PROJECT_REF>.supabase.co'],
    ['um e-mail reservado', 'src/x.ts', 'ana@empresa.example, bia@exemplo.test, x@site.invalid, a@example.com'],
    ['um domínio de exemplo listado', 'src/x.ts', 'nome@empresa.com.br e seu@email.com'],
    [
      'uma conexão do Supabase',
      'scripts/x.mjs',
      'postgresql://postgres.abcdefghijabcdefghij:senha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres',
    ],
    ['uma identidade de serviço', 'scripts/x.mjs', "['noreply@github.com', 'noreply@anthropic.com']"],
    ['um pacote do npm', 'package.json', '"@radix-ui/react-dialog": "^1.1.14", "actions/checkout@v7"'],
    ['um caminho genérico', 'x.md', 'C:\\Users\\<você>\\crm, %USERPROFILE% e /home/runner/work/'],
    ['a citação no guia de distribuição, sem link', DISTRIBUTION_GUIDE_FILE, 'A pasta `docs/dono/` fica de fora.'],
    ['a pasta do dono num código', 'scripts/x.mjs', "const file = 'docs/dono/AMBIENTE.md';"],
    [
      'um link para o guia ao lado',
      'docs/arquitetura/9.9.md',
      'Veja [o guia](../DISTRIBUICAO.md) e [x](https://exemplo.invalid/dono/).',
    ],
    ['a tag citada como da base', 'README.md', 'A tag `legacy-archive` fica só no repositório da base.'],
    ['a tag num desenho (registro do passado)', 'docs/arquitetura/9.9.md', 'a tag `legacy-archive`'],
    ['um primeiro nome sozinho', 'src/x.ts', "'Pessoa', 'Dona'"],
    ['um caminho genérico do Git Bash', 'x.md', 'cd /c/Users/<você>/crm e /mnt/c/Users/$USER/crm'],
    ['a pasta pública do Windows em minúsculas', 'x.md', 'c:\\users\\public\\x e C:\\USERS\\DEFAULT\\y'],
    ['uma rota de API em minúsculas', 'src/x.ts', "fetch('/users/:id/perfil') e '/home/'"],
    ['um link com % solto', 'docs/A.md', 'Veja [x](100%.md) e [y](a%2Fb.md).'],
    [
      'os marcadores do modelo de variáveis',
      'supabase/.env.example',
      'A_PASS=cole-aqui-a-senha\nB_KEY=\nC_TOKEN=<token>',
    ],
    ['um identificador que começa com re_ sem formato de chave', 'src/x.ts', 'const re_x = 1; task-sk-1'],
  ])('passa com %s', (_label, file, text) => {
    expect(contentProblems(file, text, { terms: TERMS })).toEqual([]);
  });

  it('a mensagem mostra a linha e só o começo do termo, nunca o termo inteiro', () => {
    const problems = contentProblems('src/x.ts', 'linha 1\nautor: Pessoa.Dona@pessoal.example\n', { terms: TERMS });
    expect(problems).toHaveLength(1);
    expect(formatProblem(problems[0])).toBe('src/x.ts:2 — C2: termo pessoal do histórico: pes…');
    const all = messages([
      ...problems,
      ...contentProblems('a.md', 'zyxwvutsrqponmlkjihg', { terms: TERMS }),
      ...contentProblems('a.md', `x@${REAL_DOMAIN}`, { terms: TERMS }),
    ]);
    for (const { term } of TERMS) expect(all.toLowerCase()).not.toContain(term.toLowerCase());
    expect(all).not.toContain(REAL_DOMAIN);
    expect(maskTerm('abcdef')).toBe('abc…');
  });

  it('o termo no nome do arquivo também reprova, com o caminho mascarado', () => {
    const problems = contentProblems('docs/pessoa dona.md', 'Pessoa Dona', { terms: TERMS });
    expect(messages(problems)).toContain('no nome do arquivo');
    expect(messages(problems).toLowerCase()).not.toContain('pessoa dona');
    expect(formatProblem(problems[0])).toBe('docs/Pes….md — C2: termo pessoal do histórico no nome do arquivo: Pes…');
    expect(maskPath('src/ZYXWVUTSRQPONMLKJIHG/x.ts', TERMS)).toBe('src/zyx…/x.ts');
  });

  it('um link com % solto não derruba a conferência', () => {
    expect(linksToOwnerFolder('README.md', '100%.md')).toBe(false);
    expect(linksToOwnerFolder('docs/A.md', 'dono%2FAMBIENTE.md')).toBe(true);
    expect(() => contentProblems('docs/A.md', '[x](100%.md)', { terms: TERMS })).not.toThrow();
  });

  it('os modelos de variáveis: só vazio ou marcador nas senhas, chaves, segredos e tokens', () => {
    expect(envExampleProblems('supabase/.env.example', read('supabase/.env.example'))).toEqual([]);
    expect(envExampleProblems('.env.example', read('.env.example'))).toEqual([]);
    const problems = envExampleProblems(
      '.env.example',
      "X=1\nVITE_SUPABASE_PUBLISHABLE_KEY='valor-real'\n# Y_KEY=abc\n",
    );
    expect(messages(problems)).toBe(
      '.env.example:2 — C4: VITE_SUPABASE_PUBLISHABLE_KEY no modelo precisa ficar vazia ou com um marcador (por exemplo cole-aqui-a-senha), nunca com um valor real',
    );
  });

  it('os documentos vivos e os links resolvidos a partir da pasta do documento', () => {
    expect(isLivingDoc('README.md')).toBe(true);
    expect(isLivingDoc('docs/IMPLANTACAO.md')).toBe(true);
    expect(isLivingDoc('docs/ROADMAP-FINALIZACAO.md')).toBe(false);
    expect(isLivingDoc('docs/arquitetura/1.1.md')).toBe(false);
    expect(isLivingDoc('src/components/help/README.md')).toBe(true);
    expect(isLivingDoc('src/App.tsx')).toBe(false);
    expect(linksToOwnerFolder('docs/ROADMAP-FINALIZACAO.md', 'dono/AMBIENTE.md#estado')).toBe(true);
    expect(linksToOwnerFolder('README.md', 'docs/dono/README.md')).toBe(true);
    expect(linksToOwnerFolder('docs/arquitetura/1.1.md', '../dono/')).toBe(true);
    expect(linksToOwnerFolder('docs/arquitetura/1.1.md', 'dono/AMBIENTE.md')).toBe(false);
    expect(linksToOwnerFolder('README.md', 'https://x.example/docs/dono/')).toBe(false);
    expect(linksToOwnerFolder('README.md', '#docs-dono')).toBe(false);
  });

  it('arquivo binário: pela extensão ou por um byte nulo', () => {
    expect(isBinary('public/brand/eia-email.png')).toBe(true);
    expect(isBinary('x.dat', Buffer.from([65, 0, 66]))).toBe(true);
    expect(isBinary('x.txt', Buffer.from('abc'))).toBe(false);
  });

  it('o conteúdo legível do binário: termo, ref e caminho nos metadados, também em UTF-16, sem o termo inteiro', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const xmp = Buffer.from(
      join('<x:xmpmeta><dc:creator>Pessoa Dona</dc:creator><xmp:Path>C:\\', 'Users\\fulano\\logo.ai</xmp:Path>'),
      'latin1',
    );
    const utf16 = Buffer.from(join('https://', 'ZYXWVUTSRQPONMLKJIHG', '.supabase.co'), 'utf16le');
    const problems = binaryContentProblems('public/brand/logo.png', Buffer.concat([png, xmp, utf16]), { terms: TERMS });
    expect(rules(problems)).toEqual(expect.arrayContaining(['C2', 'C6']));
    expect(messages(problems)).toContain('termo pessoal do histórico no conteúdo do arquivo binário: Pes…');
    expect(messages(problems)).toContain('ref do projeto do dono no conteúdo do arquivo binário: zyx…');
    for (const { term } of TERMS) expect(messages(problems).toLowerCase()).not.toContain(term.toLowerCase());
    expect(
      binaryContentProblems('public/brand/logo.png', Buffer.concat([png, Buffer.from('Manrope')]), { terms: TERMS }),
    ).toEqual([]);
  });

  it('o ref de projeto real no binário, fora dos termos e dos exemplos, reprova pelo C3, em UTF-16 e em Latin-1', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const url = (ref) => join('https://', ref, '.supabase.co');
    for (const encoding of ['utf16le', 'latin1']) {
      const problems = binaryContentProblems(
        'public/brand/logo.png',
        Buffer.concat([png, Buffer.from(url(FAKE_REF), encoding)]),
        {
          terms: TERMS,
        },
      );
      expect(rules(problems)).toEqual(['C3']);
      expect(messages(problems)).toContain('ref de projeto Supabase real no arquivo binário (qwe…)');
      expect(messages(problems)).not.toContain(FAKE_REF);
    }
    for (const ref of EXAMPLE_PROJECT_REFS)
      expect(
        binaryContentProblems('public/brand/logo.png', Buffer.concat([png, Buffer.from(url(ref), 'utf16le')]), {
          terms: TERMS,
        }),
      ).toEqual([]);
  });

  it('a pasta inteira: o termo no nome e no conteúdo de um binário reprovam (C2), com o caminho mascarado', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'crm-dist-binario-'));
    try {
      mkdirSync(path.join(dir, 'src'), { recursive: true });
      writeFileSync(path.join(dir, 'src', 'Pessoa Dona.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
      writeFileSync(
        path.join(dir, 'src', 'foto.jpg'),
        Buffer.concat([Buffer.from([0xff, 0xd8, 0]), Buffer.from('pessoa.dona@pessoal.example')]),
      );
      const policy = {
        ...DISTRIBUTION_POLICY,
        allowlist: [{ pattern: 'src/**', reason: 'código' }],
        excluded: [],
        required: [],
      };
      const problems = distributionProblems({
        dir,
        files: ['src/Pessoa Dona.png', 'src/foto.jpg'],
        terms: TERMS,
        policy,
      });
      const shown = messages(problems.filter((entry) => entry.rule === 'C2'));
      expect(shown).toContain('src/Pes….png — C2: termo pessoal do histórico no nome do arquivo: Pes…');
      expect(shown).toContain('src/foto.jpg — C2: termo pessoal do histórico no conteúdo do arquivo binário: pes…');
      expect(shown.toLowerCase()).not.toContain('pessoa dona');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('os arquivos especiais (C9 a C11)', () => {
  const WORKFLOW = [
    'jobs:',
    '  backup:',
    "    if: vars.CRM_BACKUP_ENABLED == 'true'",
    '    steps:',
    '      - env:',
    '          DB_URL: ${{ secrets.CRM_BACKUP_DB_URL }}',
    '          ARCHIVE_PASSWORD: ${{ secrets.CRM_BACKUP_PASSWORD }}',
    '          RCLONE_CONFIG_CONTENT: ${{ secrets.CRM_BACKUP_RCLONE_CONFIG }}',
  ].join('\n');

  it('o workflow de backup real e a fixture passam; sem o if ou com um valor no arquivo, reprovam', () => {
    expect(backupWorkflowProblems(read('.github/workflows/backup-banco.yml'))).toEqual([]);
    expect(backupWorkflowProblems(WORKFLOW)).toEqual([]);
    expect(
      messages(backupWorkflowProblems(WORKFLOW.replace("    if: vars.CRM_BACKUP_ENABLED == 'true'\n", ''))),
    ).toContain("if: vars.CRM_BACKUP_ENABLED == 'true'");
    expect(
      messages(backupWorkflowProblems(WORKFLOW.replace('${{ secrets.CRM_BACKUP_PASSWORD }}', 'senha-no-arquivo'))),
    ).toContain('ARCHIVE_PASSWORD precisa vir de ${{ secrets.… }}');
    expect(rules(backupWorkflowProblems(`${WORKFLOW}\n          CRM_BACKUP_DB_URL: postgresql://x`))).toEqual(['C9']);
  });

  it('a marca do programa passa; a Acme, não', () => {
    expect(brandProblems(path.join(ROOT, 'public', 'brand'))).toEqual([]);
    expect(messages(brandProblems(path.join(ROOT, 'tests', 'browser', 'brand', 'acme')))).toContain('C10');
    expect(messages(brandProblems(path.join(ROOT, 'nao-existe')))).toContain('C10: marca inválida');
  });

  it('o package.json privado e com a licença da base', () => {
    expect(packageProblems(read('package.json'))).toEqual([]);
    expect(rules(packageProblems('{"private": false, "license": "SEE LICENSE IN LICENSE"}'))).toEqual(['C11']);
    expect(rules(packageProblems('{"private": true, "license": "MIT"}'))).toEqual(['C11']);
    expect(rules(packageProblems('{'))).toEqual(['C11']);
  });
});

describe('os termos privados (seção 7.3)', () => {
  it('do histórico: e-mails, o usuário do noreply, nomes com duas palavras e usuários longos; sem os serviços', () => {
    const log = [
      'Pessoa Dona',
      'pessoa.dona@pessoal.example',
      'Pessoa Dona',
      'pessoa.dona@pessoal.example',
      'usuario-dona',
      `12345+usuario-dona@${NOREPLY}`,
      'GitHub',
      'noreply@github.com',
      'Claude',
      'noreply@anthropic.com',
      'dependabot[bot]',
      `49699333+dependabot[bot]@${NOREPLY}`,
      'Ana',
      'ana@pessoal.example',
    ].join('\n');
    expect(historyTerms(log).sort()).toEqual(
      [
        'Pessoa Dona',
        'pessoa.dona@pessoal.example',
        'usuario-dona',
        `12345+usuario-dona@${NOREPLY}`,
        'ana@pessoal.example',
      ].sort(),
    );
  });

  it('da tabela do registro do dono', () => {
    expect(
      registryTerms('| Campo | Valor |\n| Termo proibido | `11 99999-0000` |\n| Termo proibido | outro@x.example |\n'),
    ).toEqual(['11 99999-0000', 'outro@x.example']);
  });

  it('a tabela de termos do registro: linha fora do formato reprova, em vez de ser ignorada', () => {
    const registry = [
      '## Distribuição aos alunos',
      '',
      '| Campo | Valor |',
      '| --- | --- |',
      '| Organização GitHub do programa | Pendente |',
      '',
      '**Termos proibidos.** Texto.',
      '',
      '| Campo | Valor |',
      '| --- | --- |',
      '| Termo proibido | `11 99999-0000` |',
      '| Telefone | 11 98888-0000 |',
      '',
      '    | Termo proibido | `exemplo fictício` |',
      '',
      '| termo proibido | `minúsculo` |',
      '',
      '| Versão | Commit da base | Data |',
      '| --- | --- | --- |',
    ].join('\n');
    expect(registryTerms(registry)).toEqual(['11 99999-0000']);
    expect(registryTermFormatProblems(registry).map((entry) => entry.line)).toEqual([12, 16]);
    expect(registryTermFormatProblems(registry.replace('| Telefone | 11 98888-0000 |\n', ''))).toHaveLength(1);
  });

  it('fora do repositório da base, só as regras genéricas; na base sem o ref, a conferência reprova', () => {
    const outside = privateTerms({ root: path.join(ROOT, 'tests'), env: {}, gitLog: 'Pessoa Dona\np@x.example\n' });
    expect(outside).toEqual({ base: false, terms: [], problems: [] });
    const baseWithoutRef = privateTerms({
      root: path.join(ROOT, 'tests'),
      env: { [BASE_REPOSITORY_VARIABLE]: 'true' },
      gitLog: '',
    });
    expect(baseWithoutRef.base).toBe(true);
    expect(messages(baseWithoutRef.problems)).toContain(`${OWNER_REGISTRY_FILE} — C2`);
  });

  it('o --author: formato e termo pessoal', () => {
    expect(parseAuthor('Base do CRM <base@programa.example>')).toEqual({
      name: 'Base do CRM',
      email: 'base@programa.example',
    });
    expect(parseAuthor('base@programa.example')).toBeNull();
    expect(parseAuthor('Nome <sem-arroba>')).toBeNull();
    expect(authorTermProblem({ name: 'Base do CRM', email: 'base@programa.example' }, TERMS)).toBeNull();
    const refused = authorTermProblem({ name: 'Pessoa Dona', email: 'base@programa.example' }, TERMS);
    expect(refused).toContain('Pes…');
    expect(refused).not.toContain('Pessoa Dona');
  });
});

describe('o histórico da distribuição (release:check --dist)', () => {
  const entry = (subject, an = 'Base', ae = 'base@programa.example', cn = an, ce = ae) =>
    `${'a'.repeat(40)}\x1f${an}\x1f${ae}\x1f${cn}\x1f${ce}\x1f${subject}\x1e`;

  it('só commits de versão, com a identidade igual e a versão do topo igual à do package.json', () => {
    const log = entry('chore: versão 1.0.0-beta.2') + entry('chore: versão 1.0.0-beta.1');
    expect(distributionHistoryProblems({ log, packageVersion: '1.0.0-beta.2', terms: TERMS })).toEqual([]);
  });

  it.each([
    ['um commit que não é de versão (a base)', entry('feat: algo [Roteiro 1.1]'), 'não é de versão'],
    ['o commit de ensaio', entry('ensaio: 1.0.0-beta.0 (não publicar)'), 'é de ensaio'],
    [
      'autor e committer diferentes',
      entry('chore: versão 1.0.0-beta.1', 'A', 'a@x.example', 'B'),
      'autor e committer diferentes',
    ],
    [
      'um termo pessoal no autor',
      entry('chore: versão 1.0.0-beta.1', 'Pessoa Dona'),
      'termo pessoal do histórico: Pes…',
    ],
    ['a versão do topo diferente', entry('chore: versão 1.0.0-beta.9'), 'o commit do topo é da versão 1.0.0-beta.9'],
  ])('reprova %s', (_label, log, fragment) => {
    expect(messages(distributionHistoryProblems({ log, packageVersion: '1.0.0-beta.1', terms: TERMS }))).toContain(
      fragment,
    );
  });

  it('a versão do topo na mensagem sai com o termo mascarado antes do corte em 60 caracteres', () => {
    // Cortado cru em 60 caracteres, o assunto terminaria em "Pessoa Do": um pedaço que a máscara posterior não pega.
    const log = entry(`chore: versão ${'x'.repeat(50)} Pessoa Dona`);
    const shown = messages(distributionHistoryProblems({ log, packageVersion: '1.0.0-beta.1', terms: TERMS }));
    expect(shown).toContain(
      `o commit do topo é da versão ${'x'.repeat(50)} Pes…, mas o package.json está em 1.0.0-beta.1`,
    );
    expect(shown.toLowerCase()).not.toContain('pessoa');
  });

  it('o assunto do commit na mensagem sai com o termo mascarado, mesmo cortado em 60 caracteres', () => {
    const log = entry('Merge pull request #12 from Pessoa Dona/correcao e pessoa.dona@pessoal.example');
    const shown = messages(distributionHistoryProblems({ log, packageVersion: '1.0.0-beta.1', terms: TERMS }));
    expect(shown).toContain('não é de versão ("Merge pull request #12 from Pes…/correcao e pes…');
    expect(shown.toLowerCase()).not.toContain('pessoa dona');
    expect(shown.toLowerCase()).not.toContain('pessoa.dona');
  });

  it('num pull request, o repositório de distribuição confere só o conteúdo (o commit de merge do GitHub)', () => {
    expect(distributionHistoryChecked({ GITHUB_EVENT_NAME: 'pull_request' })).toBe(false);
    expect(distributionHistoryChecked({ GITHUB_EVENT_NAME: 'push' })).toBe(true);
    expect(distributionHistoryChecked({})).toBe(true);
    // O que o histórico reprovaria num PR, se fosse conferido.
    const merge = entry('Merge 123 into 456', 'Base', 'base@programa.example', 'GitHub', 'noreply@github.com');
    expect(
      messages(
        distributionHistoryProblems({
          log: merge + entry('chore: versão 1.0.0-beta.1'),
          packageVersion: '1.0.0-beta.1',
        }),
      ),
    ).toContain('não é de versão');
  });

  it('as tags: anotadas, com a identidade do commit e sem termo pessoal', () => {
    const tag = (name, type, tn, te, an = 'Base', ae = '<base@programa.example>') =>
      `${name}\x1f${type}\x1f${tn}\x1f${te}\x1f${an}\x1f${ae}\x1e`;
    expect(
      distributionTagProblems({ refs: tag('v1.0.0-beta.1', 'tag', 'Base', '<base@programa.example>'), terms: TERMS }),
    ).toEqual([]);
    const personal = messages(
      distributionTagProblems({
        refs: tag('v1.0.0-beta.1', 'tag', 'Pessoa Dona', '<pessoa.dona@pessoal.example>'),
        terms: TERMS,
      }),
    );
    expect(personal).toContain('H2: a tag v1.0.0-beta.1 tem termo pessoal do histórico');
    expect(personal).toContain('foi criada por outra identidade');
    expect(personal.toLowerCase()).not.toContain('pessoa dona');
    expect(messages(distributionTagProblems({ refs: tag('v1', 'commit', '', ''), terms: [] }))).toContain(
      'não é anotada',
    );
  });

  it('o ensaio é aceito só com allowRehearsal, como commit único', () => {
    const log = entry('ensaio: 1.0.0-beta.0 (não publicar)');
    expect(distributionHistoryProblems({ log, packageVersion: '1.0.0-beta.0', allowRehearsal: true })).toEqual([]);
    const twice = log + entry('chore: versão 1.0.0-beta.1');
    expect(
      messages(distributionHistoryProblems({ log: twice, packageVersion: '1.0.0-beta.0', allowRehearsal: true })),
    ).toContain('é de ensaio');
  });
});

// AC-8: o termo de beta, em rascunho, coerente com a LICENSE.
describe('o termo de beta (docs/TERMO-BETA.md)', () => {
  const terms = read(BETA_TERMS_FILE);
  const plain = terms
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  it('abre com o aviso de rascunho para revisão jurídica', () => {
    const head = terms
      .split('\n')
      .slice(0, 5)
      .join('\n')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    expect(head).toContain('rascunho para revisao juridica');
  });

  it('cita a LICENSE e os termos-chave da seção 9 do desenho', () => {
    expect(terms).toContain('LICENSE');
    for (const fragment of [
      'sem garantia',
      'lgpd',
      'nao trata',
      'senha',
      '[canal de suporte do programa]',
      'changelog.md',
    ])
      expect(plain, fragment).toContain(fragment);
    expect(/dados de teste|dados ficticios/.test(plain)).toBe(true);
    expect(terms).toContain('](LGPD-INSTANCIA.md)');
    expect(terms).toContain('1.0.0-rc.1');
  });

  it('README, a licença, o guia de implantação e a publicação apontam para ele', () => {
    expect(read('README.md')).toContain('](docs/TERMO-BETA.md)');
    for (const file of ['docs/LICENCA.md', 'docs/IMPLANTACAO.md', ['docs/PUBLICACAO', 'CRM.md'].join('-')])
      expect(read(file), file).toContain('](TERMO-BETA.md)');
  });
});

/**
 * Os arquivos reais (seção 7.4): no repositório da base (com o registro do ambiente do dono ou CRM_BASE_REPOSITORY) e
 * no de distribuição. No clone de uma empresa, o teste fica de fora: os arquivos dela não são da distribuição.
 */
const realRepository =
  existsSync(path.join(ROOT, OWNER_REGISTRY_FILE)) ||
  process.env[BASE_REPOSITORY_VARIABLE] === 'true' ||
  process.env[DISTRIBUTION_REPOSITORY_VARIABLE] === 'true';

describe.runIf(realRepository)(
  'os arquivos reais (repositório da base ou de distribuição)',
  { timeout: 60_000 },
  () => {
    it('passam na conferência inteira, com os termos privados da base', () => {
      const terms = privateTerms({ root: ROOT });
      const problems = [
        ...terms.problems,
        ...distributionProblems({ dir: ROOT, files: workingTreeFiles(ROOT), terms: terms.terms }),
      ];
      expect(problems.map(formatProblem)).toEqual([]);
    });

    it('na base, os termos incluem o ref do dono e os autores do histórico', () => {
      const terms = privateTerms({ root: ROOT });
      if (!existsSync(path.join(ROOT, OWNER_REGISTRY_FILE))) return;
      expect(terms.base).toBe(true);
      expect(terms.terms.some((entry) => entry.source === 'ref do projeto do dono')).toBe(true);
      expect(terms.terms.some((entry) => entry.source === 'termo pessoal do histórico')).toBe(true);
    });
  },
);
