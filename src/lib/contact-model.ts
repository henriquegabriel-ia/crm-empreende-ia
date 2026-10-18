import type { CrmRow } from '@/integrations/supabase/commercial-types';
import { blockingTableLabel } from '@/lib/record-links';
import { isOfflineRequestError, OFFLINE_REQUEST_MESSAGE } from '@/lib/offline';
import { formatPhoneBR } from '@/lib/phone';
import { CONSENT_NOTE_REQUIRED } from '@/lib/privacy';
import { isLeadSourceFilter, type LeadSourceFilter } from '@/lib/lead-source';

export type Contact = CrmRow<'contacts'>;
export type Company = CrmRow<'companies'>;
export type Deal = CrmRow<'deals'>;
/**
 * Pessoa da equipe com a situação do papel (item 1.2): `active` falso para quem foi desativado ou não tem papel na
 * organização. Sem `active` (dados montados antes do item), a pessoa conta como ativa (src/lib/team-members.ts).
 */
export type Member = Pick<CrmRow<'profiles'>, 'id' | 'name' | 'email'> & {
  active?: boolean;
  deactivatedAt?: string | null;
};
export type RelationshipActivity = CrmRow<'activities'>;
export interface RelationshipData {
  contacts: Contact[];
  companies: Company[];
  deals: Deal[];
  activities: RelationshipActivity[];
  members: Member[];
}
export type DirectoryKind = 'contacts' | 'companies';
export type DirectoryScope = 'all' | 'mine' | 'unassigned' | 'no-action';
export type DirectorySort = 'name' | 'updated' | 'next-action';
/** Colunas do diretório. "Origem" (item 1.14) é só de contatos, como "E-mail" e "Empresa". */
export const DIRECTORY_COLUMNS = ['email', 'phone', 'company', 'industry', 'source', 'owner', 'next-action'] as const;
export type DirectoryColumn = (typeof DIRECTORY_COLUMNS)[number];
export interface DirectoryView {
  q: string;
  scope: DirectoryScope;
  sort: DirectorySort;
  columns: DirectoryColumn[];
  /** Origem do contato (item 1.14); "all" em Empresas, que não têm origem. */
  source: LeadSourceFilter;
}
export const DEFAULT_COLUMNS: Record<DirectoryKind, DirectoryColumn[]> = {
  contacts: ['email', 'company', 'owner', 'next-action'],
  companies: ['industry', 'phone', 'owner', 'next-action'],
};
/** Nome do contato; sem nome, o e-mail ou o telefone no formato brasileiro (item 1.9). */
export function contactName(contact: Pick<Contact, 'first_name' | 'last_name' | 'email' | 'phone'>) {
  return (
    [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() ||
    contact.email ||
    formatPhoneBR(contact.phone) ||
    'Contato sem nome'
  );
}
export function recordName(record: Contact | Company) {
  return 'name' in record ? record.name : contactName(record);
}
export function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}
/**
 * Ordenação alfabética em pt-BR com um único `Intl.Collator`: o mesmo resultado de `localeCompare(b, 'pt-BR', …)`,
 * sem montar o comparador a cada comparação (ordenar 5 mil nomes com `localeCompare` e opções custa segundos com a
 * CPU de um celular).
 */
export const compareNamesPtBR = new Intl.Collator('pt-BR', { sensitivity: 'base' }).compare;
export const compareTextPtBR = new Intl.Collator('pt-BR').compare;
export function nextAction(activities: RelationshipActivity[]): RelationshipActivity | null {
  return (
    activities
      .filter((a) => !a.completed_at && a.type !== 'note' && a.due_date && Number.isFinite(Date.parse(a.due_date)))
      .sort((a, b) => Date.parse(a.due_date!) - Date.parse(b.due_date!) || a.id.localeCompare(b.id))[0] ?? null
  );
}

/**
 * Índices do snapshot por id e por vínculo, montados uma única vez para cada snapshot (item 0.10 do roteiro). Com
 * eles, relatedData, a fila de atenção e as buscas por id das telas custam O(n + m), e não O(n × m): antes, cada
 * contato percorria todas as oportunidades e atividades.
 *
 * Os índices de vínculo guardam posições nos arrays do snapshot, e não as linhas, para que relatedData devolva as
 * linhas na mesma ordem e com as mesmas repetições do filtro linear que substituíram (os testes de paridade conferem).
 */
