import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_LOG_COLUMNS,
  automationDraft,
  automationDueLabel,
  automationFields,
  automationScopeLabel,
  dateInRange,
  filterPayments,
  inReportPeriod,
  paymentDraft,
  paymentState,
  reportDateKey,
  summarizePayments,
  summarizeReport,
  validateAutomation,
  validatePayment,
  type Payment,
} from './operation-logic';
import type { CrmRow } from '@/integrations/supabase/commercial-types';
const payment: Payment = {
  id: 'payment',
  org_id: 'org',
  description: 'Consultoria estratégica',
  amount: 100,
  currency: 'BRL',
  status: 'pending',
  contact_id: null,
  company_id: null,
  deal_id: null,
  due_date: '2026-09-06',
  paid_at: null,
  created_at: '2026-09-01',
  updated_at: '2026-09-01',
};
const deal: CrmRow<'deals'> = {
  id: 'deal',
  org_id: 'org',
  pipeline_id: 'p',
  stage_id: 's',
  title: 'Contrato',
  value: 1000,
  currency: 'BRL',
  contact_id: null,
  company_id: null,
  owner_id: null,
  close_date: null,
  probability: null,
  status: 'open',
  lost_reason: null,
  closed_at: null,
  item_count: 0,
  one_time_value: null,
  monthly_value: null,
  contract_months: null,
  stage_entered_at: '2026-09-01',
  created_at: '2026-09-01',
  updated_at: '2026-09-01',
};
const stage: CrmRow<'pipeline_stages'> = {
  id: 's',
  org_id: 'org',
  pipeline_id: 'p',
  name: 'Proposta',
  order: 0,
  color: '#000000',
  win_probability: 60,
  created_at: '2026-09-01',
  updated_at: '2026-09-01',
};

describe('financeiro comercial', () => {
  it('diferencia vencimento de hoje, vencido, recebido e cancelado', () => {
    expect(paymentState(payment, '2026-09-06')).toBe('pending');
    expect(paymentState(payment, '2026-09-07')).toBe('overdue');
    expect(paymentState({ ...payment, status: 'paid' }, '2026-09-07')).toBe('paid');
    expect(paymentState({ ...payment, status: 'cancelled' }, '2026-09-07')).toBe('cancelled');
  });
  it('não conta cancelados/recebidos como valores a receber e soma centavos sem ruído', () => {
    expect(
      summarizePayments(
        [
          payment,
          { ...payment, amount: 0.1, status: 'paid' },
          { ...payment, amount: 0.2, status: 'paid' },
          { ...payment, amount: 50, status: 'cancelled' },
          { ...payment, amount: 25, due_date: '2026-09-01' },
        ],
        '2026-09-06',
      ),
    ).toEqual({ paid: 0.3, overdue: 25, pending: 100, cancelled: 50 });
  });
  it('aplica recorte por vencimento, busca sem acento, situação e moeda', () => {
    const filter = { from: '2026-09-01', to: '2026-09-06', status: 'overdue', search: 'ESTRATEGICA', currency: 'BRL' };
    expect(
      filterPayments(
        [
          payment,
          { ...payment, id: 'usd', currency: 'USD' },
          { ...payment, id: 'outside', due_date: '2026-08-31' },
          { ...payment, id: 'paid', status: 'paid' },
        ],
        filter,
        '2026-09-07',
      ).map((item) => item.id),
    ).toEqual(['payment']);
    expect(dateInRange('2026-09-06', '2026-09-06', '2026-09-06')).toBe(true);
  });
  it('exige valor maior que zero e data de recebimento para um lançamento recebido', () => {
    expect(validatePayment(paymentDraft(payment))).toBeNull();
    expect(validatePayment({ ...paymentDraft(payment), amount: '0' })).toMatch(/maior que zero/);
    expect(validatePayment({ ...paymentDraft(payment), status: 'paid' })).toMatch(/quando o valor foi recebido/);
    expect(validatePayment({ ...paymentDraft(payment), status: 'paid', paid_at: '2026-09-06T09:30' })).toBeNull();
  });
  it('aceita valores no padrão brasileiro e recusa formatos ambíguos', () => {
    for (const amount of ['1.200,50', '1.200', '1200,5', '12.5', 'R$ 2.000'])
      expect(validatePayment({ ...paymentDraft(payment), amount })).toBeNull();
    for (const amount of ['1.2345', '-1', 'abc', '1,234,5'])
      expect(validatePayment({ ...paymentDraft(payment), amount })).toMatch(/maior que zero, como 1\.500,00/);
  });
  it('edita o valor salvo no formato brasileiro', () => {
    expect(paymentDraft({ ...payment, amount: 1234.5 }).amount).toBe('1.234,50');
    expect(paymentDraft().amount).toBe('');
  });
  it('rejeita datas impossíveis e moeda fora do contrato BRL', () => {
    expect(validatePayment({ ...paymentDraft(payment), due_date: '2026-02-30' })).toMatch(/vencimento válida/);
    expect(validatePayment({ ...paymentDraft(payment), currency: 'USD' })).toMatch(/reais/);
  });
});

