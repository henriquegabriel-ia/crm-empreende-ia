// @vitest-environment node
// Cabeçalhos de segurança do vercel.json (item 1.3; docs/arquitetura/1.3.md, seções 6, 8 e 9.1): cada diretiva da CSP,
// o que ela cobre e o que recusa, as regras sem sobreposição, a CSP própria de /brand/*, o script de tema fora do HTML,
// a Vercel com npm ci e a exceção só do preview para o Supabase local.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_SOURCE,
  BRAND_SOURCE,
  ROOT,
  appCsp,
  cspAllows,
  headersFor,
  parseCsp,
  previewCsp,
  previewHeadersFor,
  readVercelConfig,
  rulesFor,
  securityHeadersPlugin,
  sourceMatches,
  supabaseOriginProblem,
} from './security-headers.mjs';

const vercel = readVercelConfig();
const csp = parseCsp(appCsp(vercel));
const SELF = 'https://crm.acme.com.br';
const APP_PATHS = [
  '/',
  '/pipeline',
  '/contacts?contact=1',
  '/assets/index-abc.js',
  '/theme-init.js',
  '/fonts/Manrope-Variable.ttf',
  '/reset-password',
  '/brand',
];
const BRAND_PATHS = ['/brand/eia-icon.svg', '/brand/brand.json', '/brand/eia-email.png'];

