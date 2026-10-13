import { test, expect, type Page } from '@playwright/test';
import { IDS, installCrmFixture } from './fixture';

const OFFLINE_BANNER = 'Sem conexão. As alterações não serão salvas até a conexão voltar.';
const OFFLINE_REQUEST =
  'Sem conexão com a internet. Nada foi salvo nem enviado; tente novamente quando a conexão voltar.';

/**
 * Navegação dentro do app, como um <Link>: o React Router troca a rota sem recarregar a página, então o
 * RouteTransition monta a próxima tela escondida antes de mostrá-la. Um page.goto recarregaria tudo e não passaria
 * por essa transição.
 */
async function navigateInApp(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test('?create=1 abre o formulário do Pipeline vindo de outra tela, pela ação rápida', async ({ page }) => {
  const state = await installCrmFixture(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Próximos passos do dia', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ações rápidas', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Nova oportunidade', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Nova oportunidade' });
  await expect(form).toBeVisible();
  await expect(page).toHaveURL(/\/pipeline\?create=1$/);
  await form.getByLabel('Nome da oportunidade *', { exact: true }).fill('Vinda de Hoje');
  await form.getByRole('button', { name: 'Criar oportunidade', exact: true }).click();
  // Ao criar, o parâmetro sai da URL e o detalhe da oportunidade criada abre no lugar do formulário.
  await expect(page.getByRole('dialog', { name: 'Vinda de Hoje' })).toBeVisible();
  const created = state.tables.deals.find((deal) => deal.title === 'Vinda de Hoje')!;
  await expect(page).toHaveURL(new RegExp(`deal=${created.id}`));
  await expect(page).not.toHaveURL(/create=1/);
});

