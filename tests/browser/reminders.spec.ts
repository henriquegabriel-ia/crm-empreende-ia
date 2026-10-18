import { expect, test, type Locator, type Page, type TestInfo } from './test';
import { createFixture, IDS, installCrmFixture, withVolume, type FixtureRow, type FixtureState } from './fixture';

// Item 1.12 (docs/arquitetura/1.12.md): lembretes no menu, no desktop e no celular (o projeto mobile-chrome inclui
// este arquivo). O número ao lado de "Hoje" conta as atividades pendentes da pessoa, que não são nota, vencidas (prazo
// antes de agora) e até o fim do dia, com a regra de Hoje em "Minha rotina". O relógio do navegador começa ao meio-dia
// de hoje em São Paulo (o fuso do E2E) e anda normalmente, para "vencida" e "até o fim do dia" não dependerem da hora da
// rodada.

const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile-chrome';
const HOUR = 3_600_000;
/** Meio-dia de hoje em São Paulo (sem horário de verão desde 2019: -03:00). */
function noonToday() {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(`${day}T12:00:00-03:00`);
}
const NOON = noonToday();
const at = (hours: number) => new Date(NOON.getTime() + hours * HOUR).toISOString();
/** Fim do dia no navegador: meia-noite de São Paulo. */
const END_OF_DAY = NOON.getTime() + 12 * HOUR;

function activity(id: string, title: string, extra: Partial<FixtureRow> = {}): FixtureRow {
  return {
    id,
    org_id: IDS.org,
    title,
    type: 'task',
    body: null,
    due_date: at(-2),
    end_date: null,
    completed_at: null,
    contact_id: null,
    company_id: null,
    deal_id: null,
    user_id: IDS.owner,
    created_by: IDS.owner,
    outcome: null,
    created_at: at(-72),
    updated_at: at(-72),
    ...extra,
  };
}
const ID = (n: number) => `88888888-8888-4888-8888-${String(n).padStart(12, '0')}`;
/**
 * As atividades do teste: 2 vencidas (uma ligação de ontem para o Contato Alfa, marcado "Não contatar" depois de
 * agendada, e uma tarefa desta manhã) e 2 até o fim do dia (uma reunião às 15h e um WhatsApp às 17h), da pessoa. Ficam
 * de fora a visita de amanhã, a nota, a concluída, a sem prazo e a da colega.
 */
function withRoutine(state: FixtureState) {
  const alfa = state.tables.contacts.find((row) => row.id === IDS.contact)!;
  Object.assign(alfa, {
    do_not_contact: true,
    do_not_contact_at: at(-24),
    do_not_contact_by: IDS.owner,
    do_not_contact_reason: 'Pediu para não receber ligações.',
  });
  state.tables.activities = [
    activity(ID(1), 'Ligar para o Contato Alfa', { type: 'call', due_date: at(-26), contact_id: IDS.contact }),
    activity(ID(2), 'Enviar proposta', { due_date: at(-2) }),
    activity(ID(3), 'Reunião de alinhamento', { type: 'meeting', due_date: at(3), end_date: at(4) }),
    activity(ID(4), 'WhatsApp de retorno', { type: 'whatsapp', due_date: at(5) }),
    activity(ID(5), 'Visita de amanhã', { type: 'visit', due_date: at(22), end_date: at(23) }),
    activity(ID(6), 'Nota da conversa', { type: 'note', due_date: null, completed_at: at(-3) }),
    activity(ID(7), 'Tarefa concluída', { due_date: at(-4), completed_at: at(-3) }),
    activity(ID(8), 'Tarefa sem prazo', { due_date: null }),
    activity(ID(9), 'Tarefa da colega', { due_date: at(-2), user_id: IDS.viewer }),
  ];
  return state;
}

async function open(page: Page, state: FixtureState, path = '/pipeline', theme?: 'light' | 'dark') {
  await page.clock.install({ time: NOON });
  await installCrmFixture(page, { state, theme });
  await page.goto(path);
}
/** O link "Hoje" com os lembretes: no menu lateral do desktop ou na navegação inferior do celular. */
function todayLink(page: Page, testInfo: TestInfo, name: string): Locator {
  const scope = isMobile(testInfo)
    ? page.getByRole('navigation', { name: 'Navegação principal mobile' })
    : page.locator('aside.eia-rail');
  return scope.getByRole('link', { name, exact: true });
}
const reminderReads = (state: FixtureState) =>
  state.requests.filter(
    (request) =>
      request.table === 'activities' &&
      request.method === 'GET' &&
      new URLSearchParams(request.params).get('select') === 'id,type,due_date,completed_at,user_id',
  );
