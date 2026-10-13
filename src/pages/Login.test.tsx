import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError } from '@supabase/supabase-js';
import Login from './Login';
import { AUTH_ERROR_MESSAGES } from '@/lib/auth-errors';
import { INCOMPLETE_INVITE_MESSAGE } from '@/lib/invite-link';
import { OFFLINE_AUTH_MESSAGE, OFFLINE_REQUEST_MESSAGE } from '@/lib/offline';

type StatusReply = { data: { has_organization: boolean } | null; error: { code: string; message: string } | null };
const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  toast: vi.fn(),
  // Respostas de public.instance_status, uma por leitura; a última se repete. Uma promessa segura a leitura até o teste
  // resolvê-la.
  status: [] as (StatusReply | 'pending' | Promise<StatusReply>)[],
  statusCalls: 0,
}));
vi.mock('@/integrations/supabase/client', () => ({
  backendConfigured: true,
  supabase: {
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signInWithOtp: mocks.signInWithOtp,
      signUp: mocks.signUp,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
    },
    rpc: (name: string) => ({
      single: () => {
        if (name !== 'instance_status') throw new Error(`RPC inesperada: ${name}`);
        const reply = mocks.status[Math.min(mocks.statusCalls, mocks.status.length - 1)];
        mocks.statusCalls += 1;
        if (reply === 'pending') return new Promise(() => undefined);
        return reply instanceof Promise ? reply : Promise.resolve(reply);
      },
    }),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

const ID = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const company = (has: boolean): StatusReply => ({ data: { has_organization: has }, error: null });
const missingFunction: StatusReply = {
  data: null,
  error: { code: 'PGRST202', message: 'Could not find the function public.instance_status' },
};

function Destination() {
  const location = useLocation();
  return (
    <p>
      destino {location.pathname}
      {location.search} {useNavigationType()}
    </p>
  );
}
function CurrentUrl() {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}${location.hash}`}</span>;
}
function setup(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Releitura da instância, como a do foco na aba depois de 30 s.
  const reread = () => act(() => client.refetchQueries({ queryKey: ['instance-status'] }));
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="*" element={<Destination />} />
        </Routes>
        <CurrentUrl />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { reread, client };
}
const next = (path: string) => `/?next=${encodeURIComponent(path)}`;
const selectedTab = () => screen.getByRole('tab', { selected: true });
const openTab = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }));
const statusRead = () => waitFor(() => expect(mocks.statusCalls).toBeGreaterThan(0));

beforeEach(() => {
  mocks.user = null;
  mocks.signInWithPassword.mockReset().mockResolvedValue({ error: null });
  mocks.signInWithOtp.mockReset().mockResolvedValue({ error: null });
  mocks.signUp.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  mocks.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  mocks.toast.mockReset();
  mocks.status = [company(true)];
  mocks.statusCalls = 0;
});
afterEach(() => window.history.replaceState(null, '', '/'));

describe('retorno ao deep link depois do login', () => {
  it('quem já tem sessão vai direto ao destino guardado, com replace', async () => {
    mocks.user = { id: 'user-1' };
    setup(next('/pipeline?deal=deal-7'));
    expect(await screen.findByText('destino /pipeline?deal=deal-7 REPLACE')).toBeInTheDocument();
  });

  it('ao entrar com senha, navega para o destino validado com replace', async () => {
    setup(next('/pipeline?deal=deal-7'));
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pessoa@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-de-teste' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('destino /pipeline?deal=deal-7 REPLACE')).toBeInTheDocument();
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'pessoa@example.test', password: 'senha-de-teste' });
  });

  it.each([
    '//example.test/roubo',
    'https://example.test/roubo',
    '/\\example.test',
    '/',
    '/.//example.test',
    '/%2e//example.test',
  ])('ignora o destino %s e segue para Hoje', async (target) => {
    mocks.user = { id: 'user-1' };
    setup(next(target));
    expect(await screen.findByText('destino /dashboard REPLACE')).toBeInTheDocument();
  });

  it('com convite, passa pelo aceite levando o destino', async () => {
    mocks.user = { id: 'user-1' };
    setup(`/?invite=${ID}&next=${encodeURIComponent('/pipeline?deal=deal-7')}`);
    expect(
      await screen.findByText(
        `destino /invite?invite=${ID}&next=${encodeURIComponent('/pipeline?deal=deal-7')} REPLACE`,
      ),
    ).toBeInTheDocument();
  });

  it('com sessão, um convite cortado também passa pelo aceite, que explica o link incompleto', async () => {
    mocks.user = { id: 'user-1' };
    setup('/?invite=convite-1');
    expect(await screen.findByText('destino /invite?invite=convite-1 REPLACE')).toBeInTheDocument();
  });

  it('o link por e-mail volta para o login com o convite e o destino', async () => {
    setup(`/?invite=${ID}&next=${encodeURIComponent('/pipeline?deal=deal-7')}`);
    openTab('Link por e-mail');
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'pessoa@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link de acesso' }));
    await waitFor(() => expect(mocks.signInWithOtp).toHaveBeenCalledOnce());
    const redirect = new URL(mocks.signInWithOtp.mock.calls[0][0].options.emailRedirectTo);
    expect(redirect.origin).toBe(window.location.origin);
    expect(redirect.pathname).toBe('/');
    expect(redirect.searchParams.get('invite')).toBe(ID);
    expect(redirect.searchParams.get('next')).toBe('/pipeline?deal=deal-7');
  });
});

describe('estados da entrada (item 1.1)', () => {
  it('enquanto lê a instância, abre em Entrar e o cadastro aguarda a verificação', async () => {
    mocks.status = ['pending'];
    setup('/');
    await statusRead();
    expect(selectedTab()).toHaveTextContent('Entrar');
    openTab('Cadastrar');
    expect(await screen.findByRole('status')).toHaveTextContent('Verificando este CRM…');
    expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument();
  });

  it('sem empresa, abre em Cadastrar com o aviso do primeiro acesso e o formulário de nome e e-mail', async () => {
    mocks.status = [company(false)];
    setup('/');
    expect(await screen.findByText(/Este CRM ainda não tem empresa\. A primeira conta cria a empresa/)).toBeVisible();
    expect(
      screen.getByText(
        'Informe seu nome e e-mail. O CRM envia um link para confirmar o e-mail; depois, você cria sua senha e a empresa.',
      ),
    ).toBeVisible();
    expect(selectedTab()).toHaveTextContent('Cadastrar');
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar link de cadastro' })).toBeInTheDocument();
  });

  it('com convite, abre em Cadastrar com o aviso do convite, sem esperar a leitura da instância', async () => {
    mocks.status = ['pending'];
    setup(`/?invite=${ID.toUpperCase()}`);
    expect(
      screen.getByText(
        'Você recebeu um convite. Informe o e-mail convidado: o CRM envia um link para confirmar o e-mail; depois, você cria sua senha e entra na equipe. Se já tem conta, use a aba “Entrar”.',
      ),
    ).toBeVisible();
    expect(selectedTab()).toHaveTextContent('Cadastrar');
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
  });

  it('com empresa e sem convite, abre em Entrar e o cadastro só explica o convite, sem formulário', async () => {
    setup('/');
    await statusRead();
    expect(selectedTab()).toHaveTextContent('Entrar');
    openTab('Cadastrar');
    expect(
      await screen.findByText('Este CRM aceita novas contas só por convite. Peça o link a quem administra a equipe.'),
    ).toBeVisible();
    expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar link de cadastro' })).not.toBeInTheDocument();
    // O bloco "Recebi um convite" abre junto, com o campo do link.
    expect(screen.getByRole('button', { name: 'Recebi um convite' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Link do convite')).toBeInTheDocument();
  });

  it('sem leitura da instância (banco sem a migração), mostra o formulário de nome e e-mail, sem aviso', async () => {
    mocks.status = [missingFunction];
    setup('/');
    await statusRead();
    expect(selectedTab()).toHaveTextContent('Entrar');
    openTab('Cadastrar');
    expect(await screen.findByLabelText('Nome')).toBeInTheDocument();
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
    expect(screen.queryByText(/aceita novas contas só por convite/)).not.toBeInTheDocument();
  });

  it('um ?invite= cortado mostra o aviso de link incompleto e não vale como convite', async () => {
    setup('/?invite=convite-1');
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(INCOMPLETE_INVITE_MESSAGE);
    await statusRead();
    expect(selectedTab()).toHaveTextContent('Entrar');
    expect(screen.queryByText(/Você recebeu um convite/)).not.toBeInTheDocument();
  });

  it.each([
    ['com empresa e sem convite', '/', [company(true)], false],
    ['sem empresa', '/', [company(false)], true],
    ['com convite', `/?invite=${ID}`, [company(true)], true],
    ['sem leitura da instância', '/', [missingFunction], true],
  ] as const)('o link por e-mail cria conta só quando pode (%s)', async (_label, path, status, create) => {
    mocks.status = [...status];
    setup(path);
    await statusRead();
    await waitFor(() => expect(screen.queryByText('Verificando este CRM…')).not.toBeInTheDocument());
    openTab('Link por e-mail');
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'pessoa@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link de acesso' }));
    await waitFor(() => expect(mocks.signInWithOtp).toHaveBeenCalledOnce());
    expect(mocks.signInWithOtp.mock.calls[0][0].options.shouldCreateUser).toBe(create);
  });

  it.each([
    ['verificando', '/', ['pending']],
    ['sem empresa', '/', [company(false)]],
    ['com convite', `/?invite=${ID}`, [company(true)]],
    ['com empresa', '/', [company(true)]],
    ['sem leitura', '/', [missingFunction]],
  ] as const)(
    '"Recebi um convite" aparece e leva ao convite, mantendo o destino (%s)',
    async (_label, path, status) => {
      mocks.status = [...status];
      const other = '0f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
      setup(`${path}${path.includes('?') ? '&' : '?'}next=${encodeURIComponent('/pipeline?deal=deal-7')}`);
      fireEvent.click(screen.getByRole('button', { name: 'Recebi um convite' }));
      const field = screen.getByLabelText('Link do convite');
      fireEvent.change(field, { target: { value: 'https://crm.example.test/?invite=123' } });
      fireEvent.click(screen.getByRole('button', { name: 'Abrir convite' }));
      expect(await screen.findByText(INCOMPLETE_INVITE_MESSAGE)).toBeVisible();
      fireEvent.change(screen.getByLabelText('Link do convite'), {
        target: { value: ` https://crm.example.test/?invite=${other.toUpperCase()} ` },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Abrir convite' }));
      await waitFor(() =>
        expect(screen.getByTestId('url')).toHaveTextContent(
          `/?invite=${other}&next=${encodeURIComponent('/pipeline?deal=deal-7')}`,
        ),
      );
      expect(await screen.findByText(/Você recebeu um convite/)).toBeVisible();
      expect(selectedTab()).toHaveTextContent('Cadastrar');
    },
  );
});

