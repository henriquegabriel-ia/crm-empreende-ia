import { describe, expect, it } from 'vitest';
import { formatBRL, formatBRLInput, MAX_BRL_VALUE, parseBRL } from '@/lib/money';

describe('parseBRL: valores digitados no padrão brasileiro (D7)', () => {
  it.each([
    ['1.500,00', 1500],
    ['1.500', 1500],
    ['1500,5', 1500.5],
    ['12.5', 12.5],
    ['R$ 2.000', 2000],
    ['1.234,56', 1234.56],
    ['1.000,25', 1000.25],
    ['1.234', 1234],
    ['12.345.678,9', 12345678.9],
    ['1.000.000', 1000000],
    ['100.000', 100000],
    ['1500.25', 1500.25],
    ['0,99', 0.99],
    ['0.5', 0.5],
    ['0', 0],
    ['1500', 1500],
    [' 7 ', 7],
    ['R$1.500,00', 1500],
    ['r$ 10,5', 10.5],
    ['  R$   2.500,10  ', 2500.1],
    ['R$\u00a01.500,00', 1500],
  ])('aceita %j como %d', (input, expected) => expect(parseBRL(input)).toBe(expected));

  it.each([
    ['', 'vazio'],
    ['   ', 'só espaços'],
    ['R$', 'só o símbolo'],
    ['-1', 'negativo'],
    ['R$ -1,00', 'negativo com símbolo'],
    ['abc', 'texto'],
    ['1.2345', 'ponto com quatro casas'],
    ['1,234,5', 'duas vírgulas'],
    ['1,234', 'vírgula com três casas'],
    ['1.500,005', 'três casas decimais'],
    ['0.500', 'grupo de milhar começando com zero'],
    ['1.50,00', 'grupo de milhar incompleto'],
    ['1.23.456', 'grupos irregulares'],
    ['1 500,00', 'espaço como separador de milhar'],
    ['1500,', 'vírgula sem casas'],
    [',50', 'sem parte inteira'],
    ['1,5.0', 'vírgula antes do ponto'],
    ['Infinity', 'não finito'],
    ['NaN', 'não numérico'],
    ['1e6', 'notação científica'],
    ['+10', 'sinal de mais'],
    ['10 R$', 'símbolo no fim'],
    ['9999999999999', 'acima do limite'],
  ])('recusa %j (%s)', (input) => expect(parseBRL(input)).toBeNull());

  it('distingue o milhar do decimal pelo número de dígitos depois do ponto', () => {
    expect(parseBRL('12.345')).toBe(12345);
    expect(parseBRL('12.34')).toBe(12.34);
    expect(parseBRL('12.3')).toBe(12.3);
  });

  it('aceita o limite e recusa o centavo seguinte', () => {
    expect(parseBRL('999.999.999.999,99')).toBe(MAX_BRL_VALUE);
    expect(parseBRL('1.000.000.000.000,00')).toBeNull();
  });
});

describe('formatação em reais', () => {
  it('exibe com símbolo, milhar e duas casas', () => {
    expect(formatBRL(1500)).toBe('R$\u00a01.500,00');
    expect(formatBRL(0.5)).toBe('R$\u00a00,50');
    expect(formatBRL(1234567.891)).toBe('R$\u00a01.234.567,89');
  });

  it('prepara o campo editável em formato que o parser lê de volta sem perda', () => {
    expect(formatBRLInput(1500)).toBe('1.500,00');
    expect(formatBRLInput(12.5)).toBe('12,50');
    expect(formatBRLInput(0)).toBe('0,00');
    for (const value of [0, 0.01, 0.1, 12.5, 999.99, 1000, 1234.56, 99999.9, 1000000, MAX_BRL_VALUE])
      expect(parseBRL(formatBRLInput(value))).toBe(value);
  });

  it('lê de volta a própria exibição, inclusive o espaço não separável', () => {
    expect(parseBRL(formatBRL(2500.1))).toBe(2500.1);
  });
});
