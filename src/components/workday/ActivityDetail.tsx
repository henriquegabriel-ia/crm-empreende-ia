import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Check, CircleHelp, Pencil, Trash2, Undo2 } from 'lucide-react';
import { SidePanel } from '@/components/foundation/SidePanel';
import { EmptyState } from '@/components/foundation/EmptyState';
import { ConfirmDialog } from '@/components/foundation/ConfirmDialog';
import { Button } from '@/components/ds/button';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import {
  ACTIVITY_LABELS,
  OUTCOME_LABELS,
  contactName,
  displayDate,
  relationshipIndex,
  type RelationshipData,
} from '@/lib/contact-model';
import { formatPhoneBR } from '@/lib/phone';
import { ChannelBar } from '@/components/channels/ChannelBar';
import { useInteractionPrompt } from '@/components/channels/interaction-context';
import { activityLinks, type Activity } from '@/lib/activity-logic';
import { memberLabel } from '@/lib/team-members';
import { useActivityActions } from './useActivityActions';
export function ActivityDetail({
  activity,
  data,
  onClose,
  onEdit,
}: {
  activity?: Activity;
  data: RelationshipData;
  onClose: () => void;
  onEdit: (activity: Activity) => void;
}) {
  const { canWrite, canManage } = useCrmPermissions();
  const actions = useActivityActions();
  const prompt = useInteractionPrompt();
  const [confirm, setConfirm] = useState(false);
  // Canais do contato (ou da empresa) da atividade (item 1.9); pendente e do mesmo canal, ela é a origem do registro.
  const index = relationshipIndex(data);
  const contact = activity?.contact_id ? index.contactById.get(activity.contact_id) : undefined;
  const company = activity?.company_id
    ? index.companyById.get(activity.company_id)
    : contact?.company_id
      ? index.companyById.get(contact.company_id)
      : undefined;
  const deal = activity?.deal_id ? index.dealById.get(activity.deal_id) : undefined;
  // Com quem os canais falam: o contato (telefone e e-mail dele) ou, sem contato, a empresa; o telefone no formato
  // brasileiro, como na ficha (o E.164 fica no banco e nos links).
  const channelPhoneText = (contact ? contact.phone : company?.phone) ?? null;
  const reach = [
    contact ? contactName(contact) : company?.name,
    channelPhoneText ? formatPhoneBR(channelPhoneText) || channelPhoneText : null,
    contact?.email,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <SidePanel
        open
        onOpenChange={(open) => {
          if (!open && !actions.busy) onClose();
        }}
        title={activity?.title ?? 'Atividade indisponível'}
        kicker={ACTIVITY_LABELS[activity?.type ?? ''] ?? 'Atividade'}
        description="Detalhes e contexto da atividade"
      >
        {!activity ? (
          <EmptyState
            icon={CircleHelp}
            title="Atividade não encontrada ou sem acesso"
            description="O link pode estar incorreto, o registro pode ter sido removido ou seu acesso pode ter mudado."
            action={
              <Button variant="outline" onClick={onClose}>
                Voltar à lista
              </Button>
            }
          />
        ) : (
          <div className="space-y-5">
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Situação</dt>
                <dd className="mt-1">
                  {activity.type === 'note'
                    ? 'Nota registrada'
                    : activity.completed_at
                      ? `Concluída em ${displayDate(activity.completed_at)}${activity.outcome && OUTCOME_LABELS[activity.outcome] ? ` · ${OUTCOME_LABELS[activity.outcome]}` : ''}`
                      : 'Pendente'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Responsável</dt>
                <dd className="mt-1">
                  {memberLabel(
                    data.members.find((m) => m.id === activity.user_id),
                    activity.user_id,
                  )}
                </dd>
              </div>
              {activity.type !== 'note' && (
                <div>
                  <dt className="text-xs text-muted-foreground">Prazo / início</dt>
                  <dd className="mt-1">
                    {displayDate(activity.due_date)}
                    {activity.end_date ? ` até ${displayDate(activity.end_date)}` : ''}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">Detalhes</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words">{activity.body || 'Sem detalhes adicionais.'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Criada em</dt>
                <dd className="mt-1">{displayDate(activity.created_at)}</dd>
              </div>
            </dl>
            {(contact || company) && (
              <div className="space-y-2">
                <h2 className="text-xs font-semibold">Canais</h2>
                <p className="break-words text-sm text-muted-foreground">{reach}</p>
                <ChannelBar
                  contact={contact}
                  company={company}
                  deal={deal}
                  activity={activity}
                  members={data.members}
                  showPending
                />
              </div>
            )}
            <div className="space-y-2">
              <h2 className="text-xs font-semibold">Vínculos</h2>
              {activityLinks(activity, data).length ? (
                activityLinks(activity, data).map((link) => (
                  <Link key={link.path} to={link.path} className="block text-sm text-primary hover:underline">
                    {link.label}
                  </Link>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Sem contato, empresa ou oportunidade vinculada.</p>
              )}
            </div>
            {actions.error && !confirm && (
              <p role="alert" className="text-sm text-destructive">
                {actions.error}
              </p>
            )}
            {canWrite ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => onEdit(activity)} disabled={!!actions.busy}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar / reagendar
                </Button>
                {activity.type !== 'note' && (
                  <Button onClick={() => void actions.toggle(activity)} disabled={!!actions.busy}>
                    {activity.completed_at ? <Undo2 className="mr-2 h-4 w-4" /> : <Check className="mr-2 h-4 w-4" />}
                    {actions.busy ? 'Salvando…' : activity.completed_at ? 'Reabrir' : 'Concluir'}
                  </Button>
                )}
                {activity.type !== 'note' && !activity.completed_at && (
                  <Button
                    variant="outline"
                    disabled={!!actions.busy}
                    onClick={() => prompt.openDialog({ mode: 'complete', activity, requireNext: true })}
                  >
                    <CalendarPlus className="mr-2 h-4 w-4" />
                    Concluir e agendar a próxima
                  </Button>
                )}
                {canManage && (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setConfirm(true)}
                    disabled={!!actions.busy}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Excluir
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Seu papel permite somente consulta.</p>
            )}
          </div>
        )}
      </SidePanel>
      <ConfirmDialog
        open={confirm && canManage}
        onOpenChange={setConfirm}
        title="Excluir esta atividade?"
        description={
          <>
            Ela será removida da rotina e dos históricos vinculados. A exclusão é permanente.
            {actions.error && (
              <span role="alert" className="mt-2 block text-destructive">
                {actions.error}
              </span>
            )}
          </>
        }
        confirmLabel="Excluir atividade"
        loading={!!actions.busy}
        onConfirm={async () => {
          if (canManage && activity && (await actions.remove(activity))) {
            setConfirm(false);
            onClose();
          }
        }}
      />
    </>
  );
}
