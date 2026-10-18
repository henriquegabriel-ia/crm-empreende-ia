import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localDateKey } from '@/lib/dates';
import type { CatalogProduct, DealItem } from '@/lib/deal-types';
import { DealForm } from './DealForm';
vi.mock('./data', () => ({ errorMessage: (error: Error) => error.message }));
// Item 1.16: o catálogo e os itens gravados vêm das consultas, trocadas aqui por valores fixos.
const hooks = vi.hoisted(() => ({
  products: [] as CatalogProduct[],
  items: [] as DealItem[],
  // A leitura dos itens gravados: pronta, com erro ou ainda chegando.
  itemsState: 'ready' as 'ready' | 'error' | 'pending',
  itemsOptions: [] as { enabled: boolean; version?: string | null }[],
  refetch: vi.fn(),
}));
vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => ({ products: hooks.products, isPending: false, missing: false }),
}));
vi.mock('@/hooks/useDealItems', () => ({
  useDealItems: (_id: string | undefined, options: { enabled: boolean; version?: string | null }) => {
    hooks.itemsOptions.push(options);
    const ready = options.enabled && hooks.itemsState === 'ready';
    return {
      items: ready ? hooks.items : [],
      data: ready ? hooks.items : undefined,
      isError: options.enabled && hooks.itemsState === 'error',
      isPending: options.enabled && hooks.itemsState === 'pending',
      missing: false,
      refetch: hooks.refetch,
    };
  },
}));
const pipeline = { id: 'p', org_id: 'org', name: 'Comercial', currency: 'BRL', is_default: true };
const stages = [
  { id: 's', org_id: 'org', pipeline_id: 'p', name: 'Proposta', order: 0, win_probability: 50, color: null },
];

