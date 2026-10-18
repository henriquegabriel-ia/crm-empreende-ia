import { describe, it, expect } from 'vitest';
import {
  calendarText,
  CONTACT_CSV_COLUMNS,
  CONTACT_EXPORT_COLUMNS,
  foldCalendarLine,
  parseContactCsv,
} from '@/lib/crm-import';
import { buildCsv, MAX_CSV_BYTES } from '@/lib/csv';
describe('CSV review and export', () => {
  it('reads quoted commas, quotes, semicolons and multiline cells', () => {
    expect(
      parseContactCsv('first_name,last_name,email,phone\r\n"Ana, Maria","Da ""Silva""",ana@example.test,"123\n456"')
        .rows[0],
    ).toEqual({ first_name: 'Ana, Maria', last_name: 'Da "Silva"', email: 'ana@example.test', phone: '123\n456' });
    expect(parseContactCsv('first_name;email\nAna;ana@example.test').errors).toEqual([]);
  });
  it('rejects broken quotes, columns and missing names', () => {
    expect(parseContactCsv('first_name,email\n"Ana,ana@example.test').errors.length).toBe(1);
    expect(parseContactCsv('first_name,email\nAna,ana@example.test,extra').errors.length).toBe(1);
    expect(parseContactCsv('first_name,email\n,ana@example.test').rows).toEqual([]);
  });
  it('identifies duplicate emails without merging names', () => {
    const result = parseContactCsv('first_name,email\nAna,ANA@example.test\nAna,ana@example.test\nAna,');
    expect(result.rows).toHaveLength(2);
    expect(result.errors[0]).toContain('e-mail repetido');
  });
  it('rejects malformed email and overlarge imports', () => {
    expect(parseContactCsv('first_name,email\nAna,invalid').rows).toEqual([]);
    expect(parseContactCsv('first_name\n' + Array(501).fill('Ana').join('\n')).errors[0]).toContain('500');
  });
  it('measures the size limit in bytes, not characters', () => {
    const header = 'first_name\n';
    const ascii = header + 'a'.repeat(MAX_CSV_BYTES - header.length);
    expect(parseContactCsv(ascii).errors).not.toContain('O arquivo deve ter até 2 MB.');
    const accented = header + 'ç'.repeat((MAX_CSV_BYTES - header.length) / 2 + 1);
    expect(accented.length).toBeLessThan(MAX_CSV_BYTES);
    expect(parseContactCsv(accented)).toEqual({ rows: [], errors: ['O arquivo deve ter até 2 MB.'] });
  });
});