describe('cadastro pelo link (reforço do item 1.1)', () => {
  const fillSignup = async () => {
    fireEvent.change(await screen.findByLabelText('Nome'), { target: { value: 'Pessoa' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pessoa@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link de cadastro' }));
  };
  const refusedByGate = () =>
    mocks.signInWithOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Database error saving new user', 500, 'unexpected_failure'),
    });

  it.each([
    ['com convite', `/?invite=${ID}&next=${encodeURIComponent('/pipeline?deal=deal-7')}`, [company(true)], ID],
    ['no primeiro acesso', `/?next=${encodeURIComponent('/pipeline?deal=deal-7')}`, [company(false)], null],
    ['sem leitura da instância', `/?next=${encodeURIComponent('/pipeline?deal=deal-7')}`, [missingFunction], null],
  ] as const)(
    'envia o link de cadastro (%s), sem senha, com o nome e o retorno ao convite e ao destino',
    async (_label, path, status, invite) => {
      mocks.status = [...status];
      setup(path);
      if (!invite) {
        await statusRead();
        openTab('Cadastrar');
      }
      await fillSignup();
      expect(await screen.findByText('Confira seu e-mail')).toBeVisible();
      expect(within(screen.getByRole('tabpanel')).getByRole('status')).toHaveTextContent(
        'Enviamos um link para pessoa@example.test. Abra-o para confirmar o e-mail e criar sua senha.',
      );
      expect(mocks.signUp).not.toHaveBeenCalled();
      const [{ email, options }] = mocks.signInWithOtp.mock.calls[0];
      expect(email).toBe('pessoa@example.test');
      expect(options).toMatchObject({ shouldCreateUser: true, data: { name: 'Pessoa' } });
      expect(options).not.toHaveProperty('password');
      const redirect = new URL(options.emailRedirectTo);
      expect(redirect.origin).toBe(window.location.origin);
      expect(redirect.pathname).toBe('/');
      expect(redirect.searchParams.get('invite')).toBe(invite);
      expect(redirect.searchParams.get('next')).toBe('/pipeline?deal=deal-7');
    },
  );

  it('um e-mail que já tem conta recebe a mesma resposta: a aba não diz se a conta existe', async () => {
    // O Auth manda o link de acesso a uma conta confirmada e responde como a um cadastro novo.
    mocks.signInWithOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    setup(`/?invite=${ID}`);
    await fillSignup();
    expect(await screen.findByText('Confira seu e-mail')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/já tem conta/)).not.toBeInTheDocument();
  });

  it('a recusa do portão relê a instância: a empresa criada agora há pouco leva à mensagem do convite', async () => {
    mocks.status = [company(false), company(true)];
    refusedByGate();
    setup('/');
    await fillSignup();
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.notInvited);
    expect(mocks.statusCalls).toBe(2);
    // A aba continua em Cadastrar, agora sem formulário: a instância passou a ser só por convite.
    expect(selectedTab()).toHaveTextContent('Cadastrar');
    expect(screen.getByText(/aceita novas contas só por convite/)).toBeVisible();
  });

  it('na instância ainda vazia, a mesma falha pede para tentar de novo', async () => {
    mocks.status = [company(false)];
    refusedByGate();
    setup('/');
    await fillSignup();
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.signupFailed);
  });

  it('com convite, a recusa do portão pede o e-mail convidado', async () => {
    refusedByGate();
    setup(`/?invite=${ID}`);
    await fillSignup();
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.notInvited);
  });

  it.each([
    ['com convite', `/?invite=${ID}`, [company(true)]],
    ['na instância vazia', '/', [company(false)]],
  ] as const)(
    'falha no envio da confirmação (%s): pede para configurar o e-mail, e não fala em convite',
    async (_label, path, status) => {
      mocks.status = [...status];
      // O Auth hospedado manda o mesmo código da recusa do portão (unexpected_failure).
      mocks.signInWithOtp.mockResolvedValue({
        data: { user: null, session: null },
        error: new AuthApiError('Error sending confirmation email', 500, 'unexpected_failure'),
      });
      setup(path);
      await fillSignup();
      expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.emailNotSent);
    },
  );

  it('o aviso de envio recebe o foco e oferece "Usar outro e-mail", que volta ao formulário com o e-mail digitado', async () => {
    setup(`/?invite=${ID}`);
    await fillSignup();
    const title = await screen.findByRole('heading', { name: 'Confira seu e-mail' });
    expect(title).toHaveFocus();
    expect(within(screen.getByRole('tabpanel')).getByRole('status')).toHaveTextContent(
      'Não chegou em alguns minutos? Confira o spam ou corrija o endereço.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Usar outro e-mail' }));
    const field = await screen.findByLabelText('E-mail');
    expect(field).toHaveValue('pessoa@example.test');
    expect(field).toHaveFocus();
    expect(screen.getByLabelText('Nome')).toHaveValue('Pessoa');
    expect(selectedTab()).toHaveTextContent('Cadastrar');
    fireEvent.change(field, { target: { value: 'pessoa.certa@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link de cadastro' }));
    expect(await screen.findByText('Confira seu e-mail')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Enviamos um link para pessoa.certa@example.test.');
    expect(mocks.signInWithOtp).toHaveBeenCalledTimes(2);
    expect(mocks.signInWithOtp.mock.calls[1][0].email).toBe('pessoa.certa@example.test');
  });

  it('a aba que volta a ser aberta mostra o aviso sem tirar o foco da lista de abas', async () => {
    const { reread } = setup(`/?invite=${ID}`);
    await fillSignup();
    await screen.findByRole('heading', { name: 'Confira seu e-mail' });
    openTab('Entrar');
    openTab('Cadastrar');
    const title = await screen.findByRole('heading', { name: 'Confira seu e-mail' });
    // Outra renderização da tela (a releitura da instância, que agora responde diferente) também não move o foco: só
    // o envio o move.
    mocks.status = [company(false)];
    await reread();
    await waitFor(() => expect(mocks.statusCalls).toBeGreaterThan(1));
    expect(title).not.toHaveFocus();
  });
});

