import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PageScaffold } from '@/components/shell/PageScaffold';
import { Button } from '@/components/ds/button';
import { authPath, DEFAULT_AFTER_LOGIN, safeNextPath } from '@/lib/next-path';
export default function InvitationStatus() {
  const [params] = useSearchParams();
  const { signOut } = useAuth();
  const next = safeNextPath(params.get('next'));
  return (
    <PageScaffold title="Convite de equipe">
      <div className="mx-auto max-w-xl space-y-5 rounded-2xl border border-border p-6">
        <h2 className="text-xl font-semibold">Você já está na equipe</h2>
        <p className="text-sm text-muted-foreground">
          Este convite não foi usado, porque sua conta já faz parte deste CRM. Se o convite é para outra pessoa, saia e
          entre com a conta do e-mail convidado.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link to={next ?? DEFAULT_AFTER_LOGIN} replace>
              Continuar no meu CRM
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void signOut().then((success) => {
                if (success) window.location.assign(authPath('/', { invite: params.get('invite'), next }));
              })
            }
          >
            Entrar com outra conta
          </Button>
        </div>
      </div>
    </PageScaffold>
  );
}
