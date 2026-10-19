// Item 1.13 (docs/arquitetura/1.13.md, seção 16.1): o manifesto da base, o check de drift e as regras sobre os arquivos
// de supabase/migrations. O banco (private.base_fingerprints() e o check rodando) é conferido no test:db.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRIFT_CHECK_FILE,
  GUIDE_FILE,
  HOOK_SIGNATURES,
  MANIFEST_FILE,
  ManifestError,
  UPDATE_PROTECTION_MIGRATION,
  buildManifest,
  driftCheckCode,
  firstDifference,
  baseRepositoryProblems,
  customMigrationsIn,
  customizationGuideExamples,
  isCustomMigration,
  migrationContractProblems,
  migrationsFromFiles,
  readBaseMigrationNames,
  renderDriftCheck,
  renderManifest,
  reservedPrefixProblems,
  syncGeneratedFiles,
} from './base-manifest.mjs';
import { MIGRATIONS_DIR, ROOT } from './embedded-db.mjs';

const fn = (object, extra = {}) => ({
  kind: 'function',
  object,
  parent: null,
  props: { security: 'definer', acl: 'authenticated=X', args: '' },
  body_hash: 'aaaaaaaaaaaaaaaa',
  hash: 'bbbbbbbbbbbbbbbb',
  ...extra,
});
const ROWS = [
  fn('public.save_deal(uuid)'),
  {
    kind: 'table',
    object: 'public.deals',
    parent: null,
    props: { rls: true, acl: '' },
    body_hash: null,
    hash: 'c'.repeat(16),
  },
  ...HOOK_SIGNATURES.map((signature) => fn(signature, { props: { acl: '', security: 'invoker' } })),
  {
    kind: 'migration_history',
    object: 'supabase_migrations.schema_migrations',
    parent: null,
    props: { present: false },
  },
  fn('private.current_org()'),
];
const FILES = ['20260906051319_commercial_foundation.sql', '20261019110000_update_protection.sql', 'README.md'];
const manifestOf = (rows = ROWS) => buildManifest({ rows, migrationFiles: FILES, postgresMajor: 17 });

