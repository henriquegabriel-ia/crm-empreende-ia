import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'organization-1' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => ({ canWrite: mocks.canWrite }) }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: mocks.from } }));
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
    // Recarrega os dados para a próxima abertura mostrar a versão atual.
    expect(callbacks.invalidate).toHaveBeenCalledWith({ queryKey: ['crm'] });
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
  it('papel de consulta não dispara gravação', () => {
    mocks.canWrite = false;
    mount();
    expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeDisabled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
