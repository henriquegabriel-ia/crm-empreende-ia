import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmRole } from '@/lib/roles';
import type { TeamMember } from '@/lib/team-members';
import { MemberReactivateDialog } from './MemberReactivateDialog';

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn() }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { rpc: mock.rpc } }));
vi.mock('sonner', () => ({ toast: { success: mock.toast } }));

const member = (role: CrmRole): TeamMember => ({
  id: 'fulano',
  name: 'Fulano',
  email: 'fulano@example.test',
  role,
  active: false,
  deactivatedAt: '2026-10-13T15:00:00.000Z',
});
function setup(role: CrmRole, actorRole: CrmRole) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemberReactivateDialog member={member(role)} actorRole={actorRole} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}
const options = () =>
  within(screen.getByLabelText('Novo papel'))
    .getAllByRole('option')
    .map((option) => option.textContent);

beforeEach(() => {
  mock.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mock.toast.mockReset();
});

describe('reativar (item 1.2)', () => {
  it('sugere o papel guardado, explica que a carteira não volta e reativa com o papel escolhido', async () => {
    const onClose = setup('admin', 'owner');
    const dialog = screen.getByRole('dialog', { name: 'Reativar Fulano' });
    expect(dialog).toHaveTextContent('A carteira que passou para outra pessoa continua com ela');
    expect(screen.getByLabelText('Novo papel')).toHaveValue('admin');
    expect(options()).toEqual(['Dono', 'Administrador', 'Colaborador', 'Somente leitura']);
    fireEvent.change(screen.getByLabelText('Novo papel'), { target: { value: 'member' } });
    expect(dialog).toHaveTextContent('Cria e edita contatos');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar reativação' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mock.rpc).toHaveBeenCalledWith('reactivate_member', { p_user_id: 'fulano', p_role: 'member' });
    expect(mock.toast).toHaveBeenCalledWith('O acesso de Fulano foi reativado.');
  });

  it('o administrador não oferece o papel de Dono', () => {
    setup('member', 'admin');
    expect(options()).toEqual(['Administrador', 'Colaborador', 'Somente leitura']);
    expect(screen.getByLabelText('Novo papel')).toHaveValue('member');
  });

  it('a recusa do banco aparece no diálogo, ligada ao botão', async () => {
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'Somente um dono pode reativar um dono ou dar o papel de Dono.' },
    });
    const onClose = setup('member', 'admin');
    const dialog = screen.getByRole('dialog', { name: 'Reativar Fulano' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar reativação' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Somente um dono pode reativar um dono');
    expect(within(dialog).getByRole('button', { name: 'Confirmar reativação' })).toHaveAccessibleDescription(
      'Somente um dono pode reativar um dono ou dar o papel de Dono.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
