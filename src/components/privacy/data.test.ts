import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportFileName } from '@/lib/brand';

type Result = { data: unknown; error: unknown; count?: number | null };
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  // Cada leitura de tabela devolve o próximo resultado da fila; as chamadas da cadeia ficam registradas.
  results: [] as Result[],
  calls: [] as { table: string; steps: [string, unknown[]][] }[],
  download: vi.fn(),
}));
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: {
    rpc: mocks.rpc,
    from: (table: string) => {
      const call = { table, steps: [] as [string, unknown[]][] };
      mocks.calls.push(call);
      const result = () => Promise.resolve(mocks.results.shift() ?? { data: null, error: null });
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'is', 'order', 'limit'])
        chain[name] = (...args: unknown[]) => {
          call.steps.push([name, args]);
          return chain;
        };
      chain.range = (...args: unknown[]) => {
        call.steps.push(['range', args]);
        return result();
      };
      chain.maybeSingle = () => result();
      return chain;
    },
  },
}));
vi.mock('@/lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/csv')>()),
  downloadBytes: mocks.download,
}));

import { readZip } from '@/test/zip-reader';
import {
  anonymizationVersionChanged,
  anonymizeContact,
  downloadContactExport,
  fetchPrivacySummary,
  loadContactExportRows,
  loadLastPrivacyAction,
  loadOrganizationPrivacy,
  loadPrivacyActionsPage,
  PRIVACY_ACTIONS_PAGE_SIZE,
  privacyQueryKeys,
} from './data';

const COUNTS = {
  activities_scrubbed: 3,
  activities_deleted: 4,
  deals: 2,
  open_deals: 1,
  payments: 2,
  pending_payments: 1,
  other_records: 7,
};
const EXPORT = {
  format: 1,
  generated_at: '2026-10-13T15:30:00+00:00',
  organization: { name: 'Acme' },
  contact: {
    id: '1a2b3c4d-0000-0000-0000-000000000001',
    first_name: 'Ana',
    last_name: 'Souza',
    email: null,
    phone: null,
    job_title: null,
    source: null,
    notes: null,
    status: 'lead',
    created_at: '2026-09-01T12:00:00+00:00',
    updated_at: '2026-09-01T12:00:00+00:00',
    legal_basis: 'contract',
    legal_basis_note: null,
    legal_basis_at: null,
    do_not_contact: false,
    do_not_contact_at: null,
    do_not_contact_reason: null,
    anonymized_at: null,
  },
  company: null,
  activities: [],
  deals: [],
  payments: [],
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.download.mockReset();
  mocks.results = [];
  mocks.calls = [];
});
afterEach(() => vi.clearAllMocks());

describe('RPCs de privacidade', () => {
  it('lê o resumo pelo contato e sobe a recusa do banco como veio', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { version: 'v1', anonymized_at: null, ...COUNTS }, error: null });
    await expect(fetchPrivacySummary('contact-1')).resolves.toEqual({ version: 'v1', anonymized_at: null, ...COUNTS });
    expect(mocks.rpc).toHaveBeenCalledWith('contact_privacy_summary', { p_contact_id: 'contact-1' });
    const refusal = { code: 'P0001', message: 'Somente donos e administradores anonimizam contatos.' };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: refusal });
    await expect(fetchPrivacySummary('contact-1')).rejects.toBe(refusal);
  });

  it('anonimiza com a versão lida no resumo', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: COUNTS, error: null });
    await expect(anonymizeContact('contact-1', '2026-10-13T12:00:00.123456+00:00')).resolves.toEqual(COUNTS);
    expect(mocks.rpc).toHaveBeenCalledWith('anonymize_contact', {
      p_contact_id: 'contact-1',
      p_version: '2026-10-13T12:00:00.123456+00:00',
    });
  });

  it('reconhece a recusa por versão, que pede recarregar o resumo', () => {
    expect(
      anonymizationVersionChanged({
        code: 'P0001',
        message: 'Este contato mudou desde o resumo. Confira o resumo atualizado e confirme de novo.',
      }),
    ).toBe(true);
    expect(anonymizationVersionChanged({ code: 'P0001', message: 'Este contato já foi anonimizado.' })).toBe(false);
    expect(anonymizationVersionChanged(null)).toBe(false);
  });

  it('exporta: a RPC, o .zip e o nome de arquivo da marca, sem o nome da pessoa', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: EXPORT, error: null });
    const { filename, data } = await downloadContactExport(EXPORT.contact.id, '2026-10-13');
    expect(mocks.rpc).toHaveBeenCalledWith('export_contact_data', { p_contact_id: EXPORT.contact.id });
    expect(filename).toBe(exportFileName('dados-contato-1a2b3c4d', 'zip', '2026-10-13'));
    expect(filename).not.toMatch(/ana|souza/i);
    expect(data.contact.first_name).toBe('Ana');
    const [name, bytes, type] = mocks.download.mock.calls[0];
    expect(name).toBe(filename);
    expect(type).toBe('application/zip');
    expect(readZip(bytes).map((entry) => entry.name)).toContain('dados.json');
  });

  it('não baixa nada quando a exportação é recusada', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'Somente donos e administradores exportam os dados de um contato.' },
    });
    await expect(downloadContactExport('contact-1')).rejects.toMatchObject({ code: 'P0001' });
    expect(mocks.download).not.toHaveBeenCalled();
  });
});

