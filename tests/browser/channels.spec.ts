import { expect, test, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  CHANNEL_IDS,
  createFixture,
  IDS,
  installCrmFixture,
  withChannels,
  type FixtureRole,
  type FixtureState,
} from './fixture';
import { expectTouchTarget, touchRow } from './touch';

// Item 1.9 (docs/arquitetura/1.9.md, seção 11.4): canais nível 1 com registro, no desktop e no celular (o projeto
// mobile-chrome inclui este arquivo). O CRM abre o aplicativo da pessoa (wa.me, Gmail, Outlook web, mailto: e tel:) e
// oferece registrar a interação; nada é enviado. As páginas externas são atendidas por uma página vazia, e os links tel:
// e mailto: são cancelados por um ouvinte de clique em window (fase de bolha, depois do React), que guarda o endereço
// para o teste conferir.

const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile-chrome';
const ANA = 'Ana Souza';
const STORAGE_PREFIX = 'empreende-crm:interactions:v1:';

async function setup(page: Page, role: FixtureRole = 'owner', prepare?: (state: FixtureState) => void) {
  const state = withChannels(createFixture(role));
  prepare?.(state);
  await installCrmFixture(page, { role, state });
  const context = page.context();
  for (const host of ['https://wa.me/**', 'https://mail.google.com/**', 'https://outlook.office.com/**'])
    await context.route(host, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Aplicativo externo</p>' }),
    );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    const opened: string[] = [];
    (window as unknown as { __appLinks: string[] }).__appLinks = opened;
    window.addEventListener('click', (event) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (anchor && /^(tel|mailto):/.test(anchor.getAttribute('href') ?? '')) {
        event.preventDefault();
        opened.push(anchor.getAttribute('href')!);
      }
    });
  });
  return state;
}
const appLinks = (page: Page) => page.evaluate(() => (window as unknown as { __appLinks: string[] }).__appLinks);
const stored = (page: Page) =>
  page.evaluate((prefix) => {
    const entry = Object.entries(sessionStorage).find(([key]) => key.startsWith(prefix));
    return entry ? (JSON.parse(entry[1]) as Record<string, string | null>[]) : [];
  }, STORAGE_PREFIX);
const writes = (state: FixtureState, table: string) =>
  state.requests.filter((request) => request.table === table && !['GET', 'HEAD'].includes(request.method));
// A área de transferência do Windows guarda as quebras como \r\n.
const clipboard = async (page: Page) =>
  (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

/** A aba nova aberta pelo clique, com o endereço exato. */
async function popupFrom(context: BrowserContext, click: () => Promise<void>) {
  const [popup] = await Promise.all([context.waitForEvent('page'), click()]);
  await popup.waitForLoadState('domcontentloaded');
  const url = popup.url();
  await popup.close();
  return url;
}

async function openContact(page: Page, id: string) {
  await page.goto(`/contacts?contact=${id}`);
  const panel = page.getByRole('dialog').filter({ has: page.getByText('Relacionamento 360') });
  await expect(panel).toBeVisible();
  return panel;
}
/** Espera a animação de entrada do painel ou do diálogo terminar, para a captura mostrar a posição final. */
const settled = (locator: Locator) =>
  locator.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((item) => item.finished)));
