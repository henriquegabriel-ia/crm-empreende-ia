import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireRole } from '@/components/layout/RequireRole';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { OfflineDetector } from '@/components/OfflineDetector';
import { EmailLinkGate } from '@/components/workspace/EmailLinkGate';
import { EDITOR_ROLES } from '@/lib/roles';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import NotFound from './pages/NotFound';

// Route-based code splitting
const InvitationStatus = lazy(() => import('./pages/InvitationStatus'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Activities = lazy(() => import('./pages/Activities'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Contacts = lazy(() => import('./pages/Contacts'));
const Companies = lazy(() => import('./pages/Companies'));
const Reports = lazy(() => import('./pages/Reports'));
const Automations = lazy(() => import('./pages/Automations'));
const Templates = lazy(() => import('./pages/Templates'));
const Settings = lazy(() => import('./pages/Settings'));
const Integrations = lazy(() => import('./pages/Integrations'));
const SecuritySettings = lazy(() => import('./pages/SecuritySettings'));
const Team = lazy(() => import('./pages/Team'));
const Pipeline = lazy(() => import('./pages/Pipeline'));

const Agenda = lazy(() => import('./pages/Agenda'));
const Financeiro = lazy(() => import('./pages/Financeiro'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

function SuspenseRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense
        fallback={
          <div role="status" className="p-6 text-muted-foreground">
            Carregando tela…
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <OfflineDetector />
          <BrowserRouter>
            <AuthProvider>
              {/* Link do e-mail do Auth (#token_hash=…): só é usado depois do toque em "Continuar", em qualquer rota. */}
              <EmailLinkGate>
                <Routes>
                  <Route path="/" element={<Login />} />
                  <Route path="/reset-password" element={<ResetPassword />} />

                  <Route element={<AppLayout />}>
                    <Route
                      path="/invite"
                      element={
                        <SuspenseRoute>
                          <InvitationStatus />
                        </SuspenseRoute>
                      }
                    />
                    <Route
                      path="/dashboard"
                      element={
                        <SuspenseRoute>
                          <Dashboard />
                        </SuspenseRoute>
                      }
                    />
                    <Route
                      path="/contacts"
                      element={
                        <SuspenseRoute>
                          <Contacts />
                        </SuspenseRoute>
                      }
                    />
                    <Route
                      path="/companies"
                      element={
                        <SuspenseRoute>
                          <Companies />
                        </SuspenseRoute>
                      }
                    />
                    <Route
                      path="/agenda"
                      element={
                        <SuspenseRoute>
                          <Agenda />
                        </SuspenseRoute>
                      }
                    />
                    <Route
                      path="/financeiro"
                      element={
                        <SuspenseRoute>
                          <Financeiro />
                        </SuspenseRoute>
                      }
                    />
                    <Route
                      path="/activities"
                      element={
                        <SuspenseRoute>
                          <Activities />
                        </SuspenseRoute>
                      }
                    />
                    <Route
                      path="/pipeline"
                      element={
                        <SuspenseRoute>
                          <Pipeline />
                        </SuspenseRoute>
                      }
                    />
                    <Route
                      path="/tasks"
                      element={
                        <SuspenseRoute>
                          <Tasks />
                        </SuspenseRoute>
                      }
                    />
                    <Route
                      path="/reports"
                      element={
                        <SuspenseRoute>
                          <Reports />
                        </SuspenseRoute>
                      }
                    />
                    {/* Aberta a todos os papéis: consultar regras e execuções explica as tarefas criadas sozinhas. */}
                    <Route
                      path="/automations"
                      element={
                        <SuspenseRoute>
                          <Automations />
                        </SuspenseRoute>
                      }
                    />
                    <Route
                      path="/templates"
                      element={
                        <SuspenseRoute>
                          <Templates />
                        </SuspenseRoute>
                      }
                    />
                    {/* Aberta a todos: Meu perfil e Preferências são de cada pessoa; o restante fica em modo leitura. */}
                    <Route
                      path="/settings"
                      element={
                        <SuspenseRoute>
                          <Settings />
                        </SuspenseRoute>
                      }
                    />
                    {/* Somente leitura não importa nem exporta: sem nada a fazer em Integrações. */}
                    <Route
                      path="/settings/integrations"
                      element={
                        <SuspenseRoute>
                          <RequireRole
                            roles={EDITOR_ROLES}
                            title="Integrações"
                            purpose="Integrações serve para importar contatos de planilhas, o que exige permissão de edição, e para exportar contatos e reuniões, o que fica com donos e administradores."
                          >
                            <Integrations />
                          </RequireRole>
                        </SuspenseRoute>
                      }
                    />
                    {/* Aberta a todos: encerrar as próprias sessões vale para qualquer papel; o histórico é de gestores. */}
                    <Route
                      path="/settings/security"
                      element={
                        <SuspenseRoute>
                          <SecuritySettings />
                        </SuspenseRoute>
                      }
                    />
                    {/* Aberta a todos: a lista de membros mostra quem são os donos e administradores, a quem pedir outro
                      acesso. Convidar, revogar convites e alterar papéis ficam com eles, e só eles leem os convites. */}
                    <Route
                      path="/team"
                      element={
                        <SuspenseRoute>
                          <Team />
                        </SuspenseRoute>
                      }
                    />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </EmailLinkGate>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
