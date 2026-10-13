import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Label } from '@/components/ui/label';
import Wordmark from '@/components/brand/Wordmark';
import { LinkSentPanel } from '@/components/workspace/LinkSentPanel';
import { ReceivedInvite } from '@/components/workspace/ReceivedInvite';
import { INSTANCE_STATUS_KEY, useInstanceStatus } from '@/hooks/useInstanceStatus';
import { isEmailLinkSession, setAccountPassword } from '@/lib/account-password';
import { authErrorMessage } from '@/lib/auth-errors';
import { INCOMPLETE_INVITE_MESSAGE, normalizeInvitationId } from '@/lib/invite-link';
import { authPath, DEFAULT_AFTER_LOGIN, safeNextPath } from '@/lib/next-path';
import { rpcRefusalMessage } from '@/lib/rpc-errors';

// Recusas de create_workspace e accept_invitation (supabase/migrations/20261012100000_single_company_admission.sql e
// 20261012110000_admission_email_proof.sql) que mudam o que a tela oferece.
const COMPANY_EXISTS = 'Este CRM já tem uma empresa';
const INVITATION_NOT_FOUND = 'Convite não encontrado';
const EMAIL_PROOF_REFUSAL = 'confirme que o e-mail é seu';

/**
 * Conta com sessão e sem organização (item 1.1): aceita o convite do link (?invite=), cria a empresa enquanto a
 * instância não tem nenhuma (decisão D6: o primeiro cadastro fica com o papel de Dono) ou, com a empresa criada, explica
 * que falta o convite da equipe. Se a leitura da instância falha, pede para tentar de novo em vez de supor que ela está
 * vazia; só o banco sem a migração (função ausente) mantém o formulário de criar de antes do item.
 * A conta só ganha papel com a prova do e-mail (reforço do item 1.1; docs/arquitetura/1.1.md, seção 16.6): numa sessão
 * aberta pelo link do e-mail, a pessoa cria a senha antes do aceite ou da criação da empresa; numa sessão por senha, o
 * banco decide, e a conta sem a prova recebe o painel "Confirme que o e-mail é seu", que envia o link de acesso (e o
 * reenvia, se ele não chegar). O foco segue o painel que toma o lugar do botão apertado.
 */
