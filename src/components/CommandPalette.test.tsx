import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
// Sem a espera da digitação: a busca sai na hora.
vi.mock('@/hooks/useDebounce', () => ({ useDebounce: <T,>(value: T) => value }));
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: { rpc: (...args: unknown[]) => ({ abortSignal: async () => mocks.rpc(...args) }) },
}));

import { CommandPalette } from './CommandPalette';

afterEach(cleanup);

describe('busca global (Ctrl+K)', () => {
  it('mostra o telefone brasileiro do subtítulo formatado e mantém os demais subtítulos como vieram (item 1.9)', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { entity: 'contact', id: '1', title: 'Ana Souza', subtitle: '+5511999990000', path: '/contacts?contact=1' },
        { entity: 'company', id: '2', title: 'Padaria', subtitle: '+551130000000', path: '/companies?company=2' },
        { entity: 'contact', id: '3', title: 'Bia', subtitle: '99999-0000', path: '/contacts?contact=3' },
        { entity: 'contact', id: '4', title: 'Caio', subtitle: 'caio@example.com', path: '/contacts?contact=4' },
        { entity: 'deal', id: '5', title: 'Site novo', subtitle: 'Proposta', path: '/pipeline?deal=5' },
      ],
      error: null,
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CommandPalette open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Buscar registros e páginas'), { target: { value: 'an' } });
    const results = await screen.findByRole('region', { name: 'Registros' });
    expect(await screen.findByRole('button', { name: 'Ana Souza (11) 99999-0000' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Padaria (11) 3000-0000' })).toBeInTheDocument();
    // Um número não reconhecido aparece como foi gravado; e-mail e etapa não passam pela formatação.
    expect(screen.getByRole('button', { name: 'Bia 99999-0000' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Caio caio@example.com' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Site novo Proposta' })).toBeInTheDocument();
    expect(results).not.toHaveTextContent('+55');
    expect(mocks.rpc).toHaveBeenCalledWith('search_crm', { p_query: 'an', p_limit: 30 });
  });
});
