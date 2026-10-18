import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contact } from '@/lib/contact-model';

const mocks = vi.hoisted(() => ({
  role: 'member',
  update: vi.fn(),
  eq: vi.fn(),
  result: { data: { id: 'contact-1' }, error: null } as { data: unknown; error: unknown },
  toast: { success: vi.fn() },
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({
  useCrmPermissions: () => ({
    canWrite: ['owner', 'admin', 'member'].includes(mocks.role),
    canManage: ['owner', 'admin'].includes(mocks.role),
  }),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: {
    from: () => ({
      update: (fields: unknown) => {
        mocks.update(fields);
        const chain = {
          eq: (column: string, value: unknown) => {
            mocks.eq(column, value);
            return chain;
          },
          select: () => ({ maybeSingle: async () => mocks.result }),
        };
        return chain;
      },
    }),
  },
}));

import { DoNotContactPanel } from './DoNotContactPanel';

const contact = (fields: Partial<Contact> = {}) =>
  ({
    id: 'contact-1',
    org_id: 'org-1',
    first_name: 'Ana',
    last_name: 'Souza',
    do_not_contact: false,
    do_not_contact_at: null,
    do_not_contact_by: null,
    do_not_contact_reason: null,
    updated_at: '2026-10-13T10:00:00.123456+00:00',
    ...fields,
  }) as Contact;
const members = [{ id: 'user-1', name: 'Ana Lima', email: 'ana.lima@example.com' }];
function setup(record = contact(), markedContacts = 0, kind: 'contacts' | 'companies' = 'contacts') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DoNotContactPanel kind={kind} record={record} members={members} markedContacts={markedContacts} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.role = 'member';
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.result = { data: { id: 'contact-1' }, error: null };
  mocks.toast.success.mockReset();
});
afterEach(cleanup);

describe('"Não contatar" (item 1.9)', () => {
  it('quem edita marca, com o motivo aparado e a guarda de versão', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como não contatar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Marcar como não contatar?' });
    expect(dialog).toHaveTextContent('WhatsApp, e-mail e ligação ficam desligados para este contato');
    // Item 1.10: a confirmação diz que o CRM também recusa agendar ação de contato, e o que acontece com o que já estava
    // na agenda.
    expect(dialog).toHaveTextContent(
      'o CRM passa a recusar agendar ligação, WhatsApp, e-mail, reunião ou visita com ele. As ações já agendadas continuam na agenda até serem concluídas ou trocadas por tarefa.',
    );
    const reason = within(dialog).getByLabelText('Motivo (opcional)');
    expect(reason).toHaveAccessibleDescription(
      'Ex.: pediu para parar de receber mensagens. Não escreva dados sensíveis, como saúde ou religião.',
    );
    fireEvent.change(reason, { target: { value: '  Pediu para parar.  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Marcar como não contatar' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Marcado como “Não contatar”'));
    expect(mocks.update).toHaveBeenCalledWith({ do_not_contact: true, do_not_contact_reason: 'Pediu para parar.' });
    expect(mocks.eq.mock.calls).toEqual([
      ['org_id', 'org-1'],
      ['id', 'contact-1'],
      ['updated_at', '2026-10-13T10:00:00.123456+00:00'],
    ]);
  });

  it('marcado: mostra quem marcou, quando e o motivo; o colaborador não vê "Permitir contato de novo"', () => {
    setup(
      contact({
        do_not_contact: true,
        do_not_contact_at: '2026-10-12T15:00:00.000Z',
        do_not_contact_by: 'user-1',
        do_not_contact_reason: 'Pediu por e-mail.',
      }),
    );
    const band = screen.getByRole('region', { name: 'Não contatar' });
    expect(band).toHaveTextContent(
      'Marcado por Ana Lima em 12/10/2026. WhatsApp, e-mail e ligação ficam desligados neste CRM, e o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele. As ações já agendadas continuam na agenda até serem concluídas ou trocadas por tarefa.',
    );
    expect(band).toHaveTextContent('Motivo: Pediu por e-mail.');
    expect(within(band).queryByRole('button', { name: 'Permitir contato de novo' })).not.toBeInTheDocument();
    expect(band).toHaveTextContent('Só donos e administradores permitem o contato de novo.');
    expect(screen.queryByRole('button', { name: 'Marcar como não contatar' })).not.toBeInTheDocument();
  });

  it('o administrador permite o contato de novo, com confirmação', async () => {
    mocks.role = 'admin';
    setup(contact({ do_not_contact: true, do_not_contact_at: '2026-10-12T15:00:00.000Z' }));
    fireEvent.click(screen.getByRole('button', { name: 'Permitir contato de novo' }));
    const confirm = await screen.findByRole('dialog', { name: 'Permitir contato de novo?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Permitir contato de novo' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ do_not_contact: false }));
    expect(mocks.toast.success).toHaveBeenCalledWith('Contato permitido de novo');
  });

  it('a versão mudada por outra pessoa mostra o conflito, e a recusa do banco aparece como está', async () => {
    mocks.result = { data: null, error: null };
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como não contatar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Marcar como não contatar?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Marcar como não contatar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Este contato mudou ou não está mais disponível.',
    );
    mocks.result = { data: null, error: { code: 'PGRST204', message: "Could not find the 'do_not_contact' column" } };
    fireEvent.click(within(dialog).getByRole('button', { name: 'Marcar como não contatar' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Este CRM ainda não tem a atualização dos canais.'),
    );
  });

  it('na empresa, a marca vale para o telefone dela, sem e-mail, e os contatos continuam liberados', async () => {
    mocks.role = 'admin';
    const company = { ...contact(), name: 'Padaria' } as unknown as Contact;
    setup(company, 0, 'companies');
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como não contatar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Marcar como não contatar?' });
    expect(dialog).toHaveTextContent(
      'Vale para o telefone da empresa: WhatsApp e ligação para ele ficam desligados em todas as telas do CRM, e o CRM passa a recusar agendar ligação ou WhatsApp sem um contato. Os contatos dela continuam liberados: marque cada um que pediu para não ser procurado.',
    );
    expect(dialog).not.toHaveTextContent('e-mail');
    cleanup();
    setup(
      { ...company, do_not_contact: true, do_not_contact_at: '2026-10-12T15:00:00.000Z' } as Contact,
      0,
      'companies',
    );
    const band = screen.getByRole('region', { name: 'Não contatar' });
    expect(band).toHaveTextContent(
      'Vale para o telefone da empresa: WhatsApp e ligação ficam desligados neste CRM, e o CRM não agenda ligação nem WhatsApp para ele. Os contatos dela continuam liberados.',
    );
    expect(band).not.toHaveTextContent('e-mail');
    fireEvent.click(within(band).getByRole('button', { name: 'Permitir contato de novo' }));
    const confirm = await screen.findByRole('dialog', { name: 'Permitir contato de novo?' });
    expect(confirm).toHaveTextContent(
      'Os botões de WhatsApp e ligação do telefone da empresa voltam a funcionar, e o CRM volta a agendar ligação e WhatsApp para ele.',
    );
  });

  it('Somente leitura não marca, e a empresa diz quantos contatos dela estão marcados', () => {
    mocks.role = 'viewer';
    setup({ ...contact(), name: 'Padaria' } as unknown as Contact, 2, 'companies');
    expect(screen.queryByRole('button', { name: 'Marcar como não contatar' })).not.toBeInTheDocument();
    expect(screen.getByText('2 contatos desta empresa estão marcados como “Não contatar”.')).toBeInTheDocument();
  });
});
