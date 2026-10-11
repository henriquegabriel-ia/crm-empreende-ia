import { describe, expect, it } from 'vitest';
import {
  blockingTableLabel,
  countLabel,
  dealLinkSummary,
  dealLinkTotal,
  joinPt,
  linkSummary,
  readDealLinkCounts,
} from '@/lib/record-links';

describe('vínculos de uma exclusão', () => {
  it('escreve contagens e listas em português', () => {
    expect(countLabel(1, 'atividade', 'atividades')).toBe('1 atividade');
    expect(countLabel(0, 'atividade', 'atividades')).toBe('0 atividades');
    expect(joinPt([])).toBe('');
    expect(joinPt(['a'])).toBe('a');
    expect(joinPt(['a', 'b'])).toBe('a e b');
    expect(joinPt(['a', 'b', 'c'])).toBe('a, b e c');
    expect(
      linkSummary([
        [2, 'contato', 'contatos'],
        [0, 'oportunidade', 'oportunidades'],
        [1, 'recebimento', 'recebimentos'],
      ]),
    ).toBe('2 contatos e 1 recebimento');
    expect(linkSummary([[0, 'atividade', 'atividades']])).toBe('');
  });

  it('resume os vínculos da oportunidade na mesma ordem da mensagem de delete_deal', () => {
    const counts = { activities: 3, payments: 1, automation_logs: 5 };
    expect(dealLinkSummary(counts)).toBe('3 atividades, 1 recebimento e 5 registros de automação');
    expect(dealLinkTotal(counts)).toBe(9);
    expect(dealLinkSummary({ activities: 0, payments: 0, automation_logs: 1 })).toBe('1 registro de automação');
  });

  it('lê as contagens devolvidas por delete_deal ou enviadas no detalhe da recusa', () => {
    const counts = { activities: 2, payments: 0, automation_logs: 1 };
    expect(readDealLinkCounts(counts)).toEqual(counts);
    expect(readDealLinkCounts('{"activities":2,"payments":0,"automation_logs":1}')).toEqual(counts);
    expect(readDealLinkCounts('Key (id)=(x) is still referenced')).toBeNull();
    expect(readDealLinkCounts(null)).toBeNull();
    expect(readDealLinkCounts([1, 2])).toBeNull();
    expect(readDealLinkCounts({ activities: -1, payments: 0, automation_logs: 0 })).toBeNull();
    expect(readDealLinkCounts({ activities: 1, payments: 0 })).toBeNull();
  });

  it('identifica a tabela que ainda referencia o registro numa falha 23503', () => {
    expect(
      blockingTableLabel({
        code: '23503',
        message:
          'update or delete on table "contacts" violates foreign key constraint "payments_contact_id_org_id_fkey" on table "payments"',
        details: 'Key (id, org_id)=(1, 2) is still referenced from table "payments".',
      }),
    ).toBe('recebimentos');
    expect(
      blockingTableLabel({
        code: '23503',
        message:
          'update or delete on table "deals" violates foreign key constraint "activities_deal_id_org_id_fkey" on table "activities"',
      }),
    ).toBe('atividades');
    // Inserção com referência inexistente não é um vínculo que bloqueia a exclusão.
    expect(
      blockingTableLabel({
        code: '23503',
        message: 'insert or update on table "deals" violates foreign key constraint "deals_contact_id_org_id_fkey"',
        details: 'Key (contact_id, org_id)=(1, 2) is not present in table "contacts".',
      }),
    ).toBeNull();
    expect(blockingTableLabel({ code: '23505', details: 'is still referenced from table "payments".' })).toBeNull();
    expect(blockingTableLabel({ code: '23503', details: 'is still referenced from table "custom_table".' })).toBeNull();
    expect(blockingTableLabel(null)).toBeNull();
  });
});
