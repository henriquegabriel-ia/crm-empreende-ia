import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: {} }));
import {
  assignableMembers,
  defaultAssignee,
  filterMembers,
  memberLabel,
  portfolioSummary,
  portfolioToPass,
  readMemberRoles,
  readPortfolioCounts,
  withMemberStates,
} from './team-members';

const people = [
  { id: 'u-bruno', name: 'Bruno', email: 'bruno@example.test' },
  { id: 'u-ana', name: 'Ana', email: 'ana@example.test' },
  { id: 'u-carla', name: 'Carla', email: 'carla@example.test' },
  { id: 'u-sem-papel', name: '', email: 'orfa@example.test' },
];
const roles = [
  { userId: 'u-bruno', role: 'member' as const, deactivatedAt: null },
  { userId: 'u-ana', role: 'owner' as const, deactivatedAt: null },
  { userId: 'u-carla', role: 'admin' as const, deactivatedAt: '2026-10-13T15:00:00Z' },
];

describe('membros com a situação do papel (item 1.2)', () => {
  it('junta perfis e papéis: sem papel na organização, a pessoa conta como desativada', () => {
    expect(withMemberStates(people, roles)).toEqual([
      { ...people[0], role: 'member', active: true, deactivatedAt: null },
      { ...people[1], role: 'owner', active: true, deactivatedAt: null },
      { ...people[2], role: 'admin', active: false, deactivatedAt: '2026-10-13T15:00:00Z' },
      { ...people[3], role: null, active: false, deactivatedAt: null },
    ]);
  });

  it('lê os papéis com a data da desativação', async () => {
    const read = vi.fn(async () => [
      { id: 'r1', user_id: 'u-1', role: 'admin', deactivated_at: '2026-10-13T15:00:00Z' },
    ]);
    expect(await readMemberRoles('org-1', read)).toEqual([
      { userId: 'u-1', role: 'admin', deactivatedAt: '2026-10-13T15:00:00Z' },
    ]);
    expect(read).toHaveBeenCalledWith('id,user_id,role,deactivated_at');
  });

  it.each(['42703', 'PGRST204'])('banco sem a migração (%s): lê só o papel e trata todos como ativos', async (code) => {
    const read = vi
      .fn()
      .mockRejectedValueOnce({ code, message: 'column user_roles.deactivated_at does not exist' })
      .mockResolvedValueOnce([{ id: 'r1', user_id: 'u-1', role: 'viewer' }]);
    expect(await readMemberRoles('org-1', read)).toEqual([{ userId: 'u-1', role: 'viewer', deactivatedAt: null }]);
    expect(read.mock.calls).toEqual([['id,user_id,role,deactivated_at'], ['id,user_id,role']]);
  });

  it.each(['PGRST000', '08006'])(
    'outras falhas da leitura dos papéis (%s) continuam sendo falhas, sem o recuo que trataria todos como ativos',
    async (code) => {
      const failure = { code, message: 'falha' };
      // A segunda leitura, se acontecesse, devolveria todos ativos: quem foi desativado voltaria aos seletores.
      const read = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce([{ id: 'r1', user_id: 'u-1', role: 'member' }]);
      await expect(readMemberRoles('org-1', read)).rejects.toBe(failure);
      expect(read.mock.calls).toEqual([['id,user_id,role,deactivated_at']]);
    },
  );

  it('memberLabel: nome, "(desativado)", e-mail sem nome, indisponível e sem responsável', () => {
    expect(memberLabel({ id: 'a', name: 'Ana', active: true })).toBe('Ana');
    expect(memberLabel({ id: 'a', full_name: 'Ana' })).toBe('Ana');
    expect(memberLabel({ id: 'c', name: 'Carla', active: false })).toBe('Carla (desativado)');
    expect(memberLabel({ id: 'o', name: ' ', email: 'orfa@example.test', active: false })).toBe(
      'orfa@example.test (desativado)',
    );
    expect(memberLabel(undefined, 'perdido')).toBe('Responsável indisponível');
    expect(memberLabel(undefined, null)).toBe('Sem responsável');
  });

  it('assignableMembers: só ativos, em ordem alfabética, e o atual desativado por último, para o seletor mostrar', () => {
    const members = withMemberStates(people, roles);
    expect(assignableMembers(members).map((member) => member.id)).toEqual(['u-ana', 'u-bruno']);
    expect(assignableMembers(members, 'u-bruno').map((member) => member.id)).toEqual(['u-ana', 'u-bruno']);
    expect(assignableMembers(members, 'u-carla').map((member) => memberLabel(member))).toEqual([
      'Ana',
      'Bruno',
      'Carla (desativado)',
    ]);
    // Dados montados antes do item, sem a situação: todos ativos.
    expect(assignableMembers(people.slice(0, 2)).map((member) => member.id)).toEqual(['u-ana', 'u-bruno']);
  });

  it('defaultAssignee: o preferido se estiver ativo; senão, quem está usando', () => {
    const members = withMemberStates(people, roles);
    expect(defaultAssignee('u-bruno', members, 'u-ana')).toBe('u-bruno');
    expect(defaultAssignee('u-carla', members, 'u-ana')).toBe('u-ana');
    expect(defaultAssignee('u-desconhecido', members, 'u-ana')).toBe('u-ana');
    expect(defaultAssignee(null, members, null)).toBeNull();
  });

  it('filterMembers: os ativos e, depois, os desativados', () => {
    const members = withMemberStates(people, roles);
    expect(filterMembers(members).map((member) => memberLabel(member))).toEqual([
      'Ana',
      'Bruno',
      'Carla (desativado)',
      'orfa@example.test (desativado)',
    ]);
  });

  it('readPortfolioCounts: a linha da RPC ou o JSON da recusa; nulo para o resto', () => {
    const counts = { deals: 3, activities: 5, contacts: 12, companies: 2, invitations: 1 };
    expect(readPortfolioCounts([counts])).toEqual(counts);
    expect(readPortfolioCounts(counts)).toEqual(counts);
    expect(readPortfolioCounts(JSON.stringify(counts))).toEqual(counts);
    expect(readPortfolioCounts('{"deals":3}')).toBeNull();
    expect(readPortfolioCounts('não é JSON')).toBeNull();
    expect(readPortfolioCounts({ ...counts, deals: -1 })).toBeNull();
    expect(readPortfolioCounts(null)).toBeNull();
    expect(readPortfolioCounts(undefined)).toBeNull();
  });

  it('portfolioSummary: singular, plural, "e" no fim e sem as contagens zeradas', () => {
    expect(portfolioSummary({ deals: 3, activities: 5, contacts: 12, companies: 2 })).toBe(
      '3 oportunidades em aberto, 5 atividades pendentes, 12 contatos e 2 empresas',
    );
    expect(portfolioSummary({ deals: 1, activities: 1, contacts: 0, companies: 1 })).toBe(
      '1 oportunidade em aberto, 1 atividade pendente e 1 empresa',
    );
    expect(portfolioSummary({ deals: 0, activities: 0, contacts: 1, companies: 0 })).toBe('1 contato');
    expect(portfolioSummary({ deals: 0, activities: 0, contacts: 0, companies: 0 })).toBe('');
  });

  it('portfolioToPass: contatos e empresas só contam com a caixa marcada', () => {
    const counts = { deals: 1, activities: 2, contacts: 3, companies: 4, invitations: 5 };
    expect(portfolioToPass(counts, false)).toBe(3);
    expect(portfolioToPass(counts, true)).toBe(10);
  });
});
