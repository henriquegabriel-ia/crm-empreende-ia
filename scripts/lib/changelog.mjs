// Registro de mudanças e versões (item 1.7b; docs/arquitetura/1.7b.md, seções 5 e 6): o Versionamento Semântico 2.0.0
// (parseSemver e compareSemver, sem dependência nova: o `semver` do node_modules é só transitivo) e as regras que mantêm
// o CHANGELOG.md honesto. `changelogProblems` devolve a lista de problemas, em pt-BR; o teste changelog.test.mjs a aplica
// ao arquivo real (lista vazia) e a fixtures, uma por regra. Não lê tags do Git: o CI do GitHub clona sem elas.
import { citesProjectRef, guideReferenceProblems } from './ai-rules.mjs';

export const CHANGELOG_FILE = 'CHANGELOG.md';
export const UPDATE_GUIDE_FILE = 'docs/ATUALIZACAO.md';
export const UNRELEASED_HEADING = '## [Não publicado]';
/** As subseções de cada versão, nesta ordem (Keep a Changelog em pt-BR, com "Migrações" e "Ao atualizar" no começo). */
export const CHANGELOG_SUBSECTIONS = Object.freeze([
  'Migrações',
  'Ao atualizar',
  'Adicionado',
  'Alterado',
  'Obsoleto',
  'Removido',
  'Corrigido',
  'Segurança',
]);

// A expressão oficial do semver.org, com os grupos: principal, secundária, correção, pré-versão e metadados.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** A versão decomposta, ou `null` quando o texto não segue o SemVer 2.0.0 (`1.0`, `01.0.0`, `1.0.0-`, `1.0.0-01`). */
export function parseSemver(value) {
  const match = SEMVER.exec(String(value ?? ''));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ?? '',
  };
}

export const isSemver = (value) => parseSemver(value) !== null;

const numeric = (identifier) => /^\d+$/.test(identifier);

/**
 * A precedência do SemVer 2.0.0 (seção 11): negativo, zero ou positivo. Os metadados (`+…`) não contam; uma pré-versão é
 * menor que a versão normal; identificadores numéricos comparam pelo número e são menores que os alfanuméricos.
 * Lança erro com uma versão inválida.
 */
export function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) throw new Error(`Versão inválida: ${left ? b : a}`);
  for (const key of ['major', 'minor', 'patch']) if (left[key] !== right[key]) return left[key] - right[key];
  if (!left.prerelease.length || !right.prerelease.length) return right.prerelease.length - left.prerelease.length;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const x = left.prerelease[index];
    const y = right.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (numeric(x) && numeric(y)) return Number(x) - Number(y);
    if (numeric(x)) return -1;
    if (numeric(y)) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** A pré-versão terminada em `.0` (`1.0.0-beta.0`): o número de antes da primeira tag, que nunca é publicado. */
export const isDevelopmentVersion = (value) => parseSemver(value)?.prerelease.at(-1) === '0';

const VERSION_HEADING = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/;
const MIGRATION_NAME = /\b\d{14}_[a-z0-9_]+\.sql\b/g;
const CUSTOM_MIGRATION = /^\d{14}_custom_/i;

function validDate(text) {
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** As seções de nível 2 (o título, a versão e o texto) e, dentro delas, as subseções de nível 3. */
export function changelogSections(text) {
  const sections = [];
  let current = null;
  let sub = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('## ')) {
      current = { heading: line.trim(), lines: [], subsections: [] };
      sections.push(current);
      sub = null;
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    if (line.startsWith('### ')) {
      sub = { name: line.slice(4).trim(), lines: [] };
      current.subsections.push(sub);
    } else if (sub) sub.lines.push(line);
  }
  return sections.map((section) => {
    const match = VERSION_HEADING.exec(section.heading);
    return {
      heading: section.heading,
      unreleased: section.heading === UNRELEASED_HEADING,
      version: match?.[1] ?? null,
      date: match?.[2] ?? null,
      text: section.lines.join('\n'),
      subsections: section.subsections.map((entry) => ({ name: entry.name, text: entry.lines.join('\n') })),
    };
  });
}

/** Os objetos protegidos pela guarda numa migração: `private.assert_base_definition('<tipo>', '<objeto>', …)`. */
export function guardedObjects(sql) {
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
  return [
    ...new Set(
      [...code.matchAll(/assert_base_definition\s*\(\s*'(function|trigger|policy)'\s*,\s*'([^']+)'/gi)].map((match) =>
        match[1].toLowerCase() === 'function' ? match[2].split('(')[0] : match[2],
      ),
    ),
  ];
}

const LINK_DEFINITION = /^\[([^\]]+)\]:\s*(\S+)\s*$/;
const REPOSITORY_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/;

