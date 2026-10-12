import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ds/button';
import { EmptyState } from '@/components/foundation/EmptyState';
import { LoadingState } from '@/components/foundation/LoadingState';
import { PageScaffold } from '@/components/shell/PageScaffold';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { CRM_ROLE_LABELS, isCrmRole, roleGroupList, type CrmRole } from '@/lib/roles';

interface RequireRoleProps {
  /** Papéis que usam a tela. */
  roles: readonly CrmRole[];
  /** Título da tela, mantido no topo da explicação. */
  title: string;
  /** Para que a tela serve, em uma frase: explica por que o papel atual não tem o que fazer nela. */
  purpose: string;
  children: ReactNode;
}

/**
 * Guarda de rota por papel, para telas em que um papel sem permissão não tem nada útil a fazer. Mostra uma tela
 * explicativa em vez da página, que nem é carregada. É orientação, não proteção: quem protege os dados é a RLS do
 * banco. Telas em que a consulta é útil (Equipe, Configurações, Automações, Segurança) continuam abertas em modo
 * leitura.
 */
export function RequireRole({ roles, title, purpose, children }: RequireRoleProps) {
  const permissions = useCrmPermissions();
  if (permissions.loading)
    return (
      <PageScaffold title={title}>
        <LoadingState label="Verificando seu acesso…" />
      </PageScaffold>
    );
  if (permissions.error)
    return (
      <PageScaffold title={title}>
        <EmptyState
          icon={AlertCircle}
          title="Não foi possível verificar seu acesso"
          description="Confira a conexão e tente novamente. Nada foi alterado."
          action={
            <Button onClick={permissions.refresh} disabled={permissions.refreshing}>
              {permissions.refreshing ? 'Verificando…' : 'Tentar novamente'}
            </Button>
          }
        />
      </PageScaffold>
    );
  if (permissions.roles.some((role) => isCrmRole(role) && roles.includes(role))) return <>{children}</>;
  const current = permissions.roles.find(isCrmRole);
  return (
    <PageScaffold title={title}>
      <EmptyState
        icon={ShieldAlert}
        title={`Esta tela é para ${roleGroupList(roles)}`}
        description={`${purpose} Seu papel nesta organização: ${current ? CRM_ROLE_LABELS[current] : 'sem papel definido'}. Se precisar deste acesso, fale com um dono ou administrador; a Equipe mostra quem são.`}
        action={
          <Button asChild>
            <Link to="/dashboard">Ir para Hoje</Link>
          </Button>
        }
      />
    </PageScaffold>
  );
}