export function WorkspaceSetup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const nameHintId = useId();
  const passwordHintId = useId();
  const proofErrorId = useId();
  const inviteParam = params.get('invite');
  const invite = normalizeInvitationId(inviteParam);
  const next = safeNextPath(params.get('next'));
  const { user, session, refreshProfile, signOut } = useAuth();
  // Sessão aberta pelo link do e-mail (amr do token): só nela a tela pede "Crie sua senha".
  const linkSession = isEmailLinkSession(session?.access_token);
  const { hasOrganization, checking, readFailed, rechecking, refresh } = useInstanceStatus();
  const [name, setName] = useState(''),
    [password, setPassword] = useState(''),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [notFound, setNotFound] = useState(false),
    // O banco recusou criar a empresa porque ela já existe. `sawEmpty` diz se a última leitura mostrava a instância
    // vazia: só então a tela afirma que outra pessoa criou a empresa enquanto esta tela estava aberta.
    [refused, setRefused] = useState<{ sawEmpty: boolean } | null>(null),
    // O banco pediu a prova do e-mail (sessão por senha de uma conta sem a prova): o formulário dá lugar ao envio do
    // link de acesso. Uma sessão aberta pelo link, nesta aba, volta ao formulário com "Crie sua senha".
    [proofNeeded, setProofNeeded] = useState(false),
    [proofSending, setProofSending] = useState(false),
    [proofError, setProofError] = useState(''),
    [proofSentTo, setProofSentTo] = useState(''),
    // O link foi pedido de novo pelo aviso de envio: o anterior deixa de valer.
    [proofResent, setProofResent] = useState(false);
  const showProof = proofNeeded && !linkSession;
  const proofTitleRef = useRef<HTMLHeadingElement>(null);
  const sentTitleRef = useRef<HTMLHeadingElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // O painel da prova toma o lugar do botão que tinha o foco (e o aviso de link enviado, o do botão de envio): o foco
  // vai para o título do que apareceu, e o leitor de tela anuncia a troca em vez de cair no início da página.
  useEffect(() => {
    if (showProof && !proofSentTo) proofTitleRef.current?.focus();
  }, [showProof, proofSentTo]);
  useEffect(() => {
    if (proofSentTo) sentTitleRef.current?.focus();
  }, [proofSentTo]);
  // A sessão passou a ser aberta pelo link (o código digitado no aviso de envio ou o link aberto em outra aba): o
  // formulário volta no lugar do aviso, e o foco vai para "Crie sua senha".
  useEffect(() => {
    if (proofNeeded && linkSession) passwordRef.current?.focus();
  }, [proofNeeded, linkSession]);
  const mode =
    inviteParam !== null
      ? invite
        ? 'accept'
        : 'incomplete_invite'
      : refused || hasOrganization === true
        ? 'missing_invite'
        : checking
          ? 'checking'
          : readFailed
            ? 'read_failed'
            : 'create';

  async function finish() {
    await refreshProfile();
    await queryClient.invalidateQueries({ queryKey: INSTANCE_STATUS_KEY });
    // O deep link que levou ao login (?next=) continua valendo depois de aceitar o convite ou criar a empresa.
    navigate(next ?? DEFAULT_AFTER_LOGIN, { replace: true });
  }

  // Na sessão aberta pelo link, a senha criada pela pessoa é gravada (e as outras sessões encerradas) antes da RPC.
  // Devolve false quando a tela deve parar, com a mensagem já mostrada.
  async function savePassword() {
    if (!linkSession) return true;
    const passwordError = await setAccountPassword(password);
    if (passwordError) setError(passwordError);
    return !passwordError;
  }

  // A recusa por falta da prova do e-mail troca o formulário pelo painel do link; as demais ficam no formulário.
  function refusedForProof(message: string) {
    if (!message.toLowerCase().includes(EMAIL_PROOF_REFUSAL)) return false;
    setProofNeeded(true);
    setProofError('');
    setProofSentTo('');
    setProofResent(false);
    return true;
  }

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setError('');
    setNotFound(false);
    setSaving(true);
    try {
      if (!(await savePassword())) return;
      const result = await crmDb.rpc('accept_invitation', { p_invitation_id: invite });
      if (result.error) {
        const message = rpcRefusalMessage(
          result.error,
          'Não foi possível aceitar o convite. Verifique a conexão e tente novamente.',
        );
        if (refusedForProof(message)) return;
        setError(message);
        setNotFound(message.startsWith(INVITATION_NOT_FOUND));
        return;
      }
      await finish();
    } catch {
      setError('Não foi possível aceitar o convite. Verifique a conexão e tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (!(await savePassword())) return;
      const result = await crmDb.rpc('create_workspace', { p_name: name.trim() });
      if (result.error) {
        if (result.error.message?.startsWith(COMPANY_EXISTS)) {
          setRefused({ sawEmpty: hasOrganization === false });
          void queryClient.invalidateQueries({ queryKey: INSTANCE_STATUS_KEY });
          return;
        }
        const message = rpcRefusalMessage(
          result.error,
          'Não foi possível criar a empresa. O nome foi preservado; tente novamente.',
        );
        if (refusedForProof(message)) return;
        setError(message);
        return;
      }
      await finish();
    } catch {
      setError('Não foi possível criar a empresa. O nome foi preservado; tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  // Link de acesso para a conta da sessão, sem criar conta: volta à raiz com o convite e o destino, e a entrada leva de
  // volta ao aceite (ou à criação da empresa) com a sessão aberta pelo link. O aviso de envio oferece pedir de novo, se
  // o e-mail não chegar; o limite de envio do Auth aparece como erro, abaixo do aviso.
  async function sendProofLink() {
    if (!user?.email) return;
    const again = Boolean(proofSentTo);
    setProofError('');
    setProofSending(true);
    try {
      const { error: linkError } = await supabase.auth.signInWithOtp({
        email: user.email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}${authPath('/', { invite, next })}`,
        },
      });
      if (linkError) setProofError(authErrorMessage(linkError, { context: 'magic_link', shouldCreateUser: false }));
      else {
        setProofSentTo(user.email);
        setProofResent(again);
      }
    } catch (linkError) {
      setProofError(authErrorMessage(linkError, { context: 'magic_link', shouldCreateUser: false }));
    } finally {
      setProofSending(false);
    }
  }

  const openInvite = (id: string) => navigate(authPath('/invite', { invite: id, next }));
  const signOutButton = (
    <Button variant="ghost" onClick={() => void signOut()}>
      Sair da conta
    </Button>
  );
  const withoutInvite = (
    <Link to="/dashboard" className="block text-sm text-primary underline-offset-4 hover:underline">
      Continuar sem este convite
    </Link>
  );
  // Mesmo campo no aceite e na criação da empresa, só na sessão aberta pelo link: quem entrou com senha já tem uma.
  // O campo de usuário escondido leva o e-mail da conta, para o gerenciador de senhas do navegador salvar a senha nova
  // com ele (sem esse campo, o Chrome e o Firefox tomariam o nome da empresa, ou nada, como usuário).
  const passwordField = linkSession && (
    <div>
      {/* Fora do espaçamento do campo: sr-only é posicionado e não ocupa lugar. */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        value={user?.email ?? ''}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
      <div className="space-y-2">
        <Label htmlFor="account-password">Crie sua senha</Label>
        <Input
          ref={passwordRef}
          id="account-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          placeholder="Mínimo 6 caracteres"
          aria-describedby={passwordHintId}
          disabled={saving}
        />
        <p id={passwordHintId} className="text-xs text-muted-foreground">
          Você entrou pelo link do e-mail. Crie a senha com que vai entrar nas próximas vezes. Se já tinha uma senha
          neste CRM, pode repeti-la.
        </p>
      </div>
    </div>
  );
  const proofErrorText = proofError && (
    <p id={proofErrorId} role="alert" className="text-sm text-destructive">
      {proofError}
    </p>
  );
  // A conta sem a prova do e-mail, numa sessão por senha: o aceite e a criação da empresa pedem o link de acesso.
  const proofPanel = (action: string) =>
    proofSentTo ? (
      <div className="space-y-3">
        <LinkSentPanel
          title="Confira seu e-mail"
          email={proofSentTo}
          again={proofResent}
          headingLevel="h2"
          headingRef={sentTitleRef}
          codeEmail={proofSentTo}
          action={
            <Button
              variant="outline"
              disabled={proofSending}
              aria-describedby={proofError ? proofErrorId : undefined}
              onClick={() => void sendProofLink()}
            >
              {proofSending ? 'Enviando…' : 'Enviar de novo'}
            </Button>
          }
        >
          {proofResent
            ? 'Abra-o neste navegador para continuar: o link e o código anteriores deixam de valer.'
            : 'Abra-o neste navegador para continuar.'}
        </LinkSentPanel>
        {proofErrorText}
      </div>
    ) : (
      <section aria-labelledby={`${proofErrorId}-title`} className="space-y-4 rounded-xl border border-border p-4">
        <div>
          {/* Recebe o foco quando o painel aparece; a explicação vai junto, pela descrição. */}
          <h2
            id={`${proofErrorId}-title`}
            ref={proofTitleRef}
            tabIndex={-1}
            aria-describedby={`${proofErrorId}-why`}
            className="text-base font-semibold text-foreground outline-none"
          >
            Confirme que o e-mail é seu
          </h2>
          <p id={`${proofErrorId}-why`} className="mt-2 text-sm text-muted-foreground">
            Por segurança, {action} exige entrar pelo link enviado ao seu e-mail. Enviaremos um link para{' '}
            <strong className="break-words font-medium text-foreground">{user?.email ?? 'o seu e-mail'}</strong>; abra-o
            para continuar.
          </p>
        </div>
        {proofErrorText}
        <Button
          className="w-full"
          disabled={proofSending || !user?.email}
          aria-describedby={proofError ? proofErrorId : undefined}
          onClick={() => void sendProofLink()}
        >
          {proofSending ? 'Enviando…' : 'Enviar link para o meu e-mail'}
        </Button>
      </section>
    );
  const acceptHeading = (
    <div>
      <h1 className="text-2xl font-semibold">Entre na sua equipe</h1>
      <p className="mt-2 text-muted-foreground">
        Aceite o convite com a conta do e-mail convidado para acessar o CRM da equipe.
      </p>
    </div>
  );

  return (
    <main className="eia-auth flex min-h-dvh items-center justify-center">
      {/* A margem lateral fica neste invólucro: abaixo de 1024 px, .eia-auth zera o padding do main. */}
      <div className="flex w-full justify-center px-4 py-8 sm:px-6">
        <div className="eia-auth-form-panel w-full max-w-lg space-y-6">
          <Wordmark variant="wordmark" />
          {mode === 'accept' && (
            <>
              {acceptHeading}
              {showProof ? (
                proofPanel('aceitar o convite')
              ) : (
                <form onSubmit={accept} className="space-y-4">
                  {passwordField}
                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <Button className="w-full" disabled={saving}>
                    {saving ? 'Salvando…' : 'Aceitar convite da equipe'}
                  </Button>
                </form>
              )}
              {notFound && withoutInvite}
              {signOutButton}
            </>
          )}
          {/* Link cortado: o aviso aparece ao abrir, como na tela de entrada, sem oferecer um aceite que não vai dar
              certo. */}
          {mode === 'incomplete_invite' && (
            <>
              {acceptHeading}
              <p role="alert" className="rounded-xl border border-destructive/50 p-4 text-sm text-foreground">
                {INCOMPLETE_INVITE_MESSAGE}
              </p>
              <ReceivedInvite defaultOpen onInvite={openInvite} />
              {withoutInvite}
              {signOutButton}
            </>
          )}
          {mode === 'checking' && (
            <p role="status" className="text-sm text-muted-foreground">
              Verificando este CRM…
            </p>
          )}
          {mode === 'read_failed' && (
            <>
              <div role="alert">
                <h1 className="text-2xl font-semibold">Não foi possível verificar este CRM</h1>
                <p className="mt-2 text-muted-foreground">
                  Confira a conexão e tente novamente. Se recebeu um convite, abra o link dele neste navegador ou cole-o
                  abaixo.
                </p>
              </div>
              <Button className="w-full" disabled={rechecking} onClick={() => void refresh()}>
                {rechecking ? 'Verificando…' : 'Tentar novamente'}
              </Button>
              <ReceivedInvite onInvite={openInvite} />
              {signOutButton}
            </>
          )}
          {mode === 'create' && (
            <>
              <div>
                <h1 className="text-2xl font-semibold">Seu negócio, seu CRM</h1>
                <p className="mt-2 text-muted-foreground">
                  {/* Sem a leitura da instância (banco sem a migração), a tela não afirma que ela está vazia. */}
                  {hasOrganization === false && 'Você é a primeira pessoa a entrar neste CRM. '}
                  Crie a empresa para começar: sua conta fica com o papel de Dono, e a equipe entra depois, por convite,
                  em Equipe.
                </p>
              </div>
              {showProof ? (
                proofPanel('criar a empresa')
              ) : (
                <form onSubmit={create} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="workspace-name">Nome da empresa</Label>
                    <Input
                      id="workspace-name"
                      autoComplete="organization"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      minLength={2}
                      maxLength={160}
                      placeholder="Nome da sua empresa"
                      aria-describedby={nameHintId}
                      disabled={saving}
                    />
                    {/* No resto do CRM, a empresa dona do CRM é a "organização"; "Empresas" são os clientes. */}
                    <p id={nameHintId} className="text-xs text-muted-foreground">
                      É o nome que a equipe vê no CRM. Você pode mudá-lo depois em Configurações, na aba Organização.
                    </p>
                  </div>
                  {passwordField}
                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <Button className="w-full" disabled={saving}>
                    {saving ? 'Salvando…' : 'Criar empresa'}
                  </Button>
                </form>
              )}
              {signOutButton}
            </>
          )}
          {mode === 'missing_invite' && (
            <>
              <div>
                <h1 className="text-2xl font-semibold">Falta o convite da sua equipe</h1>
                {refused?.sawEmpty && (
                  <p role="status" className="mt-2 text-sm font-medium text-foreground">
                    Outra pessoa criou a empresa deste CRM agora há pouco.
                  </p>
                )}
                <p className="mt-2 text-muted-foreground">
                  Este CRM já tem uma empresa, e a entrada é só por convite. Peça a quem administra o CRM um convite
                  para{' '}
                  <strong className="break-words font-medium text-foreground">{user?.email ?? 'o seu e-mail'}</strong>.
                  Quando receber o link, abra-o neste navegador ou cole-o abaixo.
                </p>
              </div>
              <ReceivedInvite defaultOpen onInvite={openInvite} />
              {signOutButton}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
