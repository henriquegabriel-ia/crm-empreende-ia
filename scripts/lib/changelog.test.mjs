// Item 1.7b (docs/arquitetura/1.7b.md, seções 4.6, 5 e 6.4): o CHANGELOG.md, a versão do package.json e a LICENSE.
// As regras moram em scripts/lib/changelog.mjs e passam pelo arquivo real (nenhum problema) e por fixtures, uma por
// regra, cada uma com a mensagem esperada. O teste não lê tags do Git (o CI do GitHub clona sem elas).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ownerProjectRef } from './ai-rules.mjs';
import { baseMigrationFiles, readBaseMigrationNames } from './base-manifest.mjs';
import {
  CHANGELOG_FILE,
  changelogProblems,
  changelogSections,
  compareSemver,
  guardedObjects,
  isDevelopmentVersion,
  isSemver,
  parseSemver,
} from './changelog.mjs';
import { MIGRATIONS_DIR, ROOT } from './embedded-db.mjs';

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(read('package.json'));
const OWNER_DOC = 'docs/dono/AMBIENTE.md';
const OWNER_REF = existsSync(path.join(ROOT, OWNER_DOC)) ? ownerProjectRef(read(OWNER_DOC)) : null;
const migrations = baseMigrationFiles(
  readdirSync(path.join(ROOT, MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')),
  readBaseMigrationNames(),
);
const migrationSources = Object.fromEntries(migrations.map((file) => [file, read(`${MIGRATIONS_DIR}/${file}`)]));
const exists = (cited) => existsSync(path.join(ROOT, cited));
const real = () => ({
  text: read(CHANGELOG_FILE),
  packageVersion: pkg.version,
  migrations,
  migrationSources,
  scripts: pkg.scripts,
  exists,
  ownerRef: OWNER_REF,
});

describe('o CHANGELOG.md real (item 1.7b)', () => {
  it('passa em todas as regras', () => {
    expect(changelogProblems(real())).toEqual([]);
  });

  it('tem [Não publicado] no topo, com Migrações e Ao atualizar, e cita cada migração da base uma vez', () => {
    const sections = changelogSections(read(CHANGELOG_FILE));
    expect(sections[0].heading).toBe('## [Não publicado]');
    expect(sections[0].subsections.slice(0, 2).map((sub) => sub.name)).toEqual(['Migrações', 'Ao atualizar']);
    expect(migrations.length).toBeGreaterThanOrEqual(20);
    for (const file of migrations) expect(sections[0].subsections[0].text, file).toContain(`\`${file}\``);
  });

  it('as notas do [Não publicado] cobrem o que exige ação de quem atualiza (seção 6.3 do desenho)', () => {
    const update = changelogSections(read(CHANGELOG_FILE))[0].subsections.find((sub) => sub.name === 'Ao atualizar');
    for (const fragment of [
      'Instalação nova',
      'npx supabase@2.119.0 db push',
      'npm run emails:build',
      'npm run config:push',
      'VITE_CRM_ENVIRONMENT',
      'VITE_SUPPORT_EMAIL',
      'supabase/instance-check.sql',
      'supabase/db-drift-check.sql',
      'Backup do banco',
    ])
      expect(update.text, fragment).toContain(fragment);
  });
});

// Uma fixture válida, com duas migrações (a segunda com a guarda) e uma versão publicada.
const FIXTURE_MIGRATIONS = ['20260101000000_inicio.sql', '20260201000000_guarda.sql'];
const FIXTURE_SOURCES = {
  '20260101000000_inicio.sql': 'create table public.x(id int);',
  '20260201000000_guarda.sql':
    "-- private.assert_base_definition('function', 'private.comentario()', array['x']) em comentário não conta\nselect private.assert_base_definition('function', 'private.funcao(uuid)', array['abc']);\nselect private.assert_base_definition('policy', 'public.x.leitura', array['def']);",
};
const FIXTURE = `# Registro de mudanças

## [Não publicado]

### Migrações

- \`20260201000000_guarda.sql\`: **guarda** \`private.funcao\` e \`public.x.leitura\`.

### Adicionado

- Algo novo. (1.1)

## [1.0.0-beta.1] - 2026-11-02

### Migrações

- \`20260101000000_inicio.sql\`: o início.

### Ao atualizar

- Rode \`npm run config:push\`.
`;
const fixture = (overrides = {}) => ({
  text: FIXTURE,
  packageVersion: '1.0.0-beta.1',
  migrations: FIXTURE_MIGRATIONS,
  migrationSources: FIXTURE_SOURCES,
  scripts: pkg.scripts,
  exists,
  ownerRef: 'abcdefghijklmnopqrst',
  ...overrides,
});

describe('as regras do CHANGELOG.md, por fixture (item 1.7b, seção 6.4)', () => {
  it('a fixture válida passa', () => {
    expect(changelogProblems(fixture())).toEqual([]);
  });

  const cases = [
    [
      'sem [Não publicado] no topo',
      { text: FIXTURE.replace('## [Não publicado]\n', '') },
      'CHANGELOG.md: a primeira seção precisa ser ## [Não publicado].',
    ],
    [
      'uma versão inventada fora do SemVer',
      { text: FIXTURE.replace('## [1.0.0-beta.1] - 2026-11-02', '## [1.2] - 2026-11-02') },
      'CHANGELOG.md: a versão 1.2 não é SemVer',
    ],
    [
      'a ordem errada (rc.1 abaixo de beta.2, pela precedência das pré-versões)',
      {
        text: FIXTURE.replace(
          '## [1.0.0-beta.1] - 2026-11-02',
          '## [1.0.0-beta.2] - 2026-11-09\n\n## [1.0.0-rc.1] - 2026-11-02',
        ),
        packageVersion: '1.0.0-beta.2',
      },
      'CHANGELOG.md: a versão 1.0.0-rc.1 aparece depois de uma menor (1.0.0-beta.2)',
    ],
    [
      'uma data que não existe',
      { text: FIXTURE.replace('2026-11-02', '2026-02-30') },
      'CHANGELOG.md: a data 2026-02-30 da versão 1.0.0-beta.1 não existe',
    ],
    [
      'um cabeçalho de versão sem a data',
      { text: FIXTURE.replace('## [1.0.0-beta.1] - 2026-11-02', '## [1.0.0-beta.1]') },
      'CHANGELOG.md: o cabeçalho "## [1.0.0-beta.1]" não segue o formato',
    ],
    [
      'o package.json diferente da última versão',
      { packageVersion: '1.0.0-rc.1' },
      'package.json está em 1.0.0-rc.1, mas a última versão do CHANGELOG.md é 1.0.0-beta.1: o commit de lançamento muda os dois juntos (docs/ATUALIZACAO.md).',
    ],
    [
      'o package.json fora do SemVer',
      { packageVersion: '0.0' },
      'package.json: a versão 0.0 não segue o Versionamento Semântico',
    ],
    [
      'a .0 de desenvolvimento publicada como versão',
      {
        text: FIXTURE.replace('## [1.0.0-beta.1] - 2026-11-02', '## [1.0.0-beta.0] - 2026-11-02'),
        packageVersion: '1.0.0-beta.0',
      },
      'CHANGELOG.md: a versão 1.0.0-beta.0 termina em .0',
    ],
    [
      'nenhuma versão publicada e o package.json fora da .0 de desenvolvimento',
      {
        text: FIXTURE.slice(0, FIXTURE.indexOf('## [1.0.0-beta.1]')).replace(
          '- `20260201000000_guarda.sql`',
          '- `20260101000000_inicio.sql`: o início.\n- `20260201000000_guarda.sql`',
        ),
        packageVersion: '1.0.0-beta.1',
      },
      'package.json está em 1.0.0-beta.1, mas o CHANGELOG.md não tem nenhuma versão publicada',
    ],
    [
      'uma subseção desconhecida',
      { text: FIXTURE.replace('### Adicionado', '### Novidades') },
      'CHANGELOG.md, [Não publicado]: a subseção ### Novidades não é do formato',
    ],
    [
      'uma subseção fora de ordem',
      {
        text: FIXTURE.replace(
          '### Ao atualizar\n\n- Rode',
          '### Adicionado\n\n- X. (1.1)\n\n### Ao atualizar\n\n- Rode',
        ),
      },
      'CHANGELOG.md, [1.0.0-beta.1] - 2026-11-02: a subseção ### Ao atualizar está fora de ordem ou repetida',
    ],
    [
      'uma migração que não existe',
      { text: `${FIXTURE}\n- Veja \`20260301000000_inventada.sql\`.\n` },
      'CHANGELOG.md cita a migração 20260301000000_inventada.sql, que não existe em supabase/migrations.',
    ],
    [
      'uma migração _custom_ de uma instância',
      { text: `${FIXTURE}\n- Veja \`20260301000000_custom_cnpj.sql\`.\n` },
      'CHANGELOG.md cita a migração 20260301000000_custom_cnpj.sql, que é de uma instância (_custom_)',
    ],
    [
      'uma migração nova da base sem entrada',
      { migrations: [...FIXTURE_MIGRATIONS, '20260301000000_teams.sql'] },
      'A migração 20260301000000_teams.sql não está em nenhuma seção Migrações do CHANGELOG.md: acrescente-a em [Não publicado].',
    ],
    [
      'uma migração repetida em duas versões',
      {
        text: FIXTURE.replace('- Algo novo. (1.1)', '- Algo novo. (1.1)').replace(
          'o início.',
          'o início; de novo `20260201000000_guarda.sql`.',
        ),
      },
      'A migração 20260201000000_guarda.sql aparece 2 vezes nas seções Migrações do CHANGELOG.md',
    ],
    [
      'um objeto da guarda que a versão não cita',
      { text: FIXTURE.replace(' e `public.x.leitura`', '') },
      '20260201000000_guarda.sql protege public.x.leitura com a guarda, mas a versão dela no CHANGELOG.md não o cita',
    ],
    [
      'um npm run que não existe',
      { text: `${FIXTURE}\n- Rode \`npm run atualizar\`.\n` },
      'CHANGELOG.md cita npm run atualizar, que não existe no package.json',
    ],
    [
      'um caminho que não existe',
      { text: `${FIXTURE}\n- Veja \`docs/NAO-EXISTE.md\`.\n` },
      'CHANGELOG.md cita docs/NAO-EXISTE.md, que não existe no repositório',
    ],
    [
      'um link para docs/dono/',
      { text: `${FIXTURE}\n- Veja [o ambiente](docs/dono/AMBIENTE.md).\n` },
      'CHANGELOG.md aponta para docs/dono/',
    ],
    [
      'o ref do projeto do dono',
      { text: `${FIXTURE}\n- O projeto abcdefghijklmnopqrst.\n` },
      'CHANGELOG.md cita um projeto Supabase real',
    ],
  ];
  it.each(cases)('reprova %s', (_label, overrides, fragment) => {
    expect(changelogProblems(fixture(overrides)).join('\n')).toContain(fragment);
  });

  it('a guarda em comentário não conta, e a função é citada sem os argumentos', () => {
    expect(guardedObjects(FIXTURE_SOURCES['20260201000000_guarda.sql'])).toEqual([
      'private.funcao',
      'public.x.leitura',
    ]);
    expect(guardedObjects(migrationSources['20261019120000_default_privileges.sql'])).toEqual([
      'private.base_fingerprints',
    ]);
  });
});

describe('o Versionamento Semântico (item 1.7b, seção 5.1)', () => {
  it('ordena pela precedência do SemVer 2.0.0', () => {
    const ordered = [
      '0.9.0',
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.0',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
    ];
    for (let index = 1; index < ordered.length; index += 1) {
      expect(
        compareSemver(ordered[index - 1], ordered[index]),
        `${ordered[index - 1]} < ${ordered[index]}`,
      ).toBeLessThan(0);
      expect(compareSemver(ordered[index], ordered[index - 1])).toBeGreaterThan(0);
    }
    expect(compareSemver('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
    // A .0 de hoje é menor que qualquer versão futura, inclusive se a distribuição pular direto para o rc.1.
    expect(compareSemver('1.0.0-beta.0', '1.0.0-beta.1')).toBeLessThan(0);
    expect(compareSemver('1.0.0-beta.0', '1.0.0-rc.1')).toBeLessThan(0);
  });

  it.each(['01.0.0', '1.0', '1.0.0-', '1.0.0-01', 'v1.0.0', '1.0.0.0', ''])(
    'recusa a versão inválida "%s"',
    (value) => {
      expect(isSemver(value)).toBe(false);
      expect(parseSemver(value)).toBeNull();
    },
  );

  it('a .0 de desenvolvimento é a pré-versão terminada em zero', () => {
    expect(isDevelopmentVersion('1.0.0-beta.0')).toBe(true);
    expect(isDevelopmentVersion('1.0.0-beta.1')).toBe(false);
    expect(isDevelopmentVersion('1.0.0')).toBe(false);
  });
});

const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

describe('LICENSE e package.json (item 1.7b, seção 4.6)', () => {
  const license = read('LICENSE');

  it('a LICENSE abre com o aviso de rascunho para revisão jurídica', () => {
    const top = license.split('\n').slice(0, 5).join('\n');
    expect(top).toContain('RASCUNHO');
    expect(normalize(top)).toContain('revisao juridica');
    expect(top).toContain('contrato do programa');
    expect(top).toContain('docs/LICENCA.md');
  });

  it('a LICENSE cobre os termos da D4, da D3 e do 1.10', () => {
    const text = normalize(license);
    for (const term of [
      'licenciado',
      'cliente final',
      'instancia',
      'servico com marca propria',
      'feito com empreende.ia',
      'redistribu',
      'repositorio publico',
      'sem garantia',
      'dados pessoais',
      'controladora',
      '30 dias',
      'componentes de terceiros',
    ])
      expect(text, term).toContain(term);
    for (let section = 1; section <= 14; section += 1)
      expect(license, String(section)).toMatch(new RegExp(`^${section}\\. `, 'm'));
  });

  it('as restrições e as modificações ressalvam as duas entregas permitidas: prestadores (3(d)) e o cliente (4)', () => {
    // Sem a 3(d) na exceção, a 5(a) e a seção 7 proibiriam o que a 3(d) concede (o freelancer ou a agência).
    const oneLine = license.replace(/\s+/g, ' ');
    expect(oneLine).toContain('a quem não for Licenciado, salvo o que as seções 3(d) e 4 permitem;');
    expect(oneLine).toContain('Uma versão modificada só circula como as seções 3(d), 4 e 5 permitem.');
    expect(read('docs/LICENCA.md')).toMatch(/Para o advogado[\s\S]*seção 4\)[^\n]*seção 3 \(d\)/);
  });

  it('o package.json diz a licença, continua privado e tem a versão SemVer coerente com o CHANGELOG.md', () => {
    expect(pkg.license).toBe('SEE LICENSE IN LICENSE');
    expect(pkg.private).toBe(true);
    expect(isSemver(pkg.version)).toBe(true);
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
    expect(lock.packages[''].license).toBe(pkg.license);
  });

  it('o README aponta a LICENSE e a explicação, sem o antigo "todos os direitos reservados"', () => {
    const readme = read('README.md');
    const section = readme.slice(readme.indexOf('## Licença'));
    expect(section).toContain('[`LICENSE`](LICENSE)');
    expect(section).toContain('docs/LICENCA.md');
    expect(section).toContain('rascunho para revisão jurídica');
    expect(readme).not.toContain('todos os direitos reservados');
  });

  it('docs/LICENCA.md compara os cinco modelos com as fontes oficiais e traz o "posso ou não posso"', () => {
    const doc = read('docs/LICENCA.md');
    for (const source of [
      'https://spdx.org/licenses/BUSL-1.1.html',
      'https://www.elastic.co/licensing/elastic-license',
      'https://polyformproject.org/licenses/internal-use/1.0.0',
      'https://commonsclause.com/',
      'https://fair.io/about/',
      'https://fsl.software/',
    ])
      expect(doc, source).toContain(source);
    expect(doc).toContain('## 2. Posso…?');
    expect(doc).toContain('## 6. Decisões abertas');
    expect(doc).toContain('rascunho para revisão jurídica');
  });
});
