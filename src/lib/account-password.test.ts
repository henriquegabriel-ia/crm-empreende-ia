import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError } from '@supabase/supabase-js';
import { claimAccountPassword } from './account-password';
import { AUTH_ERROR_MESSAGES } from './auth-errors';
import { OFFLINE_AUTH_MESSAGE, OfflineRequestError } from './offline';

const auth = vi.hoisted(() => ({ updateUser: vi.fn(), signOut: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth } }));

beforeEach(() => {
  auth.updateUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  auth.signOut.mockReset().mockResolvedValue({ error: null });
});

describe('claimAccountPassword', () => {
  it('grava a senha e depois encerra as outras sessões, mantendo esta', async () => {
    expect(await claimAccountPassword('senha-da-conta')).toBeNull();
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'senha-da-conta' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(auth.signOut.mock.invocationCallOrder[0]);
  });

  it('a senha que já era a da conta também serve: quem a digitou já a conhece', async () => {
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('New password should be different from the old password.', 422, 'same_password'),
    });
    expect(await claimAccountPassword('senha-do-cadastro')).toBeNull();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('senha fraca: devolve o motivo em pt-BR e não encerra nada', async () => {
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthWeakPasswordError('Password should be at least 8 characters.', 422, ['length']),
    });
    expect(await claimAccountPassword('curta')).toBe('A senha precisa ter pelo menos 8 caracteres.');
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('falha ao encerrar as outras sessões: devolve o motivo, para a tela não seguir', async () => {
    auth.signOut.mockResolvedValue({ error: new AuthRetryableFetchError('Failed to fetch', 0) });
    expect(await claimAccountPassword('senha-da-conta')).toBe(AUTH_ERROR_MESSAGES.network);
  });

  it('sem conexão, diz que falta conexão', async () => {
    auth.updateUser.mockRejectedValue(new OfflineRequestError());
    expect(await claimAccountPassword('senha-da-conta')).toBe(OFFLINE_AUTH_MESSAGE);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
