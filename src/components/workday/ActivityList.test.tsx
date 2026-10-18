import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '@/lib/activity-logic';
import type { Company, Contact, RelationshipData } from '@/lib/contact-model';
import { InteractionPromptContext, type InteractionPromptValue } from '@/components/channels/interaction-context';

const mocks = vi.hoisted(() => ({ canWrite: true }));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({
  useCrmPermissions: () => ({ canWrite: mocks.canWrite, canManage: false }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ profile: { name: 'Carla Dias' } }) }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: vi.fn() } }));

import { ActivityList } from './ActivityList';

const contact = (fields: Partial<Contact> = {}) =>
  ({
    id: 'ana',
    org_id: 'org-1',
    first_name: 'Ana',
    last_name: 'Souza',
    email: 'ana@example.com',
    phone: '+5511999990000',
    company_id: null,
    owner_id: null,
    status: 'lead',
    do_not_contact: false,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...fields,
  }) as Contact;
const company = (fields: Partial<Company> = {}) =>
  ({
    id: 'padaria',
    org_id: 'org-1',
    name: 'Padaria',
    phone: '+551130000000',
    owner_id: null,
    do_not_contact: false,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...fields,
  }) as Company;
const activity = (fields: Partial<Activity> = {}) =>
  ({
    id: 'activity-1',
    org_id: 'org-1',
    type: 'call',
    title: 'Falar com a Ana',
    body: null,
    contact_id: 'ana',
    company_id: null,
    deal_id: null,
    user_id: null,
    due_date: '2099-01-01T12:00:00Z',
    end_date: null,
    completed_at: null,
    outcome: null,
    created_by: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...fields,
  }) as Activity;