describe('contact phones and CSV round-trip', () => {
  const header = 'first_name;last_name;email;phone';
  it('stores recognized Brazilian phones in E.164 and keeps unrecognized ones as typed', () => {
    const { rows, errors } = parseContactCsv(
      [
        header,
        'Ana;;ana@example.test;(11) 99999-0000',
        'Bruno;;;011 3000-0000',
        'Carla;;;ramal 22',
        'Davi;;;+1 415 555 0100',
        'Eva;;;',
      ].join('\r\n'),
    );
    expect(errors).toEqual([]);
    expect(rows.map((row) => row.phone)).toEqual([
      '+5511999990000',
      '+551130000000',
      'ramal 22',
      '+1 415 555 0100',
      null,
    ]);
  });

  it('reads the template and an export with semicolons, BOM and the neutralizing apostrophe', () => {
    expect(parseContactCsv(buildCsv([], CONTACT_CSV_COLUMNS))).toEqual({
      rows: [],
      errors: ['O arquivo não contém contatos.'],
    });
    const exported = buildCsv(
      [{ first_name: 'Ana', last_name: 'Souza', email: 'ana@example.test', phone: '+55 11 99999-0000' }],
      CONTACT_CSV_COLUMNS,
    );
    expect(exported.startsWith('\uFEFF"first_name";"last_name";"email";"phone"\r\n')).toBe(true);
    expect(exported).toContain(`"'+55 11 99999-0000"`);
    expect(parseContactCsv(exported)).toEqual({
      rows: [{ first_name: 'Ana', last_name: 'Souza', email: 'ana@example.test', phone: '+5511999990000' }],
      errors: [],
    });
  });

  it('round-trips a stored contact phone without the apostrophe and without changing it', () => {
    const contacts = [
      { first_name: 'Ana', last_name: null, email: null, phone: '+5511999990000' },
      { first_name: '=Bruno', last_name: '-Lima', email: null, phone: '+551130000000' },
      { first_name: 'Carla', last_name: 'Ação', email: 'carla@example.test', phone: 'ramal 22' },
    ];
    const first = parseContactCsv(buildCsv(contacts, CONTACT_CSV_COLUMNS));
    expect(first).toEqual({ rows: contacts, errors: [] });
    expect(parseContactCsv(buildCsv(first.rows, CONTACT_CSV_COLUMNS))).toEqual(first);
  });
});
// Item 1.10: a planilha de "Exportar contatos" leva a marca "Não contatar" e a base legal.
describe('contact export with the privacy columns', () => {
  const contacts = [
    {
      first_name: 'Ana',
      last_name: 'Souza',
      email: 'ana@example.test',
      phone: '+5511999990000',
      do_not_contact: true,
      legal_basis: 'consent',
    },
    {
      first_name: 'Bruno',
      last_name: null,
      email: null,
      phone: null,
      do_not_contact: false,
      legal_basis: 'not_informed',
    },
    { first_name: 'Carla', last_name: null, email: null, phone: null },
  ];
  it('adds nao_contatar ("sim" or empty) and base_legal (the label) after the four template columns', () => {
    expect(CONTACT_EXPORT_COLUMNS.map((column) => column.header)).toEqual([
      'first_name',
      'last_name',
      'email',
      'phone',
      'nao_contatar',
      'base_legal',
    ]);
    const exported = buildCsv(contacts, CONTACT_EXPORT_COLUMNS);
    expect(exported.startsWith('﻿"first_name";"last_name";"email";"phone";"nao_contatar";"base_legal"\r\n')).toBe(true);
    expect(exported).toContain('"sim";"Consentimento"');
    expect(exported).toContain('"Bruno";"";"";"";"";"Não informada"');
    // Sem as colunas (banco sem a migração), a base é "Não informada" e a marca fica vazia.
    expect(exported).toContain('"Carla";"";"";"";"";"Não informada"');
  });
  it('the exported file is still imported, with the extra columns ignored until item 1.11', () => {
    expect(parseContactCsv(buildCsv(contacts, CONTACT_EXPORT_COLUMNS))).toEqual({
      rows: [
        { first_name: 'Ana', last_name: 'Souza', email: 'ana@example.test', phone: '+5511999990000' },
        { first_name: 'Bruno', last_name: null, email: null, phone: null },
        { first_name: 'Carla', last_name: null, email: null, phone: null },
      ],
      errors: [],
    });
  });
});

describe('ICS export', () => {
  it('uses UTC dates and escapes untrusted event text', () => {
    const result = calendarText([
      {
        id: 'abc',
        title: 'Conversa\nBEGIN:VEVENT',
        body: 'Pauta, itens; teste',
        due_date: '2026-09-06T10:00:00-03:00',
        end_date: null,
      },
    ]);
    expect(result).toContain('DTSTART:20260906T130000Z');
    expect(result).toContain('DTEND:20260906T133000Z');
    expect(result.match(/^BEGIN:VEVENT/gm)).toHaveLength(1);
    expect(result).toContain('SUMMARY:Conversa\\nBEGIN:VEVENT');
    expect(result).toContain('DESCRIPTION:Pauta\\, itens\\; teste');
  });
  it('folds UTF-8 at 75 octets without splitting characters', () => {
    const text = 'SUMMARY:' + 'Reunião 🧑 '.repeat(20);
    const folded = foldCalendarLine(text);
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(text);
  });
  it('does not invent dates for undated activities', () => {
    expect(calendarText([{ id: 'abc', title: 'Sem prazo', body: null, due_date: null, end_date: null }])).not.toContain(
      'BEGIN:VEVENT',
    );
  });
});
