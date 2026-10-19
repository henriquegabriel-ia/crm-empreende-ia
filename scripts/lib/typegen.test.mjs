// Casos que o schema atual ainda não usa (enum, domínio, identity, coluna gerada, view, composto, sobrecarga,
// parâmetro sem nome), para o gerador de `npm run gen:types` não quebrar quando a base ou o aluno os criarem.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEADER, TYPE_TARGETS, generateDatabaseTypes, staleTypesProblem, tsTypeOf } from './typegen.mjs';

function buildTypes() {
  const types = new Map();
  const ids = {};
  let nextId = 1;
  const add = (key, name, extra = {}) => {
    ids[key] = nextId;
    types.set(nextId, {
      name,
      schema: 'pg_catalog',
      typtype: 'b',
      category: 'U',
      elemId: null,
      baseTypeId: null,
      relkind: null,
      enumValues: [],
      ...extra,
    });
    nextId += 1;
  };
  for (const name of ['text', 'uuid', 'int4', 'int8', 'numeric', 'bool', 'jsonb', 'timestamptz', 'date', 'interval'])
    add(name, name);
  add('void', 'void', { typtype: 'p' });
  add('record', 'record', { typtype: 'p' });
  add('textArray', '_text', { category: 'A', elemId: ids.text });
  add('status', 'deal_status', { schema: 'public', typtype: 'e', category: 'E', enumValues: ['open', 'won', 'lost'] });
  add('foreignEnum', 'mood', { schema: 'extra', typtype: 'e', category: 'E', enumValues: ['ok', 'bad'] });
  add('statusArray', '_deal_status', { schema: 'public', category: 'A' });
  types.get(ids.statusArray).elemId = ids.status;
  add('email', 'email', { schema: 'public', typtype: 'd', baseTypeId: ids.text });
  add('pair', 'money_pair', { schema: 'public', typtype: 'c', category: 'C', relkind: 'c' });
  add('itemsRow', 'items', { schema: 'public', typtype: 'c', category: 'C', relkind: 'r' });
  add('citext', 'citext', { schema: 'extensions' });
  return { types, ids };
}

const column = (name, typeId, extra = {}) => ({
  name,
  typeId,
  isNullable: false,
  hasDefault: false,
  identity: null,
  isGenerated: false,
  isUpdatable: true,
  ...extra,
});

