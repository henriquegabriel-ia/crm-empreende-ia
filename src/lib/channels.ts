import { formatPhoneBR, internationalE164, normalizePhoneBR } from '@/lib/phone';

/**
 * Canais nível 1 (item 1.9; docs/arquitetura/1.9.md, seção 5.2): o CRM abre o aplicativo da pessoa e nunca envia nada.
 * Todo link de canal nasce aqui, e nenhuma tela monta link à mão:
 * - uma codificação por parâmetro (`encodeURIComponent` sobre o texto final, nunca sobre um texto já codificado);
 * - o endereço de e-mail codificado, com o "@" de volta, para um "?" ou um "&" gravados no cadastro não virarem
 *   parâmetro nem destinatário;
 * - um limite único de 2.000 caracteres por URL, o limite prático do `mailto:` no Outlook para Windows;
 * - nos parâmetros que vão para o WhatsApp, o Google ou a Microsoft, só o número ou o endereço, o assunto e o texto
 *   revisado pela pessoa: nada de id, endereço do CRM ou rastreio.
 */

/** Tamanho máximo de uma URL de canal, em caracteres. Acima dele, a tela copia o texto e abre sem ele. */
export const CHANNEL_URL_MAX = 2000;

export type ChannelPhoneKind = 'mobile' | 'landline' | 'international';
export interface ChannelPhone {
  /** "+5511999990000". */
  e164: string;
  /** Só dígitos, sem o "+": o formato do wa.me. */
  digits: string;
  kind: ChannelPhoneKind;
  /** "(11) 99999-0000" para o Brasil; o próprio E.164 para outro país. */
  display: string;
}

/** Brasileiro reconhecido, ou E.164 de outro país (+ e 8 a 15 dígitos, sem o 55); nulo para os demais. */
export function channelPhone(stored: string | null | undefined): ChannelPhone | null {
  const brazil = normalizePhoneBR(stored);
  if (brazil.e164 && brazil.kind !== 'invalid')
    return { e164: brazil.e164, digits: brazil.e164.slice(1), kind: brazil.kind, display: formatPhoneBR(brazil.e164) };
  const international = internationalE164(stored);
  if (international)
    return { e164: international, digits: international.slice(1), kind: 'international', display: international };
  return null;
}