describe('formulário de oportunidade', () => {
  it('o responsável não oferece desativados; o atual desativado aparece marcado, por último (item 1.2)', () => {
    const people = [
      { id: 'b', full_name: 'Bruno', active: false },
      { id: 'c', full_name: 'Carla' },
      { id: 'a', full_name: 'Ana', active: true },
    ];
    const deal = {
      id: 'd',
      org_id: 'org',
      pipeline_id: 'p',
      stage_id: 's',
      title: 'Contrato',
      value: 100,
      currency: 'BRL',
      contact_id: null,
      company_id: null,
      owner_id: 'b',
      close_date: null,
      probability: null,
      status: 'lost' as const,
      lost_reason: 'Preço',
      closed_at: '2026-10-01T12:00:00.000Z',
      stage_entered_at: '2026-09-01T12:00:00.000Z',
      created_at: '2026-09-01T12:00:00.000Z',
      updated_at: '2026-10-01T12:00:00.000Z',
    };
    const view = render(
      <DealForm
        deal={deal}
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={people}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const trigger = screen.getByLabelText(/^Responsável/);
    expect(trigger).toHaveTextContent('Bruno (desativado)');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Sem responsável',
      'Ana',
      'Carla',
      'Bruno (desativado)',
    ]);
    view.unmount();
    render(
      <DealForm
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={people}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText(/^Responsável/), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Sem responsável',
      'Ana',
      'Carla',
    ]);
  });
  it('preserva os campos em falha de gravação e permite tentar novamente', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Falha de conexão')).mockResolvedValueOnce(undefined);
    const close = vi.fn();
    render(
      <DealForm
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[]}
        onSave={save}
        onClose={close}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Nome da oportunidade/), { target: { value: 'Contrato anual' } });
    fireEvent.change(screen.getByLabelText(/Valor \(BRL\)/), { target: { value: '1250,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    await screen.findByText('Falha de conexão');
    expect(screen.getByLabelText(/Nome da oportunidade/)).toHaveValue('Contrato anual');
    expect(screen.getByLabelText(/Valor \(BRL\)/)).toHaveValue('1250,50');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('mostra a prévia em reais enquanto digita e grava o texto no padrão brasileiro', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <DealForm
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[]}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    const value = screen.getByLabelText(/Valor \(BRL\)/);
    fireEvent.change(value, { target: { value: '1.500' } });
    expect(screen.getByText('Prévia: R$ 1.500,00')).toBeVisible();
    fireEvent.change(value, { target: { value: '12.5' } });
    expect(screen.getByText('Prévia: R$ 12,50')).toBeVisible();
    fireEvent.change(value, { target: { value: '1.2345' } });
    expect(screen.getByText(/Formato não reconhecido/)).toBeVisible();
    expect(value).toHaveAccessibleDescription(/Formato não reconhecido/);
    fireEvent.change(value, { target: { value: 'R$ 1.500,00' } });
    fireEvent.change(screen.getByLabelText(/Nome da oportunidade/), { target: { value: 'Contrato anual' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ title: 'Contrato anual', value: 'R$ 1.500,00' });
  });
  it('abre a edição com o valor salvo em formato brasileiro', () => {
    render(
      <DealForm
        deal={{
          id: 'd',
          org_id: 'org',
          pipeline_id: 'p',
          stage_id: 's',
          title: 'Contrato',
          value: 2400,
          currency: 'BRL',
          contact_id: null,
          company_id: null,
          owner_id: null,
          close_date: null,
          probability: 50,
          status: 'open',
          lost_reason: null,
          closed_at: null,
          stage_entered_at: '2026-09-01T10:00:00Z',
          created_at: '2026-09-01T10:00:00Z',
          updated_at: '2026-09-01T10:00:00Z',
        }}
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Valor \(BRL\)/)).toHaveValue('2.400,00');
    expect(screen.getByText('Prévia: R$ 2.400,00')).toBeVisible();
  });
  it('probabilidade em branco usa a da etapa e um valor digitado vira manual', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <DealForm
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[]}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    const probability = screen.getByLabelText('Probabilidade (%)');
    expect(probability).toHaveValue(null);
    expect(probability).toHaveAccessibleDescription('Da etapa: 50%');
    fireEvent.change(probability, { target: { value: '30' } });
    expect(probability).toHaveAccessibleDescription('Valor desta oportunidade. Apague para usar a da etapa (50%).');
    fireEvent.change(probability, { target: { value: '' } });
    expect(probability).toHaveAccessibleDescription('Da etapa: 50%');
    fireEvent.change(screen.getByLabelText(/Nome da oportunidade/), { target: { value: 'Contrato anual' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ probability: '', closed_at: '' });
    expect(screen.queryByLabelText(/Fechada em/)).toBeNull();
  });
  it('edita a data de fechamento da oportunidade ganha, sem aceitar dia futuro', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const created = new Date(2026, 7, 10, 15).toISOString();
    render(
      <DealForm
        deal={{
          id: 'd',
          org_id: 'org',
          pipeline_id: 'p',
          stage_id: 's',
          title: 'Contrato ganho',
          value: 2400,
          currency: 'BRL',
          contact_id: null,
          company_id: null,
          owner_id: 'owner',
          close_date: null,
          probability: 100,
          status: 'won',
          lost_reason: null,
          closed_at: new Date(2026, 9, 5, 16).toISOString(),
          stage_entered_at: created,
          created_at: created,
          updated_at: created,
        }}
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[{ id: 'owner', full_name: 'Pessoa' }]}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Probabilidade (%)')).toBeDisabled();
    expect(screen.getByLabelText('Probabilidade (%)')).toHaveAccessibleDescription('Definida pela situação: 100%.');
    const closedAt = screen.getByLabelText('Fechada em *');
    expect(closedAt).toHaveAccessibleDescription(
      /Dia real em que a oportunidade foi ganha, que pode diferir da previsão/,
    );
    expect(closedAt).toHaveValue('2026-10-05');
    expect(closedAt).toHaveAttribute('min', '2026-08-10');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    fireEvent.change(closedAt, { target: { value: localDateKey(tomorrow) } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('A data de fechamento não pode estar no futuro.')).toBeVisible();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(closedAt, { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ closed_at: '2026-09-30', probability: '100' });
  });
  it('não grava um valor inválido e explica o campo que precisa ser corrigido', async () => {
    const save = vi.fn();
    render(
      <DealForm
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[]}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Nome da oportunidade/), { target: { value: 'Contrato anual' } });
    fireEvent.change(screen.getByLabelText(/Valor \(BRL\)/), { target: { value: '-99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    expect(await screen.findByText(/Informe um valor positivo ou zero/)).toBeVisible();
    expect(save).not.toHaveBeenCalled();
  });
});