test('?create=1 abre o formulário do Pipeline e do Financeiro numa navegação dentro do app', async ({ page }) => {
  const state = await installCrmFixture(page);
  await page.goto('/contacts');
  await expect(page.getByText('Contato Alfa', { exact: true })).toBeVisible();
  await navigateInApp(page, '/pipeline?create=1');
  await expect(page.getByRole('dialog', { name: 'Nova oportunidade' })).toBeVisible();
  // Cancelar tira o parâmetro, então voltar à tela não reabre o formulário.
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Nova oportunidade' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/pipeline$/);
  // O botão da tela usa o mesmo parâmetro.
  await page.getByRole('button', { name: 'Nova oportunidade', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Nova oportunidade' })).toBeVisible();
  await expect(page).toHaveURL(/\/pipeline\?create=1$/);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await navigateInApp(page, '/financeiro?create=1');
  const payment = page.getByRole('dialog', { name: 'Novo lançamento' });
  await expect(payment).toBeVisible();
  await payment.getByLabel('Descrição *', { exact: true }).fill('Vindo do Pipeline');
  await payment.getByLabel('Valor *', { exact: true }).fill('150,00');
  await payment.getByRole('button', { name: 'Salvar lançamento', exact: true }).click();
  // Ao salvar, ?create=1 vira ?payment= e o lançamento criado abre no painel.
  await expect(page.getByRole('dialog', { name: 'Vindo do Pipeline' })).toBeVisible();
  const created = state.tables.payments.find((row) => row.description === 'Vindo do Pipeline')!;
  await expect(page).toHaveURL(new RegExp(`/financeiro\\?payment=${created.id}$`));
});

test('viewer em rota guardada vê a explicação, e as telas em modo leitura continuam abertas', async ({ page }) => {
  const state = await installCrmFixture(page, { role: 'viewer' });
  await page.goto('/dashboard');
  await expect(page.getByText('Próximos passos do dia', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Integrações', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Integrações', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Esta tela é para donos, administradores e colaboradores', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Seu papel nesta organização: Somente leitura\./)).toBeVisible();
  // A tela guardada nem é carregada.
  await expect(page.getByRole('heading', { name: 'Contatos por CSV', exact: true })).toHaveCount(0);

  // Equipe fica aberta em modo leitura: mostra a quem pedir outro acesso, sem convidar nem ler os convites.
  await page.getByRole('link', { name: 'Equipe', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Equipe', exact: true })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Pessoa de Teste' })).toContainText('Dono');
  await expect(page.getByRole('article').filter({ hasText: 'Leitor de Teste (você)' })).toContainText(
    'Somente leitura',
  );
  await expect(page.getByText(/Convidar pessoas e alterar papéis fica com donos e administradores\./)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Convidar uma pessoa', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Alterar papel', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Esta tela é para/)).toHaveCount(0);
  // Os convites (e-mails e links) não são lidos por quem não os gerencia.
  expect(state.requests.filter((request) => request.table === 'invitations')).toEqual([]);

  // Modo leitura útil: automações e execuções, configurações para consulta e as próprias sessões.
  for (const [path, title, text] of [
    ['/automations', 'Automações', 'Retorno após criação'],
    ['/settings?tab=pipelines', 'Configurações', 'Somente donos e administradores podem alterar estas configurações.'],
    ['/settings/security', 'Segurança', 'Encerrar todas as sessões'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/Esta tela é para/)).toHaveCount(0);
  }

  await page.goto('/settings/integrations');
  await page.getByRole('link', { name: 'Ir para Hoje', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Próximos passos do dia', { exact: true })).toBeVisible();
});

test('colaborador vê a Equipe em modo leitura e usa Integrações', async ({ page }) => {
  const state = await installCrmFixture(page, { role: 'member' });
  await page.goto('/team');
  await expect(page.getByRole('article').filter({ hasText: 'Pessoa de Teste (você)' })).toContainText('Colaborador');
  await expect(page.getByRole('article').filter({ hasText: 'Leitor de Teste' })).toContainText('Somente leitura');
  await expect(page.getByRole('heading', { name: 'Convidar uma pessoa', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Esta tela é para/)).toHaveCount(0);
  expect(state.requests.filter((request) => request.table === 'invitations')).toEqual([]);
  await page.goto('/settings/integrations');
  await expect(page.getByRole('heading', { name: 'Contatos por CSV', exact: true })).toBeVisible();
  await expect(page.getByText(/Esta tela é para/)).toHaveCount(0);
});

test('deep link sem sessão volta ao destino depois do login, com replace', async ({ page }) => {
  await installCrmFixture(page, { signedIn: false });
  const target = `/pipeline?deal=${IDS.deal}`;
  await page.goto(target);
  await expect(page).toHaveURL((url) => url.pathname === '/' && url.searchParams.get('next') === target);
  await expect(page.getByRole('heading', { name: 'Acesse seu CRM', exact: true })).toBeVisible();
  const historyLength = await page.evaluate(() => history.length);
  await page.getByLabel('E-mail', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('senha-de-teste');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/pipeline\\?deal=${IDS.deal}$`));
  await expect(page.getByRole('dialog', { name: 'Projeto Exemplo' })).toBeVisible();
  // Redirecionamento e retorno com replace: o login não fica no histórico.
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
});

test('?next= que aponta para outro site é ignorado e o login segue para Hoje', async ({ page }) => {
  await installCrmFixture(page);
  const external = [
    '//example.test/roubo',
    'https://example.test/roubo',
    '/\\example.test',
    // Segmentos de ponto que, normalizados, viram "//example.test".
    '/.//example.test/roubo',
    '/%2e//example.test',
    '/pipeline/..//example.test',
  ];
  for (const next of external) {
    await page.goto(`/?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('Próximos passos do dia', { exact: true })).toBeVisible();
  }
  // No convite recusado, "Continuar no meu CRM" também não leva a outro site.
  await page.goto(`/invite?invite=convite-1&next=${encodeURIComponent('/.//example.test/roubo')}`);
  await expect(page.getByRole('heading', { name: 'Você já está na equipe', exact: true })).toBeVisible();
  const proceed = page.getByRole('link', { name: 'Continuar no meu CRM', exact: true });
  await expect(proceed).toHaveAttribute('href', '/dashboard');
  await proceed.click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('Sair da conta e entrar de novo abre Hoje, e não a tela de quem saiu', async ({ page }) => {
  await installCrmFixture(page);
  await page.goto('/contacts?q=Alfa');
  await expect(page.getByText('Contato Alfa', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conta', exact: true }).click();
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Acesse seu CRM', exact: true })).toBeVisible();
  // O login não guarda a tela nem a busca de quem saiu.
  await expect(page).toHaveURL((url) => url.pathname === '/' && url.search === '');
  await page.getByLabel('E-mail', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('senha-de-teste');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Próximos passos do dia', { exact: true })).toBeVisible();
});

test('sem conexão, o aviso é honesto e a gravação falha na hora com mensagem clara', async ({ page, context }) => {
  const state = await installCrmFixture(page);
  await page.goto(`/pipeline?deal=${IDS.deal}`);
  const detail = page.getByRole('dialog', { name: 'Projeto Exemplo' });
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Editar', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Editar oportunidade' });
  await form.getByLabel('Nome da oportunidade *', { exact: true }).fill('Projeto sem conexão');

  await context.setOffline(true);
  const banner = page.getByRole('alert').filter({ hasText: OFFLINE_BANNER });
  await expect(banner).toBeVisible();
  await expect(page.getByText(/sincroniza/i)).toHaveCount(0);
  const writes = () => state.requests.filter((request) => !['GET', 'HEAD'].includes(request.method)).length;
  const before = writes();
  await form.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(form.getByText(OFFLINE_REQUEST, { exact: true })).toBeVisible();
  // A requisição nem saiu: nada chegou à API, o registro não mudou e o preenchimento ficou no formulário.
  expect(writes()).toBe(before);
  expect(state.tables.deals.find((deal) => deal.id === IDS.deal)?.title).toBe('Projeto Exemplo');
  await expect(form.getByLabel('Nome da oportunidade *', { exact: true })).toHaveValue('Projeto sem conexão');

  await context.setOffline(false);
  await expect(banner).toHaveCount(0);
});

test('página inexistente leva para Hoje', async ({ page }) => {
  await installCrmFixture(page);
  await page.goto('/pagina-que-nao-existe');
  await expect(page.getByRole('heading', { name: 'Página não encontrada', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Ir para Hoje', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Próximos passos do dia', { exact: true })).toBeVisible();
});
