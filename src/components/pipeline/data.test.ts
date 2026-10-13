import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: {} }));
import { allRows, errorMessage } from './data';

describe('leitura integral do pipeline', () => {
  it('carrega além da primeira página sem cortar contagens ou valores', async () => {
    const records = Array.from({ length: 1003 }, (_, id) => ({ id }));
    const page = vi.fn(async (from: number, to: number) => ({ data: records.slice(from, to + 1), error: null }));
    expect(await allRows(page)).toEqual(records);
    expect(page.mock.calls).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
  });
  it('propaga falha em página posterior em vez de mostrar totais parciais', async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Sem conexão' } });
    await expect(allRows(page)).rejects.toEqual({ message: 'Sem conexão' });
  });
});

describe('mensagens de falha do pipeline', () => {
  it('diz qual vínculo impede a exclusão quando o banco informa a tabela', () => {
    expect(
      errorMessage({
        code: '23503',
        message:
          'update or delete on table "deals" violates foreign key constraint "activities_deal_id_org_id_fkey" on table "activities"',
        details: 'Key (id, org_id)=(1, 2) is still referenced from table "activities".',
      }),
    ).toBe(
      'Este registro ainda está vinculado a atividades. Revise esses vínculos antes desta alteração ou mantenha o registro encerrado, sem excluir.',
    );
    expect(errorMessage({ code: '23503', message: 'violates foreign key' })).toMatch(/^Existem registros vinculados/);
  });

  it('troca a recusa por papel do banco por uma mensagem que cita donos e administradores', () => {
    // delete_deal recusa com 42501 e um texto que esquece os donos; a RLS recusa com "row-level security policy".
    for (const failure of [
      { code: '42501', message: 'Somente administradores podem excluir oportunidades.' },
      { code: '42501', message: 'new row violates row-level security policy for table "deals"' },
    ]) {
      const text = errorMessage(failure);
      expect(text).toBe(
        'Seu papel não permite esta ação. Peça a um dono ou administrador para revisar seu acesso. Os dados preenchidos foram mantidos.',
      );
      expect(text).not.toMatch(/Somente administradores/);
    }
  });
});
