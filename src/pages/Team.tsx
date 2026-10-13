import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useAuth } from '@/contexts/AuthContext';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { allCrmRows } from '@/lib/crm-pagination';
import { CRM_ROLE_LABELS, ROLE_DESCRIPTIONS, roleChangeAllowed, type CrmRole } from '@/lib/roles';
import { rpcRefusalMessage } from '@/lib/rpc-errors';
import {
  isActiveMember,
  loadTeamMembers,
  memberLabel,
  personName,
  portfolioSummary,
  type TeamMember,
} from '@/lib/team-members';
import { PageScaffold } from '@/components/shell/PageScaffold';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ds/dialog';
import { MemberDeactivateDialog } from '@/components/team/MemberDeactivateDialog';
import { MemberReactivateDialog } from '@/components/team/MemberReactivateDialog';
const roles: Record<string, string> = CRM_ROLE_LABELS;
// O que cada papel faz, nas mesmas palavras da Ajuda ("O que cada papel pode fazer?", em faq-content.ts).
const permissionCopy: Record<string, string> = ROLE_DESCRIPTIONS;
// Papéis oferecidos no convite. Dono só aparece para donos: create_invitation recusa o convite de dono feito por
// administrador.
const INVITE_ROLES = ['member', 'viewer', 'admin', 'owner'] as const;
const OWNER_INVITE_WARNING =
  'Dono tem todos os poderes, inclusive alterar o papel de outros donos. Convide como dono só sócios ou responsáveis pela empresa.';
const inviteLink = (id: string) => `${window.location.origin}/?invite=${id}`;
const INVITE_FAILURE = 'Não foi possível criar o convite. Seu preenchimento foi preservado.';
const ROLE_FAILURE =
  'Não foi possível alterar o papel. A organização precisa manter pelo menos um dono ativo, e somente donos podem alterar esse papel.';
const day = (value: string | null | undefined) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR') : '';
};
const byName = new Intl.Collator('pt-BR', { sensitivity: 'base' });
const sortByName = (people: TeamMember[]) =>
  [...people].sort((a, b) => byName.compare(personName(a), personName(b)) || a.id.localeCompare(b.id));
