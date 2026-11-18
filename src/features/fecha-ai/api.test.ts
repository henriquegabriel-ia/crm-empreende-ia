import { beforeEach, describe, expect, it, vi } from 'vitest';
const { invoke, getSession } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession }, functions: { invoke } } }));
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import {
  FECHA_NOT_PUBLISHED,
  FECHA_NOT_REACHED,
  fechaConnectionsApi,
  fechaLoadNotice,
  isFechaUnavailable,
  type FechaAdminContext,
} from './api';
import { actors, connection, deferred, ids, scope } from './testFixtures';
const context = (): FechaAdminContext => ({ scope, signal: new AbortController().signal, isCurrent: () => true });
beforeEach(() => {
  invoke.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({
    data: { session: { user: { id: ids.user }, access_token: 'fixture-jwt' } },
    error: null,
  });
  invoke.mockResolvedValue({ data: { connections: [connection()] }, error: null });
});
describe('Fecha IA connection administration requests', () => {
  it('passes expected organization and the captured JWT', async () => {
    await fechaConnectionsApi.list(context());
    expect(invoke).toHaveBeenCalledWith(
      'manage-fecha-ai-connections',
      expect.objectContaining({
        body: { operation: 'list', organizationId: ids.organization },
        headers: { Authorization: 'Bearer fixture-jwt' },
      }),
    );
    expect(getSession).toHaveBeenCalledTimes(2);
  });
  it('does not invoke with another UID or an aborted scope', async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: ids.actor }, access_token: 'other-jwt' } },
      error: null,
    });
    await expect(fechaConnectionsApi.list(context())).rejects.toThrow('Sua sessão mudou');
    expect(invoke).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(fechaConnectionsApi.list({ ...context(), signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('rejects a late response after the context changes', async () => {
    const pending = deferred<{ data: { connections: ReturnType<typeof connection>[] }; error: null }>();
    invoke.mockReturnValue(pending.promise);
    let current = true;
    const result = fechaConnectionsApi.list({ ...context(), isCurrent: () => current });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    current = false;
    pending.resolve({ data: { connections: [connection()] }, error: null });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects connection and actor options from another CRM organization', async () => {
    invoke.mockResolvedValue({
      data: { connections: [connection({ destinationOrganizationId: ids.source })] },
      error: null,
    });
    await expect(fechaConnectionsApi.list(context())).rejects.toThrow('outra organização');
    invoke.mockResolvedValue({
      data: { organizationId: ids.organization, actors: [{ ...actors[0], organizationId: ids.source }] },
      error: null,
    });
    await expect(fechaConnectionsApi.actors(context())).rejects.toThrow('resposta não pôde ser validada');
  });
  it('accepts a creation token only on the create response and rejects an unexpected list token', async () => {
    const token = 'fecrm_' + 'a'.repeat(64);
    invoke.mockResolvedValue({ data: { connection: connection(), token }, error: null });
    const created = await fechaConnectionsApi.create(context(), {
      name: 'Equipe',
      sourceOrganizationId: ids.source,
      allowedActorIds: [ids.actor],
      expiresAt: connection().expiresAt,
    });
    expect(created.token).toBe(token);
    invoke.mockResolvedValue({ data: { connections: [connection()], token: 'must-not-be-exposed' }, error: null });
    await expect(fechaConnectionsApi.list(context())).rejects.toThrow('resposta não pôde ser validada');
  });
  // Roteiro 3.4: a tela mostra o código do receptor em português, nunca a resposta crua, e reconhece a função que não
  // foi publicada (uma empresa que não usa a Fecha IA).
  it('translates the receiver code and recognizes an unpublished function', async () => {
    const httpError = (status: number, body: unknown) =>
      new FunctionsHttpError(new Response(JSON.stringify(body), { status }));
    invoke.mockResolvedValue({
      data: null,
      error: httpError(409, { error: 'Não foi possível concluir esta operação.', code: 'connection_inactive' }),
    });
    await expect(fechaConnectionsApi.list(context())).rejects.toThrow(
      'Esta conexão venceu ou foi revogada e não muda mais. Gere outra conexão.',
    );
    invoke.mockResolvedValue({ data: null, error: httpError(403, { error: 'x', code: 'forbidden' }) });
    await expect(fechaConnectionsApi.list(context())).rejects.toThrow('Só donos e administradores ativos');
    // O 404 do gateway, sem o código do receptor: a função não está publicada neste CRM.
    invoke.mockResolvedValue({
      data: null,
      error: httpError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }),
    });
    const unpublished = await fechaConnectionsApi.list(context()).catch((error: unknown) => error);
    expect(unpublished).toMatchObject({ message: FECHA_NOT_PUBLISHED });
    expect(isFechaUnavailable(unpublished)).toBe(true);
    expect(fechaLoadNotice(unpublished)).toBe(FECHA_NOT_PUBLISHED);
    // O 404 com o código do receptor é da conexão, e não da função.
    invoke.mockResolvedValue({ data: null, error: httpError(404, { error: 'x', code: 'connection_not_found' }) });
    const missing = await fechaConnectionsApi.revoke(context(), ids.connection).catch((error: unknown) => error);
    expect(missing).toMatchObject({ message: 'Esta conexão não existe mais. Atualize as conexões.' });
    expect(isFechaUnavailable(missing)).toBe(false);
    expect(fechaLoadNotice(missing)).toBeNull();
    // Rede, CORS ou origem fora de CRM_ALLOWED_ORIGINS: o navegador não lê a resposta. No navegador, é também o caso da
    // função não publicada: o preflight recebe o 404 do gateway, sem os cabeçalhos CORS (revisão do A2-CRM). Numa
    // operação, o alerta; na leitura do cartão, o aviso neutro, que cobre os dois casos.
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) });
    const unreachable = await fechaConnectionsApi.list(context()).catch((error: unknown) => error);
    expect(unreachable).toMatchObject({ message: expect.stringContaining('CRM_ALLOWED_ORIGINS') });
    expect(isFechaUnavailable(unreachable)).toBe(false);
    expect(fechaLoadNotice(unreachable)).toBe(FECHA_NOT_REACHED);
    expect(FECHA_NOT_REACHED).toContain('se as duas funções do receptor estão publicadas');
    expect(FECHA_NOT_REACHED).toContain('CRM_ALLOWED_ORIGINS');
    // Um código desconhecido não aparece: a tela pede para conferir o resultado.
    invoke.mockResolvedValue({
      data: null,
      error: httpError(500, { error: 'SQL error detail', code: 'receiver_error' }),
    });
    await expect(
      fechaConnectionsApi.create(context(), {
        name: 'Equipe',
        sourceOrganizationId: ids.source,
        allowedActorIds: [ids.actor],
        expiresAt: connection().expiresAt,
      }),
    ).rejects.toThrow('Não foi possível concluir a configuração. Atualize as conexões para consultar o resultado.');
  });
});