describe('buildManifest', () => {
  it('classifica os ganchos, ordena por tipo e nome e lê as migrações dos arquivos', () => {
    const manifest = manifestOf();
    expect(manifest.hooks).toEqual([...HOOK_SIGNATURES]);
    expect(manifest.objects.map((object) => `${object.kind} ${object.object}`)).toEqual([
      'function private.current_org()',
      'function public.save_deal(uuid)',
      ...HOOK_SIGNATURES.map((signature) => `hook ${signature}`),
      'table public.deals',
    ]);
    expect(manifest.migrations).toEqual([
      { version: '20260906051319', name: 'commercial_foundation' },
      { version: '20261019110000', name: 'update_protection' },
    ]);
    expect(manifest.lastMigration).toBe(UPDATE_PROTECTION_MIGRATION);
    expect(manifest.postgres).toBe(17);
    // As propriedades saem com as chaves ordenadas, qualquer que seja a ordem do banco.
    expect(Object.keys(manifest.objects[0].props)).toEqual(['acl', 'args', 'security']);
  });

  it('dá o mesmo manifesto com as linhas em outra ordem', () => {
    expect(renderManifest(manifestOf([...ROWS].reverse()))).toBe(renderManifest(manifestOf()));
  });

  it('recusa um banco com o histórico de migrações (sinal de projeto do Supabase, e não do cluster descartável)', () => {
    expect(() =>
      manifestOf([...ROWS, { kind: 'migration', object: '20260906051319', parent: null, props: {}, hash: 'x' }]),
    ).toThrow(ManifestError);
    expect(() =>
      manifestOf([
        ...ROWS.filter((row) => row.kind !== 'migration_history'),
        { kind: 'migration_history', object: 'supabase_migrations.schema_migrations', props: { present: true } },
      ]),
    ).toThrow(/nunca num projeto do Supabase/);
  });

  it('recusa objeto repetido, tipo desconhecido e migração com nome fora do padrão', () => {
    expect(() => manifestOf([...ROWS, fn('public.save_deal(uuid)')])).toThrow(/Objeto repetido/);
    expect(() => manifestOf([...ROWS, { kind: 'sequence', object: 'public.x', props: {} }])).toThrow(/desconhecido/);
    expect(() => migrationsFromFiles(['2026_sem_data.sql'])).toThrow(/fora do padrão/);
  });

  it('deixa de fora as migrações _custom_ de quem personaliza: o manifesto é o mesmo com elas na pasta', () => {
    expect(isCustomMigration('20261101090000_custom_regra_oportunidade_grande.sql')).toBe(true);
    expect(isCustomMigration('20261101090000_CUSTOM_regra.sql')).toBe(true);
    expect(isCustomMigration('20261019110000_update_protection.sql')).toBe(false);
    expect(isCustomMigration('20261101090000_customer_view.sql')).toBe(false);
    const withCustom = buildManifest({
      rows: ROWS,
      migrationFiles: [...FILES, '20261101090000_custom_regra_oportunidade_grande.sql'],
      postgresMajor: 17,
    });
    expect(renderManifest(withCustom)).toBe(renderManifest(manifestOf()));
    expect(withCustom.lastMigration).toBe(UPDATE_PROTECTION_MIGRATION);
  });

  // Achado 3 da revisão do 1.13: uma migração da base com um nome que começa por custom_ (por exemplo, a dos campos
  // personalizados) não pode sumir do manifesto, do test:db e da guarda.
  it('uma migração listada no manifesto nunca é tratada como _custom_, seja qual for o nome', () => {
    const baseCustom = '20261201090000_custom_fields.sql';
    expect(isCustomMigration(baseCustom)).toBe(true);
    expect(isCustomMigration(baseCustom, [baseCustom])).toBe(false);
    expect(customMigrationsIn([baseCustom, '20261202090000_custom_regra.sql', 'README.md'], [baseCustom])).toEqual([
      '20261202090000_custom_regra.sql',
    ]);
    const withBaseCustom = buildManifest({
      rows: ROWS,
      migrationFiles: [...FILES, baseCustom],
      postgresMajor: 17,
      baseMigrations: [baseCustom],
    });
    expect(withBaseCustom.migrations.map((migration) => migration.name)).toContain('custom_fields');
    const created = 'create function private.custom_score(p uuid) returns int language sql as $$ select 1 $$;';
    // Sem a lista do manifesto, o arquivo fica de fora das regras (os únicos problemas são os ganchos sem a migração do
    // item 1.13 nesta lista curta); com ela, a regra do prefixo vale.
    expect(migrationContractProblems([{ name: baseCustom, text: created }]).join('\n')).not.toContain('custom_score');
    expect(migrationContractProblems([{ name: baseCustom, text: created }], [baseCustom])).toContain(
      `${baseCustom}: private.custom_score usa o prefixo custom_, reservado a quem personaliza (só os oito ganchos são da base)`,
    );
  });

  it('lê as migrações do manifesto versionado, todas presentes na pasta', () => {
    const names = readBaseMigrationNames();
    const manifest = JSON.parse(readFileSync(path.join(ROOT, MANIFEST_FILE), 'utf8'));
    const files = readdirSync(path.join(ROOT, MIGRATIONS_DIR));
    expect(names).toHaveLength(manifest.migrations.length);
    expect(names.every((name) => files.includes(name))).toBe(true);
    expect(readBaseMigrationNames(path.join(ROOT, 'nao-existe.json'))).toEqual([]);
  });

  it('no repositório da base (CRM_BASE_REPOSITORY=true), qualquer migração _custom_ é recusada, com o nome', () => {
    const files = ['20261019110000_update_protection.sql', '20261201090000_custom_fields.sql', 'README.md'];
    expect(baseRepositoryProblems(files, {})).toEqual([]);
    expect(baseRepositoryProblems(files, { CRM_BASE_REPOSITORY: 'false' })).toEqual([]);
    expect(baseRepositoryProblems(['20261019110000_update_protection.sql'], { CRM_BASE_REPOSITORY: 'true' })).toEqual(
      [],
    );
    expect(baseRepositoryProblems(files, { CRM_BASE_REPOSITORY: 'true' })).toEqual([
      'A base nunca usa o prefixo custom_ (reservado a quem personaliza). Renomeie a migração: 20261201090000_custom_fields.sql.',
    ]);
  });
});

describe('renderManifest', () => {
  it('escreve um objeto por linha, com LF, sem data, e o JSON volta igual', () => {
    const manifest = manifestOf();
    const text = renderManifest(manifest);
    expect(text).not.toMatch(/\r/);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toBe(renderManifest(manifest));
    const objectLines = text.split('\n').filter((line) => line.startsWith('    {"kind"'));
    expect(objectLines).toHaveLength(manifest.objects.length);
    expect(JSON.parse(text)).toEqual(manifest);
  });
});

