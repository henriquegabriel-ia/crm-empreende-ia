import { expect, test, type Page } from '@playwright/test';
import { createFixture, IDS, installCrmFixture, type FixtureRow, type FixtureState } from './fixture';

// Item 1.1: empresa única com entrada só por convite. Roda em desktop e no celular (projeto mobile-chrome).
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

async function fillSignup(page: Page, email = 'owner@example.test') {
  await page.getByLabel('Nome', { exact: true }).fill('Pessoa de Teste');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('senha-de-teste');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
}
// Aceite e criação da empresa pedem a senha da conta antes de chamar o banco.
async function confirmPassword(page: Page, password = 'senha-da-conta') {
  await page.getByLabel('Senha da conta', { exact: true }).fill(password);
}
// A troca de senha (PUT /auth/v1/user) e a saída das outras sessões (POST /auth/v1/logout?scope=others).
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

test('instância vazia: o primeiro cadastro cria a empresa, fica com o papel de Dono e abre Hoje', async ({ page }) => {
  const state = await installCrmFixture(page, {
    signedIn: false,
    instance: { hasOrganization: false },
    withoutOrganization: true,
  });
  await page.goto('/');
  await expect(page.getByText(/Este CRM ainda não tem empresa\. A primeira conta cria a empresa/)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Cadastrar' })).toHaveAttribute('aria-selected', 'true');
  await fillSignup(page);
  await expect(page.getByRole('heading', { name: 'Seu negócio, seu CRM' })).toBeVisible();
  await expect(page.getByText(/Você é a primeira pessoa a entrar neste CRM/)).toBeVisible();
  await page.getByLabel('Nome da empresa').fill('Empresa do Teste');
  await confirmPassword(page);
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
  await expect(page.getByRole('button', { name: 'Criar conta' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Recebi um convite' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('Link do convite').fill('https://crm.example.test/?invite=1234');
  await page.getByRole('button', { name: 'Abrir convite' }).click();
  await expect(page.getByRole('alert').filter({ hasText: MESSAGES.incomplete })).toBeVisible();
  await page.getByLabel('Link do convite').fill(` https://crm.example.test/?invite=${INVITE.toUpperCase()} `);
  await page.getByRole('button', { name: 'Abrir convite' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/' && url.searchParams.get('invite') === INVITE);
  await expect(page.getByText(/Você recebeu um convite\. Crie sua conta com o e-mail convidado/)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Cadastrar' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Nome', { exact: true })).toBeVisible();
});

test('convite de ponta a ponta: cadastro, confirmação do e-mail e aceite, voltando ao destino', async ({ page }) => {
  const state = createFixture();
  state.tables.invitations.push(invitation());
  // Com a confirmação de e-mail ligada, o cadastro devolve o usuário sem sessão.
  state.authReplies.set('signup', (body) => ({
    status: 200,
    body: {
      id: IDS.owner,
      aud: 'authenticated',
      role: '',
      email: (body as { email: string }).email,
      identities: [{ id: IDS.owner, user_id: IDS.owner, provider: 'email', identity_data: {} }],
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  }));
  await installCrmFixture(page, { state, signedIn: false, withoutOrganization: true });
  await page.goto(`/?invite=${INVITE}&next=${encodeURIComponent('/pipeline')}`);
  await expect(page.getByRole('tab', { name: 'Cadastrar' })).toHaveAttribute('aria-selected', 'true');
  await fillSignup(page);
  await expect(page.getByText('Confira seu e-mail', { exact: true })).toBeVisible();
  const signup = state.authRequests.find((request) => request.route === 'signup')!;
  const back = new URL(new URLSearchParams(signup.params).get('redirect_to')!);
  expect(back.pathname).toBe('/');
  expect(back.searchParams.get('invite')).toBe(INVITE);
  expect(back.searchParams.get('next')).toBe('/pipeline');
  // O link de confirmação volta à raiz com a sessão no fragmento (fluxo implícito, o padrão do cliente). Aberto a
  // partir do e-mail, é um carregamento novo da página, e não só a troca do fragmento.
  await page.goto('about:blank');
  const expires = Math.floor(Date.now() / 1000) + 86_400;
  await page.goto(
    `${back.pathname}${back.search}#access_token=${state.accessToken}&expires_at=${expires}&expires_in=86400&refresh_token=test-refresh-token&token_type=bearer&type=signup`,
  );
  await expect(page.getByRole('heading', { name: 'Entre na sua equipe' })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === '/invite' && url.searchParams.get('invite') === INVITE);
  // Outra pessoa pode ter criado esta conta antes, com uma senha própria: o aceite troca a senha e encerra as outras
  // sessões antes de chamar o banco.
  await confirmPassword(page, 'senha-do-convidado');
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  await expect(page).toHaveURL(/\/pipeline$/);
  expectPasswordClaimed(state, 'senha-do-convidado');
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline', exact: true })).toBeVisible();
  expect(state.tables.invitations[0].accepted_at).toBeTruthy();
  expect(state.tables.user_roles.find((row) => row.user_id === IDS.owner)?.role).toBe('member');
});

test('cadastro recusado pelo portão: a mensagem pede o e-mail convidado, em pt-BR', async ({ page }) => {
  const state = createFixture();
  state.authReplies.set('signup', gateRefusal);
  await installCrmFixture(page, { state, signedIn: false });
  await page.goto(`/?invite=${INVITE}`);
  await fillSignup(page, 'outra@example.test');
  await expect(page.getByRole('alert')).toHaveText(MESSAGES.notInvited);
  await expect(page.getByText('Database error saving new user')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Criar conta' })).toBeEnabled();
});

test('falha no envio do e-mail de confirmação: a mensagem pede o envio de e-mails, e não um convite', async ({
  page,
}) => {
  const state = createFixture();
  state.authReplies.set('signup', emailNotSent);
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
  state.authReplies.set('signup', () => {
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
    'E-mail ou senha incorretos. Confira e tente de novo, ou use “Esqueceu a senha?”.',
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
  await confirmPassword(page);
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Próximos passos do dia', { exact: true })).toBeVisible();
});

test('aceite recusado: convite expirado, de outro e-mail e não encontrado', async ({ page }) => {
  const state = createFixture();
  state.tables.invitations.push(
    invitation({ expires_at: past() }),
    invitation({ id: OTHER_INVITE, email: 'outra@example.test' }),
  );
  await installCrmFixture(page, { state, withoutOrganization: true });
  await page.goto(`/invite?invite=${INVITE}`);
  await confirmPassword(page);
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  await expect(page.getByRole('alert')).toHaveText('Este convite expirou. Peça um novo a quem administra.');
  await page.goto(`/invite?invite=${OTHER_INVITE}`);
  await confirmPassword(page);
  await page.getByRole('button', { name: 'Aceitar convite da equipe' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Este convite é para outro e-mail. Entre com a conta do e-mail convidado.',
  );
  // Link cortado: o aviso aparece ao abrir, sem o botão de aceite.
  await page.goto('/invite?invite=c0ffee00');
  await expect(page.getByRole('alert')).toHaveText(MESSAGES.incomplete);
  await expect(page.getByRole('button', { name: 'Aceitar convite da equipe' })).toHaveCount(0);
  await page.goto('/invite?invite=c0ffee00-0000-4000-8000-0000000000ff');
  await confirmPassword(page);
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
  await confirmPassword(page);
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
      const state = await installCrmFixture(page, { theme, withoutOrganization: true });
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
      await page.goto(`/invite?invite=${INVITE}`);
      await expect(page.getByRole('heading', { name: 'Entre na sua equipe' })).toBeVisible();
      await expect(page.getByLabel('Senha da conta', { exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page, 'aceite');
      await page.screenshot({
        path: testInfo.outputPath(`aceite-${theme}-${viewport.width}.png`),
        fullPage: true,
      });
    });
  }
}
