/** Mostrada quando o link colado ou o ?invite= da URL não traz o ID completo do convite. */
export const INCOMPLETE_INVITE_MESSAGE = 'Este link de convite está incompleto. Copie o link inteiro que você recebeu.';

// O ID do convite é o UUID de public.invitations, sem diferenciar maiúsculas.
const INVITATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isInvitationId(value: string | null | undefined): value is string {
  return typeof value === 'string' && INVITATION_ID.test(value.trim());
}

/** O ID em minúsculas e sem espaços, ou null quando não é um ID de convite (vazio, cortado, outro texto). */
export function normalizeInvitationId(value: string | null | undefined): string | null {
  return isInvitationId(value) ? value.trim().toLowerCase() : null;
}

export type InviteLinkResult = { ok: true; id: string } | { ok: false; message: string };

/**
 * Lê o que a pessoa colou em "Recebi um convite": o link inteiro (de qualquer endereço, com outros parâmetros, com ou
 * sem https://) ou só o ID. Espaços nas pontas, maiúsculas e os sinais < > que alguns e-mails põem em volta do link
 * são ignorados. Um link com dois convites diferentes, ou sem nenhum ID completo, é recusado.
 */
export function parseInviteLink(input: string): InviteLinkResult {
  const text = input
    .trim()
    .replace(/^<+|>+$/g, '')
    .trim();
  const direct = normalizeInvitationId(text);
  if (direct) return { ok: true, id: direct };
  const query = text.indexOf('?');
  if (query !== -1) {
    const params = new URLSearchParams(text.slice(query + 1).split('#')[0]);
    const ids = new Set(params.getAll('invite').map((value) => normalizeInvitationId(value)));
    const [only] = ids;
    if (ids.size === 1 && only) return { ok: true, id: only };
  }
  return { ok: false, message: INCOMPLETE_INVITE_MESSAGE };
}
