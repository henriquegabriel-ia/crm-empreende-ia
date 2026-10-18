import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ds/button';
import { Textarea } from '@/components/ds/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ds/dialog';
import { ConfirmDialog } from '@/components/foundation/ConfirmDialog';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useOrg } from '@/hooks/useOrg';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { relationshipError, type Company, type Contact, type DirectoryKind } from '@/lib/contact-model';
import { invalidateCrmTables } from '@/lib/crm-cache';
import { CHANNELS_MIGRATION_MISSING, channelsMigrationMissing } from '@/lib/rpc-errors';
import { memberLabel, type PersonLike } from '@/lib/team-members';

interface Props {
  kind: DirectoryKind;
  record: Contact | Company;
  members: readonly PersonLike[];
  /** Na empresa: quantos contatos dela estão marcados (a marca de um não alcança o telefone do outro). */
  markedContacts?: number;
}

const REASON_MAX = 500;

/**
 * O que a marca desliga, dito no ponto de decisão. A da empresa vale só para o telefone dela (empresa não tem e-mail no
 * cadastro): a barra de canais lê a marca de cada alvo, e os contatos da empresa seguem a própria marca. Desde o item
 * 1.10, o banco também recusa agendar ação de contato para quem tem a marca (no contato, ligação, WhatsApp, e-mail,
 * reunião e visita; na empresa sem contato, ligação e WhatsApp); as ações já agendadas continuam na agenda.
 */
const MARK_TEXTS = {
  contacts: {
    band: 'WhatsApp, e-mail e ligação ficam desligados neste CRM, e o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele. As ações já agendadas continuam na agenda até serem concluídas ou trocadas por tarefa.',
    confirm:
      'WhatsApp, e-mail e ligação ficam desligados para este contato em todas as telas do CRM, e o CRM passa a recusar agendar ligação, WhatsApp, e-mail, reunião ou visita com ele. As ações já agendadas continuam na agenda até serem concluídas ou trocadas por tarefa. Avise a equipe para ninguém procurar por outro caminho.',
    allow:
      'Os botões de WhatsApp, e-mail e ligação voltam a funcionar, e o CRM volta a agendar ações de contato com ele. Confirme que a pessoa pediu ou aceitou ser procurada de novo.',
  },
  companies: {
    band: 'Vale para o telefone da empresa: WhatsApp e ligação ficam desligados neste CRM, e o CRM não agenda ligação nem WhatsApp para ele. Os contatos dela continuam liberados.',
    confirm:
      'Vale para o telefone da empresa: WhatsApp e ligação para ele ficam desligados em todas as telas do CRM, e o CRM passa a recusar agendar ligação ou WhatsApp sem um contato. Os contatos dela continuam liberados: marque cada um que pediu para não ser procurado.',
    allow:
      'Os botões de WhatsApp e ligação do telefone da empresa voltam a funcionar, e o CRM volta a agendar ligação e WhatsApp para ele. Confirme que a empresa pediu ou aceitou ser procurada de novo.',
  },
} as const;

function markError(error: unknown) {
  if (channelsMigrationMissing(error)) return CHANNELS_MIGRATION_MISSING;
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (code === 'P0001' && typeof message === 'string' && message.trim()) return message;
  return relationshipError(error);
}

/**
 * "Não contatar" na ficha 360 (item 1.9; docs/arquitetura/1.9.md, seção 6.5). Quem edita marca, com o motivo opcional;
 * só donos e administradores permitem o contato de novo (o banco recusa os demais). A data e o autor vêm do banco. A
 * marca desabilita os canais em todas as telas, e o banco recusa agendar ação de contato para quem a tem (item 1.10).
 */
