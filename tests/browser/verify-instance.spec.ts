import { test, expect } from './test';
import { FIXTURE_BACKEND } from './backend';
import { verifyInstance } from '../../scripts/lib/verify-instance.mjs';
import { readPackageVersion } from '../../scripts/lib/app-version.mjs';

// Item 1.4 (docs/arquitetura/1.4.md, seção 12.3): o `npm run verify-instance` contra o build de produção do E2E,
// servido pelo vite preview com os cabeçalhos do vercel.json (plugin crm-security-headers). Não há tela: a conferência
// roda no Node do Playwright, com o ensaio local (allowLocal), e o GET /auth/v1/settings do Supabase fictício da fixture
// é respondido aqui; o resto (a página, as rotas, o robots.txt, a marca, as imagens e o JavaScript) vem do servidor.
// Só no projeto chromium: o mobile-chrome não lista este arquivo (playwright.config.ts), porque não há tela.

// Com PLAYWRIGHT_DEV_SERVER=1, o servidor de desenvolvimento não tem CSP nem o build.
test.skip(process.env.PLAYWRIGHT_DEV_SERVER === '1', 'o servidor de desenvolvimento não é o build publicado');

const SETTINGS = {
  disable_signup: false,
  mailer_autoconfirm: false,
  external: { email: true, phone: false, anonymous_users: false, google: false, github: false },
};

const fetchWithSettings =
  (settings: Record<string, unknown>): typeof fetch =>
  async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${FIXTURE_BACKEND}/auth/v1/settings`) {
      const apikey = new Headers(init?.headers).get('apikey');
      return apikey === 'sb_publishable_fixture_test'
        ? Response.json(settings)
        : Response.json({ message: 'Invalid API key' }, { status: 401 });
    }
    return fetch(input, init);
  };

test('o build servido pelo preview passa nas nove conferências do verify-instance', async ({ baseURL }) => {
  const result = await verifyInstance({
    siteUrl: baseURL ?? 'http://127.0.0.1:8096',
    supabaseUrl: FIXTURE_BACKEND,
    publishableKey: 'sb_publishable_fixture_test',
    fetch: fetchWithSettings(SETTINGS),
    allowLocal: true,
  });
  expect(result.checks.filter((check) => check.status === 'fail')).toEqual([]);
  expect(result.checks.filter((check) => check.status === 'ok').map((check) => check.id)).toEqual([
    'page',
    'version',
    'headers',
    'robots',
    'routes',
    'brand',
    'images',
    'backend',
    'auth',
  ]);
  expect(result.approved).toBe(true);
  expect(result.checks.find((check) => check.id === 'backend')?.detail).toContain(FIXTURE_BACKEND);
  // Item 1.7b: o build traz a meta crm-version com a versão do package.json.
  expect(result.checks.find((check) => check.id === 'version')?.detail).toBe(
    `A URL serve a versão ${readPackageVersion()}, a mesma do repositório.`,
  );
});

// Item 1.7b: a página servida com outra versão na meta (uma publicação antiga ainda no ar) reprova só "Versão publicada".
test('com outra versão na página publicada, só a conferência da versão reprova', async ({ baseURL }) => {
  const site = baseURL ?? 'http://127.0.0.1:8096';
  const settingsFetch = fetchWithSettings(SETTINGS);
  const olderPage: typeof fetch = async (input, init) => {
    const response = await settingsFetch(input, init);
    if (String(input instanceof Request ? input.url : input) !== `${site}/`) return response;
    const html = (await response.text()).replace(/(<meta name="crm-version" content=")[^"]*"/, '$10.9.0"');
    expect(html).toContain('<meta name="crm-version" content="0.9.0"');
    return new Response(html, { status: response.status, headers: response.headers });
  };
  const result = await verifyInstance({
    siteUrl: site,
    supabaseUrl: FIXTURE_BACKEND,
    publishableKey: 'sb_publishable_fixture_test',
    fetch: olderPage,
    allowLocal: true,
  });
  const failed = result.checks.filter((check) => check.status === 'fail');
  expect(failed.map((check) => check.id)).toEqual(['version']);
  expect(failed[0].detail).toContain(`A URL serve a versão 0.9.0, e o repositório está na ${readPackageVersion()}.`);
});

test('com a confirmação de e-mail desligada no Auth, só a conferência do Auth reprova', async ({ baseURL }) => {
  const result = await verifyInstance({
    siteUrl: baseURL ?? 'http://127.0.0.1:8096',
    supabaseUrl: FIXTURE_BACKEND,
    publishableKey: 'sb_publishable_fixture_test',
    fetch: fetchWithSettings({ ...SETTINGS, mailer_autoconfirm: true }),
    allowLocal: true,
  });
  expect(result.approved).toBe(false);
  const failed = result.checks.filter((check) => check.status === 'fail');
  expect(failed.map((check) => check.id)).toEqual(['auth']);
  expect(failed[0].detail).toContain('A confirmação de e-mail está desligada (mailer_autoconfirm)');
});
