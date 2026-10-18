/**
 * Pacote .zip sem compressão (método 0, "STORE"), para a exportação dos dados de um contato (item 1.10). Os arquivos
 * somam poucos KB, e uma biblioteca de compressão não se paga. Formato (APPNOTE.TXT do PKWARE): para cada arquivo, o
 * cabeçalho local e os bytes; depois, o diretório central e o fim do diretório. Nomes em UTF-8 (bit 11 das flags), data
 * e hora no formato do MS-DOS, no fuso do navegador, e o CRC-32 de cada arquivo. Sem ZIP64: até 65.535 arquivos e
 * 4 GiB, muito acima do que o CRM exporta.
 */

export interface ZipEntry {
  name: string;
  /** Texto (gravado em UTF-8, como está) ou bytes. */
  data: string | Uint8Array;
}

const UTF8_FLAG = 0x0800;
const VERSION = 20;
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const MAX_UINT32 = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (o do ZIP, do PNG e do gzip): crc32("123456789") = 0xcbf43926. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Data e hora do MS-DOS: segundos em passos de 2, a partir de 1980. */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Monta o .zip com os arquivos na ordem recebida. */
export function buildZip(entries: readonly ZipEntry[], date: Date): Uint8Array {
  if (entries.length > 0xffff) throw new Error('O pacote aceita até 65.535 arquivos.');
  const encoder = new TextEncoder();
  const stamp = dosDateTime(date);
  const files = entries.map((entry) => {
    const name = encoder.encode(entry.name);
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    if (!entry.name || name.length > 0xffff) throw new Error('Nome de arquivo inválido no pacote.');
    if (data.length > MAX_UINT32) throw new Error('Arquivo grande demais para o pacote.');
    return { name, data, crc: crc32(data) };
  });
  const localSize = files.reduce((total, file) => total + 30 + file.name.length + file.data.length, 0);
  const centralSize = files.reduce((total, file) => total + 46 + file.name.length, 0);
  if (localSize + centralSize + 22 > MAX_UINT32) throw new Error('Pacote grande demais.');
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  let offset = 0;
  const u16 = (value: number) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(offset, value >>> 0, true);
    offset += 4;
  };
  const bytes = (value: Uint8Array) => {
    output.set(value, offset);
    offset += value.length;
  };
  const offsets: number[] = [];
  for (const file of files) {
    offsets.push(offset);
    u32(LOCAL_SIGNATURE);
    u16(VERSION);
    u16(UTF8_FLAG);
    u16(0);
    u16(stamp.time);
    u16(stamp.date);
    u32(file.crc);
    u32(file.data.length);
    u32(file.data.length);
    u16(file.name.length);
    u16(0);
    bytes(file.name);
    bytes(file.data);
  }
  const centralOffset = offset;
  files.forEach((file, index) => {
    u32(CENTRAL_SIGNATURE);
    u16(VERSION);
    u16(VERSION);
    u16(UTF8_FLAG);
    u16(0);
    u16(stamp.time);
    u16(stamp.date);
    u32(file.crc);
    u32(file.data.length);
    u32(file.data.length);
    u16(file.name.length);
    u16(0);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(offsets[index]);
    bytes(file.name);
  });
  const centralLength = offset - centralOffset;
  u32(END_SIGNATURE);
  u16(0);
  u16(0);
  u16(files.length);
  u16(files.length);
  u32(centralLength);
  u32(centralOffset);
  u16(0);
  return output;
}
