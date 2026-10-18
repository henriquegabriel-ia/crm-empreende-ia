import { describe, expect, it } from 'vitest';
import { readZip, zipText } from '@/test/zip-reader';
import { buildZip, crc32, dosDateTime } from './zip';

const encode = (text: string) => new TextEncoder().encode(text);
const date = new Date(2026, 9, 13, 14, 35, 47);

describe('crc32', () => {
  it('confere os valores conhecidos', () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('dosDateTime', () => {
  it('grava data e hora do MS-DOS, com os segundos em passos de 2', () => {
    const stamp = dosDateTime(date);
    expect(stamp.time).toBe((14 << 11) | (35 << 5) | 23);
    expect(stamp.date).toBe(((2026 - 1980) << 9) | (10 << 5) | 13);
  });
});

describe('buildZip', () => {
  const files = [
    { name: 'LEIA-ME.txt', data: 'Olá, titular.\r\n' },
    { name: 'dados.json', data: '{"contato":{"nome":"João"}}' },
    { name: 'pasta/ação.csv', data: encode('﻿"a";"b"') },
    { name: 'vazio.txt', data: '' },
  ];
  const zip = buildZip(files, date);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  it('tem as assinaturas, a contagem de entradas e o diretório central no lugar', () => {
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 8, true)).toBe(4);
    expect(view.getUint16(end + 10, true)).toBe(4);
    const centralSize = view.getUint32(end + 12, true);
    const centralOffset = view.getUint32(end + 16, true);
    expect(centralOffset + centralSize).toBe(end);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
  });

  it('é lido de volta por um leitor independente, com os mesmos bytes, o CRC conferido e os nomes em UTF-8', () => {
    const entries = readZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual(['LEIA-ME.txt', 'dados.json', 'pasta/ação.csv', 'vazio.txt']);
    expect(zipText(entries[0])).toBe('Olá, titular.\r\n');
    expect(JSON.parse(zipText(entries[1]))).toEqual({ contato: { nome: 'João' } });
    expect(Array.from(entries[2].data)).toEqual(Array.from(encode('﻿"a";"b"')));
    expect(entries[3].data.length).toBe(0);
    expect(entries[3].crc).toBe(0);
    for (const entry of entries) {
      expect(entry.method).toBe(0);
      expect(entry.flags & 0x0800).toBe(0x0800);
      expect(entry.dosTime).toBe(dosDateTime(date).time);
      expect(entry.dosDate).toBe(dosDateTime(date).date);
    }
  });

  it('um pacote vazio ainda é um .zip válido', () => {
    const empty = buildZip([], date);
    expect(empty.length).toBe(22);
    expect(readZip(empty)).toEqual([]);
  });

  it('o leitor recusa um CRC adulterado', () => {
    const copy = zip.slice();
    // O primeiro byte de dados de LEIA-ME.txt fica depois do cabeçalho local (30 bytes) e do nome.
    copy[30 + 'LEIA-ME.txt'.length] ^= 0xff;
    expect(() => readZip(copy)).toThrow(/CRC-32 de LEIA-ME.txt/);
  });

  it('recusa nome vazio', () => {
    expect(() => buildZip([{ name: '', data: 'x' }], date)).toThrow();
  });
});
