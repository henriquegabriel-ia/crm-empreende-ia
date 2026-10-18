import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal, DealItem } from '@/lib/deal-types';
import { DEAL_ITEM_MESSAGES } from '@/lib/deal-item-math';

const mocks = vi.hoisted(() => ({
  items: [] as DealItem[],
  save: vi.fn(),
  success: vi.fn(),
  // A leitura dos itens gravados: pronta, com erro ou ainda chegando.
  itemsState: 'ready' as 'ready' | 'error' | 'pending',
  itemsOptions: [] as { enabled: boolean; version?: string | null }[],
  refetch: vi.fn(),
}));
vi.mock('@/hooks/useDealItems', () => ({
  useDealItems: (_id: string, options: { enabled: boolean; version?: string | null }) => {
    mocks.itemsOptions.push(options);
    const ready = options.enabled && mocks.itemsState === 'ready';
    return {
      items: ready ? mocks.items : [],
      data: ready ? mocks.items : undefined,
      isPending: options.enabled && mocks.itemsState === 'pending',
      isSuccess: ready,
      isError: options.enabled && mocks.itemsState === 'error',
      missing: false,
      refetch: mocks.refetch,
    };
  },
}));
vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => ({ products: [], isPending: false, missing: false }),
}));
vi.mock('./deal-items-data', () => ({ saveDealWithItems: mocks.save }));
vi.mock('./data', () => ({ errorMessage: (error: { message?: string }) => error.message ?? 'Falha' }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: vi.fn() } }));

import { DealItemsSection } from './DealItemsSection';

const deal: Deal = {
  id: 'deal',
  org_id: 'org',
  pipeline_id: 'p',
  stage_id: 's',
  title: 'Contrato anual',
  value: 25350,
  currency: 'BRL',
  contact_id: null,
  company_id: null,
  owner_id: null,
  close_date: null,
  probability: null,
  status: 'open',
  lost_reason: null,
  closed_at: null,
  stage_entered_at: '2026-09-01T12:00:00.000Z',
  created_at: '2026-09-01T12:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000001+00:00',
  item_count: 2,
  one_time_value: 1350,
  monthly_value: 2000,
  contract_months: 12,
};
const item = (fields: Partial<DealItem> & { id: string; name: string }): DealItem => ({
  org_id: 'org',
  deal_id: 'deal',
  product_id: null,
  position: 0,
  quantity: 1,
  unit: null,
  unit_price: 0,
  discount_type: null,
  discount_value: 0,
  billing: 'one_time',
  line_total: 0,
  created_at: '2026-10-01T12:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000Z',
  ...fields,
});

function mount(current: Deal = deal, canWrite = true) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DealItemsSection deal={current} canWrite={canWrite} busy={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.itemsState = 'ready';
  mocks.itemsOptions = [];
  mocks.items = [
    item({
      id: 'i1',
      name: 'Implantação',
      unit: 'un',
      unit_price: 1500,
      discount_type: 'percent',
      discount_value: 10,
      line_total: 1350,
    }),
    item({ id: 'i2', name: 'Gestão de tráfego', position: 1, unit_price: 2000, billing: 'monthly', line_total: 2000 }),
  ];
});
afterEach(cleanup);

// Item 1.16: a seção "Itens" do painel da oportunidade (docs/arquitetura/1.16.md, seção 7.4).
describe('itens no painel da oportunidade', () => {
  it('lista os itens e os totais, só leitura para "Somente leitura"', () => {
    mount(deal, false);
    const list = screen.getByRole('list', { name: 'Itens da oportunidade' });
    expect(within(list).getByText('Implantação')).toBeInTheDocument();
    expect(within(list).getByText('R$ 2.000,00/mês')).toBeInTheDocument();
    expect(within(list).getByText(/1 un × R\$ 1\.500,00 · desconto de 10%/)).toBeInTheDocument();
    expect(screen.getByText('R$ 2.000,00/mês × 12 meses')).toBeInTheDocument();
    expect(screen.getByText('R$ 25.350,00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar itens' })).not.toBeInTheDocument();
  });

  it('sem itens, diz que o valor não vem de itens e oferece "Adicionar itens" a quem edita', () => {
    const noItems = {
      ...deal,
      value: 900,
      item_count: 0,
      one_time_value: null,
      monthly_value: null,
      contract_months: null,
    };
    mount(noItems);
    expect(
      screen.getByText(
        'Nenhum item. O valor desta oportunidade não é calculado por itens e pode ser mudado em “Editar”.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar itens' })).toBeInTheDocument();
    cleanup();
    mount(noItems, false);
    expect(screen.getByText('Nenhum item. O valor desta oportunidade não é calculado por itens.')).toBeInTheDocument();
  });

  it('lê os itens da versão da oportunidade mostrada, para a lista e o editor não serem de uma versão anterior', () => {
    mount();
    expect(mocks.itemsOptions.at(-1)).toEqual({ enabled: true, version: '2026-10-01T12:00:00.000001+00:00' });
  });

  it('enquanto os itens chegam, avisa e não oferece "Editar itens"', () => {
    mocks.itemsState = 'pending';
    mount();
    expect(screen.getByText('Carregando itens…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar itens' })).not.toBeInTheDocument();
  });

  it('se os itens não carregam, mostra o erro com "Tentar novamente" e não abre o editor', () => {
    mocks.itemsState = 'error';
    mount();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar os itens.');
    expect(screen.queryByRole('button', { name: 'Editar itens' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('"Editar itens" grava pela RPC sem os campos, com a versão lida ao abrir', async () => {
    mocks.save.mockResolvedValue({ deal, items: [], replayed: false });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Editar itens' }));
    fireEvent.change(screen.getAllByLabelText(/^Quantidade/)[0], { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar itens' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith({
      dealId: 'deal',
      version: '2026-10-01T12:00:00.000001+00:00',
      items: [
        expect.objectContaining({ id: 'i1', quantity: '2.000', discount_type: 'percent', discount_value: '10.00' }),
        expect.objectContaining({ id: 'i2', billing: 'monthly', position: 1 }),
      ],
      contractMonths: 12,
    });
    expect(mocks.success).toHaveBeenCalledWith('Itens salvos.');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Salvar itens' })).not.toBeInTheDocument());
  });

  it('no conflito, mostra a mensagem e mantém os itens preenchidos', async () => {
    mocks.save.mockRejectedValue({ code: 'P0001', message: DEAL_ITEM_MESSAGES.conflict });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Editar itens' }));
    fireEvent.change(screen.getAllByLabelText(/^Nome do item/)[0], { target: { value: 'Implantação completa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar itens' }));
    expect(await screen.findByText(DEAL_ITEM_MESSAGES.conflict)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Nome do item/)[0]).toHaveValue('Implantação completa');
  });
});
