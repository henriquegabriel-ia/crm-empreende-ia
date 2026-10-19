// Introspecção do schema `public` e geração do tipo `Database` no mesmo formato de
// `supabase gen types typescript`: Json; Tables (Row, Insert, Update, Relationships), Views, Functions,
// Enums e CompositeTypes; e, no fim, os helpers Tables, TablesInsert, TablesUpdate, Enums, CompositeTypes
// e Constants. A saída é determinística: tudo é ordenado com um collator fixo (en-US) e formatado pelo
// Prettier fixado no package.json, com as opções do gerador oficial (sem ponto e vírgula, aspas duplas).
//
// Diferenças conscientes em relação ao gerador oficial (postgres-meta):
// - isOneToOne compara as colunas da FK como conjunto (como o PostgREST em tempo de execução);
// - funções com vários parâmetros OUT devolvem um objeto com esses parâmetros, e não Record<string, unknown>;
// - Relationships de views ficam vazias (o oficial deduz FKs pelas dependências da view; hoje não há views);
// - colunas geradas ficam `?: never` em Insert e Update, porque o PostgreSQL recusa valor explícito nelas
//   (o oficial só bloqueia identity ALWAYS e deixa a coluna gerada opcional e gravável);
// - funções de campo calculado (um único parâmetro sem nome do tipo linha de uma tabela ou view) ficam de
//   fora de Functions, e o Row não ganha o campo calculado (o oficial lista as duas coisas);
// - tipos sem correspondência saem como `unknown | null` quando anuláveis (o oficial escreve só `unknown`;
//   para o TypeScript é o mesmo tipo).
// Iguais ao oficial, de propósito: identity BY DEFAULT fica opcional e gravável em Insert e Update (o
// PostgreSQL aceita valor explícito nela), e funções com parâmetro sem nome só entram quando o PostgREST
// consegue chamá-las (ver `callable`).
import { format } from 'prettier';

export const HEADER = [
  '// Gerado por npm run gen:types — não edite. Fonte: supabase/migrations, via scripts/generate-types.mjs.',
  '// Para mudar o banco, crie uma migração nova em supabase/migrations e rode npm run gen:types.',
].join('\n');

/**
 * Os arquivos que o `npm run gen:types` grava e o `gen:types:check` confere (item 1.8): o tipo da base, com todas as
 * migrações da pasta (as `_custom_` de quem personaliza também), e o do exemplo de docs/PERSONALIZAR, com as migrações
 * da base e as do exemplo num banco à parte, para o guia mostrar o tipo que o aluno ganha depois do gen:types.
 */
export const TYPE_TARGETS = Object.freeze([
  Object.freeze({ file: 'src/integrations/supabase/database.types.ts', header: HEADER }),
  Object.freeze({
    file: 'docs/PERSONALIZAR/exemplos/database.types.ts',
    database: 'crm_personalizar',
    exampleMigrations: 'docs/PERSONALIZAR/exemplos/supabase/migrations',
    header: [
      '// Gerado por npm run gen:types — não edite. Fonte: as migrações da base (supabase/migrations) e as do exemplo',
      '// (docs/PERSONALIZAR/exemplos/supabase/migrations): o tipo que o aluno ganha depois de aplicar as do exemplo.',
    ].join('\n'),
  }),
]);

/** O motivo de um arquivo gerado estar defasado (nulo se está em dia), com a primeira linha diferente. */
export function staleTypesProblem({ target, generated, current }) {
  const normalize = (text) => text.replace(/\r\n/g, '\n');
  if (current === null) return `${target} não existe. Rode npm run gen:types e faça commit do arquivo.`;
  const fresh = normalize(generated);
  const versioned = normalize(current);
  if (fresh === versioned) return null;
  const freshLines = fresh.split('\n');
  const versionedLines = versioned.split('\n');
  let index = 0;
  while (freshLines[index] === versionedLines[index]) index += 1;
  return [
    `${target} está diferente do que as migrações geram (arquivo editado à mão ou migração sem tipos).`,
    `  Primeira diferença na linha ${index + 1}:`,
    `    gerado:     ${freshLines[index] ?? '(fim do arquivo)'}`,
    `    versionado: ${versionedLines[index] ?? '(fim do arquivo)'}`,
    '  Rode npm run gen:types e faça commit do arquivo gerado. Não edite database.types.ts à mão.',
  ].join('\n');
}

