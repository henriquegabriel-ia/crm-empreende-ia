import { expect, test, type Locator, type Page } from '@playwright/test';
import { createFixture, IDS, installCrmFixture, type FixtureRow, type FixtureState } from './fixture';

// Item 1.1: empresa única com entrada só por convite, e o reforço de 12/10/2026: a conta nasce pelo link enviado ao
// e-mail, cria a senha no CRM e só ganha papel com a prova do e-mail. Roda em desktop e no celular (mobile-chrome).
const INVITE = 'c0ffee00-0000-4000-8000-000000000001';
const OTHER_INVITE = 'c0ffee00-0000-4000-8000-000000000002';
const future = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
const past = () => new Date(Date.now() - 86_400_000).toISOString();
const invitation = (overrides: Partial<FixtureRow> = {}): FixtureRow => ({
  id: INVITE,
  org_id: IDS.org,
  email: 'owner@example.test',
  role: 'member',
  invited_by: IDS.owner,
  accepted_at: null,
  expires_at: future(),
  created_at: past(),
  ...overrides,
});
const MESSAGES = {
  notInvited:
    'Este e-mail não tem convite válido neste CRM. Use o e-mail que recebeu o convite ou peça um novo convite a quem administra.',
  inviteOnly: 'Este CRM aceita novas contas só por convite. Peça o link a quem administra a equipe.',
  incomplete: 'Este link de convite está incompleto. Copie o link inteiro que você recebeu.',
  invited:
    'Você recebeu um convite. Informe o e-mail convidado: o CRM envia um link para confirmar o e-mail; depois, você cria sua senha e entra na equipe. Se já tem conta, use a aba “Entrar”.',
};
const gateRefusal = {
  status: 500,
  body: { code: 'unexpected_failure', error_code: 'unexpected_failure', msg: 'Database error saving new user' },
};
// Com o SMTP mal configurado, o Auth hospedado manda o mesmo código da recusa do portão (internal/api/mail.go).
const emailNotSent = {
  status: 500,
  body: { code: 'unexpected_failure', error_code: 'unexpected_failure', msg: 'Error sending confirmation email' },
};

// "Cadastrar" pede só nome e e-mail e envia o link de cadastro (POST /auth/v1/otp com create_user).
async function fillSignup(page: Page, email = 'owner@example.test') {
  await page.getByLabel('Nome', { exact: true }).fill('Pessoa de Teste');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enviar link de cadastro', exact: true }).click();
}
// Na sessão aberta pelo link, o aceite e a criação da empresa pedem "Crie sua senha" antes de chamar o banco.
async function createPassword(page: Page, password = 'senha-da-conta') {
  await page.getByLabel('Crie sua senha', { exact: true }).fill(password);
}
// Token fictício do link do e-mail.
const TOKEN_HASH = '3f9a1c27b84e5d6030c1f2e4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0';
const verifies = (state: FixtureState) => state.authRequests.filter((request) => request.route === 'verify');
// O link dos modelos de e-mail do CRM (revisão de 13/10/2026) volta à URL pedida com o token no fragmento, e o CRM só o
// confere (POST /auth/v1/verify) depois do toque em "Continuar": abrir a página, como faz um filtro de segurança do
// e-mail, não gasta o token. Aberto a partir do e-mail, é um carregamento novo da página.
async function openEmailLink(page: Page, state: FixtureState, back: URL, type: 'email' | 'recovery' = 'email') {
  const before = verifies(state).length;
  await page.goto('about:blank');
  await page.goto(`${back.pathname}${back.search}#token_hash=${TOKEN_HASH}&type=${type}`);
  const proceed = page.getByRole('button', { name: 'Continuar', exact: true });
  await expect(proceed).toBeVisible();
  expect(verifies(state)).toHaveLength(before);
  await proceed.click();
  await expect.poll(() => verifies(state).length).toBe(before + 1);
  expect(verifies(state).at(-1)?.body).toMatchObject({ token_hash: TOKEN_HASH, type });
}
// O retorno dos modelos padrão do Supabase ({{ .ConfirmationURL }}, o GET /verify do Auth): a sessão no fragmento, no
// fluxo implícito, que o cliente declara.
async function openLegacyEmailLink(page: Page, state: FixtureState, back: URL) {
  await page.goto('about:blank');
  const expires = Math.floor(Date.now() / 1000) + 86_400;
  await page.goto(
    `${back.pathname}${back.search}#access_token=${state.linkAccessToken}&expires_at=${expires}&expires_in=86400&refresh_token=test-refresh-token&token_type=bearer&type=signup`,
  );
}
// Retorno pedido no último POST /auth/v1/otp (o redirect_to do link).
function linkReturn(state: FixtureState) {
  const otp = state.authRequests.filter((request) => request.route === 'otp').at(-1)!;
  return new URL(new URLSearchParams(otp.params).get('redirect_to')!);
}
// A criação da senha (PUT /auth/v1/user) e a saída das outras sessões (POST /auth/v1/logout?scope=others).
function expectPasswordClaimed(state: FixtureState, password = 'senha-da-conta') {
  expect(state.authRequests.find((request) => request.route === 'user' && request.method === 'PUT')?.body).toEqual(
    expect.objectContaining({ password }),
  );
  expect(
    state.authRequests.some(
      (request) =>
        request.route === 'logout' &&
        request.method === 'POST' &&
        new URLSearchParams(request.params).get('scope') === 'others',
    ),
  ).toBe(true);
}
async function expectNoHorizontalScroll(page: Page, label: string) {
  const geometry = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(geometry.scroll, `${label}: documento`).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.body, `${label}: body`).toBeLessThanOrEqual(geometry.width + 1);
}