describe('aba estável (achado 1 da revisão do item 1.1)', () => {
  it('a releitura que descobre a empresa recém-criada não troca a aba nem apaga o que foi digitado', async () => {
    mocks.status = [company(false), company(true)];
    const { reread } = setup('/');
    expect(await screen.findByText(/Este CRM ainda não tem empresa/)).toBeVisible();
    expect(selectedTab()).toHaveTextContent('Cadastrar');
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Pessoa' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pessoa@example.test' } });
    await reread();
    expect(mocks.statusCalls).toBe(2);
    expect(selectedTab()).toHaveTextContent('Cadastrar');
    expect(
      await screen.findByText('Este CRM aceita novas contas só por convite. Peça o link a quem administra a equipe.'),
    ).toBeVisible();
    expect(selectedTab()).toHaveTextContent('Cadastrar');
    expect(screen.getByRole('button', { name: 'Recebi um convite' })).toHaveAttribute('aria-expanded', 'true');
    // O e-mail é o mesmo campo das três abas: continua em Entrar.
    openTab('Entrar');
    expect(await screen.findByLabelText('E-mail')).toHaveValue('pessoa@example.test');
  });

  it('o foco num campo durante "Verificando…" fixa a aba, mesmo que a leitura mostre o primeiro acesso', async () => {
    let resolve!: (reply: StatusReply) => void;
    mocks.status = [new Promise<StatusReply>((r) => (resolve = r))];
    const { client } = setup('/');
    await statusRead();
    expect(selectedTab()).toHaveTextContent('Entrar');
    const email = screen.getByLabelText('E-mail');
    fireEvent.focus(email);
    fireEvent.change(email, { target: { value: 'pessoa@example.test' } });
    await act(async () => resolve(company(false)));
    // A leitura chegou à tela (o TanStack Query avisa os componentes na próxima volta do laço de eventos).
    await waitFor(() => expect(client.getQueryData(['instance-status'])).toBe(false));
    await act(() => new Promise((done) => setTimeout(done, 0)));
    expect(selectedTab()).toHaveTextContent('Entrar');
    expect(screen.getByLabelText('E-mail')).toHaveValue('pessoa@example.test');
  });

  it('sem foco, a primeira leitura concluída escolhe a aba, e só um convite novo a escolhe de novo', async () => {
    mocks.status = [company(true), company(false)];
    const { reread } = setup('/');
    await statusRead();
    await waitFor(() => expect(screen.queryByText('Verificando este CRM…')).not.toBeInTheDocument());
    expect(selectedTab()).toHaveTextContent('Entrar');
    await reread();
    expect(mocks.statusCalls).toBe(2);
    expect(selectedTab()).toHaveTextContent('Entrar');
    fireEvent.click(screen.getByRole('button', { name: 'Recebi um convite' }));
    fireEvent.change(screen.getByLabelText('Link do convite'), { target: { value: ID } });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir convite' }));
    expect(await screen.findByText(/Você recebeu um convite/)).toBeVisible();
    expect(selectedTab()).toHaveTextContent('Cadastrar');
  });
});