// Item 1.16: itens da oportunidade no formulário (docs/arquitetura/1.16.md, seção 7.3).
describe('formulário de oportunidade com itens', () => {
  afterEach(() => {
    hooks.itemsState = 'ready';
    hooks.itemsOptions = [];
    hooks.refetch.mockClear();
  });
  const product: CatalogProduct = {
    id: 'prod-1',
    org_id: 'org',
    name: 'Gestão de tráfego',
    code: 'GT-01',
    kind: 'service',
    unit: 'mês',
    price: 2000,
    billing: 'monthly',
    archived_at: null,
    created_at: '2026-10-01T12:00:00.000Z',
    updated_at: '2026-10-01T12:00:00.000Z',
  };
  const baseDeal = {
    id: 'd',
    org_id: 'org',
    pipeline_id: 'p',
    stage_id: 's',
    title: 'Contrato',
    currency: 'BRL',
    contact_id: null,
    company_id: null,
    owner_id: null,
    close_date: null,
    probability: null,
    status: 'open' as const,
    lost_reason: null,
    closed_at: null,
    stage_entered_at: '2026-09-01T12:00:00.000Z',
    created_at: '2026-09-01T12:00:00.000Z',
    updated_at: '2026-10-01T12:00:00.000Z',
  };
  const itemDeal = {
    ...baseDeal,
    value: 1500,
    item_count: 1,
    one_time_value: 1500,
    monthly_value: 0,
    contract_months: null,
  };
  const savedItem: DealItem = {
    id: 'item-1',
    org_id: 'org',
    deal_id: 'd',
    product_id: null,
    position: 0,
    name: 'Implantação',
    quantity: 2,
    unit: 'un',
    unit_price: 750,
    discount_type: null,
    discount_value: 0,
    billing: 'one_time',
    line_total: 1500,
    created_at: '2026-10-01T12:00:00.000Z',
    updated_at: '2026-10-01T12:00:00.000Z',
  };
  const renderForm = (deal?: Parameters<typeof DealForm>[0]['deal'], save = vi.fn().mockResolvedValue(undefined)) => {
    render(
      <DealForm
        deal={deal}
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[]}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    return save;
  };
  const fillItem = (name: string, quantity: string, price: string) => {
    fireEvent.change(screen.getAllByLabelText(/^Nome do item/).at(-1)!, { target: { value: name } });
    fireEvent.change(screen.getAllByLabelText(/^Quantidade/).at(-1)!, { target: { value: quantity } });
    fireEvent.change(screen.getAllByLabelText(/^Preço unitário/).at(-1)!, { target: { value: price } });
  };

  it('com itens, o valor vira o do contrato, só leitura, e a criação manda a lista com o mesmo id nas tentativas', async () => {
    hooks.products = [product];
    hooks.items = [];
    const save = renderForm(
      undefined,
      vi.fn().mockRejectedValueOnce(new Error('Falha de conexão')).mockResolvedValue(undefined),
    );
    fireEvent.change(screen.getByLabelText(/Nome da oportunidade/), { target: { value: 'Contrato anual' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar itens' }));
    expect(screen.queryByLabelText(/Valor \(BRL\)/)).not.toBeInTheDocument();
    fillItem('Implantação', '1', '1.500,00');
    fireEvent.change(screen.getByLabelText('Desconto'), { target: { value: 'percent' } });
    fireEvent.change(screen.getByLabelText('Desconto (%)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item' }));
    // O foco vai ao seletor do item novo.
    await waitFor(() => expect(document.activeElement).toHaveAttribute('role', 'combobox'));
    fillItem('Mensalidade', '1', '2.000,00');
    fireEvent.change(screen.getAllByLabelText('Cobrança').at(-1)!, { target: { value: 'monthly' } });
    // Sem os meses, o contrato não é salvo: o campo é obrigatório com item mensal, sem valor sugerido.
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    expect(await screen.findByText('Informe por quantos meses o contrato vale, de 1 a 120.')).toBeVisible();
    expect(save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText(/Meses do contrato/));
    fireEvent.change(screen.getByLabelText(/Meses do contrato/), { target: { value: '12' } });
    // R$ 1.350,00 único + R$ 2.000,00 × 12 = R$ 25.350,00.
    expect(screen.getByText('Valor do contrato (BRL)').parentElement).toHaveTextContent('R$ 25.350,00');
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    expect(await screen.findByText('Falha de conexão')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const [first, second] = save.mock.calls.map((call) => call[1]);
    expect(first.newDealId).toBe(second.newDealId);
    expect(second).toMatchObject({ contractMonths: 12, hadItems: false });
    expect(second.items).toEqual([
      expect.objectContaining({
        name: 'Implantação',
        quantity: '1.000',
        unit_price: '1500.00',
        discount_type: 'percent',
        discount_value: '10.00',
        billing: 'one_time',
        position: 0,
      }),
      expect.objectContaining({
        name: 'Mensalidade',
        unit_price: '2000.00',
        discount_type: null,
        billing: 'monthly',
        position: 1,
      }),
    ]);
  });

  it('escolhe um item do catálogo pela busca do código, com nome, unidade, preço e cobrança copiados', async () => {
    hooks.products = [
      product,
      { ...product, id: 'prod-2', name: 'Item antigo', code: 'OLD', archived_at: '2026-10-02T00:00:00Z' },
    ];
    hooks.items = [];
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar itens' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Produto ou serviço' }));
    fireEvent.change(await screen.findByLabelText('Buscar no catálogo por nome ou código'), {
      target: { value: 'gt-0' },
    });
    expect(screen.queryByText(/Item antigo/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Gestão de tráfego (GT-01)'));
    expect(screen.getByLabelText(/^Nome do item/)).toHaveValue('Gestão de tráfego');
    expect(screen.getByLabelText(/^Unidade/)).toHaveValue('mês');
    expect(screen.getByLabelText(/^Preço unitário/)).toHaveValue('2.000,00');
    expect(screen.getByLabelText('Cobrança')).toHaveValue('monthly');
    expect(screen.getByLabelText(/Meses do contrato/)).toHaveValue('');
  });

  it('sem mexer nos itens, a edição vai pelo caminho de sempre, sem o valor; mexendo, manda a lista inteira', async () => {
    hooks.products = [];
    hooks.items = [savedItem];
    const save = renderForm(itemDeal);
    expect(screen.getByText('Valor do contrato (BRL)').parentElement).toHaveTextContent('R$ 1.500,00');
    fireEvent.change(screen.getByLabelText(/Nome da oportunidade/), { target: { value: 'Contrato renovado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][1]).toMatchObject({ items: null, hadItems: true });
    fireEvent.change(screen.getByLabelText(/^Quantidade/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][1].items).toEqual([
      expect.objectContaining({ id: 'item-1', quantity: '3.000', unit_price: '750.00' }),
    ]);
  });

  it('remover todos os itens devolve o campo do valor, com o valor do contrato, e manda a lista vazia', async () => {
    hooks.products = [];
    hooks.items = [savedItem];
    const save = renderForm(itemDeal);
    fireEvent.click(screen.getByRole('button', { name: 'Remover item Implantação' }));
    expect(screen.getByLabelText(/Valor \(BRL\)/)).toHaveValue('1.500,00');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][1]).toMatchObject({ items: [], contractMonths: null });
    expect(save.mock.calls[0][0]).toMatchObject({ value: '1.500,00' });
  });

  it('não grava um item com erro e leva o foco ao campo, com a mensagem da RPC', async () => {
    hooks.products = [];
    hooks.items = [];
    const save = renderForm();
    fireEvent.change(screen.getByLabelText(/Nome da oportunidade/), { target: { value: 'Contrato' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar itens' }));
    fillItem('Consultoria', '1,2345', '100');
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    expect(await screen.findByText('Informe uma quantidade maior que zero, com até 3 casas decimais.')).toBeVisible();
    expect(document.activeElement).toBe(screen.getByLabelText(/^Quantidade/));
    expect(save).not.toHaveBeenCalled();
  });

  it('lê os itens da versão da oportunidade aberta, para a lista não ser de uma versão anterior', () => {
    hooks.items = [savedItem];
    renderForm(itemDeal);
    expect(hooks.itemsOptions.at(-1)).toEqual({ enabled: true, version: '2026-10-01T12:00:00.000Z' });
  });

  it('enquanto os itens chegam, o valor fica travado e o formulário avisa', () => {
    hooks.itemsState = 'pending';
    renderForm(itemDeal);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando itens…');
    expect(screen.queryByLabelText(/Valor (BRL)/)).not.toBeInTheDocument();
    expect(screen.getByText('Valor do contrato (BRL)').parentElement).toHaveTextContent('R$ 1.500,00');
  });

  it('se os itens não carregam, oferece tentar de novo e salva os outros campos sem o valor e sem os itens', async () => {
    hooks.itemsState = 'error';
    hooks.items = [savedItem];
    const save = renderForm(itemDeal);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível carregar os itens. Os outros campos podem ser salvos sem mexer neles.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(hooks.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText(/Valor (BRL)/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Nome da oportunidade/), { target: { value: 'Contrato renovado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ title: 'Contrato renovado' });
    expect(save.mock.calls[0][1]).toMatchObject({ items: null, contractMonths: null, hadItems: true });
  });

  it('pede para descartar ao fechar depois de mexer só nos itens; sem mudança, fecha direto', async () => {
    hooks.items = [savedItem];
    const close = vi.fn();
    const view = render(
      <DealForm
        deal={itemDeal}
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[]}
        onSave={vi.fn()}
        onClose={close}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(close).toHaveBeenCalledOnce();
    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument();
    view.unmount();
    close.mockClear();
    render(
      <DealForm
        deal={itemDeal}
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[]}
        onSave={vi.fn()}
        onClose={close}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^Quantidade/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('Descartar alterações?')).toBeVisible();
    expect(close).not.toHaveBeenCalled();
  });
});
