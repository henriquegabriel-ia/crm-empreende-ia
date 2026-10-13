import type { CrmRow } from '@/integrations/supabase/commercial-types';
import {
  compareTextPtBR,
  contactName,
  nextAction,
  relatedData,
  relationshipIndex,
  type RelationshipData,
} from '@/lib/contact-model';
import { isActiveMember, memberLabel } from '@/lib/team-members';
export type Activity = CrmRow<'activities'>;
export type ActivityDateFilter = 'all' | 'today' | 'overdue' | 'upcoming' | 'no-date';
export function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
export function parseLocalDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return dateKey(date) === value ? date : null;
}
export function localDayBounds(date: Date) {
  return {
    start: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
    end: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime(),
  };
}
export function uniqueActivities(activities: Activity[]) {
  return [...new Map(activities.map((a) => [a.id, a])).values()];
}
export function matchesDate(activity: Pick<Activity, 'due_date'>, filter: ActivityDateFilter, now: Date) {
  const due = activity.due_date ? Date.parse(activity.due_date) : NaN;
  const { start, end } = localDayBounds(now);
  if (filter === 'all') return true;
  if (filter === 'no-date') return !Number.isFinite(due);
  if (!Number.isFinite(due)) return false;
  if (filter === 'today') return due >= start && due < end;
  if (filter === 'overdue') return due < now.getTime();
  return due >= end;
}
export function activitySummary(activities: Activity[], now: Date) {
  const all = uniqueActivities(activities);
  const actions = all.filter((a) => a.type !== 'note');
  const pending = actions.filter((a) => !a.completed_at);
  return {
    pending,
    today: pending.filter((a) => matchesDate(a, 'today', now)),
    overdue: pending.filter((a) => matchesDate(a, 'overdue', now)),
    unscheduled: pending.filter((a) => !a.due_date),
    completedToday: actions.filter((a) => a.completed_at && matchesDate({ due_date: a.completed_at }, 'today', now)),
    dayQueue: pending
      .filter((a) => a.due_date && Date.parse(a.due_date) < localDayBounds(now).end)
      .sort(compareActivities),
  };
}
export function compareActivities(a: Activity, b: Activity) {
  const da = a.due_date ? Date.parse(a.due_date) : Infinity,
    db = b.due_date ? Date.parse(b.due_date) : Infinity;
  return (da < db ? -1 : da > db ? 1 : 0) || a.id.localeCompare(b.id);
}
export function rescheduledEnd(activity: Pick<Activity, 'due_date' | 'end_date'>, start: string, durationMinutes = 60) {
  const oldStart = activity.due_date ? Date.parse(activity.due_date) : NaN,
    oldEnd = activity.end_date ? Date.parse(activity.end_date) : NaN;
  const duration =
    Number.isFinite(oldEnd - oldStart) && oldEnd > oldStart ? oldEnd - oldStart : durationMinutes * 60_000;
  return new Date(Date.parse(start) + duration).toISOString();
}
export function activityLinks(
  activity: Pick<Activity, 'contact_id' | 'company_id' | 'deal_id'>,
  data: RelationshipData,
) {
  const index = relationshipIndex(data);
  const links: { label: string; path: string }[] = [];
  const contact = activity.contact_id ? index.contactById.get(activity.contact_id) : undefined;
  if (contact) links.push({ label: contactName(contact), path: `/contacts?contact=${contact.id}` });
  const company = activity.company_id ? index.companyById.get(activity.company_id) : undefined;
  if (company) links.push({ label: company.name, path: `/companies?company=${company.id}` });
  const deal = activity.deal_id ? index.dealById.get(activity.deal_id) : undefined;
  if (deal) links.push({ label: deal.title, path: `/pipeline?deal=${deal.id}` });
  return links;
}
export interface AttentionReason {
  ruleId: string;
  label: string;
  explanation: string;
  priority: number;
}
export interface AttentionItem {
  key: string;
  title: string;
  path: string;
  reasons: AttentionReason[];
  priority: number;
  /**
   * Item que resume vários registros, com link para o diretório filtrado (contatos sem próxima ação) ou para a Equipe
   * (contatos com uma pessoa desativada), em vez de um item por registro.
   */
  group?: { entity: 'contact'; count: number; reason: 'no-next-action' | 'deactivated-owner' };
}
/**
 * Com mais contatos que isto sem próxima ação (por exemplo, depois de uma importação), a fila mostra um único item
 * "N contatos sem próxima ação", com link para o diretório filtrado, para não esconder vencidas e oportunidades. O
 * mesmo limite vale, por pessoa, para os contatos ativos que ficaram com alguém desativado (item 1.2).
 */
