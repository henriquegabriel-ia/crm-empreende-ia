import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError } from '@supabase/supabase-js';
import { WorkspaceSetup } from './WorkspaceSetup';
import { INCOMPLETE_INVITE_MESSAGE } from '@/lib/invite-link';

type Reply = { data?: unknown; error: { code: string; message: string } | null };
// Token no formato do Supabase Auth, com o método de entrada no amr (a assinatura não é conferida pela tela).
const encode = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenFor = (method: string) =>
  `${encode({ alg: 'HS256' })}.${encode({ sub: 'user-1', amr: [{ method, timestamp: 1_760_000_000 }] })}.assinatura`;
const PASSWORD_SESSION = tokenFor('password');
const LINK_SESSION = tokenFor('otp');
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  refreshProfile: vi.fn(),
  signOut: vi.fn(),
  // supabase.auth: a criação da senha na sessão aberta pelo link e o link de acesso da prova do e-mail.
  updateUser: vi.fn(),
  authSignOut: vi.fn(),
  signInWithOtp: vi.fn(),
  // O código do e-mail, digitado no aviso de envio (EmailCodeForm).
  verifyOtp: vi.fn(),
  accessToken: '',
  // public.instance_status: uma resposta por leitura, a última se repete.
  status: [] as Reply[],
  statusCalls: 0,
}));
vi.mock('@/integrations/supabase/client', () => ({
  backendConfigured: true,
  supabase: {
    auth: {
      updateUser: mock.updateUser,
      signOut: mock.authSignOut,
      signInWithOtp: mock.signInWithOtp,
      verifyOtp: mock.verifyOtp,
    },
  },
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
    session: { access_token: mock.accessToken },
    refreshProfile: mock.refreshProfile,
    signOut: mock.signOut,
  }),
}));

const ID = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const company = (has: boolean): Reply => ({ data: { has_organization: has }, error: null });
const refusal = (message: string): Reply => ({ data: null, error: { code: 'P0001', message } });
const PROOF_REFUSAL = {
  accept: 'Para aceitar o convite, confirme que o e-mail é seu: entre pelo link enviado a ele.',
  create: 'Para criar a empresa, confirme que o e-mail é seu: entre pelo link enviado a ele.',
};
// Na sessão aberta pelo link, o aceite e a criação da empresa pedem "Crie sua senha" antes de chamar o banco; numa
// sessão por senha, o botão chama o banco direto.
const submit = (button: 'Aceitar convite da equipe' | 'Criar empresa', password?: string) => {
  if (password !== undefined)
    fireEvent.change(screen.getByLabelText('Crie sua senha'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: button }));
};

