import { useState } from 'react';
import Wordmark from '@/components/brand/Wordmark';
import { Button } from '@/components/ds/button';
import type { AccessCheck } from '@/hooks/useCrmPermissions';

export interface AccessEndedProps {
  /** Data da desativação; nula para a conta que está na organização sem papel nenhum. */
  deactivatedAt: string | null;
  email: string | null | undefined;
  /** Relê o papel e diz o resultado; com o papel ativo, quem chama troca esta tela pelo CRM. */
  onCheckAgain: () => Promise<AccessCheck>;
  onSignOut: () => void;
}

const formatDay = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR') : null;
};

const CHECK_MESSAGES: Partial<Record<AccessCheck, string>> = {
  ended: 'Seu acesso continua encerrado. Se acha que é um engano, fale com quem administra o CRM.',
  failed: 'Não foi possível verificar agora. Confira a conexão e tente de novo.',
};

/**
 * "Seu acesso foi encerrado" (item 1.2; docs/arquitetura/1.2.md, seção 5.6): tela inteira, no lugar do CRM, para a
 * conta que um dono ou administrador desativou. No molde de "Falta o convite da sua equipe" (WorkspaceSetup), sem
 * menu, busca, Copiloto nem tours. "Sair da conta" leva à entrada sem guardar a tela atual; "Verificar de novo" relê o
 * papel e abre o CRM se a pessoa foi reativada. O rótulo "Verificando…" e o resultado vêm só do clique: as releituras
 * automáticas do papel (ao voltar para a aba e a cada 60 s) não mexem no botão.
 */
export function AccessEnded({ deactivatedAt, email, onCheckAgain, onSignOut }: AccessEndedProps) {
  const day = deactivatedAt ? formatDay(deactivatedAt) : null;
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<AccessCheck | null>(null);
  const checkAgain = async () => {
    if (checking) return;
    setChecking(true);
    setResult(null);
    try {
      setResult(await onCheckAgain());
    } catch {
      setResult('failed');
    } finally {
      setChecking(false);
    }
  };
  const message = result ? CHECK_MESSAGES[result] : undefined;
  return (
    <main className="eia-auth flex min-h-dvh items-center justify-center">
      {/* A margem lateral fica neste invólucro: abaixo de 1024 px, .eia-auth zera o padding do main. */}
      <div className="flex w-full justify-center px-4 py-8 sm:px-6">
        <div className="eia-auth-form-panel w-full max-w-lg space-y-6">
          <Wordmark variant="wordmark" />
          <div>
            <h1 className="text-2xl font-semibold">Seu acesso foi encerrado</h1>
            <p className="mt-2 text-muted-foreground">
              {deactivatedAt
                ? `Um dono ou administrador desativou o seu acesso a este CRM${day ? ` em ${day}` : ''}.`
                : 'Sua conta não tem um papel ativo neste CRM.'}{' '}
              Os registros continuam com a empresa, mas você não consegue mais consultá-los nem alterá-los. Se acha que
              é um engano, fale com quem administra o CRM.
            </p>
            {email && (
              <p className="mt-3 text-sm text-muted-foreground">
                Conta: <strong className="break-all font-medium text-foreground">{email}</strong>
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={onSignOut}>Sair da conta</Button>
            <Button variant="outline" onClick={() => void checkAgain()} disabled={checking}>
              {checking ? 'Verificando…' : 'Verificar de novo'}
            </Button>
          </div>
          {/* Sempre presente, para o leitor de tela anunciar o resultado de cada verificação. */}
          <p
            role="status"
            className={message ? (result === 'failed' ? 'text-sm text-destructive' : 'text-sm') : 'sr-only'}
          >
            {message}
          </p>
        </div>
      </div>
    </main>
  );
}
