import { describe, expect, it, vi } from 'vitest';

// Opções com que o cliente do CRM é criado, guardadas pelo createClient abaixo, que repassa a chamada à biblioteca.
const created = vi.hoisted(() => ({ options: undefined as undefined | { auth?: Record<string, unknown> } }));
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return {
    ...actual,
    createClient: (...args: Parameters<typeof actual.createClient>) => {
      created.options = args[2] as typeof created.options;
      return actual.createClient(...args);
    },
  };
});

describe('opções de Auth do cliente Supabase', () => {
  it('declara o fluxo implícito, de que depende a prova do e-mail num link do Auth (docs/arquitetura/1.1.md, 16.21)', async () => {
    const { supabase } = await import('./client');
    expect(supabase).toBeDefined();
    expect(created.options?.auth?.flowType).toBe('implicit');
  });
});
