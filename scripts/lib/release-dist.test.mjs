// Item 1.7a (docs/arquitetura/1.7a.md, seções 5 e 18.1): a montagem da árvore de cada versão, com o git real, sobre
// repositórios temporários e uma allowlist pequena. As recusas da seção 5.3 (nada escrito), a primeira versão (um commit
// no main, com a identidade do --author e sem a configuração global de quem roda), a versão seguinte (filha da
// anterior, sem o arquivo que saiu e com o novo), o ensaio, a conferência --dist e as tags.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DISTRIBUTION_POLICY,
  DistributionError,
  MAX_FILE_BYTES,
  buildDistribution,
  checkDistributionFolder,
  devopsSteps,
  formatProblem,
  privateTerms,
} from './distribution.mjs';

const TEMP = mkdtempSync(path.join(tmpdir(), 'crm-release-dist-'));
afterAll(() => rmSync(TEMP, { recursive: true, force: true }));

const OWNER = 'Pessoa Dona Teste';
const OWNER_EMAIL = 'dona@pessoal.example';
const AUTHOR = 'Base do CRM <base@programa.example>';
const OWNER_REF = 'zyxwvutsrqponmlkjihg';
const POLICY = {
  ...DISTRIBUTION_POLICY,
  allowlist: [
    { pattern: '.gitignore', reason: 'git' },
    { pattern: 'README.md', reason: 'visão geral' },
    { pattern: 'CHANGELOG.md', reason: 'notas' },
    { pattern: 'package.json', reason: 'pacote' },
    { pattern: 'docs/GUIA.md', reason: 'guia' },
    { pattern: 'src/**', reason: 'código' },
  ],
  excluded: [{ pattern: 'docs/dono/**', reason: 'registros do dono' }],
  required: ['README.md', 'package.json'],
};

// O git dos testes também sem a configuração de quem roda, com a identidade pessoal fictícia nos commits da base.
const emptyConfig = path.join(TEMP, 'vazio.gitconfig');
writeFileSync(emptyConfig, '');
const baseEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: emptyConfig,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: OWNER,
  GIT_AUTHOR_EMAIL: OWNER_EMAIL,
  GIT_COMMITTER_NAME: OWNER,
  GIT_COMMITTER_EMAIL: OWNER_EMAIL,
};
const run = (cwd, args, env = baseEnv) => {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
const write = (root, file, content) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
};
const changelog = (version) =>
  version.endsWith('.0')
    ? '# Registro de mudanças\n\n## [Não publicado]\n\n- Tudo.\n'
    : `# Registro de mudanças\n\n## [Não publicado]\n\nNada por enquanto.\n\n## [${version}] - 2026-11-02\n\n- Tudo.\n`;

let counter = 0;
/** Um repositório da base fictício, com um commit da identidade pessoal. */
function makeBase({ version = '1.0.0-beta.1', registry = true, extra = {} } = {}) {
  counter += 1;
  const root = path.join(TEMP, `base-${counter}`);
  mkdirSync(root, { recursive: true });
  const files = {
    '.gitignore': 'node_modules\n',
    'README.md': '# CRM de teste\n',
    'CHANGELOG.md': changelog(version),
    'package.json': `${JSON.stringify({ name: 'crm-teste', private: true, version, license: 'SEE LICENSE IN LICENSE' }, null, 2)}\n`,
    'docs/GUIA.md': '# Guia\n',
    'src/a.ts': 'export const a = 1;\n',
    ...(registry
      ? {
          'docs/dono/AMBIENTE.md': `# Ambiente\n\n| Campo | Valor |\n| --- | --- |\n| Referência | \`${OWNER_REF}\` |\n\n## Distribuição\n\n| Termo proibido | \`11 98888-7777\` |\n`,
        }
      : {}),
    ...extra,
  };
  for (const [file, content] of Object.entries(files)) write(root, file, content);
  run(root, ['init', '-q', '-b', 'main']);
  run(root, ['add', '-A']);
  run(root, ['commit', '-q', '-m', 'feat: base de teste']);
  return root;
}
const release = (options) => buildDistribution({ author: AUTHOR, policy: POLICY, env: baseEnv, ...options });
const refusal = (options) => {
  try {
    release(options);
  } catch (error) {
    if (error instanceof DistributionError) return error.message;
    throw error;
  }
  throw new Error('a distribuição não foi recusada');
};
const pkgJson = (version) =>
  `${JSON.stringify({ name: 'crm-teste', private: true, version, license: 'SEE LICENSE IN LICENSE' }, null, 2)}\n`;
