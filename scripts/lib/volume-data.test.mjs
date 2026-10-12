import { describe, expect, it } from 'vitest';
import { createRandom, generateVolumeData, VOLUME_COUNTS, VOLUME_NOW } from './volume-data.mjs';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNERS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const STAGES = [
  { id: '66666666-6666-4666-8666-666666666666', pipeline_id: '55555555-5555-4555-8555-555555555555' },
  { id: '66666666-6666-4666-8666-666666666667', pipeline_id: '55555555-5555-4555-8555-555555555555' },
];
const base = { orgId: ORG, ownerIds: OWNERS, stages: STAGES };
const volume = generateVolumeData(base);
const DAY = 86_400_000;
const now = Date.parse(VOLUME_NOW);

describe('gerador de volume sintético', () => {
  it('gera 1 mil empresas, 5 mil contatos, 2 mil oportunidades e 15 mil atividades', () => {
    expect(VOLUME_COUNTS).toEqual({ companies: 1000, contacts: 5000, deals: 2000, activities: 15000 });
    expect(volume.companies).toHaveLength(1000);
    expect(volume.contacts).toHaveLength(5000);
    expect(volume.deals).toHaveLength(2000);
    expect(volume.activities).toHaveLength(15000);
  });

  it('é determinístico: mesma semente e mesmo instante geram as mesmas linhas; outra semente, outras', () => {
    const again = generateVolumeData(base);
    expect(JSON.stringify(again)).toBe(JSON.stringify(volume));
    const other = generateVolumeData({
      ...base,
      seed: 7,
      counts: { companies: 5, contacts: 5, deals: 5, activities: 5 },
    });
    const same = generateVolumeData({
      ...base,
      seed: 7,
      counts: { companies: 5, contacts: 5, deals: 5, activities: 5 },
    });
    expect(other).toEqual(same);
    expect(other.contacts[0].id).not.toBe(volume.contacts[0].id);
    const first = createRandom(1),
      second = createRandom(1);
    expect([first.next(), first.uuid()]).toEqual([second.next(), second.uuid()]);
  });

  it('usa ids únicos no formato UUID v4 e só a organização, os responsáveis e as etapas informados', () => {
    const ids = [...volume.companies, ...volume.contacts, ...volume.deals, ...volume.activities].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids.slice(0, 200))
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const rows = [...volume.companies, ...volume.contacts, ...volume.deals, ...volume.activities];
    expect(rows.every((row) => row.org_id === ORG)).toBe(true);
    const owners = new Set([null, ...OWNERS]);
    expect([...volume.companies, ...volume.contacts, ...volume.deals].every((row) => owners.has(row.owner_id))).toBe(
      true,
    );
    expect(volume.activities.every((row) => owners.has(row.user_id))).toBe(true);
    expect(
      volume.deals.every((deal) => STAGES.some((s) => s.id === deal.stage_id && s.pipeline_id === deal.pipeline_id)),
    ).toBe(true);
  });

  it('mantém a integridade dos vínculos', () => {
    const companies = new Set(volume.companies.map((c) => c.id));
    const contacts = new Map(volume.contacts.map((c) => [c.id, c]));
    const deals = new Set(volume.deals.map((d) => d.id));
    expect(volume.contacts.every((c) => c.company_id === null || companies.has(c.company_id))).toBe(true);
    expect(volume.deals.every((d) => d.contact_id === null || contacts.has(d.contact_id))).toBe(true);
    expect(volume.deals.every((d) => d.company_id === null || companies.has(d.company_id))).toBe(true);
    expect(volume.activities.every((a) => a.contact_id === null || contacts.has(a.contact_id))).toBe(true);
    expect(volume.activities.every((a) => a.company_id === null || companies.has(a.company_id))).toBe(true);
    expect(volume.activities.every((a) => a.deal_id === null || deals.has(a.deal_id))).toBe(true);
  });

  it('respeita as restrições do schema', () => {
    const emails = volume.contacts.map((c) => c.email.toLowerCase());
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails.every((email) => email.endsWith('@example.test'))).toBe(true);
    expect(volume.companies.every((c) => c.website.endsWith('.example.test'))).toBe(true);
    expect(volume.contacts.every((c) => ['lead', 'prospect', 'customer', 'churned'].includes(c.status))).toBe(true);
    expect(volume.contacts.every((c) => c.first_name.trim().length > 0)).toBe(true);
    for (const deal of volume.deals) {
      expect(['open', 'won', 'lost']).toContain(deal.status);
      expect(deal.closed_at === null).toBe(deal.status === 'open');
      if (deal.status === 'lost') expect(deal.lost_reason?.trim()).toBeTruthy();
      else expect(deal.lost_reason).toBeNull();
      if (deal.status === 'won') expect(deal.owner_id).not.toBeNull();
      if (deal.status === 'won') expect(deal.probability).toBe(100);
      if (deal.status === 'lost') expect(deal.probability).toBe(0);
      expect(deal.value).toBeGreaterThanOrEqual(0);
      expect(Math.round(deal.value * 100) / 100).toBe(deal.value);
      if (deal.closed_at) {
        expect(Date.parse(deal.closed_at)).toBeGreaterThanOrEqual(Date.parse(deal.created_at));
        expect(Date.parse(deal.closed_at)).toBeLessThanOrEqual(now);
      }
      expect(Date.parse(deal.stage_entered_at)).toBeGreaterThanOrEqual(Date.parse(deal.created_at));
    }
    for (const activity of volume.activities) {
      expect(['task', 'call', 'email', 'meeting', 'note']).toContain(activity.type);
      if (activity.end_date) {
        expect(activity.due_date).not.toBeNull();
        expect(Date.parse(activity.end_date)).toBeGreaterThan(Date.parse(activity.due_date));
      }
      if (activity.type === 'note') {
        expect(activity.completed_at).not.toBeNull();
        expect(activity.due_date).toBeNull();
      }
    }
    const rows = [...volume.companies, ...volume.contacts, ...volume.deals, ...volume.activities];
    expect(rows.every((row) => Date.parse(row.updated_at) >= Date.parse(row.created_at))).toBe(true);
    expect(rows.every((row) => Date.parse(row.created_at) <= now)).toBe(true);
  });

  it('cobre os casos difíceis das telas: importação recente, sem responsável e pendências vencidas, de hoje e futuras', () => {
    const recent = volume.contacts.filter((c) => now - Date.parse(c.created_at) < DAY);
    const lastWeek = volume.contacts.filter((c) => {
      const age = now - Date.parse(c.created_at);
      return age >= 2 * DAY && age <= 3 * DAY;
    });
    expect(recent).toHaveLength(500);
    expect(lastWeek.length).toBeGreaterThanOrEqual(1500);
    const linked = new Set([...volume.deals.map((d) => d.contact_id), ...volume.activities.map((a) => a.contact_id)]);
    expect([...recent, ...lastWeek].some((c) => linked.has(c.id))).toBe(false);
    expect(volume.contacts.filter((c) => !c.owner_id).length).toBeGreaterThan(300);
    const pending = volume.activities.filter((a) => !a.completed_at);
    expect(pending.filter((a) => a.due_date && Date.parse(a.due_date) < now).length).toBeGreaterThan(500);
    expect(pending.filter((a) => a.due_date && Date.parse(a.due_date) > now).length).toBeGreaterThan(1000);
    expect(pending.filter((a) => !a.due_date).length).toBeGreaterThan(100);
    expect(volume.deals.filter((d) => d.status === 'open').length).toBeGreaterThan(1000);
  });

  it('recusa parâmetros que gerariam linhas inválidas', () => {
    expect(() => generateVolumeData({ ...base, orgId: '' })).toThrow(/organização/);
    expect(() => generateVolumeData({ ...base, ownerIds: [] })).toThrow(/responsável/);
    expect(() => generateVolumeData({ ...base, stages: [] })).toThrow(/etapa/);
    expect(() => generateVolumeData({ ...base, now: 'ontem' })).toThrow(/referência/);
  });
});
