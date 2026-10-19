// @vitest-environment node
// Item 1.4 (docs/arquitetura/1.4.md, seção 12.1): o `npm run verify-instance` contra um servidor local simulado
// (node:http em 127.0.0.1, numa porta livre), que imita a Vercel a partir do vercel.json do repositório (headersFor) e
// responde também o GET /auth/v1/settings de um projeto Supabase fictício. A instância certa aprova; cada desvio reprova
// com a mensagem em pt-BR; a chave secreta é recusada sem nenhum pedido; nenhuma saída mostra a chave inteira.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROOT } from './embedded-db.mjs';
import { headersFor, readVercelConfig } from './security-headers.mjs';
import {
  CHECK_TITLES,
  SPA_ROUTES,
  VerifyInputError,
  formatVerifyReport,
  headerProblems,
  instanceInputs,
  keyProblem,
  maskKey,
  robotsClosesSite,
  verifyInstance,
} from './verify-instance.mjs';

const run = promisify(execFile);
const config = readVercelConfig();
const KEY = 'sb_publishable_teste_1234567890abcdef';
const BACKEND = 'https://crm-teste.supabase.co';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const jwt = (payload) =>
  ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'assinatura'].join('.');

const GOOD_BRAND = {
  productName: 'Acme Vendas',
  shortName: 'Acme',
  tagline: '',
  supportEmail: '',
  logoOnLight: 'logo-claro.svg',
  logoOnDark: '',
  icon: 'icone.png',
  favicon: '',
  authImage: '',
  emailLogo: 'logo-email.png',
  emailLogoWidth: 185,
  exportName: 'acme-vendas',
  showBaseCredit: true,
};
const GOOD_SETTINGS = {
  disable_signup: false,
  mailer_autoconfirm: false,
  external: { email: true, phone: false, anonymous_users: false, google: false },
};

// O estado da instância simulada: cada teste muda só o que quer reprovar.
let state;
const reset = (origin) => {
  state = {
    title: 'Acme Vendas',
    noindex: true,
    robots: '# fora dos buscadores\nUser-agent: *\nDisallow: /\n',
    brand: JSON.stringify(GOOD_BRAND),
    jsOrigin: BACKEND,
    settings: GOOD_SETTINGS,
    settingsStatus: 200,
    missingRoutes: [],
    // A resposta da página inicial: a proteção de deploy da Vercel (401) ou um redirecionamento (301).
    home: null,
    headers: {},
    dropHeaders: [],
    images: { 'logo-claro.svg': 'image/svg+xml', 'icone.png': 'image/png', 'logo-email.png': 'image/png' },
    origin,
  };
};
const requests = [];

const html = () =>
  `<!doctype html><html lang="pt-BR"><head><title>${state.title}</title>${
    state.noindex ? '<meta name="robots" content="noindex, nofollow" />' : ''
  }<script src="/theme-init.js"></script><script type="module" crossorigin src="/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>`;

function handler(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const pathname = url.pathname;
  requests.push(pathname);
  const send = (status, type, body, extra = {}) => {
    const headers = { ...headersFor(pathname, config), ...state.headers, ...extra };
    for (const name of state.dropHeaders) delete headers[name];
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    if (type) response.setHeader('Content-Type', type);
    response.statusCode = status;
    response.end(body);
  };
  // O Auth do projeto fictício: pelo fetch dos testes (BACKEND vira /backend) ou na raiz, para a linha de comando.
  if (pathname === '/backend/auth/v1/settings' || pathname === '/auth/v1/settings') {
    if (request.headers.apikey !== KEY) return send(401, 'application/json', '{"message":"Invalid API key"}');
    return send(state.settingsStatus, 'application/json', JSON.stringify(state.settings));
  }
  if (pathname === '/robots.txt') return send(200, 'text/plain; charset=utf-8', state.robots);
  if (pathname === '/assets/index-abc123.js')
    return send(200, 'text/javascript', `const e="${state.jsOrigin}",k="${KEY}";export{e,k};`);
  if (pathname === '/brand/brand.json') return send(200, 'application/json', state.brand);
  if (pathname.startsWith('/brand/')) {
    const name = pathname.slice('/brand/'.length);
    const type = state.images[name];
    return type ? send(200, type, PNG) : send(404, 'text/html', '<h1>404</h1>');
  }
  if (pathname === '/' && state.home) return send(state.home.status, 'text/html', '', state.home.headers ?? {});
  if (state.missingRoutes.includes(pathname)) return send(404, 'text/html', '<h1>NOT_FOUND</h1>');
  return send(200, 'text/html; charset=utf-8', html());
}

