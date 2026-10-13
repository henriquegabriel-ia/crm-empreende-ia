import { beforeEach, describe, expect, it, vi } from 'vitest';

type Response = { data: unknown[] | null; error: { code: string; message: string } | null };
// As leituras do Pipeline (loadPipelineReferences) passam por este cliente; as funções puras não o usam.
const mocks = vi.hoisted(() => ({
  /** Cada leitura: a tabela e as colunas pedidas. */
  reads: [] as { table: string; columns: string }[],
  respond: (() => ({ data: [], error: null })) as (table: string, columns: string) => Response,
}));
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: {
    from: (table: string) => ({
      select: (columns: string) => {
        mocks.reads.push({ table, columns });
        const chain = {
          eq: () => chain,
          order: () => chain,
          range: async () => mocks.respond(table, columns),
        };
        return chain;
      },
    }),
  },
}));

import { allRows, errorMessage, loadPipelineReferences } from './data';

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

const MISSING = { code: '42703', message: 'column contacts.do_not_contact does not exist' };
const ANA = {
  id: 'contact-1',
  first_name: 'Ana',
  last_name: 'Souza',
  company_id: 'company-1',
  email: 'ana@example.com',
  phone: '+5511999990000',
  owner_id: null,
};
const PADARIA = { id: 'company-1', name: 'Padaria', phone: '+551130000000', owner_id: null };

beforeEach(() => {
  mocks.reads = [];
});

describe('referências do Pipeline com a marca "Não contatar" (item 1.9)', () => {
  it('lê telefone, e-mail e a marca dos contatos e das empresas', async () => {
    mocks.respond = (table) => ({
      data:
        table === 'contacts'
          ? [{ ...ANA, do_not_contact: true }]
          : table === 'companies'
            ? [{ ...PADARIA, do_not_contact: false }]
            : [],
      error: null,
    });
    const result = await loadPipelineReferences('org-1');
    const contactReads = mocks.reads.filter((read) => read.table === 'contacts');
    expect(contactReads).toEqual([
      {
        table: 'contacts',
        columns:
          'id,first_name,last_name,company_id,email,phone,owner_id,do_not_contact,do_not_contact_at,do_not_contact_by,do_not_contact_reason',
      },
    ]);
    expect(result.contacts[0]).toMatchObject({ full_name: 'Ana Souza', phone: '+5511999990000', do_not_contact: true });
    expect(result.companies[0]).toMatchObject({ name: 'Padaria', do_not_contact: false });
  });

  it('num banco sem a migração (coluna ausente), lê de novo sem a marca, que conta como falsa', async () => {
    for (const code of ['42703', 'PGRST204']) {
      mocks.reads = [];
      mocks.respond = (table, columns) =>
        (table === 'contacts' || table === 'companies') && columns.includes('do_not_contact')
          ? { data: null, error: { ...MISSING, code } }
          : { data: table === 'contacts' ? [ANA] : table === 'companies' ? [PADARIA] : [], error: null };
      const result = await loadPipelineReferences('org-1');
      for (const table of ['contacts', 'companies']) {
        const reads = mocks.reads.filter((read) => read.table === table);
        expect(reads, `${table} com ${code}`).toHaveLength(2);
        expect(reads[0].columns).toContain('do_not_contact');
        expect(reads[1].columns).not.toContain('do_not_contact');
      }
      expect(result.contacts[0]).toMatchObject({ full_name: 'Ana Souza', email: 'ana@example.com' });
      expect(result.contacts[0].do_not_contact ?? false).toBe(false);
      expect(result.companies[0].do_not_contact ?? false).toBe(false);
    }
  });

  it('um erro de outro tipo não é engolido', async () => {
    mocks.respond = (table) =>
      table === 'contacts'
        ? { data: null, error: { code: '42501', message: 'permission denied for table contacts' } }
        : { data: [], error: null };
    await expect(loadPipelineReferences('org-1')).rejects.toMatchObject({ code: '42501' });
    expect(mocks.reads.filter((read) => read.table === 'contacts')).toHaveLength(1);
  });
});
