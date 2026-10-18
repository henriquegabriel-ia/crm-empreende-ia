import { describe, expect, it } from 'vitest';
import cases from './deal-item-cases.json';
import {
  centsNumber,
  dealItemTotals,
  decimalText,
  lineAmounts,
  MAX_CONTRACT_CENTS,
  MAX_QUANTITY_MILLI,
  unitsOf,
  type DealItemDiscount,
} from './deal-item-math';

type CaseItem = (typeof cases.cases)[number]['items'][number];

const discountOf = (item: Pick<CaseItem, 'discount'>): DealItemDiscount =>
  item.discount === null
    ? null
    : item.discount.type === 'percent'
      ? { type: 'percent', basisPoints: unitsOf(item.discount.value, 2)! }
      : { type: 'amount', cents: unitsOf(item.discount.value, 2)! };

// Item 1.16: a conta em inteiros, conferida contra o mesmo arquivo de casos que o test:db confere no banco.
describe('conta dos itens em inteiros', () => {
  it.each(cases.cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
    const lines = testCase.items.map((item) => ({
      billing: item.billing as 'one_time' | 'monthly',
      ...lineAmounts({
        quantityMilli: unitsOf(item.quantity, 3)!,
        unitPriceCents: unitsOf(item.unitPrice, 2)!,
        discount: discountOf(item),
      }),
    }));
    expect(lines.map((line) => Number(line.totalCents))).toEqual(testCase.items.map((item) => item.lineCents));
    const totals = dealItemTotals(lines, testCase.months);
    expect(Number(totals.oneTimeCents)).toBe(testCase.oneTimeCents);
    expect(Number(totals.monthlyCents)).toBe(testCase.monthlyCents);
    expect(Number(totals.contractCents)).toBe(testCase.contractCents);
  });

  it('arredonda a metade para cima no bruto e no desconto, e o desconto em % sai do bruto já arredondado', () => {
    expect(lineAmounts({ quantityMilli: 500n, unitPriceCents: 1n, discount: null }).grossCents).toBe(1n);
    expect(lineAmounts({ quantityMilli: 499n, unitPriceCents: 1n, discount: null }).grossCents).toBe(0n);
    // 1,005 × R$ 10,00 = R$ 10,05; 50% de R$ 10,05 = R$ 5,025 → R$ 5,03. E 0,333 × R$ 0,03 = R$ 0,00999 → R$ 0,01,
    // cujos 50% (R$ 0,005) → R$ 0,01; sobre o bruto não arredondado, seriam R$ 0,00.
    expect(
      lineAmounts({ quantityMilli: 1005n, unitPriceCents: 1000n, discount: { type: 'percent', basisPoints: 5000n } }),
    ).toEqual({ grossCents: 1005n, discountCents: 503n, totalCents: 502n });
    expect(
      lineAmounts({ quantityMilli: 333n, unitPriceCents: 3n, discount: { type: 'percent', basisPoints: 5000n } }),
    ).toEqual({ grossCents: 1n, discountCents: 1n, totalCents: 0n });
  });

  it('soma as linhas já arredondadas, sem novo arredondamento, e sem meses a mensalidade não entra no contrato', () => {
    const line = { billing: 'one_time' as const, totalCents: 33n };
    expect(dealItemTotals([line, line, line], null).contractCents).toBe(99n);
    expect(dealItemTotals([{ billing: 'monthly', totalCents: 1000n }], null)).toEqual({
      oneTimeCents: 0n,
      monthlyCents: 1000n,
      contractCents: 0n,
    });
  });

  it('usa BigInt nos limites, sem perder centavos', () => {
    const limit = lineAmounts({ quantityMilli: MAX_QUANTITY_MILLI, unitPriceCents: 9_999_999n, discount: null });
    expect(limit.grossCents).toBe(9_999_998_999_990_000n);
    expect(dealItemTotals([{ billing: 'monthly', totalCents: MAX_CONTRACT_CENTS }], 120).contractCents).toBe(
      MAX_CONTRACT_CENTS * 120n,
    );
    expect(centsNumber(MAX_CONTRACT_CENTS)).toBe(99_999_999_999_999);
    expect(() => centsNumber(MAX_CONTRACT_CENTS * 120n)).toThrow(RangeError);
  });

  it('escreve e lê o texto decimal da RPC', () => {
    expect(decimalText(150000n, 2)).toBe('1500.00');
    expect(decimalText(1500n, 3)).toBe('1.500');
    expect(decimalText(5n, 2)).toBe('0.05');
    expect(decimalText(0n, 3)).toBe('0.000');
    expect(unitsOf('1500.00', 2)).toBe(150000n);
    expect(unitsOf(1500.5, 2)).toBe(150050n);
    expect(unitsOf(1.005, 3)).toBe(1005n);
    expect(unitsOf(999999999999.99, 2)).toBe(99_999_999_999_999n);
    expect(unitsOf('1.2345', 3)).toBeNull();
    expect(unitsOf('1e3', 2)).toBeNull();
    expect(unitsOf(-1, 2)).toBeNull();
    expect(unitsOf(Number.NaN, 2)).toBeNull();
  });
});