describe('erros do Auth no formulário', () => {
  const login = async () => {
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pessoa@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-de-teste' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  };

  it('sem conexão, mostra que falta conexão, sem falar em salvar, e fica no login', async () => {
    // O Auth repete a mensagem do OfflineRequestError que o fetch do cliente rejeitou.
    mocks.signInWithPassword.mockResolvedValue({
      error: Object.assign(new Error(OFFLINE_REQUEST_MESSAGE), { name: 'AuthRetryableFetchError' }),
    });
    setup(next('/pipeline?deal=deal-7'));
    await login();
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE_AUTH_MESSAGE);
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeEnabled();
    expect(screen.queryByText(/^destino/)).not.toBeInTheDocument();
  });

  it('senha errada aparece em pt-BR dentro do formulário, ligada ao botão', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    });
    setup('/');
    await login();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(AUTH_ERROR_MESSAGES.invalidCredentials);
    expect(screen.getByRole('button', { name: 'Entrar' })).toHaveAttribute('aria-describedby', alert.id);
    expect(screen.queryByText('Invalid login credentials')).not.toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalled();
    // Trocar de aba limpa o erro.
    openTab('Link por e-mail');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('e-mail não confirmado', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'),
    });
    setup('/');
    await login();
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.emailNotConfirmed);
  });

  it('link por e-mail sem conta, com a entrada só por convite', async () => {
    mocks.signInWithOtp.mockResolvedValue({
      error: new AuthApiError('Signups not allowed for otp', 422, 'otp_disabled'),
    });
    setup('/');
    await statusRead();
    openTab('Link por e-mail');
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'pessoa@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link de acesso' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.noAccountForLink);
  });

  it('link por e-mail de quem já tem conta, com falha no envio: pede para configurar o e-mail', async () => {
    mocks.signInWithOtp.mockResolvedValue({
      error: new AuthApiError('Error sending magic link email', 500, 'unexpected_failure'),
    });
    setup('/');
    await statusRead();
    openTab('Link por e-mail');
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'pessoa@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link de acesso' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.emailNotSent);
    expect(mocks.signInWithOtp.mock.calls[0][0].options.shouldCreateUser).toBe(false);
  });

  it('"Esqueceu a senha?" sem e-mail e com limite de envio mostra o motivo no formulário', async () => {
    setup('/');
    fireEvent.click(screen.getByRole('button', { name: 'Esqueceu a senha?' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Digite seu e-mail no campo acima');
    mocks.resetPasswordForEmail.mockResolvedValue({
      error: new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit'),
    });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pessoa@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Esqueceu a senha?' }));
    expect(await screen.findByText(AUTH_ERROR_MESSAGES.emailRateLimit)).toBeVisible();
  });

  it('link expirado: lê o erro do fragmento, mostra em pt-BR e limpa a URL mantendo convite e destino', async () => {
    window.history.replaceState(
      null,
      '',
      `/?invite=${ID}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
    );
    setup(`/?invite=${ID}&next=${encodeURIComponent('/pipeline')}#error=access_denied&error_code=otp_expired`);
    expect(screen.getByText(AUTH_ERROR_MESSAGES.linkExpired)).toBeVisible();
    await waitFor(() =>
      expect(screen.getByTestId('url')).toHaveTextContent(`/?invite=${ID}&next=${encodeURIComponent('/pipeline')}`),
    );
    expect(screen.getByTestId('url').textContent).not.toMatch(/error/);
  });

  it('o aviso de sucesso do link por e-mail continua no toast', async () => {
    setup('/');
    openTab('Link por e-mail');
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'pessoa@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link de acesso' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Link enviado!' })));
    expect(within(screen.getByRole('tabpanel')).getByText('Verifique seu e-mail')).toBeVisible();
  });

  it('o aviso do link por e-mail guarda o endereço enviado e oferece "Usar outro e-mail"', async () => {
    setup('/');
    openTab('Link por e-mail');
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'errado@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link de acesso' }));
    expect(await screen.findByRole('heading', { name: 'Verifique seu e-mail' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Enviamos um link para errado@example.test.');
    fireEvent.click(screen.getByRole('button', { name: 'Usar outro e-mail' }));
    const field = await screen.findByLabelText('E-mail');
    expect(field).toHaveValue('errado@example.test');
    expect(field).toHaveFocus();
  });
});
