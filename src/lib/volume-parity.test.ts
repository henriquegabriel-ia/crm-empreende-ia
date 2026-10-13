import { describe, expect, it } from 'vitest';
import type { CrmSnapshot } from '@/hooks/useCrmSnapshot';
import type { CrmRow } from '@/integrations/supabase/commercial-types';
import {
  activityLinks,
  attentionQueue,
  NO_NEXT_ACTION_DIRECTORY_PATH,
  NO_NEXT_ACTION_GROUP_KEY,
  uniqueActivities,
  type Activity,
  type AttentionItem,
} from '@/lib/activity-logic';
import {
  contactName,
  nextAction,
  relatedData,
  relationshipIndex,
  type DirectoryKind,
  type RelationshipData,
} from '@/lib/contact-model';
import { generateVolumeData, VOLUME_NOW } from '../../scripts/lib/volume-data.mjs';

/**
 * Paridade do item 0.10 do roteiro: os índices Map devolvem exatamente o que as versões lineares O(n × m) devolviam.
 * As implementações anteriores ficam aqui, copiadas sem mudança, como referência.
 */
function legacyRelatedData(kind: DirectoryKind, id: string, data: RelationshipData) {
  const contactIds = new Set(
    kind === 'companies' ? data.contacts.filter((c) => c.company_id === id).map((c) => c.id) : [id],
  );
  const deals = data.deals.filter((d) =>
    kind === 'contacts' ? d.contact_id === id : d.company_id === id || (!!d.contact_id && contactIds.has(d.contact_id)),
  );
  const dealIds = new Set(deals.map((d) => d.id));
  const activities = data.activities.filter(
    (a) =>
      (kind === 'companies' && a.company_id === id) ||
      (!!a.contact_id && contactIds.has(a.contact_id)) ||
      (!!a.deal_id && dealIds.has(a.deal_id)),
  );
  return {
    deals,
    activities,
    next: nextAction(activities),
    contacts: data.contacts.filter((c) => contactIds.has(c.id)),
  };
}
function legacyAttentionQueue(data: RelationshipData & { riskRules: CrmRow<'risk_rules'>[] }, now: Date) {
  const items = new Map<string, AttentionItem>();
  function add(key: string, title: string, path: string, rule: CrmRow<'risk_rules'>, explanation: string) {
    const prior = items.get(key);
    const reason = { ruleId: rule.id, label: rule.name, explanation, priority: rule.priority };
    if (prior) {
      prior.reasons.push(reason);
      prior.priority = Math.min(prior.priority, rule.priority);
    } else items.set(key, { key, title, path, reasons: [reason], priority: rule.priority });
  }
  const pending = uniqueActivities(data.activities as Activity[]).filter((a) => a.type !== 'note' && !a.completed_at);
  const openDeals = data.deals.filter((d) => d.status === 'open');
  for (const rule of data.riskRules.filter((r) => r.enabled)) {
    if (rule.type === 'overdue')
      for (const a of pending.filter((a) => a.due_date && Date.parse(a.due_date) < now.getTime()))
        add(
          `activity:${a.id}`,
          a.title,
          `/activities?activity=${a.id}`,
          rule,
          'Atividade pendente com prazo anterior ao horário atual.',
        );
    if (rule.type === 'no_owner') {
      for (const a of pending.filter((a) => !a.user_id))
        add(
          `activity:${a.id}`,
          a.title,
          `/activities?activity=${a.id}`,
          rule,
          'Atividade pendente sem responsável definido.',
        );
      for (const c of data.contacts.filter((c) => !c.owner_id && c.status !== 'churned'))
        add(
          `contact:${c.id}`,
          contactName(c),
          `/contacts?contact=${c.id}`,
          rule,
          'Contato ativo sem responsável pelo relacionamento.',
        );
      for (const d of openDeals.filter((d) => !d.owner_id))
        add(`deal:${d.id}`, d.title, `/pipeline?deal=${d.id}`, rule, 'Oportunidade em aberto sem responsável.');
    }
    if (rule.type === 'no_next_action') {
      for (const c of data.contacts.filter((c) => c.status !== 'churned'))
        if (!legacyRelatedData('contacts', c.id, data).next)
          add(
            `contact:${c.id}`,
            contactName(c),
            `/contacts?contact=${c.id}`,
            rule,
            'Contato ativo sem atividade pendente com prazo, incluindo oportunidades vinculadas.',
          );
      for (const d of openDeals)
        if (!nextAction(data.activities.filter((a) => a.deal_id === d.id)))
          add(
            `deal:${d.id}`,
            d.title,
            `/pipeline?deal=${d.id}`,
            rule,
            'Oportunidade em aberto sem próxima ação com prazo vinculada diretamente a ela.',
          );
    }
    if (rule.type === 'stale_deal')
      for (const d of openDeals) {
        const last = Math.max(
          Date.parse(d.updated_at),
          ...data.activities.filter((a) => a.deal_id === d.id).map((a) => Date.parse(a.updated_at)),
        );
        if (now.getTime() - last >= Math.max(0, rule.threshold_days) * 86400_000)
          add(
            `deal:${d.id}`,
            d.title,
            `/pipeline?deal=${d.id}`,
            rule,
            `Oportunidade e atividades vinculadas sem atualização há pelo menos ${rule.threshold_days} dias.`,
          );
      }
  }
  return [...items.values()].sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'pt-BR'));
}
/** Filtro "Minha rotina" que o Dashboard aplicava depois da fila, com um find por item. */
function legacyMine(items: AttentionItem[], data: RelationshipData, userId: string | undefined) {
  return items.filter((item) => {
    const [entity, id] = item.key.split(':');
    if (entity === 'activity') return data.activities.find((a) => a.id === id)?.user_id === userId;
    if (entity === 'contact') return data.contacts.find((c) => c.id === id)?.owner_id === userId;
    return data.deals.find((d) => d.id === id)?.owner_id === userId;
  });
}
function legacyActivityLinks(
  activity: Pick<Activity, 'contact_id' | 'company_id' | 'deal_id'>,
  data: RelationshipData,
) {
  const links: { label: string; path: string }[] = [];
  const contact = data.contacts.find((c) => c.id === activity.contact_id);
  if (contact) links.push({ label: contactName(contact), path: `/contacts?contact=${contact.id}` });
  const company = data.companies.find((c) => c.id === activity.company_id);
  if (company) links.push({ label: company.name, path: `/companies?company=${company.id}` });
  const deal = data.deals.find((d) => d.id === activity.deal_id);
  if (deal) links.push({ label: deal.title, path: `/pipeline?deal=${deal.id}` });
  return links;
}

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = '11111111-1111-4111-8111-111111111111';
const COLLEAGUE = '22222222-2222-4222-8222-222222222222';
const STAGES = [
  { id: '66666666-6666-4666-8666-666666666666', pipeline_id: '55555555-5555-4555-8555-555555555555' },
  { id: '66666666-6666-4666-8666-666666666667', pipeline_id: '55555555-5555-4555-8555-555555555555' },
];
const NOW = new Date(VOLUME_NOW);
const RULE_IDS = {
  overdue: 'rule-overdue',
  no_owner: 'rule-owner',
  no_next_action: 'rule-next',
  stale_deal: 'rule-stale',
};
function snapshot(counts?: { companies: number; contacts: number; deals: number; activities: number }): CrmSnapshot {
  const volume = generateVolumeData({ orgId: ORG, ownerIds: [OWNER, COLLEAGUE], stages: STAGES, counts });
  return {
    ...volume,
    // Membros com a situação do papel (item 1.2), todos ativos: a regra do responsável desativado tem teste próprio em
    // activity-logic.test.ts, e a referência linear continua a anterior ao item.
    members: [
      { id: OWNER, name: 'Pessoa de Teste', email: 'owner@example.test', active: true, deactivatedAt: null },
      { id: COLLEAGUE, name: 'Colega de Teste', email: 'colega@example.test', active: true, deactivatedAt: null },
    ],
    riskRules: (['overdue', 'no_owner', 'no_next_action', 'stale_deal'] as const).map((type, i) => ({
      id: RULE_IDS[type],
      org_id: ORG,
      type,
      name: ['Atividades vencidas', 'Sem responsável', 'Sem próxima ação', 'Oportunidades paradas'][i],
      enabled: true,
      threshold_days: 7,
      priority: i === 0 ? 1 : 2,
      updated_at: VOLUME_NOW,
    })),
    pipelines: [],
    stages: [],
  } as unknown as CrmSnapshot;
}
const volume = snapshot();
// A fila linear do volume leva segundos: calculada uma vez e usada pelos dois testes que a comparam.
let volumeLegacyQueue: AttentionItem[] | undefined;
const legacyQueueOf = (data: CrmSnapshot) =>
  data === volume ? (volumeLegacyQueue ??= legacyAttentionQueue(volume, NOW)) : legacyAttentionQueue(data, NOW);
