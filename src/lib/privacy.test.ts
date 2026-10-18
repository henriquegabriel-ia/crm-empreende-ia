import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANONYMIZE_CONFIRMATION_WORD,
  COMPANY_DEFAULT_CHOICE,
  COMPANY_DO_NOT_CONTACT_REFUSAL,
  companyDefaultLabel,
  CONSENT_NOTE_REQUIRED,
  CONTACT_DO_NOT_CONTACT_REFUSAL,
  isAnonymized,
  isAnonymizeConfirmation,
  isFrozenActivity,
  LEGAL_BASES,
  LEGAL_BASIS_LABELS,
  LEGAL_BASIS_NOTE_TOO_LONG,
  legalBasisChanges,
  legalBasisLabel,
  legalBasisNoteError,
  legalBasisOf,
  linkableContacts,
  ORGANIZATION_LEGAL_BASES,
  organizationLegalBasisOf,
  parseAnonymizationCounts,
  parsePrivacySummary,
  plannedActionRefusal,
  PRIVACY_ACTION_LABELS,
  refusedPlannedTypes,
} from './privacy';

describe('base legal', () => {
  it('tem as seis bases do banco, com os rótulos da tela', () => {
    expect([...LEGAL_BASES]).toEqual([
      'not_informed',
      'consent',
      'contract',
      'legitimate_interest',
      'legal_obligation',
      'exercise_of_rights',
    ]);
    expect(Object.values(LEGAL_BASIS_LABELS)).toEqual([
      'Não informada',
      'Consentimento',
      'Contrato ou pedido da pessoa',
      'Legítimo interesse',
      'Obrigação legal',
      'Exercício de direitos',
    ]);
  });

  it('consentimento não pode ser o padrão da empresa', () => {
    expect(ORGANIZATION_LEGAL_BASES).not.toContain('consent');
    expect(ORGANIZATION_LEGAL_BASES).toHaveLength(5);
    expect(organizationLegalBasisOf({ default_legal_basis: 'consent' })).toBe('not_informed');
    expect(organizationLegalBasisOf({ default_legal_basis: 'contract' })).toBe('contract');
    expect(organizationLegalBasisOf({})).toBe('not_informed');
    expect(organizationLegalBasisOf(null)).toBe('not_informed');
  });

  it('banco sem a migração: a coluna ausente conta como "não informada"', () => {
    expect(legalBasisOf({})).toBe('not_informed');
    expect(legalBasisOf(null)).toBe('not_informed');
    expect(legalBasisOf({ legal_basis: 'marketing' })).toBe('not_informed');
    expect(legalBasisOf({ legal_basis: 'consent' })).toBe('consent');
    expect(legalBasisLabel(undefined)).toBe('Não informada');
    expect(legalBasisLabel('legitimate_interest')).toBe('Legítimo interesse');
    expect(companyDefaultLabel('legitimate_interest')).toBe('Padrão da empresa: Legítimo interesse');
    expect(companyDefaultLabel(undefined)).toBe('Padrão da empresa: Não informada');
  });

  it('consentimento exige o registro, aparado; o registro tem até 500 caracteres', () => {
    expect(legalBasisNoteError('consent', '   ')).toBe(CONSENT_NOTE_REQUIRED);
    expect(legalBasisNoteError('consent', null)).toBe(CONSENT_NOTE_REQUIRED);
    expect(legalBasisNoteError('consent', 'Marcou a caixa do site.')).toBeNull();
    expect(legalBasisNoteError('contract', '')).toBeNull();
    expect(legalBasisNoteError(COMPANY_DEFAULT_CHOICE, '')).toBeNull();
    expect(legalBasisNoteError('contract', 'x'.repeat(500))).toBeNull();
    expect(legalBasisNoteError('contract', 'x'.repeat(501))).toBe(LEGAL_BASIS_NOTE_TOO_LONG);
    expect(CONSENT_NOTE_REQUIRED).toBe('Descreva como a pessoa consentiu.');
  });

  it('na criação, o padrão da empresa não envia a base, e o registro vai só quando preenchido', () => {
    expect(legalBasisChanges(null, COMPANY_DEFAULT_CHOICE, '  ')).toEqual({});
    expect(legalBasisChanges(null, COMPANY_DEFAULT_CHOICE, ' Pediu orçamento. ')).toEqual({
      legal_basis_note: 'Pediu orçamento.',
    });
    expect(legalBasisChanges(null, 'consent', ' Marcou a caixa. ')).toEqual({
      legal_basis: 'consent',
      legal_basis_note: 'Marcou a caixa.',
    });
  });

  it('na edição, só o que mudou vai no pedido, e nunca a data nem o autor', () => {
    const saved = { legal_basis: 'consent', legal_basis_note: 'Marcou a caixa.' };
    expect(legalBasisChanges(saved, 'consent', ' Marcou a caixa. ')).toEqual({});
    expect(legalBasisChanges(saved, 'consent', 'Confirmou por e-mail.')).toEqual({
      legal_basis_note: 'Confirmou por e-mail.',
    });
    expect(legalBasisChanges(saved, 'contract', '')).toEqual({ legal_basis: 'contract', legal_basis_note: null });
    // Banco sem a migração: sem tocar no campo, nada vai.
    expect(legalBasisChanges({}, 'not_informed', '')).toEqual({});
    expect(legalBasisChanges({}, COMPANY_DEFAULT_CHOICE, '')).toEqual({});
  });
});