export const NO_NEXT_ACTION_GROUP_ABOVE = 10;
/** Contatos cadastrados há menos de 1 dia ainda não entram na regra "sem próxima ação". */
export const NEW_CONTACT_GRACE_MS = 86_400_000;
/** Chave do item que agrupa os contatos sem próxima ação. */
export const NO_NEXT_ACTION_GROUP_KEY = 'group:no-next-action-contacts';
export const NO_NEXT_ACTION_DIRECTORY_PATH = '/contacts?scope=no-action';
/** Chave do item que agrupa os contatos de uma pessoa desativada: o prefixo mais o id dela. */
export const DEACTIVATED_OWNER_GROUP_KEY_PREFIX = 'group:deactivated-owner-contacts:';
/** A Equipe, onde donos e administradores usam "Passar carteira". */
export const DEACTIVATED_OWNER_GROUP_PATH = '/team';
export interface AttentionOptions {
  /** "mine" mantém só os itens cujo responsável é `userId`: a atividade pelo `user_id`, o resto pelo `owner_id`. */
  audience?: 'all' | 'mine';
  userId?: string | null;
  /**
   * A partir de quantos contatos (exclusive) a fila os agrupa: os sem próxima ação e, por pessoa, os que ficaram com
   * alguém desativado. Infinity desliga o agrupamento.
   */
  groupContactsAbove?: number;
  /** Contatos cadastrados há menos que isto, em ms, ficam fora da regra no_next_action. 0 desliga a carência. */
  newContactGraceMs?: number;
}
/**
 * Rules explain each item; an entity appears once even when several rules match. Os vínculos vêm do índice do
 * snapshot (relationshipIndex), com custo O(n + m).
 */
