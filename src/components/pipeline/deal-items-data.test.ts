import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; method: string; args: unknown[] };
const mocks = vi.hoisted(() => ({
  calls: [] as Call[],
  result: { data: [] as unknown, error: null as unknown },
  rpc: vi.fn(),
}));
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: {
    rpc: mocks.rpc,
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'range', 'insert', 'update', 'delete', 'upsert'])
        chain[method] = (...args: unknown[]) => {
          mocks.calls.push({ table, method, args });
          return chain;
        };
      chain.single = async () => mocks.result;
      chain.maybeSingle = async () => mocks.result;
      chain.then = (resolve: (value: unknown) => unknown) => resolve(mocks.result);
      return chain;
    },
  },
}));

import { isSaveDealResult, loadDealItems, saveDealWithItems } from './deal-items-data';
import {
  catalogErrorMessage,
  deleteProduct,
  duplicateCodeOf,
  insertProductBatch,
  setProductArchived,
  updateProduct,
} from '@/components/catalog/data';

const deal = { id: 'deal-1', updated_at: '2026-10-19T10:00:00.123456+00:00', value: 10 };

beforeEach(() => {
  mocks.calls = [];
  mocks.result = { data: [], error: null };
  mocks.rpc.mockReset();
});

// Item 1.16: os itens só são gravados pela RPC save_deal.
describe('save_deal pelo navegador', () => {
  it('cria sem versão e com os itens, os meses e os campos', async () => {
    mocks.rpc.mockResolvedValue({ data: { deal, items: [], replayed: false }, error: null });
    const items = [
      {
        id: 'i1',
        product_id: null,
        position: 0,
        name: 'Mensal',
        quantity: '1.000',
        unit: null,
        unit_price: '10.00',
        discount_type: null,
        discount_value: null,
        billing: 'monthly' as const,
      },
    ];
    await saveDealWithItems({ dealId: 'deal-1', fields: { title: 'Nova' }, items, contractMonths: 12 });
    expect(mocks.rpc).toHaveBeenCalledWith('save_deal', {
      p_deal_id: 'deal-1',
      p_fields: { title: 'Nova' },
      p_items: items,
      p_contract_months: 12,
    });
  });

  it('edita a versão lida, manda [] para remover todos e não manda meses sem itens', async () => {
    mocks.rpc.mockResolvedValue({ data: { deal, items: [], replayed: false }, error: null });
    await saveDealWithItems({ dealId: 'deal-1', version: deal.updated_at, items: [], contractMonths: 3 });
    expect(mocks.rpc).toHaveBeenLastCalledWith('save_deal', {
      p_deal_id: 'deal-1',
      p_version: deal.updated_at,
      p_items: [],
      p_contract_months: 3,
    });
    await saveDealWithItems({
      dealId: 'deal-1',
      version: deal.updated_at,
      fields: { title: 'Só o título' },
      contractMonths: 3,
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith('save_deal', {
      p_deal_id: 'deal-1',
      p_version: deal.updated_at,
      p_fields: { title: 'Só o título' },
    });
  });

  it('propaga a recusa da RPC e desconfia de uma resposta de outra oportunidade', async () => {
    const refusal = { code: 'P0001', message: 'Informe por quantos meses o contrato vale, de 1 a 120.' };
    mocks.rpc.mockResolvedValue({ data: null, error: refusal });
    await expect(saveDealWithItems({ dealId: 'deal-1', items: [] })).rejects.toBe(refusal);
    mocks.rpc.mockResolvedValue({ data: { deal: { ...deal, id: 'outra' }, items: [], replayed: false }, error: null });
    await expect(saveDealWithItems({ dealId: 'deal-1', items: [] })).rejects.toThrow(/inesperado/);
    expect(isSaveDealResult({ deal, items: [], replayed: true }, 'deal-1')).toBe(true);
    expect(isSaveDealResult({ deal, items: null, replayed: true }, 'deal-1')).toBe(false);
    expect(isSaveDealResult(null, 'deal-1')).toBe(false);
  });

  it('lê os itens de uma oportunidade em ordem, filtrados pela organização', async () => {
    mocks.result = { data: [{ id: 'i1' }], error: null };
    expect(await loadDealItems('org-1', 'deal-1')).toEqual([{ id: 'i1' }]);
    expect(mocks.calls.map((call) => [call.method, ...call.args])).toEqual([
      ['select', expect.stringContaining('line_total')],
      ['eq', 'org_id', 'org-1'],
      ['eq', 'deal_id', 'deal-1'],
      ['order', 'position'],
      ['order', 'id'],
    ]);
  });
});

describe('gravação do catálogo', () => {
  const product = { id: 'p1', updated_at: '2026-10-19T10:00:00.5+00:00' };
  const fields = {
    name: 'Implantação',
    code: 'IMP',
    kind: 'service' as const,
    unit: null,
    price: 1500,
    billing: 'one_time' as const,
  };

  it('edita, arquiva e reativa só a versão lida, e acusa o conflito sem linha', async () => {
    mocks.result = { data: { ...product, ...fields }, error: null };
    await updateProduct('org-1', product, fields);
    expect(mocks.calls).toContainEqual({ table: 'products', method: 'eq', args: ['updated_at', product.updated_at] });
    mocks.result = { data: null, error: null };
    await expect(setProductArchived('org-1', product, true)).rejects.toThrow(/mudou ou não está mais disponível/);
    expect(
      mocks.calls.find((call) => call.method === 'update' && 'archived_at' in (call.args[0] as object)),
    ).toBeTruthy();
  });

  it('importa em lote pelo id da prévia, sem duplicar numa nova tentativa', async () => {
    mocks.result = { data: [{ id: 'a' }], error: null };
    expect(await insertProductBatch('org-1', [{ ...fields, id: 'a' }])).toEqual(['a']);
    expect(mocks.calls.find((call) => call.method === 'upsert')?.args).toEqual([
      [{ ...fields, id: 'a', org_id: 'org-1' }],
      { onConflict: 'id', ignoreDuplicates: true },
    ]);
    expect(await insertProductBatch('org-1', [])).toEqual([]);
  });

  it('exclui só o que encontrou', async () => {
    mocks.result = { data: [], error: null };
    await expect(deleteProduct('org-1', 'p1')).rejects.toThrow(/mudou/);
  });

  it('traduz as recusas do banco', () => {
    const duplicate = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "products_org_code"',
      details: 'Key (org_id, lower(btrim(code)))=(00000000-0000-0000-0000-000000000001, imp-01) already exists.',
    };
    expect(duplicateCodeOf(duplicate)).toBe('imp-01');
    expect(catalogErrorMessage(duplicate, ' IMP-01 ')).toBe('Já existe um item com o código “IMP-01”.');
    expect(catalogErrorMessage(duplicate)).toBe('Já existe um item com o código “imp-01”.');
    expect(
      catalogErrorMessage({
        code: '23503',
        message:
          'update or delete on table "products" violates foreign key constraint "deal_items_product_id_org_id_fkey" on table "deal_items"',
      }),
    ).toBe('Este item já foi usado em oportunidades. Arquive para tirá-lo das escolhas.');
    expect(
      catalogErrorMessage({
        code: '42501',
        message: 'new row violates row-level security policy for table "products"',
      }),
    ).toBe('Somente donos e administradores alteram o catálogo. Você pode consultá-lo.');
    expect(catalogErrorMessage({ code: 'PGRST205', message: "Could not find the table 'public.products'" })).toMatch(
      /ainda não tem a atualização do catálogo/,
    );
    expect(catalogErrorMessage(new Error('Este item do catálogo mudou.'))).toBe('Este item do catálogo mudou.');
    expect(duplicateCodeOf({ code: '23505', message: 'contacts_email' })).toBeNull();
  });
});
