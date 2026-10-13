import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthWeakPasswordError,
} from '@supabase/supabase-js';
import {
  AUTH_ERROR_MESSAGES as M,
  authErrorCode,
  authErrorMessage,
  authRedirectError,
  type AuthErrorOptions,
} from './auth-errors';
import { OFFLINE_AUTH_MESSAGE, OFFLINE_REQUEST_MESSAGE, OfflineRequestError } from './offline';

const login: AuthErrorOptions = { context: 'login' };
const api = (message: string, status: number, code?: string) => new AuthApiError(message, status, code);
const englishOnScreen = /invalid|error|password|email|user|token|database|signup/i;

afterEach(() => vi.restoreAllMocks());

describe('erros do Auth em pt-BR, pelo código', () => {
  it.each([
    [api('Invalid login credentials', 400, 'invalid_credentials'), login, M.invalidCredentials],
    [api('Email not confirmed', 400, 'email_not_confirmed'), login, M.emailNotConfirmed],
    [api('User already registered', 422, 'user_already_exists'), { context: 'signup' }, M.userExists],
    [
      api('A user with this email address has already been registered', 422, 'email_exists'),
      { context: 'signup' },
      M.userExists,
    ],
    [api('email rate limit exceeded', 429, 'over_email_send_rate_limit'), { context: 'magic_link' }, M.emailRateLimit],
    [api('Request rate limit reached', 429, 'over_request_rate_limit'), login, M.requestRateLimit],
    [api('Email link is invalid or has expired', 403, 'otp_expired'), { context: 'redirect' }, M.linkExpired],
    [api('Flow state has expired', 404, 'flow_state_expired'), { context: 'redirect' }, M.linkExpired],
    [api('Flow state not found', 404, 'flow_state_not_found'), login, M.linkExpired],
    [api('code verifier mismatch', 400, 'bad_code_verifier'), login, M.linkExpired],
    [api('Email link is invalid or has expired', 403, 'otp_expired'), { context: 'recovery' }, M.recoveryLinkExpired],
    [
      api('Signups not allowed for otp', 422, 'otp_disabled'),
      { context: 'magic_link', shouldCreateUser: false },
      M.noAccountForLink,
    ],
    [
      api('Signups not allowed for otp', 422, 'otp_disabled'),
      { context: 'magic_link', shouldCreateUser: true },
      M.signupDisabled,
    ],
    [
      api('Email address "x@y" not authorized', 400, 'email_address_not_authorized'),
      { context: 'signup' },
      M.emailNotSent,
    ],
    [
      api('Email address "x@example.com" is invalid', 400, 'email_address_invalid'),
      { context: 'signup' },
      M.emailInvalid,
    ],
    [
      api('Unable to validate email address: invalid format', 400, 'validation_failed'),
      { context: 'signup' },
      M.emailInvalid,
    ],
    [api('Signups not allowed for this instance', 422, 'signup_disabled'), { context: 'signup' }, M.signupDisabled],
    [api('Email logins are disabled', 422, 'email_provider_disabled'), login, M.signupDisabled],
    [
      api('New password should be different from the old password.', 422, 'same_password'),
      { context: 'reset_password' },
      M.samePassword,
    ],
    [api('Session not found', 403, 'session_not_found'), { context: 'reset_password' }, M.sessionEnded],
    [api('Session expired', 403, 'session_expired'), { context: 'reset_password' }, M.sessionEnded],
    [api('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found'), login, M.sessionEnded],
    [api('Invalid Refresh Token: Already Used', 400, 'refresh_token_already_used'), login, M.sessionEnded],
    [api('User is banned', 403, 'user_banned'), login, M.banned],
    [
      api('Password update requires reauthentication', 400, 'reauthentication_needed'),
      { context: 'reset_password' },
      M.reauthenticationNeeded,
    ],
  ] as const)('%s', (error, options, expected) => {
    expect(authErrorMessage(error, options)).toBe(expected);
  });
});