function mount(activities: Activity[], { contacts = [contact()], companies = [company()] } = {}) {
  const data: RelationshipData = { contacts, companies, deals: [], activities, members: [] };
  const prompt: InteractionPromptValue = {
    enabled: mocks.canWrite,
    pending: [],
    track: vi.fn(),
    pendingFor: vi.fn(),
    dismiss: vi.fn(),
    subjectOf: vi.fn(),
    openDialog: vi.fn(),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <InteractionPromptContext.Provider value={prompt}>
          <ActivityList activities={activities} data={data} onOpen={vi.fn()} onEdit={vi.fn()} />
        </InteractionPromptContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const item = (title: string) => screen.getByRole('button', { name: title }).closest('li')!;
const channelLabels = ['WhatsApp', 'E-mail', 'Ligar'];
const channelButtons = (title: string) =>
  within(item(title))
    .queryAllByRole('button')
    .map((button) => button.textContent)
    .filter((text) => channelLabels.includes(text ?? ''));

beforeEach(() => {
  mocks.canWrite = true;
});
afterEach(cleanup);

// Achado 1 da revisão do item 1.9: o botão do canal das atividades pendentes de Hoje, Atividades e Agenda.
describe('botão do canal nas atividades (item 1.9)', () => {
  it.each([
    ['call', 'Ligar'],
    ['whatsapp', 'WhatsApp'],
    ['email', 'E-mail'],
  ])('a atividade pendente de %s com o dado mostra um controle só, o do canal', (type, label) => {
    mount([activity({ type })]);
    expect(channelButtons('Falar com a Ana')).toEqual([label]);
    expect(within(item('Falar com a Ana')).getByRole('button', { name: label })).toBeEnabled();
    // Um controle só, sem o grupo da barra.
    expect(within(item('Falar com a Ana')).queryByRole('group')).not.toBeInTheDocument();
  });

  it('concluída, tarefa, reunião, visita e nota não mostram o botão do canal', () => {
    mount([
      activity({ id: 'done', title: 'Ligação feita', completed_at: '2026-10-05T12:00:00Z' }),
      activity({ id: 'task', type: 'task', title: 'Tarefa' }),
      activity({ id: 'meeting', type: 'meeting', title: 'Reunião', end_date: '2099-01-01T13:00:00Z' }),
      activity({ id: 'visit', type: 'visit', title: 'Visita', end_date: '2099-01-01T13:00:00Z' }),
      activity({ id: 'note', type: 'note', title: 'Nota', completed_at: '2026-10-05T12:00:00Z' }),
    ]);
    for (const title of ['Ligação feita', 'Tarefa', 'Reunião', 'Visita', 'Nota'])
      expect(channelButtons(title), title).toEqual([]);
  });

  it('sem o dado do canal, nada aparece: sem telefone para ligação e WhatsApp, sem e-mail para e-mail', () => {
    mount(
      [
        activity({ id: 'call', type: 'call', title: 'Ligação planejada' }),
        activity({ id: 'whatsapp', type: 'whatsapp', title: 'Mandar WhatsApp' }),
        activity({ id: 'email', type: 'email', title: 'Mandar e-mail' }),
      ],
      { contacts: [contact({ phone: null, email: null })] },
    );
    for (const title of ['Ligação planejada', 'Mandar WhatsApp', 'Mandar e-mail'])
      expect(channelButtons(title), title).toEqual([]);
  });

  it('a empresa sem contato, com telefone, mostra a ligação e o WhatsApp, e não o e-mail', () => {
    mount([
      activity({ id: 'call', title: 'Ligar para a padaria', contact_id: null, company_id: 'padaria' }),
      activity({ id: 'email', type: 'email', title: 'E-mail para a padaria', contact_id: null, company_id: 'padaria' }),
    ]);
    expect(channelButtons('Ligar para a padaria')).toEqual(['Ligar']);
    expect(channelButtons('E-mail para a padaria')).toEqual([]);
  });

  it('contato marcado "Não contatar": o controle aparece desabilitado, com o motivo', () => {
    mount([activity({ type: 'whatsapp' })], { contacts: [contact({ do_not_contact: true })] });
    const button = within(item('Falar com a Ana')).getByRole('button', { name: 'WhatsApp' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Este contato está marcado como “Não contatar”.');
  });

  it('Somente leitura abre os canais, sem editar nem concluir', () => {
    mocks.canWrite = false;
    mount([activity({ type: 'whatsapp' })]);
    expect(within(item('Falar com a Ana')).getByRole('button', { name: 'WhatsApp' })).toBeEnabled();
    expect(within(item('Falar com a Ana')).queryByRole('button', { name: 'Concluir' })).not.toBeInTheDocument();
  });
});

// Item 1.10: a atividade de um contato anonimizado fica sem "Editar" e sem "Reabrir", e o vínculo mostra o nome novo.
describe('contato anonimizado (item 1.10)', () => {
  it('a atividade dele fica sem editar nem reabrir; as dos demais, não', () => {
    mount(
      [
        activity({
          id: 'frozen',
          title: 'Ligação (contato anonimizado)',
          contact_id: 'gone',
          completed_at: '2026-10-05T12:00:00Z',
        }),
        activity({ id: 'free', title: 'Ligação da Ana', completed_at: '2026-10-05T12:00:00Z' }),
      ],
      {
        contacts: [
          contact(),
          contact({
            id: 'gone',
            first_name: 'Contato anonimizado',
            last_name: null,
            email: null,
            phone: null,
            anonymized_at: '2026-10-13T12:00:00Z',
          }),
        ],
      },
    );
    const frozen = item('Ligação (contato anonimizado)');
    expect(within(frozen).queryByRole('button', { name: /^Editar/ })).not.toBeInTheDocument();
    expect(within(frozen).queryByRole('button', { name: 'Reabrir' })).not.toBeInTheDocument();
    expect(within(frozen).getByRole('link', { name: 'Contato anonimizado' })).toHaveAttribute(
      'href',
      '/contacts?contact=gone',
    );
    const free = item('Ligação da Ana');
    expect(within(free).getByRole('button', { name: 'Editar Ligação da Ana' })).toBeInTheDocument();
    expect(within(free).getByRole('button', { name: 'Reabrir' })).toBeInTheDocument();
  });
});
