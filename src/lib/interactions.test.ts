import { describe, expect, it } from 'vitest';
import {
  PENDING_LIMIT,
  PENDING_TTL_MS,
  byTimelineMoment,
  cleanPending,
  interactionTitle,
  lastInteraction,
  matchingPendingActivity,
  parsePendingList,
  pendingKey,
  pendingStorageKey,
  readPending,
  timelineMoment,
  serializePending,
  upsertPending,
  writePending,
  type PendingInteraction,
} from '@/lib/interactions';

const CONTACT = '11111111-1111-4111-8111-111111111111';
const OTHER_CONTACT = '11111111-1111-4111-8111-111111111112';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const DEAL = '33333333-3333-4333-8333-333333333333';
const OTHER_DEAL = '33333333-3333-4333-8333-333333333334';
const NOW = new Date(2026, 9, 13, 14, 5);
let counter = 0;
const newId = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++counter).padStart(12, '0')}`;

const at = (hour: number, minute = 0, dayOffset = 0) => new Date(2026, 9, 13 + dayOffset, hour, minute).toISOString();
function activity(fields: Record<string, unknown> = {}) {
  return {
    id: newId(),
    type: 'call',
    completed_at: null as string | null,
    due_date: at(16) as string | null,
    contact_id: CONTACT as string | null,
    company_id: COMPANY as string | null,
    deal_id: null as string | null,
    ...fields,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  } as unknown as Storage & { data: Map<string, string> };
}

describe('pendências "Para registrar"', () => {
  it('têm a chave da atividade de origem, ou do canal com o alvo e a oportunidade', () => {
    expect(pendingKey({ channel: 'call', activityId: DEAL, contactId: CONTACT })).toBe(`activity:${DEAL}`);
    expect(pendingKey({ channel: 'whatsapp', contactId: CONTACT, dealId: DEAL })).toBe(`whatsapp:${CONTACT}:${DEAL}`);
    expect(pendingKey({ channel: 'call', companyId: COMPANY })).toBe(`call:${COMPANY}:-`);
    expect(pendingStorageKey('org 1', 'pessoa/2')).toBe('empreende-crm:interactions:v1:org%201:pessoa%2F2');
  });

  it('abrir de novo o mesmo alvo atualiza a hora e mantém os ids (não duplica)', () => {
    const first = upsertPending([], { channel: 'whatsapp', contactId: CONTACT }, NOW, newId);
    const later = new Date(NOW.getTime() + 60_000);
    const again = upsertPending(first, { channel: 'whatsapp', contactId: CONTACT }, later, newId);
    expect(again).toHaveLength(1);
    expect(again[0]).toEqual({ ...first[0], openedAt: later.toISOString() });
    // Outro canal para o mesmo contato é outra interação.
    expect(upsertPending(again, { channel: 'call', contactId: CONTACT }, later, newId)).toHaveLength(2);
  });

  it('guardam até 10, a mais antiga sai, e expiram em 12 horas', () => {
    let items: PendingInteraction[] = [];
    for (let i = 0; i < 12; i += 1)
      items = upsertPending(
        items,
        { channel: 'call', contactId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}` },
        new Date(NOW.getTime() + i * 1000),
        newId,
      );
    expect(PENDING_LIMIT).toBe(10);
    expect(items).toHaveLength(10);
    expect(items.map((item) => item.contactId?.slice(-2))).toEqual([
      '11',
      '10',
      '09',
      '08',
      '07',
      '06',
      '05',
      '04',
      '03',
      '02',
    ]);
    const expired = cleanPending(items, NOW.getTime() + 11_000 + PENDING_TTL_MS);
    expect(expired).toEqual([]);
    expect(cleanPending(items, NOW.getTime() + 2000 + PENDING_TTL_MS)).toHaveLength(9);
  });

  it('guardam só ids, canal e hora: nenhum nome, telefone, e-mail ou texto', () => {
    const [item] = upsertPending([], { channel: 'email', contactId: CONTACT, dealId: DEAL }, NOW, newId);
    const polluted = { ...item, name: 'Ana Souza', phone: '+5511999990000', email: 'ana@example.com', text: 'Olá' };
    const raw = serializePending([polluted as PendingInteraction]);
    expect(Object.keys(JSON.parse(raw)[0]).sort()).toEqual(
      ['activityId', 'channel', 'companyId', 'contactId', 'dealId', 'id', 'key', 'nextId', 'openedAt'].sort(),
    );
    expect(raw).not.toMatch(/Ana|5511|example|Olá/);
  });

  it('descartam JSON inválido, formatos estranhos e campos que não são id', () => {
    expect(parsePendingList('{', NOW.getTime())).toEqual([]);
    expect(parsePendingList('{"a":1}', NOW.getTime())).toEqual([]);
    const [item] = upsertPending([], { channel: 'call', contactId: CONTACT }, NOW, newId);
    const raw = JSON.stringify([
      item,
      { ...item, key: 'x', channel: 'sms' },
      { ...item, key: 'y', id: 'não é id' },
      { ...item, key: 'z', contactId: '<script>' },
    ]);
    const parsed = parsePendingList(raw, NOW.getTime());
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual({ ...item, key: 'z', contactId: null });
  });

  it('com o armazenamento bloqueado, a leitura e a gravação não quebram a tela', () => {
    const blocked = () => {
      throw new DOMException('bloqueado', 'SecurityError');
    };
    expect(readPending(blocked, 'chave', NOW.getTime())).toEqual([]);
    expect(writePending(blocked, 'chave', [])).toBe(false);
    const full = memoryStorage();
    full.setItem = () => {
      throw new DOMException('cheio', 'QuotaExceededError');
    };
    const [item] = upsertPending([], { channel: 'call', contactId: CONTACT }, NOW, newId);
    expect(writePending(() => full, 'chave', [item])).toBe(false);
  });

  it('sobrevivem a recarregar: o que foi gravado é lido de volta, e a lista vazia apaga a chave', () => {
    const storage = memoryStorage();
    const items = upsertPending([], { channel: 'call', contactId: CONTACT }, NOW, newId);
    expect(writePending(() => storage, 'chave', items)).toBe(true);
    expect(readPending(() => storage, 'chave', NOW.getTime())).toEqual(items);
    writePending(() => storage, 'chave', []);
    expect(storage.data.has('chave')).toBe(false);
  });
});