describe('sem código, pelo texto em inglês', () => {
  it.each([
    ['Invalid login credentials', login, M.invalidCredentials],
    ['Email not confirmed', login, M.emailNotConfirmed],
    ['User already registered', { context: 'signup' }, M.userExists],
    ['Email rate limit exceeded', { context: 'magic_link' }, M.emailRateLimit],
    ['For security purposes, you can only request this after 47 seconds.', { context: 'magic_link' }, M.emailRateLimit],
    ['Token has expired or is invalid', { context: 'redirect' }, M.linkExpired],
    ['Signups not allowed for otp', { context: 'magic_link', shouldCreateUser: false }, M.noAccountForLink],
    ['Signups not allowed for this instance', { context: 'signup' }, M.signupDisabled],
    ['Error sending confirmation email', { context: 'signup' }, M.emailNotSent],
    ['Error sending magic link email', { context: 'magic_link' }, M.emailNotSent],
    ['Unable to validate email address: invalid format', { context: 'signup' }, M.emailInvalid],
    ['New password should be different from the old password.', { context: 'reset_password' }, M.samePassword],
    ['User is banned', login, M.banned],
    ['Password update requires reauthentication', { context: 'reset_password' }, M.reauthenticationNeeded],
  ] as const)('%s', (message, options, expected) => {
    expect(authErrorMessage({ message }, options)).toBe(expected);
  });
});

describe('senha fraca', () => {
  it('lê o mínimo da mensagem do Auth', () => {
    const error = new AuthWeakPasswordError('Password should be at least 8 characters.', 422, ['length']);
    expect(authErrorMessage(error, { context: 'signup' })).toBe('A senha precisa ter pelo menos 8 caracteres.');
    expect(authErrorMessage({ message: 'Password should be at least 6 characters' }, { context: 'signup' })).toBe(
      'A senha precisa ter pelo menos 6 caracteres.',
    );
  });

  it('sem número na mensagem, diz que a senha é curta demais', () => {
    expect(
      authErrorMessage(new AuthWeakPasswordError('Password is too short', 422, ['length']), { context: 'signup' }),
    ).toBe(M.passwordShort);
  });

  it('explica os tipos de caractere exigidos e a senha vazada, sozinhos ou juntos', () => {
    const characters = new AuthWeakPasswordError(
      'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789',
      422,
      ['characters'],
    );
    expect(authErrorMessage(characters, { context: 'reset_password' })).toBe(M.passwordCharacters);
    const pwned = new AuthWeakPasswordError('Password is known to be weak and easy to guess', 422, ['pwned']);
    expect(authErrorMessage(pwned, { context: 'signup' })).toBe(M.passwordPwned);
    const both = new AuthWeakPasswordError('Password should be at least 10 characters.', 422, ['length', 'pwned']);
    expect(authErrorMessage(both, { context: 'signup' })).toBe(
      `A senha precisa ter pelo menos 10 caracteres. ${M.passwordPwned}`,
    );
  });
});

describe('cadastro recusado pelo portão de convites (item 1.1)', () => {
  const gate = api('Database error saving new user', 500, 'unexpected_failure');

  it('com a entrada só por convite, pede o e-mail convidado', () => {
    expect(authErrorMessage(gate, { context: 'signup', inviteOnly: true })).toBe(M.notInvited);
    expect(authErrorMessage(gate, { context: 'magic_link', inviteOnly: true })).toBe(M.notInvited);
    // Versão do Auth sem código: reconhecida pelo texto.
    expect(
      authErrorMessage({ message: 'Database error saving new user' }, { context: 'signup', inviteOnly: true }),
    ).toBe(M.notInvited);
  });

  it('com a instância vazia, a falha é outra: pede para tentar de novo', () => {
    expect(authErrorMessage(gate, { context: 'signup', inviteOnly: false })).toBe(M.signupFailed);
    expect(authErrorMessage(gate, { context: 'signup' })).toBe(M.signupFailed);
  });

  it('fora do cadastro, a falha interna é genérica', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(authErrorMessage(gate, login)).toBe(M.unknown);
  });

  it('o "Link por e-mail" que não cria conta nunca é recusado pelo portão', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(authErrorMessage(gate, { context: 'magic_link', inviteOnly: true, shouldCreateUser: false })).toBe(
      M.unknown,
    );
  });

  it('outra falha interna ao criar a conta não vira a recusa do convite', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const other = api('Database error finding user', 500, 'unexpected_failure');
    expect(authErrorMessage(other, { context: 'signup', inviteOnly: true })).toBe(M.unknown);
    // Sem texto, a falha ao criar a conta continua tratada como o portão.
    expect(authErrorMessage(api('', 500, 'unexpected_failure'), { context: 'signup', inviteOnly: true })).toBe(
      M.notInvited,
    );
  });
});