function buildMeta() {
  const { types, ids } = buildTypes();
  const meta = {
    schema: 'public',
    types,
    relations: [
      {
        name: 'items',
        kind: 'table',
        isUpdatable: false,
        columns: [
          column('id', ids.int8, { identity: 'ALWAYS', hasDefault: false }),
          column('seq', ids.int4, { identity: 'BY DEFAULT' }),
          column('title', ids.text),
          column('slug', ids.text, { isGenerated: true, hasDefault: true }),
          column('email', ids.email, { isNullable: true }),
          column('status', ids.status, { hasDefault: true }),
          column('tags', ids.textArray, { isNullable: true }),
          column('history', ids.statusArray, { hasDefault: true }),
          column('code', ids.citext, { isNullable: true }),
          column('duration', ids.interval, { isNullable: true }),
          column('parent_id', ids.int8, { isNullable: true }),
        ],
      },
      {
        name: 'item_summary',
        kind: 'view',
        isUpdatable: true,
        columns: [column('id', ids.int8, { isNullable: true }), column('total', ids.numeric, { isUpdatable: false })],
      },
      { name: 'item_totals', kind: 'materialized_view', isUpdatable: false, columns: [column('total', ids.numeric)] },
    ],
    relationships: [
      {
        foreignKeyName: 'items_parent_id_fkey',
        relation: 'items',
        columns: ['parent_id'],
        isOneToOne: false,
        referencedRelation: 'items',
        referencedColumns: ['id'],
      },
    ],
    functions: [
      { name: 'ping', args: [], returnTypeId: ids.void, returnsSet: false },
      {
        name: 'find_items',
        args: [{ name: 'p_status', typeId: ids.status, mode: 'in', hasDefault: false }],
        returnTypeId: ids.itemsRow,
        returnsSet: true,
      },
      {
        name: 'tags_of',
        args: [{ name: '', typeId: ids.int8, mode: 'in', hasDefault: false }],
        returnTypeId: ids.text,
        returnsSet: true,
      },
      {
        name: 'ingest',
        args: [{ name: '', typeId: ids.jsonb, mode: 'in', hasDefault: false }],
        returnTypeId: ids.uuid,
        returnsSet: false,
      },
      {
        name: 'item_label',
        args: [{ name: '', typeId: ids.itemsRow, mode: 'in', hasDefault: false }],
        returnTypeId: ids.text,
        returnsSet: false,
      },
      {
        name: 'annotate',
        args: [
          { name: 'p_id', typeId: ids.uuid, mode: 'in', hasDefault: false },
          { name: '', typeId: ids.jsonb, mode: 'in', hasDefault: true },
        ],
        returnTypeId: ids.text,
        returnsSet: false,
      },
      {
        name: 'tag_count',
        args: [
          { name: 'p_id', typeId: ids.uuid, mode: 'in', hasDefault: false },
          { name: '', typeId: ids.text, mode: 'in', hasDefault: false },
        ],
        returnTypeId: ids.int4,
        returnsSet: false,
      },
      {
        name: 'add',
        args: [
          { name: '', typeId: ids.int4, mode: 'in', hasDefault: false },
          { name: '', typeId: ids.int4, mode: 'in', hasDefault: false },
        ],
        returnTypeId: ids.int4,
        returnsSet: false,
      },
      {
        name: 'stats',
        args: [
          { name: 'p_from', typeId: ids.date, mode: 'in', hasDefault: true },
          { name: 'total', typeId: ids.numeric, mode: 'out', hasDefault: false },
          { name: 'count', typeId: ids.int8, mode: 'out', hasDefault: false },
        ],
        returnTypeId: ids.record,
        returnsSet: false,
      },
      {
        name: 'label',
        args: [{ name: 'p_id', typeId: ids.uuid, mode: 'in', hasDefault: false }],
        returnTypeId: ids.text,
        returnsSet: false,
      },
      {
        name: 'label',
        args: [{ name: 'p_code', typeId: ids.text, mode: 'in', hasDefault: false }],
        returnTypeId: ids.text,
        returnsSet: false,
      },
    ],
    enums: [{ name: 'deal_status', values: ['open', 'won', 'lost'] }],
    compositeTypes: [
      {
        name: 'money_pair',
        attributes: [
          { name: 'amount', typeId: ids.numeric },
          { name: 'currency', typeId: ids.text },
        ],
      },
    ],
  };
  return { meta, ids };
}

const flat = (text) => text.replace(/\s+/g, ' ');
const section = (text, start, end) => flat(text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start))));