const collator = new Intl.Collator('en-US');
export const compareNames = (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const byName = (a, b) => compareNames(a.name, b.name);
const quote = (value) => JSON.stringify(value);

// Tipos nativos pelo nome, como o gerador oficial; o resto vira `unknown`.
const BUILTIN_TYPES = new Map([
  ['bool', 'boolean'],
  ...['int2', 'int4', 'int8', 'float4', 'float8', 'numeric'].map((name) => [name, 'number']),
  ...['bytea', 'bpchar', 'varchar', 'date', 'text', 'time', 'timetz', 'timestamp', 'timestamptz', 'uuid'].map(
    (name) => [name, 'string'],
  ),
  ['json', 'Json'],
  ['jsonb', 'Json'],
  ['void', 'undefined'],
  ['record', 'Record<string, unknown>'],
]);
// Tipos de extensões que o oficial reconhece pelo nome, em qualquer schema.
const EXTENSION_TYPES = new Map([
  ['citext', 'string'],
  ['vector', 'string'],
]);
const TABLE_KINDS = new Set(['r', 'p', 'f']);
const VIEW_KINDS = new Set(['v', 'm']);
const INPUT_MODES = new Set(['in', 'inout', 'variadic']);
const ARG_MODES = { i: 'in', o: 'out', b: 'inout', v: 'variadic', t: 'table' };

// ---------------------------------------------------------------------------------------------
// Introspecção (pg_catalog). Recebe um cliente `pg` já conectado ao banco com as migrações aplicadas.
// ---------------------------------------------------------------------------------------------
const TYPES_SQL = `
select t.oid::int8 as id, t.typname as name, n.nspname as schema, t.typtype as typtype, t.typcategory as category,
  nullif(t.typelem, 0)::int8 as elem_id, nullif(t.typbasetype, 0)::int8 as base_type_id, c.relkind as relkind,
  case when t.typtype = 'e' then array(select e.enumlabel::text from pg_enum e where e.enumtypid = t.oid order by e.enumsortorder) end as enum_values
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
left join pg_class c on c.oid = t.typrelid`;

const RELATIONS_SQL = `
select c.oid::int8 as id, c.relname as name, c.relkind as relkind,
  c.relkind = 'v' and (pg_relation_is_updatable(c.oid::regclass, false) & 20) = 20 as is_updatable
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = $1 and c.relkind in ('r', 'p', 'f', 'v', 'm') and not c.relispartition`;

const COLUMNS_SQL = `
select a.attrelid::int8 as relation_id, a.attname as name, a.atttypid::int8 as type_id,
  not (a.attnotnull or (t.typtype = 'd' and t.typnotnull)) as is_nullable,
  a.atthasdef as has_default,
  case a.attidentity when 'a' then 'ALWAYS' when 'd' then 'BY DEFAULT' end as identity,
  a.attgenerated <> '' as is_generated,
  pg_column_is_updatable(a.attrelid::regclass, a.attnum, false) as is_updatable
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_type t on t.oid = a.atttypid
where n.nspname = $1 and c.relkind in ('r', 'p', 'f', 'v', 'm') and not c.relispartition
  and a.attnum > 0 and not a.attisdropped`;

// FKs entre tabelas do schema (as que apontam para outros schemas, como auth.users, ficam de fora, como no
// oficial). isOneToOne: as colunas da FK formam uma PK ou UNIQUE da própria tabela.
const RELATIONSHIPS_SQL = `
select fk.conname as foreign_key_name, tab.relname as relation, other.relname as referenced_relation,
  array(select a.attname::text from unnest(fk.conkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = k.attnum order by k.ord) as columns,
  array(select a.attname::text from unnest(fk.confkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = fk.confrelid and a.attnum = k.attnum order by k.ord) as referenced_columns,
  exists(select 1 from pg_constraint uq where uq.conrelid = fk.conrelid and uq.contype in ('p', 'u')
         and uq.conkey @> fk.conkey and uq.conkey <@ fk.conkey) as is_one_to_one
from pg_constraint fk
join pg_class tab on tab.oid = fk.conrelid
join pg_namespace ns on ns.oid = tab.relnamespace
join pg_class other on other.oid = fk.confrelid
join pg_namespace other_ns on other_ns.oid = other.relnamespace
where fk.contype = 'f' and fk.conparentid = 0 and ns.nspname = $1 and other_ns.nspname = $1`;

const FUNCTIONS_SQL = `
select p.oid::int8 as id, p.proname as name, p.prorettype::int8 as return_type_id, p.proretset as returns_set,
  p.pronargdefaults as default_count,
  coalesce(p.proallargtypes::int8[], p.proargtypes::oid[]::int8[]) as arg_types,
  p.proargmodes::text[] as arg_modes, p.proargnames as arg_names
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = $1 and p.prokind = 'f'
  and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)`;

const COMPOSITE_TYPES_SQL = `
select t.typname as name, a.attname as attribute, a.atttypid::int8 as type_id
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
join pg_class c on c.oid = t.typrelid and c.relkind = 'c'
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where n.nspname = $1
order by t.typname, a.attnum`;

const RELATION_KIND = { r: 'table', p: 'table', f: 'table', v: 'view', m: 'materialized_view' };

export async function introspectSchema(client, schema = 'public') {
  const query = async (sql, params = []) => (await client.query(sql, params)).rows;
  const [typeRows, relationRows, columnRows, relationshipRows, functionRows, compositeRows] = [
    await query(TYPES_SQL),
    await query(RELATIONS_SQL, [schema]),
    await query(COLUMNS_SQL, [schema]),
    await query(RELATIONSHIPS_SQL, [schema]),
    await query(FUNCTIONS_SQL, [schema]),
    await query(COMPOSITE_TYPES_SQL, [schema]),
  ];

  const types = new Map(
    typeRows.map((row) => [
      Number(row.id),
      {
        name: row.name,
        schema: row.schema,
        typtype: row.typtype,
        category: row.category,
        elemId: row.elem_id === null ? null : Number(row.elem_id),
        baseTypeId: row.base_type_id === null ? null : Number(row.base_type_id),
        relkind: row.relkind,
        enumValues: row.enum_values ?? [],
      },
    ]),
  );

  const relations = relationRows.map((row) => ({
    name: row.name,
    kind: RELATION_KIND[row.relkind],
    isUpdatable: row.is_updatable,
    columns: columnRows
      .filter((column) => column.relation_id === row.id)
      .map((column) => ({
        name: column.name,
        typeId: Number(column.type_id),
        isNullable: column.is_nullable,
        hasDefault: column.has_default,
        identity: column.identity,
        isGenerated: column.is_generated,
        isUpdatable: column.is_updatable,
      })),
  }));

  const relationships = relationshipRows.map((row) => ({
    foreignKeyName: row.foreign_key_name,
    relation: row.relation,
    columns: row.columns,
    isOneToOne: row.is_one_to_one,
    referencedRelation: row.referenced_relation,
    referencedColumns: row.referenced_columns,
  }));

  const functions = functionRows.map((row) => {
    const typeIds = row.arg_types.map(Number);
    const args = typeIds.map((typeId, index) => ({
      name: row.arg_names?.[index] ?? '',
      typeId,
      mode: ARG_MODES[row.arg_modes?.[index] ?? 'i'],
      hasDefault: false,
    }));
    // pg_proc guarda quantos parâmetros de entrada, contados do fim, têm valor padrão.
    const inputs = args.filter((arg) => INPUT_MODES.has(arg.mode));
    for (const arg of inputs.slice(inputs.length - row.default_count)) arg.hasDefault = true;
    return { name: row.name, args, returnTypeId: Number(row.return_type_id), returnsSet: row.returns_set };
  });

  const compositeTypes = [];
  for (const row of compositeRows) {
    let composite = compositeTypes.at(-1);
    if (composite?.name !== row.name) compositeTypes.push((composite = { name: row.name, attributes: [] }));
    composite.attributes.push({ name: row.attribute, typeId: Number(row.type_id) });
  }

  const enums = [...types.values()]
    .filter((type) => type.typtype === 'e' && type.schema === schema)
    .map((type) => ({ name: type.name, values: type.enumValues }));

  return { schema, types, relations, relationships, functions, enums, compositeTypes };
}

// ---------------------------------------------------------------------------------------------
// Geração do TypeScript a partir dos metadados acima.
// ---------------------------------------------------------------------------------------------
export function tsTypeOf(meta, typeId) {
  const type = meta.types.get(typeId);
  if (!type) return 'unknown';
  if (type.typtype === 'd' && type.baseTypeId) return tsTypeOf(meta, type.baseTypeId);
  if (type.category === 'A' && type.elemId) return `(${tsTypeOf(meta, type.elemId)})[]`;
  if (type.schema === 'pg_catalog' && BUILTIN_TYPES.has(type.name)) return BUILTIN_TYPES.get(type.name);
  if (EXTENSION_TYPES.has(type.name)) return EXTENSION_TYPES.get(type.name);
  const own = type.schema === meta.schema;
  const schemaRef = `Database[${quote(meta.schema)}]`;
  if (type.typtype === 'e')
    return own ? `${schemaRef}["Enums"][${quote(type.name)}]` : type.enumValues.map(quote).join(' | ') || 'never';
  if (type.typtype === 'c' && own) {
    if (type.relkind === 'c') return `${schemaRef}["CompositeTypes"][${quote(type.name)}]`;
    if (TABLE_KINDS.has(type.relkind)) return `${schemaRef}["Tables"][${quote(type.name)}]["Row"]`;
    if (VIEW_KINDS.has(type.relkind)) return `${schemaRef}["Views"][${quote(type.name)}]["Row"]`;
  }
  return 'unknown';
}

const nullable = (meta, column) => `${tsTypeOf(meta, column.typeId)}${column.isNullable ? ' | null' : ''}`;
const objectType = (fields) => `{\n${fields.join('\n')}\n}`;
const emptyMap = '{\n[_ in never]: never\n}';
const sortedColumns = (relation) => [...relation.columns].sort(byName);
const writeBlocked = (column) => column.identity === 'ALWAYS' || column.isGenerated;

function renderRelationships(meta, relationName) {
  const relationships = meta.relationships
    .filter((relationship) => relationship.relation === relationName)
    .sort(
      (a, b) =>
        compareNames(a.foreignKeyName, b.foreignKeyName) || compareNames(a.referencedRelation, b.referencedRelation),
    );
  const items = relationships.map((relationship) =>
    objectType([
      `foreignKeyName: ${quote(relationship.foreignKeyName)}`,
      `columns: ${quote(relationship.columns)}`,
      `isOneToOne: ${relationship.isOneToOne}`,
      `referencedRelation: ${quote(relationship.referencedRelation)}`,
      `referencedColumns: ${quote(relationship.referencedColumns)}`,
    ]),
  );
  return `Relationships: [\n${items.map((item) => `${item},`).join('\n')}\n]`;
}

function renderTable(meta, table) {
  const columns = sortedColumns(table);
  const row = columns.map((column) => `${quote(column.name)}: ${nullable(meta, column)}`);
  // Identity ALWAYS e colunas geradas não aceitam valor: ficam fora da escrita (`?: never`). Identity BY
  // DEFAULT aceita valor explícito, então fica opcional e gravável, como no oficial.
  const insert = columns.map((column) => {
    if (writeBlocked(column)) return `${quote(column.name)}?: never`;
    const optional = column.isNullable || column.identity !== null || column.hasDefault;
    return `${quote(column.name)}${optional ? '?' : ''}: ${nullable(meta, column)}`;
  });
  const update = columns.map((column) =>
    writeBlocked(column) ? `${quote(column.name)}?: never` : `${quote(column.name)}?: ${nullable(meta, column)}`,
  );
  return `${quote(table.name)}: ${objectType([
    `Row: ${objectType(row)}`,
    `Insert: ${objectType(insert)}`,
    `Update: ${objectType(update)}`,
    renderRelationships(meta, table.name),
  ])}`;
}

function renderView(meta, view) {
  const columns = sortedColumns(view);
  const parts = [`Row: ${objectType(columns.map((column) => `${quote(column.name)}: ${nullable(meta, column)}`))}`];
  if (view.kind === 'view' && view.isUpdatable) {
    const writable = columns.map((column) =>
      column.isUpdatable
        ? `${quote(column.name)}?: ${tsTypeOf(meta, column.typeId)} | null`
        : `${quote(column.name)}?: never`,
    );
    parts.push(`Insert: ${objectType(writable)}`, `Update: ${objectType(writable)}`);
  }
  parts.push('Relationships: []');
  return `${quote(view.name)}: ${objectType(parts)}`;
}

// Funções chamáveis pelo PostgREST, com as mesmas regras do oficial: sem parâmetros de entrada; todos com
// nome; um único sem nome de tipo json, jsonb ou text (o corpo da requisição vai inteiro para ele); ou
// parâmetros sem nome só desses tipos e com valor padrão. As demais (como `f(int8)`) ficam de fora.
const UNNAMED_ARG_TYPES = new Set(['json', 'jsonb', 'text']);
const acceptsUnnamed = (meta, arg) => {
  const type = meta.types.get(arg.typeId);
  return type?.schema === 'pg_catalog' && UNNAMED_ARG_TYPES.has(type.name);
};
const callable = (meta, fn) => {
  const inputs = fn.args.filter((arg) => INPUT_MODES.has(arg.mode));
  const unnamed = inputs.filter((arg) => arg.name === '');
  if (!unnamed.length) return true;
  if (inputs.length === 1) return acceptsUnnamed(meta, unnamed[0]);
  return unnamed.every((arg) => arg.hasDefault && acceptsUnnamed(meta, arg));
};

function relationColumnsType(meta, typeId) {
  const type = meta.types.get(typeId);
  if (!type || type.typtype !== 'c' || type.schema !== meta.schema) return null;
  if (!TABLE_KINDS.has(type.relkind) && !VIEW_KINDS.has(type.relkind)) return null;
  const relation = meta.relations.find((candidate) => candidate.name === type.name);
  if (!relation) return null;
  return objectType(sortedColumns(relation).map((column) => `${quote(column.name)}: ${nullable(meta, column)}`));
}

function renderFunctionSignature(meta, fn) {
  const inputs = fn.args.filter((arg) => INPUT_MODES.has(arg.mode)).sort(byName);
  // Args numa linha só, como o oficial: o Prettier só quebra quando passa de 80 colunas.
  const args = inputs.length
    ? `Args: { ${inputs.map((arg) => `${quote(arg.name)}${arg.hasDefault ? '?' : ''}: ${tsTypeOf(meta, arg.typeId)}`).join('; ')} }`
    : 'Args: never';
  const tableColumns = fn.args.filter((arg) => arg.mode === 'table');
  const outputs = fn.args.filter((arg) => arg.mode === 'out' || arg.mode === 'inout');
  const returnType = meta.types.get(fn.returnTypeId);
  let returns;
  if (tableColumns.length) {
    returns = objectType(
      [...tableColumns].sort(byName).map((arg) => `${quote(arg.name)}: ${tsTypeOf(meta, arg.typeId)}`),
    );
  } else if (outputs.length > 1 && returnType?.name === 'record') {
    returns = objectType([...outputs].sort(byName).map((arg) => `${quote(arg.name)}: ${tsTypeOf(meta, arg.typeId)}`));
  } else {
    returns = relationColumnsType(meta, fn.returnTypeId) ?? tsTypeOf(meta, fn.returnTypeId);
  }
  if (fn.returnsSet) returns = returns.startsWith('{') ? `${returns}[]` : `(${returns})[]`;
  return objectType([args, `Returns: ${returns}`]);
}

function renderFunctions(meta) {
  const groups = new Map();
  for (const fn of meta.functions.filter((candidate) => callable(meta, candidate))) {
    if (!groups.has(fn.name)) groups.set(fn.name, []);
    groups.get(fn.name).push(renderFunctionSignature(meta, fn));
  }
  const entries = [...groups.keys()].sort(compareNames).map((name) => {
    const signatures = [...new Set(groups.get(name))].sort(compareNames);
    return `${quote(name)}: ${signatures.length === 1 ? signatures[0] : signatures.map((s) => `| ${s}`).join('\n')}`;
  });
  return entries.length ? objectType(entries) : emptyMap;
}

function renderEnums(meta) {
  const enums = [...meta.enums].sort(byName);
  if (!enums.length) return emptyMap;
  return objectType(enums.map((item) => `${quote(item.name)}: ${item.values.map(quote).join(' | ') || 'never'}`));
}

function renderCompositeTypes(meta) {
  const composites = [...meta.compositeTypes].sort(byName);
  if (!composites.length) return emptyMap;
  return objectType(
    composites.map(
      (composite) =>
        `${quote(composite.name)}: ${objectType(
          composite.attributes.map(
            (attribute) => `${quote(attribute.name)}: ${tsTypeOf(meta, attribute.typeId)} | null`,
          ),
        )}`,
    ),
  );
}

// Helpers no fim do arquivo, iguais aos do gerador oficial.
const HELPERS = `
type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
`;

function renderConstants(meta) {
  const enums = [...meta.enums].sort(byName);
  const body = enums.map((item) => `${quote(item.name)}: [${item.values.map(quote).join(', ')}],`).join('\n');
  return `export const Constants = {\n${quote(meta.schema)}: {\nEnums: {\n${body}\n},\n},\n} as const`;
}

// Código TypeScript sem formatação; `generateDatabaseTypes` aplica o Prettier.
export function renderDatabaseTypes(meta, header = HEADER) {
  const tables = meta.relations.filter((relation) => relation.kind === 'table').sort(byName);
  const views = meta.relations.filter((relation) => relation.kind !== 'table').sort(byName);
  const schemaBody = objectType([
    `Tables: ${tables.length ? objectType(tables.map((table) => renderTable(meta, table))) : emptyMap}`,
    `Views: ${views.length ? objectType(views.map((view) => renderView(meta, view))) : emptyMap}`,
    `Functions: ${renderFunctions(meta)}`,
    `Enums: ${renderEnums(meta)}`,
    `CompositeTypes: ${renderCompositeTypes(meta)}`,
  ]);
  return [
    header,
    '',
    'export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]',
    '',
    `export type Database = {\n${quote(meta.schema)}: ${schemaBody}\n}`,
    HELPERS,
    renderConstants(meta),
    '',
  ].join('\n');
}

export async function generateDatabaseTypes(meta, header = HEADER) {
  return format(renderDatabaseTypes(meta, header), { parser: 'typescript', semi: false, endOfLine: 'lf' });
}
