/**
 * Leitor mínimo de .zip sem compressão, só para os testes (unitários e E2E, que o importam por caminho relativo, sem o
 * alias @/). Confere o pacote de src/lib/zip.ts por uma implementação independente: o fim do diretório, cada entrada do
 * diretório central, o cabeçalho local correspondente e o CRC-32 dos bytes. Qualquer divergência vira erro.
 */

export interface ReadZipEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  flags: number;
  method: number;
  /** Data e hora do MS-DOS, como gravadas. */
  dosTime: number;
  dosDate: number;
}

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

export function readZip(input: Uint8Array | ArrayBuffer): ReadZipEntry[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let end = -1;
  for (let position = bytes.length - 22; position >= 0; position--)
    if (view.getUint32(position, true) === 0x06054b50) {
      end = position;
      break;
    }
  if (end < 0) throw new Error('zip: fim do diretório central não encontrado');
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 8, true) !== count) throw new Error('zip: contagens do fim do diretório divergem');
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (centralOffset + centralSize !== end) throw new Error('zip: tamanho ou posição do diretório central errados');
  const entries: ReadZipEntry[] = [];
  let position = centralOffset;
  for (let index = 0; index < count; index++) {
    if (view.getUint32(position, true) !== 0x02014b50) throw new Error(`zip: entrada central ${index} inválida`);
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const dosTime = view.getUint16(position + 12, true);
    const dosDate = view.getUint16(position + 14, true);
    const crc = view.getUint32(position + 16, true);
    const compressed = view.getUint32(position + 20, true);
    const size = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const localOffset = view.getUint32(position + 42, true);
    const nameBytes = bytes.subarray(position + 46, position + 46 + nameLength);
    const name = decoder.decode(nameBytes);
    position += 46 + nameLength + extraLength + commentLength;
    if (method !== 0 || compressed !== size) throw new Error(`zip: ${name} não está sem compressão`);
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`zip: cabeçalho local de ${name} inválido`);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    if (
      view.getUint16(localOffset + 6, true) !== flags ||
      view.getUint32(localOffset + 14, true) !== crc ||
      view.getUint32(localOffset + 22, true) !== size ||
      decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)) !== name
    )
      throw new Error(`zip: o cabeçalho local de ${name} diverge do diretório central`);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(start, start + size);
    if (data.length !== size) throw new Error(`zip: ${name} cortado`);
    if (crc32(data) !== crc) throw new Error(`zip: CRC-32 de ${name} não confere`);
    entries.push({ name, data, crc, flags, method, dosTime, dosDate });
  }
  return entries;
}

/** O texto de uma entrada, em UTF-8 (com o BOM, se houver). */
export const zipText = (entry: ReadZipEntry) => new TextDecoder('utf-8').decode(entry.data);
