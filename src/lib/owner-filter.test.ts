import { describe, expect, it } from 'vitest';
import { matchesOwnerFilter, ownerFilterPeople, readOwnerFilter, type OwnerFilterContext } from './owner-filter';

// Item 1.14: o filtro de responsável de Hoje, Atividades, Tarefas e Agenda, com uma pessoa da equipe.
const members = [
  { id: 'me', name: 'Pessoa de Teste', email: 'me@example.test', active: true },
  { id: 'bia', name: 'Bia Souza', email: 'bia@example.test', active: true },
  { id: 'fulano', name: 'Fulano Vendedor', email: 'fulano@example.test', active: false },
  { id: 'ana', name: 'Ana Lima', email: 'ana@example.test', active: true },
];
const today: OwnerFilterContext = {
  scopes: ['mine', 'all'],
  fallback: 'mine',
  userId: 'me',
  members,
  canViewTeam: true,
};
const activities: OwnerFilterContext = { ...today, scopes: ['all', 'mine', 'unassigned'], fallback: 'all' };

describe('filtro de responsável das telas de rotina', () => {
  it('lê os recortes fixos que a tela oferece e cai no padrão com os demais', () => {
    expect(readOwnerFilter('mine', today)).toEqual({ value: 'mine', scope: 'mine', person: null, ownerId: 'me' });
    expect(readOwnerFilter('all', today)).toEqual({ value: 'all', scope: 'all', person: null, ownerId: null });
    // Hoje não tem "Sem responsável": o valor vira o padrão, "Minha rotina".
    expect(readOwnerFilter('unassigned', today).scope).toBe('mine');
    expect(readOwnerFilter('unassigned', activities)).toMatchObject({ scope: 'unassigned', ownerId: null });
    expect(readOwnerFilter(null, today).value).toBe('mine');
    expect(readOwnerFilter(null, activities).value).toBe('all');
    expect(readOwnerFilter('qualquer', activities).value).toBe('all');
  });

  it('lê uma pessoa da equipe, inclusive desativada, e o id da própria conta como "mine"', () => {
    expect(readOwnerFilter('bia', today)).toEqual({
      value: 'bia',
      scope: 'person',
      person: members[1],
      ownerId: 'bia',
    });
    expect(readOwnerFilter('fulano', activities)).toMatchObject({ scope: 'person', ownerId: 'fulano' });
    expect(readOwnerFilter('me', today)).toMatchObject({ value: 'mine', scope: 'mine', ownerId: 'me' });
  });

  it('sem ver a equipe, com um id de fora dela ou com a equipe ainda carregando, fica no padrão', () => {
    expect(readOwnerFilter('bia', { ...today, canViewTeam: false }).value).toBe('mine');
    expect(readOwnerFilter('desconhecido', today).value).toBe('mine');
    expect(readOwnerFilter('bia', { ...activities, members: [] }).value).toBe('all');
    // Sem conta, "Minha rotina" não mostra ninguém.
    expect(readOwnerFilter('mine', { ...today, userId: null }).ownerId).toBeNull();
  });

  it('a lista tira a própria conta e põe as desativadas depois das ativas, em ordem alfabética', () => {
    expect(ownerFilterPeople(members, 'me').map((person) => person.id)).toEqual(['ana', 'bia', 'fulano']);
    expect(ownerFilterPeople(members, null).map((person) => person.id)).toEqual(['ana', 'bia', 'me', 'fulano']);
  });

  it('cada recorte deixa passar só as atividades dele', () => {
    const owners = ['me', 'bia', 'fulano', null];
    const pass = (raw: string, context = activities) =>
      owners.filter((owner) => matchesOwnerFilter(owner, readOwnerFilter(raw, context)));
    expect(pass('all')).toEqual(owners);
    expect(pass('mine')).toEqual(['me']);
    expect(pass('unassigned')).toEqual([null]);
    expect(pass('bia')).toEqual(['bia']);
    expect(pass('fulano')).toEqual(['fulano']);
    expect(pass('mine', { ...activities, userId: null })).toEqual([]);
  });
});
