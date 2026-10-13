import { supabase } from '@/integrations/supabase/client';
import { authErrorCode, authErrorMessage } from '@/lib/auth-errors';

/**
 * Passo de segurança antes de a conta ganhar um papel (aceite do convite ou criação da empresa; item 1.1): grava a
 * senha que a pessoa digitou e encerra as outras sessões da conta.
 *
 * O portão de cadastro deixa qualquer pessoa criar a conta de um e-mail com convite pendente (e, na instância vazia,
 * de qualquer e-mail), com a senha que quiser, e o Supabase Auth não troca essa senha quando o dono do e-mail se
 * cadastra depois: só reenvia a confirmação. Sem este passo, quem criou a conta entraria nela com a própria senha
 * depois do aceite. A troca de senha encerra as outras sessões no próprio Auth; o `signOut({ scope: 'others' })` cobre
 * a senha que já era esta (same_password), em que nada muda: quem a digitou já a conhece.
 *
 * Devolve a mensagem em pt-BR da falha, ou null quando a conta ficou só com esta senha e esta sessão.
 */
export async function claimAccountPassword(password: string): Promise<string | null> {
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
