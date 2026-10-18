import { QueryClient, QueryClientProvider, type Query } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportFileName } from '@/lib/brand';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  download: vi.fn(),
  toast: { success: vi.fn() },
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { rpc: mocks.rpc, from: vi.fn() } }));
vi.mock('@/lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/csv')>()),
  downloadBytes: mocks.download,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import { readZip } from '@/test/zip-reader';
import { AnonymizeContactDialog } from './AnonymizeContactDialog';
import { ExportContactDialog } from './ExportContactDialog';

const CONTACT = {
  id: '1a2b3c4d-0000-4000-8000-000000000001',
  first_name: 'Ana',
  last_name: 'Souza',
  email: 'ana@example.com',
  phone: '+5511999990000',
};
const EXPORT = {
  format: 1,
  generated_at: '2026-10-13T15:30:00+00:00',
  organization: { name: 'Acme' },
  contact: {
    ...CONTACT,
    job_title: null,
    source: null,
    notes: null,
    status: 'lead',
    created_at: '2026-09-01T12:00:00+00:00',
    updated_at: '2026-09-01T12:00:00+00:00',
    legal_basis: 'consent',
    legal_basis_note: 'Marcou a caixa do site.',
    legal_basis_at: '2026-09-01T12:00:00+00:00',
    do_not_contact: false,
    do_not_contact_at: null,
    do_not_contact_reason: null,
    anonymized_at: null,
  },
  company: null,
  activities: [],
  deals: [],
  payments: [],
};
const SUMMARY = {
  version: '2026-10-13T12:00:00.123456+00:00',
  anonymized_at: null,
  activities_scrubbed: 3,
  activities_deleted: 1,
  deals: 2,
  open_deals: 1,
  payments: 1,
  pending_payments: 1,
  other_records: 4,
};
const CHANGED = {
  code: 'P0001',
  message: 'Este contato mudou desde o resumo. Confira o resumo atualizado e confirme de novo.',
};

function mount(dialog: 'export' | 'anonymize') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(cache, 'invalidateQueries');
  const onOpenChange = vi.fn();
  const Dialog = dialog === 'export' ? ExportContactDialog : AnonymizeContactDialog;
  render(
    <QueryClientProvider client={cache}>
      <Dialog contact={CONTACT} open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  const reloads = (queryKey: unknown[]) =>
    invalidate.mock.calls.some(([filters]) => filters?.predicate?.({ queryKey } as unknown as Query));
  return { onOpenChange, reloads };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.download.mockReset();
  mocks.toast.success.mockReset();
});
afterEach(cleanup);