/**
 * As definições de link do fim do CHANGELOG.md (Keep a Changelog; item 1.7a, AC-10): `[X.Y.Z]: <repositório>/releases/
 * tag/vX.Y.Z` e `[Não publicado]: <repositório>/compare/vÚLTIMA...HEAD`, com o endereço do repositório de distribuição.
 * Sem nenhuma, nada a conferir (o endereço só existe depois que o @devops cria o repositório). `published` são as
 * versões publicadas, da mais nova para a mais antiga.
 */
export function changelogLinkProblems(text, published) {
  const definitions = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => LINK_DEFINITION.exec(line))
    .filter(Boolean)
    .map((match) => ({ label: match[1], url: match[2] }));
  if (!definitions.length) return [];
  const problems = [];
  const repositories = new Set();
  const labels = new Set();
  for (const { label, url } of definitions) {
    labels.add(label);
    if (label === 'Não publicado') {
      const match = /^(.+)\/compare\/v([^.\s][^\s]*?)\.\.\.HEAD$/.exec(url);
      if (!match) {
        problems.push(`CHANGELOG.md: o link [Não publicado] precisa ser <repositório>/compare/vX.Y.Z...HEAD (${url}).`);
        continue;
      }
      repositories.add(match[1]);
      if (!published.length)
        problems.push('CHANGELOG.md: o link [Não publicado] compara com uma versão, mas nenhuma versão foi publicada.');
      else if (match[2] !== published[0])
        problems.push(
          `CHANGELOG.md: o link [Não publicado] compara com v${match[2]}, mas a última versão publicada é ${published[0]}.`,
        );
      continue;
    }
    const match = /^(.+)\/releases\/tag\/v(.+)$/.exec(url);
    if (!match || match[2] !== label) {
      problems.push(`CHANGELOG.md: o link [${label}] precisa ser <repositório>/releases/tag/v${label} (${url}).`);
      continue;
    }
    repositories.add(match[1]);
    if (!published.includes(label))
      problems.push(`CHANGELOG.md: o link [${label}] aponta uma versão que não está no CHANGELOG.md.`);
  }
  if (repositories.size > 1)
    problems.push(
      `CHANGELOG.md: os links usam ${repositories.size} endereços diferentes; todos apontam o repositório de distribuição.`,
    );
  for (const repository of repositories)
    if (!REPOSITORY_URL.test(repository))
      problems.push(`CHANGELOG.md: ${repository} não é um endereço https://github.com/<organização>/<repositório>.`);
  for (const version of published)
    if (!labels.has(version)) problems.push(`CHANGELOG.md: falta o link [${version}] no fim do arquivo.`);
  if (published.length && !labels.has('Não publicado'))
    problems.push('CHANGELOG.md: falta o link [Não publicado] no fim do arquivo.');
  return problems;
}

const citesObject = (text, name) => text.includes(`\`${name}\``) || text.includes(`\`${name}(`);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Os problemas do CHANGELOG.md, de uma vez (seção 6.4 do desenho). `text` é o arquivo; `packageVersion`, a versão do
 * package.json; `migrations`, os nomes das migrações da base em supabase/migrations (sem as `_custom_`);
 * `migrationSources`, `{ nome: SQL }` delas (para a guarda); `scripts`, os do package.json; `exists(caminho)` responde
 * pelo repositório; `ownerRef`, o ref do projeto do dono quando conhecido.
 */
