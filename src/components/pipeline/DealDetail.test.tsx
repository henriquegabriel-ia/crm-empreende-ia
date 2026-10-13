import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Deal, DealActivity, DealContact, DealPerson } from '@/lib/deal-types';
import { InteractionPromptContext } from '@/components/channels/interaction-context';
import { DealDetail } from './DealDetail';

vi.mock('./data', () => ({
  allRows: async () => [],
  errorMessage: (error: Error) => error.message,
  pipelineDb: {},
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => ({ canWrite: true }) }));

const deal: Deal = {
  id: 'deal',
  org_id: 'org',
  pipeline_id: 'p',
  stage_id: 's',
  title: 'Contrato anual',
  value: 1000,
  currency: 'BRL',
  contact_id: null,
  company_id: null,
  owner_id: 'saiu',
  close_date: null,
  probability: null,
  status: 'won',
  lost_reason: null,
  closed_at: '2026-10-01T12:00:00.000Z',
  stage_entered_at: '2026-09-01T12:00:00.000Z',
  created_at: '2026-09-01T12:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000Z',
};
const stages = [
  { id: 's', org_id: 'org', pipeline_id: 'p', name: 'Proposta', order: 0, win_probability: 50, color: null },
];

function setup(
  people: DealPerson[],
  current: Deal = deal,
  { contacts = [], activities = [] }: { contacts?: DealContact[]; activities?: DealActivity[] } = {},
) {
  const onCreateAction = vi.fn(async () => undefined);
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
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <InteractionPromptContext.Provider value={prompt}>
          <DealDetail
            deal={current}
            stages={stages}
            contacts={contacts}
            companies={[]}
            people={people}
            activities={activities}
            canWrite
            canManage={false}
            busy={false}
            onClose={vi.fn()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onMove={vi.fn()}
            onCreateAction={onCreateAction}
          />
        </InteractionPromptContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onCreateAction, prompt };
}

describe('próxima ação com o responsável desativado (item 1.2)', () => {
  const people = [
    { id: 'saiu', full_name: 'Fulano', active: false },
    { id: 'me', full_name: 'Pessoa que usa', active: true },
    { id: 'ana', full_name: 'Ana', active: true },
  ];

  it('mostra o responsável marcado e propõe "Combinar ação" para quem está usando, sem oferecer o desativado', () => {
    setup(people);
    expect(screen.getByText('Fulano (desativado)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Combinar ação' }));
    const owner = screen.getByLabelText('Responsável *');
    expect(owner).toHaveTextContent('Pessoa que usa');
    fireEvent.keyDown(owner, { key: 'ArrowDown' });
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Selecione', 'Ana', 'Pessoa que usa']);
  });

  it('com o responsável ativo, a próxima ação vai para ele', () => {
    setup(people, { ...deal, owner_id: 'ana', status: 'open', closed_at: null });
    fireEvent.click(screen.getByRole('button', { name: 'Combinar ação' }));
    expect(screen.getByLabelText('Responsável *')).toHaveTextContent('Ana');
  });
});

// Item 1.9: os canais do contato da oportunidade, o tipo em "Combinar ação" e os botões das próximas ações.
describe('canais na oportunidade (item 1.9)', () => {
  const people = [{ id: 'me', full_name: 'Pessoa que usa', active: true }];
  const ana: DealContact = {
    id: 'ana',
    full_name: 'Ana Souza',
    first_name: 'Ana',
    last_name: 'Souza',
    company_id: null,
    phone: '+5511999990000',
    email: 'ana@example.test',
    do_not_contact: false,
  };
  const open = { ...deal, owner_id: 'me', status: 'open' as const, closed_at: null, contact_id: 'ana' };

  it('mostra o contato com o telefone formatado e a barra de canais dele', () => {
    setup(people, open, { contacts: [ana] });
    expect(screen.getByText('(11) 99999-0000 · ana@example.test')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Canais de Ana Souza' })).toBeInTheDocument();
  });

  it('sem contato nem empresa, explica como usar os canais', () => {
    setup(people, { ...open, contact_id: null });
    expect(screen.getByText('Vincule um contato para usar WhatsApp, e-mail e telefone.')).toBeInTheDocument();
  });

  it('"Combinar ação" escolhe o tipo, com Tarefa como padrão e sem Nota', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const { onCreateAction } = setup(people, open);
    fireEvent.click(screen.getByRole('button', { name: 'Combinar ação' }));
    const type = screen.getByLabelText('Tipo');
    expect(type).toHaveTextContent('Tarefa');
    fireEvent.keyDown(type, { key: 'ArrowDown' });
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Tarefa', 'Ligação', 'WhatsApp', 'E-mail', 'Reunião', 'Visita']);
    fireEvent.click(screen.getByRole('option', { name: 'WhatsApp' }));
    fireEvent.change(screen.getByLabelText('O que precisa acontecer? *'), { target: { value: 'Mandar o contrato' } });
    fireEvent.change(screen.getByLabelText('Prazo *'), { target: { value: '2026-12-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar ação' }));
    await vi.waitFor(() =>
      expect(onCreateAction).toHaveBeenCalledWith({
        title: 'Mandar o contrato',
        due_date: '2026-12-01T10:00',
        user_id: 'me',
        type: 'whatsapp',
      }),
    );
  });

  it('cada próxima ação de canal tem o botão do canal e "Concluir e agendar a próxima"', () => {
    const action: DealActivity = {
      id: 'call',
      org_id: 'org',
      deal_id: 'deal',
      title: 'Ligar para a Ana',
      type: 'call',
      due_date: '2026-12-01T10:00:00Z',
      completed_at: null,
      user_id: 'me',
      contact_id: 'ana',
      company_id: null,
      updated_at: '2026-10-01T12:00:00.123456+00:00',
    };
    const { prompt } = setup(people, open, { contacts: [ana], activities: [action] });
    const item = screen.getByText('Ligar para a Ana').closest('li')!;
    expect(item).toHaveTextContent('Ligação ·');
    expect(within(item).getByRole('button', { name: 'Ligar' })).toBeEnabled();
    fireEvent.click(within(item).getByRole('button', { name: 'Concluir e agendar a próxima' }));
    expect(prompt.openDialog).toHaveBeenCalledWith({
      mode: 'complete',
      requireNext: true,
      activity: expect.objectContaining({ id: 'call', updated_at: '2026-10-01T12:00:00.123456+00:00', type: 'call' }),
    });
  });
});
