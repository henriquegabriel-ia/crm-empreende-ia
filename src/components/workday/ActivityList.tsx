import { Link } from 'react-router-dom';
import { CalendarClock, Check, Pencil, Undo2 } from 'lucide-react';
import { Button } from '@/components/ds/button';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import {
  ACTIVITY_LABELS,
  displayDate,
  isChannelType,
  relationshipIndex,
  type RelationshipData,
} from '@/lib/contact-model';
import { channelEmail, channelPhone } from '@/lib/channels';
import { ChannelBar } from '@/components/channels/ChannelBar';
import { activityLinks, type Activity } from '@/lib/activity-logic';
import { memberLabel } from '@/lib/team-members';
import { useActivityActions } from './useActivityActions';
export function ActivityList({
  activities,
  data,
  onOpen,
  onEdit,
  tourPrefix = 'activities',
}: {
  activities: Activity[];
  data: RelationshipData;
  onOpen: (activity: Activity) => void;
  onEdit: (activity: Activity) => void;
  tourPrefix?: string;
}) {
  const { canWrite } = useCrmPermissions();
  const actions = useActivityActions();
  // Índice do snapshot (item 0.10): o responsável de cada item sai de um Map, e não de uma busca na equipe por linha.
  const { memberById, contactById, companyById } = relationshipIndex(data);
  // O botão do canal (item 1.9): numa ligação, WhatsApp ou e-mail pendente cujo contato (ou empresa) tem o dado do
  // canal, um botão só, ao lado de "Concluir"; a atividade é a origem do registro. Todos os papéis abrem os canais.
  const channelFor = (activity: Activity) => {
    if (!isChannelType(activity.type) || activity.completed_at) return null;
    const contact = activity.contact_id ? contactById.get(activity.contact_id) : undefined;
    const company = activity.company_id ? companyById.get(activity.company_id) : undefined;
    if (!contact && !company) return null;
    const usable =
      activity.type === 'email'
        ? !!contact && !!channelEmail(contact.email)
        : !!channelPhone(contact ? contact.phone : company?.phone);
    return usable ? { type: activity.type, contact, company } : null;
  };
  return (
    <>
      {actions.error && (
        <p role="alert" className="mb-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
          {actions.error}
        </p>
      )}
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {activities.map((activity, index) => (
          <li key={activity.id} className="flex flex-wrap items-start gap-3 p-4">
            <div className="min-w-0 flex-1 basis-48">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>{ACTIVITY_LABELS[activity.type] ?? 'Atividade'}</span>
                <span aria-hidden>·</span>
                <span>
                  {activity.type === 'note' ? 'Nota registrada' : activity.completed_at ? 'Concluída' : 'Pendente'}
                </span>
              </div>
              <button
                className={`text-left text-sm font-semibold hover:text-primary focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activity.completed_at && activity.type !== 'note' ? 'text-muted-foreground' : ''}`}
                onClick={() => onOpen(activity)}
              >
                {activity.title}
              </button>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span
                  className={
                    !activity.completed_at && activity.due_date && Date.parse(activity.due_date) < Date.now()
                      ? 'text-destructive'
                      : ''
                  }
                >
                  <CalendarClock aria-hidden className="mr-1 inline h-3 w-3" />
                  {activity.type === 'note' ? displayDate(activity.created_at) : displayDate(activity.due_date)}
                  {activity.end_date && activity.due_date
                    ? ` · ${Math.round((Date.parse(activity.end_date) - Date.parse(activity.due_date)) / 60000)} min`
                    : ''}
                </span>
                <span>
                  {memberLabel(activity.user_id ? memberById.get(activity.user_id) : undefined, activity.user_id)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {activityLinks(activity, data).map((link) => (
                  <Link key={link.path} to={link.path} className="text-xs text-primary hover:underline">
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
            {(() => {
              const channel = channelFor(activity);
              return channel ? (
                <ChannelBar
                  className="shrink-0"
                  only={channel.type}
                  activity={activity}
                  contact={channel.contact}
                  company={channel.company}
                  members={data.members}
                />
              ) : null;
            })()}
            {canWrite && (
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!actions.busy}
                  aria-label={`Editar ${activity.title}`}
                  onClick={() => onEdit(activity)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {activity.type !== 'note' && (
                  <Button
                    data-tour={index === 0 ? `${tourPrefix}-status` : undefined}
                    variant={activity.completed_at ? 'ghost' : 'outline'}
                    size="sm"
                    disabled={!!actions.busy}
                    onClick={() => void actions.toggle(activity)}
                  >
                    {activity.completed_at ? (
                      <Undo2 className="mr-1 h-3.5 w-3.5" />
                    ) : (
                      <Check className="mr-1 h-3.5 w-3.5" />
                    )}
                    {actions.busy === activity.id ? 'Salvando…' : activity.completed_at ? 'Reabrir' : 'Concluir'}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
