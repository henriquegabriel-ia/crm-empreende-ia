import { isOfflineRequestError, OFFLINE_AUTH_MESSAGE } from '@/lib/offline';

/** Onde o erro do Auth aparece: cada tela pede um próximo passo diferente. */
export type AuthErrorContext = 'login' | 'signup' | 'magic_link' | 'recovery' | 'reset_password' | 'redirect';

export interface AuthErrorOptions {
  context: AuthErrorContext;
  /**
   * A instância já tem empresa (instance_status) ou a pessoa veio por um convite: um cadastro recusado pelo banco é o
   * portão de convites (item 1.1), e não uma falha qualquer.
   */
  inviteOnly?: boolean;
  /** O "Link por e-mail" foi pedido sem criar conta (signInWithOtp com shouldCreateUser: false). */
  shouldCreateUser?: boolean;
}

export const AUTH_ERROR_MESSAGES = {
  // Desde o reforço do item 1.1, a conta nasce pelo link do e-mail e pode ainda não ter senha.
  invalidCredentials:
    'E-mail ou senha incorretos. Confira e tente de novo, ou use “Esqueceu a senha?”. Se ainda não criou uma senha, entre por “Link por e-mail”.',
  emailNotConfirmed:
    'Confirme seu e-mail antes de entrar: abra o link que enviamos. Não recebeu? Peça outro em “Link por e-mail”.',
  passwordCharacters: 'Use na senha os tipos de caractere exigidos: letras maiúsculas, minúsculas, números e símbolos.',
  passwordPwned: 'Esta senha já apareceu em vazamentos conhecidos. Escolha outra.',
  passwordShort: 'A senha é curta demais.',
  userExists: 'Já existe uma conta com este e-mail. Entre com a senha ou use “Esqueceu a senha?”.',
  emailRateLimit: 'Muitos e-mails enviados para este endereço. Aguarde alguns minutos antes de pedir outro.',
  requestRateLimit: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
  linkExpired: 'O link expirou ou já foi usado. Peça um novo em “Link por e-mail”.',
  recoveryLinkExpired: 'O link expirou ou já foi usado. Peça um novo em “Esqueceu a senha?”.',
  noAccountForLink:
    'Não há conta com este e-mail. Se você recebeu um convite, abra o link do convite para criar a conta.',
  notInvited:
    'Este e-mail não tem convite válido neste CRM. Use o e-mail que recebeu o convite ou peça um novo convite a quem administra.',
  signupFailed:
    'Não foi possível criar a conta agora. Tente de novo em instantes; se continuar, avise quem administra o CRM.',
  emailNotSent:
    'O CRM ainda não consegue enviar e-mails para este endereço. Avise quem administra: falta configurar o envio de e-mails do Supabase.',
  emailInvalid: 'Confira o e-mail informado. Alguns domínios de teste não são aceitos.',
  signupDisabled: 'O cadastro está desligado nas configurações deste CRM. Avise quem administra.',
  samePassword: 'A nova senha precisa ser diferente da atual.',
  // Nenhuma tela do CRM pede a senha atual: o caminho é o link do e-mail, cuja sessão o Auth trata como recuperação
  // (Session.IsRecovery: otp, magiclink e recovery) e dispensa dessa exigência. Mensagem de reserva.
  currentPasswordRequired:
    'Este CRM exige a senha atual para trocá-la, e esta tela não a pede. Saia da conta, use “Esqueceu a senha?” na tela de entrada e abra o link que chegar: por ele, você cria a senha sem informar a atual.',
  reauthenticationNeeded: 'Por segurança, saia da conta, entre de novo e repita o pedido.',
  sessionEnded: 'Sua sessão terminou. Entre novamente.',
  banned: 'Este acesso está bloqueado. Fale com quem administra o CRM.',
  network: 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.',
  unknown: 'Não foi possível concluir agora. Tente de novo em instantes.',
} as const;

// Dois textos que o Auth hospedado manda com o mesmo código, `unexpected_failure`: a recusa do portão de cadastro
// (gatilho em auth.users) e a falha de envio do e-mail de confirmação ou do link (SMTP mal configurado ou fora do ar).
const NEW_USER_REFUSED = /database error saving new user/i;
const EMAIL_NOT_SENT = /error sending .*email/i;