let server;
let site;
const fetchThroughSimulator = (url, init) => fetch(String(url).replace(BACKEND, `${site}/backend`), init);
const verify = (overrides = {}) =>
  verifyInstance({
    siteUrl: site,
    supabaseUrl: BACKEND,
    publishableKey: KEY,
    fetch: fetchThroughSimulator,
    allowLocal: true,
    timeoutMs: 5_000,
    ...overrides,
  });
const failed = (result) => result.checks.filter((entry) => entry.status === 'fail');
const detailOf = (result, id) => result.checks.find((entry) => entry.id === id)?.detail ?? '';

beforeAll(async () => {
  server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  site = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  reset(site);
  requests.length = 0;
});

describe('verify-instance contra o servidor simulado (item 1.4)', () => {
  it('a instância certa aprova as oito conferências, com o aviso do ensaio local', async () => {
    const result = await verify();
    expect(failed(result)).toEqual([]);
    expect(result.approved).toBe(true);
    expect(result.checks.filter((entry) => entry.status === 'ok').map((entry) => entry.id)).toEqual(
      Object.keys(CHECK_TITLES),
    );
    expect(result.checks.at(-1)).toMatchObject({ status: 'warn', id: 'local' });
    expect(detailOf(result, 'backend')).toContain(BACKEND);
    expect(detailOf(result, 'images')).toContain('inclusive o logo dos e-mails');
    // Rotas da SPA, uma inexistente, a marca, as três imagens, o robots, o JS e o Auth.
    for (const route of SPA_ROUTES) expect(requests).toContain(route);
    expect(requests.some((entry) => entry.startsWith('/rota-que-nao-existe-'))).toBe(true);
    expect(requests).toContain('/backend/auth/v1/settings');
    expect(requests).toContain('/brand/logo-email.png');
  });

  const cases = [
    [
      'a CSP ausente',
      () => state.dropHeaders.push('Content-Security-Policy'),
      'headers',
      'não manda o cabeçalho Content-Security-Policy',
    ],
    [
      'a CSP com uma fonte a mais',
      () => {
        state.headers['Content-Security-Policy'] = headersFor('/', config)['Content-Security-Policy'].replace(
          "script-src 'self'",
          "script-src 'self' https://cdn.exemplo.com",
        );
      },
      'headers',
      'script-src com https://cdn.exemplo.com a mais',
    ],
    [
      'o HSTS mais fraco',
      () => (state.headers['Strict-Transport-Security'] = 'max-age=3600'),
      'headers',
      'Strict-Transport-Security mais fraco que o do vercel.json',
    ],
    [
      'o X-Frame-Options ausente',
      () => state.dropHeaders.push('X-Frame-Options'),
      'headers',
      'não manda o cabeçalho X-Frame-Options',
    ],
    [
      '/brand/ sem o sandbox',
      () =>
        (state.headers['Content-Security-Policy'] = headersFor('/brand/brand.json', config)[
          'Content-Security-Policy'
        ].replace('; sandbox', '')),
      'brand',
      'falta sandbox',
    ],
    [
      'o robots.txt aberto',
      () => (state.robots = 'User-agent: *\nAllow: /\n'),
      'robots',
      'O robots.txt publicado não fecha o site',
    ],
    ['o noindex ausente', () => (state.noindex = false), 'page', 'noindex, nofollow'],
    [
      'uma rota da SPA com 404',
      () => state.missingRoutes.push('/pipeline'),
      'routes',
      '/pipeline respondeu 404: a regra de SPA do vercel.json não está valendo',
    ],
    [
      'o brand.json inválido',
      () => (state.brand = JSON.stringify({ ...GOOD_BRAND, productName: '' })),
      'brand',
      '/brand/brand.json publicado:',
    ],
    ['o emailLogo com 404', () => delete state.images['logo-email.png'], 'images', 'A imagem emailLogo ('],
    [
      'o emailLogo com text/html',
      () => (state.images['logo-email.png'] = 'text/html'),
      'images',
      'não uma imagem: os e-mails ficariam sem logo',
    ],
    [
      'o título sem o nome da marca',
      () => (state.title = 'Empreende.IA · CRM'),
      'page',
      'não traz o nome da marca publicada ("Acme Vendas")',
    ],
    [
      'o JavaScript com outro Supabase',
      () => (state.jsOrigin = 'https://outro-projeto.supabase.co'),
      'backend',
      'O frontend publicado fala com https://outro-projeto.supabase.co, não com https://crm-teste.supabase.co',
    ],
    [
      'a confirmação de e-mail desligada (mailer_autoconfirm)',
      () => (state.settings = { ...GOOD_SETTINGS, mailer_autoconfirm: true }),
      'auth',
      'A confirmação de e-mail está desligada (mailer_autoconfirm)',
    ],
    [
      'o cadastro desligado',
      () => (state.settings = { ...GOOD_SETTINGS, disable_signup: true }),
      'auth',
      'O cadastro está desligado (disable_signup)',
    ],
    [
      'um login social ligado',
      () => (state.settings = { ...GOOD_SETTINGS, external: { ...GOOD_SETTINGS.external, google: true } }),
      'auth',
      'Login social ligado: google',
    ],
    [
      'o /auth/v1/settings com 401 (chave de outro projeto)',
      () => (state.settingsStatus = 401),
      'auth',
      'a chave não é deste projeto ou não é a chave pública',
    ],
    [
      'a página inicial com 401 (Vercel Authentication ligada no domínio de produção)',
      () => (state.home = { status: 401 }),
      'page',
      'Settings → Deployment Protection',
    ],
    [
      'a página inicial redirecionando para outro endereço (301)',
      () => (state.home = { status: 301, headers: { Location: 'https://crm.acme.com.br/' } }),
      'page',
      'redireciona para https://crm.acme.com.br/: use o endereço final, o mesmo da Site URL do Auth',
    ],
  ];
  it.each(cases)('reprova %s', async (_label, mutate, id, fragment) => {
    mutate();
    const result = await verify();
    expect(result.approved).toBe(false);
    expect(failed(result).map((entry) => entry.id)).toContain(id);
    expect(detailOf(result, id)).toContain(fragment);
  });

  it('aceita o HSTS que a plataforma manda em dobro, quando nenhuma ocorrência é mais fraca', async () => {
    state.headers['Strict-Transport-Security'] =
      'max-age=63072000; includeSubDomains, max-age=63072000; includeSubDomains; preload';
    expect((await verify()).approved).toBe(true);
    state.headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains, max-age=60';
    expect(detailOf(await verify(), 'headers')).toContain('mais fraco');
  });

  it('a chave secreta e o JWT service_role são recusados sem nenhum pedido ao servidor', async () => {
    for (const key of ['sb_secret_abc123', jwt({ role: 'service_role' }), jwt({ role: 'supabase_admin' })]) {
      await expect(verify({ publishableKey: key })).rejects.toThrow(VerifyInputError);
      await expect(verify({ publishableKey: key })).rejects.toThrow(/chave secreta/);
    }
    expect(requests).toEqual([]);
    expect(keyProblem(jwt({ role: 'anon' }))).toBeNull();
    expect(keyProblem(KEY)).toBeNull();
    expect(keyProblem('')).toContain('Falta a chave pública');
  });

  it('um servidor que não responde reprova pelo tempo limite, com a mensagem', async () => {
    const silent = createServer(() => undefined);
    await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const address = `http://127.0.0.1:${silent.address().port}`;
    try {
      const result = await verify({ siteUrl: address, fetch: fetch, supabaseUrl: address, timeoutMs: 300 });
      expect(result.approved).toBe(false);
      expect(detailOf(result, 'page')).toBe(`${address}/ não respondeu em 0 s.`);
      expect(detailOf(result, 'auth')).toContain('/auth/v1/settings não respondeu em');
    } finally {
      silent.closeAllConnections();
      await new Promise((resolve) => silent.close(resolve));
    }
  });

  it('sem --local, recusa http:// e localhost; endereço com caminho é sempre recusado', async () => {
    await expect(verify({ allowLocal: false })).rejects.toThrow(/aponta para este computador/);
    await expect(verify({ siteUrl: `${site}/crm` })).rejects.toThrow(/não pode ter caminho/);
    await expect(verify({ siteUrl: `${site}/` })).rejects.toThrow(/não pode terminar com barra/);
    expect(requests).toEqual([]);
  });

  it('com --local, aceita http:// só neste computador: um endereço público por http:// é recusado sem nenhum pedido', async () => {
    await expect(verify({ siteUrl: 'http://crm.empresa.com.br' })).rejects.toThrow(
      'usa http:// num endereço que não é deste computador',
    );
    await expect(verify({ supabaseUrl: 'http://crm-teste.supabase.co' })).rejects.toThrow(
      'O endereço do Supabase usa http://',
    );
    expect(requests).toEqual([]);
  });
});

