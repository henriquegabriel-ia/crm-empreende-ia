import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { crmDb } from '@/integrations/supabase/crm-client';
import { Button } from '@/components/ds/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ds/dialog';
import { CRM_ROLE_LABELS, CRM_ROLES, ROLE_DESCRIPTIONS, roleChangeAllowed, type CrmRole } from '@/lib/roles';
import { rpcRefusalMessage } from '@/lib/rpc-errors';
import { personName, type TeamMember } from '@/lib/team-members';

export interface MemberReactivateDialogProps {
  member: TeamMember;
  /** Papel ativo de quem reativa: só um dono reativa um dono ou dá o papel de Dono. */
  actorRole: CrmRole | null;
  onClose: () => void;
}

/**
 * Reativação (item 1.2; docs/arquitetura/1.2.md, seção 5.4): o papel guardado na desativação vem como padrão, com o que
 * ele faz, e as opções seguem a regra de reactivate_member (role_change_allowed no banco). A carteira que passou para
 * outra pessoa continua com ela.
 */
export function MemberReactivateDialog({ member, actorRole, onClose }: MemberReactivateDialogProps) {
  const cache = useQueryClient();
  const roleId = useId();
  const errorId = useId();
  const name = personName(member) || 'Esta pessoa';
  const options = CRM_ROLES.filter((role) => roleChangeAllowed(actorRole, member.role, role));
  // Sem papel guardado (o perfil sem papel, "Sem papel ativo" na Equipe), o padrão é o de menor privilégio: Somente
  // leitura, ou a última opção que quem reativa pode dar (achado 4 da revisão do item 1.2).
  const [role, setRole] = useState<CrmRole>(
    member.role && options.includes(member.role)
      ? member.role
      : options.includes('viewer')
        ? 'viewer'
        : (options[options.length - 1] ?? 'viewer'),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { error: failure } = await crmDb.rpc('reactivate_member', { p_user_id: member.id, p_role: role });
      if (failure) {
        setError(rpcRefusalMessage(failure, `Não foi possível reativar ${name}. Tente novamente.`));
        return;
      }
      toast.success(`O acesso de ${name} foi reativado.`);
      await cache.invalidateQueries({ queryKey: ['crm'] });
      onClose();
    } catch (cause) {
      setError(rpcRefusalMessage(cause, `Não foi possível reativar ${name}. Tente novamente.`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg">
        <DialogHeader>
          <DialogTitle>Reativar {name}</DialogTitle>
          <DialogDescription>
            {name} volta a entrar no CRM com o papel escolhido. A carteira que passou para outra pessoa continua com
            ela: troque o “Responsável” dos registros que devem voltar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <label htmlFor={roleId} className="font-medium">
            Novo papel
          </label>
          <select
            id={roleId}
            className="h-11 w-full rounded-xl border border-input bg-background px-3"
            value={role}
            disabled={busy}
            onChange={(event) => setRole(event.target.value as CrmRole)}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {CRM_ROLE_LABELS[option]}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
        </div>
        {error && (
          <p id={errorId} role="alert" className="rounded-xl border border-destructive p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy} aria-describedby={error ? errorId : undefined} onClick={() => void confirm()}>
            {busy ? 'Aguarde…' : 'Confirmar reativação'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
