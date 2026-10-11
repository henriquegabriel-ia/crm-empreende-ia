import { csvByteLength, MAX_CSV_BYTES, parseCsv, type CsvColumn } from '@/lib/csv';
import { normalizePhoneBR } from '@/lib/phone';

export interface ContactImportRow {
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}
export const MAX_CONTACT_IMPORT_ROWS = 500;
/** Colunas da exportação, do modelo e da importação de contatos: o arquivo exportado pode ser reimportado. */
export const CONTACT_CSV_COLUMNS: CsvColumn<ContactImportRow>[] = [
  { header: 'first_name', value: (row) => row.first_name },
  { header: 'last_name', value: (row) => row.last_name },
  { header: 'email', value: (row) => row.email },
  { header: 'phone', value: (row) => row.phone },
];
/**
 * Lê contatos de um CSV (";" ou ","). O telefone brasileiro reconhecido é gravado em E.164 (+55…); um
 * telefone não reconhecido fica como foi digitado, sem descartar a linha.
 */
export function parseContactCsv(text: string): { rows: ContactImportRow[]; errors: string[] } {
  if (text.length > MAX_CSV_BYTES || csvByteLength(text) > MAX_CSV_BYTES)
    return { rows: [], errors: ['O arquivo deve ter até 2 MB.'] };
  const parsed = parseCsv(text);
  if (parsed.error) return { rows: [], errors: [parsed.error] };
  const raw = parsed.rows;
  const headers = parsed.headers.map((value) => value.toLowerCase());
  if (!headers.includes('first_name'))
    return { rows: [], errors: ['A primeira linha precisa incluir a coluna first_name. Use o modelo para preencher.'] };
  if (raw.length > MAX_CONTACT_IMPORT_ROWS)
    return {
      rows: [],
      errors: [`Importe até ${MAX_CONTACT_IMPORT_ROWS} contatos por arquivo. Divida o arquivo e tente novamente.`],
    };
  const rows: ContactImportRow[] = [],
    errors: string[] = [];
  const emails = new Set<string>();
  for (let index = 0; index < raw.length; index++) {
    const values = raw[index];
    if (values.length !== headers.length) {
      errors.push(`Linha ${index + 2}: o número de colunas não corresponde ao cabeçalho.`);
      continue;
    }
    const get = (key: string) => values[headers.indexOf(key)]?.trim() ?? '';
    const first_name = get('first_name'),
      last_name = get('last_name'),
      email = get('email').toLowerCase(),
      phone = get('phone');
    if (!first_name || first_name.length > 160) {
      errors.push(`Linha ${index + 2}: informe um nome com até 160 caracteres.`);
      continue;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Linha ${index + 2}: e-mail inválido.`);
      continue;
    }
    if (email && emails.has(email)) {
      errors.push(`Linha ${index + 2}: e-mail repetido no arquivo.`);
      continue;
    }
    if (email) emails.add(email);
    rows.push({
      first_name,
      last_name: last_name || null,
      email: email || null,
      phone: phone ? (normalizePhoneBR(phone).e164 ?? phone) : null,
    });
  }
  if (!raw.length) errors.push('O arquivo não contém contatos.');
  return { rows, errors };
}
export function calendarText(
  activities: { id: string; title: string; due_date: string | null; end_date: string | null; body: string | null }[],
) {
  const escape = (v: string) =>
    v.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const stamp = (v: string) =>
    new Date(v)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Empreende IA//CRM//PT-BR', 'CALSCALE:GREGORIAN'];
  for (const a of activities) {
    if (!a.due_date || !Number.isFinite(Date.parse(a.due_date))) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${a.id}@crm.empreende-ia`,
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(a.due_date)}`,
      `DTEND:${stamp(a.end_date ?? new Date(Date.parse(a.due_date) + 30 * 60000).toISOString())}`,
      `SUMMARY:${escape(a.title)}`,
      `DESCRIPTION:${escape(a.body ?? '')}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldCalendarLine).join('\r\n') + '\r\n';
}

export function foldCalendarLine(line: string) {
  let result = '',
    current = '',
    bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) {
      result += current + '\r\n';
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  return result + current;
}