/** O estado de uma pasta de distribuição: o commit do topo, as tags e os arquivos. Igual antes e depois de uma recusa. */
const snapshot = (dir) => ({
  head: run(dir, ['rev-parse', 'HEAD']),
  tags: run(dir, ['tag', '--list']),
  files: listFiles(dir).sort(),
});
const listFiles = (dir, prefix = '') =>
  readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git') return [];
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(dir, relative) : [relative];
  });

describe('npm run release:dist (item 1.7a)', { timeout: 60_000 }, () => {
  it('primeira versão: só a allowlist, um commit no main, com o --author e sem a configuração global de quem roda', () => {
    const base = makeBase();
    const out = path.join(TEMP, 'dist-primeira');
    // Uma configuração global "pessoal" falsa: outro e-mail, assinatura obrigatória e um hook que reprova o commit.
    const hooks = path.join(TEMP, 'hooks-pessoais');
    write(hooks, 'pre-commit', '#!/bin/sh\nexit 1\n');
    write(hooks, 'commit-msg', '#!/bin/sh\nexit 1\n');
    const personal = path.join(TEMP, 'pessoal.gitconfig');
    writeFileSync(
      personal,
      `[user]\n\tname = Outra Pessoa\n\temail = outra@pessoal.example\n[commit]\n\tgpgsign = true\n[core]\n\thooksPath = ${hooks.replace(/\\/g, '/')}\n`,
    );
    const summary = release({
      root: base,
      out,
      env: { ...baseEnv, GIT_CONFIG_GLOBAL: personal, GIT_CONFIG_NOSYSTEM: '' },
    });
    expect(summary).toMatchObject({ version: '1.0.0-beta.1', mode: 'first', rehearsal: false, files: 6 });
    expect(listFiles(out).sort()).toEqual(
      ['.gitignore', 'CHANGELOG.md', 'README.md', 'docs/GUIA.md', 'package.json', 'src/a.ts'].sort(),
    );
    expect(existsSync(path.join(out, 'docs', 'dono'))).toBe(false);
    expect(run(out, ['rev-list', '--count', 'HEAD'])).toBe('1');
    expect(run(out, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');
    expect(run(out, ['log', '-1', '--format=%s'])).toBe('chore: versão 1.0.0-beta.1');
    expect(run(out, ['log', '-1', '--format=%an <%ae>|%cn <%ce>'])).toBe(`${AUTHOR}|${AUTHOR}`);
    expect(run(out, ['log', '-1', '--format=%G?'])).toBe('N');
    expect(run(out, ['status', '--porcelain'])).toBe('');
    // A identidade do programa fica na configuração local da pasta, para a tag do @devops.
    expect(run(out, ['config', '--local', 'user.name'])).toBe('Base do CRM');
    expect(run(out, ['config', '--local', 'user.email'])).toBe('base@programa.example');
    // A conferência da árvore antes do envio, com os termos da base: aprovada.
    const terms = privateTerms({ root: base, env: {} });
    expect(terms.terms.map((entry) => entry.source)).toContain('ref do projeto do dono');
    expect(checkDistributionFolder({ dir: out, terms: terms.terms, policy: POLICY }).map(formatProblem)).toEqual([]);
  });

  it('versão seguinte: um segundo commit, filho do primeiro, sem o arquivo que saiu e com o novo', () => {
    const base = makeBase();
    const out = path.join(TEMP, 'dist-seguinte');
    release({ root: base, out });
    const first = run(out, ['rev-parse', 'HEAD']);
    rmSync(path.join(base, 'src', 'a.ts'));
    write(base, 'src/b.ts', 'export const b = 2;\n');
    write(
      base,
      'package.json',
      `${JSON.stringify({ name: 'crm-teste', private: true, version: '1.0.0-beta.2', license: 'SEE LICENSE IN LICENSE' }, null, 2)}\n`,
    );
    write(base, 'CHANGELOG.md', changelog('1.0.0-beta.2'));
    run(base, ['add', '-A']);
    run(base, ['commit', '-q', '-m', 'chore: versão 1.0.0-beta.2']);
    const summary = release({ root: base, out });
    expect(summary).toMatchObject({ version: '1.0.0-beta.2', previousVersion: '1.0.0-beta.1', mode: 'next' });
    expect(run(out, ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(run(out, ['rev-parse', 'HEAD^'])).toBe(first);
    expect(existsSync(path.join(out, 'src', 'a.ts'))).toBe(false);
    expect(existsSync(path.join(out, 'src', 'b.ts'))).toBe(true);
    expect(run(out, ['log', '--format=%s'])).toBe('chore: versão 1.0.0-beta.2\nchore: versão 1.0.0-beta.1');
    expect(checkDistributionFolder({ dir: out, terms: [], policy: POLICY })).toEqual([]);
    // A mesma versão de novo: já distribuída.
    expect(refusal({ root: base, out })).toContain('A versão 1.0.0-beta.2 já foi distribuída');
  });

  it('ensaio: numa pasta nova, com a versão .0 e mudanças sem commit; o --dist o recusa para envio', () => {
    const base = makeBase({ version: '1.0.0-beta.0' });
    write(base, 'src/nova.ts', 'export const nova = true;\n');
    const out = path.join(TEMP, 'dist-ensaio');
    const summary = release({ root: base, out, rehearsal: true });
    expect(summary).toMatchObject({ version: '1.0.0-beta.0', rehearsal: true, baseDirty: true });
    expect(existsSync(path.join(out, 'src', 'nova.ts'))).toBe(true);
    expect(run(out, ['log', '-1', '--format=%s'])).toBe('ensaio: 1.0.0-beta.0 (não publicar)');
    expect(checkDistributionFolder({ dir: out, terms: [], policy: POLICY }).map(formatProblem).join('\n')).toContain(
      'é de ensaio',
    );
    expect(checkDistributionFolder({ dir: out, terms: [], policy: POLICY, allowRehearsal: true })).toEqual([]);
    // Ensaio numa distribuição existente: recusado.
    const real = makeBase();
    const dist = path.join(TEMP, 'dist-sem-ensaio');
    release({ root: real, out: dist });
    expect(refusal({ root: real, out: dist, rehearsal: true })).toContain('Ensaio só em pasta nova');
  });

  it('o --dist reprova um commit com autor e committer diferentes e um que não é de versão', () => {
    const base = makeBase();
    const out = path.join(TEMP, 'dist-autor');
    release({ root: base, out });
    write(out, 'src/a.ts', 'export const a = 3;\n');
    run(out, ['add', '-A']);
    run(out, ['commit', '-q', '-m', 'chore: versão 1.0.0-beta.1'], {
      ...baseEnv,
      GIT_AUTHOR_NAME: 'Base do CRM',
      GIT_AUTHOR_EMAIL: 'base@programa.example',
    });
    const problems = checkDistributionFolder({
      dir: out,
      terms: privateTerms({ root: base, env: {} }).terms,
      policy: POLICY,
    })
      .map(formatProblem)
      .join('\n');
    expect(problems).toContain('autor e committer diferentes');
    expect(problems).toContain('termo pessoal do histórico');
    expect(problems).not.toContain(OWNER);
    const notVersion = checkDistributionFolder({ dir: base, terms: [], policy: POLICY }).map(formatProblem).join('\n');
    expect(notVersion).toContain('não é de versão');
  });

  it('um arquivo versionado com git add -f, que o .gitignore ignora, entra no commit', () => {
    const base = makeBase({ extra: { '.gitignore': 'node_modules\n*.gen.ts\n' } });
    write(base, 'src/types.gen.ts', 'export type T = 1;\n');
    run(base, ['add', '-f', 'src/types.gen.ts']);
    run(base, ['commit', '-q', '-m', 'feat: tipos gerados']);
    const out = path.join(TEMP, 'dist-forcado');
    expect(release({ root: base, out }).files).toBe(7);
    expect(run(out, ['ls-files']).split('\n')).toContain('src/types.gen.ts');
    expect(run(out, ['status', '--porcelain', '--ignored'])).toBe('');
  });

  it('as tags: a do @devops com a identidade do programa passa; com a pessoal, o --dist reprova sem mostrar o termo', () => {
    const base = makeBase();
    const out = path.join(TEMP, 'dist-tags');
    const summary = release({ root: base, out });
    const terms = privateTerms({ root: base, env: {} }).terms;
    const tagStep = devopsSteps(summary).find((step) => step.includes(' tag -a '));
    expect(tagStep).toBe(
      'git -c user.name="Base do CRM" -c user.email="base@programa.example" tag -a v1.0.0-beta.1 -m "v1.0.0-beta.1"',
    );
    // O passo como o guia manda, com a identidade explícita, num ambiente sem as variáveis de identidade dos testes.
    const withoutIdentity = Object.fromEntries(
      Object.entries(baseEnv).filter(([key]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(key)),
    );
    run(
      out,
      [
        '-c',
        'user.name=Base do CRM',
        '-c',
        'user.email=base@programa.example',
        'tag',
        '-a',
        'v1.0.0-beta.1',
        '-m',
        'v1.0.0-beta.1',
      ],
      withoutIdentity,
    );
    expect(checkDistributionFolder({ dir: out, terms, policy: POLICY }).map(formatProblem)).toEqual([]);
    // Uma tag criada com a identidade pessoal de quem roda.
    run(out, ['tag', '-a', 'v1.0.0-beta.1-pessoal', '-m', 'x']);
    const problems = checkDistributionFolder({ dir: out, terms, policy: POLICY }).map(formatProblem).join('\n');
    expect(problems).toContain('H2: a tag v1.0.0-beta.1-pessoal tem termo pessoal do histórico');
    expect(problems).toContain('foi criada por outra identidade');
    expect(problems).not.toContain(OWNER);
    expect(problems).not.toContain(OWNER_EMAIL);
  });

  describe('recusas, sem escrever nada (seção 5.3)', () => {
    it('a pasta dentro do repositório da base', () => {
      const base = makeBase();
      expect(refusal({ root: base, out: path.join(base, 'dist') })).toContain(
        'precisa ficar fora do repositório da base',
      );
      expect(existsSync(path.join(base, 'dist'))).toBe(false);
    });

    it('o repositório da base dentro da pasta', () => {
      const base = makeBase();
      expect(refusal({ root: base, out: path.dirname(base) })).toContain('O repositório da base está dentro da pasta');
    });

    it('uma pasta não vazia que não é distribuição', () => {
      const base = makeBase();
      const out = path.join(TEMP, 'nao-vazia');
      write(out, 'qualquer.txt', 'x');
      expect(refusal({ root: base, out })).toContain('Pasta não vazia que não é uma distribuição');
      expect(listFiles(out)).toEqual(['qualquer.txt']);
    });

    it('uma pasta Git que não é a distribuição', () => {
      const base = makeBase();
      const other = makeBase();
      expect(refusal({ root: base, out: other })).toContain('Não parece o repositório de distribuição');
    });

    it('a distribuição com mudanças', () => {
      const base = makeBase();
      const out = path.join(TEMP, 'dist-mudancas');
      release({ root: base, out });
      write(out, 'solto.txt', 'x');
      expect(refusal({ root: base, out })).toContain('Pasta com mudanças');
      expect(existsSync(path.join(out, 'solto.txt'))).toBe(true);
    });

    it('a versão .0 sem --rehearsal', () => {
      const base = makeBase({ version: '1.0.0-beta.0' });
      const out = path.join(TEMP, 'dist-ponto-zero');
      expect(refusal({ root: base, out })).toContain('termina em .0 e nunca é distribuída');
      expect(existsSync(out)).toBe(false);
    });

    it('a base com mudanças sem --rehearsal', () => {
      const base = makeBase();
      write(base, 'src/sem-commit.ts', 'x');
      expect(refusal({ root: base, out: path.join(TEMP, 'dist-suja') })).toContain('A base tem mudanças sem commit');
    });

    it('o --author ausente ou com termo pessoal', () => {
      const base = makeBase();
      const out = path.join(TEMP, 'dist-autor-pessoal');
      expect(refusal({ root: base, out, author: 'sem formato' })).toContain('Falta --author');
      const message = refusal({ root: base, out, author: `${OWNER} <base@programa.example>` });
      expect(message).toContain('O autor tem um termo pessoal do histórico');
      expect(message).not.toContain(OWNER);
      expect(refusal({ root: base, out, author: `Base <${OWNER_EMAIL}>` })).toContain('O autor tem um');
      expect(existsSync(out)).toBe(false);
    });

    it('a conferência reprovada (o ref do dono e a tabela de termos num arquivo incluído)', () => {
      const base = makeBase({ extra: { 'src/vazou.ts': `export const ref = '${OWNER_REF}'; // 11 98888-7777\n` } });
      const out = path.join(TEMP, 'dist-vazou');
      const message = refusal({ root: base, out });
      expect(message).toContain('A conferência reprovou');
      expect(message).toContain('src/vazou.ts:1 — C2: ref do projeto do dono: zyx…');
      expect(message).toContain('termo do registro do dono: 11 …');
      expect(message).not.toContain(OWNER_REF);
      expect(existsSync(out)).toBe(false);
    });

    it('uma versão menor que a da distribuição', () => {
      const newer = makeBase({ version: '1.0.0-beta.2' });
      const out = path.join(TEMP, 'dist-menor');
      release({ root: newer, out });
      const before = snapshot(out);
      const older = makeBase({ version: '1.0.0-beta.1' });
      expect(refusal({ root: older, out })).toContain(
        'A versão 1.0.0-beta.1 já foi distribuída (a distribuição está em 1.0.0-beta.2)',
      );
      expect(snapshot(out)).toEqual(before);
    });

    it('a mesma versão de novo, ainda sem a tag, com um commit novo na base', () => {
      // O @devops roda o release:dist duas vezes antes da tag: sem a recusa, sairia um segundo "chore: versão" igual.
      const base = makeBase();
      const out = path.join(TEMP, 'dist-mesma-versao');
      release({ root: base, out });
      write(base, 'src/a.ts', 'export const a = 2;\n');
      run(base, ['add', '-A']);
      run(base, ['commit', '-q', '-m', 'fix: depois da versão, sem trocar o número']);
      const before = snapshot(out);
      expect(before.tags).toBe('');
      expect(refusal({ root: base, out })).toContain(
        'A versão 1.0.0-beta.1 já foi distribuída (a distribuição está em 1.0.0-beta.1)',
      );
      expect(snapshot(out)).toEqual(before);
    });

    it('o --dist reprova a pasta com mudanças sem commit', () => {
      const base = makeBase();
      const out = path.join(TEMP, 'dist-suja');
      release({ root: base, out });
      expect(checkDistributionFolder({ dir: out, terms: [], policy: POLICY })).toEqual([]);
      write(out, 'src/a.ts', 'export const a = 9;\n');
      expect(checkDistributionFolder({ dir: out, terms: [], policy: POLICY }).map(formatProblem).join('\n')).toContain(
        'H1: a pasta tem mudanças sem commit',
      );
    });

    it('a tag da versão já existente no clone', () => {
      const base = makeBase();
      const out = path.join(TEMP, 'dist-tag-existente');
      release({ root: base, out });
      run(out, ['tag', '-a', 'v1.0.0-beta.2', '-m', 'v1.0.0-beta.2']);
      write(base, 'package.json', pkgJson('1.0.0-beta.2'));
      write(base, 'CHANGELOG.md', changelog('1.0.0-beta.2'));
      run(base, ['add', '-A']);
      run(base, ['commit', '-q', '-m', 'chore: versão 1.0.0-beta.2']);
      const before = snapshot(out);
      expect(refusal({ root: base, out })).toContain('A versão 1.0.0-beta.2 já foi distribuída');
      expect(snapshot(out)).toEqual(before);
    });

    it('o package.json diferente da última versão com data do CHANGELOG.md', () => {
      const base = makeBase({ version: '1.0.0-beta.2', extra: { 'CHANGELOG.md': changelog('1.0.0-beta.1') } });
      const out = path.join(TEMP, 'dist-changelog');
      expect(refusal({ root: base, out })).toContain(
        'O package.json está em 1.0.0-beta.2, mas a última versão com data do CHANGELOG.md é 1.0.0-beta.1',
      );
      expect(existsSync(out)).toBe(false);
    });

    it('um link simbólico versionado', () => {
      const base = makeBase();
      // O link como o Git o guarda (modo 120000), com core.symlinks desligado: a pasta de trabalho fica limpa em
      // qualquer sistema.
      run(base, ['config', 'core.symlinks', 'false']);
      write(base, 'src/atalho.ts', 'a.ts');
      const blob = spawnSync('git', ['hash-object', '-w', 'src/atalho.ts'], {
        cwd: base,
        env: baseEnv,
        encoding: 'utf8',
      }).stdout.trim();
      run(base, ['update-index', '--add', '--cacheinfo', `120000,${blob},src/atalho.ts`]);
      run(base, ['commit', '-q', '-m', 'feat: atalho']);
      const out = path.join(TEMP, 'dist-link');
      expect(refusal({ root: base, out })).toContain(
        'Link simbólico ou submódulo não vai na distribuição: src/atalho.ts',
      );
      expect(existsSync(out)).toBe(false);
    });

    it('um arquivo maior que o limite', () => {
      const base = makeBase({ extra: { 'src/grande.ts': `// ${'x'.repeat(MAX_FILE_BYTES)}\n` } });
      const out = path.join(TEMP, 'dist-grande');
      expect(refusal({ root: base, out })).toContain('src/grande.ts — C1: arquivo com mais de 2 MB');
      expect(existsSync(out)).toBe(false);
    });

    it('a base sem o registro do ambiente do dono (modo real)', () => {
      const base = makeBase({ registry: false, extra: { 'docs/outro.md': '' } });
      expect(refusal({ root: base, out: path.join(TEMP, 'dist-sem-registro') })).toContain(
        'A distribuição só sai do repositório da base',
      );
    });
  });
});