describe('anonimização', () => {
  it('o contato sem a coluna (banco sem a migração) não está anonimizado', () => {
    expect(isAnonymized({})).toBe(false);
    expect(isAnonymized(null)).toBe(false);
    expect(isAnonymized({ anonymized_at: null })).toBe(false);
    expect(isAnonymized({ anonymized_at: '2026-10-13T12:00:00Z' })).toBe(true);
  });

  it('a confirmação aceita a palavra sem diferenciar maiúsculas e sem os espaços das pontas', () => {
    expect(ANONYMIZE_CONFIRMATION_WORD).toBe('ANONIMIZAR');
    for (const text of ['ANONIMIZAR', 'anonimizar', '  Anonimizar ']) expect(isAnonymizeConfirmation(text)).toBe(true);
    for (const text of ['', 'ANONIMIZA', 'ANONIMIZAR!', 'anonimizar contato', null, undefined])
      expect(isAnonymizeConfirmation(text)).toBe(false);
  });

  it('lê o resumo e as contagens no contrato das RPCs e recusa respostas fora dele', () => {
    const counts = {
      activities_scrubbed: 3,
      activities_deleted: 4,
      deals: 2,
      open_deals: 1,
      payments: 2,
      pending_payments: 1,
      other_records: 7,
    };
    expect(
      parsePrivacySummary({ version: '2026-10-13T12:00:00.123456+00:00', anonymized_at: null, ...counts }),
    ).toEqual({ version: '2026-10-13T12:00:00.123456+00:00', anonymized_at: null, ...counts });
    expect(parseAnonymizationCounts({ ...counts, extra: 1 })).toEqual(counts);
    expect(() => parsePrivacySummary({ ...counts, anonymized_at: null })).toThrow(/version/);
    expect(() => parsePrivacySummary({ version: 'v', ...counts, deals: -1 })).toThrow(/deals/);
    expect(() => parseAnonymizationCounts({ ...counts, other_records: '7' })).toThrow(/other_records/);
    expect(() => parseAnonymizationCounts(null)).toThrow();
  });

  it('rotula as ações do registro de privacidade', () => {
    expect(PRIVACY_ACTION_LABELS).toEqual({ export: 'Exportação', anonymize: 'Anonimização' });
  });

  it('a atividade de um contato anonimizado fica congelada; sem contato, ou com contato liberado, não', () => {
    const contacts = new Map([
      ['anon', { anonymized_at: '2026-10-13T12:00:00Z' }],
      ['ana', { anonymized_at: null }],
      ['antigo', {}],
    ]);
    expect(isFrozenActivity({ contact_id: 'anon' }, contacts)).toBe(true);
    for (const contactId of ['ana', 'antigo', 'sumiu', null, undefined])
      expect(isFrozenActivity({ contact_id: contactId }, contacts), String(contactId)).toBe(false);
  });

  it('o anonimizado não recebe vínculo novo, mas continua como o valor atual de uma edição', () => {
    const contacts = [
      { id: 'ana' },
      { id: 'anon', anonymized_at: '2026-10-13T12:00:00Z' },
      { id: 'bia', anonymized_at: null },
    ];
    expect(linkableContacts(contacts).map((contact) => contact.id)).toEqual(['ana', 'bia']);
    expect(linkableContacts(contacts, 'anon').map((contact) => contact.id)).toEqual(['ana', 'anon', 'bia']);
  });
});

