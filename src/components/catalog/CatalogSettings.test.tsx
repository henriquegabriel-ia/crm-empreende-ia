import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProduct } from '@/lib/deal-types';

const mocks = vi.hoisted(() => ({
  products: [] as CatalogProduct[],
  error: null as unknown,
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
  insertBatch: vi.fn(),
  load: vi.fn(),
  download: vi.fn(),
  success: vi.fn(),
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/hooks/useProducts', async () => {
  const { catalogMigrationMissing } = await import('@/lib/rpc-errors');
  return {
    useProducts: () => ({
      products: mocks.products,
      data: mocks.products,
      isPending: false,
      isError: !!mocks.error,
      error: mocks.error,
      missing: catalogMigrationMissing(mocks.error),
      refetch: async () => ({ data: mocks.products, error: null }),
    }),
  };
});
vi.mock('./data', async (original) => ({
  ...(await original<typeof import('./data')>()),
  createProduct: mocks.create,
  updateProduct: mocks.update,
  setProductArchived: mocks.archive,
  deleteProduct: mocks.remove,
  insertProductBatch: mocks.insertBatch,
  loadProducts: mocks.load,
}));
vi.mock('@/lib/csv', async (original) => ({
  ...(await original<typeof import('@/lib/csv')>()),
  downloadText: mocks.download,
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: vi.fn(), info: vi.fn() } }));

import { CatalogSettings } from './CatalogSettings';
import { catalogErrorMessage } from './data';

const product = (fields: Partial<CatalogProduct> & { id: string; name: string }): CatalogProduct => ({
  org_id: 'org-1',
  code: null,
  kind: 'product',
  unit: null,
  price: 100,
  billing: 'one_time',
  archived_at: null,
  created_at: '2026-10-01T12:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000Z',
  ...fields,
});

function mount(canManage = true) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CatalogSettings canManage={canManage} />
    </QueryClientProvider>,
  );
}

