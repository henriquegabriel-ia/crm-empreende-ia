import { describe, expect, it } from 'vitest';
import { CRM_ROLES, roleChangeAllowed } from './roles';

const FROM = [null, ...CRM_ROLES];
const allowedCount = (actor: string | null) =>
  FROM.flatMap((from) => CRM_ROLES.map((to) => roleChangeAllowed(actor, from, to))).filter(Boolean).length;

// A mesma matriz de supabase/tests/member-deactivation.sql para private.role_change_allowed (item 1.2).
describe('quem concede qual papel', () => {
  it('o dono muda qualquer papel, para qualquer papel', () => {
    expect(allowedCount('owner')).toBe(20);
  });

  it('o administrador muda as 12 combinações sem dono de nenhum lado', () => {
    expect(allowedCount('admin')).toBe(12);
    expect(roleChangeAllowed('admin', 'owner', 'owner')).toBe(false);
    expect(roleChangeAllowed('admin', 'member', 'owner')).toBe(false);
    expect(roleChangeAllowed('admin', null, 'owner')).toBe(false);
    expect(roleChangeAllowed('admin', 'member', 'admin')).toBe(true);
    expect(roleChangeAllowed('admin', null, 'viewer')).toBe(true);
  });

  it('colaborador, somente leitura e quem não tem papel não mudam papel nenhum', () => {
    expect(allowedCount('member')).toBe(0);
    expect(allowedCount('viewer')).toBe(0);
    expect(allowedCount(null)).toBe(0);
  });
});