const channelBar = (scope: Locator, name: string) => scope.getByRole('group', { name: `Canais de ${name}` });
async function callMenu(page: Page, scope: Locator, item: 'Ligar' | 'Copiar número' | 'Registrar ligação') {
  await scope.getByRole('button', { name: 'Ligar', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
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

test.describe('ficha 360: telefone e WhatsApp', () => {
  test('o telefone aparece no formato brasileiro e o WhatsApp abre com o modelo preenchido', async ({ page }) => {
    const state = await setup(page);
    const panel = await openContact(page, CHANNEL_IDS.ana);
    await expect(panel.getByText('(11) 99999-0000', { exact: true })).toBeVisible();
    await expect(panel.getByText('+5511999990000')).toHaveCount(0);
    await channelBar(panel, ANA).getByRole('button', { name: 'WhatsApp' }).click();
    const compose = page.getByRole('dialog', { name: 'Mensagem por WhatsApp' });
    await expect(compose).toContainText('Ana Souza · (11) 99999-0000');
    await compose.getByLabel('Modelo').click();
    await page.getByRole('option', { name: 'Primeiro contato' }).click();
    const text = 'Olá, Ana! Aqui é Pessoa de Teste, da Organização de Teste A. Podemos falar sobre Site novo?';
    await expect(compose.getByLabel('Texto')).toHaveValue(text);
    const link = compose.getByRole('link', { name: 'Abrir no WhatsApp' });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    const url = await popupFrom(page.context(), () => link.click());
    expect(url).toBe(`https://wa.me/5511999990000?text=${encodeURIComponent(text)}`);
    await expect(compose).toBeHidden();
    // A pendência nasce na própria ficha, sem nome nem texto no armazenamento da aba.
    await expect(panel.getByText(/WhatsApp aberto às \d{2}:\d{2}/)).toBeVisible();
    const raw = await page.evaluate(
      (prefix) => Object.entries(sessionStorage).find(([key]) => key.startsWith(prefix))?.[1] ?? '',
      STORAGE_PREFIX,
    );
    expect(raw).not.toBe('');
    expect(raw).not.toMatch(/Ana|Souza|5511|example|Olá|Site novo/);
    expect(writes(state, 'activities')).toEqual([]);
  });

  test('variável sem dado bloqueia a abertura até a pessoa apagar', async ({ page }) => {
    await setup(page);
    const panel = await openContact(page, CHANNEL_IDS.ana);
    await channelBar(panel, ANA).getByRole('button', { name: 'WhatsApp' }).click();
    const compose = page.getByRole('dialog', { name: 'Mensagem por WhatsApp' });
    await compose.getByLabel('Modelo').click();
    await page.getByRole('option', { name: 'Com cupom' }).click();
    await expect(compose.getByText('Complete ou apague antes de abrir:')).toBeVisible();
    await expect(compose.getByText('{{cupom}}', { exact: true })).toBeVisible();
    const blocked = compose.getByRole('button', { name: 'Abrir no WhatsApp' });
    await expect(blocked).toBeDisabled();
    await expect(blocked).toHaveAccessibleDescription(/Complete ou apague antes de abrir/);
    await compose.getByLabel('Texto').fill('Olá, Ana. Use o cupom BEMVINDA.');
    await expect(compose.getByRole('link', { name: 'Abrir no WhatsApp' })).toBeVisible();
    await expect(compose.getByText('Complete ou apague antes de abrir:')).toHaveCount(0);
  });

  test('número fixo mostra o aviso sem bloquear; sem telefone ou com e-mail inválido, o botão diz o motivo', async ({
    page,
  }) => {
    await setup(page);
    let panel = await openContact(page, CHANNEL_IDS.bruno);
    await expect(panel.getByText('(11) 3000-0000', { exact: true })).toBeVisible();
    await channelBar(panel, 'Bruno Fixo').getByRole('button', { name: 'WhatsApp' }).click();
    const compose = page.getByRole('dialog', { name: 'Mensagem por WhatsApp' });
    await expect(compose).toContainText('Número fixo: o WhatsApp só funciona se esse número usar o WhatsApp Business.');
    await compose.getByLabel('Texto').fill('Bom dia!');
    const url = await popupFrom(page.context(), () => compose.getByRole('link', { name: 'Abrir no WhatsApp' }).click());
    expect(url).toBe('https://wa.me/551130000000?text=Bom%20dia!');
    // Sem e-mail: o botão fica desabilitado e diz por quê.
    const email = channelBar(panel, 'Bruno Fixo').getByRole('button', { name: 'E-mail' });
    await expect(email).toBeDisabled();
    await expect(email).toHaveAccessibleDescription('Cadastre um e-mail no contato para escrever a ele.');
    panel = await openContact(page, CHANNEL_IDS.diego);
    const bar = channelBar(panel, 'Diego Sem Telefone');
    for (const name of ['WhatsApp', 'Ligar']) {
      await expect(bar.getByRole('button', { name, exact: true })).toBeDisabled();
      await expect(bar.getByRole('button', { name, exact: true })).toHaveAccessibleDescription(
        'Cadastre um telefone para usar o WhatsApp e a ligação.',
      );
    }
    await expect(bar.getByRole('button', { name: 'E-mail' })).toHaveAccessibleDescription(
      'Confira o e-mail no cadastro: ele precisa ser um endereço só, como nome@empresa.com.br.',
    );
  });
});

// Achado 3 da revisão do item 1.9: um número de outro país em E.164 habilita a barra, avisa no diálogo e abre o wa.me
// com o código do país.
test.describe('número de outro país', () => {
  test('a barra fica habilitada, o diálogo avisa e o wa.me leva o código do país', async ({ page }) => {
    await setup(page);
    const panel = await openContact(page, CHANNEL_IDS.gina);
    await expect(panel.getByText('+14155550100', { exact: true })).toBeVisible();
    const bar = channelBar(panel, 'Gina Exterior');
    for (const name of ['WhatsApp', 'Ligar'])
      await expect(bar.getByRole('button', { name, exact: true })).toBeEnabled();
    await bar.getByRole('button', { name: 'WhatsApp' }).click();
    const compose = page.getByRole('dialog', { name: 'Mensagem por WhatsApp' });
    await expect(compose.getByRole('status')).toHaveText('Número de outro país.');
    await compose.getByLabel('Texto').fill('Hello!');
    const url = await popupFrom(page.context(), () => compose.getByRole('link', { name: 'Abrir no WhatsApp' }).click());
    expect(url).toBe('https://wa.me/14155550100?text=Hello!');
  });
});

test.describe('registro da interação', () => {
  test('a ligação pela ficha vira uma pendência única, registrada num só POST com a próxima ação', async ({ page }) => {
    // Sem a ligação planejada, o registro é uma interação nova.
    const state = await setup(page, 'owner', (fixture) => {
      fixture.tables.activities = fixture.tables.activities.filter((row) => row.id !== CHANNEL_IDS.call);
    });
    const panel = await openContact(page, CHANNEL_IDS.ana);
    const bar = channelBar(panel, ANA);
    await callMenu(page, bar, 'Ligar');
    await callMenu(page, bar, 'Ligar');
    expect(await appLinks(page)).toEqual(['tel:+5511999990000', 'tel:+5511999990000']);
    // Abrir de novo o mesmo alvo não cria outra pendência.
    await expect(panel.getByText(/Ligação aberta às \d{2}:\d{2}/)).toHaveCount(1);
    const [pending] = await stored(page);
    expect(Object.keys(pending).sort()).toEqual(
      ['activityId', 'channel', 'companyId', 'contactId', 'dealId', 'id', 'key', 'nextId', 'openedAt'].sort(),
    );
    expect(pending).toMatchObject({
      channel: 'call',
      contactId: CHANNEL_IDS.ana,
      companyId: CHANNEL_IDS.company,
      dealId: CHANNEL_IDS.deal,
      activityId: null,
    });
    await panel.getByRole('button', { name: 'Registrar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Registrar ligação' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Oportunidade')).toContainText('Site novo');
    // O resultado é obrigatório na ligação.
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Escolha o resultado da ligação.');
    await dialog.getByRole('radio', { name: 'Não atendeu' }).check();
    await expect(dialog.getByRole('checkbox', { name: 'Agendar a próxima ação' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Amanhã às 9h' }).click();
    await expect(dialog.getByLabel('O que precisa acontecer? *')).toHaveValue('Ligação para Ana Souza');
    await dialog.getByLabel('Anotação').fill('Caixa cheia; tentar amanhã cedo.');
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Ligação registrada')).toBeVisible();
    const posts = writes(state, 'activities');
    expect(posts).toHaveLength(1);
    const rows = posts[0].body as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(rows[1]).sort());
    expect(rows[0]).toMatchObject({
      id: pending.id,
      type: 'call',
      title: 'Ligação para Ana Souza',
      body: 'Caixa cheia; tentar amanhã cedo.',
      outcome: 'no_answer',
      user_id: IDS.owner,
      contact_id: CHANNEL_IDS.ana,
      company_id: CHANNEL_IDS.company,
      deal_id: CHANNEL_IDS.deal,
    });
    expect(rows[0].completed_at).toBe(rows[0].due_date);
    expect(rows[1]).toMatchObject({ id: pending.nextId, type: 'call', completed_at: null, outcome: null });
    const due = new Date(String(rows[1].due_date));
    expect([due.getHours(), due.getMinutes()]).toEqual([9, 0]);
    // A linha do tempo, a "Próxima ação" e a pendência resolvida.
    await expect(panel.getByText('Ligação · Concluída · Não atendeu')).toBeVisible();
    await expect(panel.locator('[data-tour="360-next-action"]')).toContainText('Ligação para Ana Souza');
    await expect(panel.getByText(/Ligação aberta às/)).toHaveCount(0);
    expect(await stored(page)).toEqual([]);
    await expect(panel.getByText(/^Ligação · Não atendeu · /)).toBeVisible();
  });

  test('uma nova tentativa depois de uma resposta perdida não duplica a interação', async ({ page }) => {
    const state = await setup(page, 'owner', (fixture) => {
      fixture.tables.activities = fixture.tables.activities.filter((row) => row.id !== CHANNEL_IDS.call);
    });
    const panel = await openContact(page, CHANNEL_IDS.ana);
    await channelBar(panel, ANA).getByRole('button', { name: 'WhatsApp' }).click();
    const compose = page.getByRole('dialog', { name: 'Mensagem por WhatsApp' });
    await compose.getByLabel('Texto').fill('Oi, Ana!');
    await popupFrom(page.context(), () => compose.getByRole('link', { name: 'Abrir no WhatsApp' }).click());
    await panel.getByRole('button', { name: 'Registrar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Registrar WhatsApp' });
    await dialog.getByRole('checkbox', { name: 'Agendar a próxima ação' }).uncheck();
    state.loseNextWriteResponse.add('activities');
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('WhatsApp registrado')).toBeVisible();
    const whatsapp = state.tables.activities.filter(
      (row) => row.type === 'whatsapp' && row.contact_id === CHANNEL_IDS.ana,
    );
    expect(whatsapp).toHaveLength(1);
    expect(whatsapp[0]).toMatchObject({ title: 'WhatsApp para Ana Souza', outcome: null });
    expect(writes(state, 'activities')).toHaveLength(2);
  });

  test('Hoje: a ligação planejada abre o menu, copia o número e o registro conclui a mesma atividade', async ({
    page,
  }) => {
    const state = await setup(page);
    await page.goto('/dashboard');
    const today = page.locator('[data-tour="today-activities"]');
    const item = today.getByRole('listitem').filter({ hasText: 'Ligar para a Ana' });
    await expect(item).toBeVisible();
    const completedToday = page.locator('.eia-stat').filter({ hasText: 'Concluídas hoje' });
    await expect(completedToday).toContainText('0');
    await callMenu(page, item, 'Copiar número');
    await expect(page.getByText('Número copiado: (11) 99999-0000')).toBeVisible();
    expect(await clipboard(page)).toBe('+5511999990000');
    const [pending] = await stored(page);
    expect(pending).toMatchObject({ key: `activity:${CHANNEL_IDS.call}`, activityId: CHANNEL_IDS.call });
    const dock = page.getByRole('region', { name: 'Para registrar' });
    await expect(dock).toContainText(/Ligação para Ana Souza · \d{2}:\d{2}/);
    await dock.getByRole('button', { name: 'Registrar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Concluir “Ligar para a Ana”' });
    await expect(dock).toBeHidden();
    await dialog.getByRole('radio', { name: 'Atendeu', exact: true }).check();
    await dialog.getByLabel('Anotação').fill('Pediu a proposta por e-mail.');
    await dialog.getByRole('checkbox', { name: 'Agendar a próxima ação' }).check();
    await dialog.getByLabel('Tipo').click();
    await page.getByRole('option', { name: 'E-mail', exact: true }).click();
    await expect(dialog.getByLabel('O que precisa acontecer? *')).toHaveValue('E-mail para Ana Souza');
    await dialog.getByRole('button', { name: 'Concluir', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(state.completeCalls).toHaveLength(1);
    expect(state.completeCalls![0]).toMatchObject({
      p_activity_id: CHANNEL_IDS.call,
      p_outcome: 'answered',
      p_note: 'Pediu a proposta por e-mail.',
      p_next: { id: pending.nextId, type: 'email', title: 'E-mail para Ana Souza', user_id: IDS.owner },
    });
    expect(writes(state, 'activities')).toEqual([]);
    const call = state.tables.activities.find((row) => row.id === CHANNEL_IDS.call)!;
    expect(call).toMatchObject({ outcome: 'answered', body: 'Apresentar a proposta.\n\nPediu a proposta por e-mail.' });
    await expect(completedToday).toContainText('1');
    await expect(item).toBeHidden();
    await expect(page.getByRole('region', { name: 'Para registrar' })).toBeHidden();
  });

  test('somente leitura abre o WhatsApp, sem pendência e sem "Registrar ligação"', async ({ page }) => {
    await setup(page, 'viewer');
    const panel = await openContact(page, CHANNEL_IDS.ana);
    const bar = channelBar(panel, ANA);
    await bar.getByRole('button', { name: 'WhatsApp' }).click();
    const compose = page.getByRole('dialog', { name: 'Mensagem por WhatsApp' });
    await compose.getByLabel('Texto').fill('Oi!');
    expect(
      await popupFrom(page.context(), () => compose.getByRole('link', { name: 'Abrir no WhatsApp' }).click()),
    ).toBe('https://wa.me/5511999990000?text=Oi!');
    await bar.getByRole('button', { name: 'Ligar', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Copiar número' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Registrar ligação' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(await stored(page)).toEqual([]);
    await expect(panel.getByText(/aberto às/)).toHaveCount(0);
  });
});

test.describe('e-mail', () => {
  test('o menu abre o Gmail, o Outlook web e o aplicativo de e-mail com os parâmetros exatos', async ({ page }) => {
    await setup(page);
    const panel = await openContact(page, CHANNEL_IDS.ana);
    await channelBar(panel, ANA).getByRole('button', { name: 'E-mail' }).click();
    const compose = page.getByRole('dialog', { name: 'Mensagem por e-mail' });
    await compose.getByLabel('Modelo').click();
    await page.getByRole('option', { name: 'Primeiro contato' }).click();
    await expect(compose.getByLabel('Assunto')).toHaveValue('Proposta para a Padaria Boa Massa');
    await compose.getByLabel('Texto').fill('Olá, Ana!\nSegue a proposta & o prazo.');
    const subject = 'Proposta para a Padaria Boa Massa';
    const body = 'Olá, Ana!\nSegue a proposta & o prazo.';
    const menu = async () => {
      await compose.getByRole('button', { name: 'Abrir e-mail' }).click();
      return page.getByRole('menu');
    };
    let opened = await menu();
    await expect(opened.getByRole('menuitem')).toHaveText([
      'Abrir no Gmail',
      'Abrir no Outlook web',
      'Abrir no aplicativo de e-mail',
    ]);
    await expect(opened).toContainText('Outlook web é para contas Microsoft 365 de trabalho ou escola.');
    const gmail = new URL(
      await popupFrom(page.context(), () => opened.getByRole('menuitem', { name: 'Abrir no Gmail' }).click()),
    );
    expect(gmail.origin + gmail.pathname).toBe('https://mail.google.com/mail/');
    expect([...gmail.searchParams.keys()]).toEqual(['view', 'fs', 'to', 'su', 'body']);
    expect(gmail.searchParams.get('to')).toBe('ana.souza@example.test');
    expect(gmail.searchParams.get('su')).toBe(subject);
    expect(gmail.searchParams.get('body')).toBe(body);
    // A pendência do e-mail nasceu; abrir de novo pelo mesmo alvo mantém uma só.
    await channelBar(panel, ANA).getByRole('button', { name: 'E-mail' }).click();
    await compose.getByLabel('Assunto').fill(subject);
    await compose.getByLabel('Texto').fill(body);
    opened = await menu();
    const outlook = new URL(
      await popupFrom(page.context(), () => opened.getByRole('menuitem', { name: 'Abrir no Outlook web' }).click()),
    );
    expect(outlook.origin + outlook.pathname).toBe('https://outlook.office.com/mail/deeplink/compose');
    expect([...outlook.searchParams.keys()]).toEqual(['to', 'subject', 'body']);
    expect(outlook.searchParams.get('body')).toBe(body);
    await channelBar(panel, ANA).getByRole('button', { name: 'E-mail' }).click();
    await compose.getByLabel('Assunto').fill(subject);
    await compose.getByLabel('Texto').fill(body);
    opened = await menu();
    await opened.getByRole('menuitem', { name: 'Abrir no aplicativo de e-mail' }).click();
    expect(await appLinks(page)).toEqual([
      `mailto:ana.souza@example.test?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body).replace(/%0A/g, '%0D%0A')}`,
    ]);
    expect(await stored(page)).toHaveLength(1);
    // O título do registro leva o assunto, guardado só em memória.
    await panel.getByRole('button', { name: 'Registrar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Registrar e-mail' });
    await dialog.getByRole('checkbox', { name: 'Agendar a próxima ação' }).uncheck();
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByText('E-mail registrado')).toBeVisible();
    await expect(panel.getByRole('heading', { name: `E-mail para Ana Souza: ${subject}` })).toBeVisible();
  });

  test('texto longo demais copia o texto e abre o e-mail sem ele', async ({ page }) => {
    await setup(page);
    const panel = await openContact(page, CHANNEL_IDS.ana);
    await channelBar(panel, ANA).getByRole('button', { name: 'E-mail' }).click();
    const compose = page.getByRole('dialog', { name: 'Mensagem por e-mail' });
    await compose.getByLabel('Assunto').fill('Proposta');
    const long = 'Proposta completa com ação e condição. '.repeat(60);
    await compose.getByLabel('Texto').fill(long);
    await expect(compose.getByText('O texto é longo demais para abrir pelo link.', { exact: false })).toBeVisible();
    await compose.getByRole('button', { name: 'Copiar texto e abrir sem ele' }).click();
    const url = new URL(
      await popupFrom(page.context(), () => page.getByRole('menuitem', { name: 'Abrir no Gmail' }).click()),
    );
    expect(url.searchParams.get('su')).toBe('Proposta');
    expect(url.searchParams.has('body')).toBe(false);
    expect(await clipboard(page)).toBe(`Proposta\n\n${long}`);
  });
});

test.describe('telefone no diretório', () => {
  test('a coluna mostra o formato brasileiro, e a busca acha pelo texto formatado ou pelos dígitos', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/contacts?columns=email,phone,company');
    const row = (name: string) => page.getByRole('row').filter({ hasText: name });
    await expect(row(ANA)).toContainText('(11) 99999-0000');
    await expect(row(ANA)).not.toContainText('+5511999990000');
    await expect(row('Bruno Fixo')).toContainText('(11) 3000-0000');
    const search = page.getByLabel('Pesquisar por nome, e-mail, telefone ou empresa');
    // Gravado como +5511999990000: acha pelo texto formatado, com ou sem máscara, e pelos dígitos.
    for (const term of ['(11) 99999', '11 99999', '5511999990000']) {
      await search.fill(term);
      await expect(row(ANA), term).toBeVisible();
      await expect(row('Carla Marcada'), term).toHaveCount(0);
    }
    await page.goto('/companies');
    await expect(row('Padaria Boa Massa')).toContainText('(11) 3000-0000');
    await page.getByLabel('Pesquisar por empresa, segmento, site ou telefone').fill('3000-0000');
    await expect(row('Padaria Boa Massa')).toBeVisible();
  });
});

test.describe('"Não contatar"', () => {
  test('o colaborador marca com motivo; os canais ficam desligados em todas as telas, e só o administrador tira', async ({
    page,
  }) => {
    const state = await setup(page, 'member');
    const panel = await openContact(page, CHANNEL_IDS.ana);
    await panel.getByRole('button', { name: 'Marcar como não contatar' }).click();
    const confirm = page.getByRole('dialog', { name: 'Marcar como não contatar?' });
    await confirm.getByLabel('Motivo (opcional)').fill('  Pediu para parar.  ');
    await confirm.getByRole('button', { name: 'Marcar como não contatar' }).click();
    await expect(confirm).toBeHidden();
    const band = panel.getByRole('region', { name: 'Não contatar' });
    await expect(band).toContainText(/Marcado por Pessoa de Teste em \d{2}\/\d{2}\/\d{4}/);
    await expect(band).toContainText('Motivo: Pediu para parar.');
    await expect(band.getByRole('button', { name: 'Permitir contato de novo' })).toHaveCount(0);
    const patch = writes(state, 'contacts').at(-1)!;
    expect(patch.body).toEqual({ do_not_contact: true, do_not_contact_reason: 'Pediu para parar.' });
    expect(patch.params).toContain('updated_at=eq.');
    const bar = channelBar(panel, ANA);
    for (const name of ['WhatsApp', 'E-mail', 'Ligar']) {
      await expect(bar.getByRole('button', { name, exact: true })).toBeDisabled();
      await expect(bar.getByRole('button', { name, exact: true })).toHaveAccessibleDescription(
        'Este contato está marcado como “Não contatar”.',
      );
    }
    // A oportunidade e a ligação de Hoje também.
    await page.goto(`/pipeline?deal=${CHANNEL_IDS.deal}`);
    const deal = page.getByRole('dialog', { name: 'Site novo' });
    await expect(channelBar(deal, ANA).getByRole('button', { name: 'WhatsApp' })).toBeDisabled();
    await page.goto('/dashboard');
    const item = page
      .locator('[data-tour="today-activities"]')
      .getByRole('listitem')
      .filter({ hasText: 'Ligar para a Ana' });
    await expect(item.getByRole('button', { name: 'Ligar', exact: true })).toBeDisabled();
    await expect(item.getByRole('button', { name: 'Ligar', exact: true })).toHaveAccessibleDescription(
      'Este contato está marcado como “Não contatar”.',
    );
    // A etiqueta no diretório.
    await page.goto('/contacts');
    await expect(page.getByRole('row').filter({ hasText: 'Ana Souza' })).toContainText('Não contatar');
    // O colaborador não tira a marca pela API (o banco recusa).
    expect(state.tables.contacts.find((row) => row.id === CHANNEL_IDS.ana)).toMatchObject({
      do_not_contact: true,
      do_not_contact_by: IDS.owner,
      do_not_contact_reason: 'Pediu para parar.',
    });
  });

  test('o administrador permite o contato de novo', async ({ page }) => {
    const state = await setup(page, 'admin');
    // Marcada, Carla fica fora da regra "sem próxima ação" da fila de atenção, e Bruno, sem marca, continua nela.
    await page.goto('/dashboard?owner=all');
    const attention = page.locator('[data-tour="today-attention"]');
    await expect(attention.getByRole('link', { name: 'Bruno Fixo' })).toBeVisible();
    await expect(attention.getByRole('link', { name: 'Carla Marcada' })).toHaveCount(0);
    const panel = await openContact(page, CHANNEL_IDS.carla);
    const band = panel.getByRole('region', { name: 'Não contatar' });
    await expect(band).toContainText('Motivo: Pediu para parar de receber mensagens.');
    // A "Próxima ação" vazia da ficha marcada não pede um novo contato.
    await expect(panel.locator('[data-tour="360-next-action"]')).toContainText(
      'Este contato está marcado “Não contatar”: o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele',
    );
    await band.getByRole('button', { name: 'Permitir contato de novo' }).click();
    await page
      .getByRole('dialog', { name: 'Permitir contato de novo?' })
      .getByRole('button', { name: 'Permitir contato de novo' })
      .click();
    await expect(band).toBeHidden();
    await expect(channelBar(panel, 'Carla Marcada').getByRole('button', { name: 'WhatsApp' })).toBeEnabled();
    expect(state.tables.contacts.find((row) => row.id === CHANNEL_IDS.carla)).toMatchObject({
      do_not_contact: false,
      do_not_contact_at: null,
      do_not_contact_reason: null,
    });
    await expect(panel.locator('[data-tour="360-next-action"]')).toContainText('Crie uma ação');
    // Sem a marca, Carla volta à fila.
    await page.goto('/dashboard?owner=all');
    await expect(attention.getByRole('link', { name: 'Carla Marcada' })).toBeVisible();
  });
});

test.describe('concluir e agendar a próxima', () => {
  test('no detalhe da atividade, com o conflito mantendo o preenchimento, e o "Agendar a próxima" do aviso', async ({
    page,
  }) => {
    const state = await setup(page);
    await page.goto(`/activities?activity=${CHANNEL_IDS.call}`);
    const detail = page.getByRole('dialog', { name: 'Ligar para a Ana' });
    // O detalhe mostra com quem os canais falam, com o telefone no formato brasileiro (AC-8).
    await expect(detail).toContainText('Ana Souza · (11) 99999-0000 · ana.souza@example.test');
    await detail.getByRole('button', { name: 'Concluir e agendar a próxima' }).click();
    const dialog = page.getByRole('dialog', { name: 'Concluir e agendar a próxima' });
    await expect(dialog.getByRole('checkbox', { name: 'Agendar a próxima ação' })).toHaveCount(0);
    await dialog.getByRole('radio', { name: 'Caixa postal' }).check();
    await dialog.getByLabel('Anotação').fill('Deixei recado.');
    await dialog.getByRole('button', { name: 'Em 2 dias' }).click();
    // Um colega mudou a atividade depois que ela foi aberta.
    state.tables.activities.find((row) => row.id === CHANNEL_IDS.call)!.updated_at = new Date().toISOString();
    await dialog.getByRole('button', { name: 'Concluir', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Esta atividade mudou ou não está mais disponível.');
    await expect(dialog.getByLabel('Anotação')).toHaveValue('Deixei recado.');
    await expect(dialog.getByRole('radio', { name: 'Caixa postal' })).toBeChecked();
    expect(state.tables.activities.find((row) => row.id === CHANNEL_IDS.call)!.completed_at).toBeNull();
    // A atividade foi relida: a nova tentativa vale para a versão atual, sem "Registrar como nova".
    await expect(dialog.getByRole('alert')).toContainText('Os dados atuais da atividade foram carregados');
    await expect(dialog.getByRole('button', { name: 'Registrar como nova' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Concluir', exact: true }).click();
    await expect(dialog).toBeHidden();
    const done = state.tables.activities.find((row) => row.id === CHANNEL_IDS.call)!;
    expect(done.completed_at).not.toBeNull();
    expect(done).toMatchObject({ outcome: 'voicemail' });
    expect(String(done.body)).toMatch(/Deixei recado\.$/);
    const scheduled = state.tables.activities.filter(
      (row) => row.contact_id === CHANNEL_IDS.ana && row.type === 'call' && !row.completed_at,
    );
    expect(scheduled).toHaveLength(1);
    // Um "Concluir" simples (da próxima ação recém-criada) oferece "Agendar a próxima" no aviso.
    await page.goto(`/activities?activity=${scheduled[0].id}`);
    await page
      .getByRole('dialog', { name: String(scheduled[0].title) })
      .getByRole('button', { name: 'Concluir', exact: true })
      .click();
    await page.getByRole('button', { name: 'Agendar a próxima', exact: true }).click();
    const schedule = page.getByRole('dialog', { name: 'Agendar a próxima' });
    await schedule.getByLabel('O que precisa acontecer? *').fill('Mandar a proposta revisada');
    await schedule.getByRole('button', { name: 'Agendar', exact: true }).click();
    await expect(schedule).toBeHidden();
    const next = state.tables.activities.find((row) => row.title === 'Mandar a proposta revisada')!;
    expect(next).toMatchObject({
      type: 'call',
      completed_at: null,
      contact_id: CHANNEL_IDS.ana,
      company_id: CHANNEL_IDS.company,
      deal_id: CHANNEL_IDS.deal,
    });
  });
});

test.describe('oportunidade', () => {
  test('a barra usa o contato, o registro vem com a oportunidade e "Combinar ação" escolhe o tipo', async ({
    page,
  }) => {
    const state = await setup(page, 'owner', (fixture) => {
      fixture.tables.activities = fixture.tables.activities.filter((row) => row.id !== CHANNEL_IDS.call);
    });
    await page.goto(`/pipeline?deal=${CHANNEL_IDS.deal}`);
    const deal = page.getByRole('dialog', { name: 'Site novo' });
    await expect(deal).toContainText('(11) 99999-0000 · ana.souza@example.test');
    await callMenu(page, channelBar(deal, ANA), 'Registrar ligação');
    const dialog = page.getByRole('dialog', { name: 'Registrar ligação' });
    await expect(dialog.getByLabel('Oportunidade')).toContainText('Site novo');
    await dialog.getByRole('radio', { name: 'Atendeu', exact: true }).check();
    await dialog.getByRole('checkbox', { name: 'Agendar a próxima ação' }).uncheck();
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(dialog).toBeHidden();
    const call = state.tables.activities.find((row) => row.type === 'call' && row.deal_id === CHANNEL_IDS.deal)!;
    expect(call).toMatchObject({ outcome: 'answered', contact_id: CHANNEL_IDS.ana });
    await deal.getByRole('button', { name: 'Combinar ação' }).click();
    await deal.getByLabel('Tipo').click();
    await page.getByRole('option', { name: 'WhatsApp', exact: true }).click();
    await deal.getByLabel('O que precisa acontecer? *').fill('Mandar o contrato');
    await deal.getByLabel('Prazo *').fill('2026-12-01T10:00');
    await deal.getByRole('button', { name: 'Salvar ação' }).click();
    await expect(deal.getByRole('listitem').filter({ hasText: 'Mandar o contrato' })).toContainText('WhatsApp');
    expect(state.tables.activities.find((row) => row.title === 'Mandar o contrato')).toMatchObject({
      type: 'whatsapp',
      deal_id: CHANNEL_IDS.deal,
    });
    // Achado 12 da revisão do item 1.9: a reunião pede início e término, e o término escolhido vai no pedido.
    await deal.getByRole('button', { name: 'Combinar ação' }).click();
    await deal.getByLabel('Tipo').click();
    await page.getByRole('option', { name: 'Reunião', exact: true }).click();
    await expect(deal.getByLabel('Prazo *')).toHaveCount(0);
    await deal.getByLabel('O que precisa acontecer? *').fill('Apresentar o projeto');
    await deal.getByLabel('Início *').fill('2026-12-02T14:00');
    await expect(deal.getByLabel('Término *')).toHaveValue('2026-12-02T15:00');
    await deal.getByLabel('Término *').fill('2026-12-02T15:30');
    await deal.getByRole('button', { name: 'Salvar ação' }).click();
    await expect(deal.getByRole('listitem').filter({ hasText: 'Apresentar o projeto' })).toContainText('Reunião');
    const meeting = state.tables.activities.find((row) => row.title === 'Apresentar o projeto')!;
    expect(new Date(String(meeting.end_date)).getTime() - new Date(String(meeting.due_date)).getTime()).toBe(
      90 * 60_000,
    );
    // O quadro conta a ação de WhatsApp como próxima ação.
    await deal.getByRole('button', { name: 'Fechar' }).click();
    await expect(page.getByRole('article', { name: 'Site novo' })).toContainText('Mandar o contrato');
  });
});

test.describe('cadastro do telefone', () => {
  test('grava o E.164 com a prévia, abre formatado e guarda o número sem DDD como digitado', async ({ page }) => {
    const state = await setup(page);
    await page.goto('/contacts?action=new');
    const form = page.getByRole('dialog', { name: 'Novo contato' });
    await form.getByLabel('Nome *').fill('Eva');
    await form.getByLabel('Telefone').fill('11 99999 0000');
    await expect(form.getByLabel('Telefone')).toHaveAccessibleDescription('Será salvo como (11) 99999-0000, celular.');
    await form.getByRole('button', { name: 'Salvar cadastro' }).click();
    await expect(form).toBeHidden();
    const created = writes(state, 'contacts').at(-1)!;
    expect(created.body).toMatchObject({ first_name: 'Eva', phone: '+5511999990000' });
    const eva = state.tables.contacts.find((row) => row.first_name === 'Eva')!;
    await page.goto(`/contacts?contact=${eva.id}`);
    const panel = page.getByRole('dialog').filter({ has: page.getByText('Relacionamento 360') });
    await panel.getByRole('button', { name: 'Editar cadastro' }).click();
    const edit = page.getByRole('dialog', { name: 'Editar contato' });
    await expect(edit.getByLabel('Telefone')).toHaveValue('(11) 99999-0000');
    await edit.getByLabel('Telefone').fill('99999-0000');
    await expect(edit.getByLabel('Telefone')).toHaveAccessibleDescription(
      'Número não reconhecido: confira o DDD. Ele será salvo como digitado, e o WhatsApp e a ligação ficam desabilitados até você corrigir o número.',
    );
    await edit.getByRole('button', { name: 'Salvar cadastro' }).click();
    await expect(edit).toBeHidden();
    expect(writes(state, 'contacts').at(-1)!.body).toMatchObject({ phone: '99999-0000' });
  });
});

test.describe('tipos novos', () => {
  test('a Agenda mostra visitas, Atividades filtra WhatsApp e o calendário exportado leva a visita', async ({
    page,
  }, testInfo) => {
    const visitStart = new Date();
    visitStart.setHours(15, 0, 0, 0);
    await setup(page, 'owner', (state) => {
      const base = state.tables.activities.find((row) => row.id === CHANNEL_IDS.call)!;
      state.tables.activities.push(
        {
          ...base,
          id: 'cccccccc-0000-4000-8000-000000000010',
          type: 'visit',
          title: 'Visita à padaria',
          body: null,
          due_date: visitStart.toISOString(),
          end_date: new Date(visitStart.getTime() + 3_600_000).toISOString(),
        },
        { ...base, id: 'cccccccc-0000-4000-8000-000000000011', type: 'whatsapp', title: 'Mandar o catálogo' },
      );
    });
    await page.goto('/agenda?view=day');
    await expect(page.getByText('Visita à padaria')).toBeVisible();
    await page.getByLabel('Tipo de compromisso').click();
    await page.getByRole('option', { name: 'Visitas', exact: true }).click();
    await expect(page.getByText('Visita à padaria')).toBeVisible();
    await expect(page.getByText('Ligar para a Ana')).toHaveCount(0);
    await page.goto('/activities?type=whatsapp');
    await expect(page.getByText('Mandar o catálogo')).toBeVisible();
    await expect(page.getByText('Ligar para a Ana')).toHaveCount(0);
    if (isMobile(testInfo)) return;
    // As exportações são conferidas no desktop, como nos demais testes de arquivos.
    await page.goto('/settings/integrations');
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar reuniões', exact: true }).click(),
    ]);
    const ics = await readFile((await file.path())!, 'utf8');
    expect(ics).toContain('SUMMARY:Visita à padaria');
    expect(ics).toContain('SUMMARY:Reunião de teste');
  });
});

test.describe('layout', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`ficha, diálogos e "Para registrar" sem rolagem lateral (${theme})`, async ({ page }, testInfo) => {
      const state = withChannels(createFixture());
      await installCrmFixture(page, { state, theme });
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      const widths = isMobile(testInfo) ? [320, 375] : [1440];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        const panel = await openContact(page, CHANNEL_IDS.carla);
        await expect(panel.getByRole('region', { name: 'Não contatar' })).toBeVisible();
        await settled(panel);
        await expectNoHorizontalScroll(page, `ficha ${width}px`);
        await page.screenshot({ path: testInfo.outputPath(`canais-ficha-${theme}-${width}.png`) });
        const ana = await openContact(page, CHANNEL_IDS.ana);
        const buttons = channelBar(ana, ANA).getByRole('button');
        for (const button of await buttons.all()) {
          const box = (await button.boundingBox())!;
          if (isMobile(testInfo)) expect(box.height, 'alvo de toque').toBeGreaterThanOrEqual(43.5);
        }
        if (isMobile(testInfo)) {
          // A "Próxima ação" da ficha e o botão "Marcar como não contatar" (achados 2 e 8 da revisão do item 1.9).
          const next = ana.locator('[data-tour="360-next-action"]');
          for (const name of ['Concluir', 'Concluir e agendar a próxima', 'Reagendar'])
            await expectTouchTarget(
              next.getByRole('button', { name, exact: true }),
              `próxima ação: ${name} ${width}px`,
            );
          await expectTouchTarget(ana.getByRole('button', { name: 'Marcar como não contatar' }), `marcar ${width}px`);
          // A confirmação da marca: "Cancelar" e o botão de confirmar.
          await ana.getByRole('button', { name: 'Marcar como não contatar' }).click();
          const marking = page.getByRole('dialog', { name: 'Marcar como não contatar?' });
          await expect(marking).toBeVisible();
          // A medida espera a animação de entrada: no meio dela, a escala reduz a altura.
          await settled(marking);
          for (const name of ['Cancelar', 'Marcar como não contatar'])
            await expectTouchTarget(
              marking.getByRole('button', { name, exact: true }),
              `confirmação da marca: ${name} ${width}px`,
            );
          await marking.getByRole('button', { name: 'Cancelar', exact: true }).click();
          await expect(marking).toBeHidden();
        }
        await channelBar(ana, ANA).getByRole('button', { name: 'WhatsApp' }).click();
        const compose = page.getByRole('dialog', { name: 'Mensagem por WhatsApp' });
        await expect(compose).toBeVisible();
        await settled(compose);
        await expectNoHorizontalScroll(page, `mensagem ${width}px`);
        await page.screenshot({ path: testInfo.outputPath(`canais-mensagem-${theme}-${width}.png`) });
        if (isMobile(testInfo)) {
          await expectTouchTarget(
            compose.getByRole('button', { name: 'Copiar texto', exact: true }),
            `copiar ${width}px`,
          );
          await expectTouchTarget(compose.getByRole('link', { name: 'Abrir no WhatsApp' }), `abrir ${width}px`);
          // As ações de "Mensagem por e-mail": "Copiar texto" e o menu "Abrir e-mail".
          await page.keyboard.press('Escape');
          await expect(compose).toBeHidden();
          await channelBar(ana, ANA).getByRole('button', { name: 'E-mail' }).click();
          const email = page.getByRole('dialog', { name: 'Mensagem por e-mail' });
          await expect(email).toBeVisible();
          await settled(email);
          await expectTouchTarget(
            email.getByRole('button', { name: 'Copiar texto', exact: true }),
            `copiar e-mail ${width}px`,
          );
          await expectTouchTarget(email.getByRole('button', { name: 'Abrir e-mail' }), `abrir e-mail ${width}px`);
        }
        await page.keyboard.press('Escape');
        await callMenu(page, channelBar(ana, ANA), 'Registrar ligação');
        const register = page.getByRole('dialog', { name: 'Registrar ligação' });
        await expect(register).toBeVisible();
        await settled(register);
        await expectNoHorizontalScroll(page, `registro ${width}px`);
        await page.screenshot({ path: testInfo.outputPath(`canais-registro-${theme}-${width}.png`) });
        if (isMobile(testInfo)) {
          // Os rádios do resultado e da sugestão e a caixa da próxima ação: a linha inteira é o alvo de toque.
          for (const name of ['Atendeu', 'Não atendeu', 'Caixa postal'])
            await expectTouchTarget(touchRow(register.getByRole('radio', { name, exact: true })), `${name} ${width}px`);
          await expectTouchTarget(
            touchRow(register.getByRole('radio', { name: /^Concluir “Ligar para a Ana”/ })),
            `sugestão ${width}px`,
          );
          await expectTouchTarget(
            touchRow(register.getByRole('radio', { name: 'Registrar como nova' })),
            `registrar como nova ${width}px`,
          );
          await expectTouchTarget(
            touchRow(register.getByRole('checkbox', { name: 'Agendar a próxima ação' })),
            `agendar ${width}px`,
          );
          for (const name of ['Amanhã às 9h', 'Em 2 dias', 'Em 1 semana', 'Cancelar', 'Concluir'])
            await expectTouchTarget(register.getByRole('button', { name, exact: true }), `${name} ${width}px`);
        }
        await page.keyboard.press('Escape');
        if (isMobile(testInfo)) {
          // "Para registrar" dentro da ficha: "Registrar" e "Agora não".
          await callMenu(page, channelBar(ana, ANA), 'Copiar número');
          const inline = ana.getByRole('list', { name: 'Para registrar' });
          await expect(inline).toBeVisible();
          for (const name of ['Registrar', 'Agora não'])
            await expectTouchTarget(inline.getByRole('button', { name, exact: true }), `${name} na ficha ${width}px`);
          // A faixa "Não contatar" com "Permitir contato de novo".
          const carla = await openContact(page, CHANNEL_IDS.carla);
          await expectTouchTarget(
            carla.getByRole('button', { name: 'Permitir contato de novo' }),
            `permitir ${width}px`,
          );
          // A confirmação de "Permitir contato de novo".
          await carla.getByRole('button', { name: 'Permitir contato de novo' }).click();
          const allowing = page.getByRole('dialog', { name: 'Permitir contato de novo?' });
          await expect(allowing).toBeVisible();
          await settled(allowing);
          for (const name of ['Cancelar', 'Permitir contato de novo'])
            await expectTouchTarget(
              allowing.getByRole('button', { name, exact: true }),
              `confirmação de permitir: ${name} ${width}px`,
            );
          await allowing.getByRole('button', { name: 'Cancelar', exact: true }).click();
          await expect(allowing).toBeHidden();
        }
        // "Para registrar" no rodapé, acima da navegação inferior no celular.
        await page.goto('/dashboard');
        await callMenu(
          page,
          page.locator('[data-tour="today-activities"]').getByRole('listitem').filter({ hasText: 'Ligar para a Ana' }),
          'Copiar número',
        );
        const dock = page.getByRole('region', { name: 'Para registrar' });
        await expect(dock).toBeVisible();
        await expectNoHorizontalScroll(page, `Para registrar ${width}px`);
        if (isMobile(testInfo)) {
          // A faixa do rodapé: "Registrar", "Agora não" e "Ver todas" (duas pendências: a da ficha e a de Hoje).
          for (const name of ['Registrar', 'Agora não'])
            await expectTouchTarget(
              dock.getByRole('button', { name, exact: true }).first(),
              `${name} na faixa ${width}px`,
            );
          await expectTouchTarget(dock.getByRole('button', { name: /^Ver todas/ }), `ver todas ${width}px`);
        }
        const dockBox = (await dock.boundingBox())!;
        if (isMobile(testInfo)) {
          const nav = (await page.getByRole('navigation', { name: 'Navegação principal mobile' }).boundingBox())!;
          expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(nav.y + 1);
          expect(dockBox.width).toBeGreaterThan(width - 40);
        } else expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(800);
        // A faixa não cobre o fim da tela: a área de trabalho reserva o espaço dela, e o último item de Hoje rola para
        // cima da faixa.
        const reserved = await page.evaluate(() => {
          const main = document.querySelector('main.eia-workspace')!;
          const style = getComputedStyle(main);
          return main.getBoundingClientRect().bottom - parseFloat(style.paddingBottom);
        });
        expect(reserved, 'fim da área de trabalho acima da faixa').toBeLessThanOrEqual(dockBox.y + 1);
        const last = page.locator('[data-tour="today-activities"]').getByRole('listitem').last();
        await last.scrollIntoViewIfNeeded();
        const lastBox = (await last.boundingBox())!;
        expect(lastBox.y + lastBox.height, 'último item de Hoje alcançável').toBeLessThanOrEqual(dockBox.y + 1);
        await page.screenshot({ path: testInfo.outputPath(`canais-para-registrar-${theme}-${width}.png`) });
        // Fecha todas as pendências (no celular, a da ficha e a de Hoje).
        while (await dock.isVisible()) await dock.getByRole('button', { name: 'Agora não' }).first().click();
        await expect(dock).toBeHidden();
      }
    });
  }
});
