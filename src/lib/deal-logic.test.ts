import { describe, expect, it } from 'vitest';
import {
  closedAtForDraft,
  closedDateKey,
  daysInStage,
  dealDraft,
  effectiveProbability,
  filterDeals,
  formatDealCurrency,
  nextDealActions,
  parseDealValue,
  probabilityForSave,
  probabilityLabel,
  stageProbabilities,
  summarizeDeals,
  validateDealDraft,
  validateDealMove,
} from './deal-logic';
import { localDateKey } from './dates';
import type { Deal, DealActivity, DealStage } from './deal-types';
import { nextAction, type RelationshipActivity } from './contact-model';

const stages: DealStage[] = [
  {
    id: 'qualify',
    org_id: 'org-a',
    pipeline_id: 'commercial',
    name: 'Qualificação',
    order: 0,
    win_probability: 20,
    color: null,
  },
  {
    id: 'proposal',
    org_id: 'org-a',
    pipeline_id: 'commercial',
    name: 'Proposta',
    order: 1,
    win_probability: 60,
    color: null,
  },
  {
    id: 'other',
    org_id: 'org-a',
    pipeline_id: 'other-pipeline',
    name: 'Outro funil',
    order: 0,
    win_probability: 0,
    color: null,
  },
];
const deal: Deal = {
  id: 'deal-a',
  org_id: 'org-a',
  pipeline_id: 'commercial',
  stage_id: 'qualify',
  title: 'Consultoria estratégica',
  value: 1000,
  currency: 'BRL',
  contact_id: null,
  company_id: null,
  owner_id: 'person-a',
  close_date: null,
  probability: 20,
  status: 'open',
  lost_reason: null,
  closed_at: null,
  stage_entered_at: '2026-09-01T10:00:00Z',
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};
const action = (overrides: Partial<DealActivity>): DealActivity => ({
  id: 'action-a',
  org_id: 'org-a',
  deal_id: 'deal-a',
  title: 'Retomar proposta',
  type: 'task',
  due_date: null,
  completed_at: null,
  user_id: 'person-a',
  ...overrides,
});

describe('validação de oportunidades', () => {
  it.each([
    ['0', 0],
    ['1500,25', 1500.25],
    ['12.5', 12.5],
    [' 7 ', 7],
    ['1.000,25', 1000.25],
    ['1.234', 1234],
    ['1.500,00', 1500],
    ['R$ 2.000', 2000],
    ['', null],
    ['-1', null],
    ['Infinity', null],
    ['1e6', null],
    ['1.2345', null],
    ['1,234,5', null],
    ['abc', null],
  ])('interpreta %s no padrão brasileiro sem arredondar ou inferir valor ambíguo', (input, expected) =>
    expect(parseDealValue(input)).toBe(expected),
  );
  it('edita o valor salvo no formato brasileiro e aceita a mesma digitação de volta', () => {
    expect(dealDraft({ ...deal, value: 1234.5 }).value).toBe('1.234,50');
    expect(dealDraft().value).toBe('0,00');
    expect(validateDealDraft({ ...dealDraft(deal), value: '1.234,50' }, stages)).toEqual({});
    expect(validateDealDraft({ ...dealDraft(deal), value: '1.2345' }, stages).value).toMatch(/1\.500,00/);
  });
  it('exibe reais com o mesmo formato da prévia e mantém outras moedas', () => {
    expect(formatDealCurrency(1500)).toBe('R$\u00a01.500,00');
    expect(formatDealCurrency(1500, 'USD')).toBe('US$\u00a01.500,00');
  });
  it('exige valor válido e etapa pertencente ao pipeline, independente do nome', () => {
    const draft = { ...dealDraft(deal), value: '-10', stage_id: 'other' };
    expect(validateDealDraft(draft, stages)).toEqual({ value: expect.any(String), stage_id: expect.any(String) });
    expect(
      validateDealDraft(
        dealDraft(deal),
        stages.map((stage) => ({ ...stage, name: 'Etapa renomeada' })),
      ),
    ).toEqual({});
  });
  it('exige responsável para ganho e motivo para perda', () => {
    expect(validateDealDraft({ ...dealDraft(deal), status: 'won', owner_id: '' }, stages).owner_id).toBeTruthy();
    expect(
      validateDealDraft({ ...dealDraft(deal), status: 'lost', lost_reason: '  ' }, stages).lost_reason,
    ).toBeTruthy();
    expect(
      validateDealDraft({ ...dealDraft(deal), status: 'lost', lost_reason: 'Prazo incompatível' }, stages),
    ).toEqual({});
  });
  it('rejeita probabilidades fora do intervalo e datas impossíveis', () => {
    expect(validateDealDraft({ ...dealDraft(deal), probability: '101', close_date: '2026-02-30' }, stages)).toEqual({
      probability: expect.any(String),
      close_date: expect.any(String),
    });
  });
});

