import { QueryClient, QueryClientProvider, type Query } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  canWrite: true,
  insert: vi.fn(),
  update: vi.fn(),
  from: vi.fn(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  organizationPrivacy: {
    data: { available: true, defaultLegalBasis: 'not_informed', defaultLegalBasisAt: null, defaultLegalBasisBy: null },
  } as {
    data?: { available: boolean; defaultLegalBasis: string; defaultLegalBasisAt: null; defaultLegalBasisBy: null };
  },
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'organization-1' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => ({ canWrite: mocks.canWrite }) }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: mocks.from } }));
// O padrão da base legal da empresa (item 1.10), lido por useOrganizationPrivacy.
vi.mock('@/components/privacy/data', () => ({ useOrganizationPrivacy: () => mocks.organizationPrivacy }));
import { RecordEditor } from './RecordEditor';
import type { Company, Contact, DirectoryKind, RelationshipData } from '@/lib/contact-model';
const data: RelationshipData = {
  contacts: [],
  companies: [],
  deals: [],
  activities: [],
  members: [{ id: 'user-1', name: 'Pessoa', email: 'pessoa@example.com' }],
};
function contact(fields: Partial<Contact> = {}): Contact {
  return {
    id: 'contact-1',
    org_id: 'organization-1',
    first_name: 'Antigo',
    last_name: null,
    phone: null,
    email: null,
    owner_id: null,
    company_id: null,
    status: 'lead',
    updated_at: '2026-10-11T12:00:00.123456+00:00',
    ...fields,
  } as Contact;
}
function company(fields: Partial<Company> = {}): Company {
  return {
    id: 'company-1',
    org_id: 'organization-1',
    name: 'Empresa Antiga',
    industry: null,
    website: null,
    phone: null,
    owner_id: null,
    updated_at: '2026-10-11T12:00:00.123456+00:00',
    ...fields,
  } as Company;
}
function mount(record?: Contact | Company, kind: DirectoryKind = 'contacts') {
  const onSaved = vi.fn(),
    onClose = vi.fn();
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(cache, 'invalidateQueries');
  const view = (current?: Contact | Company) => (
    <QueryClientProvider client={cache}>
      <RecordEditor kind={kind} data={data} record={current} onSaved={onSaved} onClose={onClose} />
    </QueryClientProvider>
  );
  const { rerender } = render(view(record));
  return { onSaved, onClose, invalidate, rerender: (current?: Contact | Company) => rerender(view(current)) };
}
/** Models a conditional UPDATE: the row only changes when every filter matches, as in PostgreSQL. */
function storedRow(row: Record<string, unknown>) {
  const state = { row: { ...row } };
  let patch: Record<string, unknown> = {};
  const filters: [string, unknown][] = [];
  mocks.update.mockImplementation((fields: Record<string, unknown>) => {
    patch = fields;
    filters.length = 0;
    return chain();
  });
  mocks.eq.mockImplementation((column: string, value: unknown) => {
    filters.push([column, value]);
    return chain();
  });
  mocks.maybeSingle.mockImplementation(async () => {
    if (!filters.every(([column, value]) => state.row[column] === value)) return { data: null, error: null };
    Object.assign(state.row, patch, { updated_at: '2026-10-11T12:05:00.000001+00:00' });
    return { data: { id: state.row.id }, error: null };
  });
  return state;
}
function chain() {
  return {
    insert: mocks.insert,
    update: mocks.update,
    eq: mocks.eq,
    select: mocks.select,
    single: mocks.single,
    maybeSingle: mocks.maybeSingle,
  };
}
describe('salvamento de cadastro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canWrite = true;
    mocks.from.mockImplementation(chain);
    mocks.insert.mockImplementation(chain);
    mocks.update.mockImplementation(chain);
    mocks.eq.mockImplementation(chain);
    mocks.select.mockImplementation(chain);
    mocks.single.mockResolvedValue({ data: null, error: { code: 'network' } });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: 'network' } });
  });
  afterEach(cleanup);
  it('falha comunicada preserva preenchimento e não fecha o formulário', async () => {
    const callbacks = mount();
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Mariana' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'mariana@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Seu preenchimento foi preservado');
    expect(screen.getByLabelText('Nome *')).toHaveValue('Mariana');
    expect(screen.getByLabelText('E-mail')).toHaveValue('mariana@example.com');
    expect(callbacks.onSaved).not.toHaveBeenCalled();
    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: 'organization-1', first_name: 'Mariana', owner_id: 'user-1' }),
    );
  });
  it('edição restringe a gravação por organização, ID e versão lida e só fecha após confirmação', async () => {
    const original = contact();
    const state = storedRow(original);
    const callbacks = mount(original);
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Atualizado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledWith('contact-1'));
    expect(mocks.from).toHaveBeenCalledWith('contacts');
    expect(mocks.eq).toHaveBeenCalledWith('org_id', 'organization-1');
    expect(mocks.eq).toHaveBeenCalledWith('id', 'contact-1');
    expect(mocks.eq).toHaveBeenCalledWith('updated_at', '2026-10-11T12:00:00.123456+00:00');
    expect(mocks.single).not.toHaveBeenCalled();
    expect(state.row.first_name).toBe('Atualizado');
  });
  it('edição concorrente de contato mostra o conflito em vez de sobrescrever a versão do colega', async () => {
    const original = contact();
    const state = storedRow(original);
    // Um colega salvou depois que o formulário foi aberto.
    Object.assign(state.row, { first_name: 'Versão do colega', updated_at: '2026-10-11T12:03:00.000001+00:00' });
    const callbacks = mount(original);
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Minha versão' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Este contato mudou ou não está mais disponível');
    expect(alert).toHaveTextContent('Seu preenchimento foi preservado');
    expect(state.row.first_name).toBe('Versão do colega');
    expect(screen.getByLabelText('Nome *')).toHaveValue('Minha versão');
    expect(callbacks.onSaved).not.toHaveBeenCalled();
    expect(callbacks.onClose).not.toHaveBeenCalled();
    // Recarrega o snapshot (invalidação por chave) para a próxima abertura mostrar a versão atual; o papel da pessoa fica.
    const reloads = (queryKey: unknown[]) =>
      callbacks.invalidate.mock.calls.some(([filters]) => filters?.predicate?.({ queryKey } as unknown as Query));
    expect(reloads(['crm', 'org', 'snapshot', 'user'])).toBe(true);
    expect(reloads(['crm', 'org', 'permissions', 'user'])).toBe(false);
    expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled();
  });
  it('edição concorrente de empresa mostra o conflito em vez de sobrescrever a versão do colega', async () => {
    const original = company();
    const state = storedRow(original);
    Object.assign(state.row, { name: 'Empresa do colega', updated_at: '2026-10-11T12:03:00.000001+00:00' });
    const callbacks = mount(original, 'companies');
    fireEvent.change(screen.getByLabelText('Nome da empresa *'), { target: { value: 'Minha empresa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta empresa mudou ou não está mais disponível');
    expect(mocks.from).toHaveBeenCalledWith('companies');
    expect(state.row.name).toBe('Empresa do colega');
    expect(screen.getByLabelText('Nome da empresa *')).toHaveValue('Minha empresa');
    expect(callbacks.onSaved).not.toHaveBeenCalled();
  });
  it('cadastro excluído por outra pessoa durante a edição também é tratado como conflito', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const callbacks = mount(contact());
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Este contato mudou ou não está mais disponível');
    expect(callbacks.onSaved).not.toHaveBeenCalled();
  });
  it('recarregamento em segundo plano não troca a versão que o formulário edita', async () => {
    const original = contact();
    const state = storedRow(original);
    const callbacks = mount(original);
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Minha versão' } });
    // O colega salva e a lista recarrega (por exemplo, ao voltar para a aba) com o formulário aberto.
    const colleague = contact({ first_name: 'Versão do colega', updated_at: '2026-10-11T12:03:00.000001+00:00' });
    Object.assign(state.row, colleague);
    callbacks.rerender(colleague);
    expect(screen.getByLabelText('Nome *')).toHaveValue('Minha versão');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Este contato mudou');
    expect(mocks.eq).toHaveBeenCalledWith('updated_at', '2026-10-11T12:00:00.123456+00:00');
    expect(state.row.first_name).toBe('Versão do colega');
  });
  it('o seletor de responsável não oferece desativados e mostra marcado o atual desativado (item 1.2)', () => {
    data.members.push(
      { id: 'user-2', name: 'Bruno', email: 'bruno@example.com', active: false },
      { id: 'user-3', name: 'Ana', email: 'ana@example.com', active: true },
    );
    try {
      mount(contact({ owner_id: 'user-2' }));
      const trigger = screen.getByLabelText('Responsável');
      expect(trigger).toHaveTextContent('Bruno (desativado)');
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Sem responsável',
        'Ana',
        'Pessoa',
        'Bruno (desativado)',
      ]);
      cleanup();
      mount();
      fireEvent.keyDown(screen.getByLabelText('Responsável'), { key: 'ArrowDown' });
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Sem responsável',
        'Ana',
        'Pessoa',
      ]);
    } finally {
      data.members.splice(1);
    }
  });
  // Item 1.9: o cadastro manual grava o E.164, como a importação, e mostra como o número será salvo.
  it.each(['11 99999-0000', '(11) 99999-0000', '011 99999 0000', '+55 11 99999-0000'])(
    'grava %j como +5511999990000, com a prévia de celular',
    async (typed) => {
      const callbacks = mount();
      fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Mariana' } });
      fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: typed } });
      expect(screen.getByLabelText('Telefone')).toHaveAccessibleDescription(
        'Será salvo como (11) 99999-0000, celular.',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
      await waitFor(() =>
        expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ phone: '+5511999990000' })),
      );
      expect(callbacks.onClose).not.toHaveBeenCalled();
    },
  );
  it('abre o E.164 gravado no formato brasileiro e dá a dica do fixo, de outro país e do não reconhecido', async () => {
    const original = contact({ phone: '+5511999990000' });
    const state = storedRow(original);
    const callbacks = mount(original);
    const field = screen.getByLabelText('Telefone');
    expect(field).toHaveValue('(11) 99999-0000');
    fireEvent.change(field, { target: { value: '(11) 3000-0000' } });
    expect(field).toHaveAccessibleDescription(
      'Será salvo como (11) 3000-0000, fixo. O WhatsApp abre com um aviso, porque só funciona se o número usar o WhatsApp Business.',
    );
    fireEvent.change(field, { target: { value: '+1 415 555 0100' } });
    expect(field).toHaveAccessibleDescription(
      'Número de outro país: será salvo como digitado, com o “+” e o código do país.',
    );
    fireEvent.change(field, { target: { value: ' 99999-0000 ' } });
    expect(field).toHaveAccessibleDescription(
      'Número não reconhecido: confira o DDD. Ele será salvo como digitado, e o WhatsApp e a ligação ficam desabilitados até você corrigir o número.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledWith('contact-1'));
    // O não reconhecido fica como digitado (aparado).
    expect(state.row.phone).toBe('99999-0000');
  });
  it('um telefone gravado fora do padrão abre como foi gravado, e o campo vazio grava nulo', async () => {
    const original = company({ phone: 'ramal 22' });
    const state = storedRow(original);
    const callbacks = mount(original, 'companies');
    expect(screen.getByLabelText('Telefone')).toHaveValue('ramal 22');
    fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledWith('company-1'));
    expect(state.row.phone).toBeNull();
  });
  // Revisão do item 1.11: cargo, origem e observações chegam pela importação e se corrigem no cadastro (o pedido de
  // correção do titular, na LGPD), com os limites da importação.
  it('cargo, origem e observações abrem com o gravado, se corrigem e, vazios, gravam nulo', async () => {
    const original = contact({ job_title: 'Gerente', source: 'Feira', notes: 'Linha 1\nLinha 2' });
    const state = storedRow(original);
    const callbacks = mount(original);
    expect(screen.getByLabelText('Cargo')).toHaveValue('Gerente');
    expect(screen.getByLabelText('Cargo')).toHaveAttribute('maxLength', '150');
    expect(screen.getByLabelText('Origem')).toHaveAttribute('maxLength', '100');
    expect(screen.getByLabelText('Observações')).toHaveValue('Linha 1\nLinha 2');
    expect(screen.getByLabelText('Observações')).toHaveAttribute('maxLength', '2000');
    fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: '  Diretora  ' } });
    fireEvent.change(screen.getByLabelText('Origem'), { target: { value: ' ' } });
    fireEvent.change(screen.getByLabelText('Observações'), {
      target: { value: 'Sem dado sensível\nRetornar em março ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledWith('contact-1'));
    expect(state.row).toMatchObject({
      job_title: 'Diretora',
      source: null,
      notes: 'Sem dado sensível\nRetornar em março',
    });
  });
  it('a empresa não tem cargo, origem nem observações', () => {
    mount(company(), 'companies');
    expect(screen.queryByLabelText('Cargo')).toBeNull();
    expect(screen.queryByLabelText('Origem')).toBeNull();
    expect(screen.queryByLabelText('Observações')).toBeNull();
  });
  // Item 1.10: a base legal no cadastro do contato, preenchida pelo banco quando ninguém escolhe outra.
  describe('base legal', () => {
    const basis = () => screen.getByLabelText('Base legal');
    const options = () => {
      fireEvent.keyDown(basis(), { key: 'ArrowDown' });
      return screen.getAllByRole('option').map((option) => option.textContent);
    };
    const choose = (label: string) => {
      fireEvent.keyDown(basis(), { key: 'ArrowDown' });
      fireEvent.click(screen.getByRole('option', { name: label }));
    };
    beforeEach(() => {
      Element.prototype.scrollIntoView = vi.fn();
      mocks.organizationPrivacy = {
        data: {
          available: true,
          defaultLegalBasis: 'legitimate_interest',
          defaultLegalBasisAt: null,
          defaultLegalBasisBy: null,
        },
      };
      mocks.single.mockResolvedValue({ data: { id: 'contact-new' }, error: null });
    });

    it('na criação, a primeira opção é o padrão da empresa, e nada da base vai no pedido se ela ficar', async () => {
      const callbacks = mount();
      expect(basis()).toHaveTextContent('Padrão da empresa: Legítimo interesse');
      expect(options()).toEqual([
        'Padrão da empresa: Legítimo interesse',
        'Consentimento',
        'Contrato ou pedido da pessoa',
        'Legítimo interesse',
        'Obrigação legal',
        'Exercício de direitos',
      ]);
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
      expect(screen.getByLabelText('Registro da base legal (opcional)')).toHaveAccessibleDescription(
        'Ex.: marcou a caixa do formulário do site em 10/10/2026. Não escreva dados sensíveis, como saúde ou religião.',
      );
      expect(screen.getByLabelText('Registro da base legal (opcional)')).not.toHaveAttribute('aria-required');
      fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Mariana' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledWith('contact-new'));
      const payload = mocks.insert.mock.calls[0][0];
      for (const key of ['legal_basis', 'legal_basis_note', 'legal_basis_at', 'legal_basis_by'])
        expect(payload).not.toHaveProperty(key);
    });

    it('sem a leitura do padrão, a opção diz só "Padrão da empresa"', () => {
      mocks.organizationPrivacy = {};
      mount();
      expect(basis()).toHaveTextContent('Padrão da empresa');
    });

    it('consentimento exige o registro antes do pedido, ligado ao campo; com ele, vai aparado, sem data nem autor', async () => {
      const callbacks = mount();
      fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Mariana' } });
      choose('Consentimento');
      const note = screen.getByLabelText('Como a pessoa consentiu *');
      // O leitor de tela anuncia o registro como obrigatório, como "Nome *".
      expect(note).toHaveAttribute('aria-required', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Descreva como a pessoa consentiu.');
      expect(note).toHaveAttribute('aria-invalid', 'true');
      expect(note).toHaveAccessibleDescription(/^Descreva como a pessoa consentiu\./);
      expect(mocks.insert).not.toHaveBeenCalled();
      fireEvent.change(note, { target: { value: '  Marcou a caixa do site em 10/10/2026.  ' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalled());
      expect(mocks.insert).toHaveBeenCalledWith(
        expect.objectContaining({ legal_basis: 'consent', legal_basis_note: 'Marcou a caixa do site em 10/10/2026.' }),
      );
      expect(mocks.insert.mock.calls[0][0]).not.toHaveProperty('legal_basis_at');
    });

    it('na edição, mostra a base gravada e o carimbo, e só manda o que mudou', async () => {
      const original = contact({
        legal_basis: 'contract',
        legal_basis_note: 'Pediu orçamento pelo site.',
        legal_basis_at: '2026-10-12T15:00:00Z',
        legal_basis_by: 'user-1',
      });
      const state = storedRow(original);
      const callbacks = mount(original);
      expect(basis()).toHaveTextContent('Contrato ou pedido da pessoa');
      expect(options()).toHaveLength(6);
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
      expect(screen.getByLabelText('Registro da base legal (opcional)')).toHaveValue('Pediu orçamento pelo site.');
      expect(screen.getByText(/^Registrada por Pessoa em \d{2}\/\d{2}\/2026\.$/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Atualizado' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalled());
      expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('legal_basis');
      expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('legal_basis_note');
      expect(state.row.first_name).toBe('Atualizado');
    });

    it('trocar a base na edição manda só a base', async () => {
      const original = contact({ legal_basis: 'not_informed', legal_basis_note: null, legal_basis_at: null });
      storedRow(original);
      const callbacks = mount(original);
      expect(screen.queryByText(/^Registrada/)).not.toBeInTheDocument();
      choose('Legítimo interesse');
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalled());
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ legal_basis: 'legitimate_interest' }));
      expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('legal_basis_note');
    });

    it('o consentimento recusado pelo banco (23514) ganha a mensagem do campo', async () => {
      mocks.single.mockResolvedValue({
        data: null,
        error: { code: '23514', message: 'violates check constraint "contacts_legal_basis_consent_note"' },
      });
      mount();
      fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Mariana' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Descreva como a pessoa consentiu.');
    });

    it('num banco sem a migração, o grupo não aparece e criar e editar continuam como antes', async () => {
      mocks.organizationPrivacy = {
        data: {
          available: false,
          defaultLegalBasis: 'not_informed',
          defaultLegalBasisAt: null,
          defaultLegalBasisBy: null,
        },
      };
      mount();
      expect(screen.queryByLabelText('Base legal')).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Privacidade' })).not.toBeInTheDocument();
      cleanup();
      // O contato lido sem a coluna (select * num banco antigo).
      const legacy = contact();
      storedRow(legacy);
      const callbacks = mount(legacy);
      expect(screen.queryByLabelText('Base legal')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
      await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalled());
      expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('legal_basis');
    });

    it('a base escolhida num banco sem a migração explica o que falta', async () => {
      mocks.single.mockResolvedValue({
        data: null,
        error: {
          code: 'PGRST204',
          message: "Could not find the 'legal_basis' column of 'contacts' in the schema cache",
        },
      });
      mount();
      fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Mariana' } });
      choose('Contrato ou pedido da pessoa');
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Este CRM ainda não tem a atualização de privacidade (LGPD).',
      );
    });

    it('a empresa não tem base legal', () => {
      mount(company(), 'companies');
      expect(screen.queryByLabelText('Base legal')).not.toBeInTheDocument();
    });
  });
  it('papel de consulta não dispara gravação', () => {
    mocks.canWrite = false;
    mount();
    expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeDisabled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
