import { describe, expect, it } from 'vitest';
import type { CrmRow } from '@/integrations/supabase/commercial-types';
import { winsByOwner } from './report-wins';

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

// Item 1.14: "Ganhos por responsável" pela data de fechamento, com quem foi desativado depois de quem está ativo.
describe('ganhos por responsável', () => {
  const at = (month: number, day: number) => new Date(2026, month - 1, day, 12).toISOString();
  const won = (id: string, ownerId: string | null, value: number, closed: string, created = at(7, 1)) =>
    ({
      ...deal,
      id,
      owner_id: ownerId,
      status: 'won',
      probability: 100,
      value,
      created_at: created,
      closed_at: closed,
    }) as CrmRow<'deals'>;
  const people = [
    { id: 'ana', name: 'Ana Souza', email: 'ana@example.test', active: true },
    { id: 'bruno', name: 'Bruno Lima', email: 'bruno@example.test', active: true },
    { id: 'carla', name: 'Carla Dias', email: 'carla@example.test', active: false },
    { id: 'davi', name: 'Davi Reis', email: 'davi@example.test', active: true },
  ];
  const october = { from: '2026-10-01', to: '2026-10-31' };
  const deals = [
    won('ana-1', 'ana', 1000, at(10, 3)),
    won('ana-2', 'ana', 500.1, at(10, 20)),
    // Criada em agosto e ganha em outubro: conta em outubro.
    won('bruno-1', 'bruno', 2000, at(10, 9), at(8, 2)),
    // Ganha em setembro: fora de outubro, mesmo criada no mês.
    won('bruno-set', 'bruno', 9000, at(9, 30)),
    won('carla-1', 'carla', 5000, at(10, 15)),
    won('fora-da-equipe', 'saiu', 300, at(10, 16)),
    { ...won('aberta', 'davi', 7000, at(10, 1)), status: 'open', closed_at: null, probability: null },
    { ...won('perdida', 'davi', 8000, at(10, 1)), status: 'lost', lost_reason: 'Preço', probability: 0 },
  ];
  it('soma as ganhas no período pela data de fechamento, por responsável', () => {
    expect(winsByOwner(deals, people, october)).toEqual([
      { ownerId: 'bruno', label: 'Bruno Lima', won: 1, value: 2000, monthly: 0 },
      { ownerId: 'ana', label: 'Ana Souza', won: 2, value: 1500.1, monthly: 0 },
      { ownerId: 'carla', label: 'Carla Dias (desativado)', won: 1, value: 5000, monthly: 0 },
      { ownerId: 'saiu', label: 'Responsável indisponível', won: 1, value: 300, monthly: 0 },
    ]);
  });
  it('as abertas e as perdidas não contam, e o período vazio pega todas as ganhas', () => {
    const all = winsByOwner(deals, people);
    expect(all.map((row) => [row.ownerId, row.won, row.value])).toEqual([
      ['bruno', 2, 11000],
      ['ana', 2, 1500.1],
      ['carla', 1, 5000],
      ['saiu', 1, 300],
    ]);
    expect(winsByOwner(deals, people, { from: '2026-11-01' })).toEqual([]);
    expect(winsByOwner([], people, october)).toEqual([]);
  });
  it('empata pelo número de ganhas e depois pelo nome', () => {
    const tie = [won('d', 'davi', 100, at(10, 1)), won('a', 'ana', 100, at(10, 1)), won('b1', 'bruno', 50, at(10, 1))];
    tie.push(won('b2', 'bruno', 50, at(10, 2)));
    expect(winsByOwner(tie, people, october).map((row) => row.ownerId)).toEqual(['bruno', 'ana', 'davi']);
  });
  it('soma em centavos, sem erro de ponto flutuante', () => {
    const cents = [won('x', 'ana', 0.1, at(10, 1)), won('y', 'ana', 0.2, at(10, 1))];
    expect(winsByOwner(cents, people, october)[0].value).toBe(0.3);
  });
  // Item 1.16: com itens, o valor é o do contrato, e a mensalidade das ganhas vem ao lado, já contida no valor.
  it('soma a mensalidade das ganhas por responsável, sem mudar a ordem nem o valor', () => {
    const withItems = [
      {
        ...won('ana-contrato', 'ana', 25500, at(10, 4)),
        item_count: 2,
        one_time_value: 1500,
        monthly_value: 2000.1,
        contract_months: 12,
      },
      {
        ...won('ana-mensal', 'ana', 300, at(10, 5)),
        item_count: 1,
        one_time_value: 0,
        monthly_value: 100,
        contract_months: 3,
      },
      {
        ...won('aberta-mensal', 'ana', 900, at(10, 6)),
        status: 'open',
        closed_at: null,
        monthly_value: 300,
        contract_months: 3,
      },
      won('bruno-1', 'bruno', 2000, at(10, 9)),
    ] as CrmRow<'deals'>[];
    expect(winsByOwner(withItems, people, october)).toEqual([
      { ownerId: 'ana', label: 'Ana Souza', won: 2, value: 25800, monthly: 2100.1 },
      { ownerId: 'bruno', label: 'Bruno Lima', won: 1, value: 2000, monthly: 0 },
    ]);
  });
});
