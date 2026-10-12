import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { changedTables, CRM_QUERY_READS, invalidateCrmTables, readsChangedData } from './crm-cache';

const keys = {
  snapshot: ['crm', 'org', 'snapshot', 'user'],
  deals: ['crm', 'org', 'deals'],
  dealActions: ['crm', 'org', 'deal-actions'],
  references: ['crm', 'org', 'pipeline-references'],
  permissions: ['crm', 'org', 'permissions', 'user'],
  settings: ['crm', 'org', 'settings'],
  payments: ['crm', 'org', 'payments'],
  templates: ['crm', 'org', 'templates'],
  history: ['crm', 'org', 'deal-history', 'deal'],
  audit: ['crm', 'org', 'audit', 0],
  unknown: ['crm', 'org', 'consulta-nova'],
  other: ['outra-chave'],
};
function cacheWithAll() {
  const cache = new QueryClient();
  for (const key of Object.values(keys)) cache.setQueryData(key, []);
  return cache;
}
const invalidated = (cache: QueryClient) =>
  Object.entries(keys)
    .filter(([, key]) => cache.getQueryState(key)?.isInvalidated)
    .map(([name]) => name)
    .sort();

describe('invalidação por chave', () => {
  it('concluir uma atividade recarrega só o que lê atividades', async () => {
    const cache = cacheWithAll();
    await invalidateCrmTables(cache, ['activities']);
    expect(invalidated(cache)).toEqual(['audit', 'dealActions', 'snapshot', 'unknown']);
  });
  it('gravar oportunidade inclui o que o banco altera junto: histórico, tarefas e registros das automações', async () => {
    expect([...changedTables(['deals'])].sort()).toEqual([
      'activities',
      'audit_logs',
      'automation_logs',
      'deal_stage_history',
      'deals',
    ]);
    const cache = cacheWithAll();
    await invalidateCrmTables(cache, ['deals'], { keep: ['deals'] });
    expect(invalidated(cache)).toEqual(['audit', 'dealActions', 'history', 'snapshot', 'unknown']);
  });
  it('nunca invalida o papel da pessoa, Configurações ou chaves fora do CRM por uma gravação comum', async () => {
    const cache = cacheWithAll();
    await invalidateCrmTables(cache, ['contacts']);
    expect(invalidated(cache)).toEqual(['audit', 'references', 'snapshot', 'unknown']);
    const payments = cacheWithAll();
    await invalidateCrmTables(payments, ['payments']);
    expect(invalidated(payments)).toEqual(['audit', 'payments', 'unknown']);
    const templates = cacheWithAll();
    await invalidateCrmTables(templates, ['email_templates']);
    expect(invalidated(templates)).toEqual(['audit', 'templates', 'unknown']);
  });
  it('consulta sem tabelas declaradas é sempre invalidada; chaves de fora do CRM, nunca', () => {
    const changed = changedTables(['payments']);
    expect(readsChangedData(['crm', 'org', 'consulta-nova'], changed)).toBe(true);
    expect(readsChangedData(['outra', 'org', 'snapshot'], changed)).toBe(false);
    expect(readsChangedData(['crm', 'org', 'snapshot'], changedTables(['deals']), ['snapshot'])).toBe(false);
  });
  it('declara as tabelas de todas as consultas do CRM em uso', async () => {
    // Uma consulta nova sem declaração continua correta (é sempre invalidada), mas perde a invalidação por chave.
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const names = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
          for (const match of readFileSync(path, 'utf8').matchAll(/\['crm',\s*[\w?.!]+,\s*'([\w-]+)'/g))
            names.add(match[1]);
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(names.size).toBeGreaterThan(15);
    expect([...names].filter((name) => !CRM_QUERY_READS[name])).toEqual([]);
  });
});
