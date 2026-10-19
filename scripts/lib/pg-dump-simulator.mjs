// Um pg_dump simulado, só para o cluster descartável (revisão do item 1.5, rodada 1; desenho em docs/arquitetura/1.5.md,
// seção 21). Escreve, em Node, o mesmo formato que o `pg_dump` 17 escreve com as opções de dados do CLI fixado
// (`--data-only --column-inserts --rows-per-insert`, scripts/lib/backup-dump.mjs): o cabeçalho com `\restrict`, os SET,
// o `set_config` do search_path, um INSERT de várias linhas por tabela com a lista de colunas (sem as geradas), os
// literais como o pg_dump os escreve (números sem aspas, `true`/`false`, `B'...'` e o resto entre aspas simples) e o
// `setval` de cada sequência.
//
// NÃO substitui o pg_dump de verdade. Serve para o test:db exercitar, a cada push e em qualquer máquina, a restauração
// inteira (o código do `npm run backup:restore` com e sem --apply, as conferências e as recusas) sobre um dump neste
// formato. A prova com o programa real é o `npm run test:restore` (job `restauracao` do CI), que compara as opções com o
// `--dry-run` do CLI. Se o formato do pg_dump mudar, é o ensaio real que reprova, não este simulador.
import { randomBytes } from 'node:crypto';
import pg from 'pg';

// Os tipos que o pg_dump escreve sem aspas quando o valor só tem dígitos, sinal, ponto e expoente (dumpTableData_insert).
const NUMERIC_TYPES = new Set([20, 21, 23, 26, 700, 701, 1700]);
const BOOL_TYPE = 16;
const BIT_TYPES = new Set([1560, 1562]);
const RAW_TEXT = { getTypeParser: () => (value) => value };

const quoteIdentifier = (name) => `"${name.replace(/"/g, '""')}"`;
const quoteLiteral = (text) => `'${text.replace(/'/g, "''")}'`;

