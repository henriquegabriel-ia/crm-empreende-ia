import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '@/lib/activity-logic';
import type { Contact, RelationshipData } from '@/lib/contact-model';
import { InteractionPromptContext } from '@/components/channels/interaction-context';

vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => ({ canWrite: true, canManage: true }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ profile: { name: 'Carla Dias' } }) }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: vi.fn() } }));

import { ActivityDetail } from './ActivityDetail';

const contact = (fields: Partial<Contact>) =>
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
const activity = {
  id: 'call',
  org_id: 'org-1',
  type: 'call',
  title: 'Ligação',
  body: null,
  contact_id: 'ana',
  company_id: null,
  deal_id: null,
  user_id: null,
  due_date: '2026-10-05T12:00:00Z',
  end_date: null,
  completed_at: '2026-10-05T12:00:00Z',
  outcome: 'answered',
  created_by: null,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-05T12:00:00Z',
} as Activity;

function mount(person: Contact) {
  const data: RelationshipData = { contacts: [person], companies: [], deals: [], activities: [activity], members: [] };
  const prompt = {
    enabled: true,
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
          <ActivityDetail activity={activity} data={data} onClose={vi.fn()} onEdit={vi.fn()} />
        </InteractionPromptContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(cleanup);

// Item 1.10: a atividade de um contato anonimizado fica para consulta, sem canais, sem editar e sem reabrir.
describe('detalhe da atividade de um contato anonimizado (item 1.10)', () => {
  it('sem canais, sem "Editar / reagendar" e sem "Reabrir", com o motivo; excluir continua para gestores', () => {
    mount(
      contact({
        first_name: 'Contato anonimizado',
        last_name: null,
        email: null,
        phone: null,
        anonymized_at: '2026-10-13T12:00:00Z',
      }),
    );
    expect(
      screen.getByText('Esta atividade é de um contato anonimizado e não pode ser editada nem reaberta.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Canais' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar / reagendar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reabrir' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contato anonimizado' })).toBeInTheDocument();
  });

  it('a de um contato comum continua com os canais, a edição e "Reabrir"', () => {
    mount(contact({}));
    expect(screen.getByRole('heading', { name: 'Canais' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar / reagendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reabrir' })).toBeInTheDocument();
    expect(screen.queryByText(/contato anonimizado e não pode/)).not.toBeInTheDocument();
  });
});
