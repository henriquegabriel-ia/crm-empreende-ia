import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeDealItems,
  contractMonthsError,
  DEAL_ITEM_BILLING_LABELS,
  dealItemDiscountLabel,
  dealItemDraft,
  dealItemLineSummary,
  dealItemsChanged,
  dealItemsPayload,
  dealValueBreakdown,
  formatQuantity,
  hasDealItems,
  parseContractMonths,
  parseDiscountPercent,
  parseQuantity,
  closedAtForDraft,
  closedDateKey,
  daysInStage,
  dealDraft,
  effectiveProbability,
  filterDeals,
  formatDealCurrency,
  isMovedDeal,
  nextDealActions,
  optimisticDealMove,
  parseDealValue,
  probabilityForSave,
  probabilityLabel,
  stageProbabilities,
  summarizeDeals,
  validateDealDraft,
  validateDealMove,
} from './deal-logic';
import { localDateKey } from './dates';
import type { CatalogProduct, Deal, DealActivity, DealItem, DealItemDraft, DealStage } from './deal-types';
import { DEAL_ITEM_MESSAGES } from './deal-item-math';
import itemCases from './deal-item-cases.json';
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
  it('exige valor válido e etapa pertencente ao funil, independente do nome', () => {
    const draft = { ...dealDraft(deal), value: '-10', stage_id: 'other' };
    expect(validateDealDraft(draft, stages)).toEqual({
      value: expect.any(String),
      stage_id: 'Escolha uma etapa deste funil.',
    });
    expect(validateDealDraft({ ...dealDraft(deal), pipeline_id: '' }, stages).pipeline_id).toBe('Selecione um funil.');
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
  it('não permite mover para outro funil ou organização', () => {
    expect(validateDealMove(deal, stages[2], 'open')).toBe('A etapa não pertence ao funil desta oportunidade.');
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
      outcome: null,
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

describe('movimentação otimista do kanban (item 0.10)', () => {
  const now = new Date('2026-10-11T12:00:00.000Z');
  it('troca a etapa e renova a entrada nela, mantendo a probabilidade manual e a versão lida', () => {
    const moved = optimisticDealMove(deal, 'proposal', 'open', null, now);
    expect(moved).toEqual({ ...deal, stage_id: 'proposal', stage_entered_at: now.toISOString() });
    expect(moved.updated_at).toBe(deal.updated_at);
    expect(optimisticDealMove(deal, 'qualify', 'open', null, now).stage_entered_at).toBe(deal.stage_entered_at);
  });
  it('segue as regras do banco para ganhar, perder e reabrir', () => {
    const won = optimisticDealMove(deal, 'qualify', 'won', null, now);
    expect(won).toMatchObject({ status: 'won', probability: 100, closed_at: now.toISOString(), lost_reason: null });
    const lost = optimisticDealMove(deal, 'qualify', 'lost', 'Preço', now);
    expect(lost).toMatchObject({ status: 'lost', probability: 0, closed_at: now.toISOString(), lost_reason: 'Preço' });
    const reopened = optimisticDealMove(lost, 'proposal', 'open', null, new Date('2026-10-12T09:00:00.000Z'));
    expect(reopened).toMatchObject({ status: 'open', probability: null, closed_at: null, lost_reason: null });
    // Mover uma ganha de etapa mantém o fechamento.
    expect(optimisticDealMove(won, 'proposal', 'won', null, new Date('2026-10-13T00:00:00Z')).closed_at).toBe(
      now.toISOString(),
    );
  });
  it('só aceita como resposta de move_deal a linha da mesma oportunidade', () => {
    expect(isMovedDeal({ ...deal, stage_id: 'proposal' }, 'deal-a')).toBe(true);
    expect(isMovedDeal({ ...deal }, 'outra')).toBe(false);
    expect(isMovedDeal(null, 'deal-a')).toBe(false);
    expect(isMovedDeal('ok', 'deal-a')).toBe(false);
    expect(isMovedDeal({ ...deal, status: 'arquivada' }, 'deal-a')).toBe(false);
    expect(isMovedDeal({ ...deal, value: '1000.00' }, 'deal-a')).toBe(false);
  });
});

// Achado 9 da revisão da Ajuda: a mesma coisa se chama "funil" nas telas e na Ajuda; "Pipeline" fica só como nome da tela
// do menu. Textos entre aspas e textos de JSX com a palavra pipeline (com espaço, para não pegar a chave da URL nem o
// caminho /pipeline) reprovam.
describe('funil, e não pipeline, nos textos de Relatórios e da oportunidade', () => {
  const read = (file: string) => readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const uiTexts = (source: string) => [
    ...[...source.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((match) => match[1] ?? match[2]),
    ...[...source.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]),
  ];
  it.each(['src/pages/Reports.tsx', 'src/lib/deal-logic.ts'])('%s não chama o funil de pipeline', (file) => {
    const offending = uiTexts(read(file)).filter((text) => /\bpipelines?\b/i.test(text) && /\s/.test(text.trim()));
    expect(offending).toEqual([]);
  });
  // Revisão do item 1.2: onde a palavra continua, ela é o nome da tela, com maiúscula ("Abrir o Pipeline", "Não foi
  // possível carregar o Pipeline"). Só textos de uma linha, para não pegar código entre ">" e "<".
  it('nenhuma tela escreve "pipeline" em minúscula num texto de interface', () => {
    const root = path.resolve(__dirname, '../..');
    const screens = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return screens(file);
        return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [file] : [];
      });
    const offending = screens(path.join(root, 'src')).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const texts = [
        ...[...source.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((match) => match[1] ?? match[2]),
        ...[...source.matchAll(/>([^<>{}\n]+)</g)].map((match) => match[1]),
      ];
      return texts
        .filter((text) => /\bpipelines?\b/.test(text) && /\s/.test(text.trim()))
        .map((text) => `${path.relative(root, file)}: ${text.trim()}`);
    });
    expect(offending).toEqual([]);
  });
});

// Item 1.16: itens da oportunidade. A tela confere o mesmo arquivo de casos que o test:db confere no banco
// (src/lib/deal-item-cases.json), digitando os valores no padrão brasileiro.
const brText = (decimal: string) => decimal.replace('.', ',');
const caseDraft = (item: (typeof itemCases.cases)[number]['items'][number], index: number): DealItemDraft => ({
  id: `item-${index}`,
  product_id: null,
  name: `Item ${index + 1}`,
  quantity: brText(item.quantity),
  unit: '',
  unit_price: brText(item.unitPrice),
  discount_type: item.discount ? (item.discount.type as 'percent' | 'amount') : 'none',
  discount_value: item.discount ? brText(item.discount.value) : '',
  billing: item.billing as 'one_time' | 'monthly',
});
const product = (overrides: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: 'product-a',
  org_id: 'org-a',
  name: 'Gestão de tráfego',
  code: 'GT-01',
  kind: 'service',
  unit: 'mês',
  price: 2000,
  billing: 'monthly',
  archived_at: null,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
  ...overrides,
});
const savedItem = (overrides: Partial<DealItem> = {}): DealItem => ({
  id: 'saved-1',
  org_id: 'org-a',
  deal_id: 'deal-a',
  product_id: null,
  position: 0,
  name: 'Implantação',
  quantity: 1.5,
  unit: 'hora',
  unit_price: 1500,
  discount_type: 'percent',
  discount_value: 12.5,
  billing: 'one_time',
  line_total: 1968.75,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
  ...overrides,
});

