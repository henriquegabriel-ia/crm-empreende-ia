import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CsvColumn } from '@/lib/csv';

type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => ({
  references: null as unknown,
  items: [] as Row[],
  products: [] as Row[],
  downloads: [] as { name: string; rows: Row[]; columns: CsvColumn<Row>[] }[],
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/components/shell/PageScaffold', () => ({
  PageScaffold: ({ actions, toolbar, children }: { actions?: ReactNode; toolbar?: ReactNode; children: ReactNode }) => (
    <main>
      {actions}
      {toolbar}
      {children}
    </main>
  ),
}));
vi.mock('@/components/operations/data', () => ({
  loadOperationReferences: async () => mocks.references,
  errorMessage: (error: { message?: string }) => error.message ?? 'Falha',
}));
vi.mock('@/components/pipeline/deal-items-data', () => ({
  loadAllDealItems: async () => mocks.items,
  loadProducts: async () => mocks.products,
}));
vi.mock('@/lib/csv', async (original) => ({
  ...(await original<typeof import('@/lib/csv')>()),
  downloadCsv: (name: string, rows: Row[], columns: CsvColumn<Row>[]) => mocks.downloads.push({ name, rows, columns }),
}));

import Reports from './Reports';

const won = (id: string, owner: string, value: number, monthly: number | null, months: number | null) => ({
  id,
  org_id: 'org-1',
  pipeline_id: 'p',
  stage_id: 's',
  title: `Contrato ${id}`,
  value,
  currency: 'BRL',
  owner_id: owner,
  status: 'won',
  probability: 100,
  lost_reason: null,
  close_date: null,
  created_at: '2026-10-01T12:00:00.000Z',
  closed_at: '2026-10-10T12:00:00.000Z',
  updated_at: '2026-10-10T12:00:00.000Z',
  item_count: monthly === null ? 0 : 2,
  one_time_value: monthly === null ? null : value - monthly * (months ?? 0),
  monthly_value: monthly,
  contract_months: months,
});

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Reports />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const csv = (download: (typeof mocks.downloads)[number]) => [
  download.columns.map((column) => column.header),
  ...download.rows.map((row) => download.columns.map((column) => String(column.value(row) ?? ''))),
];
async function openExport() {
  const trigger = await screen.findByRole('button', { name: /CSV/ });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => {
  mocks.downloads = [];
  mocks.items = [];
  mocks.products = [{ id: 'prod-1', code: 'GT-01', kind: 'service' }];
  mocks.references = {
    deals: [won('a', 'ana', 25350, 2000, 12), won('b', 'saiu', 900, null, null)],
    people: [
      { id: 'ana', full_name: 'Ana', active: true },
      { id: 'saiu', full_name: 'Fulano Vendedor', active: false },
    ],
    pipelines: [{ id: 'p', name: 'Comercial' }],
    stages: [{ id: 's', pipeline_id: 'p', name: 'Fechamento', order: 0, win_probability: 90 }],
    contacts: [],
    companies: [],
  };
});
afterEach(cleanup);

