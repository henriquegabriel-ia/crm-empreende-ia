import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { crmDb } from '@/integrations/supabase/crm-client';
import { Button } from '@/components/ds/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ds/dialog';
import { isOfflineRequestError, OFFLINE_REQUEST_MESSAGE } from '@/lib/offline';
import { countLabel } from '@/lib/record-links';
import { EDITOR_ROLES } from '@/lib/roles';
import { rpcRefusalMessage } from '@/lib/rpc-errors';
import {
  assignableMembers,
  memberLabel,
  personName,
  portfolioSummary,
  portfolioToPass,
  readPortfolioCounts,
  type PortfolioCounts,
  type TeamMember,
} from '@/lib/team-members';

export interface MemberDeactivateDialogProps {
  orgId: string;
  /** A pessoa: ativa no modo "deactivate"; já desativada no modo "transfer" ("Passar carteira"). */
  member: TeamMember;
  mode: 'deactivate' | 'transfer';
  /** A equipe inteira, para o seletor de quem recebe a carteira. */
  members: TeamMember[];
  onClose: () => void;
}

const nameOf = (member: TeamMember) => personName(member) || 'Esta pessoa';

/**
 * Desativação com a passagem da carteira (item 1.2; docs/arquitetura/1.2.md, seção 5.3), no padrão do DealDeleteDialog:
 * as contagens vêm antes (member_portfolio, a mesma definição da transferência), a confirmação espera por elas, e uma
 * recusa porque a carteira mudou atualiza as contagens para a pessoa confirmar de novo. As oportunidades em aberto e as
 * atividades pendentes passam sempre (D9); contatos e empresas, se a caixa ficar marcada. "Quem recebe a carteira" é
 * obrigatório quando há algo a passar e só oferece quem está ativo e edita (dono, administrador ou colaborador).
 * No modo "Passar carteira", vale o mesmo para o que ficou com uma pessoa já desativada.
 */
