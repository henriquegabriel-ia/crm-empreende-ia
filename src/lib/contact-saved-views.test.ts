import { describe, expect, it } from 'vitest';
import { parseSavedViews, savedViewKey, serializeSavedViews, type SavedDirectoryView } from './contact-saved-views';
const item: SavedDirectoryView = {
  id: 'id',
  name: 'Minha carteira',
  updatedAt: '2026-09-06T10:00:00Z',
  view: { q: 'São Paulo', scope: 'mine', sort: 'next-action', columns: ['owner', 'next-action'], source: 'all' },
};
describe('visões salvas', () => {
  it('separa usuário, organização e diretório, inclusive IDs com delimitadores', () => {
    const keys = [
      savedViewKey('a', 'b:c', 'contacts'),
      savedViewKey('a:b', 'c', 'contacts'),
      savedViewKey('other', 'b:c', 'contacts'),
      savedViewKey('a', 'b:c', 'companies'),
    ];
    expect(new Set(keys).size).toBe(4);
  });
  it('preserva uma visão válida sem misturar versões incompatíveis', () => {
    expect(parseSavedViews(serializeSavedViews([item]))).toEqual([item]);
    expect(parseSavedViews(JSON.stringify({ version: 2, views: [item] }))).toEqual([]);
  });
  it('não quebra com armazenamento corrompido, oversized ou valores inválidos', () => {
    for (const raw of [null, '{broken', 'x'.repeat(100001), 'null']) expect(parseSavedViews(raw)).toEqual([]);
    const invalid = [
      { ...item, view: { ...item.view, scope: 'admin' } },
      { ...item, view: { ...item.view, columns: ['unknown'] } },
      { ...item, name: '' },
      { ...item, updatedAt: 'invalid' },
    ];
    expect(parseSavedViews(JSON.stringify({ version: 1, views: invalid }))).toEqual([]);
  });
  // Item 1.14: a origem entra na visão, e as visões salvas antes dela (ou com uma origem que não existe) continuam, com
  // "Todas as origens".
  it('guarda a origem e aceita as visões salvas sem ela', () => {
    const withSource = { ...item, view: { ...item.view, source: 'referral' as const, columns: ['source' as const] } };
    expect(parseSavedViews(serializeSavedViews([withSource]))).toEqual([withSource]);
    const { source: _source, ...before } = item.view;
    expect(parseSavedViews(JSON.stringify({ version: 1, views: [{ ...item, view: before }] }))).toEqual([item]);
    expect(
      parseSavedViews(JSON.stringify({ version: 1, views: [{ ...item, view: { ...item.view, source: 'tv' } }] })),
    ).toEqual([item]);
  });
  it('deduplica IDs e limita o catálogo a 20 visões', () => {
    expect(parseSavedViews(serializeSavedViews([item, item]))).toEqual([item]);
    expect(
      parseSavedViews(
        JSON.stringify({ version: 1, views: Array.from({ length: 30 }, (_, i) => ({ ...item, id: `${i}` })) }),
      ),
    ).toHaveLength(20);
  });
});