describe('renderDriftCheck', () => {
  const sql = renderDriftCheck(manifestOf());

  it('é uma consulta só, que termina em ponto e vírgula e só lê', () => {
    const code = driftCheckCode(sql);
    expect(code.trimEnd().endsWith(';')).toBe(true);
    expect(code.split(';')).toHaveLength(2);
    expect(code).toMatch(/^\s*with manifest_doc as \(/);
    for (const word of ['insert', 'update', 'delete', 'create', 'alter', 'drop', 'grant', 'revoke', 'truncate'])
      expect(code).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
    // Nem os comentários e textos têm ponto e vírgula: a consulta roda inteira em qualquer editor.
    const withoutManifest = sql.replace(/\$manifest\$[\s\S]*\$manifest\$/, '');
    expect(withoutManifest.split(';')).toHaveLength(2);
  });

  it('traz o manifesto embutido e o guia', () => {
    expect(sql).toContain(`$manifest$\n${renderManifest(manifestOf()).trimEnd()}\n$manifest$::jsonb`);
    expect(sql).toContain('docs/PROTECAO-ATUALIZACAO.md');
    expect(sql).toContain('from private.base_fingerprints() f');
  });

  it('recusa um manifesto que contenha o marcador do literal', () => {
    expect(() => renderDriftCheck(manifestOf([...ROWS, fn('public.x$manifest$()')]))).toThrow(ManifestError);
  });
});

describe('firstDifference', () => {
  it('aponta a primeira linha diferente e o fim do arquivo', () => {
    expect(firstDifference('a\nb', 'a\nc')).toEqual([
      '  Primeira diferença na linha 2:',
      '    gerado:     b',
      '    versionado: c',
    ]);
    expect(firstDifference('a\nb', 'a')[2]).toBe('    versionado: (fim do arquivo)');
    expect(firstDifference('a', 'a')).toEqual([]);
  });
});

describe('syncGeneratedFiles', () => {
  const files = [
    { path: 'supabase/base-manifest.json', content: '{}\n' },
    { path: 'supabase/db-drift-check.sql', content: 'select 1;\n' },
  ];
  const disk = (entries) => {
    const store = new Map(Object.entries(entries));
    return {
      store,
      read: async (file) => store.get(file) ?? null,
      write: async (file, content) => void store.set(file, content),
    };
  };

  it('no check, passa com os arquivos em dia (inclusive com CRLF)', async () => {
    const { read, write } = disk({
      'supabase/base-manifest.json': '{}\r\n',
      'supabase/db-drift-check.sql': 'select 1;\n',
    });
    await expect(syncGeneratedFiles({ files, checkOnly: true, read, write })).resolves.toContain('em dia');
  });

  it('no check, reprova o arquivo defasado com a diferença e o que fazer', async () => {
    const { read, write } = disk({
      'supabase/base-manifest.json': '{}\n',
      'supabase/db-drift-check.sql': 'select 2;\n',
    });
    const failure = syncGeneratedFiles({ files, checkOnly: true, read, write });
    await expect(failure).rejects.toThrow(/supabase\/db-drift-check.sql está diferente/);
    await expect(syncGeneratedFiles({ files, checkOnly: true, read, write })).rejects.toThrow(
      /Rode npm run manifest:build e faça commit dos arquivos gerados[\s\S]*_custom_<nome>\.sql[\s\S]*git checkout HEAD --/,
    );
  });

  it('no check, reprova o arquivo ausente', async () => {
    const { read, write } = disk({ 'supabase/db-drift-check.sql': 'select 1;\n' });
    await expect(syncGeneratedFiles({ files, checkOnly: true, read, write })).rejects.toThrow(
      'supabase/base-manifest.json não existe. Rode npm run manifest:build',
    );
  });

  it('no build, grava só o que mudou', async () => {
    const { store, read, write } = disk({ 'supabase/base-manifest.json': '{}\n' });
    await expect(syncGeneratedFiles({ files, checkOnly: false, read, write })).resolves.toBe(
      'supabase/db-drift-check.sql gravado.',
    );
    expect(store.get('supabase/db-drift-check.sql')).toBe('select 1;\n');
    await expect(syncGeneratedFiles({ files, checkOnly: false, read, write })).resolves.toContain('nada mudou');
  });
});

describe('arquivos versionados', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, MANIFEST_FILE), 'utf8'));

  it('o manifesto lista todas as migrações da base no repositório e termina na mais nova', () => {
    const files = readdirSync(path.join(ROOT, MIGRATIONS_DIR));
    expect(manifest.migrations).toEqual(migrationsFromFiles(files));
    expect(manifest.lastMigration).toBe(
      files
        .filter((file) => file.endsWith('.sql') && !isCustomMigration(file))
        .sort()
        .at(-1),
    );
  });

  it('o check versionado é o gerado a partir do manifesto versionado', () => {
    expect(readFileSync(path.join(ROOT, DRIFT_CHECK_FILE), 'utf8').replace(/\r\n/g, '\n')).toBe(
      renderDriftCheck(manifest),
    );
  });

  it('só os oito ganchos usam o prefixo custom_ na base', () => {
    expect(reservedPrefixProblems(manifest)).toEqual([]);
    expect(manifest.hooks).toEqual([...HOOK_SIGNATURES]);
  });
});