export function MemberDeactivateDialog({ orgId, member, mode, members, onClose }: MemberDeactivateDialogProps) {
  const cache = useQueryClient();
  const errorId = useId();
  const recipientId = useId();
  const accountsId = useId();
  const [recipient, setRecipient] = useState('');
  const [accounts, setAccounts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = nameOf(member);
  const deactivating = mode === 'deactivate';
  const queryKey = ['crm', orgId, 'member-portfolio', member.id];
  const portfolio = useQuery({
    queryKey,
    staleTime: 0,
    queryFn: async () => {
      const { data, error: failure } = await crmDb.rpc('member_portfolio', { p_user_id: member.id });
      if (failure) throw failure;
      const counts = readPortfolioCounts(data);
      // Sem as contagens, o diálogo não pode afirmar que não há carteira.
      if (!counts) throw new Error('Contagens da carteira indisponíveis.');
      return counts;
    },
  });
  const counts = portfolio.data;
  const recipients = assignableMembers(members).filter(
    (person) =>
      person.id !== member.id && person.role !== null && (EDITOR_ROLES as readonly string[]).includes(person.role),
  );
  const accountsCount = counts ? counts.contacts + counts.companies : 0;
  const dealsAndActivities = counts ? counts.deals + counts.activities : 0;
  // Em "Passar carteira" só com contatos e empresas, eles passam sempre: desmarcar a caixa não deixaria nada a passar e
  // travaria a confirmação (achado 5 da revisão do item 1.2). Na desativação, a caixa continua opcional (D9).
  const accountsOptional = deactivating || dealsAndActivities > 0;
  const passAccounts = accountsOptional ? accounts : true;
  const toPass = counts ? portfolioToPass(counts, passAccounts) : 0;
  const nothingAtAll = counts ? portfolioToPass(counts, true) === 0 : false;
  const recipientRequired = toPass > 0;
  const recipientMissing = recipientRequired && !recipient;
  const recipientName = (id: string) => nameOf(members.find((person) => person.id === id) ?? member);

  const confirm = async () => {
    if (busy || !counts || recipientMissing || (!deactivating && toPass === 0)) return;
    setBusy(true);
    setError('');
    try {
      const args = { p_user_id: member.id, p_transfer_accounts: passAccounts };
      const { data, error: failure } = deactivating
        ? await crmDb.rpc('deactivate_member', { ...args, ...(recipient ? { p_recipient_id: recipient } : {}) })
        : await crmDb.rpc('transfer_portfolio', { ...args, p_recipient_id: recipient });
      if (failure) {
        // Recusa sem destinatário com contagens: a carteira mudou desde que o diálogo abriu.
        const current = readPortfolioCounts((failure as { details?: unknown }).details);
        if (current) {
          cache.setQueryData<PortfolioCounts>(queryKey, current);
          setError(
            `A carteira de ${name} mudou desde que você abriu esta confirmação. Confira as contagens e confirme de novo.`,
          );
          return;
        }
        setError(refusalMessage(failure, deactivating, name));
        return;
      }
      const moved = readPortfolioCounts(data) ?? { ...counts, contacts: 0, companies: 0, invitations: 0 };
      const summary = portfolioSummary(moved);
      const received = summary && recipient ? ` ${recipientName(recipient)} recebeu ${summary}.` : '';
      const revoked = moved.invitations
        ? ` ${countLabel(moved.invitations, 'convite pendente revogado', 'convites pendentes revogados')}.`
        : '';
      // Frases sem gênero: o nome pode ser de qualquer pessoa ("O acesso de Ana foi desativado.").
      toast.success(deactivating ? `O acesso de ${name} foi desativado.${received}${revoked}` : received.trim());
      await cache.invalidateQueries({ queryKey: ['crm'] });
      onClose();
    } catch (cause) {
      setError(refusalMessage(cause, deactivating, name));
    } finally {
      setBusy(false);
    }
  };

  const items = counts
    ? [
        [counts.deals, 'oportunidade em aberto', 'oportunidades em aberto'],
        [counts.activities, 'atividade pendente', 'atividades pendentes'],
        [counts.contacts, 'contato', 'contatos'],
        [counts.companies, 'empresa', 'empresas'],
      ].filter(([count]) => Number(count) > 0)
    : [];
  // Os convites pendentes que a pessoa criou saem na desativação, haja ou não carteira a passar.
  const revokedInvitations =
    deactivating && counts && counts.invitations > 0 ? (
      <p>
        {counts.invitations === 1
          ? `1 convite pendente criado por ${name} será revogado.`
          : `${counts.invitations} convites pendentes criados por ${name} serão revogados.`}
      </p>
    ) : null;
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg">
        <DialogHeader>
          <DialogTitle>{deactivating ? `Desativar ${name}` : `Passar a carteira de ${name}`}</DialogTitle>
          <DialogDescription>
            {deactivating
              ? `${name} perde o acesso ao CRM na hora, mesmo que esteja com ele aberto. Oportunidades ganhas e perdidas, atividades concluídas e o histórico continuam no nome de ${name}, com a marca “(desativado)”.`
              : `O acesso de ${name} já está desativado. O que ainda está no nome de ${name} passa para a pessoa escolhida.`}
          </DialogDescription>
        </DialogHeader>
        {portfolio.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Contando a carteira…
          </p>
        ) : portfolio.isError ? (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-destructive">Não foi possível contar a carteira.</p>
            <Button variant="outline" size="sm" onClick={() => void portfolio.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : counts && nothingAtAll ? (
          <div className="space-y-4 text-sm">
            <p>
              {deactivating
                ? `${name} não tem oportunidades em aberto, atividades pendentes, contatos nem empresas.`
                : `${name} não tem mais carteira para passar.`}
            </p>
            {revokedInvitations}
          </div>
        ) : (
          counts && (
            <div className="space-y-4 text-sm">
              <div>
                <p className="font-medium">Carteira de {name}</p>
                <ul aria-label={`Carteira de ${name}`} className="mt-1 list-disc space-y-0.5 pl-5">
                  {items.map(([count, singular, plural]) => (
                    <li key={String(plural)}>{countLabel(Number(count), String(singular), String(plural))}</li>
                  ))}
                </ul>
              </div>
              {accountsCount > 0 && !accountsOptional && (
                <p>
                  Passam os contatos e as empresas (
                  {portfolioSummary({
                    deals: 0,
                    activities: 0,
                    contacts: counts.contacts,
                    companies: counts.companies,
                  })}
                  ).
                </p>
              )}
              {accountsCount > 0 && accountsOptional && (
                <div className="space-y-1">
                  <div className="flex items-start gap-2">
                    <input
                      id={accountsId}
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      checked={accounts}
                      disabled={busy}
                      onChange={(event) => setAccounts(event.target.checked)}
                    />
                    <label htmlFor={accountsId}>
                      Passar também os contatos e as empresas (
                      {portfolioSummary({
                        deals: 0,
                        activities: 0,
                        contacts: counts.contacts,
                        companies: counts.companies,
                      })}
                      )
                    </label>
                  </div>
                  {!accounts && (
                    <p className="text-muted-foreground">
                      Os contatos e as empresas continuam com {name}, que aparece como responsável com “(desativado)”,
                      até alguém trocar o responsável ou usar “Passar carteira”{deactivating ? '' : ' de novo'}.
                    </p>
                  )}
                </div>
              )}
              {toPass > 0 && (
                <div className="space-y-1">
                  <label htmlFor={recipientId} className="font-medium">
                    Quem recebe a carteira *
                  </label>
                  <select
                    id={recipientId}
                    className="h-11 w-full rounded-xl border border-input bg-background px-3"
                    value={recipient}
                    disabled={busy}
                    required
                    aria-describedby={`${recipientId}-hint`}
                    onChange={(event) => setRecipient(event.target.value)}
                  >
                    <option value="">Escolha uma pessoa</option>
                    {recipients.map((person) => (
                      <option key={person.id} value={person.id}>
                        {memberLabel(person)}
                      </option>
                    ))}
                  </select>
                  <p id={`${recipientId}-hint`} className="text-muted-foreground">
                    {dealsAndActivities > 0
                      ? `Recebe as oportunidades em aberto e as atividades pendentes${passAccounts && accountsCount > 0 ? ', e também os contatos e as empresas' : ''}.`
                      : 'Recebe os contatos e as empresas.'}{' '}
                    Só pessoas ativas que editam (dono, administrador ou colaborador).
                  </p>
                  {!recipients.length && (
                    <p className="text-destructive">
                      Ninguém ativo pode receber a carteira. Reative ou convide alguém que edite antes.
                    </p>
                  )}
                </div>
              )}
              {revokedInvitations}
            </div>
          )
        )}
        {error && (
          <p id={errorId} role="alert" className="rounded-xl border border-destructive p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {!deactivating && nothingAtAll ? 'Fechar' : 'Cancelar'}
          </Button>
          {(deactivating || !nothingAtAll) && (
            <Button
              variant={deactivating ? 'destructive' : 'default'}
              disabled={busy || !counts || recipientMissing || (!deactivating && toPass === 0)}
              aria-describedby={error ? errorId : undefined}
              onClick={() => void confirm()}
            >
              {busy ? 'Aguarde…' : deactivating ? 'Confirmar desativação' : 'Confirmar passagem'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Recusas em pt-BR: a do banco como está; impasse, tempo-limite e conexão com a mensagem própria. */
function refusalMessage(error: unknown, deactivating: boolean, name: string) {
  if (isOfflineRequestError(error)) return OFFLINE_REQUEST_MESSAGE;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === '40P01') return 'Outra gravação aconteceu ao mesmo tempo. Tente de novo.';
  if (code === '57014') return 'A passagem da carteira demorou demais e nada foi alterado. Tente de novo.';
  return rpcRefusalMessage(
    error,
    deactivating
      ? `Não foi possível desativar ${name}. Tente novamente.`
      : 'Não foi possível passar a carteira. Tente novamente.',
  );
}