describe('verify-instance: entradas, cabeçalhos e relatório (item 1.4)', () => {
  const files = (map) => ({
    root: 'C:/crm',
    exists: (file) => Object.keys(map).some((name) => path.resolve('C:/crm', name) === path.resolve(file)),
    readFile: (file) => map[Object.keys(map).find((name) => path.resolve('C:/crm', name) === path.resolve(file))],
  });

  it('lê a URL do argumento ou do supabase/.env, e o Supabase e a chave das opções, do ambiente, do .env.local e do .env', () => {
    const disk = files({
      'supabase/.env': 'SUPABASE_AUTH_SITE_URL=https://crm.acme.com.br\n',
      '.env.local': 'VITE_SUPABASE_URL=https://local.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local\n',
      '.env': 'VITE_SUPABASE_URL=https://raiz.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_raiz\n',
    });
    const fromFiles = instanceInputs([], {}, disk);
    expect(fromFiles).toMatchObject({
      siteUrl: 'https://crm.acme.com.br',
      supabaseUrl: 'https://local.supabase.co',
      publishableKey: 'sb_publishable_local',
      problems: [],
    });
    expect(fromFiles.sources).toEqual({
      siteUrl: 'supabase/.env',
      supabaseUrl: '.env.local',
      publishableKey: '.env.local',
    });
    const fromEnv = instanceInputs(
      ['https://crm.outra.com.br'],
      { VITE_SUPABASE_URL: 'https://amb.supabase.co' },
      disk,
    );
    expect(fromEnv).toMatchObject({ siteUrl: 'https://crm.outra.com.br', supabaseUrl: 'https://amb.supabase.co' });
    expect(fromEnv.sources.siteUrl).toBe('argumento');
    const fromOptions = instanceInputs(
      ['https://crm.outra.com.br', '--supabase-url', 'https://opcao.supabase.co', '--key=sb_publishable_opcao'],
      { VITE_SUPABASE_URL: 'https://amb.supabase.co' },
      disk,
    );
    expect(fromOptions).toMatchObject({
      supabaseUrl: 'https://opcao.supabase.co',
      publishableKey: 'sb_publishable_opcao',
    });
    expect(instanceInputs([], {}, files({ '.env': 'VITE_SUPABASE_URL=https://raiz.supabase.co\n' })).supabaseUrl).toBe(
      'https://raiz.supabase.co',
    );
  });

  it('recusa a URL com caminho, http:// sem --local, a chave secreta e a opção desconhecida', () => {
    const disk = files({});
    const base = ['--supabase-url', 'https://crm-teste.supabase.co', '--key', KEY];
    expect(instanceInputs(['https://crm.acme.com.br/app', ...base], {}, disk).problems.join()).toContain(
      'não pode ter caminho',
    );
    expect(instanceInputs(['http://crm.acme.com.br', ...base], {}, disk).problems.join()).toContain(
      'precisa começar com https://',
    );
    expect(instanceInputs(['http://localhost:4173', ...base], {}, disk).problems.join()).toContain('use --local');
    expect(instanceInputs(['http://localhost:4173', ...base, '--local'], {}, disk).problems).toEqual([]);
    expect(instanceInputs(['https://crm.acme.com.br', ...base, '--local'], {}, disk).problems).toEqual([]);
    expect(instanceInputs(['http://crm.acme.com.br', ...base, '--local'], {}, disk).problems.join()).toContain(
      'use https://crm.acme.com.br sem --local',
    );
    expect(
      instanceInputs(
        ['https://crm.acme.com.br', '--supabase-url', 'https://x.supabase.co', '--key', 'sb_secret_x'],
        {},
        disk,
      ).problems[0],
    ).toContain('chave secreta');
    expect(instanceInputs(['https://crm.acme.com.br', ...base, '--sem-isso'], {}, disk).problems.join()).toContain(
      'Opção desconhecida',
    );
    expect(instanceInputs([], {}, disk).problems.join()).toContain('Falta o endereço do CRM publicado');
  });

  it('compara os cabeçalhos sem diferença de maiúsculas no nome nem de espaços no valor', () => {
    const expected = headersFor('/', config);
    const received = Object.fromEntries(
      Object.entries(expected).map(([name, value]) => [name.toLowerCase(), value.replace(/ /g, '  ')]),
    );
    expect(headerProblems(expected, received)).toEqual([]);
    expect(headerProblems(expected, { ...received, 'x-frame-options': 'SAMEORIGIN' }).join()).toContain(
      'X-Frame-Options diferente do vercel.json',
    );
  });

  it('o robots.txt fecha o site só com Disallow: / no grupo de User-agent: *', () => {
    expect(robotsClosesSite('User-agent: *\nDisallow: /')).toBe(true);
    expect(robotsClosesSite('User-agent: Googlebot\nUser-agent: *\nDisallow: /')).toBe(true);
    expect(robotsClosesSite('User-agent: Googlebot\nDisallow: /\nUser-agent: *\nAllow: /')).toBe(false);
    expect(robotsClosesSite('User-agent: *\nDisallow: /admin')).toBe(false);
  });

  it('o relatório mascara a chave e nunca a mostra inteira', async () => {
    const result = await verify();
    const report = formatVerifyReport(result, { siteUrl: site, supabaseUrl: BACKEND, publishableKey: KEY });
    expect(report).toContain(maskKey(KEY));
    expect(report).not.toContain(KEY);
    expect(report).toContain('Instância aprovada: 8 conferências.');
    expect(report.split('\n').filter((line) => line.startsWith('OK '))).toHaveLength(8);
    state.settings = { ...GOOD_SETTINGS, mailer_autoconfirm: true };
    const bad = formatVerifyReport(await verify(), { publishableKey: KEY });
    expect(bad).toContain('REPROVADO Configuração do Auth');
    expect(bad).toContain('Instância reprovada: 1 de 8 conferências reprovadas.');
  });
});

