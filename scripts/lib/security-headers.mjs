// Cabeçalhos de segurança do frontend publicado (item 1.3; docs/arquitetura/1.3.md, seção 6): o vercel.json é a fonte
// (CSP, HSTS, frame-ancestors, nosniff, Referrer-Policy e Permissions-Policy), e este módulo o lê para os testes, para a
// recusa no `build:deploy` (scripts/lib/deploy-env.mjs) e para o `vite preview`, que aplica as mesmas regras pelo
// plugin `crm-security-headers` (o E2E roda com a CSP de verdade). Sem dependências além do Node (o `vite` só é
// carregado dentro do plugin).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './brand.mjs';

export { ROOT };
export const VERCEL_FILE = path.join(ROOT, 'vercel.json');
// A regra do app: tudo menos /brand/, que tem a CSP própria do item 1.6 (os SVG abertos direto).
export const APP_SOURCE = '/((?!brand/).*)';
export const BRAND_SOURCE = '/brand/(.*)';

export function readVercelConfig(root = ROOT) {
  return JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Casa o `source` de uma regra do vercel.json com um caminho. Aceita só o subconjunto do path-to-regexp que o CRM
 * usa: segmentos literais e um grupo final `(.*)` ou `((?!pasta/).*)`. Outra sintaxe é recusada, com a instrução de
 * estender o casador, para o teste nunca conferir uma regra que não entendeu.
 */
export function sourceMatches(source, pathname) {
  const match = source.match(/^((?:\/[A-Za-z0-9._~-]+)*\/)(\(\.\*\)|\(\(\?!([A-Za-z0-9._~-]+\/)\)\.\*\))$/);
  if (!match)
    throw new Error(
      `source "${source}" do vercel.json usa uma sintaxe que scripts/lib/security-headers.mjs não entende. Estenda sourceMatches antes de usá-la.`,
    );
  const [, prefix, , excluded] = match;
  const group = excluded ? `((?!${escapeRegExp(excluded)}).*)` : '(.*)';
  return new RegExp(`^${escapeRegExp(prefix)}${group}$`).test(pathname);
}

/** As regras de `headers` que valem para o caminho, na ordem do arquivo. */
export function rulesFor(pathname, config = readVercelConfig()) {
  return (config.headers ?? []).filter((rule) => sourceMatches(rule.source, pathname));
}

/** Os cabeçalhos que o caminho recebe: { Nome: valor }. Recusa uma chave definida por duas regras do mesmo caminho. */
export function headersFor(pathname, config = readVercelConfig()) {
  const headers = {};
  const origin = {};
  for (const rule of rulesFor(pathname, config)) {
    for (const { key, value } of rule.headers) {
      const lower = key.toLowerCase();
      if (origin[lower])
        throw new Error(
          `${pathname} recebe ${key} de duas regras do vercel.json ("${origin[lower]}" e "${rule.source}"). Deixe cada cabeçalho numa regra só, para não depender da ordem de precedência da Vercel.`,
        );
      origin[lower] = rule.source;
      headers[key] = value;
    }
  }
  return headers;
}

/** CSP em diretivas: Map nome → lista de fontes (nomes em minúsculas). */
export function parseCsp(value) {
  const directives = new Map();
  for (const part of value.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

const FETCH_DIRECTIVES = new Set([
  'connect-src',
  'font-src',
  'frame-src',
  'img-src',
  'manifest-src',
  'media-src',
  'object-src',
  'script-src',
  'style-src',
  'worker-src',
]);

// CSP 3, "scheme-part match": http: cobre https:; ws: cobre wss:, http: e https:; wss: cobre https:. https: não cobre
// wss:, por isso a CSP lista wss:// à parte.
function schemeMatches(source, target) {
  if (source === target) return true;
  if (source === 'http' && target === 'https') return true;
  if (source === 'ws' && ['wss', 'http', 'https'].includes(target)) return true;
  return source === 'wss' && target === 'https';
}

const DEFAULT_PORTS = { http: '80', https: '443', ws: '80', wss: '443' };

const effectivePort = (url, scheme) => url.port || DEFAULT_PORTS[scheme];

function sourceAllows(source, url, selfOrigin) {
  const scheme = url.protocol.slice(0, -1);
  if (source === "'self'") {
    if (!selfOrigin) return false;
    const self = new URL(selfOrigin);
    const selfScheme = self.protocol.slice(0, -1);
    if (url.hostname !== self.hostname) return false;
    if (scheme === selfScheme) return effectivePort(url, scheme) === effectivePort(self, selfScheme);
    // A mesma origem com o esquema "melhorado" (http → https, ws e wss; https → wss) também vale.
    const upgrade =
      (selfScheme === 'http' && ['https', 'ws', 'wss'].includes(scheme)) ||
      (selfScheme === 'https' && scheme === 'wss');
    return upgrade && (url.port === self.port || (!url.port && !self.port));
  }
  if (source.startsWith("'")) return false;
  if (source === '*') return ['http', 'https', 'ws', 'wss'].includes(scheme);
  const schemeOnly = source.match(/^([a-z][a-z0-9+.-]*):$/i);
  if (schemeOnly) return schemeMatches(schemeOnly[1].toLowerCase(), scheme);
  const host = source.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9.-]+)(?::(\d+|\*))?(\/.*)?$/i);
  if (!host) return false;
  const [, sourceScheme, sourceHost, sourcePort] = host;
  if (sourceScheme && !schemeMatches(sourceScheme.toLowerCase(), scheme)) return false;
  if (!sourceScheme && !['http', 'https'].includes(scheme)) return false;
  const hostname = url.hostname.toLowerCase();
  const wanted = sourceHost.toLowerCase();
  // O curinga vale só no primeiro rótulo e nunca para o próprio domínio: *.supabase.co não cobre supabase.co.
  if (wanted.startsWith('*.')) {
    if (!hostname.endsWith(wanted.slice(1))) return false;
  } else if (wanted !== '*' && wanted !== hostname) return false;
  if (sourcePort === '*') return true;
  return effectivePort(url, scheme) === (sourcePort ?? DEFAULT_PORTS[scheme]);
}

