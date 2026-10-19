// Item 1.4 (docs/arquitetura/1.4.md, seção 12.1): o gerador da conferência da instância (supabase/instance-check.sql).
// A consulta rodando num banco certo e em bancos alterados de propósito é conferida no test:db (instanceCheckChecks).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANIFEST_FILE, ManifestError } from './base-manifest.mjs';
import { buildDemoDataset } from './demo-seed.mjs';
import { ROOT } from './embedded-db.mjs';
import {
  CRITICAL_FUNCTIONS,
  INSTANCE_CHECK_FILE,
  INSTANCE_CHECK_MAX_BYTES,
  MIGRATION_ROLE_SQL,
  REQUIRED_INDEXES,
  WRITE_WORDS,
  instanceCheckCode,
  renderInstanceCheck,
} from './instance-check.mjs';

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const manifest = JSON.parse(read(MANIFEST_FILE));
const demoPipelineId = buildDemoDataset().partnerPipeline.id;
const render = (input = manifest) => renderInstanceCheck(input, { demoPipelineId });
const sql = render();
const ofKind = (kind) => manifest.objects.filter((object) => object.kind === kind);

describe('conferência da instância (item 1.4)', () => {
  it('o arquivo versionado é o que o manifesto gera, sempre igual', () => {
    expect(read(INSTANCE_CHECK_FILE)).toBe(sql);
    expect(render()).toBe(sql);
  });

  it('traz todas as migrações, os gatilhos, as tabelas com RLS e as nove linhas de privilégio padrão', () => {
    for (const { version, name } of manifest.migrations) expect(sql).toContain(`('${version}', '${name}')`);
    const triggers = ofKind('trigger');
    expect(triggers).toHaveLength(80);
    for (const trigger of triggers) expect(sql).toContain(`('${trigger.object}', '${trigger.props.enabled}')`);
    for (const table of ofKind('table').filter((object) => object.props.rls))
      expect(sql).toContain(`('${table.object}')`);
    const defaults = ofKind('default_acl');
    expect(defaults).toHaveLength(9);
    for (const row of defaults) expect(sql).toContain(`('${row.object}', '${row.props.acl}')`);
    for (const index of REQUIRED_INDEXES) expect(sql).toContain(`('${index}')`);
  });

  it('cada função crítica entra com o hash do corpo, a segurança e a configuração do manifesto', () => {
    for (const signature of CRITICAL_FUNCTIONS) {
      const object = manifest.objects.find((entry) => entry.kind === 'function' && entry.object === signature);
      expect(object, signature).toBeDefined();
      expect(sql).toContain(
        `('${signature}', '${object.body}', '${object.props.security}', '${object.props.config.replace(/'/g, "''")}')`,
      );
    }
    expect(CRITICAL_FUNCTIONS).toHaveLength(19);
    // Quem muda o papel de quem e a admissão pelo convite e pela primeira empresa (revisão do 1.4).
    for (const signature of ['private.role_change_allowed(text,text,text)', 'private.handle_new_user()'])
      expect(CRITICAL_FUNCTIONS).toContain(signature);
  });

  it('as outras funções da base entram com a segurança e a configuração, e os ganchos custom_* ficam de fora', () => {
    const others = ofKind('function').filter((object) => !CRITICAL_FUNCTIONS.includes(object.object));
    expect(others.length).toBeGreaterThan(50);
    for (const object of others)
      expect(sql).toContain(
        `('${object.object}', '${object.props.security}', '${object.props.config.replace(/'/g, "''")}')`,
      );
    // As RPCs de public (segunda revisão do 1.4): uma trocada para security definer passaria por cima da RLS.
    expect(sql).toContain(`('public.search_crm(text,integer)', 'invoker', 'search_path=""')`);
    for (const hook of ofKind('hook')) expect(sql).not.toContain(`('${hook.object}', '${hook.props.security}'`);
  });

  it('traz as políticas da base com o comando, os papéis e o hash da expressão, e as permissões por coluna', () => {
    const policies = ofKind('policy');
    expect(policies.length).toBeGreaterThan(50);
    for (const policy of policies)
      expect(sql).toContain(
        `('${policy.object}', '${policy.parent}', '${policy.props.command}', '${policy.props.permissive}', '${policy.props.roles}', '${policy.body}')`,
      );
    const columns = ofKind('column').filter((object) => object.props.acl);
    expect(columns.length).toBeGreaterThan(0);
    for (const column of columns) expect(sql).toContain(`('${column.object}', '${column.props.acl}')`);
    // O search_path vazio só na transação, para pg_get_expr escrever a expressão como o manifesto.
    expect(instanceCheckCode(sql)).toContain("pg_catalog.set_config('', '', true)");
  });

  it('é um único comando, só de leitura, sem ponto e vírgula no meio e sem palavra de escrita', () => {
    const code = instanceCheckCode(sql);
    expect(code.trimEnd().endsWith(';')).toBe(true);
    expect(sql.split(';')).toHaveLength(2);
    expect(code).toMatch(/^\s*with params as \(/);
    for (const word of WRITE_WORDS) expect(code, word).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
    // A conferência de escrita pega uma palavra proibida fora dos literais (mutação conferida).
    expect(instanceCheckCode("select 1 from x where y = 'update'")).not.toMatch(/\bupdate\b/);
    expect(instanceCheckCode('select 1 -- delete\nfrom x for update')).toMatch(/\bupdate\b/);
  });

  it('o papel das migrações aparece uma vez só (o test:db o troca) e o arquivo fica abaixo de 100 KB', () => {
    expect(sql.split(MIGRATION_ROLE_SQL)).toHaveLength(2);
    expect(Buffer.byteLength(sql, 'utf8')).toBeLessThan(INSTANCE_CHECK_MAX_BYTES);
  });

  it('o cabeçalho diz que é gerado, como colar no editor e manda o Auth para o verify-instance', () => {
    expect(sql).toMatch(
      /^-- Conferência da instância do CRM \(item 1\.4\)\. ARQUIVO GERADO por npm run manifest:build/,
    );
    expect(sql).toContain(`Base ${manifest.lastMigration}.`);
    expect(sql).toContain('SQL Editor, New query');
    expect(sql).toContain('npm run verify-instance');
    expect(sql).toContain('supabase/db-drift-check.sql');
    expect(sql).toContain(demoPipelineId);
  });

  it('não depende das funções do CRM nem do search_path do editor', () => {
    const code = instanceCheckCode(sql);
    expect(code).not.toMatch(/private\.base_fingerprints\(\)|private\.base_acl\(/);
    expect(code).not.toContain('::regprocedure');
    // As tabelas que podem não existir são lidas por query_to_xml, só quando to_regclass as acha.
    expect(code).not.toMatch(/from (public|supabase_migrations)\./);
  });

  it('uma função crítica fora do manifesto faz o gerador falhar com o nome', () => {
    const without = {
      ...manifest,
      objects: manifest.objects.filter((object) => object.object !== 'private.current_org()'),
    };
    expect(() => render(without)).toThrow(ManifestError);
    expect(() => render(without)).toThrow(/private\.current_org\(\)/);
    const withoutIndex = {
      ...manifest,
      objects: manifest.objects.filter((object) => object.object !== REQUIRED_INDEXES[0]),
    };
    expect(() => render(withoutIndex)).toThrow(/activities_owner_pending/);
  });

  it('as listas vêm do manifesto: sem um gatilho no manifesto, a consulta não o espera', () => {
    const trigger = 'public.deals.refuse_inactive_assignee';
    const without = { ...manifest, objects: manifest.objects.filter((object) => object.object !== trigger) };
    expect(sql).toContain(`('${trigger}', 'O')`);
    expect(render(without)).not.toContain(`('${trigger}', 'O')`);
    expect(render(without)).toContain('Os 79 gatilhos da base');
  });
});
