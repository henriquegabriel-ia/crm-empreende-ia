import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contact, RelationshipActivity, RelationshipData } from '@/lib/contact-model';

const mocks = vi.hoisted(() => ({ from: vi.fn(), success: vi.fn() }));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => ({ canWrite: true, canManage: false }) }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: mocks.from } }));
vi.mock('sonner', () => ({ toast: { success: mocks.success } }));

import { Relationship360 } from './Relationship360';

const contact = {
  id: 'contact-1',
  org_id: 'org-1',
  first_name: 'Mariana',
  last_name: 'Alves',
  email: null,
  phone: null,
  company_id: null,
  owner_id: null,
  status: 'lead',
  job_title: null,
  source: null,
  notes: null,
  created_at: '2026-10-01T10:00:00.000000+00:00',
  updated_at: '2026-10-01T10:00:00.000000+00:00',
} as Contact;
function activity(fields: Partial<RelationshipActivity> = {}): RelationshipActivity {
  return {
    id: 'activity-1',
    org_id: 'org-1',
    title: 'Retorno da proposta',
    body: null,
    type: 'task',
    user_id: null,
    contact_id: 'contact-1',
    company_id: null,
    deal_id: null,
    due_date: '2099-01-01T12:00:00.000000+00:00',
    end_date: null,
    completed_at: null,
    created_by: null,
    created_at: '2026-10-01T10:00:00.000000+00:00',
    updated_at: '2026-10-01T10:00:00.123456+00:00',
    ...fields,
  };
}
/** Atualização condicional como no PostgreSQL: só grava quando todos os filtros batem. */
function database(row: RelationshipActivity) {
  const state = { row: { ...row }, filters: [] as [string, unknown][] };
  mocks.from.mockImplementation(() => {
    let patch: Partial<RelationshipActivity> = {};
    const chain = {
      update: (fields: Partial<RelationshipActivity>) => {
        patch = fields;
        state.filters = [];
        return chain;
      },
      eq: (column: string, value: unknown) => {
        state.filters.push([column, value]);
        return chain;
      },
      select: () => chain,
      single: async () => ({ data: { id: state.row.id }, error: null }),
      maybeSingle: async () => {
        if (!state.filters.every(([column, value]) => state.row[column as keyof RelationshipActivity] === value))
          return { data: null, error: null };
        Object.assign(state.row, patch, { updated_at: '2026-10-01T10:05:00.000001+00:00' });
        return { data: { id: state.row.id }, error: null };
      },
    };
    return chain;
  });
  return state;
}
function mount(shown: RelationshipActivity) {
  const data: RelationshipData = { contacts: [contact], companies: [], deals: [], activities: [shown], members: [] };
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(cache, 'invalidateQueries');
  function Providers({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={cache}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  render(<Relationship360 kind="contacts" record={contact} data={data} onClose={vi.fn()} onEdit={vi.fn()} />, {
    wrapper: Providers,
  });
  return { invalidate };
}
const timelineItem = () => screen.getByRole('heading', { name: 'Retorno da proposta' }).closest('li')!;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ficha 360: concluir e reabrir atividades', () => {
  it('conclui pela mesma gravação de useActivityActions, com a versão exibida', async () => {
    const shown = activity();
    const state = database(shown);
    mount(shown);
    fireEvent.click(within(timelineItem()).getByRole('button', { name: 'Concluir' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Atividade concluída'));
    expect(mocks.from).toHaveBeenCalledWith('activities');
    expect(state.filters).toEqual([
      ['org_id', 'org-1'],
      ['id', 'activity-1'],
      ['updated_at', '2026-10-01T10:00:00.123456+00:00'],
    ]);
    expect(state.row.completed_at).not.toBeNull();
  });

  it('atividade concluída por outra pessoa mostra o conflito em vez de desfazer a conclusão', async () => {
    const shown = activity();
    const state = database(shown);
    // Um colega concluiu a atividade depois que a ficha carregou.
    Object.assign(state.row, {
      completed_at: '2026-10-01T10:03:00.000000+00:00',
      updated_at: '2026-10-01T10:03:00.000001+00:00',
    });
    const current = { ...state.row };
    const { invalidate } = mount(shown);
    fireEvent.click(within(timelineItem()).getByRole('button', { name: 'Concluir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta atividade mudou ou não está mais disponível');
    expect(state.row).toEqual(current);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['crm'] });
  });

  it('reabrir uma atividade alterada por outra pessoa também é recusado', async () => {
    const shown = activity({ completed_at: '2026-10-01T10:01:00.000000+00:00' });
    const state = database(shown);
    Object.assign(state.row, { title: 'Retorno revisado', updated_at: '2026-10-01T10:04:00.000001+00:00' });
    mount(shown);
    fireEvent.click(within(timelineItem()).getByRole('button', { name: 'Reabrir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta atividade mudou');
    expect(state.row.completed_at).toBe('2026-10-01T10:01:00.000000+00:00');
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