export function changelogProblems({
  text,
  packageVersion,
  migrations = [],
  migrationSources = {},
  scripts = {},
  exists = () => true,
  ownerRef = null,
}) {
  const problems = [];
  const sections = changelogSections(text);
  // 1. A primeira seção é [Não publicado], uma vez só.
  if (sections[0]?.heading !== UNRELEASED_HEADING)
    problems.push(`CHANGELOG.md: a primeira seção precisa ser ${UNRELEASED_HEADING}.`);
  const unreleasedCount = sections.filter((section) => section.unreleased).length;
  if (unreleasedCount > 1)
    problems.push(`CHANGELOG.md: ${UNRELEASED_HEADING} aparece ${unreleasedCount} vezes; fica uma só, no topo.`);
  // 2. As versões publicadas: SemVer, data válida, ordem decrescente e nunca a .0 de desenvolvimento.
  const published = [];
  for (const section of sections.filter((entry) => !entry.unreleased)) {
    if (!section.version) {
      problems.push(`CHANGELOG.md: o cabeçalho "${section.heading}" não segue o formato ## [X.Y.Z] - AAAA-MM-DD.`);
      continue;
    }
    if (!isSemver(section.version)) {
      problems.push(`CHANGELOG.md: a versão ${section.version} não é SemVer (por exemplo, 1.0.0 ou 1.0.0-rc.1).`);
      continue;
    }
    if (!validDate(section.date))
      problems.push(`CHANGELOG.md: a data ${section.date} da versão ${section.version} não existe (use AAAA-MM-DD).`);
    if (isDevelopmentVersion(section.version))
      problems.push(
        `CHANGELOG.md: a versão ${section.version} termina em .0, o número de antes da primeira versão, que nunca é publicado; a primeira de cada pré-versão é a .1 (${UPDATE_GUIDE_FILE}).`,
      );
    const previous = published.at(-1);
    if (previous) {
      const order = compareSemver(section.version, previous);
      if (order === 0) problems.push(`CHANGELOG.md: a versão ${section.version} aparece duas vezes.`);
      else if (order > 0)
        problems.push(
          `CHANGELOG.md: a versão ${section.version} aparece depois de uma menor (${previous}); as versões ficam da mais nova para a mais antiga.`,
        );
    }
    published.push(section.version);
  }
  // 3. O package.json acompanha a última versão publicada (ou a .0 de desenvolvimento antes da primeira).
  if (!isSemver(packageVersion))
    problems.push(
      `package.json: a versão ${packageVersion} não segue o Versionamento Semântico (por exemplo, 1.0.0-beta.1).`,
    );
  else if (published.length && packageVersion !== published[0])
    problems.push(
      `package.json está em ${packageVersion}, mas a última versão do CHANGELOG.md é ${published[0]}: o commit de lançamento muda os dois juntos (${UPDATE_GUIDE_FILE}).`,
    );
  else if (!published.length && !isDevelopmentVersion(packageVersion))
    problems.push(
      `package.json está em ${packageVersion}, mas o CHANGELOG.md não tem nenhuma versão publicada: antes da primeira, a versão é uma pré-versão terminada em .0 (por exemplo, 1.0.0-beta.0), e o commit de lançamento muda os dois juntos (${UPDATE_GUIDE_FILE}).`,
    );
  // 4. As subseções de cada versão: só as do formato, na ordem.
  for (const section of sections) {
    let last = -1;
    for (const { name } of section.subsections) {
      const position = CHANGELOG_SUBSECTIONS.indexOf(name);
      if (position === -1)
        problems.push(
          `CHANGELOG.md, ${section.heading.slice(3)}: a subseção ### ${name} não é do formato (use ${CHANGELOG_SUBSECTIONS.join(', ')}).`,
        );
      else if (position <= last)
        problems.push(
          `CHANGELOG.md, ${section.heading.slice(3)}: a subseção ### ${name} está fora de ordem ou repetida (a ordem é ${CHANGELOG_SUBSECTIONS.join(', ')}).`,
        );
      else last = position;
    }
  }
  // 5. Toda migração citada existe e é da base.
  for (const name of new Set(text.match(MIGRATION_NAME) ?? [])) {
    if (CUSTOM_MIGRATION.test(name))
      problems.push(
        `CHANGELOG.md cita a migração ${name}, que é de uma instância (_custom_): as notas da base citam só migrações da base.`,
      );
    else if (!migrations.includes(name))
      problems.push(`CHANGELOG.md cita a migração ${name}, que não existe em supabase/migrations.`);
  }
  // 6. Toda migração da base aparece exatamente uma vez numa subseção "Migrações".
  const migrationTexts = sections.map((section) =>
    section.subsections
      .filter((sub) => sub.name === 'Migrações')
      .map((sub) => sub.text)
      .join('\n'),
  );
  for (const name of migrations.filter((file) => !CUSTOM_MIGRATION.test(file))) {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
    const count = migrationTexts.reduce((total, part) => total + (part.match(pattern)?.length ?? 0), 0);
    if (count === 0)
      problems.push(
        `A migração ${name} não está em nenhuma seção Migrações do CHANGELOG.md: acrescente-a em [Não publicado].`,
      );
    else if (count > 1)
      problems.push(
        `A migração ${name} aparece ${count} vezes nas seções Migrações do CHANGELOG.md: cada migração entra uma vez só, na versão que a traz.`,
      );
  }
  // 7. Cada objeto que uma migração protege com a guarda é citado na versão dela.
  for (const [name, sql] of Object.entries(migrationSources)) {
    const index = migrationTexts.findIndex((part) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(part));
    if (index === -1) continue;
    for (const object of guardedObjects(sql))
      if (!citesObject(sections[index].text, object))
        problems.push(
          `${name} protege ${object} com a guarda, mas a versão dela no CHANGELOG.md não o cita (as notas listam as funções recriadas, docs/PROTECAO-ATUALIZACAO.md).`,
        );
  }
  // 8. Os links de comparação do fim do arquivo (item 1.7a), quando houver: um endereço só, cada versão publicada com
  // a tag dela e o [Não publicado] comparando a última versão com o HEAD.
  problems.push(...changelogLinkProblems(text, published));
  // 9. Comandos e caminhos que existem, sem documentos do dono nem o projeto dele.
  problems.push(...guideReferenceProblems(CHANGELOG_FILE, text, { scripts, exists }));
  if (/docs\/dono\//.test(text))
    problems.push('CHANGELOG.md aponta para docs/dono/, que fica fora da distribuição aos alunos.');
  if (citesProjectRef(text, ownerRef))
    problems.push('CHANGELOG.md cita um projeto Supabase real: as notas usam <SEU_PROJECT_REF>.');
  return problems;
}