describe('falha de envio do e-mail, com o código que o Auth hospedado manda (unexpected_failure)', () => {
  // internal/api/mail.go do Supabase Auth: NewInternalServerError("Error sending confirmation email"), com o código
  // unexpected_failure, como a recusa do portão. Com o SMTP mal configurado, nenhuma tela pode falar em convite.
  const confirmation = api('Error sending confirmation email', 500, 'unexpected_failure');
  const magicLink = api('Error sending magic link email', 500, 'unexpected_failure');

  it.each([
    ['cadastro com a entrada só por convite', confirmation, { context: 'signup', inviteOnly: true }],
    ['cadastro na instância vazia', confirmation, { context: 'signup', inviteOnly: false }],
    ['link por e-mail com convite', confirmation, { context: 'magic_link', inviteOnly: true, shouldCreateUser: true }],
    [
      'link por e-mail de quem já tem conta',
      magicLink,
      { context: 'magic_link', inviteOnly: true, shouldCreateUser: false },
    ],
    ['link por e-mail na instância vazia', magicLink, { context: 'magic_link', shouldCreateUser: true }],
    ['recuperação de senha', api('Error sending recovery email', 500, 'unexpected_failure'), { context: 'recovery' }],
  ] as const)('%s', (_label, error, options) => {
    expect(authErrorMessage(error, options)).toBe(M.emailNotSent);
  });
});

describe('authErrorCode', () => {
  it('lê o código do AuthApiError e, sem ele, o reconhece pelo texto', () => {
    expect(authErrorCode(api('New password should be different from the old password.', 422, 'same_password'))).toBe(
      'same_password',
    );
    expect(authErrorCode({ message: 'New password should be different from the old password.' })).toBe('same_password');
    expect(authErrorCode(new Error('Totally unknown'))).toBe('');
    expect(authErrorCode(null)).toBe('');
  });
});

describe('conexão e erros desconhecidos', () => {
  it('sem conexão, a recusa do cliente não fala em salvar', () => {
    // O Auth devolve um AuthRetryableFetchError que repete a mensagem do OfflineRequestError.
    const authError = Object.assign(new Error(OFFLINE_REQUEST_MESSAGE), { name: 'AuthRetryableFetchError' });
    expect(authErrorMessage(authError, login)).toBe(OFFLINE_AUTH_MESSAGE);
    expect(authErrorMessage(new OfflineRequestError(), { context: 'signup' })).toBe(OFFLINE_AUTH_MESSAGE);
    expect(OFFLINE_AUTH_MESSAGE).not.toMatch(/salv|sincroniz/i);
  });

  it('falha de rede vira a mensagem de servidor inacessível', () => {
    expect(authErrorMessage(new AuthRetryableFetchError('Failed to fetch', 0), login)).toBe(M.network);
    expect(authErrorMessage(new TypeError('Failed to fetch'), { context: 'reset_password' })).toBe(M.network);
  });

  it('sessão ausente no cliente', () => {
    expect(authErrorMessage(new AuthSessionMissingError(), { context: 'reset_password' })).toBe(M.sessionEnded);
  });

  it('um erro desconhecido mostra a mensagem genérica, sem inglês na tela, e vai para o console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const error of [
      api('Something exploded in the database', 500, 'something_new'),
      { message: 'Unexpected error happened' },
      new Error('Totally unknown'),
      null,
      'texto solto',
    ]) {
      const message = authErrorMessage(error, login);
      expect(message).toBe(M.unknown);
      expect(message).not.toMatch(englishOnScreen);
    }
    expect(warn).toHaveBeenCalled();
  });

  it('nenhuma mensagem conhecida traz texto em inglês', () => {
    for (const message of Object.values(M)) expect(message).not.toMatch(/\b(invalid|error|password|token)\b/i);
  });
});

describe('erro do Auth na URL de retorno', () => {
  it('lê o fragmento do fluxo implícito', () => {
    expect(
      authRedirectError({
        hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
        search: '?invite=x',
      }),
    ).toEqual({ code: 'otp_expired', message: 'Email link is invalid or has expired' });
  });

  it('lê a consulta, e sem código usa o erro', () => {
    expect(authRedirectError({ hash: '', search: '?error=server_error&error_description=Oops' })).toEqual({
      code: 'server_error',
      message: 'Oops',
    });
  });

  it('sem erro na URL, devolve null', () => {
    expect(authRedirectError({ hash: '', search: '?invite=x&next=%2Fpipeline' })).toBeNull();
    expect(authRedirectError({ hash: '#topo', search: '' })).toBeNull();
  });

  it('o erro lido vira a mensagem do link expirado', () => {
    const found = authRedirectError({ hash: '#error_code=otp_expired&error_description=x', search: '' });
    expect(authErrorMessage(found, { context: 'redirect' })).toBe(M.linkExpired);
  });
});
