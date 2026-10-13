import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const TEMPLATES = [
  {
    id: 'template-1',
    org_id: 'org-1',
    name: 'Primeiro contato',
    subject: 'Proposta para {{empresa}}',
    body: 'Olá, {{ primeiro_nome }}! Aqui é {{meu_nome}}, da {{organizacao}}. Segue {{ver anexo}} e {{desconto}}.',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  },
  {
    id: 'template-2',
    org_id: 'org-1',
    name: 'Agradecimento',
    subject: 'Obrigado',
    body: 'Obrigado pela conversa.',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  },
];
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({
  useCrmPermissions: () => ({ canWrite: true, canManage: true, loading: false }),
}));
vi.mock('@/components/channels/useMessageTemplates', () => ({ loadMessageTemplates: async () => TEMPLATES }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: {} }));
vi.mock('@/components/shell/PageScaffold', () => ({
  PageScaffold: ({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {actions}
      {children}
    </main>
  ),
}));

import Templates from './Templates';

function setup(path = '/templates') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Templates />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(cleanup);

describe('Modelos com os canais (item 1.9)', () => {
  it('diz que os modelos são usados pelos botões dos canais e que o CRM não envia sozinho', async () => {
    setup();
    expect(await screen.findByText('Primeiro contato')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Rascunhos compartilhados com a equipe. Use-os pelos botões “WhatsApp” e “E-mail” das fichas, que preenchem as variáveis e abrem o seu aplicativo; o CRM não envia mensagens sozinho.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/O envio externo ainda não está conectado/)).not.toBeInTheDocument();
  });

  it('o detalhe lista as variáveis do CRM e as desconhecidas, uma vez cada', async () => {
    setup('/templates?template=template-1');
    const panel = await screen.findByRole('dialog', { name: 'Primeiro contato' });
    expect(
      within(panel).getByText(
        'Variáveis preenchidas pelo CRM: {{empresa}}, {{primeiro_nome}}, {{meu_nome}}, {{organizacao}}.',
      ),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText('Desconhecidas, para completar ao usar: {{ver anexo}}, {{desconto}}.'),
    ).toBeInTheDocument();
  });

  it('um modelo sem variáveis diz que o texto é usado como está', async () => {
    setup('/templates?template=template-2');
    const panel = await screen.findByRole('dialog', { name: 'Agradecimento' });
    expect(within(panel).getByText('Sem variáveis: o texto é usado como está.')).toBeInTheDocument();
  });
});