describe('ações de contato para quem pediu "Não contatar"', () => {
  it('o contato marcado recusa ligação, WhatsApp, e-mail, reunião e visita pendentes; tarefa e nota passam', () => {
    const target = { contact: { do_not_contact: true } };
    expect([...refusedPlannedTypes(target)].sort()).toEqual(['call', 'email', 'meeting', 'visit', 'whatsapp']);
    for (const type of ['call', 'whatsapp', 'email', 'meeting', 'visit'])
      expect(plannedActionRefusal(type, target)).toBe(CONTACT_DO_NOT_CONTACT_REFUSAL);
    expect(plannedActionRefusal('task', target)).toBeNull();
    expect(plannedActionRefusal('note', target)).toBeNull();
  });

  it('sem contato, a empresa marcada recusa só ligação e WhatsApp', () => {
    const target = { contact: null, company: { do_not_contact: true } };
    expect([...refusedPlannedTypes(target)].sort()).toEqual(['call', 'whatsapp']);
    expect(plannedActionRefusal('whatsapp', target)).toBe(COMPANY_DO_NOT_CONTACT_REFUSAL);
    for (const type of ['email', 'meeting', 'visit', 'task']) expect(plannedActionRefusal(type, target)).toBeNull();
  });

  it('um contato liberado numa empresa marcada não é recusado, e nada é recusado sem marca', () => {
    expect(refusedPlannedTypes({ contact: { do_not_contact: false }, company: { do_not_contact: true } }).size).toBe(0);
    expect(refusedPlannedTypes({ contact: {} }).size).toBe(0);
    expect(refusedPlannedTypes({}).size).toBe(0);
  });

  it('as mensagens são as do banco', () => {
    expect(CONTACT_DO_NOT_CONTACT_REFUSAL).toMatch(/^Este contato está marcado como “Não contatar”/);
    expect(COMPANY_DO_NOT_CONTACT_REFUSAL).toMatch(/^Esta empresa está marcada como “Não contatar”/);
  });
});

describe('espelho do banco', () => {
  // As regras valem no banco; a tela só explica antes do pedido. Os textos e as listas daqui precisam ser os da migração.
  const migration = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20261013120000_contact_privacy.sql'),
    'utf8',
  );
  it('as recusas, os valores e a palavra conferem com a migração', () => {
    expect(migration).toContain(CONTACT_DO_NOT_CONTACT_REFUSAL);
    expect(migration).toContain(COMPANY_DO_NOT_CONTACT_REFUSAL);
    expect(migration).toContain("new.type not in ('call','whatsapp','email','meeting','visit')");
    expect(migration).toContain("new.type in ('call','whatsapp')");
    expect(migration).toContain(`check(legal_basis in (${LEGAL_BASES.map((basis) => `'${basis}'`).join(',')}))`);
    expect(migration).toContain(
      `check(default_legal_basis in (${ORGANIZATION_LEGAL_BASES.map((basis) => `'${basis}'`).join(',')}))`,
    );
    expect(migration).toContain('length(legal_basis_note)<=500');
  });
});
