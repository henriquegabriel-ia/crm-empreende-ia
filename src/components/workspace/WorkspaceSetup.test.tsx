import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError } from '@supabase/supabase-js';
import { WorkspaceSetup } from './WorkspaceSetup';
import { INCOMPLETE_INVITE_MESSAGE } from '@/lib/invite-link';

type Reply = { data?: unknown; error: { code: string; message: string } | null };
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  refreshProfile: vi.fn(),
  signOut: vi.fn(),
  // supabase.auth: o passo da senha da conta antes do aceite e da criação da empresa.
  updateUser: vi.fn(),
  authSignOut: vi.fn(),
  // public.instance_status: uma resposta por leitura, a última se repete.
  status: [] as Reply[],
  statusCalls: 0,
}));
vi.mock('@/integrations/supabase/client', () => ({
  backendConfigured: true,
  supabase: { auth: { updateUser: mock.updateUser, signOut: mock.authSignOut } },
}));
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: {
    rpc: (name: string, args?: unknown) => {
      if (name !== 'instance_status') return mock.rpc(name, args);
      const reply = mock.status[Math.min(mock.statusCalls, mock.status.length - 1)];
      mock.statusCalls += 1;
      return { single: () => Promise.resolve(reply) };
    },
  },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'pessoa@example.test' },
    refreshProfile: mock.refreshProfile,
    signOut: mock.signOut,
  }),
}));

const ID = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const company = (has: boolean): Reply => ({ data: { has_organization: has }, error: null });
const refusal = (message: string): Reply => ({ data: null, error: { code: 'P0001', message } });
// Aceite e criação da empresa pedem a senha da conta antes de chamar o banco.
const submit = (button: 'Aceitar convite da equipe' | 'Criar empresa', password = 'senha-da-conta') => {
  fireEvent.change(screen.getByLabelText('Senha da conta'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: button }));
};

function CurrentUrl() {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}
function setup(path: string) {
  // O hook define a própria nova tentativa; sem espera entre elas, o teste não aguarda o atraso padrão.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/invite" element={<WorkspaceSetup />} />
          <Route path="/dashboard" element={<h1>CRM da equipe</h1>} />
          <Route path="/setup" element={<WorkspaceSetup />} />
          <Route path="/pipeline" element={<h1>Oportunidade do link</h1>} />
        </Routes>
        <CurrentUrl />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mock.rpc.mockReset().mockResolvedValue({ data: 'org-a', error: null });
  mock.refreshProfile.mockReset().mockResolvedValue(undefined);
  mock.signOut.mockReset().mockResolvedValue(true);
  mock.updateUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  mock.authSignOut.mockReset().mockResolvedValue({ error: null });
  mock.status = [company(true)];
  mock.statusCalls = 0;
});

