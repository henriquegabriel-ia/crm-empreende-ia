import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Deal, DealPerson } from '@/lib/deal-types';
import { DealDetail } from './DealDetail';

vi.mock('./data', () => ({
  allRows: async () => [],
  errorMessage: (error: Error) => error.message,
  pipelineDb: {},
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));

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

function setup(people: DealPerson[], current: Deal = deal) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DealDetail
          deal={current}
          stages={stages}
          contacts={[]}
          companies={[]}
          people={people}
          activities={[]}
          canWrite
          canManage={false}
          busy={false}
          onClose={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onMove={vi.fn()}
          onCreateAction={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
