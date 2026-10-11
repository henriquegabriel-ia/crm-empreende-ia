import { describe, expect, it } from 'vitest';
import { BRAZIL_DDDS, formatPhoneBR, normalizePhoneBR } from '@/lib/phone';

describe('normalizePhoneBR', () => {
  it.each([
    ['+55 11 99999-0000', '+5511999990000'],
    ['(11) 99999-0000', '+5511999990000'],
    ['11999990000', '+5511999990000'],
    ['011 99999-0000', '+5511999990000'],
    ['0 (11) 9 9999-0000', '+5511999990000'],
    ['+55 (21) 98765-4321', '+5521987654321'],
    ['55 11 99999-0000', '+5511999990000'],
    ['+5511999990000', '+5511999990000'],
    ['11.99999.0000', '+5511999990000'],
    ['  (55) 99999-0000  ', '+5555999990000'],
    ['55 55 99999-0000', '+5555999990000'],
  ])('reconhece o celular %j', (input, e164) => expect(normalizePhoneBR(input)).toEqual({ e164, kind: 'mobile' }));

  it.each([
    ['(11) 3000-0000', '+551130000000'],
    ['+55 11 3000-0000', '+551130000000'],
    ['1130000000', '+551130000000'],
    ['0 61 2345-6789', '+556123456789'],
    ['5511 3000-0000', '+551130000000'],
    ['(55) 3222-0000', '+555532220000'],
    ['(85) 5555-1234', '+558555551234'],
    ['(41) 4004-1234', '+554140041234'],
  ])('reconhece o fixo %j', (input, e164) => expect(normalizePhoneBR(input)).toEqual({ e164, kind: 'landline' }));

  it.each([
    ['', 'vazio'],
    ['   ', 'só espaços'],
    ['99999-0000', 'sem DDD'],
    ['(10) 99999-0000', 'DDD inexistente'],
    ['(20) 3000-0000', 'DDD inexistente'],
    ['(11) 89999-0000', 'celular sem o 9 inicial'],
    ['(11) 9999-0000', 'celular antigo com 8 dígitos'],
    ['(11) 6000-0000', 'fixo começando com 6'],
    ['(11) 1000-0000', 'fixo começando com 1'],
    ['(11) 99999-00000', 'dígitos demais'],
    ['+1 415 555 0100', 'outro país'],
    ['+351 912 345 678', 'outro país'],
    ['11 99999-0000 ramal 22', 'com texto'],
    ['11 99999-0000 x22', 'com ramal'],
    ['11+999990000', '"+" no meio'],
    ['0800 123 4567', 'número não geográfico'],
    ['---', 'sem dígitos'],
  ])('classifica %j como inválido (%s)', (input) =>
    expect(normalizePhoneBR(input)).toEqual({ e164: null, kind: 'invalid' }),
  );

  it('trata ausência de valor como inválido', () => {
    expect(normalizePhoneBR(null).kind).toBe('invalid');
    expect(normalizePhoneBR(undefined).kind).toBe('invalid');
  });

  it('tem os 67 DDDs do plano de numeração', () => {
    expect(BRAZIL_DDDS.size).toBe(67);
    for (const ddd of ['11', '21', '27', '31', '41', '51', '61', '71', '79', '81', '91', '99'])
      expect(BRAZIL_DDDS.has(ddd)).toBe(true);
    for (const ddd of ['10', '20', '23', '25', '26', '29', '30', '36', '39', '40', '50', '52', '56', '60', '70', '72'])
      expect(BRAZIL_DDDS.has(ddd)).toBe(false);
  });

  it('é idempotente: normalizar o E.164 devolve o mesmo número', () => {
    for (const input of ['(11) 99999-0000', '(11) 3000-0000', '+55 85 98888-7777']) {
      const { e164, kind } = normalizePhoneBR(input);
      expect(normalizePhoneBR(e164)).toEqual({ e164, kind });
    }
  });
});

describe('formatPhoneBR', () => {
  it('exibe celular e fixo com DDD entre parênteses', () => {
    expect(formatPhoneBR('+5511999990000')).toBe('(11) 99999-0000');
    expect(formatPhoneBR('+55 11 99999-0000')).toBe('(11) 99999-0000');
    expect(formatPhoneBR('1130000000')).toBe('(11) 3000-0000');
  });

  it('devolve o texto original quando o número não é reconhecido', () => {
    expect(formatPhoneBR(' 99999-0000 ')).toBe('99999-0000');
    expect(formatPhoneBR('+1 415 555 0100')).toBe('+1 415 555 0100');
    expect(formatPhoneBR(null)).toBe('');
  });
});
