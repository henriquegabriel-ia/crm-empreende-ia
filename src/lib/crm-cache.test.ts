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

describe('privacidade (item 1.10)', () => {
  it('as consultas novas declaram o que leem', () => {
    expect(CRM_QUERY_READS['privacy-actions']).toEqual(['privacy_actions']);
    expect(CRM_QUERY_READS['privacy-actions-page']).toEqual(['privacy_actions', 'contacts', 'profiles', 'user_roles']);
    expect(CRM_QUERY_READS['privacy-summary']).toEqual(['contacts', 'activities', 'deals', 'payments']);
    expect(CRM_QUERY_READS['organization-privacy']).toEqual(['organizations']);
  });
  it('excluir um contato atualiza o registro de privacidade (ON DELETE SET NULL); exportar não recarrega o snapshot', () => {
    expect(changedTables(['contacts']).has('privacy_actions')).toBe(true);
    expect(readsChangedData(['crm', 'org', 'privacy-actions', 'contact'], changedTables(['contacts']))).toBe(true);
    expect(readsChangedData(['crm', 'org', 'snapshot', 'user'], changedTables(['privacy_actions']))).toBe(false);
    expect(readsChangedData(['crm', 'org', 'privacy-actions-page', 0], changedTables(['privacy_actions']))).toBe(true);
    expect(readsChangedData(['crm', 'org', 'organization-privacy'], changedTables(['organizations']))).toBe(true);
    expect(readsChangedData(['crm', 'org', 'privacy-summary', 'contact'], changedTables(['payments']))).toBe(true);
  });
});

describe('lembretes do menu (item 1.12)', () => {
  it('recarregam com qualquer gravação que muda atividades, inclusive pelas automações, e só com elas', () => {
    expect(CRM_QUERY_READS.reminders).toEqual(['activities']);
    const key = ['crm', 'org', 'reminders', 'user', '2026-10-18'];
    expect(readsChangedData(key, changedTables(['activities']))).toBe(true);
    // Mover uma oportunidade pode criar a tarefa de uma automação (run_deal_automations).
    expect(readsChangedData(key, changedTables(['deals']))).toBe(true);
    expect(readsChangedData(key, changedTables(['contacts']))).toBe(false);
    expect(readsChangedData(key, changedTables(['email_templates']))).toBe(false);
  });
});

describe('invalidação por chave', () => {
  it('o nome da organização (variável {{organizacao}} dos modelos, item 1.9) recarrega só com a organização', () => {
    expect(CRM_QUERY_READS['organization-name']).toEqual(['organizations']);
    expect(readsChangedData(['crm', 'org', 'organization-name'], changedTables(['activities']))).toBe(false);
    expect(readsChangedData(['crm', 'org', 'organization-name'], changedTables(['organizations']))).toBe(true);
  });
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