describe('movimentação e filtros comerciais', () => {
  it('não permite mover para outro pipeline ou organização', () => {
    expect(validateDealMove(deal, stages[2], 'open')).toBeTruthy();
    expect(validateDealMove(deal, { ...stages[1], org_id: 'org-b' }, 'open')).toBeTruthy();
    expect(validateDealMove(deal, stages[1], 'open')).toBeNull();
  });
  it('aplica requisitos em ganho/perda e permite reabrir sem motivo', () => {
    expect(validateDealMove({ ...deal, owner_id: null }, stages[0], 'won')).toBeTruthy();
    expect(validateDealMove(deal, stages[0], 'lost')).toBeTruthy();
    expect(validateDealMove(deal, stages[0], 'lost', 'Concorrente escolhido')).toBeNull();
    expect(validateDealMove({ ...deal, status: 'lost' }, stages[0], 'open')).toBeNull();
  });
  it('compõe busca sem acentos, pipeline, responsável e situação', () => {
    const deals = [
      deal,
      { ...deal, id: 'b', owner_id: null },
      { ...deal, id: 'c', pipeline_id: 'other-pipeline' },
      { ...deal, id: 'd', status: 'won' as const },
    ];
    expect(
      filterDeals(deals, {
        pipelineId: 'commercial',
        ownerId: 'unassigned',
        status: 'open',
        search: 'ESTRATEGICA',
      }).map((item) => item.id),
    ).toEqual(['b']);
    expect(
      filterDeals(deals, { pipelineId: 'commercial', ownerId: 'person-a', status: 'all', search: '' }).map(
        (item) => item.id,
      ),
    ).toEqual(['deal-a', 'd']);
  });
  it('calcula apenas a moeda selecionada e separa ganho de valor em aberto', () => {
    const totals = summarizeDeals(
      [
        deal,
        { ...deal, id: 'b', value: 2000, probability: 50 },
        { ...deal, id: 'won', value: 3000, status: 'won' },
        { ...deal, id: 'lost', value: 4000, status: 'lost' },
        { ...deal, id: 'usd', value: 9999, currency: 'USD' },
      ],
      'BRL',
    );
    expect(totals).toEqual({
      count: 5,
      openCount: 3,
      openValue: 3000,
      weightedValue: 1200,
      wonValue: 3000,
      foreignCurrencyCount: 1,
    });
    expect(
      summarizeDeals(
        [
          { ...deal, value: 0.1 },
          { ...deal, value: 0.2 },
        ],
        'BRL',
      ).openValue,
    ).toBe(0.3);
  });
  it('usa a probabilidade da etapa quando a oportunidade não define uma', () => {
    expect(summarizeDeals([{ ...deal, probability: null }], 'BRL', stages).weightedValue).toBe(200);
    expect(summarizeDeals([{ ...deal, probability: 0 }], 'BRL', stages).weightedValue).toBe(0);
  });
  it('previsão ponderada acompanha a etapa depois de mover uma oportunidade que herda a probabilidade', () => {
    const inherited = { ...deal, probability: null };
    expect(summarizeDeals([inherited], 'BRL', stages).weightedValue).toBe(200);
    expect(summarizeDeals([{ ...inherited, stage_id: 'proposal' }], 'BRL', stages).weightedValue).toBe(600);
    expect(summarizeDeals([{ ...deal, probability: 35, stage_id: 'proposal' }], 'BRL', stages).weightedValue).toBe(350);
  });
  it('mede tempo pela entrada na etapa, sem negativos ou datas inventadas', () => {
    expect(daysInStage(deal.stage_entered_at, new Date('2026-09-06T10:00:00Z'))).toBe(5);
    expect(daysInStage('2026-10-01', new Date('2026-09-01'))).toBe(0);
    expect(daysInStage('invalid')).toBeNull();
  });
});