export interface RelationshipIndex {
  /** Primeira linha com o id, como `array.find`. */
  contactById: ReadonlyMap<string, Contact>;
  companyById: ReadonlyMap<string, Company>;
  dealById: ReadonlyMap<string, Deal>;
  memberById: ReadonlyMap<string, Member>;
  /** Posições em `contacts`, `deals` e `activities`, na ordem do snapshot. */
  contactPositionsById: ReadonlyMap<string, readonly number[]>;
  contactsByCompany: ReadonlyMap<string, readonly number[]>;
  dealsByContact: ReadonlyMap<string, readonly number[]>;
  dealsByCompany: ReadonlyMap<string, readonly number[]>;
  activitiesByContact: ReadonlyMap<string, readonly number[]>;
  activitiesByCompany: ReadonlyMap<string, readonly number[]>;
  activitiesByDeal: ReadonlyMap<string, readonly number[]>;
}
function firstById<T extends { id: string }>(rows: readonly T[]) {
  const map = new Map<string, T>();
  for (const row of rows) if (!map.has(row.id)) map.set(row.id, row);
  return map;
}
function positionsBy<T>(rows: readonly T[], key: (row: T) => string | null | undefined) {
  const map = new Map<string, number[]>();
  rows.forEach((row, position) => {
    const value = key(row);
    if (value == null) return;
    const list = map.get(value);
    if (list) list.push(position);
    else map.set(value, [position]);
  });
  return map;
}
export function buildRelationshipIndex(data: RelationshipData): RelationshipIndex {
  return {
    contactById: firstById(data.contacts),
    companyById: firstById(data.companies),
    dealById: firstById(data.deals),
    memberById: firstById(data.members),
    contactPositionsById: positionsBy(data.contacts, (c) => c.id),
    contactsByCompany: positionsBy(data.contacts, (c) => c.company_id),
    dealsByContact: positionsBy(data.deals, (d) => d.contact_id),
    dealsByCompany: positionsBy(data.deals, (d) => d.company_id),
    activitiesByContact: positionsBy(data.activities, (a) => a.contact_id),
    activitiesByCompany: positionsBy(data.activities, (a) => a.company_id),
    activitiesByDeal: positionsBy(data.activities, (a) => a.deal_id),
  };
}
type IndexedArrays = readonly [unknown[], unknown[], unknown[], unknown[], unknown[]];
const indexCache = new WeakMap<
  RelationshipData,
  { arrays: IndexedArrays; lengths: number[]; index: RelationshipIndex }
>();
/**
 * Índice do snapshot, guardado enquanto o mesmo objeto de dados estiver em uso. Os dados do React Query são
 * imutáveis: um recarregamento traz um objeto novo e, com ele, um índice novo. Por segurança, um array trocado ou com
 * outro tamanho no mesmo objeto também refaz o índice.
 */
export function relationshipIndex(data: RelationshipData): RelationshipIndex {
  const arrays: IndexedArrays = [data.contacts, data.companies, data.deals, data.activities, data.members];
  const cached = indexCache.get(data);
  if (cached && cached.arrays.every((array, i) => array === arrays[i] && array.length === cached.lengths[i]))
    return cached.index;
  const index = buildRelationshipIndex(data);
  indexCache.set(data, { arrays, lengths: arrays.map((array) => array.length), index });
  return index;
}
function collect<T>(rows: readonly T[], positions: Set<number>) {
  return [...positions].sort((a, b) => a - b).map((position) => rows[position]);
}
function addAll(target: Set<number>, positions: readonly number[] | undefined) {
  if (positions) for (const position of positions) target.add(position);
}
/**
 * Contatos, oportunidades, atividades e próxima ação de um contato ou de uma empresa. Usa o índice do snapshot e
 * devolve o mesmo resultado, na mesma ordem, do filtro linear anterior.
 */
