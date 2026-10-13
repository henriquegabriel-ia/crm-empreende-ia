import { useId, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Label } from '@/components/ui/label';
import Wordmark from '@/components/brand/Wordmark';
import { ReceivedInvite } from '@/components/workspace/ReceivedInvite';
import { INSTANCE_STATUS_KEY, useInstanceStatus } from '@/hooks/useInstanceStatus';
import { claimAccountPassword } from '@/lib/account-password';
import { INCOMPLETE_INVITE_MESSAGE, normalizeInvitationId } from '@/lib/invite-link';
import { authPath, DEFAULT_AFTER_LOGIN, safeNextPath } from '@/lib/next-path';
import { rpcRefusalMessage } from '@/lib/rpc-errors';

// Recusas de create_workspace e accept_invitation (supabase/migrations/20261012100000_single_company_admission.sql)
// que mudam o que a tela oferece.
const COMPANY_EXISTS = 'Este CRM já tem uma empresa';
const INVITATION_NOT_FOUND = 'Convite não encontrado';

/**
 * Conta com sessão e sem organização (item 1.1): aceita o convite do link (?invite=), cria a empresa enquanto a
 * instância não tem nenhuma (decisão D6: o primeiro cadastro fica com o papel de Dono) ou, com a empresa criada, explica
 * que falta o convite da equipe. Se a leitura da instância falha, pede para tentar de novo em vez de supor que ela está
 * vazia; só o banco sem a migração (função ausente) mantém o formulário de criar de antes do item.
 * Antes do aceite e da criação da empresa, a pessoa confirma a senha da conta (claimAccountPassword): outra pessoa pode
 * ter criado a conta deste e-mail antes dela, com uma senha própria que o Auth mantém.
 */
export function WorkspaceSetup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const nameHintId = useId();
  const passwordHintId = useId();
  const inviteParam = params.get('invite');
  const invite = normalizeInvitationId(inviteParam);
  const next = safeNextPath(params.get('next'));
  const { user, refreshProfile, signOut } = useAuth();
  const { hasOrganization, checking, readFailed, rechecking, refresh } = useInstanceStatus();
  const [name, setName] = useState(''),
    [password, setPassword] = useState(''),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [notFound, setNotFound] = useState(false),
    // O banco recusou criar a empresa porque ela já existe. `sawEmpty` diz se a última leitura mostrava a instância
    // vazia: só então a tela afirma que outra pessoa criou a empresa enquanto esta tela estava aberta.
    [refused, setRefused] = useState<{ sawEmpty: boolean } | null>(null);
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

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setError('');
    setNotFound(false);
    setSaving(true);
    try {
      const passwordError = await claimAccountPassword(password);
      if (passwordError) {
        setError(passwordError);
        return;
      }
      const result = await crmDb.rpc('accept_invitation', { p_invitation_id: invite });
      if (result.error) {
        const message = rpcRefusalMessage(
          result.error,
          'Não foi possível aceitar o convite. Verifique a conexão e tente novamente.',
        );
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
      const passwordError = await claimAccountPassword(password);
      if (passwordError) {
        setError(passwordError);
        return;
      }
      const result = await crmDb.rpc('create_workspace', { p_name: name.trim() });
      if (result.error) {
        if (result.error.message?.startsWith(COMPANY_EXISTS)) {
          setRefused({ sawEmpty: hasOrganization === false });
          void queryClient.invalidateQueries({ queryKey: INSTANCE_STATUS_KEY });
          return;
        }
        setError(
          rpcRefusalMessage(result.error, 'Não foi possível criar a empresa. O nome foi preservado; tente novamente.'),
        );
        return;
      }
      await finish();
    } catch {
      setError('Não foi possível criar a empresa. O nome foi preservado; tente novamente.');
    } finally {
      setSaving(false);
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
  // Mesmo campo no aceite e na criação da empresa: a senha passa a ser só a de quem abriu o link de confirmação.
  const passwordField = (
    <div className="space-y-2">
      <Label htmlFor="account-password">Senha da conta</Label>
      <Input
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
        Por segurança, digite a senha que você vai usar para entrar: pode ser a mesma do cadastro. Só ela passa a valer,
        e outros acessos abertos com este e-mail são encerrados.
      </p>
    </div>
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
              <form onSubmit={create} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="workspace-name">Nome da empresa</Label>
                  <Input
                    id="workspace-name"
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