/** Volume pequeno com casos de borda: id repetido em objetos diferentes, o mesmo objeto duas vezes, datas inválidas. */
function edgeCases(): CrmSnapshot {
  const data = snapshot({ companies: 30, contacts: 120, deals: 60, activities: 400 });
  const [first, second] = data.activities;
  const deal = data.deals[0];
  const contact = data.contacts.find((c) => c.company_id) ?? data.contacts[0];
  data.activities.push(
    { ...first, title: 'Cópia com o mesmo id' },
    second,
    { ...second, id: 'invalid-date', due_date: 'não é data', completed_at: null, deal_id: deal.id },
    { ...second, id: 'note-due', type: 'note', due_date: VOLUME_NOW, completed_at: null, contact_id: contact.id },
    { ...second, id: 'unlinked', contact_id: null, company_id: null, deal_id: null },
  );
  data.deals.push({ ...deal, id: 'deal-without-links', contact_id: null, company_id: null, updated_at: 'inválida' });
  data.contacts.push({ ...contact, id: 'future-contact', created_at: '2030-01-01T00:00:00.000Z', company_id: null });
  return data;
}

describe('paridade dos índices Map com as versões lineares', () => {
  it('relatedData devolve o mesmo resultado, na mesma ordem, para cada contato e empresa do volume', () => {
    for (const data of [volume, edgeCases()]) {
      for (const contact of data.contacts)
        expect(relatedData('contacts', contact.id, data)).toEqual(legacyRelatedData('contacts', contact.id, data));
      for (const company of data.companies)
        expect(relatedData('companies', company.id, data)).toEqual(legacyRelatedData('companies', company.id, data));
      for (const id of ['', 'inexistente'])
        for (const kind of ['contacts', 'companies'] as const)
          expect(relatedData(kind, id, data)).toEqual(legacyRelatedData(kind, id, data));
    }
  }, 60_000);

  it('attentionQueue sem agrupamento nem carência é idêntica à anterior, para a organização e para "Minha rotina"', () => {
    for (const data of [volume, edgeCases()]) {
      const legacy = legacyQueueOf(data);
      expect(attentionQueue(data, NOW, { groupContactsAbove: Infinity, newContactGraceMs: 0 })).toEqual(legacy);
      for (const userId of [OWNER, COLLEAGUE, undefined])
        expect(
          attentionQueue(data, NOW, { audience: 'mine', userId, groupContactsAbove: Infinity, newContactGraceMs: 0 }),
        ).toEqual(legacyMine(legacy, data, userId));
    }
  }, 60_000);

  it('activityLinks acha os mesmos vínculos', () => {
    for (const data of [volume, edgeCases()])
      for (const activity of data.activities)
        expect(activityLinks(activity, data)).toEqual(legacyActivityLinks(activity, data));
  });

  it('o índice é montado uma vez por snapshot e refeito quando os dados mudam', () => {
    const data = edgeCases();
    const index = relationshipIndex(data);
    expect(relationshipIndex(data)).toBe(index);
    expect(relationshipIndex({ ...data })).not.toBe(index);
    data.activities.push({ ...data.activities[0], id: 'nova' });
    expect(relationshipIndex(data)).not.toBe(index);
  });
});