export default function Team() {
  const { profile } = useAuth();
  const orgId = profile?.org_id;
  const permissions = useCrmPermissions();
  const { canManage } = permissions;
  const isOwner = permissions.roles.includes('owner');
  const actorRole: CrmRole | null = isOwner ? 'owner' : canManage ? 'admin' : null;
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
  const roleErrorId = useId();
  const [change, setChange] = useState<{ id: string; name: string; role: string } | null>(null),
    [lastLink, setLastLink] = useState('');
  // Desativação e "Passar carteira" (o mesmo diálogo, em dois modos) e reativação, do item 1.2.
  const [portfolioDialog, setPortfolioDialog] = useState<{
    member: TeamMember;
    mode: 'deactivate' | 'transfer';
  } | null>(null);
  const [reactivating, setReactivating] = useState<TeamMember | null>(null);
  // A lista de membros é de todos os papéis: mostra a quem pedir outro acesso (donos e administradores). Cada pessoa
  // vem com a situação do papel: quem foi desativado fica numa lista à parte.
  const query = useQuery({
    queryKey: ['crm', orgId, 'team'],
    enabled: !!orgId,
    queryFn: () => loadTeamMembers(orgId!),
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
  // Passagens de carteira (portfolio_transfers), só para donos e administradores: a mais recente de cada pessoa
  // desativada aparece no cartão dela. Sem a leitura, o cartão mostra só a data.
  const transfers = useQuery({
    queryKey: ['crm', orgId, 'team', 'transfers'],
    enabled: !!orgId && canManage,
    queryFn: () =>
      allCrmRows((from, to) =>
        crmDb
          .from('portfolio_transfers')
          .select('*')
          .eq('org_id', orgId!)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
  });
  const members = query.data ?? [];
  const memberById = (id: string | null) => (id ? members.find((member) => member.id === id) : undefined);
  const active = sortByName(members.filter(isActiveMember));
  const deactivated = sortByName(members.filter((member) => !isActiveMember(member)));
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setInviteError('');
    try {
      // Só pela RPC (item 1.1): ela normaliza o e-mail, recusa quem já é da equipe (e orienta a reativar quem foi
      // desativado) e o convite válido repetido, e troca o convite expirado por um novo. A recusa vem em pt-BR e o
      // preenchimento fica.
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
      if (failure) {
        setRoleError(rpcRefusalMessage(failure, ROLE_FAILURE));
        return;
      }
      setChange(null);
      await qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success('Permissão atualizada');
    } catch (cause) {
      setRoleError(rpcRefusalMessage(cause, ROLE_FAILURE));
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
  // Convites pendentes que set_member_role revoga: os que o novo papel de quem os criou não permitiria criar
  // (item 1.2).
  const revokedByChange = change
    ? (invitations.data ?? []).filter(
        (invitation) =>
          !invitation.accepted_at &&
          invitation.invited_by === change.id &&
          !roleChangeAllowed(change.role, null, invitation.role),
      ).length
    : 0;
  // Última passagem de carteira de uma pessoa desativada, para donos e administradores. Com a caixa de contatos e
  // empresas desmarcada, eles ficaram com a pessoa: o resumo diz isso, em vez de "Sem carteira para passar".
  function transferSummary(member: TeamMember) {
    const last = transfers.data?.find((transfer) => transfer.from_user_id === member.id);
    if (!last) return null;
    const moved = portfolioSummary(last);
    const revoked = last.invitations
      ? ` ${last.invitations === 1 ? '1 convite revogado.' : `${last.invitations} convites revogados.`}`
      : '';
    const kept = last.accounts_transferred ? '' : ' Os contatos e as empresas ficaram com a pessoa.';
    if (!moved || !last.to_user_id)
      return last.accounts_transferred
        ? `Sem carteira para passar.${revoked}`
        : `Nada foi passado.${kept} Use “Passar carteira” para passar esses registros.${revoked}`;
    const by = last.performed_by ? ` por ${memberLabel(memberById(last.performed_by), last.performed_by)}` : '';
    const to = memberLabel(memberById(last.to_user_id), last.to_user_id);
    return `Carteira passada${by} para ${to}: ${moved}.${kept}${revoked}`;
  }
  return (
    <PageScaffold title="Equipe">
      <div className="mx-auto max-w-5xl space-y-6">
        <p className="text-sm text-muted-foreground">
          Pessoas e permissões da organização. Os dados comerciais são compartilhados entre os membros desta equipe.
        </p>
        {!permissions.loading && !canManage && (
          <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
            Convidar pessoas, alterar papéis e desativar acessos fica com donos e administradores. Se precisar de outro
            acesso, fale com um deles.
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
          <section className="space-y-3" aria-labelledby="team-active-title">
            <h2 id="team-active-title" className="text-lg font-semibold">
              Pessoas ativas ({active.length})
            </h2>
            {active.map((person) => {
              const current = person.role ?? 'viewer';
              const self = person.id === profile?.id;
              const touchesOwner = current !== 'owner' || isOwner;
              return (
                <article
                  key={person.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border p-5"
                >
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold">
                      {person.name || 'Pessoa sem nome'}
                      {self ? ' (você)' : ''}
                    </h3>
                    <p className="break-all text-sm text-muted-foreground">{person.email}</p>
                    <p className="mt-2 text-sm">{roles[current]}</p>
                    <p className="max-w-lg text-xs text-muted-foreground">{permissionCopy[current]}</p>
                  </div>
                  {canManage && touchesOwner && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setChange({ id: person.id, name: person.name || person.email, role: current })}
                      >
                        Alterar papel
                      </Button>
                      {/* Ninguém desativa o próprio acesso; o de um dono, só outro dono (deactivate_member). */}
                      {!self && (
                        <Button
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setPortfolioDialog({ member: person, mode: 'deactivate' })}
                        >
                          Desativar
                        </Button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}
        {query.data && deactivated.length > 0 && (
          <section className="space-y-3" aria-labelledby="team-deactivated-title">
            <h2 id="team-deactivated-title" className="text-lg font-semibold">
              Pessoas desativadas ({deactivated.length})
            </h2>
            <p className="text-sm text-muted-foreground">
              Quem foi desativado não entra mais no CRM. O nome continua no histórico, com a marca “(desativado)”.
            </p>
            {deactivated.map((person) => {
              // Só donos e administradores leem as passagens: para os demais, a consulta nem roda (e a RLS não
              // devolveria nada).
              const summary = transferSummary(person);
              return (
                <article
                  key={person.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-border p-5"
                >
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold">{memberLabel(person)}</h3>
                    <p className="break-all text-sm text-muted-foreground">{person.email}</p>
                    <p className="mt-2 text-sm">
                      {person.deactivatedAt ? `Acesso desativado em ${day(person.deactivatedAt)}` : 'Sem papel ativo'}
                    </p>
                    {summary && <p className="max-w-lg text-xs text-muted-foreground">{summary}</p>}
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      {(person.role !== 'owner' || isOwner) && (
                        <Button variant="outline" onClick={() => setReactivating(person)}>
                          Reativar
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => setPortfolioDialog({ member: person, mode: 'transfer' })}>
                        Passar carteira
                      </Button>
                    </div>
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
                  // Quem criou o convite: um convite sem autor veio do editor SQL (restore_owner, o break-glass).
                  const author = invitation.invited_by
                    ? `Criado por ${memberLabel(memberById(invitation.invited_by), invitation.invited_by)}`
                    : 'Criado pelo painel do Supabase';
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
                        <p className="text-xs text-muted-foreground">
                          {author} em {day(invitation.created_at)}
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
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg">
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
                    .filter((r) => r !== 'owner' || isOwner)
                    .map((r) => (
                      <option key={r} value={r}>
                        {roles[r]}
                      </option>
                    ))}
                </select>
              </label>
              <p className="text-sm text-muted-foreground">{permissionCopy[change.role]}</p>
              {revokedByChange > 0 && (
                <p role="status" className="rounded-xl border border-border p-3 text-sm">
                  {revokedByChange === 1
                    ? `O convite pendente criado por ${change.name} será revogado, porque o novo papel não permite criá-lo.`
                    : `Os ${revokedByChange} convites pendentes criados por ${change.name} serão revogados, porque o novo papel não permite criá-los.`}
                </p>
              )}
              {roleError && (
                <p id={roleErrorId} role="alert" className="text-sm text-destructive">
                  {roleError}
                </p>
              )}
              <Button
                onClick={() => void changeRole()}
                disabled={busy}
                aria-describedby={roleError ? roleErrorId : undefined}
              >
                {busy ? 'Salvando…' : 'Confirmar alteração'}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
      {portfolioDialog && orgId && (
        <MemberDeactivateDialog
          orgId={orgId}
          member={portfolioDialog.member}
          mode={portfolioDialog.mode}
          members={members}
          onClose={() => setPortfolioDialog(null)}
        />
      )}
      {reactivating && (
        <MemberReactivateDialog member={reactivating} actorRole={actorRole} onClose={() => setReactivating(null)} />
      )}
    </PageScaffold>
  );
}