describe('verify-instance pela linha de comando (item 1.4)', () => {
  const cli = (args, env = {}) =>
    run(process.execPath, [path.join(ROOT, 'scripts', 'verify-instance.mjs'), ...args], {
      cwd: ROOT,
      env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', ...env },
    }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
    );

  it('sai com 0 aprovada, 1 reprovada e 2 com a chave secreta (sem nenhum pedido) ou sem --local', async () => {
    // Pela linha de comando, o fetch é o do Node: o Supabase fictício é o próprio simulador.
    state.jsOrigin = site;
    const args = [site, '--local', '--supabase-url', site, '--key', KEY];
    const approved = await cli(args);
    expect(approved.code, approved.stderr).toBe(0);
    expect(approved.stdout).toContain('Instância aprovada: 8 conferências.');
    expect(approved.stdout).toContain('AVISO     Ensaio local');
    expect(approved.stdout).not.toContain(KEY);
    state.settings = { ...GOOD_SETTINGS, mailer_autoconfirm: true };
    const refused = await cli(args);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('REPROVADO Configuração do Auth');
    requests.length = 0;
    const secret = await cli([site, '--local', '--supabase-url', site, '--key', 'sb_secret_nao_use']);
    expect(secret.code).toBe(2);
    expect(secret.stderr).toContain('nenhum pedido foi feito');
    expect(secret.stderr).not.toContain('sb_secret_nao_use');
    const notLocal = await cli([site, '--supabase-url', site, '--key', KEY]);
    expect(notLocal.code).toBe(2);
    expect(notLocal.stderr).toContain('use --local');
    expect(requests).toEqual([]);
  });
});