describe('fila de atenção com volume', () => {
  it('agrupa os contatos sem próxima ação, ignora os criados há menos de 1 dia e mantém o resto da fila igual', () => {
    const legacy = legacyQueueOf(volume);
    const isNew = (id: string) => {
      const contact = volume.contacts.find((c) => c.id === id)!;
      return NOW.getTime() - Date.parse(contact.created_at) < 86_400_000;
    };
    let grouped = 0;
    const expected = legacy
      .map((item) => {
        if (!item.key.startsWith('contact:')) return item;
        const reasons = item.reasons.filter((reason) => reason.ruleId !== RULE_IDS.no_next_action);
        if (reasons.length < item.reasons.length && !isNew(item.key.slice('contact:'.length))) grouped++;
        return { ...item, reasons, priority: Math.min(...reasons.map((reason) => reason.priority)) };
      })
      .filter((item) => item.reasons.length)
      .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'pt-BR'));
    const actual = attentionQueue(volume, NOW);
    const group = actual.find((item) => item.key === NO_NEXT_ACTION_GROUP_KEY)!;
    expect(grouped).toBeGreaterThan(1000);
    expect(group).toMatchObject({
      title: `${grouped.toLocaleString('pt-BR')} contatos sem próxima ação`,
      path: NO_NEXT_ACTION_DIRECTORY_PATH,
      group: { entity: 'contact', count: grouped },
      priority: 2,
    });
    expect(group.reasons.map((reason) => reason.ruleId)).toEqual([RULE_IDS.no_next_action]);
    expect(actual.filter((item) => item.key !== NO_NEXT_ACTION_GROUP_KEY)).toEqual(expected);
    // Os contatos importados no último dia não aparecem por falta de próxima ação.
    const recent = volume.contacts.filter((c) => isNew(c.id) && c.owner_id && c.status !== 'churned');
    expect(recent.length).toBeGreaterThan(100);
    expect(actual.some((item) => recent.some((c) => item.key === `contact:${c.id}`))).toBe(false);
  });

  it('"Minha rotina" agrupa só os contatos da pessoa', () => {
    const all = attentionQueue(volume, NOW).find((item) => item.key === NO_NEXT_ACTION_GROUP_KEY)!;
    const mine = attentionQueue(volume, NOW, { audience: 'mine', userId: OWNER }).find(
      (item) => item.key === NO_NEXT_ACTION_GROUP_KEY,
    )!;
    expect(mine.group!.count).toBeGreaterThan(0);
    expect(mine.group!.count).toBeLessThan(all.group!.count);
  });

  it('calcula a fila e os vínculos do diretório inteiro em bem menos de 1 s (antes, O(n × m) levava segundos)', () => {
    const data = snapshot();
    const started = performance.now();
    attentionQueue(data, NOW);
    for (const contact of data.contacts) relatedData('contacts', contact.id, data);
    for (const company of data.companies) relatedData('companies', company.id, data);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