describe('typegen', () => {
  it('maps PostgreSQL types like supabase gen types', () => {
    const { meta, ids } = buildMeta();
    expect(tsTypeOf(meta, ids.uuid)).toBe('string');
    expect(tsTypeOf(meta, ids.timestamptz)).toBe('string');
    expect(tsTypeOf(meta, ids.date)).toBe('string');
    expect(tsTypeOf(meta, ids.numeric)).toBe('number');
    expect(tsTypeOf(meta, ids.int8)).toBe('number');
    expect(tsTypeOf(meta, ids.bool)).toBe('boolean');
    expect(tsTypeOf(meta, ids.jsonb)).toBe('Json');
    expect(tsTypeOf(meta, ids.void)).toBe('undefined');
    expect(tsTypeOf(meta, ids.textArray)).toBe('(string)[]');
    expect(tsTypeOf(meta, ids.email)).toBe('string');
    expect(tsTypeOf(meta, ids.status)).toBe('Database["public"]["Enums"]["deal_status"]');
    expect(tsTypeOf(meta, ids.foreignEnum)).toBe('"ok" | "bad"');
    expect(tsTypeOf(meta, ids.pair)).toBe('Database["public"]["CompositeTypes"]["money_pair"]');
    expect(tsTypeOf(meta, ids.itemsRow)).toBe('Database["public"]["Tables"]["items"]["Row"]');
    expect(tsTypeOf(meta, ids.interval)).toBe('unknown');
    expect(tsTypeOf(meta, 9999)).toBe('unknown');
  });

  it('writes Row, Insert and Update with the official optionality rules', async () => {
    const output = await generateDatabaseTypes(buildMeta().meta);
    expect(output.startsWith(`${HEADER}\n`)).toBe(true);
    const row = section(output, 'Row: {', '}');
    expect(row).toContain('email: string | null');
    expect(row).toContain('tags: string[] | null');
    expect(row).toContain('history: Database["public"]["Enums"]["deal_status"][]');
    expect(row).toContain('code: string | null');
    expect(row).toContain('duration: unknown | null');
    const insert = section(output, 'Insert: {', '}');
    // Identity ALWAYS (id) e coluna gerada (slug) bloqueadas; identity BY DEFAULT (seq) opcional e gravável.
    expect(insert).toContain('id?: never');
    expect(insert).toContain('slug?: never');
    expect(insert).toContain('seq?: number');
    expect(insert).toContain('title: string');
    expect(insert).toContain('status?: Database["public"]["Enums"]["deal_status"]');
    expect(insert).toContain('email?: string | null');
    const update = section(output, 'Update: {', '}');
    expect(update).toContain('id?: never');
    expect(update).toContain('slug?: never');
    expect(update).toContain('seq?: number');
    expect(update).toContain('title?: string');
    expect(update).not.toMatch(/\btitle: string/);
  });

  it('sorts columns and writes foreign keys as Relationships', async () => {
    const output = flat(await generateDatabaseTypes(buildMeta().meta));
    expect(output).toContain(
      'Relationships: [ { foreignKeyName: "items_parent_id_fkey" columns: ["parent_id"] isOneToOne: false referencedRelation: "items" referencedColumns: ["id"] }, ]',
    );
    const row = section(output, 'Row: {', '}');
    const names = [...row.matchAll(/(\w+)\??: /g)].map((match) => match[1]);
    expect(names).toEqual([...names].sort());
  });

  it('writes views, enums, composite types and constants', async () => {
    const output = flat(await generateDatabaseTypes(buildMeta().meta));
    expect(output).toContain(
      'item_summary: { Row: { id: number | null total: number } Insert: { id?: number | null total?: never } Update: { id?: number | null total?: never } Relationships: [] }',
    );
    expect(output).toContain('item_totals: { Row: { total: number } Relationships: [] }');
    expect(output).toContain('Enums: { deal_status: "open" | "won" | "lost" }');
    expect(output).toContain('CompositeTypes: { money_pair: { amount: number | null currency: string | null } }');
    expect(output).toContain(
      'export const Constants = { public: { Enums: { deal_status: ["open", "won", "lost"], }, }, } as const',
    );
    for (const helper of ['Tables', 'TablesInsert', 'TablesUpdate', 'Enums', 'CompositeTypes'])
      expect(output).toContain(`export type ${helper}<`);
  });

  it('writes functions with Args and Returns, overloads and set-returning results', async () => {
    const output = flat(await generateDatabaseTypes(buildMeta().meta));
    const functions = section(output, 'Functions: {', 'Enums: {');
    expect(functions).toContain('ping: { Args: never Returns: undefined }');
    expect(functions).toContain(
      'find_items: { Args: { p_status: Database["public"]["Enums"]["deal_status"] } Returns: {',
    );
    expect(functions).toMatch(/find_items: .*?Returns: \{ code: string \| null .*? title: string \}\[\] \}/);
    expect(functions).toContain('stats: { Args: { p_from?: string } Returns: { count: number total: number } }');
    expect(functions).toContain(
      'label: | { Args: { p_code: string } Returns: string } | { Args: { p_id: string } Returns: string }',
    );
    const order = [...functions.matchAll(/ (\w+): (?:\||\{ Args)/g)].map((match) => match[1]);
    expect(order).toEqual(['annotate', 'find_items', 'ingest', 'label', 'ping', 'stats']);
  });

  it('keeps only the functions with unnamed parameters that PostgREST can call', async () => {
    const output = flat(await generateDatabaseTypes(buildMeta().meta));
    const functions = section(output, 'Functions: {', 'Enums: {');
    // Um único parâmetro sem nome de tipo json, jsonb ou text, ou sem nome desses tipos e com valor padrão.
    expect(functions).toContain('ingest: { Args: { "": Json } Returns: string }');
    expect(functions).toContain('annotate: { Args: { ""?: Json; p_id: string } Returns: string }');
    // De outro tipo, sem valor padrão, ou do tipo linha de uma tabela (campo calculado): o PostgREST não chama.
    expect(functions).not.toContain('tags_of:');
    expect(functions).not.toContain('tag_count:');
    expect(functions).not.toContain('add:');
    expect(functions).not.toContain('item_label:');
  });

  it('produces the same file whatever the catalog order', async () => {
    const { meta } = buildMeta();
    const shuffled = buildMeta().meta;
    shuffled.relations.reverse();
    for (const relation of shuffled.relations) relation.columns.reverse();
    shuffled.functions.reverse();
    expect(await generateDatabaseTypes(shuffled)).toBe(await generateDatabaseTypes(meta));
  });
});