export function relatedData(kind: DirectoryKind, id: string, data: RelationshipData) {
  const index = relationshipIndex(data);
  const contactIds = new Set(
    kind === 'companies' ? (index.contactsByCompany.get(id) ?? []).map((position) => data.contacts[position].id) : [id],
  );
  const dealPositions = new Set<number>();
  if (kind === 'contacts') addAll(dealPositions, index.dealsByContact.get(id));
  else {
    addAll(dealPositions, index.dealsByCompany.get(id));
    for (const contactId of contactIds) if (contactId) addAll(dealPositions, index.dealsByContact.get(contactId));
  }
  const deals = collect(data.deals, dealPositions);
  const activityPositions = new Set<number>();
  if (kind === 'companies') addAll(activityPositions, index.activitiesByCompany.get(id));
  for (const contactId of contactIds)
    if (contactId) addAll(activityPositions, index.activitiesByContact.get(contactId));
  for (const deal of deals) if (deal.id) addAll(activityPositions, index.activitiesByDeal.get(deal.id));
  const activities = collect(data.activities, activityPositions);
  const contactPositions = new Set<number>();
  for (const contactId of contactIds) addAll(contactPositions, index.contactPositionsById.get(contactId));
  return {
    deals,
    activities,
    next: nextAction(activities),
    contacts: collect(data.contacts, contactPositions),
  };
}
export function directoryView(params: URLSearchParams, kind: DirectoryKind): DirectoryView {
  const scope = params.get('scope'),
    sort = params.get('sort'),
    source = params.get('source');
  const columns = params
    .get('columns')
    ?.split(',')
    .filter((c): c is DirectoryColumn => DIRECTORY_COLUMNS.includes(c as DirectoryColumn));
  return {
    q: (params.get('q') ?? '').slice(0, 300),
    scope: ['mine', 'unassigned', 'no-action'].includes(scope ?? '') ? (scope as DirectoryScope) : 'all',
    sort: ['updated', 'next-action'].includes(sort ?? '') ? (sort as DirectorySort) : 'name',
    columns: columns ? [...new Set(columns)] : DEFAULT_COLUMNS[kind],
    source: kind === 'contacts' && isLeadSourceFilter(source) ? source : 'all',
  };
}
export function applyDirectoryView(params: URLSearchParams, view: DirectoryView) {
  const next = new URLSearchParams(params);
  if (view.q) next.set('q', view.q);
  else next.delete('q');
  if (view.scope === 'all') next.delete('scope');
  else next.set('scope', view.scope);
  if (view.sort === 'name') next.delete('sort');
  else next.set('sort', view.sort);
  // Uma visão salva antes do item 1.14 não tem a origem: vale "Todas as origens".
  if (!view.source || view.source === 'all') next.delete('source');
  else next.set('source', view.source);
  next.set('columns', view.columns.join(','));
  return next;
}
export function withRecord(params: URLSearchParams, kind: DirectoryKind, id: string | null) {
  const next = new URLSearchParams(params);
  const key = kind === 'contacts' ? 'contact' : 'company';
  if (id) next.set(key, id);
  else next.delete(key);
  return next;
}
export function safeWebsite(value: string | null) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
/**
 * Mensagem de uma gravação recusada nas telas de relacionamento (contatos, empresas, atividades). As recusas dos
 * gatilhos e das RPCs da base (P0001, como o responsável desativado do 1.2 e o "Não contatar" e o contato anonimizado do
 * 1.10) são escritas para a tela, em pt-BR, e aparecem como estão; o consentimento sem registro (CHECK
 * contacts_legal_basis_consent_note) ganha a mensagem do campo.
 */
export function relationshipError(error: unknown) {
  if (isOfflineRequestError(error)) return `${OFFLINE_REQUEST_MESSAGE} Seu preenchimento foi preservado.`;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message ?? '') : '';
  if (code === 'P0001' && message.trim()) return message;
  if (code === '23514' && message.includes('contacts_legal_basis_consent_note')) return CONSENT_NOTE_REQUIRED;
  if (code === '42501')
    return 'Seu papel não permite esta ação. Peça a um dono ou administrador para revisar seu acesso.';
  if (code === '23503') {
    const blocker = blockingTableLabel(error);
    return blocker
      ? `Este cadastro ainda está vinculado a ${blocker}. Resolva esses vínculos antes desta alteração.`
      : 'Este cadastro possui vínculos que precisam ser resolvidos antes desta alteração.';
  }
  if (code === '23505') return 'Já existe um cadastro com estes dados. Revise o registro antes de salvar.';
  return 'Não foi possível concluir a operação. Seu preenchimento foi preservado. Verifique a conexão e tente novamente.';
}
/**
 * Tipos de atividade, na ordem dos seletores e filtros. WhatsApp e visita chegaram no item 1.9. Os valores ficam em
 * inglês no banco (CHECK de activities.type) e os rótulos em pt-BR aqui; um tipo novo entra nas três listas abaixo.
 */
export const ACTIVITY_LABELS: Record<string, string> = {
  task: 'Tarefa',
  call: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  meeting: 'Reunião',
  visit: 'Visita',
  note: 'Nota',
};
/** Os mesmos tipos no plural, para filtros como "Ligações" e "Visitas". */
export const ACTIVITY_PLURAL_LABELS: Record<string, string> = {
  task: 'Tarefas',
  call: 'Ligações',
  whatsapp: 'WhatsApp',
  email: 'E-mails',
  meeting: 'Reuniões',
  visit: 'Visitas',
  note: 'Notas',
};
/** Compromissos: têm início e término, aparecem na Agenda e pedem o horário no formulário. */
export const APPOINTMENT_TYPES: readonly string[] = ['meeting', 'call', 'visit'];
/** Canais que o CRM abre (WhatsApp, e-mail e telefone) e cujo registro é oferecido. */
export const CHANNEL_TYPES = ['call', 'whatsapp', 'email'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const isChannelType = (type: string | null | undefined): type is ChannelType =>
  (CHANNEL_TYPES as readonly string[]).includes(type ?? '');
/** Resultado da ligação concluída (activities.outcome). */
export const OUTCOME_LABELS: Record<string, string> = {
  answered: 'Atendeu',
  no_answer: 'Não atendeu',
  voicemail: 'Caixa postal',
};
export function displayDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sem prazo';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
export function localDateTime(value: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export const CONTACT_STATUS_LABELS: Record<string, string> = {
  lead: 'Lead',
  prospect: 'Em prospecção',
  customer: 'Cliente',
  churned: 'Encerrado',
};
