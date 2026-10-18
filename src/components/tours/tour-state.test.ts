import { describe, expect, it, vi } from 'vitest';
import { quotedLabels, showsLabel } from '@/test/ui-labels';
import { productTours } from './catalog';
import {
  emptyTourPreferences,
  parseTourPreferences,
  pausedTour,
  placeTourCard,
  readTourPreferences,
  recordTourVisit,
  resumeTourIndex,
  shouldAutomaticallyStartTour,
  shouldOfferTour,
  tourStorageKey,
  writeTourPreferences,
} from './tour-state';

const tour = productTours[1];

describe('orientation progress and isolation', () => {
  it('defaults to explicit opt-in and keeps replay possible after a dismissal or completion', () => {
    const initial = emptyTourPreferences();
    expect(initial.automatic).toBe(false);
    expect(shouldOfferTour(initial, tour)).toBe(true);
    expect(shouldAutomaticallyStartTour(initial, tour)).toBe(false);
    for (const status of ['dismissed', 'completed'] as const) {
      const next = recordTourVisit({ ...initial, automatic: true }, tour, status);
      expect(shouldOfferTour(next, tour)).toBe(false);
      expect(shouldAutomaticallyStartTour(next, tour)).toBe(false);
      expect(resumeTourIndex(next, tour, tour.steps)).toBe(0);
    }
  });

  it('resumes by stable step ID after earlier targets become unavailable', () => {
    const preferences = recordTourVisit(emptyTourPreferences(), tour, 'paused', 'contacts-list');
    const visible = tour.steps.filter((step) => step.id !== 'contacts-search' && step.id !== 'contacts-filters');
    expect(visible[resumeTourIndex(preferences, tour, visible)].id).toBe('contacts-list');
    expect(shouldAutomaticallyStartTour({ ...preferences, automatic: true }, tour)).toBe(false);
  });

  it('advances to the nearest available step when the paused target is hidden by a permission or layout change', () => {
    const preferences = recordTourVisit(emptyTourPreferences(), tour, 'paused', 'contacts-views');
    const visible = tour.steps.filter((step) => step.id !== 'contacts-views');
    expect(visible[resumeTourIndex(preferences, tour, visible)].id).toBe('contacts-list');
    const lastPaused = recordTourVisit(preferences, tour, 'paused', 'contacts-create');
    expect(resumeTourIndex(lastPaused, tour, visible.slice(0, -1))).toBe(visible.length - 2);
  });

  it('invalidates an incompatible pause without losing preferences on a new version', () => {
    const preferences = recordTourVisit(
      { ...emptyTourPreferences(), invitations: false },
      tour,
      'paused',
      'contacts-list',
    );
    const updated = { ...tour, version: tour.version + 1 };
    expect(pausedTour(preferences, updated)).toBeNull();
    expect(resumeTourIndex(preferences, updated, updated.steps)).toBe(0);
    expect(shouldAutomaticallyStartTour(preferences, updated)).toBe(false);
    expect(shouldOfferTour(preferences, updated)).toBe(false);
    const saved = recordTourVisit(preferences, updated, 'completed');
    expect(saved.invitations).toBe(false);
    expect(saved.automatic).toBe(false);
    expect(saved.visits.contacts.version).toBe(updated.version);
  });

  it('offers a relevant update once per version and never auto-resumes a pause', () => {
    const saved = recordTourVisit({ ...emptyTourPreferences(), automatic: true }, tour, 'completed');
    expect(shouldOfferTour(saved, { ...tour, version: 2 })).toBe(true);
    expect(shouldAutomaticallyStartTour(saved, { ...tour, version: 2 })).toBe(true);
    expect(shouldAutomaticallyStartTour(recordTourVisit(saved, tour, 'paused', tour.steps[0].id), tour)).toBe(false);
  });

  it('encodes both scope dimensions without collisions or anonymous persistence', () => {
    expect(tourStorageKey(null)).toBeNull();
    expect(tourStorageKey({ userId: '', orgId: 'a' })).toBeNull();
    const keys = [
      { userId: 'user:one', orgId: 'company/two' },
      { userId: 'one', orgId: 'company/two:user' },
      { userId: 'user:one', orgId: 'other' },
      { userId: 'another', orgId: 'company/two' },
    ].map(tourStorageKey);
    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toBe('empreende-crm:tours:v1:company%2Ftwo:user%3Aone');
  });

  it('recovers from corrupt data and whitelists fields instead of retaining personal/form data', () => {
    expect(parseTourPreferences('{broken')).toEqual(emptyTourPreferences());
    expect(parseTourPreferences('null')).toEqual(emptyTourPreferences());
    expect(parseTourPreferences(JSON.stringify({ version: 2, automatic: true }))).toEqual(emptyTourPreferences());
    const parsed = parseTourPreferences(
      JSON.stringify({
        version: 1,
        automatic: false,
        invitations: false,
        email: 'private@example.com',
        visits: {
          contacts: { version: 1, status: 'paused', stepId: 'contacts-list', contact: 'Personal content' },
          dashboard: { version: 1, status: 'completed', email: 'private@example.com' },
          'invalid id': { version: 1, status: 'completed' },
          tasks: { version: -1, status: 'completed' },
          agenda: { version: 1, status: 'paused', stepId: 'email@example.com' },
        },
      }),
    );
    expect(parsed.visits).toEqual({
      contacts: { version: 1, status: 'paused', stepId: 'contacts-list' },
      dashboard: { version: 1, status: 'completed' },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/private|Personal|email/);
  });

  it('keeps fallback memory across remounts and isolates it when storage denies access', () => {
    const key = tourStorageKey({ orgId: 'denied-a', userId: 'user' });
    const other = tourStorageKey({ orgId: 'denied-b', userId: 'user' });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    const saved = recordTourVisit(emptyTourPreferences(), tour, 'paused', 'contacts-list');
    writeTourPreferences(key, saved);
    expect(readTourPreferences(key)).toEqual(saved);
    expect(readTourPreferences(other)).toEqual(emptyTourPreferences());
    expect(readTourPreferences(null)).toEqual(emptyTourPreferences());
    get.mockRestore();
    set.mockRestore();
  });

  it('respects an explicit storage reset instead of reviving already persisted memory', () => {
    const key = tourStorageKey({ orgId: 'reset-org', userId: 'reset-user' })!;
    writeTourPreferences(key, recordTourVisit(emptyTourPreferences(), tour, 'completed'));
    expect(readTourPreferences(key).visits.contacts.status).toBe('completed');
    localStorage.removeItem(key);
    expect(readTourPreferences(key)).toEqual(emptyTourPreferences());
  });
});

describe('catalog contracts and small viewports', () => {
  it('has eight commercial guides with 3–5 unique stable steps and exact attribute selectors', () => {
    expect(productTours.map((item) => item.id)).toEqual([
      'dashboard',
      'contacts',
      'pipeline',
      'agenda',
      'tasks',
      'financeiro',
      'automations',
      'integrations',
    ]);
    expect(new Set(productTours.map((item) => item.id)).size).toBe(8);
    for (const item of productTours) {
      expect(item.steps.length).toBeGreaterThanOrEqual(3);
      expect(item.steps.length).toBeLessThanOrEqual(5);
      expect(new Set(item.steps.map((step) => step.id)).size).toBe(item.steps.length);
      for (const step of item.steps) expect(step.target).toBe(`[data-tour="${step.id}"]`);
    }
  });

  it('teaches import without activation and export restricted to managers in the integrations guide v2', () => {
    const integrations = productTours.find((item) => item.id === 'integrations')!;
    expect(integrations.version).toBe(2);
    expect(integrations.steps.map((step) => step.id)).toEqual([
      'integrations-catalog',
      'integrations-import',
      'integrations-export',
      'integrations-help',
    ]);
    const text = integrations.steps.map((step) => `${step.title} ${step.description}`).join(' ');
    expect(text).not.toMatch(/habilit/i);
    expect(text).toMatch(/Donos e administradores exportam/);
    // Item 1.10 (revisão): as colunas da planilha, como a Ajuda e a tela as citam, e o aviso de que a importação ainda
    // não as lê (quem reimporta perde a marca).
    expect(text).toContain('Ela leva as colunas nao_contatar e base_legal, que a importação ainda não lê');
    const saved = recordTourVisit(emptyTourPreferences(), { ...integrations, version: 1 }, 'completed');
    expect(shouldOfferTour(saved, integrations)).toBe(true);
  });

  it('keeps the F0 behavior in the step texts and names who uses the restricted steps', () => {
    const steps = new Map(productTours.flatMap((item) => item.steps.map((step) => [step.id, step.description])));
    // Itens 0.5, 0.6, 0.7 e 0.10 do roteiro: valor no padrão brasileiro, probabilidade da etapa, movimentação otimista,
    // automação que nasce pausada e não pausa ao editar, e a fila que agrupa contatos sem próxima ação.
    expect(steps.get('pipeline-create')).toContain('1.500,00');
    expect(steps.get('pipeline-summary')).toContain('a da etapa');
    expect(steps.get('pipeline-move')).toContain('volta à etapa anterior');
    expect(steps.get('finance-create')).toContain('Donos, administradores e colaboradores');
    expect(steps.get('automations-create')).toContain('Donos e administradores');
    expect(steps.get('automations-status')).toContain('Editar uma automação ativa não a pausa');
    expect(steps.get('today-attention')).toContain('num item só');
    expect(steps.get('today-attention')).toContain('ou de uma mesma pessoa desativada');
    // A tela se chama Pipeline, e o seletor escolhe o funil, como em Configurações (aba “Funis”) e na Ajuda.
    expect(steps.get('pipeline-selector')).toContain('O funil selecionado');
    const text = productTours.flatMap((item) => [
      item.title,
      item.description,
      ...item.steps.map((s) => s.description),
    ]);
    for (const entry of text)
      expect(entry).not.toMatch(/Somente administradores|só administradores|exige um administrador/);
    // Achado 8 da revisão da Ajuda (item 1.2): "banco" pode ser lido como o banco do dinheiro num CRM com Financeiro.
    expect(steps.get('pipeline-move')).toContain('até a gravação terminar');
    for (const entry of [...text, ...productTours.flatMap((item) => item.steps.map((s) => s.title))])
      expect(entry).not.toMatch(/\bbanco\b/i);
  });

  // Os passos citam entre aspas curvas os botões que ensinam; a prova é o código da tela do roteiro, nunca a Ajuda nem
  // o guia. O nome precisa aparecer inteiro num desses arquivos (src/test/ui-labels.ts): um botão renomeado ali, como
  // “Pausar” em Automações, reprova o passo que ainda o cita, mesmo que a palavra continue numa frase ou em outra tela.
  const TOUR_SCREENS: Record<string, string[]> = {
    // A barra de canais (item 1.9) mora na ficha e no botão do canal das atividades de Hoje.
    dashboard: [
      'src/pages/Dashboard.tsx',
      'src/components/shell/TopbarActions.tsx',
      'src/components/channels/ChannelBar.tsx',
    ],
    // A seção "Privacidade" (item 1.10) mora na ficha 360, com a exportação e a anonimização.
    contacts: [
      'src/components/commercial/DirectoryPage.tsx',
      'src/components/channels/ChannelBar.tsx',
      'src/components/privacy/ContactPrivacySection.tsx',
    ],
    pipeline: ['src/pages/Pipeline.tsx', 'src/components/pipeline/DealBoard.tsx'],
    agenda: ['src/pages/Agenda.tsx'],
    tasks: ['src/components/workday/ActivityPage.tsx', 'src/components/workday/ActivityList.tsx'],
    financeiro: ['src/pages/Financeiro.tsx'],
    automations: ['src/pages/Automations.tsx', 'src/lib/operation-logic.ts'],
    integrations: ['src/pages/Integrations.tsx'],
  };
  it('cites only interface names shown by the screen of each tour', () => {
    expect(Object.keys(TOUR_SCREENS).sort()).toEqual(productTours.map((item) => item.id).sort());
    const cited = productTours.flatMap((item) =>
      item.steps.flatMap((step) =>
        quotedLabels(`${step.title} ${step.description}`).map((label) => ({ tour: item.id, step: step.id, label })),
      ),
    );
    expect(cited.length).toBeGreaterThanOrEqual(15);
    for (const { tour: id, step, label } of cited)
      expect(
        TOUR_SCREENS[id].some((file) => showsLabel(file, label)),
        `${step}: “${label}” sumiu de ${TOUR_SCREENS[id].join(', ')} ou ficou só no meio de uma frase`,
      ).toBe(true);
    for (const step of ['automations-status', 'automations-list', 'automations-trigger', 'integrations-import'])
      expect(
        cited.some((entry) => entry.step === step),
        step,
      ).toBe(true);
  });

  it.each([
    { top: 0, left: 0, width: 320, height: 568 },
    { top: 120, left: 15, width: 320, height: 200 },
    { top: 0, left: 0, width: 568, height: 100 },
    { top: 30, left: 40, width: 250, height: 220 },
    { top: 0, left: 0, width: 1280, height: 720 },
  ])('contains the full card with keyboard/zoom viewport %j', (viewport) => {
    const positioned = placeTourCard({ top: 900, left: 1100, width: 500, height: 300 }, viewport, {
      width: 360,
      height: 600,
    });
    expect(positioned.left).toBeGreaterThanOrEqual(viewport.left);
    expect(positioned.top).toBeGreaterThanOrEqual(viewport.top);
    expect(positioned.left + positioned.width).toBeLessThanOrEqual(viewport.left + viewport.width);
    expect(positioned.top + positioned.height).toBeLessThanOrEqual(viewport.top + viewport.height);
  });
});