describe('probabilidade efetiva (D8)', () => {
  const probabilities = stageProbabilities(stages);
  it('herda a etapa quando a oportunidade não define e preserva valor manual, inclusive zero', () => {
    expect(effectiveProbability({ probability: null, stage_id: 'proposal' }, probabilities)).toBe(60);
    expect(effectiveProbability({ probability: 35, stage_id: 'proposal' }, probabilities)).toBe(35);
    expect(effectiveProbability({ probability: 0, stage_id: 'proposal' }, probabilities)).toBe(0);
    expect(effectiveProbability({ probability: null, stage_id: 'removida' }, probabilities)).toBe(0);
    expect(effectiveProbability({ probability: 140, stage_id: 'proposal' }, probabilities)).toBe(100);
  });
  it('mostra de onde vem a probabilidade', () => {
    expect(probabilityLabel({ probability: null, stage_id: 'proposal' }, probabilities)).toBe('60% (da etapa)');
    expect(probabilityLabel({ probability: 33.5, stage_id: 'proposal' }, probabilities)).toBe('33,5%');
    expect(probabilityLabel({ probability: 100, stage_id: 'qualify' }, probabilities)).toBe('100%');
  });
  it('grava NULL quando o campo fica vazio na aberta e 100 ou 0 pela situação', () => {
    expect(probabilityForSave({ probability: '', status: 'open' })).toBeNull();
    expect(probabilityForSave({ probability: '  ', status: 'open' })).toBeNull();
    expect(probabilityForSave({ probability: '30', status: 'open' })).toBe(30);
    expect(probabilityForSave({ probability: '', status: 'won' })).toBe(100);
    expect(probabilityForSave({ probability: '70', status: 'lost' })).toBe(0);
  });
  it('abre a criação e a edição sem copiar a probabilidade da etapa para a oportunidade', () => {
    expect(dealDraft(undefined, 'commercial', stages[1]).probability).toBe('');
    expect(dealDraft({ ...deal, probability: null }).probability).toBe('');
    expect(dealDraft({ ...deal, probability: 35 }).probability).toBe('35');
    expect(validateDealDraft({ ...dealDraft(deal), probability: '' }, stages)).toEqual({});
    expect(validateDealDraft({ ...dealDraft(deal), probability: '-1' }, stages).probability).toMatch(/em branco/);
  });
});

