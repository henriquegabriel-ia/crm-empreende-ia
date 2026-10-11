/**
 * Valores em reais no padrão brasileiro (decisão D7 do roteiro).
 *
 * Regras de `parseBRL`:
 * - aceita o prefixo "R$" e espaços nas pontas;
 * - com vírgula, a vírgula é o separador decimal e os pontos são de milhar, em grupos de 3 dígitos
 *   ("1.500,00", "1500,5");
 * - sem vírgula, "1.500" e "12.345.678" são milhar; um único ponto seguido de 1 ou 2 dígitos é decimal
 *   ("12.5" = 12,50);
 * - no máximo 2 casas decimais;
 * - recusa (devolve `null`) vazio, negativo, notação científica, valores acima do limite e formatos
 *   ambíguos, como "1.2345", "0.500" e "1,234,5".
 */

/** Maior valor aceito nos formulários, dentro do numeric(16,2) do banco. */
export const MAX_BRL_VALUE = 999_999_999_999.99;

const CURRENCY_PREFIX = /^R\$\s*/i;
const GROUPED_INTEGER = '[1-9]\\d{0,2}(?:\\.\\d{3})+';
const COMMA_DECIMAL = new RegExp(`^(\\d+|${GROUPED_INTEGER}),(\\d{1,2})$`);
const THOUSANDS_ONLY = new RegExp(`^${GROUPED_INTEGER}$`);
const DOT_DECIMAL = /^(\d+)\.(\d{1,2})$/;
const PLAIN_INTEGER = /^\d+$/;

export function parseBRL(text: string): number | null {
  if (typeof text !== 'string') return null;
  const value = text.trim().replace(CURRENCY_PREFIX, '').trim();
  let integer: string;
  let decimals = '';
  const comma = value.match(COMMA_DECIMAL);
  const dot = value.match(DOT_DECIMAL);
  if (comma) {
    integer = comma[1].replace(/\./g, '');
    decimals = comma[2];
  } else if (THOUSANDS_ONLY.test(value)) integer = value.replace(/\./g, '');
  else if (dot) {
    integer = dot[1];
    decimals = dot[2];
  } else if (PLAIN_INTEGER.test(value)) integer = value;
  else return null;
  const number = Number(decimals ? `${integer}.${decimals}` : integer);
  return Number.isFinite(number) && number <= MAX_BRL_VALUE ? number : null;
}

const BRL_CURRENCY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BRL_INPUT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Exibição: "R$ 1.500,00" (o Intl separa o símbolo com espaço não separável). */
export function formatBRL(value: number): string {
  return BRL_CURRENCY.format(value);
}

/** Texto para um campo editável: "1.500,00", que `parseBRL` lê de volta sem perda. */
export function formatBRLInput(value: number): string {
  return BRL_INPUT.format(value);
}
