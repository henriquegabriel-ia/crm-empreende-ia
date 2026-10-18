/**
 * A conta dos itens da oportunidade (item 1.16; docs/arquitetura/1.16.md, seções 4.3 e 5.1), em inteiros: quantidade em
 * milésimos, preços e valores em centavos e percentual em centésimos de ponto, com `bigint` na multiplicação. Nenhum
 * valor em dinheiro passa por ponto flutuante.
 *
 * É a mesma conta da coluna gerada `deal_items.line_total` e de `private.save_deal`:
 * 1. bruto = round(quantidade × preço unitário, 2);
 * 2. desconto = em %: round(bruto × percentual / 100, 2); em R$: o valor; sem desconto: 0;
 * 3. total da linha = bruto − desconto;
 * 4. total único = soma das linhas com cobrança única; mensalidade = soma das linhas mensais;
 * 5. valor do contrato = total único + mensalidade × meses do contrato.
 * O `round` do PostgreSQL arredonda a metade para longe do zero, o que, com valores nunca negativos, é "metade para cima":
 * aqui, `(a + metade) / divisor` em inteiros. Os totais somam linhas já arredondadas, sem novo arredondamento, então a
 * soma das linhas exibidas é sempre o total exibido. `src/lib/deal-item-cases.json` confere esta conta no Vitest e a do
 * banco no `npm run test:db`.
 *
 * Sem importação nenhuma (nem `@/`): a fixture do E2E importa este módulo por caminho relativo para emular a RPC com a
 * mesma conta, e as mensagens de recusa ficam aqui pelo mesmo motivo (as mesmas palavras de `private.save_deal`).
 */

/** Maior bruto de uma linha e maior valor de contrato: R$ 999.999.999.999,99, o limite do numeric(16,2). */
export const MAX_LINE_CENTS = 99_999_999_999_999n;
export const MAX_CONTRACT_CENTS = 99_999_999_999_999n;
/** Maior preço unitário, em centavos (o mesmo limite). */
export const MAX_UNIT_PRICE_CENTS = 99_999_999_999_999n;
/** Maior quantidade, em milésimos: 999.999.999,999 (numeric(12,3)). */
export const MAX_QUANTITY_MILLI = 999_999_999_999n;
/** 100% em centésimos de ponto. */
export const MAX_DISCOUNT_BASIS_POINTS = 10_000n;
/** Itens por oportunidade e meses do contrato (os CHECK do banco e a RPC). */
export const MAX_DEAL_ITEMS = 100;
export const MIN_CONTRACT_MONTHS = 1;
export const MAX_CONTRACT_MONTHS = 120;

export type DealItemBilling = 'one_time' | 'monthly';

/** Desconto de uma linha: em % (centésimos de ponto: 12,5% = 1250n) ou em R$ (centavos). */
export type DealItemDiscount = { type: 'percent'; basisPoints: bigint } | { type: 'amount'; cents: bigint } | null;

export interface DealLineInput {
  quantityMilli: bigint;
  unitPriceCents: bigint;
  discount: DealItemDiscount;
}

export interface DealLineAmounts {
  grossCents: bigint;
  discountCents: bigint;
  totalCents: bigint;
}

/** Bruto, desconto e total de uma linha, em centavos. */
export function lineAmounts({ quantityMilli, unitPriceCents, discount }: DealLineInput): DealLineAmounts {
  const grossCents = (quantityMilli * unitPriceCents + 500n) / 1000n;
  const discountCents =
    discount === null
      ? 0n
      : discount.type === 'percent'
        ? (grossCents * discount.basisPoints + 5_000n) / 10_000n
        : discount.cents;
  return { grossCents, discountCents, totalCents: grossCents - discountCents };
}

export interface DealItemTotals {
  oneTimeCents: bigint;
  monthlyCents: bigint;
  contractCents: bigint;
}