describe('vercel.json: cabeçalhos (AC-7)', () => {
  it('três regras: comuns a tudo, a CSP do app e a CSP de /brand/*', () => {
    expect(vercel.headers.map((rule) => rule.source)).toEqual(['/(.*)', APP_SOURCE, BRAND_SOURCE]);
    expect(headersFor('/')).toEqual({
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    });
  });

  it('cada caminho recebe exatamente uma CSP, e nenhuma chave vem de duas regras', () => {
    for (const pathname of [...APP_PATHS, ...BRAND_PATHS]) {
      const rules = rulesFor(pathname.split('?')[0]).filter((rule) =>
        rule.headers.some((header) => header.key === 'Content-Security-Policy'),
      );
      expect(rules, pathname).toHaveLength(1);
      expect(() => headersFor(pathname.split('?')[0]), pathname).not.toThrow();
      expect(headersFor(pathname.split('?')[0])['Strict-Transport-Security'], pathname).toMatch(/^max-age=63072000/);
    }
    for (const pathname of BRAND_PATHS)
      expect(rulesFor(pathname).map((rule) => rule.source)).toEqual(['/(.*)', BRAND_SOURCE]);
    // Mutação conferida: o nosniff de volta na regra de /brand/ seria definido duas vezes.
    const overlapping = structuredClone(vercel);
    overlapping.headers[2].headers.push({ key: 'X-Content-Type-Options', value: 'nosniff' });
    expect(() => headersFor('/brand/eia-icon.svg', overlapping)).toThrow(/de duas regras do vercel\.json/);
  });

  it('a CSP do app: só a própria origem, sem eval nem script inline, sem http: nem curinga solto', () => {
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp.get('img-src')).toEqual(["'self'"]);
    expect(csp.get('font-src')).toEqual(["'self'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('frame-src')).toEqual(["'none'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    const text = appCsp(vercel);
    expect(text).not.toContain("'unsafe-eval'");
    expect(text).not.toMatch(/\bhttp:/);
    expect(text).not.toMatch(/\sdata:|\sblob:/);
    for (const [, sources] of csp) expect(sources).not.toContain('*');
  });

  it('o connect-src cobre o REST, o Auth e o Realtime de qualquer projeto hospedado, e nada além', () => {
    const allows = (url) => cspAllows(csp, 'connect-src', url, SELF);
    expect(allows('https://abcdefghijklmnopqrst.supabase.co/rest/v1/deals')).toBe(true);
    expect(allows('https://abcdefghijklmnopqrst.supabase.co/auth/v1/token')).toBe(true);
    expect(allows('https://abcdefghijklmnopqrst.supabase.co/functions/v1/fecha-ai-integration')).toBe(true);
    expect(allows('wss://abcdefghijklmnopqrst.supabase.co/realtime/v1/websocket')).toBe(true);
    expect(allows(`${SELF}/brand/brand.json`)).toBe(true);
    for (const url of [
      'https://evil.example/x',
      'https://supabase.co/x',
      'https://abcdefghijklmnopqrst.supabase.co.evil.example/x',
      'http://abcdefghijklmnopqrst.supabase.co/x',
      'https://abcdefghijklmnopqrst.supabase.co:8443/x',
      'ws://abcdefghijklmnopqrst.supabase.co/x',
    ])
      expect(allows(url), url).toBe(false);
    // Imagens, fontes e scripts: só a origem do CRM.
    expect(cspAllows(csp, 'img-src', `${SELF}/brand/eia-logo-on-dark.svg?v=1`, SELF)).toBe(true);
    expect(cspAllows(csp, 'img-src', 'https://imagens.example/foto.png', SELF)).toBe(false);
    expect(cspAllows(csp, 'img-src', 'data:image/png;base64,AAAA', SELF)).toBe(false);
    expect(cspAllows(csp, 'font-src', `${SELF}/fonts/Manrope-Variable.ttf`, SELF)).toBe(true);
    expect(cspAllows(csp, 'script-src', `${SELF}/theme-init.js`, SELF)).toBe(true);
    expect(cspAllows(csp, 'script-src', 'https://cdn.example/x.js', SELF)).toBe(false);
    // manifest-src e worker-src caem no default-src 'self' (PWA futuro, item 3.6).
    expect(cspAllows(csp, 'worker-src', `${SELF}/sw.js`, SELF)).toBe(true);
  });

  it('o casamento de host da CSP: curinga no primeiro rótulo, esquema exato e wss: fora do https:', () => {
    expect(cspAllows('connect-src https:', 'connect-src', 'wss://a.example')).toBe(false);
    expect(cspAllows('connect-src http:', 'connect-src', 'https://a.example')).toBe(true);
    expect(cspAllows('connect-src wss://a.example', 'connect-src', 'https://a.example')).toBe(true);
    expect(cspAllows('connect-src https://*.a.example', 'connect-src', 'https://x.y.a.example')).toBe(true);
    expect(cspAllows('connect-src https://*.a.example', 'connect-src', 'https://a.example')).toBe(false);
    expect(cspAllows('connect-src https://a.example:8443', 'connect-src', 'https://a.example:8443/x')).toBe(true);
    expect(cspAllows('connect-src https://a.example', 'connect-src', 'https://a.example:8443/x')).toBe(false);
    expect(cspAllows("connect-src 'self'", 'connect-src', 'http://127.0.0.1:8096/x', 'http://127.0.0.1:8096')).toBe(
      true,
    );
    expect(cspAllows("connect-src 'self'", 'connect-src', 'http://127.0.0.1:8097/x', 'http://127.0.0.1:8096')).toBe(
      false,
    );
    expect(cspAllows("default-src 'none'", 'img-src', 'https://a.example')).toBe(false);
    expect(cspAllows("default-src 'self'", 'frame-ancestors', 'https://a.example')).toBe(true);
  });

  it('/brand/* manteve a CSP própria do item 1.6: sandbox, sem script-src e com nosniff da regra comum', () => {
    const headers = headersFor('/brand/eia-icon.svg');
    const brand = parseCsp(headers['Content-Security-Policy']);
    expect(brand.get('default-src')).toEqual(["'none'"]);
    expect(brand.has('sandbox')).toBe(true);
    expect(brand.has('script-src')).toBe(false);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('o casador de source recusa a sintaxe que não entende e não deixa /brand/ cair na regra do app', () => {
    expect(sourceMatches(APP_SOURCE, '/brand/x.svg')).toBe(false);
    expect(sourceMatches(APP_SOURCE, '/brand')).toBe(true);
    expect(sourceMatches(APP_SOURCE, '/branding/x')).toBe(true);
    expect(sourceMatches(BRAND_SOURCE, '/brand/x.svg')).toBe(true);
    expect(sourceMatches('/(.*)', '/')).toBe(true);
    for (const source of ['/:path*', '/api/(.*)?', '/(a|b)', '/((?!brand/|api/).*)'])
      expect(() => sourceMatches(source, '/'), source).toThrow(/Estenda sourceMatches/);
  });
});

describe('Vercel com npm ci (AC-12)', () => {
  it('instala com npm ci, constrói com build:deploy, publica dist e reescreve a SPA', () => {
    expect(vercel.installCommand).toBe('npm ci');
    expect(vercel.buildCommand).toBe('npm run build:deploy');
    expect(vercel.outputDirectory).toBe('dist');
    expect(vercel.framework).toBe('vite');
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
    const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
    expect(scripts['build:deploy']).toBe('vite build --mode deployment');
    expect(existsSync(path.join(ROOT, 'package-lock.json'))).toBe(true);
  });

  it('o guia de implantação avisa que o plano Hobby é só para uso não comercial', () => {
    const guide = readFileSync(path.join(ROOT, 'docs', 'IMPLANTACAO.md'), 'utf8');
    expect(guide).toContain('O plano Hobby da Vercel é só para uso pessoal e não comercial');
    expect(guide).toContain('A instância de uma empresa real precisa do Pro.');
  });
});

describe('script de tema fora do HTML (AC-8)', () => {
  const inlineProblems = (html) => {
    const problems = [];
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
      if (match[2].trim()) problems.push(`script inline: ${match[2].trim().slice(0, 40)}`);
    if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) problems.push('atributo on...=');
    if (/<[a-z][^>]*\sstyle\s*=/i.test(html)) problems.push('atributo style=');
    return problems;
  };

  it('o index.html não tem script inline, on...= nem style=, e carrega public/theme-init.js clássico', () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(inlineProblems(html)).toEqual([]);
    expect(html).toContain('<script src="/theme-init.js"></script>');
    expect(html.indexOf('/theme-init.js')).toBeLessThan(html.indexOf('</head>'));
    expect(html).toMatch(/<html lang="pt-BR" class="eia-theme dark" data-eia-theme="dark">/);
    const script = readFileSync(path.join(ROOT, 'public', 'theme-init.js'), 'utf8');
    expect(script).toContain("localStorage.getItem('empreende-ia-theme')");
    expect(script).toContain('root.dataset.eiaTheme = resolved;');
    // Mutação conferida: o script de volta inline reprova.
    expect(
      inlineProblems(html.replace('<script src="/theme-init.js"></script>', `<script>${script}</script>`)),
    ).toHaveLength(1);
  });

  it.each(['dist', path.join('dist-e2e', 'instancia')])(
    'o %s/index.html, quando existe, também, e o build não tem eval',
    (dir) => {
      const file = path.join(ROOT, dir, 'index.html');
      // Só um build feito depois da última mudança do index.html (um build antigo não diz nada sobre o código atual).
      if (!existsSync(file) || statSync(file).mtimeMs < statSync(path.join(ROOT, 'index.html')).mtimeMs) return;
      const html = readFileSync(file, 'utf8');
      expect(inlineProblems(html)).toEqual([]);
      expect(html).toContain('<script src="/theme-init.js"></script>');
      // Sem eval nem new Function: a CSP não precisa de 'unsafe-eval'.
      const assets = path.join(ROOT, dir, 'assets');
      for (const name of readdirSync(assets).filter((entry) => entry.endsWith('.js')))
        expect(readFileSync(path.join(assets, name), 'utf8'), name).not.toMatch(/\beval\(|new Function\(/);
      expect(existsSync(path.join(ROOT, dir, 'theme-init.js'))).toBe(true);
    },
  );
});

describe('a recusa no build:deploy (AC-10)', () => {
  it('aceita o endereço de um projeto hospedado', () => {
    expect(supabaseOriginProblem('https://abcdefghijklmnopqrst.supabase.co', vercel)).toBeNull();
  });

  it('recusa um endereço que não seja https: ou que a CSP não cubra, dizendo o que acrescentar e onde', () => {
    expect(supabaseOriginProblem('http://127.0.0.1:54321', vercel)).toMatch(/precisa começar com https:\/\//);
    expect(supabaseOriginProblem('nada', vercel)).toMatch(/não é um endereço válido/);
    expect(supabaseOriginProblem('https://api.suaempresa.com.br', vercel)).toBe(
      'A CSP do vercel.json não deixa o navegador falar com https://api.suaempresa.com.br. Acrescente https://api.suaempresa.com.br e wss://api.suaempresa.com.br ao connect-src da regra /((?!brand/).*) no vercel.json, ou use o endereço https://<ref>.supabase.co do projeto.',
    );
    // Mutação conferida: o connect-src sem *.supabase.co recusa até o projeto hospedado.
    const narrowed = structuredClone(vercel);
    narrowed.headers[1].headers[0].value = narrowed.headers[1].headers[0].value.replace(
      ' https://*.supabase.co wss://*.supabase.co',
      '',
    );
    expect(supabaseOriginProblem('https://abcdefghijklmnopqrst.supabase.co', narrowed)).toMatch(/Acrescente/);
  });
});

describe('a exceção só do preview (seção 6.4)', () => {
  const app = appCsp(vercel);

  it('acrescenta o Supabase local em http ao connect-src, com aviso', () => {
    const { csp: widened, warning } = previewCsp(app, 'http://127.0.0.1:54339');
    expect(parseCsp(widened).get('connect-src')).toEqual([
      "'self'",
      'https://*.supabase.co',
      'wss://*.supabase.co',
      'http://127.0.0.1:54339',
      'ws://127.0.0.1:54339',
    ]);
    expect(warning).toMatch(/só no preview; na Vercel, essa origem seria bloqueada/);
    expect(previewHeadersFor('/pipeline', 'http://localhost:54321', vercel)['Content-Security-Policy']).toContain(
      'http://localhost:54321',
    );
    // /brand/* continua com a CSP própria.
    expect(previewHeadersFor('/brand/eia-icon.svg', 'http://127.0.0.1:54339', vercel)['Content-Security-Policy']).toBe(
      headersFor('/brand/eia-icon.svg', vercel)['Content-Security-Policy'],
    );
  });

  it('nunca para o backend do E2E nem para um endereço remoto', () => {
    for (const url of ['https://crm-e2e.supabase.co', 'http://remote.example:54321', 'https://api.acme.com', undefined])
      expect(previewCsp(app, url)).toEqual({ csp: app, warning: null });
    expect(previewHeadersFor('/', 'https://crm-e2e.supabase.co', vercel)).toEqual(headersFor('/', vercel));
  });

  it('o plugin aplica os cabeçalhos a cada pedido do vite preview', async () => {
    const plugin = securityHeadersPlugin();
    await plugin.config({ root: ROOT }, { mode: 'e2e' });
    const middlewares = [];
    plugin.configurePreviewServer({
      config: { logger: { warn: () => {} } },
      middlewares: { use: (fn) => middlewares.push(fn) },
    });
    expect(middlewares).toHaveLength(1);
    const set = {};
    let nexted = false;
    middlewares[0](
      { url: '/brand/eia-icon.svg?v=1' },
      { setHeader: (key, value) => (set[key] = value) },
      () => (nexted = true),
    );
    expect(nexted).toBe(true);
    expect(set).toEqual(headersFor('/brand/eia-icon.svg', vercel));
  });
});
