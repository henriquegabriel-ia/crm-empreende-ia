/**
 * Telefones do Brasil: normalização para E.164 (+55 DDD número) e formatação para exibição.
 *
 * - Celular: 9 dígitos depois do DDD, começando com 9.
 * - Fixo: 8 dígitos depois do DDD, começando com 2, 3, 4 ou 5.
 * - Aceita "+55", "55" (em números com 12 ou 13 dígitos), o prefixo de longa distância "0", parênteses,
 *   espaços, hífen e ponto. Número sem DDD, DDD inexistente, número de outro país, ramal ou letras
 *   resultam em `invalid`.
 */

export type PhoneKind = 'mobile' | 'landline' | 'invalid';

export interface NormalizedPhone {
  /** "+55DDNNNNNNNNN" para números válidos; `null` quando inválido. */
  e164: string | null;
  kind: PhoneKind;
}

/** DDDs em uso no Brasil, conforme o plano de numeração da Anatel. */
export const BRAZIL_DDDS: ReadonlySet<string> = new Set([
  ...['11', '12', '13', '14', '15', '16', '17', '18', '19'],
  ...['21', '22', '24', '27', '28'],
  ...['31', '32', '33', '34', '35', '37', '38'],
  ...['41', '42', '43', '44', '45', '46', '47', '48', '49'],
  ...['51', '53', '54', '55'],
  ...['61', '62', '63', '64', '65', '66', '67', '68', '69'],
  ...['71', '73', '74', '75', '77', '79'],
  ...['81', '82', '83', '84', '85', '86', '87', '88', '89'],
  ...['91', '92', '93', '94', '95', '96', '97', '98', '99'],
]);

const INVALID: NormalizedPhone = { e164: null, kind: 'invalid' };
const ALLOWED_CHARACTERS = /^\+?[\d\s().-]+$/;

export function normalizePhoneBR(text: string | null | undefined): NormalizedPhone {
  const value = (text ?? '').trim();
  if (!ALLOWED_CHARACTERS.test(value)) return INVALID;
  let digits = value.replace(/\D/g, '');
  if (value.startsWith('+')) {
    if (!digits.startsWith('55')) return INVALID;
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) digits = digits.slice(1);
  else if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return INVALID;
  const ddd = digits.slice(0, 2);
  const number = digits.slice(2);
  if (!BRAZIL_DDDS.has(ddd)) return INVALID;
  if (number.length === 9 && number.startsWith('9')) return { e164: `+55${digits}`, kind: 'mobile' };
  if (number.length === 8 && /^[2-5]/.test(number)) return { e164: `+55${digits}`, kind: 'landline' };
  return INVALID;
}

/** "(11) 99999-0000" ou "(11) 3000-0000"; um número não reconhecido volta como foi digitado. */
export function formatPhoneBR(text: string | null | undefined): string {
  const { e164 } = normalizePhoneBR(text);
  if (!e164) return (text ?? '').trim();
  const number = e164.slice(5);
  return `(${e164.slice(3, 5)}) ${number.slice(0, -4)}-${number.slice(-4)}`;
}
