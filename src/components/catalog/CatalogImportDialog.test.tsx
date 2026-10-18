import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeProductImport, readProductSheet } from '@/lib/product-import';
import type { CatalogProduct } from '@/lib/deal-types';

const mocks = vi.hoisted(() => ({ insertBatch: vi.fn(), load: vi.fn(), download: vi.fn() }));
vi.mock('./data', async (original) => ({
  ...(await original<typeof import('./data')>()),
  insertProductBatch: mocks.insertBatch,
  loadProducts: mocks.load,
}));
vi.mock('@/lib/csv', async (original) => ({
  ...(await original<typeof import('@/lib/csv')>()),
  downloadText: mocks.download,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { CatalogImportDialog } from './CatalogImportDialog';

function mount(lines: string[]) {
  const read = readProductSheet(new TextEncoder().encode(lines.join('\n')), 'catalogo.csv');
  if (read.error !== null) throw new Error(read.error);
  let next = 0;
  const analysis = analyzeProductImport(read.sheet, [], () => `id-${++next}`);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CatalogImportDialog orgId="org-1" sheet={read.sheet} analysis={analysis} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

// Item 1.16: a gravação da importação do catálogo (docs/arquitetura/1.16.md, seção 8.3).
describe('importação do catálogo', () => {
  it('um código cadastrado por um colega no meio relê o catálogo e reenvia o lote sem a linha, uma vez', async () => {
    mocks.insertBatch
      .mockRejectedValueOnce({
        code: '23505',
        message: 'duplicate key value violates unique constraint "products_org_code"',
        details: 'Key (org_id, lower(btrim(code)))=(org-1, c-2) already exists.',
      })
      .mockImplementation(async (_org: string, rows: { id: string }[]) => rows.map((row) => row.id));
    mocks.load.mockResolvedValue([{ id: 'colega', name: 'Outro', code: 'C-2', archived_at: null } as CatalogProduct]);
    mount(['nome;codigo;preco', 'Consultoria;C-1;250', 'Treinamento;C-2;900']);
    fireEvent.click(screen.getByRole('button', { name: 'Importar 2 itens' }));
    expect(await screen.findByText('Importação concluída')).toBeInTheDocument();
    expect(mocks.insertBatch).toHaveBeenCalledTimes(2);
    expect(mocks.insertBatch.mock.calls[1][1].map((row: { code: string }) => row.code)).toEqual(['C-1']);
    expect(screen.getByText(/1 item importado\. 1 linha ficou de fora/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Baixar itens não importados' }));
    expect(mocks.download.mock.calls[0][1]).toContain('Já existe no catálogo com o código C-2.');
  });

  it('o papel rebaixado no meio para a importação, diz o motivo e não oferece continuar', async () => {
    mocks.insertBatch.mockRejectedValue({ code: '42501', message: 'new row violates row-level security policy' });
    mount(['nome;preco', 'Consultoria;250']);
    fireEvent.click(screen.getByRole('button', { name: 'Importar 1 item' }));
    expect(await screen.findByText('Importação parada')).toBeInTheDocument();
    expect(
      screen.getByText(
        'A importação parou: Somente donos e administradores alteram o catálogo. Você pode consultá-lo. Nenhum item foi gravado.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar importação' })).not.toBeInTheDocument();
  });

  it('a falha de conexão para e "Continuar importação" grava o que falta, com os mesmos ids', async () => {
    mocks.insertBatch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async (_org: string, rows: { id: string }[]) => rows.map((row) => row.id));
    mount(['nome;preco', 'Consultoria;250']);
    fireEvent.click(screen.getByRole('button', { name: 'Importar 1 item' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar importação' }));
    expect(await screen.findByText('Importação concluída')).toBeInTheDocument();
    await waitFor(() => expect(mocks.insertBatch).toHaveBeenCalledTimes(2));
    expect(mocks.insertBatch.mock.calls[0][1][0].id).toBe(mocks.insertBatch.mock.calls[1][1][0].id);
  });
});
