import { supabase } from '@/integrations/supabase/client';
import { authErrorCode, authErrorMessage } from '@/lib/auth-errors';

/**
 * Métodos de entrada (`amr` do token do Supabase Auth) de uma sessão aberta por um link enviado ao e-mail: `otp` no
 * fluxo implícito, o do CRM, e os demais no PKCE. `email_change` fica de fora: na troca segura de e-mail, a sessão vai
 * para quem abre o último dos dois links, que pode ser o do endereço antigo. É a mesma lista de `private.email_proven()`
 * (supabase/migrations/20261012110000_admission_email_proof.sql; o teste confere as duas).
 */
export const EMAIL_LINK_METHODS = ['otp', 'magiclink', 'email/signup', 'invite', 'recovery'] as const;

function tokenClaims(accessToken: string): Record<string, unknown> | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')));
    return typeof claims === 'object' && claims !== null ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * A sessão foi aberta por um link enviado ao e-mail (reforço do item 1.1; docs/arquitetura/1.1.md, seção 16.6). Lê o
 * `amr` do token sem conferir a assinatura: serve só para a tela decidir se pede **Crie sua senha**, e quem decide a
 * admissão é o banco. Token ilegível, sem `amr` ou com outro método (senha, renovação, TOTP) não conta.
 */
export function isEmailLinkSession(accessToken: string | null | undefined): boolean {
  const amr = accessToken ? tokenClaims(accessToken)?.amr : undefined;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry: unknown) => {
    const method = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>).method : undefined;
    return typeof method === 'string' && (EMAIL_LINK_METHODS as readonly string[]).includes(method);
  });
}

/**
 * Cria a senha da conta numa sessão aberta pelo link do e-mail, antes do aceite do convite ou da criação da empresa
 * (reforço do item 1.1), e encerra as outras sessões da conta.
 *
 * A senha escolhida por quem criou a conta antes do dono do e-mail já foi descartada no banco, na confirmação por link
 * (gatilho discard_unproven_password): esta é a primeira senha da conta, ou a que a pessoa já tinha criado depois de
 * provar o e-mail. A senha que já era a da conta volta com same_password e é aceita: quem a digitou já a conhece. A
 * troca de senha encerra as outras sessões no próprio Auth; o `signOut({ scope: 'others' })` cobre a senha repetida.
 *
 * Devolve a mensagem em pt-BR da falha, ou null quando a conta ficou com esta senha e só esta sessão.
 */
export async function setAccountPassword(password: string): Promise<string | null> {
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error && authErrorCode(error) !== 'same_password')
      return authErrorMessage(error, { context: 'reset_password' });
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
    if (signOutError) return authErrorMessage(signOutError, { context: 'reset_password' });
    return null;
  } catch (error) {
    return authErrorMessage(error, { context: 'reset_password' });
  }
}
