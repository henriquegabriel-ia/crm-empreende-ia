/**
 * Variáveis dos modelos de mensagem (item 1.9; docs/arquitetura/1.9.md, seção 5.3). O texto de "Modelos" leva chaves
 * no formato {{chave}}, que os botões "WhatsApp" e "E-mail" trocam pelos dados do cadastro numa passada só: o valor
 * substituído nunca é lido de novo (um contato chamado "{{empresa}}" aparece assim), e a função de troca evita os
 * padrões especiais de `replace` ("R$ 100 $&" chega igual). Uma variável sem dado ou desconhecida fica no texto e
 * bloqueia a abertura até a pessoa completar ou apagar. O texto é sempre texto puro, nunca HTML.
 */

export const MESSAGE_VARIABLES = [
  { key: 'primeiro_nome', label: 'Primeiro nome do contato', example: 'Ana' },
  { key: 'nome', label: 'Nome do contato', example: 'Ana Souza' },
  { key: 'empresa', label: 'Empresa', example: 'Padaria Boa Massa' },
  { key: 'oportunidade', label: 'Oportunidade', example: 'Proposta de site' },
  { key: 'responsavel', label: 'Responsável', example: 'Bruno Lima' },
  { key: 'meu_nome', label: 'Seu nome', example: 'Carla Dias' },
  { key: 'organizacao', label: 'Nome da organização', example: 'Agência Exemplo' },
] as const;
export type MessageVariable = (typeof MESSAGE_VARIABLES)[number]['key'];
const KNOWN = new Set<string>(MESSAGE_VARIABLES.map((variable) => variable.key));

export type MessageContext = Partial<Record<MessageVariable, string | null>>;

/** Qualquer {{…}} sem chaves dentro: a chave conhecida é trocada; o resto ("{{ver anexo}}") é desconhecido. */
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const keyOf = (inner: string) => inner.trim().toLowerCase();

/** Valor aparado, com quebras de linha e tabulações internas trocadas por um espaço. */
function clean(value: string | null | undefined) {
  return (value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
}

export interface RenderedTemplate {
  text: string;
  /** Chaves conhecidas sem dado neste contexto, que ficaram no texto. */
  missing: MessageVariable[];
  /** O que estava entre {{ }} e não é uma variável do CRM, sem as chaves. */
  unknown: string[];
}

export function renderTemplate(text: string, context: MessageContext): RenderedTemplate {
  const missing = new Set<MessageVariable>();
  const unknown = new Set<string>();
  const rendered = text.replace(PLACEHOLDER, (match, inner: string) => {
    const key = keyOf(inner);
    if (!KNOWN.has(key)) {
      unknown.add(inner.trim());
      return match;
    }
    const value = clean(context[key as MessageVariable]);
    if (!value) {
      missing.add(key as MessageVariable);
      return match;
    }
    return value;
  });
  return { text: rendered, missing: [...missing], unknown: [...unknown] };
}

/** As variáveis de um texto: as do CRM e as desconhecidas (o formulário do modelo avisa estas, sem impedir de salvar). */
export function templateVariables(text: string): { known: MessageVariable[]; unknown: string[] } {
  const known = new Set<MessageVariable>();
  const unknown = new Set<string>();
  for (const [, inner] of text.matchAll(PLACEHOLDER)) {
    const key = keyOf(inner);
    if (KNOWN.has(key)) known.add(key as MessageVariable);
    else unknown.add(inner.trim());
  }
  return { known: [...known], unknown: [...unknown] };
}

/** Por que uma variável conhecida ficou sem dado, para a lista "Complete ou apague antes de abrir". */
const MISSING_REASONS: Record<MessageVariable, string> = {
  primeiro_nome: 'esta mensagem não tem contato',
  nome: 'esta mensagem não tem contato',
  empresa: 'sem empresa nesta mensagem',
  oportunidade: 'sem oportunidade nesta mensagem',
  responsavel: 'sem responsável nesta mensagem',
  meu_nome: 'seu perfil está sem nome',
  organizacao: 'a organização está sem nome',
};

export interface PendingVariable {
  /** Como aparece no texto: "{{empresa}}". */
  token: string;
  reason: string;
}

/**
 * O que ainda bloqueia a abertura no texto que a pessoa revisou: cada {{…}} que sobrou, com o motivo. A conferência é
 * sobre o texto atual, então completar ou apagar a variável no campo libera a abertura.
 */
export function pendingVariables(text: string, context: MessageContext): PendingVariable[] {
  const seen = new Map<string, PendingVariable>();
  for (const [token, inner] of text.matchAll(PLACEHOLDER)) {
    const key = keyOf(inner);
    if (seen.has(token)) continue;
    const reason = !KNOWN.has(key)
      ? 'variável desconhecida'
      : clean(context[key as MessageVariable])
        ? 'variável não preenchida'
        : MISSING_REASONS[key as MessageVariable];
    seen.set(token, { token, reason });
  }
  return [...seen.values()];
}

export interface MessageSources {
  contact?: { first_name?: string | null; last_name?: string | null } | null;
  /** A empresa da oportunidade, a do contato ou a própria empresa, nessa ordem. */
  companyName?: string | null;
  dealTitle?: string | null;
  /** Responsável pela oportunidade, senão pelo contato, senão pela empresa, sem a marca "(desativado)". */
  ownerName?: string | null;
  myName?: string | null;
  organizationName?: string | null;
}

/** O contexto das variáveis a partir dos dados da tela que abriu o canal. */
export function messageContext({
  contact,
  companyName,
  dealTitle,
  ownerName,
  myName,
  organizationName,
}: MessageSources): MessageContext {
  const fullName = contact ? [contact.first_name, contact.last_name].map(clean).filter(Boolean).join(' ') : '';
  return {
    primeiro_nome: clean(contact?.first_name).split(' ')[0] || null,
    nome: fullName || null,
    empresa: clean(companyName) || null,
    oportunidade: clean(dealTitle) || null,
    responsavel: clean(ownerName) || null,
    meu_nome: clean(myName) || null,
    organizacao: clean(organizationName) || null,
  };
}