// Item 1.16: os Relatórios com o valor do contrato, a mensalidade e a planilha dos itens (docs/arquitetura/1.16.md,
// seção 6); achado 3 da revisão do 1.14.
describe('Relatórios com itens', () => {
  it('mostra "Mensalidades ganhas" e "inclui R$ X/mês × os meses" nos ganhos por responsável, sem dois parênteses', async () => {
    mount();
    // O rótulo do número (o nome se repete na explicação abaixo da faixa).
    const label = (await screen.findAllByText('Mensalidades ganhas')).find((el) =>
      el.classList.contains('eia-stat-label'),
    )!;
    expect(label.closest('div')!.parentElement).toHaveTextContent('R$ 2.000,00/mês');
    // A dica do StatStrip, cortada numa linha, fica curta; a explicação completa (o ganho soma a mensalidade vezes os
    // meses, e não a mensalidade uma vez) vem num parágrafo inteiro abaixo da faixa, sem corte.
    const hint = screen.getByText('Já incluídas no valor ganho');
    expect(hint.textContent!.length).toBeLessThanOrEqual(30);
    const explanation = screen.getByText(/cobram por mês\. O valor das ganhas já soma cada mensalidade × os meses/);
    expect(explanation).not.toHaveClass('truncate');
    expect(explanation).toHaveTextContent('Mensalidades ganhas é quanto as ganhas do período cobram por mês.');
    const wins = screen.getByRole('list', { name: 'Ganhos por responsável' });
    const rows = within(wins).getAllByRole('listitem');
    // O ponto é só visual (aria-hidden); o leitor de tela ouve a vírgula (sr-only).
    expect(rows[0]).toHaveTextContent('Ana · , 1 oportunidade');
    expect(rows[0].querySelector('[aria-hidden]')).toHaveTextContent('·');
    expect(rows[0]).toHaveTextContent('R$ 25.350,00inclui R$ 2.000,00/mês × os meses');
    expect(rows[1].textContent).toContain('Fulano Vendedor (desativado) · , 1 oportunidade');
    expect(rows[1].textContent).not.toContain(') (');
    expect(rows[1]).not.toHaveTextContent('inclui');
  });

  it('sem mensalidade nas ganhas, o número não aparece', async () => {
    mocks.references = { ...(mocks.references as Row), deals: [won('b', 'saiu', 900, null, null)] };
    mount();
    await screen.findByText('Ganhos por responsável');
    expect(screen.queryByText('Mensalidades ganhas')).not.toBeInTheDocument();
    expect(screen.queryByText(/cobram por mês/)).not.toBeInTheDocument();
  });

  it('a planilha das oportunidades ganha o total único, a mensalidade e os meses, vazios sem itens', async () => {
    mount();
    await openExport();
    await act(async () => fireEvent.click(await screen.findByRole('menuitem', { name: 'Oportunidades' })));
    const [header, first, second] = csv(mocks.downloads[0]);
    const at = (row: string[], name: string) => row[header.indexOf(name)];
    expect(header.slice(header.indexOf('Valor BRL'), header.indexOf('Valor BRL') + 4)).toEqual([
      'Valor BRL',
      'Total único BRL',
      'Mensalidade BRL',
      'Meses do contrato',
    ]);
    expect([at(first, 'Valor BRL'), at(first, 'Total único BRL'), at(first, 'Mensalidade BRL')]).toEqual([
      '25350,00',
      '1350,00',
      '2000,00',
    ]);
    expect(at(first, 'Meses do contrato')).toBe('12');
    expect([at(second, 'Total único BRL'), at(second, 'Mensalidade BRL'), at(second, 'Meses do contrato')]).toEqual([
      '',
      '',
      '',
    ]);
  });

  it('"Itens das oportunidades" baixa uma linha por item das oportunidades do recorte', async () => {
    mocks.items = [
      {
        id: 'i2',
        deal_id: 'a',
        product_id: 'prod-1',
        position: 1,
        name: 'Gestão de tráfego',
        quantity: 1,
        unit: 'mês',
        unit_price: 2000,
        discount_type: null,
        discount_value: 0,
        billing: 'monthly',
        line_total: 2000,
      },
      {
        id: 'i1',
        deal_id: 'a',
        product_id: null,
        position: 0,
        name: 'Implantação',
        quantity: 1.5,
        unit: null,
        unit_price: 1000,
        discount_type: 'amount',
        discount_value: 150,
        billing: 'one_time',
        line_total: 1350,
      },
      { id: 'fora', deal_id: 'outra', product_id: null, position: 0, name: 'Fora do recorte', billing: 'one_time' },
    ];
    mount();
    await openExport();
    await act(async () => fireEvent.click(await screen.findByRole('menuitem', { name: 'Itens das oportunidades' })));
    await waitFor(() => expect(mocks.downloads).toHaveLength(1));
    expect(mocks.downloads[0].name).toMatch(/itens-oportunidades.*\.csv$/);
    const [header, first, second] = csv(mocks.downloads[0]);
    expect(header).toEqual([
      'Oportunidade',
      'Funil',
      'Etapa',
      'Responsável',
      'Situação atual',
      'Fechada em',
      'Item',
      'Código',
      'Tipo',
      'Quantidade',
      'Unidade',
      'Preço unitário BRL',
      'Desconto',
      'Cobrança',
      'Total da linha BRL',
      'Meses do contrato',
    ]);
    expect(mocks.downloads[0].rows).toHaveLength(2);
    expect(first.slice(6)).toEqual([
      'Implantação',
      '',
      'Avulso',
      '1,5',
      '',
      '1000,00',
      'R$\u00a0150,00',
      'Única',
      '1350,00',
      '12',
    ]);
    expect(second.slice(6, 9)).toEqual(['Gestão de tráfego', 'GT-01', 'Serviço']);
  });

  it('sem itens no recorte, a opção fica desabilitada com o motivo', async () => {
    mocks.references = { ...(mocks.references as Row), deals: [won('b', 'saiu', 900, null, null)] };
    mount();
    await openExport();
    const option = await screen.findByRole('menuitem', { name: /Itens das oportunidades/ });
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(option).toHaveTextContent('Nenhuma oportunidade do recorte tem itens.');
  });
});
