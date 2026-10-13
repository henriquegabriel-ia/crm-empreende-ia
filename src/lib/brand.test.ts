import { describe, expect, it } from 'vitest';
import {
  BASE_CREDIT_TEXT as NODE_BASE_CREDIT_TEXT,
  PROGRAM_BRAND,
  appBrand,
  exportFileNameFor,
  normalizeBrand,
} from '../../scripts/lib/brand.mjs';
import { BASE_CREDIT_TEXT, BRAND, brandMonogram, exportFileName } from '@/lib/brand';
import { buildExportFileName } from '@/lib/export-file-name';
import { SUPPORT_EMAIL } from '@/lib/support';

// Item 1.6: o Vitest usa a marca do programa por constante (vitest.config.ts), e não o brand.json da instância.
describe('marca no navegador (src/lib/brand.ts)', () => {
  it('BRAND é a marca do programa, sem o hash das imagens', () => {
    expect(BRAND).toEqual(appBrand(normalizeBrand(PROGRAM_BRAND, { checkFiles: false }), { hashes: false }));
    expect(BRAND).toMatchObject({
      productName: 'Empreende.IA · CRM',
      logoOnDark: '/brand/eia-logo-on-dark.svg',
      icon: '/brand/eia-icon.svg',
      exportName: 'empreende-ia',
      baseCredit: false,
    });
    // O e-mail de suporte do app sai da marca (VITE_SUPPORT_EMAIL ficou obsoleta).
    expect(SUPPORT_EMAIL).toBe(BRAND.supportEmail);
  });

  it('o crédito tem o mesmo texto no app e no módulo dos e-mails', () => {
    expect(BASE_CREDIT_TEXT).toBe('Feito com Empreende.IA');
    expect(BASE_CREDIT_TEXT).toBe(NODE_BASE_CREDIT_TEXT);
  });

  it('nomes dos arquivos exportados com a marca da instância', () => {
    expect(exportFileName('contatos', 'csv')).toBe('contatos-empreende-ia.csv');
    expect(exportFileName('agenda', 'ics')).toBe('agenda-empreende-ia.ics');
    expect(exportFileName('oportunidades', 'csv', '2026-10-13')).toBe('oportunidades-empreende-ia-2026-10-13.csv');
  });

  it.each([
    ['acme', 'contatos', 'csv', undefined, 'contatos-acme.csv'],
    ['acme', 'oportunidades', 'csv', '2026-10-13', 'oportunidades-acme-2026-10-13.csv'],
    ['', 'agenda', 'ics', undefined, 'agenda.ics'],
    ['', 'oportunidades', 'csv', '2026-10-13', 'oportunidades-2026-10-13.csv'],
  ])('buildExportFileName(%j, %j, %j, %j) = %j, igual ao do brand:check', (name, base, extension, date, expected) => {
    expect(buildExportFileName(name, base, extension, date)).toBe(expected);
    expect(exportFileNameFor(name, base, extension, date)).toBe(expected);
  });

  it.each([
    ['acme', 'A'],
    ['ação comercial', 'A'],
    ['Ótica Sul', 'O'],
    ['🚀 Foguete Vendas', 'F'],
    ['123 Imóveis', '1'],
    ['···', 'C'],
    ['', 'C'],
  ])('monograma de %j é %j', (name, letter) => {
    expect(brandMonogram(name)).toBe(letter);
  });

  it('o monograma padrão usa o nome da marca', () => {
    expect(brandMonogram()).toBe('E');
  });
});