/** Um único endereço de e-mail, aparado (até 254 caracteres, com "@" e domínio com ponto); nulo para os demais. */
export function channelEmail(stored: string | null | undefined): string | null {
  const value = (stored ?? '').trim();
  if (!value || value.length > 254) return null;
  return /^[^\s@,;<>"'()[\]\\]+@[^\s@,;<>"'()[\]\\?&=/#%]+\.[^\s@,;<>"'()[\]\\?&=/#%]+$/.test(value) ? value : null;
}

/** Caracteres substitutos isolados (texto colado quebrado) viram U+FFFD: `encodeURIComponent` lança URIError com eles. */
function wellFormed(text: string) {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
}

/**
 * Texto de um parâmetro, codificado uma vez. Quebras "\r\n" e "\r" viram "\n" (%0A); no `mailto:`, o corpo usa
 * %0D%0A, como pede a RFC 6068.
 */
export function encodeChannelText(text: string, crlf = false) {
  const encoded = encodeURIComponent(wellFormed(text.replace(/\r\n?/g, '\n')));
  return crlf ? encoded.replace(/%0A/g, '%0D%0A') : encoded;
}

/** O endereço codificado como um destinatário só: "a@b.com?cc=x@y.com" vira "a@b.com%3Fcc%3Dx@y.com". */
export function encodeEmailAddress(email: string) {
  return encodeURIComponent(wellFormed(email.trim())).replace(/%40/g, '@');
}

function query(params: [string, string, boolean?][]) {
  const parts = params
    .filter(([, value]) => value.length > 0)
    .map(([key, value, crlf]) => `${key}=${encodeChannelText(value, crlf)}`);
  return parts.join('&');
}

/** `https://wa.me/5511999990000?text=…`; sem `?text=` quando o texto está vazio. */
export function whatsappUrl(phone: Pick<ChannelPhone, 'digits'>, text = '') {
  return `https://wa.me/${phone.digits}${text.trim() ? `?text=${encodeChannelText(text)}` : ''}`;
}

/** `tel:+5511999990000` (RFC 3966, número global com "+"). */
export function telUrl(phone: Pick<ChannelPhone, 'e164'>) {
  return `tel:${phone.e164}`;
}

export interface EmailDraft {
  to: string;
  subject?: string;
  body?: string;
}

/** `mailto:` com o endereço codificado e `subject` e `body` só quando preenchidos; o corpo com %0D%0A. */
export function mailtoUrl({ to, subject = '', body = '' }: EmailDraft) {
  const params = query([
    ['subject', subject],
    ['body', body, true],
  ]);
  return `mailto:${encodeEmailAddress(to)}${params ? `?${params}` : ''}`;
}

/** Composição do Gmail web: `https://mail.google.com/mail/?view=cm&fs=1&to=…&su=…&body=…`. */
export function gmailComposeUrl({ to, subject = '', body = '' }: EmailDraft) {
  const params = query([
    ['su', subject],
    ['body', body],
  ]);
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeEmailAddress(to)}${params ? `&${params}` : ''}`;
}

/**
 * Composição do Outlook web (contas Microsoft 365 de trabalho ou escola):
 * `https://outlook.office.com/mail/deeplink/compose?to=…&subject=…&body=…`.
 */
export function outlookComposeUrl({ to, subject = '', body = '' }: EmailDraft) {
  const params = query([
    ['subject', subject],
    ['body', body],
  ]);
  return `https://outlook.office.com/mail/deeplink/compose?to=${encodeEmailAddress(to)}${params ? `&${params}` : ''}`;
}

export const fitsChannelUrl = (url: string) => url.length <= CHANNEL_URL_MAX;

/** Destinos do menu "Abrir e-mail". */
export type EmailTarget = 'gmail' | 'outlook' | 'mailto';
export const EMAIL_TARGET_LABELS: Record<EmailTarget, string> = {
  gmail: 'Abrir no Gmail',
  outlook: 'Abrir no Outlook web',
  mailto: 'Abrir no aplicativo de e-mail',
};
const EMAIL_URL: Record<EmailTarget, (draft: EmailDraft) => string> = {
  gmail: gmailComposeUrl,
  outlook: outlookComposeUrl,
  mailto: mailtoUrl,
};

/**
 * O link de um destino do e-mail. Com o texto longo demais, `full` é falso, e o link leva só o destinatário (e o
 * assunto, se couber): a tela copia o texto antes de abrir ("Copiar texto e abrir sem ele").
 */
export function emailLink(target: EmailTarget, draft: EmailDraft): { url: string; full: boolean } {
  const url = EMAIL_URL[target](draft);
  if (fitsChannelUrl(url)) return { url, full: true };
  const withSubject = EMAIL_URL[target]({ to: draft.to, subject: draft.subject });
  return { url: fitsChannelUrl(withSubject) ? withSubject : EMAIL_URL[target]({ to: draft.to }), full: false };
}

/** O link do WhatsApp, ou o link só com o número quando o texto não cabe (`full` falso). */
export function whatsappLink(phone: Pick<ChannelPhone, 'digits'>, text: string): { url: string; full: boolean } {
  const url = whatsappUrl(phone, text);
  return fitsChannelUrl(url) ? { url, full: true } : { url: whatsappUrl(phone), full: false };
}

/**
 * Atributos de todo link externo de canal: aba nova sem acesso de volta ao CRM e sem `Referer`, porque o endereço do
 * CRM leva o id do contato na consulta (/contacts?contact=…). `tel:` e `mailto:` abrem na mesma aba, sem `target` (o
 * aplicativo externo abre sem descarregar o CRM).
 */
export const EXTERNAL_LINK_PROPS = {
  target: '_blank',
  rel: 'noopener noreferrer',
  referrerPolicy: 'no-referrer',
} as const;
export const APP_LINK_PROPS = { rel: 'noopener noreferrer', referrerPolicy: 'no-referrer' } as const;

/** Por que um canal não abre: a frase ligada ao botão desabilitado (`aria-describedby`). */
export const CHANNEL_PROBLEMS = {
  noPhone: 'Cadastre um telefone para usar o WhatsApp e a ligação.',
  invalidPhone: 'Confira o telefone no cadastro: ele precisa do DDD.',
  noEmail: 'Cadastre um e-mail no contato para escrever a ele.',
  invalidEmail: 'Confira o e-mail no cadastro: ele precisa ser um endereço só, como nome@empresa.com.br.',
  noContact: 'Vincule um contato para usar WhatsApp, e-mail e telefone.',
  companyEmail: 'Empresas não têm e-mail no cadastro: use o e-mail de um contato da empresa.',
} as const;

/** Aviso do WhatsApp para um número fixo: avisa e não bloqueia (roteiro). */
export const LANDLINE_WHATSAPP_NOTICE = 'Número fixo: o WhatsApp só funciona se esse número usar o WhatsApp Business.';
export const INTERNATIONAL_NOTICE = 'Número de outro país.';