describe('relatórios sem indicadores inventados', () => {
  it('usa probabilidade da etapa somente quando negócio não define uma, preservando zero explícito', () => {
    const result = summarizeReport(
      [
        deal,
        { ...deal, id: 'b', probability: 0 },
        { ...deal, id: 'c', probability: 40 },
        { ...deal, id: 'won', status: 'won', value: 2000 },
        { ...deal, id: 'lost', status: 'lost', value: 500 },
      ],
      [stage],
    );
    expect(result).toEqual({
      open: 3,
      won: 1,
      lost: 1,
      openValue: 3000,
      wonValue: 2000,
      lostValue: 500,
      wonMonthly: 0,
      forecast: 1000,
      winRate: 50,
    });
  });
  it('não fabrica uma taxa de ganho quando não há negociações encerradas', () =>
    expect(summarizeReport([deal], [stage]).winRate).toBeNull());
  it('arredonda previsão ponderada uma vez após somar os centavos', () =>
    expect(
      summarizeReport(
        [
          { ...deal, value: 10.05, probability: 33 },
          { ...deal, value: 10.05, probability: 33 },
        ],
        [stage],
      ).forecast,
    ).toBe(6.63));
});

describe('relatórios pela data de fechamento', () => {
  // Datas locais: o período usa o dia no fuso do navegador, como a tela.
  const at = (month: number, day: number) => new Date(2026, month - 1, day, 12).toISOString();
  const august = { from: '2026-08-01', to: '2026-08-31' };
  const october = { from: '2026-10-01', to: '2026-10-31' };
  const wonInOctober: CrmRow<'deals'> = {
    ...deal,
    id: 'won-october',
    status: 'won',
    probability: 100,
    value: 5000,
    created_at: at(8, 10),
    closed_at: at(10, 5),
  };
  const lostInOctober: CrmRow<'deals'> = {
    ...deal,
    id: 'lost-october',
    status: 'lost',
    probability: 0,
    value: 700,
    lost_reason: 'Preço',
    created_at: at(8, 20),
    closed_at: at(10, 2),
  };
  const openFromAugust: CrmRow<'deals'> = { ...deal, id: 'open-august', created_at: at(8, 15) };
  const deals = [wonInOctober, lostInOctober, openFromAugust];
  it('conta a venda criada em agosto e ganha em outubro em outubro, e não em agosto', () => {
    expect(summarizeReport(deals, [stage], october)).toMatchObject({
      open: 0,
      won: 1,
      lost: 1,
      wonValue: 5000,
      lostValue: 700,
      winRate: 50,
    });
    expect(summarizeReport(deals, [stage], august)).toMatchObject({
      open: 1,
      won: 0,
      lost: 0,
      wonValue: 0,
      forecast: 600,
      winRate: null,
    });
  });
  it('posiciona ganhas e perdidas pelo fechamento e as em aberto pela criação', () => {
    expect(reportDateKey(wonInOctober)).toBe('2026-10-05');
    expect(reportDateKey(lostInOctober)).toBe('2026-10-02');
    expect(reportDateKey({ ...openFromAugust, closed_at: at(10, 5) })).toBe('2026-08-15');
    expect(deals.filter((item) => inReportPeriod(item, october.from, october.to)).map((item) => item.id)).toEqual([
      'won-october',
      'lost-october',
    ]);
    expect(deals.filter((item) => inReportPeriod(item)).length).toBe(3);
  });
  it('previsão ponderada usa a probabilidade da etapa atual quando a oportunidade não define uma', () => {
    const moved = { ...openFromAugust, stage_id: 'negociacao' };
    const stages = [stage, { ...stage, id: 'negociacao', win_probability: 80 }];
    expect(summarizeReport([openFromAugust], stages).forecast).toBe(600);
    expect(summarizeReport([moved], stages).forecast).toBe(800);
    expect(summarizeReport([{ ...moved, probability: 25 }], stages).forecast).toBe(250);
  });
  // Item 1.16: com itens, value é o valor do contrato; a mensalidade das ganhas no período vem à parte, já contida nele.
  it('soma as mensalidades das ganhas no período, sem contar abertas nem perdidas, e usa o valor do contrato', () => {
    const contract = { item_count: 2, one_time_value: 1500, monthly_value: 2000.1, contract_months: 12 };
    const result = summarizeReport(
      [
        { ...wonInOctober, ...contract, value: 25501.2 },
        {
          ...wonInOctober,
          id: 'won-2',
          item_count: 1,
          one_time_value: 0,
          monthly_value: 0.2,
          contract_months: 2,
          value: 0.4,
        },
        { ...lostInOctober, ...contract, value: 25501.2 },
        { ...openFromAugust, ...contract, created_at: at(10, 3), value: 25501.2, probability: 50 },
        { ...wonInOctober, id: 'won-september', ...contract, closed_at: at(9, 30), value: 25501.2 },
      ],
      [stage],
      october,
    );
    expect(result).toMatchObject({
      won: 2,
      wonValue: 25501.6,
      wonMonthly: 2000.3,
      openValue: 25501.2,
      forecast: 12750.6,
    });
    expect(summarizeReport(deals, [stage], october).wonMonthly).toBe(0);
  });
});