describe('Exportar dados deste contato (item 1.10)', () => {
  it('confirma, chama a RPC, baixa o .zip com o nome da marca e registra a exportação na ficha', async () => {
    mocks.rpc.mockResolvedValue({ data: EXPORT, error: null });
    const { onOpenChange, reloads } = mount('export');
    const dialog = screen.getByRole('dialog', { name: 'Exportar os dados de Ana Souza?' });
    expect(dialog).toHaveTextContent('Os nomes da equipe não vão no arquivo.');
    expect(dialog).toHaveTextContent('apague o arquivo do seu computador depois');
    // Só o que está no cadastro dos outros contatos é trocado: um telefone antigo continua no texto.
    expect(dialog).toHaveTextContent('o nome, o e-mail e o telefone gravados no cadastro deles viram [anonimizado]');
    expect(dialog).toHaveTextContent('como apelidos ou um telefone que não está no cadastro');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Exportar dados' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.rpc).toHaveBeenCalledWith('export_contact_data', { p_contact_id: CONTACT.id });
    const [filename, bytes, type] = mocks.download.mock.calls[0] as [string, Uint8Array, string];
    expect(filename).toMatch(/^dados-contato-1a2b3c4d/);
    expect(filename).toBe(exportFileName('dados-contato-1a2b3c4d', 'zip', filename.match(/\d{4}-\d{2}-\d{2}/)![0]));
    expect(filename).not.toMatch(/ana|souza/i);
    expect(type).toBe('application/zip');
    expect(readZip(bytes).map((entry) => entry.name)).toEqual([
      'LEIA-ME.txt',
      'dados.json',
      'contato.csv',
      'atividades.csv',
      'oportunidades.csv',
      'recebimentos.csv',
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith('Dados exportados. Revise o arquivo antes de enviar.');
    // O último registro da ficha e "Segurança" recarregam; o snapshot, não.
    expect(reloads(['crm', 'org-1', 'privacy-actions', CONTACT.id])).toBe(true);
    expect(reloads(['crm', 'org-1', 'snapshot'])).toBe(false);
  });

  it('a recusa do banco aparece no diálogo, ligada ao botão, sem download', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Somente donos e administradores exportam os dados de um contato.' },
    });
    const { onOpenChange } = mount('export');
    fireEvent.click(screen.getByRole('button', { name: 'Exportar dados' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Somente donos e administradores exportam os dados de um contato.');
    expect(screen.getByRole('button', { name: 'Exportar dados' })).toHaveAccessibleDescription(
      'Somente donos e administradores exportam os dados de um contato.',
    );
    expect(mocks.download).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('num banco sem a migração, explica o que falta', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.export_contact_data(p_contact_id)' },
    });
    mount('export');
    fireEvent.click(screen.getByRole('button', { name: 'Exportar dados' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Este CRM ainda não tem a atualização de privacidade (LGPD).',
    );
  });
});

describe('Anonimizar contato (item 1.10)', () => {
  const word = () => screen.getByLabelText('Digite ANONIMIZAR para confirmar');
  const confirm = () => screen.getByRole('button', { name: 'Anonimizar contato' });

  it('mostra o resumo com as contagens, e o botão só se habilita com o resumo e a palavra', async () => {
    let resolve!: (value: unknown) => void;
    mocks.rpc.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    mount('anonymize');
    const dialog = screen.getByRole('dialog', { name: 'Anonimizar este contato?' });
    // A descrição não promete apagar "de todo o CRM": apelidos e o primeiro nome nos outros registros ficam.
    expect(dialog).toHaveAccessibleDescription(
      'Os dados pessoais de Ana Souza saem do cadastro e dos registros ligados à pessoa; o histórico comercial fica sem nomes.',
    );
    expect(within(dialog).getByRole('status')).toHaveTextContent('Conferindo o que será apagado…');
    fireEvent.change(word(), { target: { value: 'ANONIMIZAR' } });
    expect(confirm()).toBeDisabled();
    resolve({ data: SUMMARY, error: null });
    const removed = await within(dialog).findByRole('list', { name: 'O que sai' });
    expect(
      within(removed)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Nome, e-mail, telefone, cargo, observações, o vínculo com a empresa (a empresa continua cadastrada), o motivo do “Não contatar” e o registro da base legal; da origem, saem o nome, o e-mail e o telefone.',
      '3 atividades com a pessoa ficam sem título e sem anotações.',
      '1 ação pendente com a pessoa será excluída, inclusive as das oportunidades; combine de novo a próxima ação dessas oportunidades.',
      '2 oportunidades e 1 recebimento deixam de apontar para a pessoa, e o nome, o e-mail e o telefone dela saem dos títulos.',
      '4 outros registros citam o nome completo, o e-mail ou o telefone e também serão ajustados.',
    ]);
    expect(dialog).toHaveTextContent('Valores, situações, etapas, datas e responsáveis ficam');
    expect(dialog).toHaveTextContent('1 oportunidade continua em aberto, sem o contato.');
    expect(dialog).toHaveTextContent('1 recebimento pendente continua no Financeiro, sem o contato.');
    expect(dialog).toHaveTextContent(
      'Apelidos, CPF, um telefone que não está no cadastro e outros dados digitados nos títulos não são reconhecidos',
    );
    expect(dialog).toHaveTextContent('Esta ação não pode ser desfeita.');
    expect(confirm()).toBeEnabled();
    for (const typed of ['', 'ANONIMIZA', 'anonimizar contato']) {
      fireEvent.change(word(), { target: { value: typed } });
      expect(confirm(), typed).toBeDisabled();
    }
    fireEvent.change(word(), { target: { value: '  anonimizar ' } });
    expect(confirm()).toBeEnabled();
  });

  it('anonimiza com a versão do resumo, recarrega as tabelas e fecha', async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'contact_privacy_summary' ? { data: SUMMARY, error: null } : { data: SUMMARY, error: null },
    );
    const { onOpenChange, reloads } = mount('anonymize');
    await screen.findByRole('list', { name: 'O que sai' });
    fireEvent.change(word(), { target: { value: 'ANONIMIZAR' } });
    fireEvent.click(confirm());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.rpc).toHaveBeenCalledWith('anonymize_contact', {
      p_contact_id: CONTACT.id,
      p_version: SUMMARY.version,
    });
    expect(mocks.toast.success).toHaveBeenCalledWith('Contato anonimizado', {
      description:
        '10 registros ajustados e 1 ação pendente excluída. O histórico comercial ficou sem nomes e anotações.',
    });
    for (const name of ['snapshot', 'deals', 'payments', 'privacy-actions', 'deal-actions'])
      expect(reloads(['crm', 'org-1', name]), name).toBe(true);
    expect(reloads(['crm', 'org-1', 'permissions'])).toBe(false);
  });

  it('o contato mudou desde o resumo: a mensagem, o resumo recarregado e a palavra limpa', async () => {
    const summaries = [SUMMARY, { ...SUMMARY, version: '2026-10-13T12:05:00.000001+00:00', activities_scrubbed: 4 }];
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'contact_privacy_summary' ? { data: summaries.shift(), error: null } : { data: null, error: CHANGED },
    );
    mount('anonymize');
    await screen.findByText('3 atividades com a pessoa ficam sem título e sem anotações.');
    fireEvent.change(word(), { target: { value: 'ANONIMIZAR' } });
    fireEvent.click(confirm());
    expect(await screen.findByRole('alert')).toHaveTextContent('Este contato mudou desde o resumo.');
    await screen.findByText('4 atividades com a pessoa ficam sem título e sem anotações.');
    expect(word()).toHaveValue('');
    expect(confirm()).toBeDisabled();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'contact_privacy_summary')).toHaveLength(2);
  });

  it('a falha do resumo mostra a mensagem e "Conferir de novo"', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'P0001', message: 'Somente donos e administradores anonimizam contatos.' },
      })
      .mockResolvedValueOnce({ data: SUMMARY, error: null });
    mount('anonymize');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Somente donos e administradores anonimizam contatos.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Conferir de novo' }));
    expect(await screen.findByRole('list', { name: 'O que sai' })).toBeInTheDocument();
  });

  it('sem nada ligado à pessoa, o resumo tem só o cadastro e nenhum aviso de oportunidade em aberto', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ...SUMMARY,
        activities_scrubbed: 0,
        activities_deleted: 0,
        deals: 0,
        open_deals: 0,
        payments: 0,
        pending_payments: 0,
        other_records: 0,
      },
      error: null,
    });
    mount('anonymize');
    const removed = await screen.findByRole('list', { name: 'O que sai' });
    expect(within(removed).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText(/continua em aberto/)).not.toBeInTheDocument();
  });
});