// Sem código (versões antigas do Auth, erros montados pelo cliente), o código vem do texto em inglês.
const CODES_BY_TEXT: readonly (readonly [RegExp, string])[] = [
  [/invalid login credentials/i, 'invalid_credentials'],
  [/email not confirmed/i, 'email_not_confirmed'],
  [/different from the old password/i, 'same_password'],
  [/current password required/i, 'current_password_required'],
  [/password should|password is known|weak password/i, 'weak_password'],
  [/already (been )?registered|user already exists/i, 'user_already_exists'],
  [/email rate limit|only request this after/i, 'over_email_send_rate_limit'],
  [/rate limit|too many requests/i, 'over_request_rate_limit'],
  [/link is invalid or has expired|token has expired|otp.*expired/i, 'otp_expired'],
  [/signups not allowed for otp/i, 'otp_disabled'],
  [/signups? (are )?not allowed|signups? disabled/i, 'signup_disabled'],
  [NEW_USER_REFUSED, 'unexpected_failure'],
  [EMAIL_NOT_SENT, 'email_address_not_authorized'],
  [/email address not authorized/i, 'email_address_not_authorized'],
  [/requires reauthentication/i, 'reauthentication_needed'],
  [/unable to validate email|invalid format|email address .*invalid/i, 'email_address_invalid'],
  [/auth session missing|session (not found|expired)|refresh token/i, 'session_not_found'],
  [/user is banned/i, 'user_banned'],
];

const LINK_EXPIRED = new Set(['otp_expired', 'flow_state_expired', 'flow_state_not_found', 'bad_code_verifier']);
const SESSION_ENDED = new Set([
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
  'refresh_token_already_used',
]);

function field(error: unknown, name: string): unknown {
  return typeof error === 'object' && error !== null ? (error as Record<string, unknown>)[name] : undefined;
}

function messageOf(error: unknown): string {
  const message = field(error, 'message');
  return typeof message === 'string' ? message : '';
}

function codeOf(error: unknown, message: string): string {
  const code = field(error, 'code');
  if (typeof code === 'string' && code) return code;
  return CODES_BY_TEXT.find(([pattern]) => pattern.test(message))?.[1] ?? '';
}

/** Código do erro do Auth: o `code` do AuthApiError ou, sem ele, o reconhecido pelo texto em inglês ('' sem nenhum). */
export function authErrorCode(error: unknown): string {
  return codeOf(error, messageOf(error));
}

function isNetworkFailure(error: unknown, message: string): boolean {
  const name = field(error, 'name');
  return name === 'AuthRetryableFetchError' || (name === 'TypeError' && /fetch|network/i.test(message));
}

// AuthWeakPasswordError traz `reasons` (length, characters, pwned); sem elas, os motivos vêm do texto.
function weakPasswordMessage(error: unknown, message: string): string {
  const listed = field(error, 'reasons');
  const reasons = Array.isArray(listed) ? listed.map(String) : [];
  if (!reasons.length) {
    if (/at least \d+ characters?|too short|length/i.test(message)) reasons.push('length');
    if (/character of each|should contain/i.test(message)) reasons.push('characters');
    if (/known|easy to guess|pwned|leaked/i.test(message)) reasons.push('pwned');
  }
  const parts: string[] = [];
  if (reasons.includes('length') || !reasons.length) {
    const minimum = /(\d+)/.exec(message)?.[1];
    parts.push(minimum ? `A senha precisa ter pelo menos ${minimum} caracteres.` : AUTH_ERROR_MESSAGES.passwordShort);
  }
  if (reasons.includes('characters')) parts.push(AUTH_ERROR_MESSAGES.passwordCharacters);
  if (reasons.includes('pwned')) parts.push(AUTH_ERROR_MESSAGES.passwordPwned);
  return parts.join(' ');
}

/**
 * Texto em pt-BR para um erro do Supabase Auth, reconhecido pelo `code` do AuthApiError e, sem código, pelo texto em
 * inglês. O texto original nunca vai para a tela: um erro desconhecido mostra a mensagem genérica e vai para o
 * console.warn, para quem administra investigar.
 */