function CurrentUrl() {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}
function setup(path: string) {
  // O hook define a própria nova tentativa; sem espera entre elas, o teste não aguarda o atraso padrão.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  const tree = () => (
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
    </QueryClientProvider>
  );
  const view = render(tree());
  // Mesma árvore, para a tela ver uma sessão nova (o link aberto em outra aba) sem perder o estado.
  return { rerender: () => view.rerender(tree()) };
}
beforeEach(() => {
  mock.rpc.mockReset().mockResolvedValue({ data: 'org-a', error: null });
  mock.refreshProfile.mockReset().mockResolvedValue(undefined);
  mock.signOut.mockReset().mockResolvedValue(true);
  mock.updateUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  mock.authSignOut.mockReset().mockResolvedValue({ error: null });
  mock.signInWithOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  mock.verifyOtp.mockReset().mockResolvedValue({ data: { session: { access_token: LINK_SESSION } }, error: null });
  mock.accessToken = PASSWORD_SESSION;
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

  it('numa sessão por senha, não pede a senha de novo: o banco decide pela prova do e-mail', async () => {
    setup(`/invite?invite=${ID}`);
    expect(screen.queryByLabelText('Crie sua senha')).not.toBeInTheDocument();
    submit('Aceitar convite da equipe');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
    expect(mock.updateUser).not.toHaveBeenCalled();
    expect(mock.authSignOut).not.toHaveBeenCalled();
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

  it('na sessão aberta pelo link, cria a senha e encerra as outras sessões antes de aceitar', async () => {
    mock.accessToken = LINK_SESSION;
    setup(`/invite?invite=${ID}`);
    expect(screen.getByLabelText('Crie sua senha')).toHaveAccessibleDescription(
      'Você entrou pelo link do e-mail. Crie a senha com que vai entrar nas próximas vezes. Se já tinha uma senha neste CRM, pode repeti-la.',
    );
    expect(screen.getByLabelText('Crie sua senha')).toBeRequired();
    submit('Aceitar convite da equipe', 'senha-do-convidado');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
    expect(mock.updateUser).toHaveBeenCalledWith({ password: 'senha-do-convidado' });
    expect(mock.authSignOut).toHaveBeenCalledWith({ scope: 'others' });
    // A senha nasce antes de a conta ganhar o papel, e só esta sessão continua aberta.
    expect(mock.updateUser.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[0]);
    expect(mock.authSignOut.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[0]);
  });

  it('a senha que a conta já tinha, repetida, também serve', async () => {
    mock.accessToken = LINK_SESSION;
    mock.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('New password should be different from the old password.', 422, 'same_password'),
    });
    setup(`/invite?invite=${ID}`);
    submit('Aceitar convite da equipe', 'senha-de-antes');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
    expect(mock.authSignOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('senha recusada pelo Auth: mostra o motivo em pt-BR e não aceita', async () => {
    mock.accessToken = LINK_SESSION;
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

  it('a recusa por falta da prova do e-mail troca o formulário pelo envio do link de acesso', async () => {
    mock.rpc.mockResolvedValueOnce(refusal(PROOF_REFUSAL.accept));
    setup(`/invite?invite=${ID}&next=${encodeURIComponent('/pipeline?deal=deal-7')}`);
    submit('Aceitar convite da equipe');
    const panel = await screen.findByRole('region', { name: 'Confirme que o e-mail é seu' });
    expect(panel).toHaveTextContent(
      'Por segurança, aceitar o convite exige entrar pelo link enviado ao seu e-mail. Enviaremos um link para pessoa@example.test; abra-o para continuar.',
    );
    expect(screen.queryByRole('button', { name: 'Aceitar convite da equipe' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair da conta' })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Enviar link para o meu e-mail' }));
    expect(await screen.findByText('Confira seu e-mail')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Enviamos um link para pessoa@example.test. Abra-o neste navegador para continuar.',
    );
    // Sem criar conta, e de volta ao convite e ao destino com a sessão aberta pelo link.
    const [{ email, options }] = mock.signInWithOtp.mock.calls[0];
    expect(email).toBe('pessoa@example.test');
    expect(options.shouldCreateUser).toBe(false);
    const back = new URL(options.emailRedirectTo);
    expect(back.origin).toBe(window.location.origin);
    expect(back.pathname).toBe('/');
    expect(back.searchParams.get('invite')).toBe(ID);
    expect(back.searchParams.get('next')).toBe('/pipeline?deal=deal-7');
    expect(mock.refreshProfile).not.toHaveBeenCalled();
  });

  it('o foco segue o painel que toma o lugar do botão, com a explicação, e os títulos seguem o h1 da tela', async () => {
    mock.rpc.mockResolvedValueOnce(refusal(PROOF_REFUSAL.accept));
    setup(`/invite?invite=${ID}`);
    submit('Aceitar convite da equipe');
    const title = await screen.findByRole('heading', { name: 'Confirme que o e-mail é seu', level: 2 });
    await waitFor(() => expect(title).toHaveFocus());
    expect(title).toHaveAccessibleDescription(
      /^Por segurança, aceitar o convite exige entrar pelo link enviado ao seu e-mail\. Enviaremos um link para pessoa@example\.test/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link para o meu e-mail' }));
    const sent = await screen.findByRole('heading', { name: 'Confira seu e-mail', level: 2 });
    await waitFor(() => expect(sent).toHaveFocus());
  });

  it('o aviso de envio pede o link de novo, e o limite de envio aparece abaixo dele', async () => {
    mock.rpc.mockResolvedValueOnce(refusal(PROOF_REFUSAL.create));
    mock.status = [company(false)];
    setup('/setup');
    fireEvent.change(await screen.findByLabelText('Nome da empresa'), { target: { value: 'Empresa Nova' } });
    submit('Criar empresa');
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar link para o meu e-mail' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar de novo' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Enviamos um novo link para pessoa@example.test. Abra-o neste navegador para continuar: o link e o código anteriores deixam de valer.',
      ),
    );
    expect(mock.signInWithOtp).toHaveBeenCalledTimes(2);
    expect(mock.signInWithOtp.mock.calls[1][0]).toMatchObject({
      email: 'pessoa@example.test',
      options: { shouldCreateUser: false },
    });
    mock.signInWithOtp.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit'),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar de novo' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Muitos e-mails enviados para este endereço. Aguarde alguns minutos antes de pedir outro.',
    );
    expect(screen.getByRole('button', { name: 'Enviar de novo' })).toHaveAttribute('aria-describedby', alert.id);
    // O aviso de envio continua: o link enviado antes ainda vale.
    expect(screen.getByText('Confira seu e-mail')).toBeVisible();
  });

  it('o link aberto nesta aba traz de volta o formulário, agora com "Crie sua senha"', async () => {
    mock.rpc.mockResolvedValueOnce(refusal(PROOF_REFUSAL.accept));
    const { rerender } = setup(`/invite?invite=${ID}`);
    submit('Aceitar convite da equipe');
    expect(await screen.findByRole('region', { name: 'Confirme que o e-mail é seu' })).toBeInTheDocument();
    mock.accessToken = LINK_SESSION;
    rerender();
    expect(screen.queryByRole('region', { name: 'Confirme que o e-mail é seu' })).not.toBeInTheDocument();
    submit('Aceitar convite da equipe', 'senha-nova');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
    expect(mock.updateUser).toHaveBeenCalledWith({ password: 'senha-nova' });
  });

  it('o código do e-mail, digitado no aviso de envio, abre a sessão do link: o formulário volta com o foco em "Crie sua senha"', async () => {
    mock.rpc.mockResolvedValueOnce(refusal(PROOF_REFUSAL.accept));
    const { rerender } = setup(`/invite?invite=${ID}`);
    submit('Aceitar convite da equipe');
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar link para o meu e-mail' }));
    fireEvent.change(await screen.findByLabelText('Código do e-mail'), { target: { value: '4820 3917' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com o código' }));
    await waitFor(() =>
      expect(mock.verifyOtp).toHaveBeenCalledWith({ email: 'pessoa@example.test', token: '48203917', type: 'email' }),
    );
    // A sessão nova (amr otp) chega pelo AuthContext.
    mock.accessToken = LINK_SESSION;
    rerender();
    expect(screen.queryByText('Confira seu e-mail')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Crie sua senha')).toHaveFocus());
    submit('Aceitar convite da equipe', 'senha-nova');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
    expect(mock.updateUser).toHaveBeenCalledWith({ password: 'senha-nova' });
  });

  it('erros do envio do link aparecem no próprio painel, em pt-BR', async () => {
    mock.rpc.mockResolvedValueOnce(refusal(PROOF_REFUSAL.accept));
    mock.signInWithOtp.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit'),
    });
    setup(`/invite?invite=${ID}`);
    submit('Aceitar convite da equipe');
    const panel = await screen.findByRole('region', { name: 'Confirme que o e-mail é seu' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Enviar link para o meu e-mail' }));
    const alert = await within(panel).findByRole('alert');
    expect(alert).toHaveTextContent(
      'Muitos e-mails enviados para este endereço. Aguarde alguns minutos antes de pedir outro.',
    );
    expect(within(panel).getByRole('button', { name: 'Enviar link para o meu e-mail' })).toHaveAttribute(
      'aria-describedby',
      alert.id,
    );
    expect(screen.queryByText('Confira seu e-mail')).not.toBeInTheDocument();
  });

  it('uma falha técnica mostra a mensagem genérica, sem texto em inglês', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } });
    setup(`/invite?invite=${ID}`);
    submit('Aceitar convite da equipe');
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível aceitar o convite.');
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });
});

describe('senha nova e o gerenciador de senhas do navegador', () => {
  // Sem um campo de usuário no mesmo formulário, o navegador salvaria a senha com o nome da empresa (ou sem usuário).
  const usernameOf = (form: HTMLFormElement) => form.querySelector<HTMLInputElement>('input[autocomplete="username"]');

  it('o aceite leva o e-mail da conta num campo de usuário escondido, antes da senha nova', () => {
    mock.accessToken = LINK_SESSION;
    setup(`/invite?invite=${ID}`);
    const password = screen.getByLabelText('Crie sua senha');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    const username = usernameOf(password.closest('form')!);
    expect(username).not.toBeNull();
    expect(username).toHaveValue('pessoa@example.test');
    expect(username).toHaveAttribute('readonly');
    expect(username).toHaveAttribute('tabindex', '-1');
    expect(username).toHaveAttribute('aria-hidden', 'true');
    expect(username!.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('na criação da empresa, o nome da empresa não passa por usuário', async () => {
    mock.accessToken = LINK_SESSION;
    mock.status = [company(false)];
    setup('/setup');
    const name = await screen.findByLabelText('Nome da empresa');
    expect(name).toHaveAttribute('autocomplete', 'organization');
    expect(usernameOf(screen.getByLabelText('Crie sua senha').closest('form')!)).toHaveValue('pessoa@example.test');
  });

  it('numa sessão por senha, sem o campo de senha, também não há campo de usuário', () => {
    setup(`/invite?invite=${ID}`);
    expect(usernameOf(screen.getByRole('button', { name: 'Aceitar convite da equipe' }).closest('form')!)).toBeNull();
  });
});

describe('criar a empresa (instância vazia, D6)', () => {
  it('sem empresa, oferece "Criar empresa" e leva ao CRM depois de criar', async () => {
    // O primeiro acesso volta do link de cadastro com a sessão aberta por ele.
    mock.accessToken = LINK_SESSION;
    mock.status = [company(false)];
    setup('/setup');
    expect(await screen.findByRole('heading', { name: 'Seu negócio, seu CRM' })).toBeInTheDocument();
    expect(screen.getByText(/Você é a primeira pessoa a entrar neste CRM/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Nome da empresa'), { target: { value: '  Empresa Nova ' } });
    submit('Criar empresa', 'senha-da-conta');
    expect(await screen.findByRole('heading', { name: 'CRM da equipe' })).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith('create_workspace', { p_name: 'Empresa Nova' });
    // Como no aceite: a senha nasce, e as outras sessões são encerradas, antes de a conta virar dona.
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

  // Item 1.6: o nome da organização não é a marca; a entrada e a aba seguem a configuração da implantação.
  it('o nome da empresa diz onde mudá-lo depois e que ele não troca a marca da entrada', async () => {
    mock.status = [company(false)];
    setup('/setup');
    expect(await screen.findByLabelText('Nome da empresa')).toHaveAccessibleDescription(
      'No CRM, a empresa aparece como organização, e você pode mudar o nome dela depois em Configurações, na aba ' +
        'Organização. O nome e o logo da tela de entrada e da aba do navegador vêm da configuração feita por quem ' +
        'publicou o CRM e não mudam com ele.',
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
    mock.accessToken = LINK_SESSION;
    mock.status = [company(false)];
    mock.authSignOut.mockResolvedValue({ error: new AuthRetryableFetchError('Failed to fetch', 0) });
    setup('/setup');
    fireEvent.change(await screen.findByLabelText('Nome da empresa'), { target: { value: 'Empresa' } });
    submit('Criar empresa', 'senha-da-conta');
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível falar com o servidor.');
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nome da empresa')).toHaveValue('Empresa');
  });

  it('numa sessão por senha sem a prova do e-mail, pede o link e guarda o nome da empresa', async () => {
    mock.status = [company(false)];
    mock.rpc.mockResolvedValueOnce(refusal(PROOF_REFUSAL.create));
    const { rerender } = setup('/setup');
    fireEvent.change(await screen.findByLabelText('Nome da empresa'), { target: { value: 'Empresa Guardada' } });
    expect(screen.queryByLabelText('Crie sua senha')).not.toBeInTheDocument();
    submit('Criar empresa');
    const panel = await screen.findByRole('region', { name: 'Confirme que o e-mail é seu' });
    expect(panel).toHaveTextContent('Por segurança, criar a empresa exige entrar pelo link enviado ao seu e-mail.');
    expect(screen.queryByLabelText('Nome da empresa')).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Enviar link para o meu e-mail' }));
    await waitFor(() => expect(mock.signInWithOtp).toHaveBeenCalledOnce());
    const back = new URL(mock.signInWithOtp.mock.calls[0][0].options.emailRedirectTo);
    expect(back.pathname).toBe('/');
    expect(back.searchParams.get('invite')).toBeNull();
    // Com a sessão aberta pelo link, o formulário volta com o nome digitado e o campo da senha.
    mock.accessToken = LINK_SESSION;
    rerender();
    expect(screen.getByLabelText('Nome da empresa')).toHaveValue('Empresa Guardada');
    expect(screen.getByLabelText('Crie sua senha')).toBeInTheDocument();
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