const snapshotReads = (state: FixtureState) =>
  state.requests.filter(
    (request) =>
      request.table === 'activities' &&
      request.method === 'GET' &&
      new URLSearchParams(request.params).get('select') === '*',
  );
const statValue = (page: Page, label: string) =>
  page
    .locator('.eia-stat')
    .filter({ has: page.locator('.eia-stat-label', { hasText: new RegExp(`^${label}$`) }) })
    .locator('.eia-stat-value');
async function expectNoHorizontalScroll(page: Page, label: string) {
  const geometry = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(geometry.scroll, `${label}: documento`).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.body, `${label}: body`).toBeLessThanOrEqual(geometry.width + 1);
}
/** O rótulo esperado, como reminderLabel (src/lib/activity-logic.ts). */
function expectedLabel(overdue: number, upcoming: number) {
  const n = (value: number) => value.toLocaleString('pt-BR');
  const late = overdue === 1 ? '1 atividade vencida' : `${n(overdue)} atividades vencidas`;
  if (overdue && upcoming) return `Hoje, ${late} e ${n(upcoming)} até o fim do dia`;
  if (overdue) return `Hoje, ${late}`;
  return upcoming ? `Hoje, ${upcoming === 1 ? '1 atividade' : `${n(upcoming)} atividades`} até o fim do dia` : 'Hoje';
}

test('"Hoje" no menu mostra as vencidas e as do dia da pessoa, numa leitura leve, e leva à lista de Hoje', async ({
  page,
}, testInfo) => {
  const state = withRoutine(createFixture());
  await open(page, state);
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline', exact: true })).toBeVisible();
  const link = todayLink(page, testInfo, 'Hoje, 2 atividades vencidas e 2 até o fim do dia');
  await expect(link).toBeVisible();
  if (isMobile(testInfo)) {
    // No celular, um selo no canto do ícone com o total, preenchido porque há vencidas.
    const badge = link.locator('[data-reminders="corner"]');
    await expect(badge).toHaveText('4');
    await expect(badge).toHaveAttribute('data-reminder', 'overdue');
    await expect(badge).toHaveAttribute('aria-hidden', 'true');
  } else {
    await expect(link.locator('[data-reminder="overdue"]')).toHaveText('2');
    await expect(link.locator('[data-reminder="upcoming"]')).toHaveText('2');
  }
  // Uma leitura só, com as cinco colunas das pendentes da pessoa, sem nota e antes do fim do dia; o snapshot de Hoje
  // (atividades com select=*) não é carregado no Pipeline.
  await expect.poll(() => reminderReads(state).length).toBe(1);
  const params = new URLSearchParams(reminderReads(state)[0].params);
  expect(params.get('user_id')).toBe(`eq.${IDS.owner}`);
  expect(params.get('completed_at')).toBe('is.null');
  expect(params.get('type')).toBe('neq.note');
  expect(Date.parse(params.get('due_date')!.replace(/^lt\./, ''))).toBe(END_OF_DAY);
  expect(snapshotReads(state)).toEqual([]);

  await link.click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
  // As mesmas contagens de Hoje em "Minha rotina": "Vencidas" e "Próximos passos do dia".
  await expect(statValue(page, 'Vencidas')).toHaveText('2');
  const day = page.locator('[data-tour="today-activities"]');
  await expect(day.getByText('O número ao lado de “Hoje”, no menu, conta as mesmas.', { exact: false })).toBeVisible();
  for (const title of ['Ligar para o Contato Alfa', 'Enviar proposta', 'Reunião de alinhamento', 'WhatsApp de retorno'])
    await expect(day.getByRole('button', { name: title, exact: true })).toBeVisible();
  for (const title of ['Visita de amanhã', 'Tarefa concluída', 'Tarefa sem prazo', 'Tarefa da colega'])
    await expect(day.getByRole('button', { name: title, exact: true })).toHaveCount(0);

  // Concluir uma vencida em Hoje atualiza o número do menu, sem recarregar a página.
  await day
    .getByRole('listitem')
    .filter({ hasText: 'Enviar proposta' })
    .getByRole('button', { name: 'Concluir', exact: true })
    .click();
  await expect(todayLink(page, testInfo, 'Hoje, 1 atividade vencida e 2 até o fim do dia')).toBeVisible();
  await expect(statValue(page, 'Vencidas')).toHaveText('1');
  expect(reminderReads(state).length).toBe(2);
});

