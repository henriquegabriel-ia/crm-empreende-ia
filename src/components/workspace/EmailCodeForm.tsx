import { useId, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Label } from '@/components/ui/label';
import { authErrorMessage } from '@/lib/auth-errors';
import { EMAIL_CODE, normalizeEmailCode } from '@/lib/email-link';

interface EmailCodeFormProps {
  /** Endereço para onde o link e o código foram enviados. */
  email: string;
}

/**
 * Código do e-mail de confirmação ou de link de acesso (revisão de 13/10/2026; docs/arquitetura/1.1.md, seção
 * 16.21), no aviso de link enviado. Abre a sessão no aparelho em que a pessoa pediu o link, também quando ela leu o
 * e-mail em outro: `verifyOtp` com o tipo `email`, que o Auth confere contra o token da confirmação e o do link de
 * acesso. A confirmação e a sessão nascem no mesmo pedido, com o método `otp`, como no link (a prova do e-mail é gravada
 * do mesmo jeito). Com a sessão aberta, a tela segue sozinha: a entrada leva ao destino, e o aceite ou a criação da
 * empresa mostram "Crie sua senha".
 */
export function EmailCodeForm({ email }: EmailCodeFormProps) {
  const id = useId();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = normalizeEmailCode(code);
    if (!EMAIL_CODE.test(token)) {
      setError('Digite só os números do código que veio no e-mail (de 6 a 10 dígitos).');
      return;
    }
    setError('');
    setVerifying(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      if (verifyError) setError(authErrorMessage(verifyError, { context: 'email_code' }));
    } catch (verifyError) {
      setError(authErrorMessage(verifyError, { context: 'email_code' }));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="w-full space-y-2 text-left">
      <Label htmlFor={`${id}-code`}>Código do e-mail</Label>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        Abriu o e-mail em outro aparelho? Digite aqui o código que veio nele.
      </p>
      <Input
        id={`${id}-code`}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={14}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
        aria-invalid={error ? true : undefined}
        disabled={verifying}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary" className="w-full" disabled={verifying}>
        {verifying ? 'Verificando…' : 'Entrar com o código'}
      </Button>
    </form>
  );
}