export function attentionQueue(
  data: RelationshipData & { riskRules: CrmRow<'risk_rules'>[] },
  now: Date,
  options: AttentionOptions = {},
): AttentionItem[] {
  const {
    audience = 'all',
    userId,
    groupContactsAbove = NO_NEXT_ACTION_GROUP_ABOVE,
    newContactGraceMs = NEW_CONTACT_GRACE_MS,
  } = options;
  const mine = (ownerId: string | null) => audience === 'all' || (!!userId && ownerId === userId);
  const index = relationshipIndex(data);
  const dealActivities = (dealId: string) =>
    (index.activitiesByDeal.get(dealId) ?? []).map((position) => data.activities[position]);
  const items = new Map<string, AttentionItem>();
  function add(key: string, title: string, path: string, rule: CrmRow<'risk_rules'>, explanation: string) {
    const prior = items.get(key);
    const reason = { ruleId: rule.id, label: rule.name, explanation, priority: rule.priority };
    if (prior) {
      prior.reasons.push(reason);
      prior.priority = Math.min(prior.priority, rule.priority);
    } else items.set(key, { key, title, path, reasons: [reason], priority: rule.priority });
  }
  // Responsável desativado (item 1.2) conta como sem responsável: a carteira que ficou com ele precisa de outra pessoa.
  // Um id que não está na equipe continua fora da regra, como antes.
  const deactivatedOwner = (id: string | null) => {
    const member = id ? index.memberById.get(id) : undefined;
    return !!member && !isActiveMember(member);
  };
  const pending = uniqueActivities(data.activities as Activity[]).filter(
    (a) => a.type !== 'note' && !a.completed_at && mine(a.user_id),
  );
  const contacts = data.contacts.filter((c) => mine(c.owner_id));
  const openDeals = data.deals.filter((d) => d.status === 'open' && mine(d.owner_id));
  const isNewContact = (contact: { created_at: string }) => {
    const created = Date.parse(contact.created_at);
    return newContactGraceMs > 0 && Number.isFinite(created) && now.getTime() - created < newContactGraceMs;
  };
  for (const rule of data.riskRules.filter((r) => r.enabled)) {
    if (rule.type === 'overdue')
      for (const a of pending.filter((a) => a.due_date && Date.parse(a.due_date) < now.getTime()))
        add(
          `activity:${a.id}`,
          a.title,
          `/activities?activity=${a.id}`,
          rule,
          'Atividade pendente com prazo anterior ao horário atual.',
        );
    if (rule.type === 'no_owner') {
      for (const a of pending.filter((a) => !a.user_id || deactivatedOwner(a.user_id)))
        add(
          `activity:${a.id}`,
          a.title,
          `/activities?activity=${a.id}`,
          rule,
          a.user_id ? 'Atividade pendente com responsável desativado.' : 'Atividade pendente sem responsável definido.',
        );
      // Os contatos que ficaram com uma pessoa desativada (quem desativou desmarcou "Passar também os contatos e as
      // empresas") podem ser centenas: acima do limite, um item por pessoa, com link para a Equipe, como no 0.10.
      const byDeactivatedOwner = new Map<string, typeof contacts>();
      for (const c of contacts.filter((c) => c.status !== 'churned')) {
        if (!c.owner_id)
          add(
            `contact:${c.id}`,
            contactName(c),
            `/contacts?contact=${c.id}`,
            rule,
            'Contato ativo sem responsável pelo relacionamento.',
          );
        else if (deactivatedOwner(c.owner_id)) {
          const owned = byDeactivatedOwner.get(c.owner_id);
          if (owned) owned.push(c);
          else byDeactivatedOwner.set(c.owner_id, [c]);
        }
      }
      for (const [ownerId, owned] of byDeactivatedOwner) {
        if (owned.length > groupContactsAbove) {
          const count = owned.length;
          const key = `${DEACTIVATED_OWNER_GROUP_KEY_PREFIX}${ownerId}`;
          items.set(key, {
            key,
            title: `${memberLabel(index.memberById.get(ownerId), ownerId)}: ${count.toLocaleString('pt-BR')} ${count === 1 ? 'contato' : 'contatos'} sem responsável ativo`,
            path: DEACTIVATED_OWNER_GROUP_PATH,
            reasons: [
              {
                ruleId: rule.id,
                label: rule.name,
                explanation:
                  'Contatos ativos que ficaram com uma pessoa desativada. Agrupados em um só item para não esconder o restante da fila. Em “Equipe”, donos e administradores usam “Passar carteira” para entregá-los a uma pessoa ativa; também dá para trocar o “Responsável” de cada contato.',
                priority: rule.priority,
              },
            ],
            priority: rule.priority,
            group: { entity: 'contact', count, reason: 'deactivated-owner' },
          });
        } else
          for (const c of owned)
            add(
              `contact:${c.id}`,
              contactName(c),
              `/contacts?contact=${c.id}`,
              rule,
              'Contato ativo com responsável desativado.',
            );
      }
      for (const d of openDeals.filter((d) => !d.owner_id || deactivatedOwner(d.owner_id)))
        add(
          `deal:${d.id}`,
          d.title,
          `/pipeline?deal=${d.id}`,
          rule,
          d.owner_id ? 'Oportunidade em aberto com responsável desativado.' : 'Oportunidade em aberto sem responsável.',
        );
    }
    if (rule.type === 'no_next_action') {
      // O contato marcado "Não contatar" (item 1.9) fica de fora, como o encerrado: a fila não cobra um novo contato com
      // quem pediu para não ser procurado. As oportunidades continuam na regra, pelo vínculo direto.
      const withoutAction = contacts.filter(
        (c) =>
          c.status !== 'churned' && !c.do_not_contact && !isNewContact(c) && !relatedData('contacts', c.id, data).next,
      );
      if (withoutAction.length > groupContactsAbove) {
        const count = withoutAction.length;
        items.set(NO_NEXT_ACTION_GROUP_KEY, {
          key: NO_NEXT_ACTION_GROUP_KEY,
          title: `${count.toLocaleString('pt-BR')} contatos sem próxima ação`,
          path: NO_NEXT_ACTION_DIRECTORY_PATH,
          reasons: [
            {
              ruleId: rule.id,
              label: rule.name,
              explanation:
                audience === 'mine'
                  ? 'Contatos ativos sob sua responsabilidade, cadastrados há mais de 1 dia, sem atividade pendente com prazo, incluindo oportunidades vinculadas. Agrupados em um só item para não esconder o restante da fila. O link abre o filtro de toda a equipe, que também lista os encerrados, os marcados “Não contatar” e os cadastrados nas últimas 24 horas.'
                  : 'Contatos ativos, cadastrados há mais de 1 dia, sem atividade pendente com prazo, incluindo oportunidades vinculadas. Agrupados em um só item para não esconder o restante da fila. O filtro de Contatos também lista os encerrados, os marcados “Não contatar” e os cadastrados nas últimas 24 horas.',
              priority: rule.priority,
            },
          ],
          priority: rule.priority,
          group: { entity: 'contact', count, reason: 'no-next-action' },
        });
      } else
        for (const c of withoutAction)
          add(
            `contact:${c.id}`,
            contactName(c),
            `/contacts?contact=${c.id}`,
            rule,
            'Contato ativo sem atividade pendente com prazo, incluindo oportunidades vinculadas.',
          );
      for (const d of openDeals)
        if (!nextAction(dealActivities(d.id)))
          add(
            `deal:${d.id}`,
            d.title,
            `/pipeline?deal=${d.id}`,
            rule,
            'Oportunidade em aberto sem próxima ação com prazo vinculada diretamente a ela.',
          );
    }
    if (rule.type === 'stale_deal')
      for (const d of openDeals) {
        let last = Date.parse(d.updated_at);
        for (const a of dealActivities(d.id)) last = Math.max(last, Date.parse(a.updated_at));
        if (now.getTime() - last >= Math.max(0, rule.threshold_days) * 86400_000)
          add(
            `deal:${d.id}`,
            d.title,
            `/pipeline?deal=${d.id}`,
            rule,
            `Oportunidade e atividades vinculadas sem atualização há pelo menos ${rule.threshold_days} dias.`,
          );
      }
  }
  return [...items.values()].sort((a, b) => a.priority - b.priority || compareTextPtBR(a.title, b.title));
}
export function agendaDays(date: Date, mode: 'day' | 'week') {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (mode === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return Array.from(
    { length: mode === 'week' ? 7 : 1 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}
export function eventOverlapsDay(activity: Pick<Activity, 'due_date' | 'end_date'>, day: Date) {
  if (!activity.due_date) return false;
  const start = Date.parse(activity.due_date),
    end = activity.end_date ? Date.parse(activity.end_date) : start + 1;
  const bounds = localDayBounds(day);
  return start < bounds.end && end > bounds.start;
}
