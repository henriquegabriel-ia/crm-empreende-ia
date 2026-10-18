/**
 * LGPD da empresa controladora (item 1.10; docs/arquitetura/1.10.md). Fonte única dos rótulos e das regras de tela da
 * base legal, da anonimização e da recusa de ações de contato para quem pediu "Não contatar". As regras valem no banco
 * (supabase/migrations/20261013120000_contact_privacy.sql); aqui ficam os espelhos que a tela usa para explicar e
 * desabilitar antes do pedido, e os contratos das RPCs `contact_privacy_summary`, `anonymize_contact` e
 * `export_contact_data`.
 *
 * Num banco sem a migração, as colunas novas não vêm no snapshot: a base conta como "não informada" e o contato, como
 * não anonimizado.
 */

/** As bases legais do art. 7º usadas pelo CRM, na ordem dos seletores. Valores em inglês no banco. */
export const LEGAL_BASES = [
  'not_informed',
  'consent',
  'contract',
  'legitimate_interest',
  'legal_obligation',
  'exercise_of_rights',
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

export const LEGAL_BASIS_LABELS: Readonly<Record<LegalBasis, string>> = {
  not_informed: 'Não informada',
  consent: 'Consentimento',
  contract: 'Contrato ou pedido da pessoa',
  legitimate_interest: 'Legítimo interesse',
  legal_obligation: 'Obrigação legal',
  exercise_of_rights: 'Exercício de direitos',
};

/**
 * Bases que podem ser o padrão da empresa (organizations.default_legal_basis): todas menos consentimento, que é de cada
 * pessoa e exige o registro de como ela consentiu.
 */
export const ORGANIZATION_LEGAL_BASES: readonly LegalBasis[] = LEGAL_BASES.filter((basis) => basis !== 'consent');

/** Tamanho máximo do registro da base legal (CHECK contacts_legal_basis_note_length). */
export const LEGAL_BASIS_NOTE_MAX = 500;

/** Mensagem do consentimento sem registro, a mesma da tela para o CHECK contacts_legal_basis_consent_note (23514). */
export const CONSENT_NOTE_REQUIRED = 'Descreva como a pessoa consentiu.';
export const LEGAL_BASIS_NOTE_TOO_LONG = `Use até ${LEGAL_BASIS_NOTE_MAX} caracteres.`;

export const isLegalBasis = (value: unknown): value is LegalBasis =>
  typeof value === 'string' && (LEGAL_BASES as readonly string[]).includes(value);

/** A base gravada no contato; ausente (banco sem a migração) ou desconhecida, "não informada". */
export function legalBasisOf(contact: { legal_basis?: string | null } | null | undefined): LegalBasis {
  const value = contact?.legal_basis;
  return isLegalBasis(value) ? value : 'not_informed';
}

/** O padrão da empresa; ausente, desconhecido ou consentimento (nunca gravado pelo banco), "não informada". */
export function organizationLegalBasisOf(
  organization: { default_legal_basis?: string | null } | null | undefined,
): LegalBasis {
  const value = organization?.default_legal_basis;
  return isLegalBasis(value) && value !== 'consent' ? value : 'not_informed';
}

export const legalBasisLabel = (value: string | null | undefined) =>
  LEGAL_BASIS_LABELS[legalBasisOf({ legal_basis: value })];

/**
 * Escolha do campo "Base legal" no cadastro de um contato novo: o padrão da empresa (nada é enviado e o banco preenche)
 * ou uma base explícita.
 */
export const COMPANY_DEFAULT_CHOICE = 'company_default';
export type LegalBasisChoice = LegalBasis | typeof COMPANY_DEFAULT_CHOICE;

/** "Padrão da empresa: Legítimo interesse", a primeira opção do campo na criação. */
export function companyDefaultLabel(defaultBasis: string | null | undefined) {
  return `Padrão da empresa: ${legalBasisLabel(defaultBasis)}`;
}

/**
 * Erro do registro antes do pedido: consentimento sem registro (aparado) e registro acima de 500 caracteres. Na escolha
 * do padrão da empresa, a base efetiva é o padrão, que nunca é consentimento.
 */
export function legalBasisNoteError(choice: LegalBasisChoice, note: string | null | undefined): string | null {
  const text = (note ?? '').trim();
  if (text.length > LEGAL_BASIS_NOTE_MAX) return LEGAL_BASIS_NOTE_TOO_LONG;
  if (choice === 'consent' && !text) return CONSENT_NOTE_REQUIRED;
  return null;
}

/**
 * O que a gravação do cadastro envia da base legal: só o que mudou, como o resultado da ligação no 1.9 (num banco sem a
 * migração, criar e editar continuam funcionando enquanto a base não é tocada). Na criação, o padrão da empresa não
 * envia a base (o banco aplica o padrão), e o registro vai só quando preenchido. A data e o autor nunca vão: o banco
 * carimba.
 */
export function legalBasisChanges(
  original: { legal_basis?: string | null; legal_basis_note?: string | null } | null,
  choice: LegalBasisChoice,
  note: string | null | undefined,
): { legal_basis?: LegalBasis; legal_basis_note?: string | null } {
  const text = (note ?? '').trim() || null;
  const changes: { legal_basis?: LegalBasis; legal_basis_note?: string | null } = {};
  if (!original) {
    if (choice !== COMPANY_DEFAULT_CHOICE) changes.legal_basis = choice;
    if (text) changes.legal_basis_note = text;
    return changes;
  }
  const basis = choice === COMPANY_DEFAULT_CHOICE ? legalBasisOf(original) : choice;
  if (basis !== legalBasisOf(original)) changes.legal_basis = basis;
  if (text !== ((original.legal_basis_note ?? '').trim() || null)) changes.legal_basis_note = text;
  return changes;
}

/** O contato foi anonimizado (anonymized_at preenchido); ausente (banco sem a migração), falso. */
export const isAnonymized = (contact: { anonymized_at?: string | null } | null | undefined) => !!contact?.anonymized_at;

/** Nome que o banco grava no cadastro anonimizado. */
export const ANONYMIZED_CONTACT_NAME = 'Contato anonimizado';

/**
 * Atividade de um contato anonimizado: fica no histórico, com o título pelo tipo, e não pode ser editada nem reaberta
 * (gatilho guard_anonymized_contact). As telas tiram "Editar" e "Reabrir" dela; excluir segue as regras de sempre.
 */
export function isFrozenActivity(
  activity: { contact_id?: string | null },
  contactById: ReadonlyMap<string, { anonymized_at?: string | null }>,
): boolean {
  return !!activity.contact_id && isAnonymized(contactById.get(activity.contact_id));
}

/**
 * Contatos que podem receber um vínculo novo (atividade, oportunidade, recebimento): o anonimizado fica de fora, porque
 * o banco recusa. Numa edição, o contato atual continua na lista, para o seletor mostrar o valor.
 */
export function linkableContacts<T extends { id: string; anonymized_at?: string | null }>(
  contacts: readonly T[],
  currentId?: string | null,
): T[] {
  return contacts.filter((contact) => !isAnonymized(contact) || contact.id === currentId);
}

/** A palavra digitada para confirmar a anonimização. */
export const ANONYMIZE_CONFIRMATION_WORD = 'ANONIMIZAR';

/** Confirmação digitada: sem diferenciar maiúsculas e sem os espaços das pontas. */
export const isAnonymizeConfirmation = (text: string | null | undefined) =>
  (text ?? '').trim().toLocaleUpperCase('pt-BR') === ANONYMIZE_CONFIRMATION_WORD;

/** Ações registradas em privacy_actions. */
export const PRIVACY_ACTION_LABELS: Readonly<Record<string, string>> = {
  export: 'Exportação',
  anonymize: 'Anonimização',
};

/**
 * Ação de contato planejada (gatilho refuse_do_not_contact_action): atividade pendente de ligação, WhatsApp, e-mail,
 * reunião ou visita. Tarefas e notas são trabalho interno e passam.
 */
export const PLANNED_CONTACT_TYPES = ['call', 'whatsapp', 'email', 'meeting', 'visit'] as const;
/** Sem contato na atividade, a marca da empresa recusa só os tipos que usam o telefone dela. */
export const COMPANY_PHONE_TYPES = ['call', 'whatsapp'] as const;

/** As mesmas mensagens do banco, para a tela explicar antes do pedido. */
export const CONTACT_DO_NOT_CONTACT_REFUSAL =
  'Este contato está marcado como “Não contatar”: o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele. Registre como concluído o que já aconteceu, ou use uma tarefa para o trabalho interno.';
export const COMPANY_DO_NOT_CONTACT_REFUSAL =
  'Esta empresa está marcada como “Não contatar”: o CRM não agenda ligação nem WhatsApp para o telefone dela. Use o contato de uma pessoa liberada, ou uma tarefa.';

/**
 * O alvo de uma atividade: o contato dela e, sem contato, a empresa. A marca de uma empresa não alcança os contatos
 * dela (1.9): com um contato liberado, a empresa marcada não recusa nada.
 */
export interface PlannedActionTarget {
  contact?: { do_not_contact?: boolean | null } | null;
  company?: { do_not_contact?: boolean | null } | null;
}

/** Os tipos que o banco recusa como atividade pendente para este alvo (vazio quando nada é recusado). */
export function refusedPlannedTypes(target: PlannedActionTarget): ReadonlySet<string> {
  if (target.contact) return new Set(target.contact.do_not_contact ? PLANNED_CONTACT_TYPES : []);
  return new Set(target.company?.do_not_contact ? COMPANY_PHONE_TYPES : []);
}

/** A recusa do banco para uma atividade pendente deste tipo e deste alvo, ou nulo quando passa. */
export function plannedActionRefusal(type: string, target: PlannedActionTarget): string | null {
  if (!refusedPlannedTypes(target).has(type)) return null;
  return target.contact ? CONTACT_DO_NOT_CONTACT_REFUSAL : COMPANY_DO_NOT_CONTACT_REFUSAL;
}

/** Contagens de `anonymize_contact` (e do resumo): o que mudou, registro por registro. */
export interface AnonymizationCounts {
  /** Atividades com a pessoa (concluídas e notas) que ficaram sem título e sem detalhes. */
  activities_scrubbed: number;
  /** Ações pendentes com a pessoa, excluídas. */
  activities_deleted: number;
  /** Oportunidades da pessoa, que perdem o vínculo e os termos. */
  deals: number;
  /** Das oportunidades da pessoa, as que continuam em aberto (sem o contato). */
  open_deals: number;
  /** Recebimentos da pessoa e das oportunidades dela. */
  payments: number;
  /** Desses recebimentos, os pendentes. */
  pending_payments: number;
  /** Outros registros da organização que citam o nome completo, o e-mail ou o telefone (ou, nas oportunidades dela, o nome). */
  other_records: number;
}

/** Resultado de `contact_privacy_summary`: a versão do contato (updated_at, enviada de volta em p_version) e as contagens. */
export interface PrivacySummary extends AnonymizationCounts {
  version: string;
  anonymized_at: string | null;
}

const COUNT_KEYS = [
  'activities_scrubbed',
  'activities_deleted',
  'deals',
  'open_deals',
  'payments',
  'pending_payments',
  'other_records',
] as const satisfies readonly (keyof AnonymizationCounts)[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function countsOf(value: Record<string, unknown>): AnonymizationCounts {
  const counts = {} as AnonymizationCounts;
  for (const key of COUNT_KEYS) {
    const count = value[key];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0)
      throw new Error(`Resposta inesperada do banco: ${key}.`);
    counts[key] = count;
  }
  return counts;
}

/** Lê a resposta de `contact_privacy_summary`; uma resposta fora do contrato vira erro, sem contagens inventadas. */
export function parsePrivacySummary(value: unknown): PrivacySummary {
  if (!isRecord(value)) throw new Error('Resposta inesperada do banco.');
  const { version, anonymized_at: anonymizedAt } = value;
  if (typeof version !== 'string' || !version) throw new Error('Resposta inesperada do banco: version.');
  if (anonymizedAt !== null && anonymizedAt !== undefined && typeof anonymizedAt !== 'string')
    throw new Error('Resposta inesperada do banco: anonymized_at.');
  return { version, anonymized_at: typeof anonymizedAt === 'string' ? anonymizedAt : null, ...countsOf(value) };
}

/** Lê a resposta de `anonymize_contact`. */
export function parseAnonymizationCounts(value: unknown): AnonymizationCounts {
  if (!isRecord(value)) throw new Error('Resposta inesperada do banco.');
  return countsOf(value);
}

/** Uma linha de privacy_actions (sem dado do titular: só o id do contato e as contagens). */
export interface PrivacyActionRow {
  id: string;
  org_id: string;
  contact_id: string | null;
  action: string;
  performed_by: string | null;
  summary: unknown;
  created_at: string;
}