export function authErrorMessage(error: unknown, options: AuthErrorOptions): string {
  if (isOfflineRequestError(error)) return OFFLINE_AUTH_MESSAGE;
  const message = messageOf(error);
  if (isNetworkFailure(error, message)) return AUTH_ERROR_MESSAGES.network;
  const code = codeOf(error, message);
  const creatingAccount = options.context === 'signup' || options.context === 'magic_link';
  if (LINK_EXPIRED.has(code))
    return options.context === 'recovery' ? AUTH_ERROR_MESSAGES.recoveryLinkExpired : AUTH_ERROR_MESSAGES.linkExpired;
  if (SESSION_ENDED.has(code)) return AUTH_ERROR_MESSAGES.sessionEnded;
  switch (code) {
    case 'invalid_credentials':
      return AUTH_ERROR_MESSAGES.invalidCredentials;
    case 'email_not_confirmed':
      return AUTH_ERROR_MESSAGES.emailNotConfirmed;
    case 'weak_password':
      return weakPasswordMessage(error, message);
    case 'user_already_exists':
    case 'email_exists':
      return AUTH_ERROR_MESSAGES.userExists;
    case 'over_email_send_rate_limit':
      return AUTH_ERROR_MESSAGES.emailRateLimit;
    case 'over_request_rate_limit':
      return AUTH_ERROR_MESSAGES.requestRateLimit;
    case 'otp_disabled':
      return options.shouldCreateUser === false
        ? AUTH_ERROR_MESSAGES.noAccountForLink
        : AUTH_ERROR_MESSAGES.signupDisabled;
    case 'unexpected_failure':
      // O texto decide: a falha de envio do e-mail vale para qualquer tela (inclusive o link de quem já tem conta), e só
      // um cadastro que cria conta passa pelo portão, que chega como "Database error saving new user" (ou sem texto).
      // O "Link por e-mail" sem criar conta (shouldCreateUser: false) nunca é recusado por ele.
      if (EMAIL_NOT_SENT.test(message)) return AUTH_ERROR_MESSAGES.emailNotSent;
      if (creatingAccount && options.shouldCreateUser !== false && (!message || NEW_USER_REFUSED.test(message)))
        return options.inviteOnly ? AUTH_ERROR_MESSAGES.notInvited : AUTH_ERROR_MESSAGES.signupFailed;
      break;
    case 'email_address_not_authorized':
      return AUTH_ERROR_MESSAGES.emailNotSent;
    case 'email_address_invalid':
    case 'validation_failed':
      return AUTH_ERROR_MESSAGES.emailInvalid;
    case 'signup_disabled':
    case 'email_provider_disabled':
      return AUTH_ERROR_MESSAGES.signupDisabled;
    case 'same_password':
      return AUTH_ERROR_MESSAGES.samePassword;
    // Opção do Auth que exige a senha atual para trocá-la: não vale para a conta sem senha nem para a sessão aberta pelo
    // link do e-mail, a única em que o CRM pede a senha nova (reforço do item 1.1).
    case 'current_password_required':
    case 'current_password_mismatch':
      return AUTH_ERROR_MESSAGES.currentPasswordRequired;
    case 'reauthentication_needed':
      return AUTH_ERROR_MESSAGES.reauthenticationNeeded;
    case 'user_banned':
      return AUTH_ERROR_MESSAGES.banned;
  }
  if (field(error, 'name') === 'AuthSessionMissingError') return AUTH_ERROR_MESSAGES.sessionEnded;
  console.warn('Erro do Auth sem tradução:', code || '(sem código)', message);
  return AUTH_ERROR_MESSAGES.unknown;
}

/**
 * Erro que o Auth devolve na URL ao voltar de um link (expirado, já usado, negado): no fragmento, no fluxo implícito
 * padrão do cliente, ou na consulta. Devolve null quando a URL não traz erro.
 */
export function authRedirectError(location: {
  hash: string;
  search: string;
}): { code: string; message: string } | null {
  for (const source of [location.hash.replace(/^#/, ''), location.search.replace(/^\?/, '')]) {
    const params = new URLSearchParams(source);
    const code = params.get('error_code') ?? '';
    const message = params.get('error_description') ?? '';
    if (code || message || params.get('error')) return { code: code || params.get('error') || '', message };
  }
  return null;
}
