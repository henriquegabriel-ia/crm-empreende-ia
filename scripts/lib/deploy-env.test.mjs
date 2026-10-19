// @vitest-environment node
// Conferência das variáveis do frontend no build (item 1.3; docs/arquitetura/1.3.md, seções 6.4 e 7): VITE_CRM_ENVIRONMENT
// aposentada sem quebrar ninguém, a URL e a chave pública e, no build da Vercel, a URL https:// coberta pela CSP.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validCrmBackend } from '../../src/lib/backend-config';
import { BACKEND_ERROR, RETIRED_ENVIRONMENT_WARNING, deploymentEnvCheck } from './deploy-env.mjs';
import { ROOT } from './security-headers.mjs';

const HOSTED = {
  VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
};
const check = (env, mode = 'deployment') => deploymentEnvCheck(env, mode, { validBackend: validCrmBackend });

describe('build:deploy', () => {
  it('aceita o projeto hospedado sem VITE_CRM_ENVIRONMENT', () => {
    expect(check(HOSTED)).toEqual({ error: null, warnings: [] });
  });

  it('com VITE_CRM_ENVIRONMENT, de qualquer valor, só avisa (AC-11)', () => {
    for (const value of ['dedicated', 'shared', ''])
      expect(check({ ...HOSTED, VITE_CRM_ENVIRONMENT: value })).toEqual({
        error: null,
        warnings: [RETIRED_ENVIRONMENT_WARNING],
      });
    expect(RETIRED_ENVIRONMENT_WARNING).toContain('pode removê-la da hospedagem e do .env.local');
  });

  it('recusa a chave privilegiada, a URL ausente, o http: e o endereço que a CSP não cobre (AC-10)', () => {
    expect(check({ ...HOSTED, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_x' }).error).toBe(BACKEND_ERROR);
    expect(check({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).error).toBe(BACKEND_ERROR);
    expect(check({}).error).toBe(BACKEND_ERROR);
    expect(check({ ...HOSTED, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }).error).toMatch(
      /precisa começar com https/,
    );
    expect(check({ ...HOSTED, VITE_SUPABASE_URL: 'https://api.suaempresa.com.br' }).error).toMatch(
      /Acrescente https:\/\/api\.suaempresa\.com\.br e wss:\/\/api\.suaempresa\.com\.br ao connect-src/,
    );
  });

  it('fora do deployment, o http local continua aceito (E2E, preview e desempenho), e sem chave nada é conferido', () => {
    expect(
      check(
        { VITE_SUPABASE_URL: 'http://127.0.0.1:54339', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' },
        'production',
      ),
    ).toEqual({ error: null, warnings: [] });
    expect(
      check(
        { VITE_SUPABASE_URL: 'https://crm-e2e.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' },
        'e2e',
      ),
    ).toEqual({ error: null, warnings: [] });
    expect(check({}, 'production')).toEqual({ error: null, warnings: [] });
    expect(check({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_x' }, 'production').error).toBe(BACKEND_ERROR);
  });
});

describe('VITE_CRM_ENVIRONMENT aposentada (AC-11)', () => {
  const files = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const file = path.join(dir, name);
      return statSync(file).isDirectory() ? files(file) : [file];
    });

  it('nenhum arquivo de src/, scripts/, das configurações do Playwright ou do .env.example a cita, fora o aviso', () => {
    const candidates = [
      ...files(path.join(ROOT, 'src')),
      ...files(path.join(ROOT, 'scripts')),
      ...['playwright.config.ts', 'playwright.perf.config.ts', '.env.example', 'vite.config.ts'].map((name) =>
        path.join(ROOT, name),
      ),
    ].filter((file) => /\.(ts|tsx|mjs|js|json|example)$/.test(file) && !file.endsWith('.test.mjs'));
    const citing = candidates
      .filter((file) => readFileSync(file, 'utf8').includes('VITE_CRM_ENVIRONMENT'))
      .map((file) => path.relative(ROOT, file).split(path.sep).join('/'));
    expect(citing.sort()).toEqual(['.env.example', 'scripts/lib/deploy-env.mjs']);
    // O .env.example só cita a variável para dizer que foi aposentada.
    const example = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(example).not.toMatch(/^VITE_CRM_ENVIRONMENT=/m);
  });
});
