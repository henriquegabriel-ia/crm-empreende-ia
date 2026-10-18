// Origem do lead (item 1.14; docs/arquitetura/1.14.md): uma lista fixa em pt-BR, com os nomes dos canais do item 1.9
// (WhatsApp, Telefone e E-mail) mais Site e Indicação. A coluna contacts.source continua texto livre, sem migração: o
// cadastro e a importação gravam o nome da lista ("WhatsApp"), e um valor fora dela, como os que já existem em
// instâncias com dados ou que chegam por uma planilha ("Feira de outubro"), fica como foi escrito. Na tela, o valor da
// lista aparece pelo nome dela, e o de fora, como está; nos filtros, ele entra em "Outras origens".

export const LEAD_SOURCES = [
  { key: 'whatsapp', label: 'WhatsApp', synonyms: ['whatsapp', 'whats', 'wpp', 'zap', 'zapzap'] },
  { key: 'phone', label: 'Telefone', synonyms: ['telefone', 'ligacao', 'telefonema', 'fone', 'phone'] },
  { key: 'email', label: 'E-mail', synonyms: ['email'] },
  { key: 'website', label: 'Site', synonyms: ['site', 'website'] },
  { key: 'referral', label: 'Indicação', synonyms: ['indicacao', 'indicado', 'indicada', 'referral'] },
] as const;
export type LeadSourceKey = (typeof LEAD_SOURCES)[number]['key'];

/** Como o texto é comparado com a lista: sem acentos, maiúsculas, espaços nem pontuação ("E-mail" = "email"). */
const comparable = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]/g, '');

const BY_SYNONYM = new Map<string, (typeof LEAD_SOURCES)[number]>(
  LEAD_SOURCES.flatMap((source) => source.synonyms.map((synonym) => [synonym, source] as const)),
);

const sourceOf = (value: string | null | undefined) => (value?.trim() ? BY_SYNONYM.get(comparable(value)) : undefined);

/** A origem da lista que o texto representa, pelo texto inteiro ("whats", "Indicacao"); nula fora da lista ou vazio. */
export function leadSourceKey(value: string | null | undefined): LeadSourceKey | null {
  return sourceOf(value)?.key ?? null;
}

/**
 * Como a origem aparece: o nome da lista ("zap" vira "WhatsApp") ou, fora dela, o texto como foi escrito, numa linha
 * só; nula quando vazia. Também é o que o cadastro e a importação gravam.
 */
export function leadSourceLabel(value: string | null | undefined): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return sourceOf(text)?.label ?? text;
}

/** Filtro de origem em "Contatos": todas, uma da lista, as de fora da lista ou sem origem. */
export type LeadSourceFilter = 'all' | LeadSourceKey | 'other' | 'none';
export const LEAD_SOURCE_FILTER_LABELS: Record<LeadSourceFilter, string> = {
  all: 'Todas as origens',
  ...(Object.fromEntries(LEAD_SOURCES.map((source) => [source.key, source.label])) as Record<LeadSourceKey, string>),
  other: 'Outras origens',
  none: 'Sem origem',
};
export const isLeadSourceFilter = (value: unknown): value is LeadSourceFilter =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEAD_SOURCE_FILTER_LABELS, value);

export function matchesLeadSource(value: string | null | undefined, filter: LeadSourceFilter) {
  if (filter === 'all') return true;
  if (!value?.trim()) return filter === 'none';
  const key = leadSourceKey(value);
  return filter === 'other' ? key === null : key === filter;
}

/** O que o campo "Origem" mostra: sem origem, uma da lista ou "Outra", com o texto livre. */
export type LeadSourceChoice = 'none' | LeadSourceKey | 'other';
export function leadSourceChoice(value: string | null | undefined): { choice: LeadSourceChoice; other: string } {
  if (!value?.trim()) return { choice: 'none', other: '' };
  const key = leadSourceKey(value);
  return key ? { choice: key, other: '' } : { choice: 'other', other: value.trim() };
}
/** O texto gravado a partir da escolha: o nome da lista ou o texto de "Outra" (que vira o da lista se for um deles). */
export function leadSourceFromChoice(choice: LeadSourceChoice, other: string): string {
  if (choice === 'none') return '';
  if (choice === 'other') return leadSourceLabel(other) ?? '';
  return LEAD_SOURCES.find((source) => source.key === choice)?.label ?? '';
}