// Item 1.8 (docs/arquitetura/1.8.md, seção 5.4): o gen:types grava e o gen:types:check confere também o tipo do exemplo
// de docs/PERSONALIZAR (base + as migrações do exemplo); o tipo da base não ganha nada do exemplo.
describe('the types of the personalization example', () => {
  const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

  it('lists both generated files, the example in a database of its own with its migrations', () => {
    expect(TYPE_TARGETS.map((target) => target.file)).toEqual([
      'src/integrations/supabase/database.types.ts',
      'docs/PERSONALIZAR/exemplos/database.types.ts',
    ]);
    const example = TYPE_TARGETS[1];
    expect(example.database).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(readdirSync(example.exampleMigrations).filter((name) => name.endsWith('.sql'))).toEqual([
      '20261101090000_custom_cnpj.sql',
      '20261101091000_custom_contratos.sql',
    ]);
  });

  it('the example has the base plus custom_contratos and companies.custom_cnpj; the base has neither', () => {
    const base = read(TYPE_TARGETS[0].file);
    const example = read(TYPE_TARGETS[1].file);
    expect(base).not.toContain('custom_');
    expect(example).toContain('custom_contratos: {');
    expect(example).toContain('custom_cnpj: string | null');
    expect(example.startsWith(TYPE_TARGETS[1].header)).toBe(true);
    // Fora o cabeçalho, a tabela nova e a coluna nova, o tipo do exemplo é o da base.
    expect(example).toContain(base.slice(base.indexOf('export type Json'), base.indexOf('Tables: {') + 9));
  });

  it('staleTypesProblem passes an up-to-date file (also with CRLF) and fails a stale or missing one', () => {
    const generated = 'linha 1\nlinha 2\n';
    expect(staleTypesProblem({ target: 'x.ts', generated, current: 'linha 1\r\nlinha 2\r\n' })).toBeNull();
    const stale = staleTypesProblem({ target: 'docs/x.ts', generated, current: 'linha 1\nlinha velha\n' });
    expect(stale).toContain('docs/x.ts está diferente do que as migrações geram');
    expect(stale).toContain('Primeira diferença na linha 2:');
    expect(stale).toContain('Rode npm run gen:types');
    expect(staleTypesProblem({ target: 'docs/x.ts', generated, current: null })).toContain('não existe');
  });
});
