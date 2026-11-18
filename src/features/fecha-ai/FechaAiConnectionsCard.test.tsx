import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  list: vi.fn(),
  actors: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  setActors: vi.fn(),
}));
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), fechaConnectionsApi: mock }));
import { FechaAiConnectionsCard } from './FechaAiConnectionsCard';
import { actors, connection, deferred, expiration, ids, scope } from './testFixtures';
import {
  FECHA_NOT_PUBLISHED,
  FECHA_NOT_REACHED,
  FechaAdminError,
  type FechaAdminContext,
  type FechaConnection,
} from './api';
const clipboard = vi.fn();
beforeEach(() => {
  localStorage.clear();
  clipboard.mockReset();
  clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.list.mockResolvedValue({ connections: [] });
  mock.actors.mockResolvedValue({ organizationId: ids.organization, actors });
  mock.create.mockResolvedValue({ connection: connection(), token: 'fecrm_fixture_secret' });
  mock.revoke.mockResolvedValue({ connection: connection({ revokedAt: new Date().toISOString() }) });
  mock.setActors.mockResolvedValue({ connection: connection({ allowedActorIds: [ids.actor, ids.secondActor] }) });
});
async function fillCreate() {
  await waitFor(() => expect(screen.getByLabelText('Nome da conexão')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Nome da conexão'), { target: { value: 'Equipe comercial' } });
  fireEvent.change(screen.getByLabelText('Identificador da equipe Fecha IA'), { target: { value: ids.source } });
  fireEvent.change(screen.getByLabelText(/Válida até/), { target: { value: expiration() } });
  fireEvent.click(screen.getByRole('checkbox', { name: actors[0].label }));
}
describe('Fecha IA administration card', () => {
  it('does not request credentials or connections for a non-admin', async () => {
    render(<FechaAiConnectionsCard {...scope} canManage={false} />);
    await act(async () => {});
    expect(mock.list).not.toHaveBeenCalled();
    expect(mock.actors).not.toHaveBeenCalled();
  });
  it('creates only after actor selection and explicit submit, then reveals a masked one-time credential', async () => {
    render(<FechaAiConnectionsCard {...scope} canManage />);
    await fillCreate();
    expect(mock.create).not.toHaveBeenCalled();
    expect(clipboard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar credencial para a Fecha IA' }));
    await screen.findByRole('heading', { name: 'Copie a conexão para a Fecha IA' });
    expect(screen.getByDisplayValue('fecrm_fixture_secret')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('heading', { name: 'Copie a conexão para a Fecha IA' })).toHaveFocus();
    expect(mock.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'Equipe comercial',
        sourceOrganizationId: ids.source,
        allowedActorIds: [ids.actor],
      }),
    );
    expect(clipboard).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar credencial' }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith('fecrm_fixture_secret'));
    fireEvent.click(screen.getByRole('button', { name: 'Já copiei; ocultar credencial' }));
    expect(screen.queryByDisplayValue('fecrm_fixture_secret')).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });
  // Revisão do A2-CRM: cada campo da conexão criada tem só o próprio rótulo; o botão de cópia fica fora dele e não entra
  // no nome que o leitor de tela anuncia.
  it('names the identifier and the credential fields by their own label, without the copy buttons', async () => {
    render(<FechaAiConnectionsCard {...scope} canManage />);
    await fillCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar credencial para a Fecha IA' }));
    await screen.findByRole('heading', { name: 'Copie a conexão para a Fecha IA' });
    const identifier = screen.getByRole('textbox', { name: 'Identificador da conexão criada' });
    expect(identifier).toHaveValue(ids.connection);
    expect(identifier).toHaveAccessibleName('Identificador da conexão criada');
    const credential = screen.getByLabelText('Credencial exibida uma única vez');
    expect(credential).toHaveValue('fecrm_fixture_secret');
    expect(credential).toHaveAccessibleName('Credencial exibida uma única vez');
    for (const name of ['Copiar identificador', 'Copiar credencial'])
      expect(screen.getByRole('button', { name }).closest('label')).toBeNull();
  });
  it('revokes only after confirmation in the localized dialog', async () => {
    mock.list.mockResolvedValue({ connections: [connection()] });
    render(<FechaAiConnectionsCard {...scope} canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar conexão' }));
    const dialog = screen.getByRole('dialog', { name: 'Revogar conexão da Fecha IA' });
    expect(mock.revoke).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar revogação' }));
    await screen.findByText('Revogada');
    expect(mock.revoke).toHaveBeenCalledWith(expect.anything(), ids.connection);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('changes authorized actors only on save and preserves the selection on a server error', async () => {
    mock.list.mockResolvedValue({ connections: [connection()] });
    mock.setActors.mockRejectedValueOnce(new Error('Falha ao salvar identidades.'));
    render(<FechaAiConnectionsCard {...scope} canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar identidades' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar identidades autorizadas' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: actors[1].label }));
    expect(mock.setActors).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar identidades autorizadas' }));
    await within(dialog).findByText('Falha ao salvar identidades.');
    expect(within(dialog).getByRole('checkbox', { name: actors[1].label })).toBeChecked();
    expect(mock.setActors).toHaveBeenCalledWith(expect.anything(), ids.connection, [ids.actor, ids.secondActor]);
  });
  it('returns keyboard focus to the action after Escape and to the section when revocation disables it', async () => {
    mock.list.mockResolvedValue({ connections: [connection()] });
    render(<FechaAiConnectionsCard {...scope} canManage />);
    const edit = await screen.findByRole('button', { name: 'Editar identidades' });
    fireEvent.click(edit);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(edit).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Revogar conexão' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar revogação' }));
    await screen.findByText('Revogada');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Fecha IA · revisões comerciais' })).toHaveFocus());
  });
  it('drops the credential and old requests when identity or permission changes', async () => {
    const pending = deferred<{ connection: FechaConnection; token: string }>();
    mock.create.mockReturnValue(pending.promise);
    const view = render(<FechaAiConnectionsCard {...scope} canManage />);
    await fillCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar credencial para a Fecha IA' }));
    const request = mock.create.mock.calls[0][0] as FechaAdminContext;
    view.rerender(<FechaAiConnectionsCard {...scope} userId={ids.actor} canManage />);
    expect(request.signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve({ connection: connection(), token: 'late-secret' });
    });
    expect(screen.queryByDisplayValue('late-secret')).not.toBeInTheDocument();
    view.rerender(<FechaAiConnectionsCard {...scope} canManage={false} />);
    expect(screen.queryByRole('button', { name: 'Gerar credencial para a Fecha IA' })).not.toBeInTheDocument();
  });
  it('does not automatically retry an uncertain credential creation', async () => {
    mock.create.mockRejectedValue(new Error('Não foi possível confirmar a criação.'));
    render(<FechaAiConnectionsCard {...scope} canManage />);
    await fillCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar credencial para a Fecha IA' }));
    await screen.findByText(/Atualize a lista para conferir se a conexão foi criada/);
    expect(screen.getByRole('button', { name: 'Gerar credencial para a Fecha IA' })).toBeDisabled();
    expect(mock.create).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar conexões' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gerar credencial para a Fecha IA' })).toBeEnabled());
    expect(mock.create).toHaveBeenCalledOnce();
  });
  // Roteiro 3.4: num CRM sem as funções do receptor (a empresa não usa a Fecha IA), o cartão avisa, sem alerta de erro
  // nem formulário, e “Atualizar conexões” tenta de novo.
  it('shows a notice without the form when the management function is not published, and retries on refresh', async () => {
    mock.list.mockRejectedValueOnce(new FechaAdminError(FECHA_NOT_PUBLISHED, true));
    mock.actors.mockRejectedValueOnce(new FechaAdminError(FECHA_NOT_PUBLISHED, true));
    render(<FechaAiConnectionsCard {...scope} canManage />);
    expect(await screen.findByText(FECHA_NOT_PUBLISHED)).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gerar credencial para a Fecha IA' })).not.toBeInTheDocument();
    expect(screen.queryByText('Conexões desta organização')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar conexões' }));
    expect(await screen.findByRole('button', { name: 'Gerar credencial para a Fecha IA' })).toBeInTheDocument();
    expect(screen.queryByText(FECHA_NOT_PUBLISHED)).not.toBeInTheDocument();
  });
  // Revisão do A2-CRM: no navegador, o preflight de uma função não publicada recebe o 404 do gateway sem CORS, e a
  // leitura falha como rede (FunctionsFetchError), como a de uma origem fora de CRM_ALLOWED_ORIGINS. O cartão mostra o
  // aviso neutro, sem alerta nem formulário, também quando “Atualizar conexões” falha do mesmo jeito.
  it('shows the neutral notice without the form when the first read cannot reach the function', async () => {
    const unreachable = () => new FechaAdminError('Não foi possível falar com a Fecha IA neste CRM.', false, true);
    mock.list.mockRejectedValueOnce(unreachable()).mockRejectedValueOnce(unreachable());
    mock.actors.mockRejectedValueOnce(unreachable()).mockRejectedValueOnce(unreachable());
    render(<FechaAiConnectionsCard {...scope} canManage />);
    expect(await screen.findByText(FECHA_NOT_REACHED)).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gerar credencial para a Fecha IA' })).not.toBeInTheDocument();
    expect(screen.queryByText('Conexões desta organização')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar conexões' }));
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar conexões' })).toBeEnabled());
    expect(screen.getByText(FECHA_NOT_REACHED)).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar conexões' }));
    expect(await screen.findByRole('button', { name: 'Gerar credencial para a Fecha IA' })).toBeInTheDocument();
    expect(screen.queryByText(FECHA_NOT_REACHED)).not.toBeInTheDocument();
  });
  it('keeps an unreachable function during an operation as an alert, with the form', async () => {
    mock.create.mockRejectedValueOnce(
      new FechaAdminError('Não foi possível falar com a Fecha IA neste CRM.', false, true),
    );
    render(<FechaAiConnectionsCard {...scope} canManage />);
    await fillCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar credencial para a Fecha IA' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível falar com a Fecha IA neste CRM.');
    expect(screen.queryByText(FECHA_NOT_REACHED)).not.toBeInTheDocument();
  });
});
