// @vitest-environment node
// Item 1.5 (docs/arquitetura/1.5.md, seção 16.1): o workflow modelo de backup (.github/workflows/backup-banco.yml), lido
// como YAML, e as opções do dump fixadas contra o `supabase db dump --dry-run` do CLI 2.119.0 guardado em fixtures/.
// O workflow não roda aqui: o Vitest confere que ele é válido, desligado por padrão e sem segredo no arquivo. O passo
// "Conferir configuração" roda de verdade no bash (revisão do item 1.5, rodada 1), com um `gh` falso no PATH, quando há
// bash na máquina (no CI Linux, sempre; no Windows, o do Git).
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  BACKUP_CLI_VERSION,
  BACKUP_EXCLUDED_TABLES,
  BACKUP_WORKFLOW_FILE,
  CLI_DATA_DUMP,
  CLI_HISTORY_DUMP,
  CREDENTIAL_TABLES,
  DRY_RUN_FIXTURES,
  dryRunDifferences,
  excludeTableArgs,
  parseCliDryRun,
  postProcessDump,
} from './backup-dump.mjs';
import { ROOT } from './embedded-db.mjs';
import { SUPABASE_CLI_VERSION } from './supabase-config.mjs';

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const source = read(BACKUP_WORKFLOW_FILE);
const workflow = parse(source);
const job = workflow.jobs.backup;
const steps = job.steps;
const stepNamed = (name) => steps.find((step) => step.name === name);
const runOf = (name) => stepNamed(name)?.run ?? '';
const SECRETS = ['CRM_BACKUP_DB_URL', 'CRM_BACKUP_PASSWORD', 'CRM_BACKUP_RCLONE_CONFIG'];
const VARIABLES = ['CRM_BACKUP_ENABLED', 'CRM_BACKUP_RETENTION_DAYS', 'CRM_BACKUP_REMOTE'];