describe('automação de tarefas', () => {
  const draft = { name: 'Retorno', trigger_type: 'deal_created', task_title: 'Combinar próximo passo', due_days: '1' };
  it('aceita somente gatilhos implementados e prazos inteiros limitados', () => {
    expect(validateAutomation(draft)).toBeNull();
    expect(validateAutomation({ ...draft, trigger_type: 'send_whatsapp' })).toMatch(/gatilho válido/);
    expect(validateAutomation({ ...draft, due_days: '' })).toMatch(/inteiro/);
    expect(validateAutomation({ ...draft, due_days: 1.5 })).toMatch(/inteiro/);
    expect(validateAutomation({ ...draft, due_days: 366 })).toMatch(/inteiro/);
    expect(validateAutomation({ ...draft, due_days: 0 })).toBeNull();
  });
  const scopes = {
    pipelines: [
      { id: 'p1', name: 'Comercial' },
      { id: 'p2', name: 'Pós-venda' },
    ],
    stages: [
      { id: 's1', name: 'Proposta', pipeline_id: 'p1' },
      { id: 's2', name: 'Implantação', pipeline_id: 'p2' },
    ],
  };
  const moved = { ...draft, trigger_type: 'deal_moved', pipeline_id: 'p1', stage_id: 's1' };
  it('valida o filtro de funil e etapa do gatilho de mudança de etapa', () => {
    expect(validateAutomation(moved, scopes)).toBeNull();
    expect(validateAutomation({ ...moved, pipeline_id: '', stage_id: '' }, scopes)).toBeNull();
    expect(validateAutomation({ ...moved, stage_id: '' }, scopes)).toBeNull();
    expect(validateAutomation({ ...moved, pipeline_id: '' }, scopes)).toBe('Escolha o funil da etapa.');
    expect(validateAutomation({ ...moved, stage_id: 's2' }, scopes)).toMatch(/não pertence ao funil/);
    expect(validateAutomation({ ...moved, pipeline_id: 'removido', stage_id: '' }, scopes)).toMatch(
      /não está mais disponível/,
    );
    // Nos demais gatilhos o filtro é descartado ao gravar, então não bloqueia.
    expect(validateAutomation({ ...moved, trigger_type: 'deal_won', pipeline_id: '' }, scopes)).toBeNull();
  });
  it('grava funil e etapa só no gatilho de mudança de etapa e nunca mexe na situação', () => {
    expect(automationFields({ ...moved, name: '  Proposta  ', due_days: '3' })).toEqual({
      name: 'Proposta',
      trigger_type: 'deal_moved',
      task_title: 'Combinar próximo passo',
      due_days: 3,
      pipeline_id: 'p1',
      stage_id: 's1',
    });
    expect(automationFields({ ...moved, stage_id: '' })).toMatchObject({ pipeline_id: 'p1', stage_id: null });
    expect(automationFields({ ...moved, trigger_type: 'deal_created' })).toMatchObject({
      pipeline_id: null,
      stage_id: null,
    });
    expect(automationFields(moved)).not.toHaveProperty('is_active');
  });
  it('abre a edição com o filtro salvo e descreve o escopo em português', () => {
    const automation = {
      id: 'a1',
      org_id: 'org',
      name: 'Proposta enviada',
      trigger_type: 'deal_moved',
      is_active: true,
      task_title: 'Enviar proposta',
      due_days: 0,
      pipeline_id: 'p1',
      stage_id: 's1',
      created_by: null,
      created_at: '2026-10-01',
      updated_at: '2026-10-01',
    };
    expect(automationDraft(automation)).toEqual({
      name: 'Proposta enviada',
      trigger_type: 'deal_moved',
      task_title: 'Enviar proposta',
      due_days: '0',
      pipeline_id: 'p1',
      stage_id: 's1',
    });
    expect(automationDraft()).toMatchObject({
      trigger_type: 'deal_created',
      due_days: '1',
      pipeline_id: '',
      stage_id: '',
    });
    expect(automationScopeLabel(automation, scopes)).toBe('Ao entrar na etapa Proposta do funil Comercial');
    expect(automationScopeLabel({ ...automation, stage_id: null }, scopes)).toBe(
      'Em qualquer etapa do funil Comercial',
    );
    expect(automationScopeLabel({ ...automation, pipeline_id: null, stage_id: null }, scopes)).toBe(
      'Em qualquer etapa de qualquer funil',
    );
    expect(automationScopeLabel({ ...automation, trigger_type: 'deal_won' }, scopes)).toBeNull();
    expect(automationScopeLabel({ ...automation, stage_id: 'sumiu' }, scopes)).toBe(
      'Ao entrar na etapa indisponível do funil Comercial',
    );
  });
  it('descreve o prazo com a concordância certa', () => {
    expect(automationDueLabel(0)).toBe('no momento do evento');
    expect(automationDueLabel(1)).toBe('1 dia após o evento');
    expect(automationDueLabel(3)).toBe('3 dias após o evento');
  });
  it('lê os logs sem error_detail nem select=*, como o GRANT por coluna exige', () => {
    const columns = AUTOMATION_LOG_COLUMNS.split(',');
    expect(columns).not.toContain('error_detail');
    expect(columns).not.toContain('*');
    expect(columns).toEqual(expect.arrayContaining(['automation_name', 'error_message', 'status']));
  });
});
