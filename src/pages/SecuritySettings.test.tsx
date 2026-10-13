import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SecuritySettings from './SecuritySettings';

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), canManage: false, success: vi.fn() }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: {} }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'user-1', org_id: 'org-a' }, signOut: mocks.signOut }),
}));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => ({ canManage: mocks.canManage }) }));
vi.mock('@/components/shell/PageScaffold', () => ({
  PageScaffold: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success } }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SecuritySettings />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.signOut.mockReset().mockResolvedValue(true);
  mocks.canManage = false;
  mocks.success.mockReset();
});
afterEach(cleanup);

// O 'global' do Supabase impede as renovações, mas o acesso já emitido nos outros aparelhos vale até expirar (1 hora no
// padrão): o diálogo diz isso, como a Ajuda ("Como saio da conta ou encerro o acesso em outros aparelhos?").
describe('Segurança: encerrar todas as sessões', () => {
  it('o diálogo diz que este aparelho sai na hora e os outros em até 1 hora, e encerra pelo signOut global', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar todas as sessões' }));
    const dialog = screen.getByRole('dialog', { name: 'Encerrar todas as sessões?' });
    expect(dialog).toHaveAccessibleDescription(
      'Você sairá desta conta agora. Nos outros dispositivos, o acesso termina em até 1 hora, e será preciso entrar novamente. As alterações já salvas permanecem no CRM.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Encerrar sessões' }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith('global'));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Sessões encerradas'));
  });

  it('qualquer papel encerra as sessões; o histórico geral fica com donos e administradores', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Encerrar todas as sessões' })).toBeEnabled();
    expect(
      screen.getByText(
        'O histórico geral está disponível para donos e administradores. O histórico de cada oportunidade permanece em sua ficha.',
      ),
    ).toBeInTheDocument();
  });
});
