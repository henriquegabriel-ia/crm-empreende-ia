import { describe, expect, it } from 'vitest';
import {
  activitySummary,
  agendaDays,
  attentionQueue,
  NO_NEXT_ACTION_GROUP_ABOVE,
  NO_NEXT_ACTION_GROUP_KEY,
  dateKey,
  eventOverlapsDay,
  localDayBounds,
  matchesDate,
  parseLocalDay,
  rescheduledEnd,
  uniqueActivities,
  type Activity,
} from './activity-logic';
import type { CrmSnapshot } from '@/hooks/useCrmSnapshot';
const local = (day: number, hour = 0, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString();
const row = (id: string, extra: Partial<Activity> = {}): Activity => ({
  id,
  org_id: 'org',
  type: 'task',
  title: id,
  body: null,
  user_id: 'user',
  contact_id: null,
  company_id: null,
  deal_id: null,
  due_date: local(6, 10),
  end_date: null,
  completed_at: null,
  created_at: local(1),
  updated_at: local(1),
  created_by: 'user',
  ...extra,
});
describe('rotina: datas locais e contagem', () => {
  const now = new Date(2026, 8, 6, 12);
  it('inclui meia-noite local e exclui exatamente a próxima meia-noite', () => {
    expect(matchesDate(row('start', { due_date: local(6) }), 'today', now)).toBe(true);
    expect(matchesDate(row('end', { due_date: local(7) }), 'today', now)).toBe(false);
    expect(matchesDate(row('yesterday', { due_date: local(5, 23, 59) }), 'today', now)).toBe(false);
    expect(localDayBounds(now)).toEqual({ start: new Date(2026, 8, 6).getTime(), end: new Date(2026, 8, 7).getTime() });
  });
  it('distingue vencida agora de data futura, sem transformar sem data em vencida', () => {
    expect(matchesDate(row('a'), 'overdue', now)).toBe(true);
    expect(matchesDate(row('a', { due_date: local(6, 13) }), 'overdue', now)).toBe(false);
    expect(matchesDate(row('a', { due_date: null }), 'overdue', now)).toBe(false);
    expect(matchesDate(row('a', { due_date: local(7) }), 'upcoming', now)).toBe(true);
  });
  it('o mesmo ID em vários vínculos conta uma vez; nota não é tarefa; conclusão real entra no dia', () => {
    const shared = row('shared', { contact_id: 'contact', company_id: 'company', deal_id: 'deal' });
    const rows = [
      shared,
      shared,
      row('no-date', { due_date: null }),
      row('note', { type: 'note' }),
      row('completed', { completed_at: local(6, 11) }),
      row('future', { due_date: local(7, 10) }),
    ];
    const summary = activitySummary(rows, now);
    expect(uniqueActivities(rows)).toHaveLength(5);
    expect(summary.today.map((a) => a.id)).toEqual(['shared']);
    expect(summary.overdue.map((a) => a.id)).toEqual(['shared']);
    expect(summary.dayQueue.map((a) => a.id)).toEqual(['shared']);
    expect(summary.unscheduled.map((a) => a.id)).toEqual(['no-date']);
    expect(summary.completedToday.map((a) => a.id)).toEqual(['completed']);
    const completed = activitySummary([{ ...shared, completed_at: local(6, 12) }], now);
    expect(completed.dayQueue).toHaveLength(0);
    expect(completed.completedToday).toHaveLength(1);
  });
  it('parse de dia não aplica conversão UTC e rejeita datas impossíveis', () => {
    expect(dateKey(parseLocalDay('2026-09-06')!)).toBe('2026-09-06');
    expect(parseLocalDay('2026-02-30')).toBeNull();
    expect(parseLocalDay('2026-9-6')).toBeNull();
  });
});
describe('agenda: duração e navegação', () => {
  it('semana de domingo continua começando na segunda anterior, atravessando mês', () => {
    const days = agendaDays(new Date(2026, 8, 6), 'week');
    expect(days.map(dateKey)).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
  });
  it('reagendamento mantém duração e término posterior ao início', () => {
    const moved = rescheduledEnd({ due_date: local(6, 10), end_date: local(6, 11, 30) }, local(7, 14));
    expect(moved).toBe(local(7, 15, 30));
    expect(rescheduledEnd({ due_date: null, end_date: null }, local(7, 14))).toBe(local(7, 15));
  });
  it('evento que termina à meia-noite não aparece no dia seguinte; evento que atravessa aparece', () => {
    const day = new Date(2026, 8, 7);
    expect(eventOverlapsDay({ due_date: local(6, 23), end_date: local(7) }, day)).toBe(false);
    expect(eventOverlapsDay({ due_date: local(6, 23), end_date: local(7, 1) }, day)).toBe(true);
    expect(eventOverlapsDay({ due_date: local(7), end_date: local(7, 1) }, day)).toBe(true);
  });
});
describe('fila de atenção baseada em critérios reais', () => {
  const data = {
    contacts: [
      { id: 'contact', first_name: 'Ana', last_name: null, owner_id: null, status: 'lead' },
      { id: 'churned', first_name: 'Encerrado', owner_id: null, status: 'churned' },
    ],
    companies: [],
    members: [],
    pipelines: [],
    stages: [],
    deals: [
      {
        id: 'deal',
        title: 'Oportunidade',
        status: 'open',
        owner_id: null,
        contact_id: 'contact',
        updated_at: local(1),
        stage_entered_at: local(1),
      },
    ],
    activities: [row('action', { due_date: local(5), user_id: null, contact_id: 'contact', deal_id: 'deal' })],
    riskRules: [
      { id: 'r1', type: 'overdue', name: 'Vencida', enabled: true, priority: 1, threshold_days: 7 },
      { id: 'r2', type: 'no_owner', name: 'Sem responsável', enabled: true, priority: 2, threshold_days: 7 },
      { id: 'r3', type: 'no_next_action', name: 'Sem próxima ação', enabled: true, priority: 3, threshold_days: 7 },
      { id: 'r4', type: 'stale_deal', name: 'Parada', enabled: true, priority: 3, threshold_days: 3 },
    ],
  } as unknown as CrmSnapshot;
  it('agrupa múltiplos motivos por ID, exclui encerrados e cita por que o item entra', () => {
    const queue = attentionQueue(data, new Date(2026, 8, 6, 12));
    expect(queue.filter((item) => item.key === 'activity:action')).toHaveLength(1);
    expect(queue[0].reasons.map((r) => r.ruleId)).toEqual(['r1', 'r2']);
    expect(queue[0].priority).toBe(1);
    expect(queue.some((item) => item.key === 'contact:churned')).toBe(false);
    expect(queue.find((item) => item.key === 'deal:deal')?.reasons.map((r) => r.ruleId)).toEqual(['r2', 'r4']);
    expect(queue.find((item) => item.key === 'deal:deal')?.reasons[1].explanation).toContain('3 dias');
  });
  it('desativar regra remove motivo; atividade recente evita falso alerta de parada', () => {
    const next = {
      ...data,
      activities: data.activities.map((a) => ({ ...a, updated_at: local(6, 11) })),
      riskRules: data.riskRules.map((r) => ({ ...r, enabled: r.type === 'stale_deal' })),
    };
    expect(attentionQueue(next, new Date(2026, 8, 6, 12))).toEqual([]);
  });
});
describe('fila de atenção com muitos contatos sem próxima ação', () => {
  const now = new Date(2026, 8, 6, 12);
  const rules = [
    { id: 'r-next', type: 'no_next_action', name: 'Sem próxima ação', enabled: true, priority: 3, threshold_days: 7 },
    { id: 'r-overdue', type: 'overdue', name: 'Vencida', enabled: true, priority: 1, threshold_days: 7 },
  ];
  const person = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    first_name: `Pessoa ${id}`,
    last_name: null,
    owner_id: 'user',
    status: 'lead',
    created_at: local(1),
    ...extra,
  });
  const queueFor = (contacts: unknown[], activities: Activity[] = [], options = {}) =>
    attentionQueue(
      { contacts, companies: [], deals: [], activities, members: [], riskRules: rules } as unknown as CrmSnapshot,
      now,
      options,
    );
  it(`lista cada contato até ${NO_NEXT_ACTION_GROUP_ABOVE} e agrupa a partir daí, com link para o diretório filtrado`, () => {
    const ten = Array.from({ length: NO_NEXT_ACTION_GROUP_ABOVE }, (_, i) => person(`c${i}`));
    const listed = queueFor(ten);
    expect(listed).toHaveLength(10);
    expect(listed.every((item) => item.key.startsWith('contact:') && !item.group)).toBe(true);
    const grouped = queueFor([...ten, person('c10')], [row('late', { due_date: local(5) })]);
    expect(grouped.map((item) => item.key)).toEqual(['activity:late', NO_NEXT_ACTION_GROUP_KEY]);
    expect(grouped[1]).toMatchObject({
      title: '11 contatos sem próxima ação',
      path: '/contacts?scope=no-action',
      priority: 3,
      group: { entity: 'contact', count: 11 },
    });
    expect(grouped[1].reasons).toHaveLength(1);
    expect(grouped[1].reasons[0].explanation).toContain('há mais de 1 dia');
  });
  it('contatos cadastrados há menos de 1 dia, encerrados ou com próxima ação não contam', () => {
    const imported = Array.from({ length: 30 }, (_, i) => person(`new${i}`, { created_at: local(6, 1) }));
    expect(queueFor(imported)).toEqual([]);
    // Exatamente 1 dia depois do cadastro, o contato passa a contar.
    expect(queueFor([person('day', { created_at: local(5, 12) })]).map((item) => item.key)).toEqual(['contact:day']);
    const contacts = [
      ...imported,
      person('churned', { status: 'churned' }),
      person('busy'),
      person('old'),
      person('invalid-date', { created_at: 'sem data' }),
    ];
    const queue = queueFor(contacts, [row('next', { contact_id: 'busy', due_date: local(8) })]);
    expect(queue.map((item) => item.key).sort()).toEqual(['contact:invalid-date', 'contact:old']);
    // newContactGraceMs 0 desliga a carência; groupContactsAbove controla o agrupamento.
    expect(queueFor(imported, [], { newContactGraceMs: 0, groupContactsAbove: 50 })).toHaveLength(30);
    expect(queueFor(imported, [], { newContactGraceMs: 0 }).map((item) => item.group?.count)).toEqual([30]);
  });
  it('"Minha rotina" conta e lista só os registros da pessoa', () => {
    const mine = Array.from({ length: 4 }, (_, i) => person(`mine${i}`));
    const others = Array.from({ length: 20 }, (_, i) => person(`other${i}`, { owner_id: 'colleague' }));
    const activities = [
      row('my-late', { due_date: local(5) }),
      row('their-late', { due_date: local(5), user_id: 'x' }),
    ];
    const queue = queueFor([...mine, ...others], activities, { audience: 'mine', userId: 'user' });
    expect(queue.map((item) => item.key)).toEqual(['activity:my-late', ...mine.map((c) => `contact:${c.id}`)]);
    const all = queueFor([...mine, ...others], activities);
    expect(all.find((item) => item.group)?.group?.count).toBe(24);
    // Sem pessoa identificada, "Minha rotina" fica vazia em vez de mostrar os itens sem responsável.
    expect(queueFor([person('nobody', { owner_id: null })], [], { audience: 'mine', userId: undefined })).toEqual([]);
  });
  it('o item agrupado avisa o que o filtro de Contatos lista além da contagem', () => {
    const many = Array.from({ length: 12 }, (_, i) => person(`c${i}`));
    const team = queueFor(many)[0].reasons[0].explanation;
    expect(team).toContain('também lista os encerrados e os cadastrados nas últimas 24 horas');
    expect(team).not.toContain('toda a equipe');
    // Em "Minha rotina", a contagem é da pessoa, mas o link abre o filtro de toda a equipe.
    const mine = queueFor(many, [], { audience: 'mine', userId: 'user' })[0].reasons[0].explanation;
    expect(mine).toContain('sob sua responsabilidade');
    expect(mine).toContain('O link abre o filtro de toda a equipe');
  });
});