describe('reservedPrefixProblems', () => {
  it('reprova objeto da base com o prefixo custom_ e gancho fora da lista', () => {
    const manifest = manifestOf([
      ...ROWS,
      { kind: 'table', object: 'public.custom_tags', parent: null, props: {}, hash: 'd'.repeat(16) },
      { kind: 'column', object: 'public.deals.custom_score', parent: 'public.deals', props: {}, hash: 'e'.repeat(16) },
      fn('private.custom_validate_payment(public.payments,public.payments)'),
    ]);
    expect(reservedPrefixProblems(manifest)).toEqual([
      'função com o prefixo custom_ fora dos oito ganchos da base: private.custom_validate_payment(public.payments,public.payments)',
      'column da base com o prefixo custom_, reservado a quem personaliza: public.deals.custom_score',
      'table da base com o prefixo custom_, reservado a quem personaliza: public.custom_tags',
    ]);
  });

  it('reprova gancho ausente', () => {
    expect(
      reservedPrefixProblems(manifestOf(ROWS.filter((row) => !row.object.includes('custom_validate_deal')))),
    ).toEqual(['gancho ausente no manifesto: private.custom_validate_deal(public.deals,public.deals)']);
  });
});

describe('migrationContractProblems', () => {
  const real = readdirSync(path.join(ROOT, MIGRATIONS_DIR))
    .filter((file) => file.endsWith('.sql'))
    .map((name) => ({ name, text: readFileSync(path.join(ROOT, MIGRATIONS_DIR, name), 'utf8') }));
  const later = (text) => ({ name: '20261101100000_future.sql', text });

  it('as migrações do repositório cumprem o contrato dos ganchos e da guarda', () => {
    expect(migrationContractProblems(real)).toEqual([]);
  });

  it('reprova gancho recriado, trocado, removido ou criado duas vezes', () => {
    expect(
      migrationContractProblems([
        ...real,
        later(`create or replace function private.custom_validate_deal(p_new public.deals, p_old public.deals) returns void
          language plpgsql as $$ begin null; end $$;
          drop function private.custom_after_deal_saved(public.deals,public.deals);
          alter function private.custom_validate_contact(public.contacts,public.contacts) owner to postgres;
          create function private.custom_validate_company(p_new public.companies, p_old public.companies) returns void
          language plpgsql as $$ begin null; end $$;`),
      ]),
    ).toEqual([
      '20261101100000_future.sql: "create or replace function" no gancho private.custom_validate_deal. A base nunca recria, troca nem remove um gancho; gancho novo é função nova.',
      '20261101100000_future.sql: "drop function" no gancho private.custom_after_deal_saved. A base nunca recria, troca nem remove um gancho; gancho novo é função nova.',
      '20261101100000_future.sql: "alter function" no gancho private.custom_validate_contact. A base nunca recria, troca nem remove um gancho; gancho novo é função nova.',
      `o gancho private.custom_validate_company precisa ser criado por um único create function (encontrado em ${UPDATE_PROTECTION_MIGRATION}, 20261101100000_future.sql)`,
    ]);
  });

  it('reprova função da base nova com o prefixo custom_', () => {
    expect(
      migrationContractProblems([
        ...real,
        later('create function private.custom_score(p uuid) returns int language sql as $$ select 1 $$;'),
      ]),
    ).toEqual([
      '20261101100000_future.sql: private.custom_score usa o prefixo custom_, reservado a quem personaliza (só os oito ganchos são da base)',
    ]);
  });

  it('reprova migração posterior que recria função ou gatilho da base sem a guarda, e aceita com a guarda', () => {
    const unguarded = later(`
      create or replace function private.create_invitation(p_email text, p_role text) returns uuid language plpgsql as $$ begin return null; end $$;
      drop trigger if exists validate_deal_change on public.deals;
      create trigger validate_deal_change before insert or update on public.deals for each row execute function private.validate_deal_change();`);
    const problems = migrationContractProblems([...real, unguarded]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain(
      "recria ou remove private.create_invitation, criada por 20261012100000_single_company_admission.sql, sem chamar antes private.assert_base_definition('function'",
    );
    expect(problems[1]).toContain('recria ou remove o gatilho public.deals.validate_deal_change');
    const guarded = later(`
      select private.assert_base_definition('function', 'private.create_invitation(text,text)', array['0123456789abcdef']);
      select private.assert_base_definition('trigger', 'public.deals.validate_deal_change', array['0123456789abcdef']);
      ${unguarded.text}`);
    expect(migrationContractProblems([...real, guarded])).toEqual([]);
  });

  it('reprova migração posterior que remove ou altera uma política da base sem a guarda, inclusive as criadas em laço', () => {
    const unguarded = later(`
      drop policy tenant_read on public.contacts;
      create policy tenant_read on public.contacts for select to authenticated using (org_id = (select private.current_org()));
      alter policy tenant_update on public.products to authenticated;
      drop policy if exists "tenant_delete" on public.products;`);
    expect(migrationContractProblems([...real, unguarded])).toEqual([
      `20261101100000_future.sql: "drop policy" em public.contacts.tenant_read, uma política da base, sem chamar antes private.assert_base_definition('policy', 'public.contacts.tenant_read', array['<hash do manifesto>'])`,
      `20261101100000_future.sql: "alter policy" em public.products.tenant_update, uma política da base, sem chamar antes private.assert_base_definition('policy', 'public.products.tenant_update', array['<hash do manifesto>'])`,
      `20261101100000_future.sql: "drop policy" em public.products.tenant_delete, uma política da base, sem chamar antes private.assert_base_definition('policy', 'public.products.tenant_delete', array['<hash do manifesto>'])`,
    ]);
    const guarded = later(`
      select private.assert_base_definition('policy', 'public.contacts.tenant_read', array['0123456789abcdef']);
      select private.assert_base_definition('policy', 'public.products.tenant_update', array['0123456789abcdef']);
      select private.assert_base_definition('policy', 'public.products.tenant_delete', array['0123456789abcdef']);
      ${unguarded.text}`);
    expect(migrationContractProblems([...real, guarded])).toEqual([]);
    // A política criada pela própria migração pode ser alterada e removida nela sem a guarda.
    expect(
      migrationContractProblems([
        ...real,
        later(`create policy brand_new_read on public.products for select to authenticated using (true);
          alter policy brand_new_read on public.products using (false);
          drop policy brand_new_read on public.products;`),
      ]),
    ).toEqual([]);
  });

  it('ignora as migrações _custom_ de quem personaliza, como as dos exemplos do guia', () => {
    // Os blocos SQL do guia (ganchos recriados e a tabela custom_), mais uma função custom_ do aluno e, para conferir
    // que o arquivo inteiro fica fora das regras da base, uma política e uma função da base mexidas sem a guarda.
    const examples = customizationGuideExamples(readFileSync(path.join(ROOT, GUIDE_FILE), 'utf8'));
    expect(examples.length).toBeGreaterThanOrEqual(3);
    const custom = {
      name: '20261101090000_custom_regra_oportunidade_grande.sql',
      text: `${examples.join('\n')}
        create function private.custom_calcular_comissao(p_deal uuid) returns numeric language sql as $$ select 0 $$;
        drop policy tenant_read on public.contacts;
        create or replace function private.validate_deal_change() returns trigger language plpgsql as $$ begin return new; end $$;`,
    };
    expect(migrationContractProblems([...real, custom])).toEqual([]);
    // O mesmo texto sem o nome _custom_ seria reprovado: a regra é pelo nome do arquivo.
    expect(
      migrationContractProblems([...real, { ...custom, name: '20261101090000_regra.sql' }]).length,
    ).toBeGreaterThan(0);
  });

  it('não exige a guarda para função nova nem para migrações anteriores à do item 1.13', () => {
    expect(
      migrationContractProblems([
        ...real,
        later(`create function private.brand_new(p uuid) returns int language sql as $$ select 1 $$;
          create or replace function private.brand_new(p uuid) returns int language sql as $$ select 2 $$;`),
      ]),
    ).toEqual([]);
  });
});
