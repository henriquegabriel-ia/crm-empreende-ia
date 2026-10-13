import { useId, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ds/button';
import Wordmark from '@/components/brand/Wordmark';
import { AuthBrandPanel } from '@/components/brand/AuthBrandPanel';
import { BrandFooter } from '@/components/brand/BrandFooter';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { authErrorMessage } from '@/lib/auth-errors';
import { emailLinkFromHash, type EmailLink } from '@/lib/email-link';

/**
 * Link do e-mail do Auth com o toque da pessoa (revisão de 13/10/2026; docs/arquitetura/1.1.md, seção 16.21). Em
 * qualquer rota, uma URL com `#token_hash=…&type=…` (os links dos modelos de e-mail do CRM) mostra esta tela no lugar
 * da rota, e o token só é conferido no Auth quando a pessoa toca em "Continuar". Um filtro de segurança do e-mail que
 * abre o link antes dela só carrega a página e não gasta o token. Com a sessão aberta, a URL perde o token e a rota
 * pedida pelo link aparece: a entrada leva ao convite ou ao destino, e /reset-password pede a senha nova.
 */
export function EmailLinkGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const link = emailLinkFromHash(location.hash);
  if (!link) return <>{children}</>;
  return <EmailLinkScreen key={location.hash} link={link} />;
}

function EmailLinkScreen({ link }: { link: EmailLink }) {
  const location = useLocation();
  const navigate = useNavigate();
  const errorId = useId();
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const complete = 'tokenHash' in link ? link : null;
  const recovery = complete?.type === 'recovery';
  const context = recovery ? 'recovery' : 'redirect';

  // A tela de entrada, sem o token: na raiz, com o convite e o destino que o link trazia.
  const toLogin = () =>
    navigate({ pathname: '/', search: location.pathname === '/' ? location.search : '' }, { replace: true });

  async function proceed() {
    if (!complete) return;
    setError('');
    setVerifying(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: complete.tokenHash,
        type: complete.type,
      });
      if (verifyError) {
        setError(authErrorMessage(verifyError, { context }));
        setVerifying(false);
        return;
      }
      // Sessão aberta: a URL perde o token, e a rota pedida pelo link aparece no lugar desta tela.
      navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    } catch (verifyError) {
      setError(authErrorMessage(verifyError, { context }));
      setVerifying(false);
    }
  }

  const title = !complete ? 'Link incompleto' : recovery ? 'Redefinir senha' : 'Entrar no CRM';
  return (
    <div className="eia-auth flex min-h-screen">
      <AuthBrandPanel recovery={recovery} />

      <div className="eia-auth-form relative flex flex-1 items-center justify-center px-6 py-12">
        <ThemeToggle className="absolute right-6 top-6" />
        <main className="eia-auth-form-panel w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <Wordmark variant="wordmark" />
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
          {complete ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {recovery
                  ? 'Você abriu o link para redefinir a senha. Use “Continuar” para escolher a senha nova.'
                  : 'Você abriu o link enviado ao seu e-mail. Use “Continuar” para entrar no CRM.'}
              </p>
              <p className="mt-4 rounded-xl border border-border bg-muted/30 p-4 text-sm text-foreground">
                O link só é usado quando você aperta o botão. Assim, os filtros de segurança do e-mail, que abrem os
                links antes de você, não o gastam.
              </p>
            </>
          ) : (
            <p role="alert" className="mt-4 rounded-xl border border-destructive/50 p-4 text-sm text-foreground">
              O endereço deste link está incompleto. Abra de novo o link do e-mail ou copie o endereço inteiro. Se não
              der certo, peça um novo link na tela de entrada.
            </p>
          )}

          <div className="mt-6 space-y-3">
            {error && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {complete && (
              <Button
                size="lg"
                className="w-full"
                disabled={verifying}
                aria-describedby={error ? errorId : undefined}
                onClick={() => void proceed()}
              >
                {verifying ? 'Verificando…' : 'Continuar'}
              </Button>
            )}
            <Button
              variant={complete ? 'ghost' : 'default'}
              size={complete ? 'default' : 'lg'}
              className="w-full"
              disabled={verifying}
              onClick={toLogin}
            >
              Ir para a tela de entrada
            </Button>
          </div>
          <BrandFooter />
        </main>
      </div>
    </div>
  );
}