/**
 * A diretiva (ou o `default-src`, nas diretivas de busca) permite o endereço? `csp` é o texto ou o Map de `parseCsp`;
 * `selfOrigin` é a origem do CRM, para `'self'`.
 */
export function cspAllows(csp, directive, target, selfOrigin) {
  const directives = typeof csp === 'string' ? parseCsp(csp) : csp;
  const sources = directives.get(directive) ?? (FETCH_DIRECTIVES.has(directive) ? directives.get('default-src') : null);
  if (!sources) return true;
  if (sources.includes("'none'")) return false;
  let url;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  return sources.some((source) => sourceAllows(source, url, selfOrigin));
}

export const appCsp = (config = readVercelConfig()) => headersFor('/', config)['Content-Security-Policy'] ?? '';

const websocketOf = (origin) => origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');

/**
 * O endereço do Supabase da instância que a CSP do app não cobre, em pt-BR (ou `null`): o navegador recusaria o REST,
 * o Auth e o Realtime. Serve ao `build:deploy`, que também recusa o endereço sem https://.
 */
export function supabaseOriginProblem(supabaseUrl, config = readVercelConfig()) {
  let url;
  try {
    url = new URL(supabaseUrl);
  } catch {
    return `VITE_SUPABASE_URL não é um endereço válido ("${supabaseUrl}").`;
  }
  if (url.protocol !== 'https:')
    return `VITE_SUPABASE_URL precisa começar com https:// ("${supabaseUrl}"): um CRM publicado não pode apontar para localhost nem para um endereço sem criptografia.`;
  const csp = appCsp(config);
  const origin = url.origin;
  if (
    cspAllows(csp, 'connect-src', `${origin}/rest/v1/`) &&
    cspAllows(csp, 'connect-src', `${websocketOf(origin)}/realtime/v1/`)
  )
    return null;
  return `A CSP do vercel.json não deixa o navegador falar com ${origin}. Acrescente ${origin} e ${websocketOf(origin)} ao connect-src da regra ${APP_SOURCE} no vercel.json, ou use o endereço https://<ref>.supabase.co do projeto.`;
}

/**
 * A exceção só do preview (seção 6.4 do desenho): com um Supabase local em http://127.0.0.1:<porta> ou
 * http://localhost:<porta> (a medição de desempenho e o npm run preview com o Supabase local), a CSP do preview
 * acrescenta essa origem ao connect-src. Devolve a CSP (igual quando não precisa) e o aviso, se houve exceção.
 */
export function previewCsp(csp, supabaseUrl) {
  let url;
  try {
    url = new URL(supabaseUrl ?? '');
  } catch {
    return { csp, warning: null };
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return { csp, warning: null };
  if (cspAllows(csp, 'connect-src', `${url.origin}/rest/v1/`)) return { csp, warning: null };
  const directives = parseCsp(csp);
  const parts = [];
  for (const [name, sources] of directives) {
    const extra = name === 'connect-src' ? [url.origin, websocketOf(url.origin)] : [];
    parts.push([name, ...sources, ...extra].join(' '));
  }
  return {
    csp: parts.join('; '),
    warning: `Cabeçalhos (aviso): o preview acrescentou ${url.origin} ao connect-src, só no preview; na Vercel, essa origem seria bloqueada.`,
  };
}

/** Os cabeçalhos que o preview aplica a um caminho: os do vercel.json, com a exceção do Supabase local na CSP. */
export function previewHeadersFor(pathname, supabaseUrl, config = readVercelConfig()) {
  const headers = { ...headersFor(pathname, config) };
  if (headers['Content-Security-Policy'] && sourceMatches(APP_SOURCE, pathname))
    headers['Content-Security-Policy'] = previewCsp(headers['Content-Security-Policy'], supabaseUrl).csp;
  return headers;
}

/**
 * Plugin `crm-security-headers` do Vite (vite.config.ts): no `vite preview` (o E2E e o `npm run preview`), aplica a
 * cada pedido os cabeçalhos do vercel.json, como a Vercel faria. O servidor de desenvolvimento (`npm run dev`) fica sem
 * CSP: o React Refresh injeta um script inline.
 */
export function securityHeadersPlugin({ root = ROOT } = {}) {
  let supabaseUrl;
  return {
    name: 'crm-security-headers',
    async config(userConfig, { mode }) {
      const { loadEnv } = await import('vite');
      const env = { ...loadEnv(mode, path.resolve(userConfig.root ?? root), 'VITE_'), ...process.env };
      supabaseUrl = env.VITE_SUPABASE_URL;
    },
    configurePreviewServer(server) {
      const config = readVercelConfig(root);
      const { warning } = previewCsp(appCsp(config), supabaseUrl);
      if (warning) server.config.logger.warn(warning);
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '/').split(/[?#]/)[0] || '/';
        for (const [key, value] of Object.entries(previewHeadersFor(pathname, supabaseUrl, config)))
          response.setHeader(key, value);
        next();
      });
    },
  };
}
