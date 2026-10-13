import { useState, useEffect, useMemo } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AppRail } from '@/components/shell/AppRail';
import { ShellContext } from '@/components/shell/ShellContext';
import { MobileBottomNav } from './MobileBottomNav';
import { RouteTransition } from '@/components/RouteTransition';
import { CommandPalette } from '@/components/CommandPalette';
import { AICopilot } from '@/components/crm/AICopilot';
import { CrmOnboardingProvider } from '@/components/onboarding/CrmOnboardingProvider';
import { WorkspaceSetup } from '@/components/workspace/WorkspaceSetup';
import { AccessEnded } from '@/components/workspace/AccessEnded';
import { Button } from '@/components/ds/button';
import { LoadingState } from '@/components/foundation/LoadingState';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { authPath } from '@/lib/next-path';

/**
 * Sem sessão, volta ao login guardando o destino (?next=), com replace para o Voltar não cair de novo aqui. Depois de
 * um Sair pedido nesta aba, vai ao login sem destino: num computador compartilhado, quem entrar em seguida abre Hoje,
 * e não a tela (nem a busca da URL) de quem saiu.
 */
function LoginRedirect({ keepDestination }: { keepDestination: boolean }) {
  const { pathname, search } = useLocation();
  return <Navigate to={authPath('/', { next: keepDestination ? pathname + search : null })} replace />;
}

export function AppLayout() {
  const [searchOpen, setSearchOpen] = useState(false);
  const { user, loading, profile, profileError, refreshProfile, signedOut, signOut } = useAuth();
  const isMobile = useIsMobile();
  // A porta do item 1.2: com o papel desativado (ou sem papel), a tela "Seu acesso foi encerrado" substitui o CRM, em
  // qualquer rota, inclusive /invite. O papel é relido ao voltar para a aba e a cada 60 s.
  const access = useCrmPermissions({ watchAccess: true });
  const queryClient = useQueryClient();
  const accessEnded = Boolean(user && profile?.org_id) && access.accessEnded;

  const shell = useMemo(() => ({ openSearch: () => setSearchOpen(true) }), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // O que estava na tela some da memória do navegador: as consultas do CRM saem do cache, menos a do papel, que a tela
  // usa para "Verificar de novo". Depois de uma reativação, as telas leem tudo de novo.
  useEffect(() => {
    if (!accessEnded) return;
    queryClient.removeQueries({ queryKey: ['crm'], predicate: (query) => query.queryKey[2] !== 'permissions' });
  }, [accessEnded, queryClient]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <LoadingState label="Carregando…" />
      </div>
    );
  }

  if (!user) return <LoginRedirect keepDestination={!signedOut} />;
  if (profileError)
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
        <p role="alert">{profileError}</p>
        <Button onClick={() => void refreshProfile()}>Tentar novamente</Button>
        <Button variant="ghost" onClick={() => void signOut()}>
          Sair
        </Button>
      </main>
    );
  if (!profile?.org_id) return <WorkspaceSetup />;
  if (accessEnded)
    return (
      <AccessEnded
        deactivatedAt={access.deactivatedAt}
        email={user.email ?? profile.email}
        onCheckAgain={access.recheck}
        onSignOut={() => void signOut()}
      />
    );

  return (
    <ShellContext.Provider value={shell}>
      <CrmOnboardingProvider>
        <div className="eia-shell flex w-full overflow-hidden">
          <AppRail />
          <main className="eia-workspace min-h-0 min-w-0 flex-1 pb-14 md:pb-0">
            <RouteTransition />
          </main>
        </div>
        {isMobile && <MobileBottomNav />}
        <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
        <AICopilot />
      </CrmOnboardingProvider>
    </ShellContext.Provider>
  );
}
