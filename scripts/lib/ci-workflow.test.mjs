// Achado 2 da revisão do item 1.5 (docs/arquitetura/1.8.md, seção 13): o CI (.github/workflows/ci.yml) lido como YAML.
// O job restauracao (o critério de fechamento do 1.5) roda nos gatilhos do e2e, instala o cliente PostgreSQL 17, define
// CRM_PG_BIN e roda o ensaio com a comparação do CLI; a variável CRM_BASE_REPOSITORY chega aos jobs que rodam o test:db,
// o manifest:check e o ensaio (achado 3 da revisão do 1.13); e a Qualidade roda a suíte na ordem do AGENTS.md.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from './embedded-db.mjs';

const workflow = parse(readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
const runsOf = (job) => workflow.jobs[job].steps.map((step) => step.run ?? '').join('\n');

describe('CI (.github/workflows/ci.yml)', () => {
  it('o job restauracao existe, com os gatilhos do e2e', () => {
    const { restauracao, e2e } = workflow.jobs;
    expect(restauracao).toBeDefined();
    expect(restauracao.if).toBe(e2e.if);
    expect(restauracao.if).toContain("github.event_name == 'schedule'");
    expect(restauracao.if).toContain("github.base_ref == 'main'");
  });

  it('instala o postgresql-client-17, define CRM_PG_BIN e roda o ensaio com a comparação do CLI', () => {
    const runs = runsOf('restauracao');
    expect(runs).toContain('apt-get install -y -qq postgresql-client-17');
    expect(runs).toContain('echo "CRM_PG_BIN=/usr/lib/postgresql/17/bin" >> "$GITHUB_ENV"');
    const steps = workflow.jobs.restauracao.steps.map((step) => step.run ?? '');
    expect(steps.at(-1)).toBe('npm run test:restore -- --check-cli');
  });

  it('CRM_BASE_REPOSITORY chega aos jobs qualidade e restauracao, pela variável do repositório', () => {
    for (const job of ['qualidade', 'restauracao'])
      expect(workflow.jobs[job].env?.CRM_BASE_REPOSITORY, job).toBe('${{ vars.CRM_BASE_REPOSITORY }}');
  });

  it('a Qualidade roda a suíte do AGENTS.md, sem o E2E, na mesma ordem', () => {
    const commands = workflow.jobs.qualidade.steps.map((step) => step.run).filter((run) => run?.startsWith('npm '));
    expect(commands).toEqual([
      'npm ci',
      'npm run format:check',
      'npm run docs:links',
      'npm run lint:ci',
      'npm run typecheck',
      'npm test',
      'npm run test:db',
      'npm run gen:types:check',
      'npm run manifest:check',
      'npm run emails:check',
      'npm run build',
    ]);
    expect(runsOf('e2e')).toContain('npm run test:e2e');
  });
});