/** Total único, mensalidade e valor do contrato. Sem meses (nulo), a mensalidade não entra no contrato. */
export function dealItemTotals(
  lines: readonly { billing: DealItemBilling; totalCents: bigint }[],
  months: number | null,
): DealItemTotals {
  let oneTimeCents = 0n;
  let monthlyCents = 0n;
  for (const line of lines) {
    if (line.billing === 'monthly') monthlyCents += line.totalCents;
    else oneTimeCents += line.totalCents;
  }
  const contractCents = oneTimeCents + monthlyCents * BigInt(months ?? 0);
  return { oneTimeCents, monthlyCents, contractCents };
}

/** O texto decimal que vai para a RPC: `decimalText(150000n, 2)` = "1500.00"; `decimalText(1500n, 3)` = "1.500". */
export function decimalText(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const integer = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${integer}${scale > 0 ? `.${fraction}` : ''}`;
}

const DECIMAL_TEXT = /^(\d+)(?:\.(\d+))?$/;

/**
 * O contrário de `decimalText`, para o que vem do banco: o PostgREST devolve numeric como número do JSON (1500.5) e a
 * RPC devolve o mesmo dentro do JSON. `String(1500.5)` é a representação mais curta do valor ("1500.5"), sem o erro de
 * multiplicar por 100 em ponto flutuante (1.005 × 100 = 100.49999…). Nulo para texto fora do formato ou com mais casas
 * que `scale`.
 */
export function unitsOf(value: number | string, scale: number): bigint | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
  const match = text.match(DECIMAL_TEXT);
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > scale) return null;
  return BigInt(match[1] + fraction.padEnd(scale, '0'));
}

/** Centavos como `number`, depois de conferido o limite (sempre abaixo de `Number.MAX_SAFE_INTEGER`). */
export function centsNumber(cents: bigint): number {
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Valor fora do limite.');
  return Number(cents);
}

/**
 * Recusas, nas mesmas palavras de `private.save_deal` (que acrescenta "Item N (nome): " antes das que são de um item, e
 * as escreve com a inicial minúscula depois dos dois-pontos). A tela as mostra junto do campo.
 */
export const DEAL_ITEM_MESSAGES = {
  name: 'Informe o nome do item.',
  nameTooLong: 'O nome do item passa de 160 caracteres.',
  unitTooLong: 'A unidade passa de 20 caracteres.',
  quantity: 'Informe uma quantidade maior que zero, com até 3 casas decimais.',
  quantityTooLarge: 'A quantidade passa do limite de 999.999.999,999.',
  unitPrice: 'Informe um preço unitário positivo ou zero, com até duas casas decimais.',
  unitPriceTooLarge: 'O preço unitário passa do limite de R$ 999.999.999.999,99.',
  lineTooLarge: 'O total da linha passa do limite de R$ 999.999.999.999,99. Revise a quantidade e o preço.',
  discountPercent: 'O desconto em % precisa ser maior que 0 e até 100, com até duas casas decimais.',
  discountAmount: 'Informe o desconto em R$ com até duas casas decimais, até o valor bruto da linha.',
  billing: 'Escolha a cobrança: única ou mensal.',
  archived: (name: string) => `“${name}” foi arquivado no catálogo. Escolha outro item ou use um item avulso.`,
  productMissing:
    'Um item do catálogo usado nesta oportunidade foi excluído. Escolha outro item ou use um item avulso.',
  tooMany: 'Uma oportunidade tem no máximo 100 itens.',
  months: 'Informe por quantos meses o contrato vale, de 1 a 120.',
  contractTooLarge: 'O valor do contrato passa do limite de R$ 999.999.999.999,99. Revise as quantidades e os preços.',
  valueFromItems: 'O valor desta oportunidade vem dos itens. Para mudar o valor, edite os itens.',
  conflict:
    'Esta oportunidade mudou ou não está mais disponível. Seus dados continuam no formulário; feche, confira a versão atual e edite de novo.',
} as const;