describe('aceite do convite', () => {
  it('sai da rota do convite depois de aceitar', async () => {
    setup(`/invite?invite=${ID.toUpperCase()}`);
    expect(screen.getByRole('heading', { name: 'Entre na sua equipe' })).toBeInTheDocument();
    submit('Aceitar convite da equipe');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith('accept_invitation', { p_invitation_id: ID });
    expect(mock.refreshProfile).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Aceitar convite da equipe' })).not.toBeInTheDocument();
  });

  it('volta ao deep link guardado em ?next= depois de aceitar, e ignora um externo', async () => {
    setup(`/invite?invite=${ID}&next=${encodeURIComponent('/pipeline?deal=deal-7')}`);
    submit('Aceitar convite da equipe');
    expect(await screen.findByRole('heading', { name: 'Oportunidade do link' })).toBeInTheDocument();
    cleanup();
    setup(`/invite?invite=${ID}&next=${encodeURIComponent('//example.test')}`);
    submit('Aceitar convite da equipe');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
    cleanup();
    // Segmentos de ponto que viram "//example.test" depois de normalizados também são recusados.
    setup(`/invite?invite=${ID}&next=${encodeURIComponent('/.//example.test')}`);
    submit('Aceitar convite da equipe');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
  });

  it.each([
    'Este convite expirou. Peça um novo a quem administra.',
    'Este convite é para outro e-mail. Entre com a conta do e-mail convidado.',
    'Este convite já foi usado.',
    'Confirme seu e-mail antes de aceitar o convite.',
  ])('mostra o motivo da recusa (%s) e só navega quando uma nova tentativa dá certo', async (message) => {
    mock.rpc.mockResolvedValueOnce(refusal(message));
    setup(`/invite?invite=${ID}`);
    submit('Aceitar convite da equipe');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('link', { name: 'Continuar sem este convite' })).not.toBeInTheDocument();
    expect(mock.refreshProfile).not.toHaveBeenCalled();
    submit('Aceitar convite da equipe');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
  });

  it('convite não encontrado oferece continuar sem ele', async () => {
    mock.rpc.mockResolvedValueOnce(
      refusal(
        'Convite não encontrado. Ele pode ter sido revogado ou trocado por um novo; peça o link atualizado a quem administra.',
      ),
    );
    setup(`/invite?invite=${ID}`);
    submit('Aceitar convite da equipe');
    expect(await screen.findByRole('alert')).toHaveTextContent('Convite não encontrado.');
    fireEvent.click(screen.getByRole('link', { name: 'Continuar sem este convite' }));
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
  });

  it('um link de convite cortado é explicado ao abrir, sem o botão de aceite e sem chamar o banco', async () => {
    setup(`/invite?invite=convite-1&next=${encodeURIComponent('/pipeline?deal=deal-7')}`);
    expect(screen.getByRole('alert')).toHaveTextContent(INCOMPLETE_INVITE_MESSAGE);
    expect(screen.queryByRole('button', { name: 'Aceitar convite da equipe' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continuar sem este convite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recebi um convite' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(screen.getByLabelText('Link do convite'), {
      target: { value: `https://crm.example.test/?invite=${ID}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir convite' }));
    expect(await screen.findByRole('button', { name: 'Aceitar convite da equipe' })).toBeInTheDocument();
    expect(screen.queryByText(INCOMPLETE_INVITE_MESSAGE)).not.toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent(
      `/invite?invite=${ID}&next=${encodeURIComponent('/pipeline?deal=deal-7')}`,
    );
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('antes de aceitar, grava a senha da conta e encerra as outras sessões', async () => {
    setup(`/invite?invite=${ID}`);
    expect(screen.getByLabelText('Senha da conta')).toHaveAccessibleDescription(
      /Por segurança, digite a senha que você vai usar para entrar: pode ser a mesma do cadastro\./,
    );
    submit('Aceitar convite da equipe', 'senha-do-convidado');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
    expect(mock.updateUser).toHaveBeenCalledWith({ password: 'senha-do-convidado' });
    expect(mock.authSignOut).toHaveBeenCalledWith({ scope: 'others' });
    // Outra pessoa pode ter criado esta conta antes, com uma senha própria: ela deixa de valer antes do aceite.
    expect(mock.updateUser.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[0]);
    expect(mock.authSignOut.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[0]);
  });

  it('a senha do cadastro, repetida, também serve', async () => {
    mock.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('New password should be different from the old password.', 422, 'same_password'),
    });
    setup(`/invite?invite=${ID}`);
    submit('Aceitar convite da equipe');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
    expect(mock.authSignOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('senha recusada pelo Auth: mostra o motivo em pt-BR e não aceita', async () => {
    mock.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthWeakPasswordError('Password should be at least 8 characters.', 422, ['length']),
    });
    setup(`/invite?invite=${ID}`);
    submit('Aceitar convite da equipe', 'curta1');
    expect(await screen.findByRole('alert')).toHaveTextContent('A senha precisa ter pelo menos 8 caracteres.');
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.authSignOut).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceitar convite da equipe' })).toBeEnabled());
  });

  it('uma falha técnica mostra a mensagem genérica, sem texto em inglês', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } });
    setup(`/invite?invite=${ID}`);
    submit('Aceitar convite da equipe');
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível aceitar o convite.');
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });
});

describe('criar a empresa (instância vazia, D6)', () => {
  it('sem empresa, oferece "Criar empresa" e leva ao CRM depois de criar', async () => {
    mock.status = [company(false)];
    setup('/setup');
    expect(await screen.findByRole('heading', { name: 'Seu negócio, seu CRM' })).toBeInTheDocument();
    expect(screen.getByText(/Você é a primeira pessoa a entrar neste CRM/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Nome da empresa'), { target: { value: '  Empresa Nova ' } });
    submit('Criar empresa');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith('create_workspace', { p_name: 'Empresa Nova' });
    // Como no aceite: a senha da conta é gravada, e as outras sessões encerradas, antes de a conta virar dona.
    expect(mock.updateUser).toHaveBeenCalledWith({ password: 'senha-da-conta' });
    expect(mock.authSignOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(mock.authSignOut.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[0]);
    expect(mock.refreshProfile).toHaveBeenCalledOnce();
    // A instância é relida: agora ela tem empresa.
    expect(mock.statusCalls).toBe(2);
  });

  it('sem leitura da instância (banco sem a migração), mantém o formulário de antes, sem afirmar que ela está vazia', async () => {
    mock.status = [{ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }];
    setup('/setup');
    expect(await screen.findByRole('button', { name: 'Criar empresa' })).toBeInTheDocument();
    expect(screen.getByText(/Crie a empresa para começar/)).toBeVisible();
    expect(screen.queryByText(/primeira pessoa/)).not.toBeInTheDocument();
    expect(mock.statusCalls).toBe(1);
  });

  it('banco sem a migração que passa a ter empresa: pede o convite, sem dizer que outra pessoa acabou de criá-la', async () => {
    mock.status = [{ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }];
    mock.rpc.mockResolvedValueOnce(
      refusal('Este CRM já tem uma empresa. Para entrar, peça um convite a quem administra.'),
    );
    setup('/setup');
    fireEvent.change(await screen.findByLabelText('Nome da empresa'), { target: { value: 'Empresa' } });
    submit('Criar empresa');
    expect(await screen.findByRole('heading', { name: 'Falta o convite da sua equipe' })).toBeInTheDocument();
    expect(screen.queryByText(/agora há pouco/)).not.toBeInTheDocument();
  });

  it('falha de leitura da instância: pede para tentar de novo, sem oferecer "Criar empresa"', async () => {
    const offline: Reply = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } };
    mock.status = [offline, offline, company(true)];
    setup('/setup');
    expect(await screen.findByRole('heading', { name: 'Não foi possível verificar este CRM' })).toBeInTheDocument();
    expect(mock.statusCalls).toBe(2);
    expect(screen.queryByRole('button', { name: 'Criar empresa' })).not.toBeInTheDocument();
    expect(screen.queryByText(/primeira pessoa/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recebi um convite' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('heading', { name: 'Falta o convite da sua equipe' })).toBeInTheDocument();
    expect(screen.queryByText(/agora há pouco/)).not.toBeInTheDocument();
  });

  it('o nome da empresa diz onde mudá-lo depois (Configurações, aba Organização)', async () => {
    mock.status = [company(false)];
    setup('/setup');
    expect(await screen.findByLabelText('Nome da empresa')).toHaveAccessibleDescription(
      'É o nome que a equipe vê no CRM. Você pode mudá-lo depois em Configurações, na aba Organização.',
    );
  });

  it('preserva o nome depois de uma falha e mostra o motivo dado pelo banco', async () => {
    mock.status = [company(false)];
    mock.rpc.mockResolvedValueOnce(refusal('Use um nome de empresa com 2 a 160 caracteres.'));
    setup('/setup');
    fireEvent.change(await screen.findByLabelText('Nome da empresa'), {
      target: { value: 'Empresa em qualquer segmento' },
    });
    submit('Criar empresa');
    expect(await screen.findByRole('alert')).toHaveTextContent('Use um nome de empresa com 2 a 160 caracteres.');
    expect(screen.getByLabelText('Nome da empresa')).toHaveValue('Empresa em qualquer segmento');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar empresa' })).toBeEnabled());
  });

  it('sem encerrar as outras sessões, não cria a empresa', async () => {
    mock.status = [company(false)];
    mock.authSignOut.mockResolvedValue({ error: new AuthRetryableFetchError('Failed to fetch', 0) });
    setup('/setup');
    fireEvent.change(await screen.findByLabelText('Nome da empresa'), { target: { value: 'Empresa' } });
    submit('Criar empresa');
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível falar com o servidor.');
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nome da empresa')).toHaveValue('Empresa');
  });

  it('uma falha de rede preserva o nome com a mensagem genérica', async () => {
    mock.status = [company(false)];
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } });
    setup('/setup');
    fireEvent.change(await screen.findByLabelText('Nome da empresa'), { target: { value: 'Empresa' } });
    submit('Criar empresa');
    expect(await screen.findByRole('alert')).toHaveTextContent('O nome foi preservado');
  });

  it('corrida: se outra pessoa criou a empresa agora há pouco, passa a pedir o convite', async () => {
    mock.status = [company(false), company(true)];
    mock.rpc.mockResolvedValueOnce(
      refusal('Este CRM já tem uma empresa. Para entrar, peça um convite a quem administra.'),
    );
    setup('/setup');
    fireEvent.change(await screen.findByLabelText('Nome da empresa'), { target: { value: 'Empresa' } });
    submit('Criar empresa');
    expect(await screen.findByRole('heading', { name: 'Falta o convite da sua equipe' })).toBeInTheDocument();
    expect(screen.getByText('Outra pessoa criou a empresa deste CRM agora há pouco.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Criar empresa' })).not.toBeInTheDocument();
    await waitFor(() => expect(mock.statusCalls).toBe(2));
  });
});

describe('conta sem organização numa instância com empresa', () => {
  it('explica que falta o convite, com o e-mail da conta, sem "Criar empresa"', async () => {
    setup('/setup');
    expect(await screen.findByRole('heading', { name: 'Falta o convite da sua equipe' })).toBeInTheDocument();
    expect(screen.getByText('pessoa@example.test')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Criar empresa' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nome da empresa')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recebi um convite' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Sair da conta' }));
    expect(mock.signOut).toHaveBeenCalledOnce();
  });

  it('o link colado em "Recebi um convite" leva ao aceite, mantendo o destino', async () => {
    setup(`/setup?next=${encodeURIComponent('/pipeline?deal=deal-7')}`);
    fireEvent.change(await screen.findByLabelText('Link do convite'), {
      target: { value: `https://crm.example.test/?invite=${ID}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir convite' }));
    expect(await screen.findByRole('heading', { name: 'Entre na sua equipe' })).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent(
      `/invite?invite=${ID}&next=${encodeURIComponent('/pipeline?deal=deal-7')}`,
    );
  });

  it('enquanto lê a instância, não oferece criar empresa', () => {
    mock.status = [];
    setup('/setup');
    expect(screen.getByRole('status')).toHaveTextContent('Verificando este CRM…');
    expect(screen.queryByRole('button', { name: 'Criar empresa' })).not.toBeInTheDocument();
  });
});
