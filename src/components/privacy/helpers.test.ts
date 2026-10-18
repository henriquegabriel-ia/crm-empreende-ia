import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: {} }));

import { anonymizedSummary, REMOVED_FROM_RECORD, removedLines } from './anonymization-text';
import { privacyErrorMessage } from './data';
import { authorStamp, shortDate } from './stamp';

const ZERO = {
  activities_scrubbed: 0,
  activities_deleted: 0,
  deals: 0,
  open_deals: 0,
  payments: 0,
  pending_payments: 0,
  other_records: 0,
};

describe('carimbos do banco na tela (item 1.10)', () => {
  const members = [
    { id: 'ana', name: 'Ana Lima', email: 'ana@example.test' },
    { id: 'saiu', name: 'Bruno', email: 'bruno@example.test', active: false },
  ];
  it('com o autor, sem autor (chave service_role) e com o autor fora da equipe carregada', () => {
    const at = '2026-10-12T15:00:00Z';
    const date = shortDate(at)!;
    expect(date).toMatch(/^\d{2}\/\d{2}\/2026$/);
    expect(authorStamp('Registrada', at, 'ana', members)).toBe(`Registrada por Ana Lima em ${date}.`);
    expect(authorStamp('Registrada', at, 'saiu', members)).toBe(`Registrada por Bruno (desativado) em ${date}.`);
    expect(authorStamp('Registrada', at, null, members)).toBe(`Registrada em ${date}.`);
    expect(authorStamp('Definida', at, 'outra', members)).toBe(`Definida por uma pessoa indisponível em ${date}.`);
  });
  it('sem data, ou com data ilegível, não há carimbo', () => {
    expect(authorStamp('Registrada', null, 'ana', [])).toBeNull();
    expect(authorStamp('Registrada', 'ontem', 'ana', [])).toBeNull();
    expect(shortDate(undefined)).toBeNull();
  });
});

describe('textos da anonimização (item 1.10)', () => {
  it('singular e plural, sem linha para contagem zerada', () => {
    expect(removedLines(ZERO)).toEqual([REMOVED_FROM_RECORD]);
    expect(REMOVED_FROM_RECORD).toBe(
      'Nome, e-mail, telefone, cargo, observações, a empresa, o motivo do “Não contatar” e o registro da base legal; da origem, saem o nome, o e-mail e o telefone.',
    );
    expect(removedLines({ ...ZERO, activities_scrubbed: 1, deals: 1, other_records: 1 })).toEqual([
      REMOVED_FROM_RECORD,
      '1 atividade com a pessoa fica sem título e sem anotações.',
      '1 oportunidade deixa de apontar para a pessoa, e o nome, o e-mail e o telefone dela saem dos títulos.',
      '1 outro registro cita o nome completo, o e-mail ou o telefone e também será ajustado.',
    ]);
    expect(removedLines({ ...ZERO, payments: 2 })[1]).toBe(
      '2 recebimentos deixam de apontar para a pessoa, e o nome, o e-mail e o telefone dela saem dos títulos.',
    );
  });
  it('as ações pendentes só falam das oportunidades quando a pessoa tem oportunidade', () => {
    expect(removedLines({ ...ZERO, activities_deleted: 2 })[1]).toBe('2 ações pendentes com a pessoa serão excluídas.');
    expect(removedLines({ ...ZERO, activities_deleted: 1, deals: 1 })[1]).toBe(
      '1 ação pendente com a pessoa será excluída, inclusive as das oportunidades; combine de novo a próxima ação dessas oportunidades.',
    );
  });
  it('o aviso de sucesso usa as contagens devolvidas', () => {
    expect(anonymizedSummary(ZERO)).toBe('O cadastro ficou sem dados pessoais.');
    expect(anonymizedSummary({ ...ZERO, activities_scrubbed: 1 })).toBe(
      '1 registro ajustado. O histórico comercial ficou sem nomes e anotações.',
    );
    expect(anonymizedSummary({ ...ZERO, activities_deleted: 2 })).toBe(
      '2 ações pendentes excluídas. O histórico comercial ficou sem nomes e anotações.',
    );
  });
});

describe('mensagens de falha da privacidade (item 1.10)', () => {
  it('a migração ausente, o impasse, o tempo-limite, as recusas do banco e o resto', () => {
    expect(
      privacyErrorMessage(
        { code: 'PGRST202', message: 'Could not find the function public.anonymize_contact' },
        'Falhou.',
      ),
    ).toBe(
      'Este CRM ainda não tem a atualização de privacidade (LGPD). Peça a quem administra para aplicar a migração mais recente.',
    );
    expect(privacyErrorMessage({ code: '40P01', message: 'deadlock detected' }, 'Falhou.')).toBe(
      'Outra gravação aconteceu ao mesmo tempo, e nada foi alterado. Tente de novo.',
    );
    expect(
      privacyErrorMessage({ code: '57014', message: 'canceling statement due to statement timeout' }, 'Falhou.'),
    ).toBe('A operação demorou demais, e nada foi alterado. Tente de novo.');
    expect(privacyErrorMessage({ code: 'P0001', message: 'Este contato já foi anonimizado.' }, 'Falhou.')).toBe(
      'Este contato já foi anonimizado.',
    );
    expect(privacyErrorMessage({ code: '42501', message: 'permission denied' }, 'Falhou.')).toBe('Falhou.');
    // Uma coluna ausente de outro item não é a migração de privacidade.
    expect(
      privacyErrorMessage({ code: '42703', message: 'column contacts.do_not_contact does not exist' }, 'Falhou.'),
    ).toBe('Falhou.');
  });
});
