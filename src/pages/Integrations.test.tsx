import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactImportContext } from '@/lib/contact-import';

// Revisão do item 1.11, achados 3 e 17: os estados da leitura do arquivo, a falha ao conferir o banco e a instrução do
// Excel ligada ao campo do arquivo (docs/arquitetura/1.11.md, seção 6.1).
const mocks = vi.hoisted(() => ({ loadContext: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'me', org_id: 'org-1', name: 'Pessoa de Teste', email: 'owner@example.test' } }),
}));
vi.mock('@/hooks/useCrmPermissions', () => ({
  useCrmPermissions: () => ({ canWrite: true, canManage: true, loading: false }),
}));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: {} }));
vi.mock('@/components/contact-import/data', () => ({ loadImportContext: mocks.loadContext }));
vi.mock('@/components/contact-import/ContactImportDialog', () => ({
  ContactImportDialog: () => <div role="dialog" aria-label="Revisar importação" />,
}));
vi.mock('@/components/shell/PageScaffold', () => ({
  PageScaffold: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

import Integrations from './Integrations';

const CONTEXT: ContactImportContext = {
  orgId: 'org-1',
  existingContacts: [],
  companies: [],
  members: [{ id: 'me', name: 'Pessoa de Teste', email: 'owner@example.test', active: true }],
  columns: { doNotContact: true, legalBasis: true },
};
const LABEL = 'Importar arquivo CSV (até 5.000 contatos)';

function setup() {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Integrations />
    </MemoryRouter>,
  );
  return screen.getByLabelText(LABEL) as HTMLInputElement;
}
function choose(input: HTMLInputElement, text = 'nome;email\nAna;ana@example.test') {
  const file = new File([text], 'contatos.csv', { type: 'text/csv' });
  // O JSDOM não lê arquivos: o conteúdo vem do arrayBuffer.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  mocks.loadContext.mockReset();
});
afterEach(cleanup);

describe('Integrações: leitura da planilha', () => {
  it('a instrução de como salvar em CSV fica ligada ao campo do arquivo, com o caminho do Microsoft 365', () => {
    const input = setup();
    const help = document.getElementById(input.getAttribute('aria-describedby')!);
    expect(help?.textContent).toContain('No Excel, use Arquivo > Salvar como');
    expect(help?.textContent).toContain('Arquivo > Salvar uma Cópia');
    expect(help?.textContent).toContain('“CSV UTF-8 (delimitado por vírgulas)”');
  });

  it('mostra "Conferindo contatos, empresas e equipe…" com o campo desabilitado, e depois abre a prévia', async () => {
    let release!: (context: ContactImportContext) => void;
    mocks.loadContext.mockReturnValue(new Promise<ContactImportContext>((resolve) => (release = resolve)));
    const input = setup();
    choose(input);
    // "Lendo a planilha…" aparece primeiro, enquanto o arquivo é lido; depois, a conferência do banco.
    expect(screen.getByRole('status').textContent).toBe('Lendo a planilha…');
    expect(input.disabled).toBe(true);
    expect(await screen.findByText('Conferindo contatos, empresas e equipe…')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Conferindo contatos, empresas e equipe…');
    expect(input.disabled).toBe(true);
    expect(mocks.loadContext).toHaveBeenCalledWith('org-1');
    await act(async () => release(CONTEXT));
    expect(await screen.findByRole('dialog', { name: 'Revisar importação' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(input.disabled).toBe(false);
  });

  it('a falha ao conferir o banco diz o que fazer, e o campo volta a aceitar o arquivo', async () => {
    mocks.loadContext.mockRejectedValue(new TypeError('Failed to fetch'));
    const input = setup();
    choose(input);
    expect(
      await screen.findByText(
        'Não foi possível conferir os contatos já cadastrados. Verifique a conexão e escolha o arquivo de novo.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a planilha do Excel é recusada antes de ler o banco, com o caminho para salvar em CSV', async () => {
    const input = setup();
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])], 'planilha.xlsx');
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).buffer,
    });
    fireEvent.change(input, { target: { files: [file] } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Arquivo > Salvar uma Cópia');
    expect(mocks.loadContext).not.toHaveBeenCalled();
  });
});