describe('matchingPendingActivity', () => {
  const target = { channel: 'call' as const, contactId: CONTACT, companyId: COMPANY, dealId: DEAL };

  it('sugere a única ligação pendente do contato até o fim do dia', () => {
    const planned = activity({ deal_id: DEAL });
    expect(matchingPendingActivity([planned], target, NOW)).toEqual({ match: planned, count: 1 });
    // Vencida também conta (prazo até o fim de hoje), e sem oportunidade também.
    const overdue = activity({ due_date: at(9, 0, -2) });
    expect(matchingPendingActivity([overdue], target, NOW).match).toBe(overdue);
  });

  it('não sugere nenhuma com duas ou mais', () => {
    expect(matchingPendingActivity([activity(), activity()], target, NOW)).toEqual({ match: null, count: 2 });
  });

  it.each([
    ['nenhuma', []],
    ['outro tipo', [activity({ type: 'whatsapp' })]],
    ['outro contato', [activity({ contact_id: OTHER_CONTACT })]],
    ['outra oportunidade', [activity({ deal_id: OTHER_DEAL })]],
    ['prazo amanhã', [activity({ due_date: at(9, 0, 1) })]],
    ['sem prazo', [activity({ due_date: null })]],
    ['concluída', [activity({ completed_at: at(10) })]],
  ])('não sugere: %s', (_label, activities) => {
    expect(matchingPendingActivity(activities, target, NOW).match).toBeNull();
  });

  it('sem contato, usa a empresa e só as atividades da empresa sem contato', () => {
    const companyTarget = { channel: 'call' as const, companyId: COMPANY };
    const ofCompany = activity({ contact_id: null });
    const ofContact = activity();
    expect(matchingPendingActivity([ofCompany, ofContact], companyTarget, NOW)).toEqual({ match: ofCompany, count: 1 });
  });
});

describe('lastInteraction', () => {
  it('é a interação concluída mais recente, ignorando notas, tarefas e pendentes', () => {
    const call = activity({ completed_at: at(9) });
    const visit = activity({ type: 'visit', completed_at: at(11) });
    const note = activity({ type: 'note', completed_at: at(13) });
    const task = activity({ type: 'task', completed_at: at(12) });
    const pending = activity({ type: 'whatsapp' });
    expect(lastInteraction([call, visit, note, task, pending])).toBe(visit);
    expect(lastInteraction([note, task, pending])).toBeNull();
  });
});

describe('timelineMoment', () => {
  it('a interação concluída vale pela data do fato, e a pendente e a nota pela do cadastro', () => {
    // Uma ligação de ontem registrada hoje aparece ontem, como no "Último contato".
    const late = { id: 'late', type: 'call', completed_at: '2026-10-12T15:00:00Z', created_at: '2026-10-13T09:00:00Z' };
    const pending = { id: 'pending', type: 'whatsapp', completed_at: null, created_at: '2026-10-13T08:00:00Z' };
    const note = { id: 'note', type: 'note', completed_at: '2026-10-13T10:00:00Z', created_at: '2026-10-13T10:00:00Z' };
    expect(timelineMoment(late)).toBe('2026-10-12T15:00:00Z');
    expect(timelineMoment(pending)).toBe('2026-10-13T08:00:00Z');
    expect([late, pending, note].sort(byTimelineMoment).map((item) => item.id)).toEqual(['note', 'pending', 'late']);
  });
});

describe('interactionTitle', () => {
  it('dá o título do registro pelo canal', () => {
    expect(interactionTitle('call', 'Ana Souza')).toBe('Ligação para Ana Souza');
    expect(interactionTitle('whatsapp', 'Ana Souza')).toBe('WhatsApp para Ana Souza');
    expect(interactionTitle('email', 'Ana Souza', ' Proposta ')).toBe('E-mail para Ana Souza: Proposta');
    expect(interactionTitle('email', 'Ana Souza', '')).toBe('E-mail para Ana Souza');
    expect(interactionTitle('call', 'x'.repeat(300))).toHaveLength(200);
  });
});
