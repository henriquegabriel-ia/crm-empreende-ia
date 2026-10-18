import type { CrmRow } from '@/integrations/supabase/commercial-types';
import { localDayBounds } from '@/lib/activity-logic';

/**
 * O registro das interações abertas pelos canais (item 1.9; docs/arquitetura/1.9.md, seção 6.3). Abrir o WhatsApp, o
 * e-mail ou a ligação pelo CRM não grava nada: cria uma pendência "Para registrar", que a pessoa registra ou descarta
 * ("Agora não"). A pendência guarda só ids, o canal e a hora do clique, na sessionStorage da aba: sobrevive a recarregar
 * (o celular costuma recarregar o CRM ao voltar do WhatsApp) e some ao fechar a aba. Nada de nome, telefone, e-mail ou
 * texto: os nomes vêm do snapshot na hora de mostrar.
 */

type Activity = CrmRow<'activities'>;

export type InteractionChannel = 'call' | 'whatsapp' | 'email';

export interface PendingInteraction {
  /** `activity:<id>` com origem; senão `<canal>:<contato ou empresa>:<oportunidade ou ->`. */
  key: string;
  /** Id da atividade a criar, gerado quando a pendência nasce: a gravação repetida é reconhecida por ele. */
  id: string;
  /** Id da próxima ação, gerado agora pelo mesmo motivo. */
  nextId: string;
  channel: InteractionChannel;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  /** Atividade de origem, pendente: o registro conclui essa atividade em vez de criar outra. */
  activityId: string | null;
  /** ISO, hora do clique. */
  openedAt: string;
}

/** Até 10 pendências (a mais antiga sai), por 12 horas. */
export const PENDING_LIMIT = 10;
export const PENDING_TTL_MS = 12 * 60 * 60 * 1000;

export const pendingStorageKey = (orgId: string, userId: string) =>
  `empreende-crm:interactions:v1:${encodeURIComponent(orgId)}:${encodeURIComponent(userId)}`;

export interface InteractionTarget {
  channel: InteractionChannel;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  activityId?: string | null;
}