// Um padrão de nome do pg_dump (`pg_*`, `a|b`, `"auth"."sessions"` ou `auth.sessions`) virando expressão regular.
function namePattern(pattern) {
  const piece = (text) =>
    text.startsWith('"') && text.endsWith('"')
      ? text
          .slice(1, -1)
          .replace(/""/g, '"')
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      : text
          .toLowerCase()
          .split('|')
          .map((part) =>
            part
              .replace(/[.+^${}()[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '.'),
          )
          .join('|');
  return piece(pattern);
}

function parseArgs(args) {
  const options = { excludeSchemas: [], schemas: [], excludeTables: [], dataOnly: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--data-only') options.dataOnly = true;
    else if (arg === '--exclude-schema') {
      if (value) options.excludeSchemas.push(new RegExp(`^(?:${namePattern(value)})$`));
      index += 1;
    } else if (arg === '--schema') {
      options.schemas.push(new RegExp(`^(?:${namePattern(value)})$`));
      index += 1;
    } else if (arg === '--exclude-table') {
      const quoted = /^"((?:[^"]|"")+)"\."((?:[^"]|"")+)"$/.exec(value);
      const [schema, table] = quoted
        ? [quoted[1].replace(/""/g, '"'), quoted[2].replace(/""/g, '"')]
        : value.toLowerCase().split('.');
      options.excludeTables.push(`${schema}.${table}`);
      index += 1;
    } else if (arg === '--role' || arg === '--rows-per-insert') index += 1;
    else if (arg !== '--quote-all-identifier' && arg !== '--column-inserts')
      throw new Error(`o pg_dump simulado não conhece a opção ${arg}`);
  }
  if (!options.dataOnly) throw new Error('o pg_dump simulado só faz o dump de dados (--data-only)');
  return options;
}

function literal(value, typeId) {
  if (value === null) return 'NULL';
  if (NUMERIC_TYPES.has(typeId)) return /^[0-9 +\-eE.]+$/.test(value) ? value : quoteLiteral(value);
  if (BIT_TYPES.has(typeId)) return `B'${value}'`;
  if (typeId === BOOL_TYPE) return value === 't' ? 'true' : 'false';
  return quoteLiteral(value);
}

/**
 * `dump(connection, args)`, com a mesma assinatura do `pgDumpRunner` de scripts/lib/restore-rehearsal.mjs: devolve o
 * texto que o pg_dump escreveria na saída para essas opções, lido do banco de `connection` numa transação só de leitura.
 */
export async function simulatedPgDump(connection, args) {
  const options = parseArgs(args);
  const client = new pg.Client({ ...connection, application_name: 'crm-pg-dump-simulado' });
  await client.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const selected = (schema) =>
      !options.excludeSchemas.some((pattern) => pattern.test(schema)) &&
      (options.schemas.length === 0 || options.schemas.some((pattern) => pattern.test(schema)));
    const { rows: tables } = await client.query(
      `select n.nspname as schema, c.relname as name, c.oid, pg_get_userbyid(c.relowner) as owner
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_toast%'
        order by 1, 2`,
    );
    const version = (await client.query('show server_version')).rows[0].server_version;
    const key = randomBytes(24).toString('base64url');
    const out = [
      '--',
      '-- PostgreSQL database dump',
      '--',
      '',
      `\\restrict ${key}`,
      '',
      `-- Dumped from database version ${version}`,
      `-- Dumped by pg_dump version ${version} (simulado)`,
      '',
      'SET statement_timeout = 0;',
      'SET lock_timeout = 0;',
      'SET idle_in_transaction_session_timeout = 0;',
      'SET transaction_timeout = 0;',
      "SET client_encoding = 'UTF8';",
      'SET standard_conforming_strings = on;',
      "SELECT pg_catalog.set_config('search_path', '', false);",
      'SET check_function_bodies = false;',
      'SET xmloption = content;',
      'SET client_min_messages = warning;',
      'SET row_security = off;',
      '',
    ];
    const dumped = new Set();
    for (const table of tables) {
      if (!selected(table.schema) || options.excludeTables.includes(`${table.schema}.${table.name}`)) continue;
      dumped.add(table.oid);
      const { rows: columns } = await client.query(
        `select attname as name, attidentity as identity from pg_attribute
          where attrelid = $1 and attnum > 0 and not attisdropped and attgenerated = '' order by attnum`,
        [table.oid],
      );
      const list = columns.map((column) => quoteIdentifier(column.name)).join(', ');
      const result = await client.query({
        text: `select ${list} from ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`,
        rowMode: 'array',
        types: RAW_TEXT,
      });
      if (!result.rows.length) continue;
      const override = columns.some((column) => column.identity === 'a') ? ' OVERRIDING SYSTEM VALUE' : '';
      out.push(
        '--',
        `-- Data for Name: ${table.name}; Type: TABLE DATA; Schema: ${table.schema}; Owner: ${table.owner}`,
        '--',
        '',
        `INSERT INTO ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)} (${list})${override} VALUES`,
        `${result.rows
          .map((row) => `\t(${row.map((value, index) => literal(value, result.fields[index].dataTypeID)).join(', ')})`)
          .join(',\n')};`,
        '',
        '',
      );
    }
    // As sequências dos schemas escolhidos; a de identidade só com a tabela dela.
    const { rows: sequences } = await client.query(
      `select n.nspname as schema, c.relname as name, pg_get_userbyid(c.relowner) as owner,
          (select d.refobjid from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'i') as identity_of
        from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'S' order by 1, 2`,
    );
    for (const sequence of sequences) {
      if (!selected(sequence.schema)) continue;
      if (sequence.identity_of && !dumped.has(sequence.identity_of)) continue;
      const qualified = `${quoteIdentifier(sequence.schema)}.${quoteIdentifier(sequence.name)}`;
      const { rows } = await client.query(`select last_value::text as value, is_called from ${qualified}`);
      out.push(
        '--',
        `-- Name: ${sequence.name}; Type: SEQUENCE SET; Schema: ${sequence.schema}; Owner: ${sequence.owner}`,
        '--',
        '',
        `SELECT pg_catalog.setval('${qualified.replace(/'/g, "''")}', ${rows[0].value}, ${rows[0].is_called});`,
        '',
        '',
      );
    }
    out.push('--', '-- PostgreSQL database dump complete', '--', '', `\\unrestrict ${key}`, '', '');
    return out.join('\n');
  } finally {
    await client.query('rollback').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
