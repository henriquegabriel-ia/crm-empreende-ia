import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError } from '@supabase/supabase-js';
import { EMAIL_LINK_METHODS, isEmailLinkSession, setAccountPassword } from './account-password';
import { AUTH_ERROR_MESSAGES } from './auth-errors';
import { OFFLINE_AUTH_MESSAGE, OfflineRequestError } from './offline';

const auth = vi.hoisted(() => ({ updateUser: vi.fn(), signOut: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth } }));

// Token no formato do Supabase Auth (cabeçalho, claims e assinatura em base64url); a assinatura não é conferida.
const encode = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (claims: Record<string, unknown>) => `${encode({ alg: 'HS256' })}.${encode(claims)}.assinatura`;
const withMethod = (method: string) => token({ sub: 'user-1', amr: [{ method, timestamp: 1_760_000_000 }] });

beforeEach(() => {
  auth.updateUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  auth.signOut.mockReset().mockResolvedValue({ error: null });
});

describe('isEmailLinkSession', () => {
  it.each(EMAIL_LINK_METHODS)('a sessão aberta por um link enviado ao e-mail (%s) conta', (method) => {
    expect(isEmailLinkSession(withMethod(method))).toBe(true);
  });

  it.each(['email_change', 'password', 'totp', 'token_refresh', 'anonymous', 'oauth', 'sso/saml'])(
    'a sessão aberta por %s não conta',
    (method) => {
      expect(isEmailLinkSession(withMethod(method))).toBe(false);
    },
  );

  it('basta um método de link entre os do token (o TOTP depois do link, por exemplo)', () => {
    expect(
      isEmailLinkSession(
        token({
          amr: [
            { method: 'totp', timestamp: 2 },
            { method: 'otp', timestamp: 1 },
          ],
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['sem amr', token({ sub: 'user-1' })],
    ['amr que não é lista', token({ amr: 'otp' })],
    ['amr sem objetos de método', token({ amr: ['otp'] })],
    ['token sem as claims', 'só-um-pedaço'],
    ['claims que não são JSON', 'a.não-é-json.c'],
    ['sem token', null],
  ])('%s não conta: a tela não pede a senha, e o banco decide', (_label, accessToken) => {
    expect(isEmailLinkSession(accessToken)).toBe(false);
  });

  it('usa a mesma lista de métodos que private.email_proven() no banco', async () => {
    const { readFileSync } = await import('node:fs');
    const migration = readFileSync('supabase/migrations/20261012110000_admission_email_proof.sql', 'utf8');
    const list = /m->>'method' in \(([^)]*)\)/.exec(migration)?.[1] ?? '';
    expect(list.split(',').map((item) => item.trim().replace(/^'|'$/g, ''))).toEqual([...EMAIL_LINK_METHODS]);
  });
});

describe('setAccountPassword', () => {
  it('grava a senha e depois encerra as outras sessões, mantendo esta', async () => {
    expect(await setAccountPassword('senha-da-conta')).toBeNull();
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'senha-da-conta' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(auth.signOut.mock.invocationCallOrder[0]);
  });

  it('a senha que já era a da conta também serve: quem a digitou já a conhece', async () => {
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('New password should be different from the old password.', 422, 'same_password'),
    });
    expect(await setAccountPassword('senha-de-antes')).toBeNull();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('senha fraca: devolve o motivo em pt-BR e não encerra nada', async () => {
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthWeakPasswordError('Password should be at least 8 characters.', 422, ['length']),
    });
    expect(await setAccountPassword('curta')).toBe('A senha precisa ter pelo menos 8 caracteres.');
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('a opção que exige a senha atual: devolve o caminho em pt-BR e não encerra nada', async () => {
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('Current password required when setting new password.', 400, 'current_password_required'),
    });
    expect(await setAccountPassword('senha-nova')).toBe(AUTH_ERROR_MESSAGES.currentPasswordRequired);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('falha ao encerrar as outras sessões: devolve o motivo, para a tela não seguir', async () => {
    auth.signOut.mockResolvedValue({ error: new AuthRetryableFetchError('Failed to fetch', 0) });
    expect(await setAccountPassword('senha-da-conta')).toBe(AUTH_ERROR_MESSAGES.network);
  });

  it('sem conexão, diz que falta conexão', async () => {
    auth.updateUser.mockRejectedValue(new OfflineRequestError());
    expect(await setAccountPassword('senha-da-conta')).toBe(OFFLINE_AUTH_MESSAGE);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