/** A chave que impede duas pendências para o mesmo alvo: abrir de novo atualiza a hora e mantém os ids. */
export function pendingKey({ channel, contactId, companyId, dealId, activityId }: InteractionTarget) {
  if (activityId) return `activity:${activityId}`;
  return `${channel}:${contactId || companyId || '-'}:${dealId || '-'}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS: readonly string[] = ['call', 'whatsapp', 'email'];
const optionalId = (value: unknown) => (typeof value === 'string' && UUID.test(value) ? value : null);

/** Só o que tem o formato esperado; o resto é descartado (armazenamento antigo, editado ou corrompido). */
function parsePending(value: unknown): PendingInteraction | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.key !== 'string' || item.key.length > 200) return null;
  if (!optionalId(item.id) || !optionalId(item.nextId) || !CHANNELS.includes(String(item.channel))) return null;
  if (typeof item.openedAt !== 'string' || !Number.isFinite(Date.parse(item.openedAt))) return null;
  return {
    key: item.key,
    id: String(item.id),
    nextId: String(item.nextId),
    channel: item.channel as InteractionChannel,
    contactId: optionalId(item.contactId),
    companyId: optionalId(item.companyId),
    dealId: optionalId(item.dealId),
    activityId: optionalId(item.activityId),
    openedAt: new Date(item.openedAt).toISOString(),
  };
}

/** As pendências válidas: sem as expiradas, sem chaves repetidas e só as 10 mais recentes. */
export function cleanPending(items: readonly PendingInteraction[], now: number): PendingInteraction[] {
  const seen = new Set<string>();
  return [...items]
    .filter((item) => now - Date.parse(item.openedAt) < PENDING_TTL_MS)
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))
    .filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)))
    .slice(0, PENDING_LIMIT);
}

export function parsePendingList(raw: string | null, now: number): PendingInteraction[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return cleanPending(
      value.map(parsePending).filter((item): item is PendingInteraction => !!item),
      now,
    );
  } catch {
    return [];
  }
}

/** O que vai para o armazenamento: só os campos da pendência, nunca nome, telefone, e-mail ou texto. */
export function serializePending(items: readonly PendingInteraction[]) {
  return JSON.stringify(
    items.map(({ key, id, nextId, channel, contactId, companyId, dealId, activityId, openedAt }) => ({
      key,
      id,
      nextId,
      channel,
      contactId,
      companyId,
      dealId,
      activityId,
      openedAt,
    })),
  );
}

/** Leitura protegida: armazenamento bloqueado (navegação privada, cota, prévias) vira lista vazia, sem quebrar a tela. */
export function readPending(storage: () => Storage, key: string, now: number): PendingInteraction[] {
  try {
    return parsePendingList(storage().getItem(key), now);
  } catch {
    return [];
  }
}

/** Gravação protegida: falhou, a lista fica só em memória (recarregar a aba perde). */
export function writePending(storage: () => Storage, key: string, items: readonly PendingInteraction[]) {
  try {
    if (items.length) storage().setItem(key, serializePending(items));
    else storage().removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Uma pendência nova, ou a mesma (com a hora renovada) quando o alvo já tem uma. */
export function upsertPending(
  items: readonly PendingInteraction[],
  target: InteractionTarget,
  now: Date,
  newId: () => string,
): PendingInteraction[] {
  const key = pendingKey(target);
  const previous = items.find((item) => item.key === key);
  const next: PendingInteraction = {
    key,
    id: previous?.id ?? newId(),
    nextId: previous?.nextId ?? newId(),
    channel: target.channel,
    contactId: target.contactId ?? null,
    companyId: target.companyId ?? null,
    dealId: target.dealId ?? null,
    activityId: target.activityId ?? null,
    openedAt: now.toISOString(),
  };
  return cleanPending([next, ...items.filter((item) => item.key !== key)], now.getTime());
}

/** Tipos que contam como interação com o cliente no "Último contato" (notas e tarefas não contam). */
export const INTERACTION_TYPES = ['call', 'whatsapp', 'email', 'meeting', 'visit'] as const;

/** A interação concluída mais recente (ligação, WhatsApp, e-mail, reunião ou visita), pela hora da conclusão. */
export function lastInteraction<T extends Pick<Activity, 'id' | 'type' | 'completed_at'>>(activities: readonly T[]) {
  let last: T | null = null;
  for (const activity of activities) {
    if (!activity.completed_at || !(INTERACTION_TYPES as readonly string[]).includes(activity.type)) continue;
    const at = Date.parse(activity.completed_at);
    if (!Number.isFinite(at)) continue;
    if (
      !last ||
      at > Date.parse(last.completed_at!) ||
      (at === Date.parse(last.completed_at!) && activity.id > last.id)
    )
      last = activity;
  }
  return last;
}

/**
 * A data de um item na linha do tempo 360: quando aconteceu. Uma atividade concluída vale pela conclusão (a interação
 * registrada depois grava ali o "Quando"); a pendente e a nota, pelo cadastro.
 */
export function timelineMoment(activity: Pick<Activity, 'type' | 'completed_at' | 'created_at'>) {
  return activity.type !== 'note' && activity.completed_at ? activity.completed_at : activity.created_at;
}

/** A linha do tempo da mais recente para a mais antiga, por timelineMoment (empate pelo id, para a ordem ser estável). */
export function byTimelineMoment<T extends Pick<Activity, 'id' | 'type' | 'completed_at' | 'created_at'>>(a: T, b: T) {
  return Date.parse(timelineMoment(b)) - Date.parse(timelineMoment(a)) || a.id.localeCompare(b.id);
}

export interface PendingMatch<T> {
  /** A única atividade pendente que o registro pode concluir. */
  match: T | null;
  /** Quantas atividades atendem: com duas ou mais, o registro não sugere nenhuma. */
  count: number;
}

/**
 * A atividade planejada que um registro deveria concluir, em vez de criar outra: pendente, do mesmo tipo, do mesmo
 * contato (ou da empresa, sem contato), da mesma oportunidade ou sem oportunidade, com prazo até o fim do dia local.
 * Só com exatamente uma: com duas ou mais, a pessoa conclui a certa pela lista.
 */
export function matchingPendingActivity<
  T extends Pick<Activity, 'type' | 'completed_at' | 'due_date' | 'contact_id' | 'company_id' | 'deal_id'>,
>(
  activities: readonly T[],
  target: { channel: InteractionChannel; contactId?: string | null; companyId?: string | null; dealId?: string | null },
  now: Date,
): PendingMatch<T> {
  const { end } = localDayBounds(now);
  const matches = activities.filter((activity) => {
    if (activity.completed_at || activity.type !== target.channel || !activity.due_date) return false;
    const due = Date.parse(activity.due_date);
    if (!Number.isFinite(due) || due >= end) return false;
    if (target.contactId) {
      if (activity.contact_id !== target.contactId) return false;
    } else if (!target.companyId || activity.company_id !== target.companyId || activity.contact_id) return false;
    return !target.dealId || !activity.deal_id || activity.deal_id === target.dealId;
  });
  return { match: matches.length === 1 ? matches[0] : null, count: matches.length };
}

const CHANNEL_TITLES: Record<InteractionChannel, string> = {
  call: 'Ligação para',
  whatsapp: 'WhatsApp para',
  email: 'E-mail para',
};

/** "Ligação para Ana Souza", "WhatsApp para Ana Souza" ou "E-mail para Ana Souza: Proposta" (até 200 caracteres). */
export function interactionTitle(channel: InteractionChannel, name: string, subject?: string | null) {
  const base = `${CHANNEL_TITLES[channel]} ${name.trim() || 'contato'}`;
  const title = channel === 'email' && subject?.trim() ? `${base}: ${subject.trim()}` : base;
  return title.length > 200 ? `${title.slice(0, 199)}…` : title;
}

/** Aviso de sucesso quando a tentativa anterior já tinha criado uma próxima ação que a pessoa desmarcou depois. */
export const leftoverNextActionNotice = (title: string) =>
  `A tentativa anterior já tinha criado a próxima ação “${title}”. Se ela não for mais necessária, conclua ou edite em “Atividades”.`;

/** O acesso ao banco de `insertActivityBatch`, para a tela passar o cliente e os testes, um simulado. */
export interface ActivityBatchWriter<T> {
  insert: (rows: T[]) => PromiseLike<{ error: unknown }>;
  existing: (ids: string[]) => PromiseLike<{ data: { id: string; title: string }[] | null; error: unknown }>;
}

/**
 * Grava o lote do registro (a interação e, se marcada, a próxima ação) sem duplicar depois de uma resposta perdida
 * (achado 4 da revisão do item 1.9). Os ids nascem com a pendência, então a repetição bate na chave primária (23505).
 * Nesse caso, lê quais linhas do lote já existem e grava só as que faltam, com os mesmos ids, numa nova tentativa:
 * [I] gravado e [I, N] pedido grava só N. `extraIds` são linhas que a pessoa desmarcou entre as tentativas (a próxima
 * ação): se a tentativa anterior as gravou, elas voltam em `leftovers`, para o aviso (`leftoverNextActionNotice`), sem
 * excluir nada (colaborador não exclui atividades). Nenhuma linha do lote gravada, ou outra falha: o erro original.
 */
export async function insertActivityBatch<T extends { id?: string | null }>(
  writer: ActivityBatchWriter<T>,
  rows: T[],
  extraIds: readonly string[] = [],
): Promise<{ leftovers: { id: string; title: string }[] }> {
  const first = await writer.insert(rows);
  if (!first.error) return { leftovers: [] };
  const code = typeof first.error === 'object' && first.error !== null ? (first.error as { code?: unknown }).code : '';
  if (code !== '23505') throw first.error;
  const ids = rows.map((row) => String(row.id));
  const extras = extraIds.filter((id) => !ids.includes(id));
  const check = await writer.existing([...ids, ...extras]);
  if (check.error || !check.data) throw first.error;
  const saved = new Set(check.data.map((row) => row.id));
  if (!ids.some((id) => saved.has(id))) throw first.error;
  const missing = rows.filter((row) => !saved.has(String(row.id)));
  if (missing.length) {
    const retry = await writer.insert(missing);
    if (retry.error) throw retry.error;
  }
  return { leftovers: check.data.filter((row) => extras.includes(row.id)) };
}
