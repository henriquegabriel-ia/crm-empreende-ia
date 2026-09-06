import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ list: vi.fn(), actors: vi.fn(), create: vi.fn(), revoke: vi.fn(), setActors: vi.fn() }));
vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(), fechaConnectionsApi: mock }));
import { FechaAiConnectionsCard } from './FechaAiConnectionsCard';
import { actors, connection, deferred, expiration, ids, scope } from './testFixtures';
import type { FechaAdminContext, FechaConnection } from './api';
const clipboard = vi.fn();
beforeEach(() => { localStorage.clear(); clipboard.mockReset(); clipboard.mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } }); Object.values(mock).forEach((fn) => fn.mockReset()); mock.list.mockResolvedValue({ connections: [] }); mock.actors.mockResolvedValue({ organizationId: ids.organization, actors }); mock.create.mockResolvedValue({ connection: connection(), token: 'fecrm_fixture_secret' }); mock.revoke.mockResolvedValue({ connection: connection({ revokedAt: new Date().toISOString() }) }); mock.setActors.mockResolvedValue({ connection: connection({ allowedActorIds: [ids.actor, ids.secondActor] }) }); });
async function fillCreate() {
  await waitFor(() => expect(screen.getByLabelText('Nome da conexão')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Nome da conexão'), { target: { value: 'Equipe comercial' } });
  fireEvent.change(screen.getByLabelText('Identificador da equipe Fecha AI'), { target: { value: ids.source } });
  fireEvent.change(screen.getByLabelText(/Válida até/), { target: { value: expiration() } });
  fireEvent.click(screen.getByRole('checkbox', { name: actors[0].label }));
}
describe('Fecha AI administration card', () => {
  it('does not request credentials or connections for a non-admin', async () => {
    render(<FechaAiConnectionsCard {...scope} canManage={false} />); await act(async () => {});
    expect(mock.list).not.toHaveBeenCalled(); expect(mock.actors).not.toHaveBeenCalled();
  });
  it('creates only after actor selection and explicit submit, then reveals a masked one-time credential', async () => {
    render(<FechaAiConnectionsCard {...scope} canManage />); await fillCreate();
    expect(mock.create).not.toHaveBeenCalled(); expect(clipboard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar credencial para a Fecha AI' }));
    await screen.findByRole('heading', { name: 'Copie a conexão para a Fecha AI' });
    expect(screen.getByDisplayValue('fecrm_fixture_secret')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('heading', { name: 'Copie a conexão para a Fecha AI' })).toHaveFocus();
    expect(mock.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'Equipe comercial', sourceOrganizationId: ids.source, allowedActorIds: [ids.actor] }));
    expect(clipboard).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar credencial' }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith('fecrm_fixture_secret'));
    fireEvent.click(screen.getByRole('button', { name: 'Já copiei; ocultar credencial' }));
    expect(screen.queryByDisplayValue('fecrm_fixture_secret')).not.toBeInTheDocument(); expect(localStorage.length).toBe(0);
  });
  it('revokes only after confirmation in the localized dialog', async () => {
    mock.list.mockResolvedValue({ connections: [connection()] }); render(<FechaAiConnectionsCard {...scope} canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar conexão' }));
    const dialog = screen.getByRole('dialog', { name: 'Revogar conexão da Fecha AI' });
    expect(mock.revoke).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar revogação' }));
    await screen.findByText('Revogada'); expect(mock.revoke).toHaveBeenCalledWith(expect.anything(), ids.connection);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('changes authorized actors only on save and preserves the selection on a server error', async () => {
    mock.list.mockResolvedValue({ connections: [connection()] }); mock.setActors.mockRejectedValueOnce(new Error('Falha ao salvar identidades.'));
    render(<FechaAiConnectionsCard {...scope} canManage />); fireEvent.click(await screen.findByRole('button', { name: 'Editar identidades' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar identidades autorizadas' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: actors[1].label })); expect(mock.setActors).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar identidades autorizadas' }));
    await within(dialog).findByText('Falha ao salvar identidades.');
    expect(within(dialog).getByRole('checkbox', { name: actors[1].label })).toBeChecked();
    expect(mock.setActors).toHaveBeenCalledWith(expect.anything(), ids.connection, [ids.actor, ids.secondActor]);
  });
  it('returns keyboard focus to the action after Escape and to the section when revocation disables it', async () => {
    mock.list.mockResolvedValue({ connections: [connection()] }); render(<FechaAiConnectionsCard {...scope} canManage />);
    const edit = await screen.findByRole('button', { name: 'Editar identidades' }); fireEvent.click(edit);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(edit).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Revogar conexão' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar revogação' }));
    await screen.findByText('Revogada');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Fecha AI · revisões comerciais' })).toHaveFocus());
  });
  it('drops the credential and old requests when identity or permission changes', async () => {
    const pending = deferred<{ connection: FechaConnection; token: string }>(); mock.create.mockReturnValue(pending.promise);
    const view = render(<FechaAiConnectionsCard {...scope} canManage />); await fillCreate(); fireEvent.click(screen.getByRole('button', { name: 'Gerar credencial para a Fecha AI' }));
    const request = mock.create.mock.calls[0][0] as FechaAdminContext;
    view.rerender(<FechaAiConnectionsCard {...scope} userId={ids.actor} canManage />); expect(request.signal.aborted).toBe(true);
    await act(async () => { pending.resolve({ connection: connection(), token: 'late-secret' }); });
    expect(screen.queryByDisplayValue('late-secret')).not.toBeInTheDocument();
    view.rerender(<FechaAiConnectionsCard {...scope} canManage={false} />); expect(screen.queryByRole('button', { name: 'Gerar credencial para a Fecha AI' })).not.toBeInTheDocument();
  });
  it('does not automatically retry an uncertain credential creation', async () => {
    mock.create.mockRejectedValue(new Error('Não foi possível confirmar a criação.'));
    render(<FechaAiConnectionsCard {...scope} canManage />); await fillCreate(); fireEvent.click(screen.getByRole('button', { name: 'Gerar credencial para a Fecha AI' }));
    await screen.findByText(/Atualize a lista para conferir se a conexão foi criada/);
    expect(screen.getByRole('button', { name: 'Gerar credencial para a Fecha AI' })).toBeDisabled(); expect(mock.create).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar conexões' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gerar credencial para a Fecha AI' })).toBeEnabled());
    expect(mock.create).toHaveBeenCalledOnce();
  });
});
