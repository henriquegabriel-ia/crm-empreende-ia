import { useId, useState } from 'react';
import { Download, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ds/button';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import type { Contact } from '@/lib/contact-model';
import { isAnonymized } from '@/lib/privacy';
import { PRIVACY_MIGRATION_MISSING, privacyMigrationMissing } from '@/lib/rpc-errors';
import type { PersonLike } from '@/lib/team-members';
import { AnonymizeContactDialog } from './AnonymizeContactDialog';
import { ExportContactDialog } from './ExportContactDialog';
import { useLastPrivacyAction } from './data';
import { authorStamp } from './stamp';

const LAST_ACTION_VERB: Record<string, string> = { export: 'Dados exportados', anonymize: 'Contato anonimizado' };

/**
 * A seção "Privacidade" da ficha 360 do contato (item 1.10; docs/arquitetura/1.10.md, seção 5.3): só para donos e
 * administradores e só num contato não anonimizado, com "Exportar dados deste contato", "Anonimizar contato" e o último
 * registro de privacy_actions. Num banco sem a migração (o contato lido não tem a coluna da base legal), os botões ficam
 * desabilitados e a seção diz o motivo.
 */
export function ContactPrivacySection({ contact, members }: { contact: Contact; members: readonly PersonLike[] }) {
  const { canManage } = useCrmPermissions();
  const available = 'legal_basis' in contact;
  const visible = canManage && !isAnonymized(contact);
  const last = useLastPrivacyAction(contact.id, visible && available);
  const [exporting, setExporting] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  const statusId = useId();
  if (!visible) return null;
  const missing = !available || (last.isError && privacyMigrationMissing(last.error));
  const status = missing
    ? PRIVACY_MIGRATION_MISSING
    : last.isPending
      ? 'Conferindo o último registro…'
      : last.isError
        ? 'Não foi possível conferir o último registro.'
        : last.data
          ? (authorStamp(
              LAST_ACTION_VERB[last.data.action] ?? 'Registro de privacidade',
              last.data.created_at,
              last.data.performed_by,
              members,
            ) ?? 'Registro de privacidade sem data.')
          : 'Nenhuma exportação ou anonimização registrada.';
  return (
    <section data-tour="360-privacy" aria-labelledby={`${statusId}-title`} className="space-y-3 rounded-xl border p-4">
      <h2 id={`${statusId}-title`} className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck aria-hidden className="h-4 w-4" />
        Privacidade
      </h2>
      <p className="text-xs text-muted-foreground">
        Para atender os pedidos da pessoa pela LGPD: o acesso aos dados dela ou a exclusão. Só donos e administradores
        veem esta seção.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="eia-touch-target"
          disabled={missing}
          aria-describedby={statusId}
          onClick={() => setExporting(true)}
        >
          <Download aria-hidden className="mr-1 h-3.5 w-3.5" />
          Exportar dados deste contato
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="eia-touch-target text-destructive"
          disabled={missing}
          aria-describedby={statusId}
          onClick={() => setAnonymizing(true)}
        >
          <EyeOff aria-hidden className="mr-1 h-3.5 w-3.5" />
          Anonimizar contato
        </Button>
      </div>
      <p id={statusId} role="status" className="text-xs text-muted-foreground">
        {status}
      </p>
      <ExportContactDialog contact={contact} open={exporting} onOpenChange={setExporting} />
      <AnonymizeContactDialog contact={contact} open={anonymizing} onOpenChange={setAnonymizing} />
    </section>
  );
}