function chooseFile(text: string, name = 'catalogo.csv') {
  const file = new File([text], name, { type: 'text/csv' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer });
  fireEvent.change(document.querySelector('[data-catalog-file]')!, { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.error = null;
  mocks.products = [
    product({ id: 'a', name: 'Gestão de tráfego', code: 'GT-01', kind: 'service', billing: 'monthly', price: 2000 }),
    product({ id: 'b', name: 'Implantação', code: 'IMP-01', kind: 'service', price: 1500 }),
    product({ id: 'c', name: 'Camiseta', unit: 'un', price: 49.9, archived_at: '2026-10-05T12:00:00.000Z' }),
  ];
});
afterEach(cleanup);

// Item 1.16: a aba "Catálogo" de Configurações (docs/arquitetura/1.16.md, seção 7.1).
describe('catálogo em Configurações', () => {
  it('lista os ativos por padrão, busca por nome ou código sem acento e filtra os arquivados', () => {
    mount();
    const list = screen.getByRole('list', { name: 'Itens do catálogo' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('R$ 2.000,00/mês')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar no catálogo'), { target: { value: 'imp-0' } });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('p')?.textContent),
    ).toEqual(['Implantação']);
    fireEvent.change(screen.getByLabelText('Buscar no catálogo'), { target: { value: 'gestao' } });
    expect(within(list).getByText('Gestão de tráfego')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar no catálogo'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'archived' } });
    expect(screen.getByText('Camiseta')).toBeInTheDocument();
    expect(screen.getByText('Arquivado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reativar Camiseta' })).toBeInTheDocument();
  });

  it('quem não administra consulta, sem os botões', () => {
    mount(false);
    expect(screen.getByText('Gestão de tráfego')).toBeInTheDocument();
    for (const name of ['Novo item', 'Importar planilha', 'Baixar modelo', 'Editar Gestão de tráfego'])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('cria um item com os campos aparados e o preço no padrão brasileiro', async () => {
    mocks.create.mockResolvedValue('new-id');
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Novo item' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Nome/), { target: { value: '  Consultoria   mensal ' } });
    fireEvent.change(within(dialog).getByLabelText('Código'), { target: { value: ' CM-1 ' } });
    fireEvent.click(within(dialog).getByLabelText('Serviço'));
    fireEvent.click(within(dialog).getByLabelText('Mensal'));
    fireEvent.change(within(dialog).getByLabelText(/^Preço/), { target: { value: '3.000,50' } });
    expect(within(dialog).getByText('Prévia: R$ 3.000,50')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar item' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith('org-1', {
      name: 'Consultoria mensal',
      code: 'CM-1',
      kind: 'service',
      unit: null,
      price: 3000.5,
      billing: 'monthly',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('código repetido e conflito de versão aparecem no diálogo, com o preenchimento preservado', async () => {
    mocks.create.mockRejectedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "products_org_code"',
      details: 'Key (org_id, lower(btrim(code)))=(org-1, gt-01) already exists.',
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Novo item' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Nome/), { target: { value: 'Outro' } });
    fireEvent.change(within(dialog).getByLabelText('Código'), { target: { value: 'gt-01' } });
    fireEvent.change(within(dialog).getByLabelText(/^Preço/), { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar item' }));
    expect(await within(dialog).findByText('Já existe um item com o código “gt-01”.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Nome/)).toHaveValue('Outro');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const { CATALOG_MESSAGES } = await import('./data');
    mocks.update.mockRejectedValue(new Error(CATALOG_MESSAGES.conflict));
    fireEvent.click(screen.getByRole('button', { name: 'Editar Implantação' }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/^Preço/)).toHaveValue('1.500,00');
    fireEvent.change(within(dialog).getByLabelText(/^Preço/), { target: { value: '1.800,00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar item' }));
    expect(await within(dialog).findByText(CATALOG_MESSAGES.conflict)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Preço/)).toHaveValue('1.800,00');
    expect(mocks.update).toHaveBeenCalledWith('org-1', mocks.products[1], expect.objectContaining({ price: 1800 }));
  });

  it('arquiva e reativa a versão lida; excluir um item já usado explica que é preciso arquivar', async () => {
    mocks.archive.mockResolvedValue(mocks.products[0]);
    mocks.remove.mockRejectedValue({
      code: '23503',
      message:
        'update or delete on table "products" violates foreign key constraint "deal_items_product_id_org_id_fkey" on table "deal_items"',
      details: 'Key (id, org_id)=(a, org-1) is still referenced from table "deal_items".',
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar Gestão de tráfego' }));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith('org-1', mocks.products[0], true));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Gestão de tráfego' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir item' }));
    expect(
      await screen.findByText('Este item já foi usado em oportunidades. Arquive para tirá-lo das escolhas.'),
    ).toBeInTheDocument();
  });

  // Item 1.15 (achado 5 da revisão do 1.16): o erro e o vazio no padrão das outras telas.
  it('a falha de leitura usa o estado "Não foi possível carregar", com o motivo e "Tentar novamente"', () => {
    mocks.error = new TypeError('Failed to fetch');
    mount();
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Não foi possível carregar o catálogo' })).toBeInTheDocument();
    expect(within(alert).getByText(catalogErrorMessage(mocks.error))).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('o catálogo vazio tem o título sem ponto final, como os outros estados vazios', () => {
    mocks.products = [];
    mount();
    expect(screen.getByRole('heading', { name: 'Nenhum item no catálogo' })).toBeInTheDocument();
  });

  it('num banco sem a migração, mostra a mensagem de atualização como aviso neutro, sem tom de falha', () => {
    mocks.error = { code: 'PGRST205', message: "Could not find the table 'public.products' in the schema cache" };
    mount();
    expect(
      screen.getByText(
        'Este CRM ainda não tem a atualização do catálogo. Peça a quem administra para aplicar a migração mais recente.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo item' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Não foi possível carregar o catálogo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
  });

  it('baixa o modelo e importa a planilha com a prévia: prontas, repetidas e com erro, sem gravar antes de confirmar', async () => {
    mocks.insertBatch.mockImplementation(async (_org: string, rows: { id: string }[]) => rows.map((row) => row.id));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Baixar modelo' }));
    expect(mocks.download).toHaveBeenCalledWith(expect.stringMatching(/modelo-catalogo.*\.csv$/), expect.any(String));
    expect(mocks.download.mock.calls[0][1]).toContain('"nome";"codigo";"tipo";"unidade";"preco";"cobranca"');
    chooseFile(
      [
        'Produto;SKU;Tipo;Unidade;Preço;Recorrência',
        'Consultoria;C-1;Serviço;hora;250,00;Única',
        'Gestão;GT-01;Serviço;mês;2.000,00;Mensal',
        'Sem preço;;Produto;un;;',
        'Camiseta;;Produto;un;59,90;',
      ].join('\n'),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Revisar importação do catálogo')).toBeInTheDocument();
    expect(within(dialog).getByText(/1 pronta para importar, 2 repetidas e 1 com erro/)).toBeInTheDocument();
    expect(mocks.insertBatch).not.toHaveBeenCalled();
    fireEvent.mouseDown(within(dialog).getByRole('tab', { name: /Repetidas/ }));
    expect(within(dialog).getByText('Já existe no catálogo com o código GT-01.')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Já existe no catálogo, arquivado, um item sem código com o nome “Camiseta”.'),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importar 1 item' }));
    expect(await within(dialog).findByText('Importação concluída')).toBeInTheDocument();
    expect(mocks.insertBatch).toHaveBeenCalledOnce();
    expect(mocks.insertBatch.mock.calls[0][1]).toEqual([
      expect.objectContaining({ name: 'Consultoria', code: 'C-1', kind: 'service', unit: 'hora', price: 250 }),
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Baixar itens não importados' }));
    const issues = mocks.download.mock.calls.at(-1)!;
    expect(issues[0]).toMatch(/catalogo-nao-importados.*\.csv$/);
    expect(issues[1]).toContain('Repetida');
    expect(issues[1]).toContain('Com erro');
  });

  it('recusa a planilha do Excel e um arquivo sem a coluna do preço, sem abrir a prévia', async () => {
    mount();
    chooseFile('nome;codigo\nConsultoria;C-1');
    expect(await screen.findByText(/A planilha precisa de uma coluna para o preço/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
