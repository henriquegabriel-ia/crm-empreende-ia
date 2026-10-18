import { expect, test, type Locator, type Page } from './test';
import { installCrmFixture } from './fixture';

// Central de ajuda revisada em 13/10/2026 (roteiro, linha "Ajuda e documentação revisadas"): categorias por tema,
// busca sem acentos nem hífen, nomes da interface em destaque e respostas que dizem quem pode fazer o quê.
async function openHelpFromRail(page: Page) {
  await page.getByRole('button', { name: 'Ajuda', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Ajuda do CRM', exact: true });
  await expect(help.getByRole('heading', { name: 'Perguntas frequentes', exact: true })).toBeVisible();
  return help;
}
const searchBox = (help: Locator) => help.getByRole('searchbox', { name: 'Buscar nas perguntas frequentes' });

test('busca sem acentos, esconde o guia durante a busca e destaca os botões citados', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = await installCrmFixture(page);
  await page.goto('/dashboard');
  const help = await openHelpFromRail(page);
  await expect(help.getByRole('heading', { name: 'Configuração do CRM', exact: true })).toBeVisible();
  for (const category of [
    'Primeiros passos',
    'Entrada, equipe, convites e senha',
    'Privacidade e LGPD',
    'Planilhas, exportação e integrações',
  ])
    await expect(help.getByText(category, { exact: true })).toBeVisible();

  await searchBox(help).fill('email nao chegou');
  await expect(help.getByRole('heading', { name: 'Configuração do CRM', exact: true })).toHaveCount(0);
  await expect(help.getByRole('status')).toHaveText(/respostas? encontradas?$/);
  const question = help.getByRole('button', { name: 'O link do e-mail não chegou. O que faço?', exact: true });
  await question.click();
  const label = help.getByText('“Usar outro e-mail”', { exact: true });
  await expect(label).toBeVisible();
  await expect(label).toHaveClass(/font-medium/);
  await expect(help.getByRole('button', { name: 'Como digito valores em reais?', exact: true })).toHaveCount(0);

  // Item 1.2: quem procura como tirar o acesso de alguém acha a desativação, com os botões da Equipe em destaque.
  await searchBox(help).fill('demitir');
  await help
    .getByRole('button', { name: 'Como desativo quem saiu da equipe e passo a carteira?', exact: true })
    .click();
  await expect(help.getByText('“Quem recebe a carteira”', { exact: true })).toBeVisible();

  // Item 1.10: quem procura pela LGPD acha a categoria nova, com os botões da ficha em destaque.
  await searchBox(help).fill('apagar meus dados');
  await help
    .getByRole('button', { name: 'Uma pessoa pediu para apagar os dados dela. Como faço?', exact: true })
    .click();
  await expect(help.getByText('“Anonimizar contato”', { exact: true }).first()).toBeVisible();
  await searchBox(help).fill('lgpd');
  await expect(help.getByRole('button', { name: 'O CRM cuida da LGPD da empresa?', exact: true })).toBeVisible();

  await searchBox(help).fill('xilofone');
  await expect(help.getByRole('status')).toContainText('Nenhuma resposta encontrada para “xilofone”.');
  await help.getByRole('button', { name: 'Limpar busca', exact: true }).click();
  await expect(help.getByRole('heading', { name: 'Configuração do CRM', exact: true })).toBeVisible();
  // O botão some com o resultado vazio: o foco volta ao campo, e não ao contorno do painel.
  await expect(searchBox(help)).toBeFocused();
  // Só pontuação não é busca: o guia continua na tela.
  await searchBox(help).fill('?');
  await expect(help.getByRole('heading', { name: 'Configuração do CRM', exact: true })).toBeVisible();
  await expect(help.getByRole('status').filter({ hasText: /encontrad/ })).toHaveCount(0);
  // Ler a Ajuda não grava nada.
  expect(fixture.requests.filter((request) => !['GET', 'HEAD'].includes(request.method))).toEqual([]);
});

test('quem tem acesso somente leitura acha por que não edita e quem pode dar acesso', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installCrmFixture(page, { role: 'viewer' });
  await page.goto('/contacts');
  const help = await openHelpFromRail(page);
  await searchBox(help).fill('não consigo editar');
  await help.getByRole('button', { name: 'Por que não consigo criar ou editar um registro?', exact: true }).click();
  await expect(help.getByText(/excluir é só para donos e administradores/)).toBeVisible();
  await searchBox(help).fill('permissão');
  await help.getByRole('button', { name: 'O que cada papel pode fazer?', exact: true }).click();
  const roles = help.getByRole('region', { name: 'O que cada papel pode fazer?', exact: true });
  for (const role of ['“Dono”', '“Administrador”', '“Colaborador”', '“Somente leitura”'])
    await expect(roles.getByText(role, { exact: true })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`celular a 320 px em ${theme}: Central de ajuda pelo menu Mais, sem rolagem lateral`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await installCrmFixture(page, { theme });
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Mais opções', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Central de ajuda', exact: true }).click();
    const help = page.getByRole('dialog', { name: 'Ajuda do CRM', exact: true });
    await expect(help).toBeVisible();
    await searchBox(help).fill('esqueci a senha');
    await help.getByRole('button', { name: 'Esqueci minha senha. O que faço?', exact: true }).click();
    await expect(help.getByText('“Salvar nova senha”', { exact: true })).toBeVisible();
    const geometry = await help.evaluate((element) => ({
      panel: element.getBoundingClientRect().right,
      scroll: element.scrollWidth - element.clientWidth,
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(geometry.panel).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.scroll).toBeLessThanOrEqual(1);
    expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
  });
}
