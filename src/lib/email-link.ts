/**
 * Links e códigos enviados por e-mail pelo Supabase Auth (revisão de 13/10/2026 do reforço do item 1.1;
 * docs/arquitetura/1.1.md, seção 16.21).
 *
 * Filtros de segurança do e-mail, como o Safe Links do Microsoft Defender, abrem os links da mensagem antes da pessoa.
 * Um link que vai direto ao `GET /auth/v1/verify` do Auth (o `{{ .ConfirmationURL }}` dos modelos padrão) é gasto
 * nessa visita: o Auth confirma a conta e abre a sessão para o filtro, e a pessoa recebe "link expirado" em todo link
 * novo. Por isso, os modelos do CRM (scripts/lib/auth-emails.mjs) apontam para o próprio CRM, com o token no fragmento
 * (`<retorno>#token_hash=<hash>&type=<tipo>`), e o CRM só confere o token (`verifyOtp`, um POST ao Auth) quando a
 * pessoa toca em "Continuar" (EmailLinkGate). A confirmação e a sessão continuam nascendo no mesmo pedido e na mesma
 * transação (verifyPost), com o método `otp`, e a prova do e-mail é gravada como antes.
 *
 * Os e-mails de confirmação e de link de acesso também trazem o código (`{{ .Token }}`), para quem abre o e-mail em
 * outro aparelho: digitado no CRM, ele abre a sessão no aparelho em que a pessoa pediu o link (EmailCodeForm).
 */

/**
 * Tipos aceitos no fragmento do link, os mesmos dos modelos do CRM: `email` na confirmação e no link de acesso (o Auth
 * procura o token nos dois), `recovery` na redefinição de senha e `invite` no "Invite user" do painel. A troca de
 * e-mail (`email_change`) fica de fora: o modelo dela continua com o link do Auth.
 */
export const EMAIL_LINK_TYPES = ['email', 'recovery', 'invite'] as const;
export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

/** Link do e-mail lido do fragmento da URL: completo, com o token e o tipo, ou incompleto (cortado ou alterado). */
export type EmailLink = { tokenHash: string; type: EmailLinkType } | { incomplete: true };

// O token_hash do Auth: hexadecimal (com o prefixo pkce_ no fluxo PKCE).
const TOKEN_HASH = /^[A-Za-z0-9_-]+$/;

/**
 * Lê o link do e-mail do fragmento da URL (`#token_hash=…&type=…`). Devolve null quando o fragmento não traz
 * `token_hash` (a URL não veio de um link do e-mail) e `{ incomplete: true }` quando o token ou o tipo faltam ou não
 * são válidos.
 */
export function emailLinkFromHash(hash: string): EmailLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('token_hash')) return null;
  const tokenHash = (params.get('token_hash') ?? '').trim();
  const type = params.get('type') ?? '';
  if (!TOKEN_HASH.test(tokenHash) || !(EMAIL_LINK_TYPES as readonly string[]).includes(type))
    return { incomplete: true };
  return { tokenHash, type: type as EmailLinkType };
}

/** O código do e-mail tem de 6 a 10 dígitos (Email OTP Length, no painel do Supabase). */
export const EMAIL_CODE = /^\d{6,10}$/;

/** O código como a pessoa o digitou ou colou, sem espaços, hifens e pontos. */
export function normalizeEmailCode(value: string): string {
  return value.replace(/[\s.-]/g, '');
}