test('o horário que passa troca a próxima por vencida, e a virada do dia relê com o novo fim do dia', async ({
  page,
}, testInfo) => {
  test.skip(isMobile(testInfo), 'O relógio é o mesmo no celular; a regra é conferida no desktop.');
  const state = withRoutine(createFixture());
  await open(page, state);
  await expect(todayLink(page, testInfo, 'Hoje, 2 atividades vencidas e 2 até o fim do dia')).toBeVisible();
  // 15h01: a reunião das 15h venceu. O número muda ao voltar para a aba, sem nova leitura.
  await page.clock.setSystemTime(new Date(NOON.getTime() + 3 * HOUR + 60_000));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(todayLink(page, testInfo, 'Hoje, 3 atividades vencidas e 1 até o fim do dia')).toBeVisible();
  expect(reminderReads(state).length).toBe(1);
  // 0h05 de amanhã: as quatro de ontem venceram, e a visita de amanhã às 10h entra como do dia, por uma nova leitura.
  await page.clock.setSystemTime(new Date(NOON.getTime() + 12 * HOUR + 5 * 60_000));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(todayLink(page, testInfo, 'Hoje, 4 atividades vencidas e 1 até o fim do dia')).toBeVisible();
  expect(reminderReads(state).length).toBe(2);
  expect(Date.parse(new URLSearchParams(reminderReads(state)[1].params).get('due_date')!.slice(3))).toBe(
    END_OF_DAY + 24 * HOUR,
  );
});

test('menu recolhido: selo no canto do ícone com o total e a dica com o rótulo', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), 'O menu recolhido é do desktop.');
  const state = withRoutine(createFixture());
  state.tables.activities = state.tables.activities.filter((row) => row.id !== ID(1) && row.id !== ID(2));
  await open(page, state);
  await page.getByRole('button', { name: 'Recolher menu', exact: true }).click();
  const link = todayLink(page, testInfo, 'Hoje, 2 atividades até o fim do dia');
  const badge = link.locator('[data-reminders="corner"]');
  // Só as do dia: o selo fica contornado, e não preenchido no tom de erro.
  await expect(badge).toHaveText('2');
  await expect(badge).toHaveAttribute('data-reminder', 'upcoming');
  await link.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: 'Hoje, 2 atividades até o fim do dia' })).toBeVisible();
});

