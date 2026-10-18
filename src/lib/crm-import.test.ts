import { describe, it, expect } from 'vitest';
import { calendarText, CONTACT_EXPORT_BASIC_COLUMNS, CONTACT_EXPORT_COLUMNS, foldCalendarLine } from '@/lib/crm-import';
import { analyzeContactImport, planContactImport, readContactSheet } from '@/lib/contact-import';
import { buildCsv } from '@/lib/csv';

/** Lê a planilha exportada pela importação do item 1.11, num CRM vazio, e devolve o pedido de cada contato. */
function reimport(text: string, columns = { doNotContact: true, legalBasis: true }) {
  const result = readContactSheet(new TextEncoder().encode(text), 'contatos.csv');
  if (result.error) throw new Error(result.error);
  const analysis = analyzeContactImport(result.sheet, {
    orgId: 'org-1',
    existingContacts: [],
    companies: [],
    members: [{ id: 'me', name: 'Pessoa', email: 'me@example.test', active: true }],
    columns,
  });
  const plan = planContactImport(analysis, { ownerMode: 'me', meId: 'me' });
  return { plan, sheet: result.sheet };
}

// Item 1.10: a planilha de "Exportar contatos" leva a marca "Não contatar" e a base legal; item 1.11: com os cabeçalhos
// em português do modelo e o registro da base legal, e o arquivo volta pela importação sem perda.
describe('contact export with the privacy columns', () => {
  const contacts = [
    {
      first_name: 'Ana',
      last_name: 'Souza',
      email: 'ana@example.test',
      phone: '+5511999990000',
      do_not_contact: true,
      legal_basis: 'consent',
      legal_basis_note: 'Formulário do site em 01/10/2026; marcou a caixa.',
    },
    {
      first_name: '=Bruno',
      last_name: '-Lima',
      email: null,
      phone: '+551130000000',
      do_not_contact: false,
      legal_basis: 'not_informed',
      legal_basis_note: null,
    },
    { first_name: 'Carla', last_name: 'Ação', email: 'carla@example.test', phone: 'ramal 22' },
    { first_name: 'Davi', last_name: null, email: null, phone: '+1 415 555 0100', legal_basis: 'legitimate_interest' },
  ];
  it('uses the Portuguese template headers, with nao_contatar, base_legal and registro_base_legal', () => {
    expect(CONTACT_EXPORT_COLUMNS.map((column) => column.header)).toEqual([
      'nome',
      'sobrenome',
      'email',
      'telefone',
      'nao_contatar',
      'base_legal',
      'registro_base_legal',
    ]);
    expect(CONTACT_EXPORT_BASIC_COLUMNS.map((column) => column.header)).toEqual([
      'nome',
      'sobrenome',
      'email',
      'telefone',
    ]);
    const exported = buildCsv(contacts, CONTACT_EXPORT_COLUMNS);
    expect(
      exported.startsWith(
        '\uFEFF"nome";"sobrenome";"email";"telefone";"nao_contatar";"base_legal";"registro_base_legal"\r\n',
      ),
    ).toBe(true);
    expect(exported).toContain('"sim";"Consentimento";"Formulário do site em 01/10/2026; marcou a caixa."');
    expect(exported).toContain(`"'=Bruno";"'-Lima";"";"'+551130000000";"";"Não informada";""`);
    // Sem as colunas (banco sem a migração), a base é "Não informada" e a marca e o registro ficam vazios.
    expect(exported).toContain('"Carla";"Ação";"carla@example.test";"ramal 22";"";"Não informada";""');
  });

  it('the exported file comes back through the import without loss, consent and "Não contatar" included', () => {
    const { plan, sheet } = reimport(buildCsv(contacts, CONTACT_EXPORT_COLUMNS));
    expect(sheet.ignored).toEqual([]);
    expect(plan.rows.map((row) => row.status)).toEqual(['ready', 'ready', 'ready', 'ready']);
    expect(
      plan.ready.map(({ payload }) => {
        const { first_name, last_name, email, phone, do_not_contact, legal_basis, legal_basis_note } = payload!;
        return { first_name, last_name, email, phone, do_not_contact, legal_basis, legal_basis_note };
      }),
    ).toEqual([
      {
        first_name: 'Ana',
        last_name: 'Souza',
        email: 'ana@example.test',
        phone: '+5511999990000',
        do_not_contact: true,
        legal_basis: 'consent',
        legal_basis_note: 'Formulário do site em 01/10/2026; marcou a caixa.',
      },
      {
        first_name: '=Bruno',
        last_name: '-Lima',
        email: null,
        phone: '+551130000000',
        do_not_contact: false,
        legal_basis: 'not_informed',
        legal_basis_note: null,
      },
      {
        first_name: 'Carla',
        last_name: 'Ação',
        email: 'carla@example.test',
        phone: 'ramal 22',
        do_not_contact: false,
        legal_basis: 'not_informed',
        legal_basis_note: null,
      },
      {
        first_name: 'Davi',
        last_name: null,
        email: null,
        phone: '+1 415 555 0100',
        do_not_contact: false,
        legal_basis: 'legitimate_interest',
        legal_basis_note: null,
      },
    ]);
    expect(JSON.stringify(plan.ready)).not.toContain("'");
  });

  it('the basic export and a file exported before item 1.11 (first_name…) are still imported', () => {
    const basic = reimport(buildCsv(contacts, CONTACT_EXPORT_BASIC_COLUMNS));
    expect(basic.plan.ready.map((row) => row.payload!.phone)).toEqual([
      '+5511999990000',
      '+551130000000',
      'ramal 22',
      '+1 415 555 0100',
    ]);
    const legacy = reimport(
      '\uFEFF"first_name";"last_name";"email";"phone";"nao_contatar";"base_legal"\r\n"Ana";"Souza";"ana@example.test";"\'+55 11 99999-0000";"sim";"Legítimo interesse"',
    );
    expect(legacy.plan.ready[0].payload).toMatchObject({
      first_name: 'Ana',
      phone: '+5511999990000',
      do_not_contact: true,
      legal_basis: 'legitimate_interest',
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
