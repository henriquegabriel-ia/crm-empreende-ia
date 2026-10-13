import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, backendConfigured } from '@/integrations/supabase/client';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ds/tabs';
import { Mail } from 'lucide-react';
import Wordmark from '@/components/brand/Wordmark';
import { AuthBrandPanel } from '@/components/brand/AuthBrandPanel';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { ReceivedInvite } from '@/components/workspace/ReceivedInvite';
import { useToast } from '@/hooks/use-toast';
import { useInstanceStatus } from '@/hooks/useInstanceStatus';
import { useAuth } from '@/contexts/AuthContext';
import { authErrorMessage, authRedirectError } from '@/lib/auth-errors';
import { INCOMPLETE_INVITE_MESSAGE, normalizeInvitationId } from '@/lib/invite-link';
import { authPath, DEFAULT_AFTER_LOGIN, safeNextPath } from '@/lib/next-path';

type Tab = 'login' | 'signup' | 'magic';
/**
 * Estados da entrada (item 1.1; docs/arquitetura/1.1.md, seção 5.1): verificando a instância, primeiro acesso (sem
 * empresa, o primeiro cadastro cria a empresa), convite recebido, entrada só por convite e sem leitura (banco sem a
 * migração ou falha de rede: a tela segue como antes, e o banco continua barrando o cadastro).
 */
type EntryMode = 'checking' | 'first_access' | 'invited' | 'invite_only' | 'unknown';
const INITIAL_TAB: Record<EntryMode, Tab> = {
  checking: 'login',
  first_access: 'signup',
  invited: 'signup',
  invite_only: 'login',
  unknown: 'login',
};
const ALREADY_REGISTERED = 'Este e-mail já tem conta. Entre na aba “Entrar” ou use “Esqueceu a senha?”.';

