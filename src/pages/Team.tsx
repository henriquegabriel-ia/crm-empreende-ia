import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useAuth } from '@/contexts/AuthContext';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { allCrmRows } from '@/lib/crm-pagination';
import { CRM_ROLE_LABELS } from '@/lib/roles';
import { rpcRefusalMessage } from '@/lib/rpc-errors';
import { PageScaffold } from '@/components/shell/PageScaffold';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ds/dialog';
const roles: Record<string, string> = CRM_ROLE_LABELS;
const permissionCopy: Record<string, string> = {
  owner: 'Gerencia equipe, organização e todos os registros.',
  admin: 'Gerencia equipe e organização. Não altera o papel de donos.',
  member: 'Consulta e altera os registros comerciais da organização.',
  viewer: 'Consulta registros. Não altera dados nem configurações.',
};
// Papéis oferecidos no convite. Dono só aparece para donos: create_invitation recusa o convite de dono feito por
// administrador.
const INVITE_ROLES = ['member', 'viewer', 'admin', 'owner'] as const;
const OWNER_INVITE_WARNING =
  'Dono tem todos os poderes, inclusive alterar o papel de outros donos. Convide como dono só sócios ou responsáveis pela empresa.';
const inviteLink = (id: string) => `${window.location.origin}/?invite=${id}`;
const INVITE_FAILURE = 'Não foi possível criar o convite. Seu preenchimento foi preservado.';
export default function Team() {
  const { profile } = useAuth();
  const orgId = profile?.org_id;
  const permissions = useCrmPermissions();
  const { canManage } = permissions;
  const isOwner = permissions.roles.includes('owner');
  const qc = useQueryClient();
  const [email, setEmail] = useState(''),
    [role, setRole] = useState('member'),
    [busy, setBusy] = useState(false),
    // Cada erro aparece junto da ação que o causou (no celular, um alerta no topo ficaria fora da tela): o do convite
    // abaixo do formulário, o de "Gerar novo link" e "Revogar" sobre a lista de convites e o de "Alterar papel" no
    // diálogo.
    [inviteError, setInviteError] = useState(''),
    [listError, setListError] = useState(''),
    [roleError, setRoleError] = useState('');
  const inviteErrorId = useId();
  const [change, setChange] = useState<{ id: string; name: string; role: string } | null>(null),
    [lastLink, setLastLink] = useState('');
  // A lista de membros é de todos os papéis: mostra a quem pedir outro acesso (donos e administradores).
  const query = useQuery({
    queryKey: ['crm', orgId, 'team'],
    enabled: !!orgId,
    queryFn: async () => {
      const [people, memberRoles] = await Promise.all([
        allCrmRows((from, to) => crmDb.from('profiles').select('*').eq('org_id', orgId!).order('id').range(from, to)),
        allCrmRows((from, to) => crmDb.from('user_roles').select('*').eq('org_id', orgId!).order('id').range(from, to)),
      ]);
      return { people, memberRoles };
    },
  });
  // Convites (e-mails e links) só são lidos por quem os gerencia, e o convite de dono só por donos (RLS do item 1.1);
  // os demais papéis veem a equipe em modo leitura.
  const invitations = useQuery({
    queryKey: ['crm', orgId, 'team', 'invitations'],
    enabled: !!orgId && canManage,
    queryFn: () =>
      allCrmRows((from, to) =>
        crmDb
          .from('invitations')
          .select('*')
          .eq('org_id', orgId!)
          .order('created_at', { ascending: false })
          .range(from, to),
      ),
  });
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setInviteError('');
    try {
      // Só pela RPC (item 1.1): ela normaliza o e-mail, recusa quem já é da equipe e o convite válido repetido, e troca
      // o convite expirado por um novo. A recusa vem em pt-BR e o preenchimento fica.
      const { data, error: failure } = await crmDb.rpc('create_invitation', { p_email: email, p_role: role });
      if (failure) {
        setInviteError(rpcRefusalMessage(failure, INVITE_FAILURE));
        return;
      }
      setLastLink(inviteLink(data));
      setEmail('');
      await qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success('Convite criado. Copie o link para compartilhar com a pessoa.');
    } catch {
      setInviteError(INVITE_FAILURE);
    } finally {
      setBusy(false);
    }
  }
  // Convite expirado: create_invitation apaga o antigo e cria outro, com link novo (o antigo deixa de valer).
  async function renew(invitation: { email: string; role: string }) {
    setBusy(true);
    setListError('');
    try {
      const { data, error: failure } = await crmDb.rpc('create_invitation', {
        p_email: invitation.email,
        p_role: invitation.role,
      });
      if (failure) {
        setListError(rpcRefusalMessage(failure, 'Não foi possível gerar o novo link. Tente novamente.'));
        return;
      }
      setLastLink(inviteLink(data));
      await qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success('Novo link gerado. Copie e envie à pessoa; o link anterior deixou de valer.');
    } catch {
      setListError('Não foi possível gerar o novo link. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }
  async function changeRole() {
    if (!change) return;
    setBusy(true);
    setRoleError('');
    try {
      const { error: failure } = await crmDb.rpc('set_member_role', { p_user_id: change.id, p_role: change.role });
      if (failure) throw failure;
      setChange(null);
      await qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success('Permissão atualizada');
    } catch {
      setRoleError(
        'Não foi possível alterar o papel. A organização precisa manter pelo menos um dono, e somente donos podem alterar esse papel.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancelInvitation(id: string) {
    setBusy(true);
    setListError('');
    try {
      const { error: failure } = await crmDb
        .from('invitations')
        .delete()
        .eq('id', id)
        .eq('org_id', orgId!)
        .select('id')
        .single();
      if (failure) throw failure;
      await qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success('Convite revogado');
    } catch {
      setListError('Não foi possível revogar o convite. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }
  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado');
    } catch {
      setLastLink(link);
      toast.info('Selecione e copie o link exibido.');
    }
  }
  return (
    <PageScaffold title="Equipe">
      <div className="mx-auto max-w-5xl space-y-6">
        <p className="text-sm text-muted-foreground">
          Pessoas e permissões da organização. Os dados comerciais são compartilhados entre os membros desta equipe.
        </p>
        {!permissions.loading && !canManage && (
          <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
            Convidar pessoas e alterar papéis fica com donos e administradores. Se precisar de outro acesso, fale com um
            deles.
          </p>
        )}
        {query.isPending && <p role="status">Carregando equipe…</p>}
        {query.isError && (
          <div role="alert">
            <p>Não foi possível carregar a equipe.</p>
            <Button onClick={() => void query.refetch()}>Tentar novamente</Button>
          </div>
        )}
        {query.data && (
          <section className="space-y-3" aria-label="Membros">
            {query.data.people.map((person) => {
              const current = query.data.memberRoles.find((r) => r.user_id === person.id)?.role ?? 'viewer';
              return (
                <article
                  key={person.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border p-5"
                >
                  <div className="min-w-0">
                    <h2 className="break-words font-semibold">
                      {person.name || 'Pessoa sem nome'}
                      {person.id === profile?.id ? ' (você)' : ''}
                    </h2>
                    <p className="break-all text-sm text-muted-foreground">{person.email}</p>
                    <p className="mt-2 text-sm">{roles[current]}</p>
                    <p className="max-w-lg text-xs text-muted-foreground">{permissionCopy[current]}</p>
                  </div>
                  {canManage && (current !== 'owner' || permissions.roles.includes('owner')) && (
                    <Button
                      variant="outline"
                      onClick={() => setChange({ id: person.id, name: person.name || person.email, role: current })}
                    >
                      Alterar papel
                    </Button>
                  )}
                </article>
              );
            })}
          </section>
        )}
        {canManage && (
          <section className="space-y-4 rounded-2xl border border-border p-5">
            <h2 className="text-lg font-semibold">Convidar uma pessoa</h2>
            <p className="text-sm text-muted-foreground">
              Crie um link válido por 7 dias e envie-o à pessoa: o CRM não manda o convite por e-mail. Só e-mails
              convidados criam conta: a pessoa abre o link, informa o e-mail convidado, abre o link de confirmação que
              chega nesse e-mail e cria a senha.
            </p>
            <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
              <Input
                type="email"
                aria-label="E-mail da pessoa"
                placeholder="pessoa@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-describedby={inviteError ? inviteErrorId : undefined}
              />
              <select
                aria-label="Papel do convite"
                className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {INVITE_ROLES.filter((r) => r !== 'owner' || isOwner).map((r) => (
                  <option value={r} key={r}>
                    {roles[r]}
                  </option>
                ))}
              </select>
              <Button disabled={busy} aria-describedby={inviteError ? inviteErrorId : undefined}>
                {busy ? 'Salvando…' : 'Criar convite'}
              </Button>
            </form>
            {inviteError && (
              <p id={inviteErrorId} role="alert" className="rounded-xl border border-destructive p-4 text-sm">
                {inviteError}
              </p>
            )}
            {role === 'owner' && <p className="text-sm text-muted-foreground">{OWNER_INVITE_WARNING}</p>}
            {lastLink && (
              <div className="space-y-2">
                <Input aria-label="Link do convite" value={lastLink} readOnly onFocus={(e) => e.target.select()} />
                <Button variant="outline" onClick={() => void copyLink(lastLink)}>
                  Copiar link
                </Button>
              </div>
            )}
            {invitations.isError && (
              <div role="alert" className="space-y-2 text-sm">
                <p>Não foi possível carregar os convites.</p>
                <Button variant="outline" onClick={() => void invitations.refetch()}>
                  Tentar novamente
                </Button>
              </div>
            )}
            {listError && (
              <p role="alert" className="rounded-xl border border-destructive p-4 text-sm">
                {listError}
              </p>
            )}
            <div className="space-y-3">
              {invitations.data
                ?.filter((i) => !i.accepted_at)
                .map((invitation) => {
                  const expired = Date.parse(invitation.expires_at) < Date.now();
                  return (
                    <div
                      key={invitation.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"
                    >
                      <div className="min-w-0">
                        <p className="break-all text-sm">{invitation.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {roles[invitation.role]} ·{' '}
                          {expired
                            ? 'Expirado'
                            : 'Válido até ' + new Date(invitation.expires_at).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {!expired ? (
                          <Button size="sm" variant="outline" onClick={() => void copyLink(inviteLink(invitation.id))}>
                            Copiar
                          </Button>
                        ) : (
                          // O link expirado não serve mais; só um dono renova o convite de dono (e só um dono o vê).
                          (invitation.role !== 'owner' || isOwner) && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void renew(invitation)}>
                              Gerar novo link
                            </Button>
                          )
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void cancelInvitation(invitation.id)}
                        >
                          Revogar
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        )}
      </div>
      <Dialog
        open={!!change}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setChange(null);
            setRoleError('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar permissão</DialogTitle>
            <DialogDescription>O novo papel se aplica ao acesso de {change?.name} nesta organização.</DialogDescription>
          </DialogHeader>
          {change && (
            <>
              <label className="space-y-2 text-sm">
                <span>Novo papel</span>
                <select
                  className="h-11 w-full rounded-xl border border-input bg-background px-3"
                  value={change.role}
                  onChange={(e) => setChange({ ...change, role: e.target.value })}
                >
                  {Object.keys(roles)
                    .filter((r) => r !== 'owner' || permissions.roles.includes('owner'))
                    .map((r) => (
                      <option key={r} value={r}>
                        {roles[r]}
                      </option>
                    ))}
                </select>
              </label>
              <p className="text-sm text-muted-foreground">{permissionCopy[change.role]}</p>
              {roleError && (
                <p role="alert" className="text-sm text-destructive">
                  {roleError}
                </p>
              )}
              <Button onClick={() => void changeRole()} disabled={busy}>
                {busy ? 'Salvando…' : 'Confirmar alteração'}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageScaffold>
  );
}
