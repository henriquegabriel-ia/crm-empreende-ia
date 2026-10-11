import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@/lib/deal-types';

const mocks = vi.hoisted(() => ({ loadDealLinks: vi.fn(), rpc: vi.fn() }));
vi.mock('@/components/pipeline/data', () => ({
  loadDealLinks: mocks.loadDealLinks,
  pipelineDb: { rpc: mocks.rpc },
  errorMessage: (error: { message?: string }) => error.message ?? 'Falha',
}));

import { DealDeleteDialog } from '@/components/pipeline/DealDeleteDialog';

const deal = { id: 'deal-1', org_id: 'org-1', title: 'Projeto Exemplo' } as Deal;
function renderDialog(onDeleted = vi.fn(), onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<DealDeleteDialog orgId="org-1" deal={deal} onClose={onClose} onDeleted={onDeleted} />, { wrapper });
  return { onDeleted, onClose, dialog: () => screen.getByRole('dialog', { name: 'Excluir oportunidade?' }) };
}

describe('exclusão de oportunidade com vínculos', () => {
  beforeEach(() => {
    mocks.loadDealLinks.mockReset();
    mocks.rpc.mockReset();
  });

  it('mostra as contagens antes de confirmar e desvincula com p_confirm = true', async () => {
    mocks.loadDealLinks.mockResolvedValue({ activities: 2, payments: 1, automation_logs: 1 });
    mocks.rpc.mockResolvedValue({ data: { activities: 2, payments: 1, automation_logs: 1 }, error: null });
    const { onDeleted, dialog } = renderDialog();
    expect(within(dialog()).getByText('Conferindo vínculos…')).toBeVisible();
    expect(within(dialog()).getByRole('button', { name: 'Excluir oportunidade' })).toBeDisabled();
    await within(dialog()).findByText('2 atividades, 1 recebimento e 1 registro de automação');
    expect(within(dialog()).getByText(/2 atividades e 1 recebimento continuam no CRM, sem o vínculo/)).toBeVisible();
    expect(within(dialog()).getByText(/1 registro de automação fica no histórico/)).toBeVisible();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Desvincular e excluir' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(mocks.loadDealLinks).toHaveBeenCalledWith('org-1', 'deal-1');
    expect(mocks.rpc).toHaveBeenCalledWith('delete_deal', { p_deal_id: 'deal-1', p_confirm: true });
    expect(onDeleted).toHaveBeenCalledWith(deal, { activities: 2, payments: 1, automation_logs: 1 });
  });

  it('exclui sem pedir confirmação de vínculos quando não há nenhum', async () => {
    mocks.loadDealLinks.mockResolvedValue({ activities: 0, payments: 0, automation_logs: 0 });
    mocks.rpc.mockResolvedValue({ data: { activities: 0, payments: 0, automation_logs: 0 }, error: null });
    const { onDeleted, dialog } = renderDialog();
    await within(dialog()).findByText(/não tem atividades, recebimentos nem registros de automação vinculados/);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Excluir oportunidade' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(mocks.rpc).toHaveBeenCalledWith('delete_deal', { p_deal_id: 'deal-1', p_confirm: false });
  });

  it('sem vínculos na contagem, atualiza as contagens quando o banco recusa por vínculos novos e não exclui', async () => {
    mocks.loadDealLinks.mockResolvedValue({ activities: 0, payments: 0, automation_logs: 0 });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'Esta oportunidade tem vínculos: 1 atividade.',
        details: '{"activities":1,"payments":0,"automation_logs":0}',
      },
    });
    const { onDeleted, dialog } = renderDialog();
    await within(dialog()).findByText(/não tem atividades/);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Excluir oportunidade' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Os vínculos mudaram');
    expect(within(dialog()).getByText('1 atividade')).toBeVisible();
    expect(within(dialog()).getByRole('button', { name: 'Desvincular e excluir' })).toBeEnabled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('não permite confirmar sem conferir os vínculos', async () => {
    mocks.loadDealLinks.mockRejectedValue(new Error('Sem conexão'));
    const { dialog } = renderDialog();
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Sem conexão');
    expect(within(dialog()).getByRole('button', { name: 'Excluir oportunidade' })).toBeDisabled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
