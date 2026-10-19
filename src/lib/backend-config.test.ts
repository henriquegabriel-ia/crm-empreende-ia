import { describe, it, expect } from 'vitest';
import { validCrmBackend } from './backend-config';
const jwt = (role: string) => 'eyJhbGciOiJIUzI1NiJ9.' + btoa(JSON.stringify({ role })) + '.signature';
describe('dedicated backend guard', () => {
  // Item 1.3: a variável de "ambiente dedicado" saiu; a URL e a chave pública bastam.
  it('aceita sem a variável de ambiente dedicado e recusa URL ou chave ausentes', () => {
    expect(validCrmBackend('https://example.supabase.co', 'sb_publishable_test')).toBe(true);
    expect(validCrmBackend(undefined, 'sb_publishable_test')).toBe(false);
    expect(validCrmBackend('https://example.supabase.co', undefined)).toBe(false);
  });
  it('accepts only public keys', () => {
    expect(validCrmBackend('https://example.supabase.co', 'sb_publishable_test')).toBe(true);
    expect(validCrmBackend('https://example.supabase.co', jwt('anon'))).toBe(true);
    for (const key of ['sb_secret_test', jwt('service_role'), jwt('authenticated'), 'broken'])
      expect(validCrmBackend('https://example.supabase.co', key)).toBe(false);
  });
  it('validates URLs and permits isolated loopback tests', () => {
    expect(validCrmBackend('http://127.0.0.1:54339', 'sb_publishable_test')).toBe(true);
    for (const url of [
      'not a url',
      'javascript:alert(1)',
      'http://remote.example',
      'https://user:password@example.test',
      'https://example.supabase.co/?x=1',
      'https://example.supabase.co/#x',
    ])
      expect(validCrmBackend(url, 'sb_publishable_test')).toBe(false);
  });
});