describe('itens da oportunidade (item 1.16)', () => {
  it.each(itemCases.cases.map((testCase) => [testCase.name, testCase] as const))(
    'paridade com o banco: %s',
    (_name, testCase) => {
      const result = computeDealItems(testCase.items.map(caseDraft), testCase.months);
      expect(result.valid).toBe(true);
      expect(result.lines.map((line) => line?.totalCents)).toEqual(testCase.items.map((item) => item.lineCents));
      expect(result.oneTimeCents).toBe(testCase.oneTimeCents);
      expect(result.monthlyCents).toBe(testCase.monthlyCents);
      expect(result.contractCents).toBe(testCase.contractCents);
    },
  );

  it.each(itemCases.refusals.map((refusal) => [refusal.name, refusal] as const))(
    'recusa como o banco: %s',
    (_name, refusal) => {
      const draft = caseDraft({ ...refusal.item, lineCents: 0 }, 0);
      const result = computeDealItems([draft], null);
      expect(result.valid).toBe(false);
      expect(result.errors[draft.id][refusal.field as 'quantity' | 'unit_price' | 'discount_value']).toBeTruthy();
    },
  );

  it('lê a quantidade no padrão brasileiro, até 3 casas', () => {
    expect(parseQuantity('1')).toBe(1000n);
    expect(parseQuantity('1,5')).toBe(1500n);
    expect(parseQuantity('0,125')).toBe(125n);
    expect(parseQuantity('1.500')).toBe(1_500_000n);
    expect(parseQuantity('1.500,25')).toBe(1_500_250n);
    expect(parseQuantity('1.5')).toBe(1500n);
    expect(parseQuantity(' 2 ')).toBe(2000n);
    for (const text of ['', '0', '0,000', '-1', '1e3', '1,2345', '1,2,3', '0.125', 'abc', '1.000.000.000'])
      expect(parseQuantity(text)).toBeNull();
    expect(parseQuantity('999.999.999,999')).toBe(999_999_999_999n);
  });

  it('lê o desconto em % e os meses do contrato', () => {
    expect(parseDiscountPercent('10')).toBe(1000n);
    expect(parseDiscountPercent('12,5')).toBe(1250n);
    expect(parseDiscountPercent('12,50%')).toBe(1250n);
    expect(parseDiscountPercent('100')).toBe(10000n);
    for (const text of ['0', '100,01', '12,555', '-5', ''] as const) expect(parseDiscountPercent(text)).toBeNull();
    expect(parseContractMonths('12')).toBe(12);
    expect(parseContractMonths(120)).toBe(120);
    for (const text of ['', '0', '121', '1,5', 'doze']) expect(parseContractMonths(text)).toBeNull();
  });

  it('exige meses só com item mensal e os ignora sem ele', () => {
    const monthly = { ...dealItemDraft(null, product()), id: 'm' };
    expect(computeDealItems([monthly], '').monthsError).toBe(DEAL_ITEM_MESSAGES.months);
    expect(contractMonthsError([monthly], '0')).toBe(DEAL_ITEM_MESSAGES.months);
    const ok = computeDealItems([monthly], '12');
    expect(ok).toMatchObject({ valid: true, months: 12, monthlyCents: 200000, contractCents: 2400000 });
    const oneTime = { ...monthly, billing: 'one_time' as const };
    expect(computeDealItems([oneTime], '')).toMatchObject({ valid: true, months: null, monthsError: null });
    expect(contractMonthsError([oneTime], '')).toBeNull();
  });

  it('dá os erros por campo nas palavras da RPC', () => {
    const draft: DealItemDraft = {
      ...dealItemDraft(null, null, 'x'),
      name: ' ',
      quantity: '0',
      unit: 'x'.repeat(21),
      unit_price: '1,005',
      discount_type: 'percent',
      discount_value: '101',
    };
    expect(computeDealItems([draft], null).errors.x).toEqual({
      name: DEAL_ITEM_MESSAGES.name,
      quantity: DEAL_ITEM_MESSAGES.quantity,
      unit: DEAL_ITEM_MESSAGES.unitTooLong,
      unit_price: DEAL_ITEM_MESSAGES.unitPrice,
      discount_value: DEAL_ITEM_MESSAGES.discountPercent,
    });
    const tooMany = Array.from({ length: 101 }, (_, index) => ({
      ...dealItemDraft(null, null, `i${index}`),
      name: 'A',
      unit_price: '1',
    }));
    expect(computeDealItems(tooMany, null).listError).toBe(DEAL_ITEM_MESSAGES.tooMany);
  });

  it('recusa produto arquivado num item novo e mantém no item que já o usava', () => {
    const archived = product({
      id: 'old',
      name: 'Produto antigo',
      archived_at: '2026-10-10T10:00:00Z',
      billing: 'one_time',
    });
    const fresh = { ...dealItemDraft(null, archived), id: 'novo' };
    expect(computeDealItems([fresh], null, { products: [archived] }).errors.novo?.product_id).toBe(
      DEAL_ITEM_MESSAGES.archived('Produto antigo'),
    );
    const kept = dealItemDraft(savedItem({ product_id: 'old' }));
    expect(
      computeDealItems([kept], null, { products: [archived], saved: [savedItem({ product_id: 'old' })] }).valid,
    ).toBe(true);
  });

  it('copia o item do catálogo e reabre o item gravado sem perder casas', () => {
    expect(dealItemDraft(null, product(), 'p')).toEqual({
      id: 'p',
      product_id: 'product-a',
      name: 'Gestão de tráfego',
      quantity: '1',
      unit: 'mês',
      unit_price: '2.000,00',
      discount_type: 'none',
      discount_value: '',
      billing: 'monthly',
    });
    const draft = dealItemDraft(savedItem());
    expect(draft).toMatchObject({ id: 'saved-1', quantity: '1,5', unit_price: '1.500,00', discount_value: '12,5' });
    expect(computeDealItems([draft], null).lines[0]?.totalCents).toBe(196875);
  });

  it('monta o pedido da RPC com textos decimais, posições e "desconto 0" sem desconto', () => {
    const drafts: DealItemDraft[] = [
      {
        ...dealItemDraft(null, null, 'a'),
        name: '  Hora   técnica ',
        quantity: '1,5',
        unit: ' hora ',
        unit_price: '1.500',
      },
      {
        ...dealItemDraft(null, null, 'b'),
        name: 'Kit',
        quantity: '2',
        unit_price: '10',
        discount_type: 'amount',
        discount_value: '0',
      },
      {
        ...dealItemDraft(null, null, 'c'),
        name: 'Pacote',
        unit_price: '99,9',
        discount_type: 'percent',
        discount_value: '12,5',
      },
    ];
    expect(dealItemsPayload(drafts)).toEqual([
      {
        id: 'a',
        product_id: null,
        position: 0,
        name: 'Hora técnica',
        quantity: '1.500',
        unit: 'hora',
        unit_price: '1500.00',
        discount_type: null,
        discount_value: null,
        billing: 'one_time',
      },
      {
        id: 'b',
        product_id: null,
        position: 1,
        name: 'Kit',
        quantity: '2.000',
        unit: null,
        unit_price: '10.00',
        discount_type: null,
        discount_value: null,
        billing: 'one_time',
      },
      {
        id: 'c',
        product_id: null,
        position: 2,
        name: 'Pacote',
        quantity: '1.000',
        unit: null,
        unit_price: '99.90',
        discount_type: 'percent',
        discount_value: '12.50',
        billing: 'one_time',
      },
    ]);
    expect(() => dealItemsPayload([{ ...drafts[0], quantity: '0' }])).toThrow(DEAL_ITEM_MESSAGES.quantity);
  });

  it('percebe quando os itens foram mexidos', () => {
    const saved = [savedItem()];
    const drafts = saved.map((item) => dealItemDraft(item));
    expect(dealItemsChanged(saved, null, drafts, '')).toBe(false);
    expect(dealItemsChanged(saved, null, [{ ...drafts[0], quantity: '2' }], '')).toBe(true);
    expect(dealItemsChanged(saved, null, [], '')).toBe(true);
    expect(dealItemsChanged(saved, null, [...drafts, dealItemDraft(null, null, 'novo')], '')).toBe(true);
    const monthly = [savedItem({ billing: 'monthly' })];
    const monthlyDrafts = monthly.map((item) => dealItemDraft(item));
    expect(dealItemsChanged(monthly, 12, monthlyDrafts, '12')).toBe(false);
    expect(dealItemsChanged(monthly, 12, monthlyDrafts, '6')).toBe(true);
  });

  it('detalha o valor e o total da linha em texto', () => {
    expect(hasDealItems({ item_count: 2 })).toBe(true);
    expect(hasDealItems({})).toBe(false);
    const base = { item_count: 2, one_time_value: 1500, monthly_value: 2000, contract_months: 12 };
    expect(dealValueBreakdown(base)).toBe('R$ 1.500,00 único + R$ 2.000,00/mês × 12 meses');
    expect(dealValueBreakdown({ ...base, one_time_value: 0 })).toBe('R$ 2.000,00/mês × 12 meses');
    expect(dealValueBreakdown({ ...base, monthly_value: 0, contract_months: null })).toBe('R$ 1.500,00 único');
    expect(dealValueBreakdown({ ...base, contract_months: 1 })).toContain('× 1 mês');
    expect(
      dealValueBreakdown({ item_count: 0, one_time_value: null, monthly_value: null, contract_months: null }),
    ).toBeNull();
    const draft = {
      ...dealItemDraft(null, null, 'l'),
      name: 'A',
      quantity: '2',
      unit_price: '500',
      discount_type: 'percent' as const,
      discount_value: '10',
    };
    const line = computeDealItems([draft], null).lines[0];
    expect(dealItemLineSummary(draft, line)).toBe('2 × R$ 500,00 − 10% = R$ 900,00');
    expect(
      dealItemLineSummary(
        { ...draft, discount_type: 'none' },
        computeDealItems([{ ...draft, discount_type: 'none' }], null).lines[0],
      ),
    ).toBe('2 × R$ 500,00 = R$ 1.000,00');
    expect(dealItemDiscountLabel({ discount_type: 'amount', discount_value: 50 })).toBe('R$ 50,00');
    expect(dealItemDiscountLabel({ discount_type: null, discount_value: 0 })).toBe('');
    expect(formatQuantity(1500)).toBe('1.500');
    expect(DEAL_ITEM_BILLING_LABELS).toEqual({ one_time: 'Única', monthly: 'Mensal' });
  });

  it('não exige o valor digitado quando a oportunidade tem itens', () => {
    const draft = { ...dealDraft(undefined, 'commercial', stages[0]), title: 'Com itens', value: '' };
    expect(validateDealDraft(draft, stages).value).toBeTruthy();
    expect(validateDealDraft(draft, stages, undefined, undefined, { hasItems: true }).value).toBeUndefined();
  });
});