describe('data de fechamento', () => {
  const won: Deal = {
    ...deal,
    status: 'won',
    probability: 100,
    created_at: new Date(2026, 7, 10, 15).toISOString(),
    closed_at: new Date(2026, 9, 5, 16, 30).toISOString(),
  };
  it('abre a edição com o dia do fechamento no fuso local e sem data na aberta', () => {
    expect(dealDraft(won).closed_at).toBe('2026-10-05');
    expect(closedDateKey(won)).toBe('2026-10-05');
    expect(dealDraft(deal).closed_at).toBe('');
  });
  it('exige um dia entre a criação e hoje somente na oportunidade encerrada', () => {
    const today = '2026-10-11';
    const draft = dealDraft(won);
    expect(validateDealDraft(draft, stages, won, today)).toEqual({});
    expect(validateDealDraft({ ...draft, closed_at: '' }, stages, won, today).closed_at).toMatch(/Informe/);
    expect(validateDealDraft({ ...draft, closed_at: '2026-02-30' }, stages, won, today).closed_at).toMatch(/válida/);
    expect(validateDealDraft({ ...draft, closed_at: '2026-10-12' }, stages, won, today).closed_at).toMatch(/futuro/);
    expect(validateDealDraft({ ...draft, closed_at: '2026-08-09' }, stages, won, today).closed_at).toBe(
      'A data de fechamento não pode ser anterior à criação (10/08/2026).',
    );
    expect(validateDealDraft({ ...draft, closed_at: '2026-08-10' }, stages, won, today)).toEqual({});
    expect(validateDealDraft({ ...dealDraft(deal), closed_at: '' }, stages, deal, today)).toEqual({});
  });
  it('envia só um dia alterado, ao meio-dia local e dentro dos limites do banco', () => {
    const now = new Date(2026, 9, 11, 9);
    expect(closedAtForDraft(won, '2026-10-05', now)).toBeUndefined();
    expect(closedAtForDraft(deal, '2026-10-05', now)).toBeUndefined();
    expect(closedAtForDraft(won, '', now)).toBeUndefined();
    expect(closedAtForDraft(won, '2026-09-30', now)).toBe(new Date(2026, 8, 30, 12).toISOString());
    expect(localDateKey(new Date(closedAtForDraft(won, '2026-09-30', now)!))).toBe('2026-09-30');
    expect(closedAtForDraft(won, '2026-08-10', now)).toBe(won.created_at);
    expect(closedAtForDraft(won, '2026-10-11', now)).toBe(now.toISOString());
  });
  it('arredonda para cima a criação com microssegundos, como o PostgREST devolve', () => {
    const now = new Date(2026, 9, 11, 9);
    const created = new Date(2026, 7, 10, 18, 0, 0, 123);
    const precise = { ...won, created_at: created.toISOString().replace('Z', '456+00:00') };
    const sent = closedAtForDraft(precise, '2026-08-10', now)!;
    expect(sent).toBe(new Date(created.getTime() + 1).toISOString());
    expect(localDateKey(new Date(sent))).toBe('2026-08-10');
    const exact = { ...won, created_at: created.toISOString().replace('Z', '000+00:00') };
    expect(closedAtForDraft(exact, '2026-08-10', now)).toBe(created.toISOString());
  });
});

describe('próxima ação canônica', () => {
  it('prioriza a pendência mais antiga com prazo e exclui concluídas e notas', () => {
    const next = nextDealActions([
      action({ id: 'no-date' }),
      action({ id: 'future', due_date: '2026-10-01' }),
      action({ id: 'overdue', due_date: '2026-08-01' }),
      action({ id: 'done', due_date: '2026-01-01', completed_at: '2026-01-01' }),
      action({ id: 'note', type: 'note', due_date: '2025-01-01' }),
      action({ id: 'unlinked', deal_id: null }),
    ]);
    expect(next.size).toBe(1);
    expect(next.get(deal.id)?.id).toBe('overdue');
  });
  it('não apresenta como próxima ação uma tarefa sem prazo válido', () => {
    expect(nextDealActions([action({ id: 'no-date' }), action({ id: 'invalid-date', due_date: 'invalid' })]).size).toBe(
      0,
    );
    expect(
      nextDealActions([
        action({ id: 'invalid-date', due_date: 'invalid' }),
        action({ id: 'valid', due_date: '2026-10-01' }),
      ]).get(deal.id)?.id,
    ).toBe('valid');
  });
  it('concorda com a ficha 360 e desempata por ID, independente da ordem recebida', () => {
    const activities: RelationshipActivity[] = [
      action({ id: 'no-date' }),
      action({ id: 'z', due_date: '2026-10-01' }),
      action({ id: 'a', due_date: '2026-10-01' }),
    ].map((item) => ({
      ...item,
      body: null,
      company_id: null,
      contact_id: null,
      end_date: null,
      created_by: 'person-a',
      created_at: '2026-09-01',
      updated_at: '2026-09-01',
    }));
    expect(nextDealActions(activities).get(deal.id)?.id).toBe(nextAction(activities)?.id);
    expect(nextDealActions([...activities].reverse()).get(deal.id)?.id).toBe('a');
    expect(nextDealActions([activities[0]]).get(deal.id)?.id ?? null).toBe(nextAction([activities[0]]));
  });
  it('mantém uma próxima ação independente por oportunidade', () => {
    const next = nextDealActions([
      action({ id: 'a', due_date: '2026-10-01' }),
      action({ id: 'b', deal_id: 'deal-b', due_date: '2026-09-01' }),
    ]);
    expect([...next].map(([id, activity]) => [id, activity.id])).toEqual([
      ['deal-a', 'a'],
      ['deal-b', 'b'],
    ]);
  });
});
