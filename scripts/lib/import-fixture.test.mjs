// Fixture sintética da importação de planilha (item 1.11; docs/arquitetura/1.11.md, seção 11.3): o arquivo versionado é
// o do gerador, tem 5.000 linhas com dados em Windows-1252, e a análise do app chega às contagens esperadas, com o
// contexto da fixture do navegador (tests/browser/fixture.ts, withContactImport).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeContactImport, planContactImport, readContactSheet } from '../../src/lib/contact-import';
import {
  buildContactImportFixture,
  IMPORT_FIXTURE_DEFAULT_SOURCE,
  IMPORT_FIXTURE_EXISTING,
  IMPORT_FIXTURE_FILE,
  IMPORT_FIXTURE_HEADERS,
  IMPORT_FIXTURE_ROWS,
} from './import-fixture.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const fixture = buildContactImportFixture();

/** O contexto da fixture do navegador com withContactImport. */
const CONTEXT = {
  orgId: 'org',
  existingContacts: [
    { id: 'alfa', email: 'alfa@example.test', phone: '11900000000' },
    { id: 'cliente-fulano', email: 'cliente-fulano@example.test', phone: null },
    ...IMPORT_FIXTURE_EXISTING.map((contact, index) => ({
      id: `existing-${index}`,
      email: contact.email,
      phone: contact.phone,
    })),
  ],
  companies: [
    { id: 'empresa-exemplo', name: 'Empresa Exemplo', created_at: '2026-10-01T10:00:00.000Z' },
    { id: 'empresa-fulano', name: 'Empresa do Fulano', created_at: '2026-10-01T10:00:00.000Z' },
  ],
  members: [
    { id: 'owner', name: 'Pessoa de Teste', email: 'owner@example.test', active: true },
    { id: 'viewer', name: 'Leitor de Teste', email: 'viewer@example.test', active: true },
    { id: 'fulano', name: 'Fulano Vendedor', email: 'fulano@example.test', active: false },
    { id: 'bruna', name: 'Bruna Recebedora', email: 'bruna@example.test', active: true },
    { id: 'carla', name: 'Carla Administradora', email: 'carla@example.test', active: true },
  ],
  columns: { doNotContact: true, legalBasis: true },
};

describe('fixture da importação de planilha', () => {
  it('o arquivo versionado tem os mesmos bytes do gerador', () => {
    const stored = readFileSync(path.join(ROOT, IMPORT_FIXTURE_FILE));
    expect(Buffer.compare(stored, Buffer.from(fixture.bytes))).toBe(0);
  });

  it('5.000 linhas com dados, em Windows-1252 válido, com ";" e CRLF', () => {
    expect(fixture.rows).toHaveLength(IMPORT_FIXTURE_ROWS);
    expect(fixture.expected.rows).toBe(5000);
    // Nenhum caractere fora do Latin-1 imprimível que o Windows-1252 também tem (sem a faixa 0x80 a 0x9f).
    expect([...fixture.bytes].some((byte) => byte >= 0x80 && byte <= 0x9f)).toBe(false);
    expect(fixture.text.startsWith(`${IMPORT_FIXTURE_HEADERS.join(';')}\r\n`)).toBe(true);
    expect(fixture.text.split('\r\n').filter((line) => line === '')).toHaveLength(3);
  });

  it('a análise do app chega às contagens esperadas pela construção', () => {
    const { sheet, error } = readContactSheet(fixture.bytes, 'contatos-5000.csv');
    expect(error).toBeNull();
    expect(sheet.encoding).toBe('windows-1252');
    expect(sheet.ignored).toEqual(['Data de nascimento']);
    expect(sheet.rows.map((row) => row.line)).toEqual(fixture.rows.map((row) => row.line));
    const analysis = analyzeContactImport(sheet, CONTEXT);
    const plan = planContactImport(analysis, {
      ownerMode: 'distribute',
      meId: 'owner',
      distributeIds: ['carla', 'bruna'],
      defaultSource: IMPORT_FIXTURE_DEFAULT_SOURCE,
    });
    const { expected } = fixture;
    expect({
      ready: plan.ready.length,
      duplicates: plan.duplicates.length,
      errors: plan.errors.length,
      newCompanies: plan.companies.length,
      unrecognizedPhones: plan.unrecognizedPhones,
      doNotContact: plan.doNotContact,
      consents: plan.consents,
    }).toEqual({
      ready: expected.ready,
      duplicates: expected.duplicates,
      errors: expected.errors,
      newCompanies: expected.newCompanies,
      unrecognizedPhones: expected.unrecognizedPhones,
      doNotContact: expected.doNotContact,
      consents: expected.consents,
    });
    // Cada linha na categoria da construção, com o número da linha do Excel.
    expect(plan.rows.map((row) => `${row.row.line}:${row.status}`)).toEqual(
      fixture.rows.map((row) => `${row.line}:${row.category}`),
    );
    expect(plan.distribution).toEqual([
      { id: 'bruna', count: expected.distribution.bruna },
      { id: 'carla', count: expected.distribution.carla },
    ]);
    const owners = (id) => plan.ready.filter((row) => row.ownerId === id).length;
    expect(owners('bruna')).toBe(expected.distribution.bruna + expected.ownerColumn.bruna);
    expect(owners('carla')).toBe(expected.distribution.carla + expected.ownerColumn.carla);
    expect(plan.ready.filter((row) => row.companyId === 'empresa-exemplo')).toHaveLength(
      expected.linkedToExampleCompany,
    );
    expect(plan.ready.filter((row) => row.payload.source === IMPORT_FIXTURE_DEFAULT_SOURCE)).toHaveLength(
      expected.withoutSource,
    );
    expect(plan.ready.filter((row) => row.payload.legal_basis === 'legitimate_interest')).toHaveLength(
      expected.legitimateInterest,
    );
    expect(plan.ready.filter((row) => row.payload.legal_basis === 'contract')).toHaveLength(expected.contract);
    expect(plan.blocked).toBeNull();
  });
});
