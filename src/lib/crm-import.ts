import type { CsvColumn } from '@/lib/csv';
import { legalBasisLabel } from '@/lib/privacy';

/**
 * Planilha de "Exportar contatos". Desde o item 1.11, com os cabeçalhos em português do modelo de importação
 * (src/lib/contact-import-headers.ts), e o arquivo exportado volta pela importação sem perda: `nao_contatar` ("sim" ou
 * vazio), `base_legal` (o rótulo) e `registro_base_legal` (como a pessoa consentiu). Os contatos anonimizados ficam fora
 * da leitura (`anonymized_at is null`, item 1.10). Empresa, cargo, origem, responsável, relacionamento e observações na
 * exportação são do item 2B.7: com o responsável, a reimportação noutra instância daria erro em todas as linhas.
 * Arquivos exportados antes, com `first_name`, continuam aceitos pela importação.
 */
export interface ContactExportRow {
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  do_not_contact?: boolean | null;
  legal_basis?: string | null;
  legal_basis_note?: string | null;
}
/** Num banco sem a migração da privacidade (1.10) ou dos canais (1.9), só as quatro primeiras colunas. */
export const CONTACT_EXPORT_BASIC_COLUMNS: CsvColumn<ContactExportRow>[] = [
  { header: 'nome', value: (row) => row.first_name },
  { header: 'sobrenome', value: (row) => row.last_name },
  { header: 'email', value: (row) => row.email },
  { header: 'telefone', value: (row) => row.phone },
];
export const CONTACT_EXPORT_COLUMNS: CsvColumn<ContactExportRow>[] = [
  ...CONTACT_EXPORT_BASIC_COLUMNS,
  { header: 'nao_contatar', value: (row) => (row.do_not_contact ? 'sim' : '') },
  { header: 'base_legal', value: (row) => legalBasisLabel(row.legal_basis) },
  { header: 'registro_base_legal', value: (row) => row.legal_basis_note ?? '' },
];
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