test('instância vazia: o primeiro cadastro pelo link cria a senha e a empresa, fica com o papel de Dono e abre Hoje', async ({
  page,
}) => {
  // Sem a prova gravada: só a sessão aberta pelo link cria a empresa.
  const state = await installCrmFixture(page, {
    signedIn: false,
    instance: { hasOrganization: false },
    withoutOrganization: true,
    emailProof: false,
  });
  await page.goto('/');
  await expect(page.getByText(/Este CRM ainda não tem empresa\. A primeira conta cria a empresa/)).toBeVisible();
  await expect(
    page.getByText(
      'Informe seu nome e e-mail. O CRM envia um link para confirmar o e-mail; depois, você cria sua senha e a empresa.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Cadastrar' })).toHaveAttribute('aria-selected', 'true');
  await fillSignup(page);
  await expect(page.getByText('Confira seu e-mail', { exact: true })).toBeVisible();
  expect(state.authRequests.find((request) => request.route === 'otp')?.body).toMatchObject({
    email: 'owner@example.test',
    create_user: true,
    data: { name: 'Pessoa de Teste' },
  });
  expect(state.authRequests.some((request) => request.route === 'signup')).toBe(false);
  await openEmailLink(page, state, linkReturn(state));
  await expect(page.getByRole('heading', { name: 'Seu negócio, seu CRM' })).toBeVisible();
  await expect(page.getByText(/Você é a primeira pessoa a entrar neste CRM/)).toBeVisible();
  await page.getByLabel('Nome da empresa').fill('Empresa do Teste');
  await createPassword(page);
  await page.getByRole('button', { name: 'Criar empresa', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Próximos passos do dia', { exact: true })).toBeVisible();
  expectPasswordClaimed(state);
  expect(state.instance.hasOrganization).toBe(true);
  expect(state.tables.user_roles.find((row) => row.user_id === IDS.owner)?.role).toBe('owner');
  expect(state.requests.find((request) => request.table === 'create_workspace')?.body).toEqual({
    p_name: 'Empresa do Teste',
  });
});

test('com empresa e sem convite: o cadastro explica o convite, e "Recebi um convite" leva ao formulário', async ({
  page,
}) => {
  await installCrmFixture(page, { signedIn: false });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Entrar' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Cadastrar' }).click();
  await expect(page.getByText(MESSAGES.inviteOnly, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Nome', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enviar link de cadastro' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Recebi um convite' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('Link do convite').fill('https://crm.example.test/?invite=1234');
  await page.getByRole('button', { name: 'Abrir convite' }).click();
  await expect(page.getByRole('alert').filter({ hasText: MESSAGES.incomplete })).toBeVisible();
  await page.getByLabel('Link do convite').fill(` https://crm.example.test/?invite=${INVITE.toUpperCase()} `);
  await page.getByRole('button', { name: 'Abrir convite' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/' && url.searchParams.get('invite') === INVITE);
  await expect(page.getByText(MESSAGES.invited, { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Cadastrar' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Nome', { exact: true })).toBeVisible();
});

test('convite de ponta a ponta: cadastro pelo link, criação da senha e aceite, voltando ao destino', async ({
  page,
}) => {
  const state = createFixture();
  state.tables.invitations.push(invitation());
  // Conta recém-criada: só a sessão aberta pelo link prova o e-mail (a confirmação grava a prova no banco).
  state.emailProof = false;
  await installCrmFixture(page, { state, signedIn: false, withoutOrganization: true });
  await page.goto(`/?invite=${INVITE}&next=${encodeURIComponent('/pipeline')}`);
  await expect(page.getByRole('tab', { name: 'Cadastrar' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(MESSAGES.invited, { exact: true })).toBeVisible();
  await fillSignup(page);
  await expect(page.getByText('Confira seu e-mail', { exact: true })).toBeVisible();
  await expect(page.getByText(/Abra-o para confirmar o e-mail e criar sua senha\./)).toBeVisible();
  expect(state.authRequests.find((request) => request.route === 'otp')?.body).toMatchObject({
    email: 'owner@example.test',
    create_user: true,
    data: { name: 'Pessoa de Teste' },
  });
  const back = linkReturn(state);
  expect(back.pathname).toBe('/');
  expect(back.searchParams.get('invite')).toBe(INVITE);
  expect(back.searchParams.get('next')).toBe('/pipeline');
  await openEmailLink(page, state, back);
  await expect(page.getByRole('heading', { name: 'Entre na sua equipe' })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === '/invite' && url.searchParams.get('invite') === INVITE);
  // A senha nasce no CRM, depois da prova do e-mail, e as outras sessões são encerradas antes de chamar o banco.
  await expect(page.getByLabel('Crie sua senha', { exact: true })).toBeVisible();
  // O gerenciador de senhas salva a senha nova com o e-mail da conta, do campo de usuário escondido no mesmo formulário.
  await expect(page.locator('form:has(#account-password) input[autocomplete="username"]')).toHaveValue(
    'owner@example.test',
  );
  await createPassword(page, 'senha-do-convidado');
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  await expect(page).toHaveURL(/\/pipeline$/);
  expectPasswordClaimed(state, 'senha-do-convidado');
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline', exact: true })).toBeVisible();
  expect(state.tables.invitations[0].accepted_at).toBeTruthy();
  expect(state.tables.user_roles.find((row) => row.user_id === IDS.owner)?.role).toBe('member');
});

test('cadastro com o e-mail errado: "Usar outro e-mail" volta ao formulário e o novo link vai para o endereço certo', async ({
  page,
}) => {
  const state = createFixture();
  state.tables.invitations.push(invitation());
  await installCrmFixture(page, { state, signedIn: false, withoutOrganization: true });
  await page.goto(`/?invite=${INVITE}`);
  await fillSignup(page, 'owner@exemple.test');
  // O aviso toma o lugar do botão apertado e recebe o foco.
  await expect(page.getByRole('heading', { name: 'Confira seu e-mail', exact: true })).toBeFocused();
  await expect(page.getByText(/Não chegou em alguns minutos\? Confira o spam ou corrija o endereço\./)).toBeVisible();
  await page.getByRole('button', { name: 'Usar outro e-mail' }).click();
  const field = page.getByLabel('E-mail', { exact: true });
  await expect(field).toHaveValue('owner@exemple.test');
  await expect(field).toBeFocused();
  await field.fill('owner@example.test');
  await page.getByRole('button', { name: 'Enviar link de cadastro', exact: true }).click();
  await expect(page.getByText('Confira seu e-mail', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Enviamos um link para owner@example.test.' })).toBeVisible();
  const sent = state.authRequests.filter((request) => request.route === 'otp').map((request) => request.body);
  expect(sent).toEqual([
    expect.objectContaining({ email: 'owner@exemple.test', create_user: true }),
    expect.objectContaining({ email: 'owner@example.test', create_user: true }),
  ]);
});

test('cadastro recusado pelo portão: a mensagem pede o e-mail convidado, em pt-BR', async ({ page }) => {
  const state = createFixture();
  state.authReplies.set('otp', gateRefusal);
  await installCrmFixture(page, { state, signedIn: false });
  await page.goto(`/?invite=${INVITE}`);
  await fillSignup(page, 'outra@example.test');
  await expect(page.getByRole('alert')).toHaveText(MESSAGES.notInvited);
  await expect(page.getByText('Database error saving new user')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enviar link de cadastro' })).toBeEnabled();
});

test('falha no envio do e-mail de confirmação: a mensagem pede o envio de e-mails, e não um convite', async ({
  page,
}) => {
  const state = createFixture();
  state.authReplies.set('otp', emailNotSent);
  await installCrmFixture(page, { state, signedIn: false });
  await page.goto(`/?invite=${INVITE}`);
  await fillSignup(page);
  await expect(page.getByRole('alert')).toHaveText(
    'O CRM ainda não consegue enviar e-mails para este endereço. Avise quem administra: falta configurar o envio de e-mails do Supabase.',
  );
  await expect(page.getByText(MESSAGES.notInvited)).toHaveCount(0);
  await expect(page.getByText('Error sending confirmation email')).toHaveCount(0);
});

test('corrida no cadastro: a empresa criada por outra pessoa leva à mensagem do convite', async ({ page }) => {
  const state = createFixture();
  state.instance.hasOrganization = false;
  // Outra pessoa cria a empresa enquanto o formulário está aberto; o portão então recusa este cadastro.
  state.authReplies.set('otp', () => {
    state.instance.hasOrganization = true;
    return gateRefusal;
  });
  await installCrmFixture(page, { state, signedIn: false });
  await page.goto('/');
  await expect(page.getByText(/Este CRM ainda não tem empresa/)).toBeVisible();
  await fillSignup(page, 'atrasada@example.test');
  await expect(page.getByRole('alert')).toHaveText(MESSAGES.notInvited);
  await expect(page.getByText(MESSAGES.inviteOnly, { exact: true })).toBeVisible();
  expect(state.requests.filter((request) => request.table === 'instance_status').length).toBeGreaterThanOrEqual(2);
});

test('erros do Auth em pt-BR: senha errada, e-mail não confirmado e limite de envio do link', async ({ page }) => {
  const state = createFixture();
  state.authReplies.set('token', {
    status: 400,
    body: { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' },
  });
  await installCrmFixture(page, { state, signedIn: false });
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('senha-errada');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'E-mail ou senha incorretos. Confira e tente de novo, ou use “Esqueceu a senha?”. Se ainda não criou uma senha, entre por “Link por e-mail”.',
  );
  await expect(page.getByText('Invalid login credentials')).toHaveCount(0);
  state.authReplies.set('token', {
    status: 400,
    body: { code: 'email_not_confirmed', error_code: 'email_not_confirmed', msg: 'Email not confirmed' },
  });
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Confirme seu e-mail antes de entrar: abra o link que enviamos. Não recebeu? Peça outro em “Link por e-mail”.',
  );
  state.authReplies.set('otp', {
    status: 429,
    body: {
      code: 'over_email_send_rate_limit',
      error_code: 'over_email_send_rate_limit',
      msg: 'email rate limit exceeded',
    },
  });
  await page.getByRole('tab', { name: 'Link por e-mail' }).click();
  await page.getByLabel('E-mail', { exact: true }).fill('owner@example.test');
  await page.getByRole('button', { name: 'Enviar link de acesso' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Muitos e-mails enviados para este endereço. Aguarde alguns minutos antes de pedir outro.',
  );
  // Com empresa e sem convite, o link por e-mail não cria conta nova.
  expect(state.authRequests.find((request) => request.route === 'otp')?.body).toMatchObject({
    email: 'owner@example.test',
    create_user: false,
  });
});

test('link expirado: a mensagem aparece em pt-BR e a URL fica limpa, mantendo o convite', async ({ page }) => {
  await installCrmFixture(page, { signedIn: false });
  await page.goto(
    `/?invite=${INVITE}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
  );
  await expect(
    page.getByText('O link expirou ou já foi usado. Peça um novo em “Link por e-mail”.', { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    (url) => url.hash === '' && !url.search.includes('error') && url.searchParams.get('invite') === INVITE,
  );
  await expect(page.getByText('Email link is invalid or has expired')).toHaveCount(0);
});

test('conta sem organização numa instância com empresa: falta o convite, e o link colado leva ao aceite', async ({
  page,
}) => {
  const state = createFixture();
  state.tables.invitations.push(invitation());
  // Sessão por senha de uma conta com a prova do e-mail: o aceite não pede a senha de novo.
  await installCrmFixture(page, { state, withoutOrganization: true });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Falta o convite da sua equipe' })).toBeVisible();
  await expect(page.getByText('owner@example.test', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar empresa' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Recebi um convite' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Sair da conta' })).toBeVisible();
  await page.getByLabel('Link do convite').fill(`<https://crm.example.test/?invite=${INVITE.toUpperCase()}>`);
  await page.getByRole('button', { name: 'Abrir convite' }).click();
  await expect(page.getByRole('heading', { name: 'Entre na sua equipe' })).toBeVisible();
  await expect(page.getByLabel('Crie sua senha', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Próximos passos do dia', { exact: true })).toBeVisible();
  expect(state.authRequests.some((request) => request.route === 'user' && request.method === 'PUT')).toBe(false);
});

test('conta antiga, sem a prova do e-mail, entra com senha: o aceite pede o link de acesso e segue por ele', async ({
  page,
}) => {
  const state = createFixture();
  state.tables.invitations.push(invitation());
  await installCrmFixture(page, { state, withoutOrganization: true, emailProof: false });
  await page.goto(`/invite?invite=${INVITE}&next=${encodeURIComponent('/pipeline')}`);
  await expect(page.getByLabel('Crie sua senha', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  const panel = page.getByRole('region', { name: 'Confirme que o e-mail é seu' });
  await expect(panel).toContainText(
    'Por segurança, aceitar o convite exige entrar pelo link enviado ao seu e-mail. Enviaremos um link para owner@example.test; abra-o para continuar.',
  );
  await expect(page.getByRole('button', { name: 'Aceitar convite da equipe' })).toHaveCount(0);
  // O painel toma o lugar do botão apertado: o foco vai para o título dele, e não para o início da página.
  await expect(panel.getByRole('heading', { name: 'Confirme que o e-mail é seu', level: 2 })).toBeFocused();
  await panel.getByRole('button', { name: 'Enviar link para o meu e-mail' }).click();
  await expect(page.getByText('Confira seu e-mail', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Confira seu e-mail', level: 2 })).toBeFocused();
  await expect(page.getByText(/Abra-o neste navegador para continuar\./)).toBeVisible();
  // Se o e-mail não chegar, o aviso pede o link de novo; o anterior deixa de valer.
  await page.getByRole('button', { name: 'Enviar de novo' }).click();
  await expect(
    page.getByText(
      /Enviamos um novo link para owner@example\.test\. Abra-o neste navegador para continuar: o link e o código/,
    ),
  ).toBeVisible();
  expect(state.authRequests.filter((request) => request.route === 'otp')).toHaveLength(2);
  // Sem criar conta, de volta ao convite e ao destino.
  expect(state.authRequests.find((request) => request.route === 'otp')?.body).toMatchObject({
    email: 'owner@example.test',
    create_user: false,
  });
  const back = linkReturn(state);
  expect(back.pathname).toBe('/');
  expect(back.searchParams.get('invite')).toBe(INVITE);
  expect(back.searchParams.get('next')).toBe('/pipeline');
  expect(state.tables.invitations[0].accepted_at).toBeNull();
  await openEmailLink(page, state, back);
  await expect(page.getByRole('heading', { name: 'Entre na sua equipe' })).toBeVisible();
  await createPassword(page, 'senha-nova-da-conta');
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  await expect(page).toHaveURL(/\/pipeline$/);
  expectPasswordClaimed(state, 'senha-nova-da-conta');
  expect(state.tables.invitations[0].accepted_at).toBeTruthy();
});

test('o link do e-mail só é usado no toque: abrir a página, como um filtro de segurança, não gasta o token', async ({
  page,
}) => {
  const state = createFixture();
  state.tables.invitations.push(invitation());
  state.emailProof = false;
  await installCrmFixture(page, { state, signedIn: false, withoutOrganization: true });
  const link = `/?invite=${INVITE}&next=${encodeURIComponent('/pipeline')}#token_hash=${TOKEN_HASH}&type=email`;
  // O filtro abre o link antes da pessoa: a página carrega, e nada é conferido no Auth.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Entrar no CRM' })).toBeVisible();
  await expect(page.getByText(/os filtros de segurança do e-mail, que abrem os links antes de você/)).toBeVisible();
  await page.goto('about:blank');
  expect(verifies(state)).toHaveLength(0);
  // A pessoa abre o mesmo link depois: o token continua valendo, e o toque abre a sessão.
  await page.goto(link);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entre na sua equipe' })).toBeVisible();
  expect(verifies(state)).toHaveLength(1);
  expect(verifies(state)[0].body).toMatchObject({ token_hash: TOKEN_HASH, type: 'email' });
  await expect(page).toHaveURL((url) => url.pathname === '/invite' && !url.hash.includes('token_hash'));
  await createPassword(page);
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  await expect(page).toHaveURL(/\/pipeline$/);
  expectPasswordClaimed(state);
});

test('código do e-mail: digitado no aviso de link enviado, abre a sessão neste aparelho e segue ao aceite', async ({
  page,
}) => {
  const state = createFixture();
  state.tables.invitations.push(invitation());
  state.emailProof = false;
  await installCrmFixture(page, { state, signedIn: false, withoutOrganization: true });
  await page.goto(`/?invite=${INVITE}`);
  await fillSignup(page);
  await expect(page.getByText('Confira seu e-mail', { exact: true })).toBeVisible();
  await page.getByLabel('Código do e-mail').fill('4820 3917');
  await page.getByRole('button', { name: 'Entrar com o código' }).click();
  await expect(page.getByRole('heading', { name: 'Entre na sua equipe' })).toBeVisible();
  expect(verifies(state)).toHaveLength(1);
  expect(verifies(state)[0].body).toMatchObject({ email: 'owner@example.test', token: '48203917', type: 'email' });
  await createPassword(page, 'senha-do-codigo');
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expectPasswordClaimed(state, 'senha-do-codigo');
  expect(state.tables.invitations[0].accepted_at).toBeTruthy();
});

test('código errado e link expirado: os motivos em pt-BR, e a volta à entrada mantém o convite', async ({ page }) => {
  const state = createFixture();
  state.tables.invitations.push(invitation());
  await installCrmFixture(page, { state, signedIn: false, withoutOrganization: true });
  state.authReplies.set('verify', {
    status: 403,
    body: { code: 'otp_expired', error_code: 'otp_expired', msg: 'Token has expired or is invalid' },
  });
  await page.goto(`/?invite=${INVITE}`);
  await fillSignup(page);
  await page.getByLabel('Código do e-mail').fill('12345678');
  await page.getByRole('button', { name: 'Entrar com o código' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Código incorreto, expirado ou já usado. Confira os números do e-mail mais recente ou peça um novo link.',
  );
  // Aberto a partir do e-mail, o link é um carregamento novo da página.
  await page.goto('about:blank');
  await page.goto(`/?invite=${INVITE}#token_hash=${TOKEN_HASH}&type=email`);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'O link expirou ou já foi usado. Peça um novo em “Link por e-mail”.',
  );
  await page.getByRole('button', { name: 'Ir para a tela de entrada' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/' && url.search === `?invite=${INVITE}` && !url.hash);
  await expect(page.getByRole('tab', { name: 'Cadastrar' })).toHaveAttribute('aria-selected', 'true');
});

test('redefinição de senha pelo link: o toque abre a página da senha nova', async ({ page }) => {
  const state = await installCrmFixture(page, { signedIn: false });
  await openEmailLink(page, state, new URL('http://localhost/reset-password'), 'recovery');
  await page.getByLabel('Nova senha').fill('senha-redefinida');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(state.authRequests.find((request) => request.route === 'user' && request.method === 'PUT')?.body).toEqual(
    expect.objectContaining({ password: 'senha-redefinida' }),
  );
});

test('modelos padrão do Supabase: o retorno com a sessão no fragmento continua abrindo o aceite', async ({ page }) => {
  const state = createFixture();
  state.tables.invitations.push(invitation());
  state.emailProof = false;
  await installCrmFixture(page, { state, signedIn: false, withoutOrganization: true });
  await openLegacyEmailLink(page, state, new URL(`http://localhost/?invite=${INVITE}`));
  await expect(page.getByRole('heading', { name: 'Entre na sua equipe' })).toBeVisible();
  await expect(page.getByLabel('Crie sua senha', { exact: true })).toBeVisible();
  expect(verifies(state)).toHaveLength(0);
});

test('na entrada, a releitura no foco que encontra a empresa não troca a aba nem apaga o e-mail', async ({ page }) => {
  // O relógio controlado deixa passar os 30 s da leitura da instância sem esperar por eles.
  await page.clock.install();
  const state = await installCrmFixture(page, { signedIn: false, instance: { hasOrganization: false } });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Cadastrar' })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Nome', { exact: true }).fill('Pessoa de Teste');
  await page.getByLabel('E-mail', { exact: true }).fill('atrasada@example.test');
  const reads = state.requests.filter((request) => request.table === 'instance_status').length;
  // Outra pessoa cria a empresa; a pessoa sai da aba e volta depois de 30 s.
  state.instance.hasOrganization = true;
  await page.clock.fastForward('00:31');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
  await expect(page.getByText(MESSAGES.inviteOnly, { exact: true })).toBeVisible();
  expect(state.requests.filter((request) => request.table === 'instance_status').length).toBeGreaterThan(reads);
  await expect(page.getByRole('tab', { name: 'Cadastrar' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Recebi um convite' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('tab', { name: 'Entrar' }).click();
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('atrasada@example.test');
});

test('aceite recusado: convite expirado, de outro e-mail e não encontrado', async ({ page }) => {
  const state = createFixture();
  state.tables.invitations.push(
    invitation({ expires_at: past() }),
    invitation({ id: OTHER_INVITE, email: 'outra@example.test' }),
  );
  // Sem a prova do e-mail: as recusas do convite vêm antes da prova, então a tela mostra cada uma delas.
  await installCrmFixture(page, { state, withoutOrganization: true, emailProof: false });
  await page.goto(`/invite?invite=${INVITE}`);
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  await expect(page.getByRole('alert')).toHaveText('Este convite expirou. Peça um novo a quem administra.');
  await page.goto(`/invite?invite=${OTHER_INVITE}`);
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Este convite é para outro e-mail. Entre com a conta do e-mail convidado.',
  );
  // Link cortado: o aviso aparece ao abrir, sem o botão de aceite.
  await page.goto('/invite?invite=c0ffee00');
  await expect(page.getByRole('alert')).toHaveText(MESSAGES.incomplete);
  await expect(page.getByRole('button', { name: 'Aceitar convite da equipe' })).toHaveCount(0);
  await page.goto('/invite?invite=c0ffee00-0000-4000-8000-0000000000ff');
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  await expect(page.getByRole('alert')).toContainText('Convite não encontrado.');
  await page.getByRole('link', { name: 'Continuar sem este convite' }).click();
  await expect(page.getByRole('heading', { name: 'Falta o convite da sua equipe' })).toBeVisible();
  expect(state.tables.user_roles.find((row) => row.user_id === IDS.owner)).toBeUndefined();
});

test('corrida na criação: a empresa criada por outra pessoa leva a "Falta o convite"', async ({ page }) => {
  const state = await installCrmFixture(page, { withoutOrganization: true, instance: { hasOrganization: false } });
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Criar empresa', exact: true })).toBeVisible();
  state.instance.hasOrganization = true;
  await page.getByLabel('Nome da empresa').fill('Empresa Atrasada');
  await page.getByRole('button', { name: 'Criar empresa', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Falta o convite da sua equipe' })).toBeVisible();
  await expect(page.getByText('Outra pessoa criou a empresa deste CRM agora há pouco.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar empresa' })).toHaveCount(0);
});

test('Equipe: o dono convida um dono, o convite válido repetido é recusado e o expirado gera novo link', async ({
  page,
}) => {
  const state = createFixture();
  state.tables.invitations.push(
    invitation({ id: OTHER_INVITE, email: 'vencida@example.test', role: 'viewer', expires_at: past() }),
  );
  await installCrmFixture(page, { state });
  await page.goto('/team');
  await page.getByLabel('Papel do convite').selectOption('owner');
  await expect(page.getByText(/Dono tem todos os poderes, inclusive alterar o papel de outros donos/)).toBeVisible();
  await page.getByLabel('E-mail da pessoa').fill('socia@example.test');
  await page.getByRole('button', { name: 'Criar convite' }).click();
  await expect(page.getByLabel('Link do convite')).toHaveValue(/\/\?invite=[0-9a-f-]{36}$/);
  const created = state.tables.invitations.find((row) => row.email === 'socia@example.test');
  expect(created?.role).toBe('owner');
  await expect(page.getByLabel('Link do convite')).toHaveValue(new RegExp(`/\\?invite=${created!.id}$`));
  await page.getByLabel('E-mail da pessoa').fill('SOCIA@example.test');
  await page.getByRole('button', { name: 'Criar convite' }).click();
  await expect(page.getByRole('alert')).toContainText('Já existe um convite válido para este e-mail.');
  // A recusa fica junto do formulário: visível sem rolar, também no celular.
  await expect(page.getByRole('alert')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Criar convite' })).toHaveAccessibleDescription(
    /Já existe um convite válido para este e-mail\./,
  );
  await expect(page.getByLabel('E-mail da pessoa')).toHaveValue('SOCIA@example.test');
  // O aviso de sucesso fica no canto da tela, sobre a lista de convites, até sumir sozinho.
  await expect(page.getByText('Convite criado. Copie o link para compartilhar com a pessoa.')).toBeHidden({
    timeout: 10_000,
  });
  const expiredRow = page.getByText('vencida@example.test', { exact: true }).locator('xpath=../..');
  await expect(expiredRow.getByText(/Expirado/)).toBeVisible();
  await expect(expiredRow.getByRole('button', { name: 'Copiar' })).toHaveCount(0);
  await expiredRow.getByRole('button', { name: 'Gerar novo link' }).click();
  await expect
    .poll(() => state.tables.invitations.find((row) => row.email === 'vencida@example.test')?.id)
    .not.toBe(OTHER_INVITE);
  const renewed = state.tables.invitations.find((row) => row.email === 'vencida@example.test')!;
  expect(state.tables.invitations.some((row) => row.id === OTHER_INVITE)).toBe(false);
  await expect(page.getByLabel('Link do convite')).toHaveValue(new RegExp(`/\\?invite=${renewed.id}$`));
  // Convites só pela RPC: nenhum INSERT direto em invitations.
  expect(state.requests.filter((request) => request.table === 'invitations' && request.method === 'POST')).toEqual([]);
});

test('Equipe: o administrador convida, mas não como dono, e não vê convites de dono', async ({ page }) => {
  const state = createFixture('admin');
  state.tables.invitations.push(
    invitation({ email: 'socia@example.test', role: 'owner' }),
    invitation({ id: OTHER_INVITE, email: 'colega@example.test', role: 'member' }),
  );
  await installCrmFixture(page, { state, role: 'admin' });
  await page.goto('/team');
  const options = page.getByLabel('Papel do convite').locator('option');
  await expect(options).toHaveText(['Colaborador', 'Somente leitura', 'Administrador']);
  // Com o e-mail de um convite de dono, o administrador poderia criar antes a conta do convidado.
  await expect(page.getByText('colega@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('socia@example.test', { exact: true })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 1440, height: 1000 },
  ]) {
    test(`telas de entrada sem rolagem horizontal (${theme}, ${viewport.width}px)`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const state = await installCrmFixture(page, { signedIn: false, theme });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Acesse seu CRM' })).toBeVisible();
      await page.getByRole('tab', { name: 'Cadastrar' }).click();
      await expect(page.getByLabel('Link do convite')).toBeVisible();
      await expectNoHorizontalScroll(page, 'só por convite');
      await page.screenshot({
        path: testInfo.outputPath(`entrada-convite-${theme}-${viewport.width}.png`),
        fullPage: true,
      });
      await page.goto(`/?invite=${INVITE}`);
      await expect(page.getByText(/Você recebeu um convite/)).toBeVisible();
      await expectNoHorizontalScroll(page, 'convite recebido');
      // A tela do toque no link do e-mail (revisão de 13/10/2026), num carregamento novo da página.
      await page.goto('about:blank');
      await page.goto(`/?invite=${INVITE}#token_hash=${TOKEN_HASH}&type=email`);
      await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page, 'toque no link do e-mail');
      await page.screenshot({
        path: testInfo.outputPath(`link-do-email-${theme}-${viewport.width}.png`),
        fullPage: true,
      });
      state.instance.hasOrganization = false;
      await page.goto('/');
      await expect(page.getByText(/Este CRM ainda não tem empresa/)).toBeVisible();
      await expectNoHorizontalScroll(page, 'primeiro acesso');
      await page.screenshot({
        path: testInfo.outputPath(`entrada-primeiro-${theme}-${viewport.width}.png`),
        fullPage: true,
      });
    });

    test(`conta sem organização sem rolagem horizontal (${theme}, ${viewport.width}px)`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const state = createFixture();
      state.tables.invitations.push(invitation());
      await installCrmFixture(page, { state, theme, withoutOrganization: true, emailProof: false });
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: 'Falta o convite da sua equipe' })).toBeVisible();
      await expectNoHorizontalScroll(page, 'falta o convite');
      await page.screenshot({
        path: testInfo.outputPath(`sem-convite-${theme}-${viewport.width}.png`),
        fullPage: true,
      });
      state.instance.hasOrganization = false;
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Seu negócio, seu CRM' })).toBeVisible();
      await expectNoHorizontalScroll(page, 'criar empresa');
      // Conta sem a prova do e-mail numa sessão por senha: o painel da prova e o aviso de link enviado.
      await page.goto(`/invite?invite=${INVITE}`);
      await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
      const panel = page.getByRole('region', { name: 'Confirme que o e-mail é seu' });
      await expect(panel).toBeVisible();
      await expectNoHorizontalScroll(page, 'prova do e-mail');
      await page.screenshot({
        path: testInfo.outputPath(`prova-${theme}-${viewport.width}.png`),
        fullPage: true,
      });
      await panel.getByRole('button', { name: 'Enviar link para o meu e-mail' }).click();
      await expect(page.getByText('Confira seu e-mail', { exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page, 'link enviado');
      await page.screenshot({
        path: testInfo.outputPath(`link-enviado-${theme}-${viewport.width}.png`),
        fullPage: true,
      });
      // Sessão aberta pelo link: o aceite com "Crie sua senha".
      await openEmailLink(page, state, linkReturn(state));
      await expect(page.getByRole('heading', { name: 'Entre na sua equipe' })).toBeVisible();
      await expect(page.getByLabel('Crie sua senha', { exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page, 'aceite');
      await page.screenshot({
        path: testInfo.outputPath(`aceite-${theme}-${viewport.width}.png`),
        fullPage: true,
      });
    });
  }
}

// E-mail longo no celular (revisão do reforço, rodada 2): o endereço quebra dentro do aviso de link enviado e do painel
// da prova, em vez de alargar a tela. São 45 caracteres, mais largos numa linha só que as telas de 320 e de 375 px.
const LONG_EMAIL = 'financeiro.comercial.sp@empresaexemplo.com.br';
// O endereço fica dentro do contorno do aviso: a tela pode não rolar e o texto ainda passar por cima da borda.
async function expectEmailInside(container: Locator, label: string) {
  const email = await container.getByText(LONG_EMAIL, { exact: true }).boundingBox();
  const box = await container.boundingBox();
  expect(email!.x, `${label}: início do e-mail`).toBeGreaterThanOrEqual(box!.x);
  expect(email!.x + email!.width, `${label}: fim do e-mail`).toBeLessThanOrEqual(box!.x + box!.width);
}
// O aviso de link enviado inteiro (a borda tracejada), em volta da região status com o endereço.
async function expectLinkSentFits(page: Page, label: string) {
  const status = page.getByRole('status').filter({ hasText: `Enviamos um link para ${LONG_EMAIL}.` });
  await expect(status).toBeVisible();
  await expectNoHorizontalScroll(page, label);
  await expectEmailInside(status.locator('xpath=..'), label);
}
for (const width of [320, 375]) {
  test(`e-mail longo nos avisos de link enviado da entrada, sem rolagem horizontal (${width}px)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const state = createFixture();
    state.tables.invitations.push(invitation({ email: LONG_EMAIL }));
    await installCrmFixture(page, { state, signedIn: false });
    await page.goto(`/?invite=${INVITE}`);
    await fillSignup(page, LONG_EMAIL);
    await expectLinkSentFits(page, 'cadastro enviado');
    await page.screenshot({ path: testInfo.outputPath(`cadastro-enviado-longo-${width}.png`), fullPage: true });
    await page.getByRole('tab', { name: 'Link por e-mail' }).click();
    await page.getByLabel('E-mail', { exact: true }).fill(LONG_EMAIL);
    await page.getByRole('button', { name: 'Enviar link de acesso' }).click();
    await expectLinkSentFits(page, 'link de acesso enviado');
  });

  test(`e-mail longo na conta sem organização, sem rolagem horizontal (${width}px)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const state = createFixture();
    state.tables.invitations.push(invitation({ email: LONG_EMAIL }));
    await installCrmFixture(page, { state, withoutOrganization: true, emailProof: false, email: LONG_EMAIL });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Falta o convite da sua equipe' })).toBeVisible();
    await expectNoHorizontalScroll(page, 'falta o convite');
    await expectEmailInside(page.locator('main'), 'falta o convite');
    await page.goto(`/invite?invite=${INVITE}`);
    await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
    const panel = page.getByRole('region', { name: 'Confirme que o e-mail é seu' });
    await expect(panel).toBeVisible();
    await expectNoHorizontalScroll(page, 'prova do e-mail');
    await expectEmailInside(panel, 'prova do e-mail');
    await panel.getByRole('button', { name: 'Enviar link para o meu e-mail' }).click();
    await expectLinkSentFits(page, 'link enviado');
    await page.screenshot({ path: testInfo.outputPath(`link-enviado-longo-${width}.png`), fullPage: true });
  });
}
