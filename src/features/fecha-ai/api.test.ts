import { beforeEach, describe, expect, it, vi } from 'vitest';
const { invoke, getSession } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession }, functions: { invoke } } }));
import { fechaConnectionsApi, type FechaAdminContext } from './api';
import { actors, connection, deferred, ids, scope } from './testFixtures';
const context = (): FechaAdminContext => ({ scope, signal: new AbortController().signal, isCurrent: () => true });
beforeEach(() => { invoke.mockReset(); getSession.mockReset(); getSession.mockResolvedValue({ data: { session: { user: { id: ids.user }, access_token: 'fixture-jwt' } }, error: null }); invoke.mockResolvedValue({ data: { connections: [connection()] }, error: null }); });
describe('Fecha IA connection administration requests', () => {
  it('passes expected organization and the captured JWT', async () => {
    await fechaConnectionsApi.list(context());
    expect(invoke).toHaveBeenCalledWith('manage-fecha-ai-connections', expect.objectContaining({ body: { operation: 'list', organizationId: ids.organization }, headers: { Authorization: 'Bearer fixture-jwt' } }));
    expect(getSession).toHaveBeenCalledTimes(2);
  });
  it('does not invoke with another UID or an aborted scope', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: ids.actor }, access_token: 'other-jwt' } }, error: null });
    await expect(fechaConnectionsApi.list(context())).rejects.toThrow('Sua sessão mudou'); expect(invoke).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(fechaConnectionsApi.list({ ...context(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects a late response after the context changes', async () => {
    const pending = deferred<{ data: { connections: ReturnType<typeof connection>[] }; error: null }>(); invoke.mockReturnValue(pending.promise);
    let current = true; const result = fechaConnectionsApi.list({ ...context(), isCurrent: () => current });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce()); current = false;
    pending.resolve({ data: { connections: [connection()] }, error: null });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects connection and actor options from another CRM organization', async () => {
    invoke.mockResolvedValue({ data: { connections: [connection({ destinationOrganizationId: ids.source })] }, error: null });
    await expect(fechaConnectionsApi.list(context())).rejects.toThrow('outra organização');
    invoke.mockResolvedValue({ data: { organizationId: ids.organization, actors: [{ ...actors[0], organizationId: ids.source }] }, error: null });
    await expect(fechaConnectionsApi.actors(context())).rejects.toThrow('resposta não pôde ser validada');
  });
  it('accepts a creation token only on the create response and rejects an unexpected list token', async () => {
    const token = 'fecrm_' + 'a'.repeat(64);
    invoke.mockResolvedValue({ data: { connection: connection(), token }, error: null });
    const created = await fechaConnectionsApi.create(context(), { name: 'Equipe', sourceOrganizationId: ids.source, allowedActorIds: [ids.actor], expiresAt: connection().expiresAt });
    expect(created.token).toBe(token);
    invoke.mockResolvedValue({ data: { connections: [connection()], token: 'must-not-be-exposed' }, error: null });
    await expect(fechaConnectionsApi.list(context())).rejects.toThrow('resposta não pôde ser validada');
  });
});