describe('workflow modelo de backup', () => {
  it('é YAML válido, com um job só e os gatilhos schedule e workflow_dispatch', () => {
    expect(workflow.name).toBe('Backup do banco');
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(workflow.on.schedule).toEqual([{ cron: '30 5 * * *' }]);
    expect(Object.keys(workflow.jobs)).toEqual(['backup']);
  });

  it('é desligado por padrão: o job só roda com a variável CRM_BACKUP_ENABLED igual a true', () => {
    expect(job.if).toBe("vars.CRM_BACKUP_ENABLED == 'true'");
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency).toEqual({ group: 'backup-banco', 'cancel-in-progress': false });
    expect(job['timeout-minutes']).toBeLessThanOrEqual(30);
  });

  it('nenhum segredo no arquivo, e só os secrets e as variáveis do guia', () => {
    expect(source).not.toMatch(/postgres(ql)?:\/\/[^\s'"]*@/);
    expect(source).not.toMatch(/sb_secret_|service_role|eyJhbGci/);
    const secrets = [...source.matchAll(/secrets\.([A-Z_]+)/g)].map((match) => match[1]);
    expect(new Set(secrets)).toEqual(new Set(SECRETS));
    const variables = [...source.matchAll(/vars\.([A-Z_]+)/g)].map((match) => match[1]);
    expect(new Set(variables)).toEqual(new Set(VARIABLES));
    // Os secrets nunca vão para um echo nem para a linha de comando, fora da senha do 7z (mascarada no log).
    for (const step of steps) expect(step.run ?? '', step.name).not.toMatch(/echo[^\n]*\$\{\{\s*secrets/);
  });

  it('confere a configuração antes de qualquer passo que use a conexão, com as recusas do AC-3', () => {
    const first = steps.findIndex((step) => JSON.stringify(step).includes('CRM_BACKUP_DB_URL'));
    expect(steps[first].name).toBe('Conferir configuração');
    expect(steps[first].id).toBe('config');
    const check = runOf('Conferir configuração');
    expect(check).toContain('Este repositório é público');
    expect(check).toContain('Falta o secret CRM_BACKUP_DB_URL');
    expect(check).toContain('Falta o secret CRM_BACKUP_PASSWORD');
    expect(check).toContain('precisa começar por postgresql://');
    expect(check).toMatch(/db\.\*\.supabase\.co\)[^\n]*conexão direta/);
    expect(check).toContain('-ge 16');
    expect(check).toMatch(/-lt 1 \][^\n]*-gt 90/);
    expect(check).toContain('RETENTION_DAYS:-7');
    expect(check).toContain('falta o secret CRM_BACKUP_RCLONE_CONFIG');
    expect(check).toContain('falta a variável CRM_BACKUP_REMOTE');
  });

  it('usa a versão do CLI fixada em SUPABASE_CLI_VERSION', () => {
    expect(job.env.CRM_SUPABASE_CLI_VERSION).toBe(SUPABASE_CLI_VERSION);
    expect(BACKUP_CLI_VERSION).toBe(SUPABASE_CLI_VERSION);
    const setup = steps.find((step) => String(step.uses).startsWith('supabase/setup-cli@'));
    expect(setup.with.version).toBe('${{ env.CRM_SUPABASE_CLI_VERSION }}');
  });

  it('a única ação de terceiro fica presa ao commit, e as outras são do próprio GitHub', () => {
    for (const step of steps.filter((item) => item.uses)) {
      if (String(step.uses).startsWith('actions/')) continue;
      expect(step.uses, 'ação de terceiro presa pelo SHA do commit').toMatch(/^supabase\/setup-cli@[0-9a-f]{40}$/);
    }
    expect(source).toMatch(/supabase\/setup-cli@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  });

  it('o dump de dados sai em INSERT, sem as credenciais do Auth, e o histórico é lido antes e depois', () => {
    const dump = runOf('Dump do banco');
    const dataLine = dump.slice(
      dump.indexOf('dump --data-only -f data.sql'),
      dump.indexOf('dump --data-only --schema supabase_migrations -f history.sql'),
    );
    expect(dump).not.toContain('--use-copy');
    for (const table of BACKUP_EXCLUDED_TABLES) expect(dataLine).toContain(`-x ${table}`);
    expect(dump.indexOf('-f history-before.sql')).toBeLessThan(dump.indexOf('-f data.sql'));
    expect(dump.indexOf('-f data.sql')).toBeLessThan(dump.indexOf('-f history.sql'));
    expect(dump).toContain('Uma migração foi aplicada durante o backup. Rode o backup de novo.');
    expect(dump).toContain('INSERT INTO "public"."organizations"');
    expect(dump).toContain('umask 077');
    expect(dump).toContain('format: 1');
  });

  it('cifra num .7z com AES-256 e os nomes cifrados, e apaga o texto claro', () => {
    const encrypt = runOf('Cifrar o backup');
    expect(encrypt).toMatch(/7z a -t7z -mhe=on -mx=9 -p"\$ARCHIVE_PASSWORD"/);
    expect(encrypt).toContain('rm -f data.sql history.sql schema.sql roles.sql backup-info.json');
  });

  it('guarda só o .7z, com a retenção validada e falha se não houver arquivo', () => {
    const upload = stepNamed('Guardar o arquivo cifrado');
    expect(upload.uses).toMatch(/^actions\/upload-artifact@v\d+$/);
    expect(upload.with.path).toBe('${{ runner.temp }}/crm-backup-out/*.7z');
    expect(upload.with['retention-days']).toBe('${{ steps.config.outputs.retention }}');
    expect(upload.with['if-no-files-found']).toBe('error');
    expect(upload.with['compression-level']).toBe(0);
    expect(steps.filter((step) => String(step.uses).startsWith('actions/upload-artifact'))).toHaveLength(1);
  });

  it('a cópia no armazenamento da empresa só roda com as duas configurações e nunca apaga', () => {
    const copy = stepNamed('Copiar para o armazenamento da empresa');
    expect(copy.if).toBe("steps.config.outputs.remote == 'true'");
    expect(copy.run).toContain('rclone --config');
    expect(copy.run).toMatch(/rclone [^\n]* copy /);
    expect(copy.run).not.toMatch(/rclone [^\n]*\b(sync|delete|purge|move)\b/);
    expect(copy.run).not.toMatch(/curl[^\n]*\|\s*(ba)?sh/);
  });

  it('apaga os arquivos do runner mesmo em falha', () => {
    const last = steps.at(-1);
    expect(last.if).toBe('always()');
    expect(last.run).toContain('crm-backup');
  });
});

describe('opções do dump fixadas contra o CLI', () => {
  it('as opções de dados e do histórico batem com o --dry-run do CLI 2.119.0 guardado', () => {
    expect(CLI_DATA_DUMP.cliVersion).toBe(SUPABASE_CLI_VERSION);
    expect(dryRunDifferences(read(DRY_RUN_FIXTURES.data), CLI_DATA_DUMP, BACKUP_EXCLUDED_TABLES)).toEqual([]);
    expect(dryRunDifferences(read(DRY_RUN_FIXTURES.history), CLI_HISTORY_DUMP)).toEqual([]);
  });

  it('uma opção a mais (como --use-copy) ou um -x a menos reprova a comparação', () => {
    const changed = { ...CLI_DATA_DUMP, args: [...CLI_DATA_DUMP.args, '--use-copy'] };
    expect(dryRunDifferences(read(DRY_RUN_FIXTURES.data), changed, BACKUP_EXCLUDED_TABLES)[0]).toMatch(
      /argumentos do pg_dump diferentes/,
    );
    expect(dryRunDifferences(read(DRY_RUN_FIXTURES.data), CLI_DATA_DUMP, CREDENTIAL_TABLES)).toHaveLength(1);
    const withoutReset = read(DRY_RUN_FIXTURES.data).replace('echo "RESET ALL;"', '');
    expect(dryRunDifferences(withoutReset, CLI_DATA_DUMP, BACKUP_EXCLUDED_TABLES)).toEqual([
      'o CLI não fecha mais o dump com RESET ALL;',
    ]);
  });

  it('o dump de dados não exclui auth, storage, private nem public, e os -x viram --exclude-table com aspas', () => {
    const schemas = CLI_DATA_DUMP.args[CLI_DATA_DUMP.args.indexOf('--exclude-schema') + 1].split('|');
    for (const schema of ['auth', 'storage', 'private', 'public']) expect(schemas).not.toContain(schema);
    expect(schemas).toContain('supabase_migrations');
    expect(CLI_DATA_DUMP.args).not.toContain('--use-copy');
    expect(CLI_DATA_DUMP.args).toContain('--column-inserts');
    expect(excludeTableArgs(['auth.sessions'])).toEqual(['--exclude-table', '"auth"."sessions"']);
    expect(parseCliDryRun(read(DRY_RUN_FIXTURES.data)).args.slice(-2)).toEqual([
      '--exclude-table',
      '"auth"."flow_state"',
    ]);
  });

  it('o pós-processamento é o do CLI: replica antes, \\restrict comentado e RESET ALL no fim', () => {
    const raw =
      '--\n-- PostgreSQL database dump\n--\n\n\\restrict abc\n\nSET row_security = off;\n\n\\unrestrict abc\n';
    const done = postProcessDump(raw);
    expect(done.startsWith('SET session_replication_role = replica;\n\n')).toBe(true);
    expect(done).toContain('-- \\restrict abc');
    expect(done).toContain('-- \\unrestrict abc');
    expect(done).not.toMatch(/^\\(un)?restrict/m);
    expect(done.endsWith('RESET ALL;\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// O passo "Conferir configuração" executado no bash, com um `gh` falso que responde se o repositório é privado.
// ---------------------------------------------------------------------------------------------
function findBash() {
  const candidates =
    process.platform === 'win32'
      ? [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')]
      : ['bash'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'echo ok'], { encoding: 'utf8', windowsHide: true });
    if (probe.status === 0 && probe.stdout.trim() === 'ok') return candidate;
  }
  return null;
}

const BASH = findBash();
const VALID_ENV = Object.freeze({
  REPO_PRIVATE: 'true',
  DB_URL: 'postgresql://postgres.abcdefghijabcdefghij:senha%23forte@aws-0-sa-east-1.pooler.supabase.com:5432/postgres',
  ARCHIVE_PASSWORD: 'uma-senha-bem-longa-1234',
  RCLONE_CONFIG_CONTENT: '',
  RETENTION_DAYS: '',
  REMOTE: '',
});

describe.skipIf(!BASH)('passo "Conferir configuração" executado no bash', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'crm-backup-config-'));
  afterAll(() => rmSync(workDir, { recursive: true, force: true }));
  const fakeBin = path.join(workDir, 'bin');
  mkdirSync(fakeBin);
  writeFileSync(path.join(fakeBin, 'gh'), '#!/usr/bin/env bash\nprintf "%s\\n" "$REPO_PRIVATE"\n');
  chmodSync(path.join(fakeBin, 'gh'), 0o755);
  const script = path.join(workDir, 'conferir.sh');
  writeFileSync(script, runOf('Conferir configuração'));
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  let runs = 0;
  const run = (overrides) => {
    runs += 1;
    const output = path.join(workDir, `saida-${runs}.txt`);
    writeFileSync(output, '');
    const env = { ...process.env, ...VALID_ENV, ...overrides };
    env[pathKey] = `${fakeBin}${path.delimiter}${process.env[pathKey] ?? ''}`;
    env.GITHUB_REPOSITORY = 'empresa/crm';
    env.GITHUB_OUTPUT = output;
    env.GH_TOKEN = 'token-falso';
    const result = spawnSync(BASH, [script], { encoding: 'utf8', env, windowsHide: true });
    return { status: result.status, out: `${result.stdout}${result.stderr}`, outputs: readFileSync(output, 'utf8') };
  };

  it('aceita a configuração válida e grava a retenção e o remoto nas saídas do passo', () => {
    const valid = run({});
    expect(valid.status, valid.out).toBe(0);
    expect(valid.outputs).toBe('retention=7\nremote=false\n');
    expect(run({ RETENTION_DAYS: '30' }).outputs).toBe('retention=30\nremote=false\n');
    const remote = run({ REMOTE: 'empresa:backups/crm', RCLONE_CONFIG_CONTENT: '[empresa]\ntype = drive' });
    expect(remote.status, remote.out).toBe(0);
    expect(remote.outputs).toBe('retention=7\nremote=true\n');
  });

  it.each([
    ['repositório público', { REPO_PRIVATE: 'false' }, 'Este repositório é público'],
    ['sem a conexão', { DB_URL: '' }, 'Falta o secret CRM_BACKUP_DB_URL'],
    ['sem a senha do arquivo', { ARCHIVE_PASSWORD: '' }, 'Falta o secret CRM_BACKUP_PASSWORD'],
    ['outro banco', { DB_URL: 'mysql://root:x@localhost/crm' }, 'precisa começar por postgresql://'],
    [
      'conexão direta',
      { DB_URL: 'postgresql://postgres:senha@db.abcdefghijabcdefghij.supabase.co:5432/postgres' },
      'é a conexão direta',
    ],
    [
      'senha com # sem código',
      { DB_URL: 'postgresql://postgres:p@ss#w@db.abcdefghijabcdefghij.supabase.co:5432/postgres' },
      'não é uma conexão válida',
    ],
    [
      'senha com ? sem código',
      { DB_URL: 'postgresql://postgres.abcdefghijabcdefghij:12?x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres' },
      'não é uma conexão válida',
    ],
    ['conexão ilegível', { DB_URL: 'postgresql://postgres:x@[abc/postgres' }, 'não é uma conexão válida'],
    ['senha curta', { ARCHIVE_PASSWORD: 'curta' }, 'pelo menos 16 caracteres'],
    ['retenção 0', { RETENTION_DAYS: '0' }, 'de 1 a 90'],
    ['retenção 91', { RETENTION_DAYS: '91' }, 'de 1 a 90'],
    ['retenção não numérica', { RETENTION_DAYS: 'abc' }, 'de 1 a 90'],
    ['remoto sem o rclone.conf', { REMOTE: 'empresa:backups/crm' }, 'falta o secret CRM_BACKUP_RCLONE_CONFIG'],
    ['rclone.conf sem o remoto', { RCLONE_CONFIG_CONTENT: '[empresa]' }, 'falta a variável CRM_BACKUP_REMOTE'],
  ])('recusa %s, sem gravar saída', (_label, overrides, message) => {
    const result = run(overrides);
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain(message);
    expect(result.outputs).toBe('');
  });
});