describe('registros de privacidade', () => {
  it('a ficha lê o último registro do contato, na organização', async () => {
    mocks.results.push({ data: { id: 'action-1', action: 'export' }, error: null });
    await expect(loadLastPrivacyAction('org-1', 'contact-1')).resolves.toMatchObject({ id: 'action-1' });
    expect(mocks.calls[0].table).toBe('privacy_actions');
    expect(mocks.calls[0].steps).toEqual(
      expect.arrayContaining([
        ['eq', ['org_id', 'org-1']],
        ['eq', ['contact_id', 'contact-1']],
        ['order', ['created_at', { ascending: false }]],
        ['limit', [1]],
      ]),
    );
  });

  it('"Segurança" pagina de 30 em 30, com o contato e quem fez pelas FKs', async () => {
    mocks.results.push({ data: [{ id: 'action-1' }], error: null, count: 31 });
    await expect(loadPrivacyActionsPage('org-1', 1)).resolves.toEqual({ rows: [{ id: 'action-1' }], total: 31 });
    const select = mocks.calls[0].steps.find(([name]) => name === 'select')![1];
    expect(select[0]).toContain('contact:contacts!privacy_actions_contact_id_org_id_fkey(');
    expect(select[0]).toContain('author:profiles!privacy_actions_performed_by_org_id_fkey(id,name,email)');
    expect(select[1]).toEqual({ count: 'exact' });
    expect(mocks.calls[0].steps).toContainEqual([
      'range',
      [PRIVACY_ACTIONS_PAGE_SIZE, 2 * PRIVACY_ACTIONS_PAGE_SIZE - 1],
    ]);
  });

  it('quem fez vem com a situação do papel, para a marca "(desativado)" de quem saiu da equipe', async () => {
    mocks.results.push(
      {
        data: [
          { id: 'action-1', author: { id: 'user-1', name: 'Ana', email: 'ana@example.test' } },
          { id: 'action-2', author: { id: 'user-2', name: 'Bruno', email: 'bruno@example.test' } },
          { id: 'action-3', author: null },
        ],
        error: null,
        count: 3,
      },
      {
        data: [
          { id: 'role-1', user_id: 'user-1', role: 'owner', deactivated_at: null },
          { id: 'role-2', user_id: 'user-2', role: 'member', deactivated_at: '2026-10-14T12:00:00Z' },
        ],
        error: null,
      },
    );
    const { rows } = await loadPrivacyActionsPage('org-1', 0);
    expect(rows.map((row) => row.author?.active ?? null)).toEqual([true, false, null]);
    expect(mocks.calls[1].table).toBe('user_roles');
  });

  it('as chaves seguem os nomes de CRM_QUERY_READS', () => {
    expect(privacyQueryKeys.lastAction('org', 'contact')).toEqual(['crm', 'org', 'privacy-actions', 'contact']);
    expect(privacyQueryKeys.page('org', 2)).toEqual(['crm', 'org', 'privacy-actions-page', 2]);
    expect(privacyQueryKeys.summary('org', 'contact')).toEqual(['crm', 'org', 'privacy-summary', 'contact']);
    expect(privacyQueryKeys.organization('org')).toEqual(['crm', 'org', 'organization-privacy']);
  });
});

describe('padrão da base legal da empresa', () => {
  it('lê o padrão, a data e o autor', async () => {
    mocks.results.push({
      data: {
        default_legal_basis: 'legitimate_interest',
        default_legal_basis_at: '2026-10-13',
        default_legal_basis_by: 'u1',
      },
      error: null,
    });
    await expect(loadOrganizationPrivacy('org-1')).resolves.toEqual({
      available: true,
      defaultLegalBasis: 'legitimate_interest',
      defaultLegalBasisAt: '2026-10-13',
      defaultLegalBasisBy: 'u1',
    });
  });

  it('num banco sem a migração, indisponível e sem erro; outras falhas sobem', async () => {
    mocks.results.push({
      data: null,
      error: { code: '42703', message: 'column organizations.default_legal_basis does not exist' },
    });
    await expect(loadOrganizationPrivacy('org-1')).resolves.toMatchObject({
      available: false,
      defaultLegalBasis: 'not_informed',
    });
    mocks.results.push({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(loadOrganizationPrivacy('org-1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('planilha de contatos', () => {
  it('lê a marca e a base legal e deixa de fora os anonimizados', async () => {
    mocks.results.push({ data: [{ first_name: 'Ana', do_not_contact: true, legal_basis: 'consent' }], error: null });
    await expect(loadContactExportRows('org-1')).resolves.toEqual({
      rows: [{ first_name: 'Ana', do_not_contact: true, legal_basis: 'consent' }],
      privacy: true,
    });
    expect(mocks.calls[0].steps).toContainEqual([
      'select',
      ['first_name,last_name,email,phone,do_not_contact,legal_basis'],
    ]);
    expect(mocks.calls[0].steps).toContainEqual(['is', ['anonymized_at', null]]);
  });

  it('num banco sem a migração, refaz a leitura com as quatro colunas de antes', async () => {
    mocks.results.push({ data: null, error: { code: '42703', message: 'column contacts.legal_basis does not exist' } });
    mocks.results.push({ data: [{ first_name: 'Ana' }], error: null });
    await expect(loadContactExportRows('org-1')).resolves.toEqual({ rows: [{ first_name: 'Ana' }], privacy: false });
    expect(mocks.calls[1].steps).toContainEqual(['select', ['first_name,last_name,email,phone']]);
    expect(mocks.calls[1].steps.some(([name]) => name === 'is')).toBe(false);
  });

  it('sem a migração dos canais (1.9), também refaz; outras falhas sobem', async () => {
    mocks.results.push({
      data: null,
      error: { code: '42703', message: 'column contacts.do_not_contact does not exist' },
    });
    mocks.results.push({ data: [], error: null });
    await expect(loadContactExportRows('org-1')).resolves.toEqual({ rows: [], privacy: false });
    mocks.results.push({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(loadContactExportRows('org-1')).rejects.toMatchObject({ code: '42501' });
  });
});
