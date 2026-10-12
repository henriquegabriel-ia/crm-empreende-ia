import { describe, expect, it } from 'vitest';
import { authPath, DEFAULT_AFTER_LOGIN, safeNextPath } from './next-path';

describe('safeNextPath', () => {
  it.each([
    ['/pipeline?deal=7&status=all', '/pipeline?deal=7&status=all'],
    ['/contacts?contact=1#historico', '/contacts?contact=1#historico'],
    ['/settings/integrations', '/settings/integrations'],
    ['/invite?invite=abc', '/invite?invite=abc'],
    ['/pipeline/../dashboard', '/dashboard'],
  ])('aceita o caminho interno %s', (value, expected) => {
    expect(safeNextPath(value)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    '/',
    '/?next=/dashboard',
    'dashboard',
    '//example.test/roubo',
    '///example.test',
    '/\\example.test',
    '\\\\example.test',
    'https://example.test/pipeline',
    'javascript:alert(1)',
    ' /dashboard',
    '/dash\nboard',
    '/dash\tboard',
    `/${'a'.repeat(2048)}`,
    // Segmentos de ponto que, normalizados, viram "//outro-site".
    '/.//example.test',
    '/..//example.test/roubo?x=1',
    '/%2e//example.test',
    '/%2E%2E//example.test',
    '/pipeline/..//example.test',
    '/././/example.test',
  ])('recusa %j', (value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it('o resultado nunca começa com "//", mesmo para entradas com pontos e barras', () => {
    const segments = ['', '.', '..', '%2e', '%2E%2e', 'pipeline', 'example.test'];
    for (const a of segments)
      for (const b of segments)
        for (const c of segments) {
          const result = safeNextPath(`/${a}/${b}/${c}`);
          if (result !== null) {
            expect(result.startsWith('/')).toBe(true);
            expect(result.startsWith('//')).toBe(false);
          }
        }
  });
});

describe('authPath', () => {
  it('leva o convite e o destino codificados', () => {
    expect(authPath('/', { next: '/pipeline?deal=7' })).toBe('/?next=%2Fpipeline%3Fdeal%3D7');
    expect(authPath('/invite', { invite: 'convite 1', next: '/pipeline?deal=7' })).toBe(
      '/invite?invite=convite+1&next=%2Fpipeline%3Fdeal%3D7',
    );
    expect(new URLSearchParams(authPath('/', { next: '/pipeline?deal=7&q=a b' }).slice(2)).get('next')).toBe(
      '/pipeline?deal=7&q=a%20b',
    );
  });

  it('descarta destino inválido e não deixa "?" sobrando', () => {
    expect(authPath('/', { next: '//example.test' })).toBe('/');
    expect(authPath('/', { next: '/.//example.test' })).toBe('/');
    expect(authPath('/', { invite: null, next: null })).toBe('/');
    expect(authPath('/', { invite: 'abc', next: 'https://example.test' })).toBe('/?invite=abc');
  });

  it('Hoje é o destino padrão', () => {
    expect(DEFAULT_AFTER_LOGIN).toBe('/dashboard');
  });
});