// Revisão do item 1.12: a leitura que falha sem nenhuma anterior não pode passar por "nenhuma pendência".
test('a leitura que falha mostra um "?" neutro com o rótulo; a nova leitura traz o número', async ({
  page,
}, testInfo) => {
  const state = withRoutine(createFixture());
  state.failReads.add('activities');
  await open(page, state);
  // O TanStack Query tenta três vezes (1, 2 e 4 s) antes de dar a leitura por falha.
  const failed = todayLink(page, testInfo, 'Hoje, não foi possível conferir os lembretes');
  await expect(failed).toBeVisible({ timeout: 20_000 });
  const mark = failed.locator('[data-reminder="unavailable"]');
  await expect(mark).toHaveText('?');
  await expect(failed.locator('[data-reminder="overdue"], [data-reminder="upcoming"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('lembretes-falha.png') });
  // Ao voltar para a aba, a leitura é refeita (o TanStack Query ouve o visibilitychange na janela).
  state.failReads.clear();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
  const link = todayLink(page, testInfo, 'Hoje, 2 atividades vencidas e 2 até o fim do dia');
  await expect(link).toBeVisible();
  await expect(link.locator('[data-reminder="unavailable"]')).toHaveCount(0);
});

test('sem lembrete, "Hoje" fica sem número', async ({ page }, testInfo) => {
  const state = createFixture();
  state.tables.activities = [
    activity(ID(1), 'Visita de amanhã', { type: 'visit', due_date: at(22), end_date: at(23) }),
  ];
  await open(page, state);
  await expect.poll(() => reminderReads(state).length).toBe(1);
  const link = todayLink(page, testInfo, 'Hoje');
  await expect(link).toBeVisible();
  await expect(link.locator('[data-reminders]')).toHaveCount(0);
});

test('com o volume do 0.10, o menu e Hoje dão o mesmo número, sem carregar o snapshot no Pipeline', async ({
  page,
}, testInfo) => {
  test.skip(isMobile(testInfo), 'O volume é medido no desktop, como o restante do item 0.10.');
  const state = createFixture();
  state.tables.activities = [];
  const volume = withVolume(state, { now: NOON });
  // A mesma regra, calculada aqui sobre as linhas da fixture.
  const mine = (volume.activities as FixtureRow[]).filter(
    (row) =>
      row.user_id === IDS.owner &&
      row.completed_at === null &&
      row.type !== 'note' &&
      row.due_date !== null &&
      Date.parse(String(row.due_date)) < END_OF_DAY,
  );
  const overdue = mine.filter((row) => Date.parse(String(row.due_date)) < NOON.getTime()).length;
  expect(overdue).toBeGreaterThan(100);
  await open(page, state);
  const link = todayLink(page, testInfo, expectedLabel(overdue, mine.length - overdue));
  await expect(link).toBeVisible();
  await expect(link.locator('[data-reminder="overdue"]')).toHaveText(overdue > 99 ? '99+' : String(overdue));
  expect(reminderReads(state).length).toBe(1);
  expect(snapshotReads(state)).toEqual([]);
  await link.click();
  await expect(statValue(page, 'Vencidas')).toHaveText(String(overdue));
  // Em Hoje, o snapshot e a leitura dos lembretes convivem no cache: voltar ao Pipeline não relê nenhum dos dois.
  const before = state.requests.length;
  await page.getByRole('link', { name: 'Pipeline', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline', exact: true })).toBeVisible();
  await expect(link).toBeVisible();
  expect(reminderReads(state).length).toBe(1);
  expect(
    state.requests
      .slice(before)
      .filter((request) => request.table === 'activities' && request.params.includes('select=*')),
  ).toEqual([]);
});

test('a conta desativada não vê o CRM nem pede os lembretes (item 1.2)', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), 'A tela de acesso encerrado é conferida no desktop e no celular em team.spec.ts.');
  const state = withRoutine(createFixture());
  state.tables.user_roles.find((row) => row.user_id === IDS.owner)!.deactivated_at = at(-1);
  await open(page, state, '/dashboard');
  await expect(page.getByRole('heading', { name: 'Seu acesso foi encerrado', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Hoje/ })).toHaveCount(0);
  expect(reminderReads(state)).toEqual([]);
});

test.describe('layout', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`o número cabe no menu, sem rolagem lateral (${theme})`, async ({ page }, testInfo) => {
      const state = withRoutine(createFixture());
      // Mais de 99 vencidas: "99+" é o número mais largo.
      for (let i = 0; i < 120; i++)
        state.tables.activities.push(activity(ID(100 + i), `Retorno atrasado ${i + 1}`, { due_date: at(-30) }));
      await open(page, state, '/dashboard', theme);
      const widths = isMobile(testInfo) ? [320, 375] : [1440];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        const link = todayLink(page, testInfo, 'Hoje, 122 atividades vencidas e 2 até o fim do dia');
        await expect(link).toBeVisible();
        await expectNoHorizontalScroll(page, `Hoje ${width}px`);
        const badge = link.locator(isMobile(testInfo) ? '[data-reminders="corner"]' : '[data-reminder="overdue"]');
        await expect(badge).toHaveText('99+');
        // O número fica dentro do link (no celular, da navegação inferior) e da tela.
        const box = (await badge.boundingBox())!;
        const area = (await (
          isMobile(testInfo) ? page.getByRole('navigation', { name: 'Navegação principal mobile' }) : link
        ).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(Math.max(area.x, 0) - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(Math.min(area.x + area.width, width) + 1);
        expect(box.y).toBeGreaterThanOrEqual(area.y - 1);
        expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height + 1);
        await page.screenshot({ path: testInfo.outputPath(`lembretes-${theme}-${width}.png`) });
      }
      if (isMobile(testInfo)) return;
      // Menu recolhido (64 px): o "99+" cresce para dentro e não é cortado pela borda do menu.
      await page.getByRole('button', { name: 'Recolher menu', exact: true }).click();
      const rail = page.locator('aside.eia-rail');
      const collapsed = todayLink(page, testInfo, 'Hoje, 122 atividades vencidas e 2 até o fim do dia');
      const corner = collapsed.locator('[data-reminders="corner"]');
      await expect(corner).toHaveText('99+');
      // A largura do menu anima por 200 ms (transition-[width]): mede depois que ele chega aos 64 px.
      await expect.poll(async () => (await rail.boundingBox())?.width).toBe(64);
      const box = (await corner.boundingBox())!;
      // A medida é contra o próprio menu (nav), que rola e corta o que passa da borda dele (revisão do item 1.12: com o
      // menu encolhido à largura dos links, o "+" do "99+" ficava cortado, e a medida contra o aside não via).
      const area = (await rail.locator('nav').boundingBox())!;
      expect(area.width).toBeGreaterThan(56);
      // O selo das vencidas tem o anel de 2 px, que também fica dentro.
      expect(box.x - 2).toBeGreaterThanOrEqual(area.x);
      expect(box.x + box.width + 2).toBeLessThanOrEqual(area.x + area.width);
      // Revisão do item 1.12: o selo fica acima do ícone, sem cobrir o desenho, e a borda de cima do menu (que rola)
      // não o corta, com o anel de 2 px.
      const icon = (await collapsed.locator('svg').first().boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(icon.y + 0.5);
      expect(box.y).toBeGreaterThanOrEqual(area.y + 2 - 0.5);
      await page.screenshot({ path: testInfo.outputPath(`lembretes-${theme}-recolhido.png`) });
    });
  }
});
