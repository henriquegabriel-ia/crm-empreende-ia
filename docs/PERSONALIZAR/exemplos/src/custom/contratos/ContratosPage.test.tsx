// Exemplo de docs/PERSONALIZAR/TELA.md: o teste da tela nova, com o cliente simulado (vi.mock), como os testes da base.
// Roda no npm test do repositório da base (vitest.config.ts inclui docs/PERSONALIZAR/exemplos) e no do aluno.
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { faqWritingProblems } from '@/components/help/faq-rules';

const mocks = vi.hoisted(() => ({
  canWrite: true,
  loadContratos: vi.fn(),
  loadOportunidades: vi.fn(),
  createContrato: vi.fn(),
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({
  useCrmPermissions: () => ({ canWrite: mocks.canWrite, canManage: false, loading: false }),
}));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: {} }));
vi.mock('./data', () => ({
  loadContratos: mocks.loadContratos,
  loadOportunidades: mocks.loadOportunidades,
  createContrato: mocks.createContrato,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/shell/PageScaffold', () => ({
  PageScaffold: ({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {actions}
      {children}
    </main>
  ),
}));

import ContratosPage from './ContratosPage';
import { CONTRATOS_HELP } from './help';

const CONTRATO = {
  id: 'contrato-1',
  org_id: 'org-1',
  deal_id: 'deal-1',
  numero: 'C-2026-014',
  assinado_em: '2026-11-01',
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
};

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ContratosPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.canWrite = true;
  mocks.loadContratos.mockReset().mockResolvedValue([CONTRATO]);
  mocks.loadOportunidades.mockReset().mockResolvedValue([{ id: 'deal-1', title: 'Implantação Acme' }]);
  mocks.createContrato.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Contratos (exemplo de docs/PERSONALIZAR)', () => {
  it('lista o número, a oportunidade e a data de assinatura', async () => {
    setup();
    expect(await screen.findByText('C-2026-014')).toBeInTheDocument();
    expect(await screen.findByText('Implantação Acme')).toBeInTheDocument();
    expect(screen.getByText('01/11/2026')).toBeInTheDocument();
    expect(mocks.loadContratos).toHaveBeenCalledWith('org-1');
  });

  it('sem contratos, o estado vazio diz o que fazer', async () => {
    mocks.loadContratos.mockResolvedValue([]);
    setup();
    expect(await screen.findByText('Nenhum contrato registrado')).toBeInTheDocument();
    expect(screen.getByText(/use “Novo contrato” para registrar/)).toBeInTheDocument();
  });

  it('registra um contrato e grava o que a pessoa preencheu', async () => {
    setup();
    await screen.findByText('C-2026-014');
    fireEvent.click(screen.getByRole('button', { name: /Novo contrato/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo contrato' });
    fireEvent.change(within(dialog).getByLabelText('Oportunidade *'), { target: { value: 'deal-1' } });
    fireEvent.change(within(dialog).getByLabelText('Número *'), { target: { value: ' C-2026-015 ' } });
    fireEvent.change(within(dialog).getByLabelText('Assinado em'), { target: { value: '2026-11-02' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar contrato' }));
    await vi.waitFor(() =>
      expect(mocks.createContrato).toHaveBeenCalledWith('org-1', {
        deal_id: 'deal-1',
        numero: 'C-2026-015',
        assinado_em: '2026-11-02',
      }),
    );
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('sem oportunidade ou número, não grava e diz o que falta', async () => {
    setup();
    await screen.findByText('C-2026-014');
    fireEvent.click(screen.getByRole('button', { name: /Novo contrato/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo contrato' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar contrato' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Escolha a oportunidade e informe o número do contrato.',
    );
    expect(mocks.createContrato).not.toHaveBeenCalled();
  });

  it('sem nenhuma oportunidade, o diálogo diz para criar uma antes e não deixa salvar', async () => {
    mocks.loadOportunidades.mockResolvedValue([]);
    setup();
    await screen.findByText('C-2026-014');
    fireEvent.click(screen.getByRole('button', { name: /Novo contrato/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo contrato' });
    expect(
      await within(dialog).findByText('Crie uma oportunidade no “Pipeline” antes de registrar o contrato.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Oportunidade *')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Salvar contrato' })).toBeDisabled();
  });

  it('com as oportunidades carregando, o seletor espera; com falha, “Tentar novamente” busca de novo', async () => {
    mocks.loadOportunidades.mockReturnValue(new Promise(() => undefined));
    setup();
    await screen.findByText('C-2026-014');
    fireEvent.click(screen.getByRole('button', { name: /Novo contrato/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo contrato' });
    expect(within(dialog).getByRole('option', { name: 'Carregando oportunidades…' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Oportunidade *')).toBeDisabled();
    cleanup();
    mocks.loadOportunidades.mockReset().mockRejectedValue(new Error('falhou'));
    setup();
    await screen.findByText('C-2026-014');
    fireEvent.click(screen.getByRole('button', { name: /Novo contrato/ }));
    const failed = await screen.findByRole('dialog', { name: 'Novo contrato' });
    expect(
      await within(failed).findByText('Não foi possível carregar as oportunidades. Use “Tentar novamente”.'),
    ).toBeInTheDocument();
    expect(within(failed).getByLabelText('Oportunidade *')).toBeDisabled();
    expect(within(failed).getByRole('button', { name: 'Salvar contrato' })).toBeDisabled();
    // A recuperação é no próprio diálogo: a nova busca dá certo e o seletor volta a funcionar, sem fechar nada.
    mocks.loadOportunidades.mockResolvedValue([{ id: 'deal-1', title: 'Implantação Acme' }]);
    fireEvent.click(within(failed).getByRole('button', { name: 'Tentar novamente' }));
    expect(await within(failed).findByRole('option', { name: 'Implantação Acme' })).toBeInTheDocument();
    expect(within(failed).getByLabelText('Oportunidade *')).toBeEnabled();
    expect(within(failed).queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
    expect(mocks.loadOportunidades).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'a mensagem de um gancho (P0001) como está',
      { code: 'P0001', message: 'Contrato só para oportunidade ganha.' },
      'Contrato só para oportunidade ganha.',
    ],
    [
      'a falta de permissão (42501) com a mensagem de papel',
      { code: '42501', message: 'permission denied for table custom_contratos' },
      'Seu papel não permite esta ação.',
    ],
  ])('mostra a recusa do banco: %s, e o preenchimento fica', async (_, error, shown) => {
    mocks.createContrato.mockRejectedValue(error);
    setup();
    await screen.findByText('C-2026-014');
    fireEvent.click(screen.getByRole('button', { name: /Novo contrato/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo contrato' });
    fireEvent.change(within(dialog).getByLabelText('Oportunidade *'), { target: { value: 'deal-1' } });
    fireEvent.change(within(dialog).getByLabelText('Número *'), { target: { value: 'C-9' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar contrato' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(shown);
    expect(within(dialog).getByLabelText('Número *')).toHaveValue('C-9');
  });

  it('para “Somente leitura”, só a lista, sem “Novo contrato”', async () => {
    mocks.canWrite = false;
    setup();
    expect(await screen.findByText('C-2026-014')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Novo contrato/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Donos, administradores e colaboradores registram contratos/)).toBeInTheDocument();
  });

  it('a pergunta da Central segue as regras de escrita da Ajuda e cita os nomes da tela', () => {
    expect(faqWritingProblems(CONTRATOS_HELP)).toEqual([]);
    expect(CONTRATOS_HELP.a).toContain('“Novo contrato”');
    expect(CONTRATOS_HELP.a).toContain('Donos, administradores e colaboradores');
  });
});