function SentPanel({ title, email, children }: { title: string; email: string; children?: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Mail className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 break-words text-sm text-muted-foreground">
        Enviamos um link para <strong className="font-medium text-foreground">{email}</strong>. {children}
      </p>
    </div>
  );
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [signupSentTo, setSignupSentTo] = useState('');
  const [chosenTab, setChosenTab] = useState<Tab | null>(null);
  const [formError, setFormError] = useState<{ tab: Tab; message: string } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const errorId = useId();
  const inviteParam = params.get('invite');
  // Só um ID completo vale como convite; um link cortado mostra o aviso em vez de chamar o banco.
  const invite = normalizeInvitationId(inviteParam);
  // Deep link guardado pelo AppLayout (?next=): só caminhos internos. Com convite, o destino passa pelo aceite, que
  // também explica um link de convite cortado.
  const next = safeNextPath(params.get('next'));
  const destination = inviteParam ? authPath('/invite', { invite: inviteParam, next }) : (next ?? DEFAULT_AFTER_LOGIN);
  // O link enviado por e-mail (cadastro e acesso sem senha) volta para esta tela com o convite e o destino.
  const emailRedirectTo = `${window.location.origin}${authPath('/', { invite, next })}`;
  const { toast } = useToast();
  const { user } = useAuth();
  const { hasOrganization, checking, refresh } = useInstanceStatus();
  const mode: EntryMode = invite
    ? 'invited'
    : checking
      ? 'checking'
      : hasOrganization === false
        ? 'first_access'
        : hasOrganization === true
          ? 'invite_only'
          : 'unknown';
  // Com empresa criada e sem convite, o "Link por e-mail" só entra em conta existente: não cria conta nova.
  const shouldCreateUser = Boolean(invite) || hasOrganization !== true;
  const tab = chosenTab ?? INITIAL_TAB[mode];
  // Link expirado ou já usado: o Auth volta para cá com o erro na URL (fragmento ou consulta), lido uma vez.
  const [redirectError] = useState(() => {
    const found = authRedirectError(window.location);
    return found ? authErrorMessage(found, { context: 'redirect' }) : null;
  });
  const cleanedUrl = useRef(false);

  useEffect(() => {
    if (user) navigate(destination, { replace: true });
  }, [user, navigate, destination]);

  // Tira o erro da URL (mantendo convite e destino), para não reaparecer ao recarregar.
  useEffect(() => {
    if (!redirectError || cleanedUrl.current) return;
    cleanedUrl.current = true;
    navigate(authPath('/', { invite: inviteParam, next }), { replace: true });
  }, [redirectError, navigate, inviteParam, next]);

  // Sem formulário de cadastro, a aba "Cadastrar" abre o campo do link do convite (também quando a releitura mostra
  // que a instância passou a ser só por convite).
  useEffect(() => {
    if (mode === 'invite_only' && tab === 'signup') setInviteOpen(true);
  }, [mode, tab]);

  const fail = (target: Tab, message: string) => setFormError({ tab: target, message });
  const errorFor = (target: Tab) => (formError?.tab === target ? formError.message : '');
  const describedBy = (target: Tab) => (formError?.tab === target ? `${errorId}-${target}` : undefined);
  const start = (target: Tab) => {
    // A aba fica fixa durante o pedido: a releitura da instância pode mudar a aba inicial.
    setChosenTab(target);
    setFormError(null);
    setLoading(true);
  };
  // O portão de cadastro chega como uma falha genérica do Auth: a instância é relida antes de escolher a mensagem,
  // porque a empresa pode ter sido criada por outra pessoa enquanto a tela estava aberta.
  const inviteOnlyNow = async () => Boolean(invite) || (await refresh()) === true;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    start('login');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) fail('login', authErrorMessage(error, { context: 'login' }));
    else navigate(destination, { replace: true });
    setLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    start('signup');
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo,
        },
      });
      if (error) {
        fail('signup', authErrorMessage(error, { context: 'signup', inviteOnly: await inviteOnlyNow() }));
      } else if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        // Com a confirmação ligada, o Supabase responde assim (sem erro) quando o e-mail já tem conta confirmada.
        fail('signup', ALREADY_REGISTERED);
      } else if (data.session) {
        toast({ title: 'Conta criada com sucesso!' });
        navigate(destination, { replace: true });
      } else {
        setSignupSentTo(email);
        toast({ title: 'Conta criada!', description: 'Confira seu e-mail para confirmar o cadastro.' });
      }
    } catch (err: unknown) {
      fail('signup', authErrorMessage(err, { context: 'signup' }));
    }
    setLoading(false);
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    start('magic');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo,
        shouldCreateUser,
      },
    });
    if (error) {
      fail(
        'magic',
        authErrorMessage(error, { context: 'magic_link', shouldCreateUser, inviteOnly: await inviteOnlyNow() }),
      );
    } else {
      setMagicLinkSent(true);
      toast({ title: 'Link enviado!', description: 'Verifique seu e-mail.' });
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    setChosenTab('login');
    setFormError(null);
    if (!email) {
      fail('login', 'Digite seu e-mail no campo acima para receber o link de redefinição de senha.');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      fail('login', authErrorMessage(error, { context: 'recovery' }));
    } else {
      toast({ title: 'E-mail enviado!', description: 'Verifique seu e-mail para redefinir a senha.' });
    }
  };

  const openInvite = (id: string) => {
    setChosenTab(null);
    setFormError(null);
    setInviteOpen(false);
    navigate(authPath('/', { invite: id, next }));
  };

  const errorText = (target: Tab) =>
    errorFor(target) && (
      <p id={`${errorId}-${target}`} role="alert" className="text-sm text-destructive">
        {errorFor(target)}
      </p>
    );

  return (
    <div className="eia-auth flex min-h-screen">
      <AuthBrandPanel />

      {/* Coluna do formulário */}
      <div className="eia-auth-form relative flex flex-1 items-center justify-center px-6 py-12">
        <ThemeToggle className="absolute right-6 top-6" />
        <div className="eia-auth-form-panel w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <Wordmark variant="wordmark" />
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Acesse seu CRM</h2>
          <p className="mt-1 text-sm text-muted-foreground">Entre na sua conta para continuar.</p>

          {!backendConfigured && (
            <p role="status" className="mt-5 rounded-xl border border-border bg-muted p-4 text-sm">
              O ambiente exclusivo do CRM está em configuração. O acesso será liberado assim que a conexão estiver
              pronta.
            </p>
          )}
          {redirectError && (
            <p role="alert" className="mt-5 rounded-xl border border-destructive/50 p-4 text-sm text-foreground">
              {redirectError}
            </p>
          )}
          {inviteParam !== null && !invite && (
            <p role="alert" className="mt-5 rounded-xl border border-destructive/50 p-4 text-sm text-foreground">
              {INCOMPLETE_INVITE_MESSAGE}
            </p>
          )}
          <Tabs
            value={tab}
            onValueChange={(value) => {
              const selected = value as Tab;
              setChosenTab(selected);
              setFormError(null);
            }}
            className="mt-6"
          >
            <TabsList className="w-full">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Cadastrar</TabsTrigger>
              <TabsTrigger value="magic">Link por e-mail</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="login-email">E-mail</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Senha</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {errorText('login')}
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={loading || !backendConfigured}
                  aria-describedby={describedBy('login')}
                >
                  {loading ? 'Entrando...' : 'Entrar'}
                </Button>
                <button
                  type="button"
                  onClick={() => void handleForgotPassword()}
                  className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Esqueceu a senha?
                </button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              {mode === 'checking' ? (
                <p role="status" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
                  Verificando este CRM…
                </p>
              ) : signupSentTo ? (
                <SentPanel title="Confira seu e-mail" email={signupSentTo}>
                  Abra o link neste navegador para confirmar o cadastro e continuar.
                </SentPanel>
              ) : mode === 'invite_only' ? (
                <div className="space-y-4">
                  {errorText('signup')}
                  <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-foreground">
                    Este CRM aceita novas contas só por convite. Peça o link a quem administra a equipe.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSignUp} className="space-y-5">
                  {mode === 'first_access' && (
                    <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-foreground">
                      Este CRM ainda não tem empresa. A primeira conta cria a empresa e fica com o papel de Dono. Se não
                      é você quem vai administrar o CRM, não se cadastre: peça um convite.
                    </p>
                  )}
                  {mode === 'invited' && (
                    <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-foreground">
                      Você recebeu um convite. Crie sua conta com o e-mail convidado ou entre, se já tiver conta.
                    </p>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Nome</Label>
                    <Input
                      id="signup-name"
                      placeholder="Seu nome"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">E-mail</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="seu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Senha</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="Mínimo 6 caracteres"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                  {errorText('signup')}
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={loading || !backendConfigured}
                    aria-describedby={describedBy('signup')}
                  >
                    {loading ? 'Criando conta...' : 'Criar conta'}
                  </Button>
                </form>
              )}
            </TabsContent>

            <TabsContent value="magic">
              {magicLinkSent ? (
                <SentPanel title="Verifique seu e-mail" email={email} />
              ) : (
                <form onSubmit={handleMagicLink} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="magic-email">E-mail</Label>
                    <Input
                      id="magic-email"
                      type="email"
                      placeholder="seu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  {errorText('magic')}
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={loading || !backendConfigured}
                    aria-describedby={describedBy('magic')}
                  >
                    {loading ? 'Enviando...' : 'Enviar link de acesso'}
                  </Button>
                </form>
              )}
            </TabsContent>
          </Tabs>

          <ReceivedInvite className="mt-6" open={inviteOpen} onOpenChange={setInviteOpen} onInvite={openInvite} />

          <p className="mt-8 text-center text-xs text-muted-foreground">Empreende.IA · CRM</p>
        </div>
      </div>
    </div>
  );
}