export function DoNotContactPanel({ kind, record, members, markedContacts = 0 }: Props) {
  const { orgId } = useOrg();
  const { canWrite, canManage } = useCrmPermissions();
  const cache = useQueryClient();
  const [marking, setMarking] = useState(false);
  const [allowing, setAllowing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hintId = useId();
  const errorId = useId();
  const marked = !!record.do_not_contact;
  const isContact = kind === 'contacts';

  async function write(fields: { do_not_contact: boolean; do_not_contact_reason?: string | null }) {
    if (!orgId || busy) return false;
    setBusy(true);
    setError('');
    try {
      // A mesma guarda de versão do cadastro: com o registro mudado por outra pessoa, nada é sobrescrito.
      const result = await crmDb
        .from(kind)
        .update(fields)
        .eq('org_id', orgId)
        .eq('id', record.id)
        .eq('updated_at', record.updated_at)
        .select('id')
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) {
        setError(
          `${isContact ? 'Este contato mudou' : 'Esta empresa mudou'} ou não está mais disponível. Revise os dados atuais e tente de novo.`,
        );
        await invalidateCrmTables(cache, [kind]);
        return false;
      }
      await invalidateCrmTables(cache, [kind]);
      toast.success(fields.do_not_contact ? 'Marcado como “Não contatar”' : 'Contato permitido de novo');
      return true;
    } catch (cause) {
      setError(markError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const author = record.do_not_contact_by ? members.find((member) => member.id === record.do_not_contact_by) : null;
  const markedAt = record.do_not_contact_at
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(record.do_not_contact_at))
    : null;

  return (
    <>
      {marked ? (
        <section
          aria-label="Não contatar"
          className="space-y-2 rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm"
          data-do-not-contact
        >
          <h3 className="flex items-center gap-2 font-semibold">
            <Ban aria-hidden className="h-4 w-4" />
            Não contatar
          </h3>
          <p className="text-muted-foreground">
            Marcado
            {author ? ` por ${memberLabel(author)}` : record.do_not_contact_by ? ' por uma pessoa indisponível' : ''}
            {markedAt ? ` em ${markedAt}` : ''}. {MARK_TEXTS[kind].band}
          </p>
          {record.do_not_contact_reason && (
            <p className="whitespace-pre-wrap break-words">Motivo: {record.do_not_contact_reason}</p>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="eia-touch-target"
              disabled={busy}
              onClick={() => setAllowing(true)}
            >
              Permitir contato de novo
            </Button>
          )}
          {!canManage && canWrite && (
            <p className="text-xs text-muted-foreground">Só donos e administradores permitem o contato de novo.</p>
          )}
        </section>
      ) : (
        canWrite && (
          <Button
            size="sm"
            variant="ghost"
            className="eia-touch-target"
            onClick={() => {
              setReason('');
              setError('');
              setMarking(true);
            }}
          >
            <Ban aria-hidden />
            Marcar como não contatar
          </Button>
        )
      )}
      {!isContact && markedContacts > 0 && (
        <p className="text-xs text-muted-foreground">
          {markedContacts === 1
            ? '1 contato desta empresa está marcado como “Não contatar”.'
            : `${markedContacts} contatos desta empresa estão marcados como “Não contatar”.`}
        </p>
      )}
      {error && !marking && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog open={marking} onOpenChange={(open) => !open && !busy && setMarking(false)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar como não contatar?</DialogTitle>
            <DialogDescription>{MARK_TEXTS[kind].confirm}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="do-not-contact-reason">Motivo (opcional)</Label>
            <Textarea
              id="do-not-contact-reason"
              rows={3}
              maxLength={REASON_MAX}
              value={reason}
              aria-describedby={hintId}
              onChange={(event) => setReason(event.target.value)}
            />
            <p id={hintId} className="text-xs text-muted-foreground">
              Ex.: pediu para parar de receber mensagens. Não escreva dados sensíveis, como saúde ou religião.
            </p>
          </div>
          {error && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="eia-touch-target" disabled={busy} onClick={() => setMarking(false)}>
              Cancelar
            </Button>
            <Button
              className="eia-touch-target"
              disabled={busy}
              aria-describedby={error ? errorId : undefined}
              onClick={async () => {
                if (await write({ do_not_contact: true, do_not_contact_reason: reason.trim() || null }))
                  setMarking(false);
              }}
            >
              {busy ? 'Salvando…' : 'Marcar como não contatar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={allowing}
        onOpenChange={setAllowing}
        title="Permitir contato de novo?"
        description={MARK_TEXTS[kind].allow}
        confirmLabel="Permitir contato de novo"
        tone="default"
        loading={busy}
        onConfirm={async () => {
          // Recusada ou não, a confirmação fecha; o erro aparece na ficha.
          await write({ do_not_contact: false });
          setAllowing(false);
        }}
      />
    </>
  );
}
