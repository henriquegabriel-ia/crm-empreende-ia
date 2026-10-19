// Conferência da instância publicada (item 1.4; docs/arquitetura/1.4.md, seção 7): `npm run verify-instance` lê a URL
// do CRM publicado e a configuração pública do Auth do projeto Supabase, sem nenhuma credencial privada, e reprova o que
// a instância precisa ter ligado: os cabeçalhos de segurança do vercel.json (item 1.3), o robots.txt e o noindex, as
// rotas da SPA, a marca publicada e as imagens dela (item 1.6), o projeto Supabase de que o frontend fala e o
// GET /auth/v1/settings (a confirmação de e-mail ligada, o cadastro e os provedores, pela regra authSettingsProblems).
// Desde o item 1.7b, também a versão publicada: a meta crm-version da página igual à versão do package.json local.
// Regras puras e testáveis: o `fetch` entra por parâmetro (o teste usa um servidor local simulado e o E2E, o build do
// vite preview). A linha de comando fica em scripts/verify-instance.mjs. Sem dependências além do Node 20.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readPackageVersion, versionFromHtml } from './app-version.mjs';
import { BrandError, escapeHtml, isHttpsUrl, normalizeBrand } from './brand.mjs';
import { headersFor, parseCsp, readVercelConfig } from './security-headers.mjs';
import { ROOT, authSettingsProblems, loadAuthEnv, readDotenv } from './supabase-config.mjs';

export const DEFAULT_TIMEOUT_MS = 15_000;
export const USER_AGENT = 'crm-verify-instance';
export const GUIDE = 'docs/IMPLANTACAO.md';
/** As rotas internas que a regra de SPA do vercel.json precisa servir (fichas, convites e recuperação de senha). */
export const SPA_ROUTES = Object.freeze(['/contacts', '/pipeline', '/invite', '/reset-password']);
/** As imagens que o brand.json pode citar, na ordem do guia da marca. */
export const BRAND_IMAGE_FIELDS = Object.freeze([
  'logoOnLight',
  'logoOnDark',
  'icon',
  'favicon',
  'authImage',
  'emailLogo',
]);
const EMAIL_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif'];
export const CHECK_TITLES = Object.freeze({
  page: 'Página inicial',
  version: 'Versão publicada',
  headers: 'Cabeçalhos de segurança',
  robots: 'robots.txt',
  routes: 'Rotas do app',
  brand: 'Marca publicada',
  images: 'Imagens da marca',
  backend: 'Projeto Supabase do frontend',
  auth: 'Configuração do Auth',
});
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/** A chave só com os 12 primeiros caracteres: nenhuma saída mostra a chave inteira. */
export const maskKey = (key) => (key ? `${String(key).slice(0, 12)}…` : '(nenhuma)');

function jwtRole(key) {
  const parts = String(key).split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * O problema da chave informada, ou `null`: a chave secreta (`sb_secret_…`) e o JWT `service_role` (ou
 * `supabase_admin`) são recusados antes de qualquer pedido, porque o verify-instance só usa a chave pública.
 */
export function keyProblem(key) {
  const value = String(key ?? '').trim();
  if (!value)
    return 'Falta a chave pública do Supabase: informe --key sb_publishable_… ou VITE_SUPABASE_PUBLISHABLE_KEY no .env.local (Project Settings → API Keys).';
  const role = jwtRole(value);
  if (value.startsWith('sb_secret_') || role === 'service_role' || role === 'supabase_admin')
    return 'Esta é a chave secreta do Supabase, que dá acesso total ao banco. O verify-instance só usa a chave pública (sb_publishable_…, ou o JWT anon). Se a chave secreta foi colada em algum arquivo do repositório ou numa variável VITE_, troque-a já no painel (Project Settings → API Keys).';
  return null;
}

/** Problemas de um endereço (o do CRM ou o do Supabase): https://, sem caminho, consulta, fragmento nem barra no fim. */
export function urlProblems(value, { name, local = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return [`${name} não é um endereço válido ("${value}"). Use o endereço completo, com https://.`];
  }
  const problems = [];
  const isLocal = LOCAL_HOSTS.includes(url.hostname);
  // A origem sugerida já com https://, fora do ensaio local.
  const origin = local ? url.origin : url.origin.replace(/^http:/, 'https:');
  if (local) {
    // O http:// do ensaio local só vale para este computador: um endereço público por http:// mandaria a chave pública
    // e as respostas sem criptografia, e a conferência dele não vale como a da instância publicada.
    if (!(url.protocol === 'http:' || url.protocol === 'https:'))
      problems.push(`${name} precisa começar com http:// ou https:// ("${value}").`);
    else if (url.protocol === 'http:' && !isLocal)
      problems.push(
        `${name} usa http:// num endereço que não é deste computador ("${value}"). O --local aceita http:// só em localhost e 127.0.0.1; para a instância publicada, use ${url.origin.replace(/^http:/, 'https:')} sem --local.`,
      );
  } else if (url.protocol !== 'https:') {
    problems.push(
      isLocal
        ? `${name} aponta para este computador ("${value}"). Para o ensaio contra o npm run preview, use --local; a conferência da instância publicada usa o endereço público, com https://.`
        : `${name} precisa começar com https:// ("${value}"). Use ${origin}.`,
    );
  }
  if (url.username || url.password) problems.push(`${name} não pode ter usuário nem senha no endereço.`);
  if (url.search || url.hash || value.includes('?') || value.includes('#'))
    problems.push(`${name} não pode ter consulta (?) nem fragmento (#): use só a origem, como ${origin}.`);
  else if (url.pathname !== '/' || value.endsWith('/'))
    problems.push(
      url.pathname === '/'
        ? `${name} não pode terminar com barra. Use ${origin}.`
        : `${name} não pode ter caminho ("${url.pathname}"): use só a origem, como ${origin}.`,
    );
  return problems;
}

const USAGE =
  'Uso: npm run verify-instance -- <SUA_URL> [--supabase-url https://<SEU_PROJECT_REF>.supabase.co] [--key sb_publishable_…] [--local]';

/**
 * As entradas da conferência e de onde veio cada uma (seção 7.2 do desenho): a URL do CRM pelo argumento ou por
 * SUPABASE_AUTH_SITE_URL (lida como o config:check, de supabase/.env); a URL do Supabase e a chave pública pelas opções
 * ou por VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY (do ambiente, de .env.local ou de .env na raiz). `problems`
 * lista o que impede a conferência (saída 2), antes de qualquer pedido.
 */
export function instanceInputs(
  argv,
  env = process.env,
  { root = ROOT, readFile = readFileSync, exists = existsSync } = {},
) {
  const problems = [];
  const options = {};
  const positional = [];
  let local = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inline] = arg.startsWith('--') ? arg.split(/=(.*)/s) : [arg];
    if (flag === '--local') local = true;
    else if (flag === '--help' || flag === '-h') help = true;
    else if (flag === '--supabase-url' || flag === '--key') {
      const value = inline ?? argv[(index += 1)];
      if (value === undefined || value.startsWith('--')) problems.push(`${flag} precisa de um valor. ${USAGE}`);
      else options[flag.slice(2)] = value.trim();
    } else if (arg.startsWith('-')) problems.push(`Opção desconhecida: ${arg}. ${USAGE}`);
    else positional.push(arg.trim());
  }
  if (positional.length > 1)
    problems.push(`Informe só um endereço do CRM (recebi ${positional.join(' e ')}). ${USAGE}`);
  const sources = {};
  let siteUrl = positional[0];
  if (siteUrl) sources.siteUrl = 'argumento';
  else {
    const auth = loadAuthEnv({ root, env, readFile, exists });
    siteUrl = auth.values.SUPABASE_AUTH_SITE_URL?.trim();
    if (siteUrl) sources.siteUrl = auth.sources.SUPABASE_AUTH_SITE_URL;
  }
  // O que o build usa: o ambiente, depois .env.local e .env na raiz.
  const dotenv = ['.env.local', '.env']
    .map((name) => path.join(root, name))
    .filter((file) => exists(file))
    .map((file) => ({ file: path.basename(file), values: readDotenv(readFile(file, 'utf8')).values }));
  const fromEnv = (name) => {
    if (env[name]?.trim()) return { value: env[name].trim(), source: 'ambiente' };
    for (const { file, values } of dotenv)
      if (values[name]?.trim()) return { value: values[name].trim(), source: file };
    return { value: undefined, source: undefined };
  };
  const pick = (option, variable) =>
    options[option] !== undefined ? { value: options[option], source: `--${option}` } : fromEnv(variable);
  const supabase = pick('supabase-url', 'VITE_SUPABASE_URL');
  const key = pick('key', 'VITE_SUPABASE_PUBLISHABLE_KEY');
  sources.supabaseUrl = supabase.source;
  sources.publishableKey = key.source;
  // A chave secreta é recusada primeiro, sem olhar mais nada.
  const keyIssue = keyProblem(key.value);
  if (keyIssue) problems.push(keyIssue);
  if (!siteUrl)
    problems.push(
      `Falta o endereço do CRM publicado: npm run verify-instance -- https://crm.suaempresa.com.br (ou SUPABASE_AUTH_SITE_URL em supabase/.env).`,
    );
  else problems.push(...urlProblems(siteUrl, { name: 'O endereço do CRM', local }));
  if (!supabase.value)
    problems.push(
      'Falta o endereço do Supabase: informe --supabase-url https://<SEU_PROJECT_REF>.supabase.co ou VITE_SUPABASE_URL no .env.local.',
    );
  else problems.push(...urlProblems(supabase.value, { name: 'O endereço do Supabase', local }));
  return {
    siteUrl,
    supabaseUrl: supabase.value,
    publishableKey: key.value,
    local,
    help,
    sources,
    problems: [...new Set(problems)],
  };
}

// ---------------------------------------------------------------------------------------------------------
// Os pedidos

class FetchFailure extends Error {}

// Um pedido com tempo limite próprio (AbortController e setTimeout, que valem em qualquer ambiente), sem seguir
// redirecionamento: um 30x é mostrado como tal.
async function request(fetchImpl, url, { timeoutMs, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT, ...headers },
      signal: controller.signal,
    });
    return { response, body: await response.text() };
  } catch (error) {
    if (controller.signal.aborted) throw new FetchFailure(`${url} não respondeu em ${Math.round(timeoutMs / 1000)} s.`);
    const cause = error?.cause?.code ?? error?.cause?.message ?? error?.message ?? String(error);
    throw new FetchFailure(
      `Não foi possível acessar ${url} (${cause}). Confira o endereço e a conexão com a internet.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

const contentType = (response) => (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
const normalizeSpaces = (value) => String(value).replace(/\s+/g, ' ').trim();

function hstsDirectives(value) {
  const directives = {};
  for (const part of value.split(';')) {
    const [name, raw] = part.trim().split('=');
    if (name) directives[name.trim().toLowerCase()] = raw?.trim() ?? true;
  }
  return directives;
}

// O HSTS recebido vale se cada ocorrência (a plataforma pode juntar a dela com a do vercel.json, separadas por vírgula)
// for igual ou mais forte que a esperada: max-age maior ou igual e includeSubDomains, quando o vercel.json pede.
function hstsMatches(expected, received) {
  const want = hstsDirectives(expected);
  const parts = received
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    parts.length > 0 &&
    parts.every((part) => {
      const got = hstsDirectives(part);
      if (Number(got['max-age']) < Number(want['max-age']) || Number.isNaN(Number(got['max-age']))) return false;
      return !('includesubdomains' in want) || 'includesubdomains' in got;
    })
  );
}

// A CSP por diretiva, sem exigir a ordem das fontes: uma fonte a mais ou a menos reprova, porque o vercel.json do
// repositório é a fonte da regra.
function cspDifference(expected, received) {
  const want = parseCsp(expected);
  const got = parseCsp(received);
  const differences = [];
  for (const [name, sources] of want) {
    const live = got.get(name);
    if (!live) {
      differences.push(`falta ${name}`);
      continue;
    }
    const extra = live.filter((source) => !sources.includes(source));
    const missing = sources.filter((source) => !live.includes(source));
    if (extra.length) differences.push(`${name} com ${extra.join(' ')} a mais`);
    if (missing.length) differences.push(`${name} sem ${missing.join(' ')}`);
  }
  for (const name of got.keys()) if (!want.has(name)) differences.push(`${name} a mais`);
  return differences;
}

/**
 * Os problemas dos cabeçalhos recebidos em relação aos esperados (os do vercel.json para o caminho), em pt-BR. Nomes
 * sem diferença de maiúsculas; valores com os espaços normalizados; o HSTS e a CSP com as regras da seção 7.5.
 */
export function headerProblems(expected, received, { where = '/' } = {}) {
  const get =
    typeof received?.get === 'function'
      ? (name) => received.get(name)
      : (name) => {
          const key = Object.keys(received ?? {}).find((entry) => entry.toLowerCase() === name.toLowerCase());
          return key === undefined ? null : received[key];
        };
  const problems = [];
  for (const [name, value] of Object.entries(expected)) {
    const live = get(name);
    if (live === null || live === undefined) {
      problems.push(
        `${where} não manda o cabeçalho ${name}. Publique o commit atual na Vercel. Noutra hospedagem, repita os cabeçalhos do vercel.json (${GUIDE}, Apêndice A.2).`,
      );
      continue;
    }
    const lower = name.toLowerCase();
    if (lower === 'strict-transport-security') {
      if (!hstsMatches(value, live))
        problems.push(
          `${name} mais fraco que o do vercel.json em ${where}: esperado ${value}, recebido ${normalizeSpaces(live)}. Publique o mesmo commit que está no seu computador.`,
        );
      continue;
    }
    if (lower === 'content-security-policy') {
      const differences = cspDifference(value, live);
      if (differences.length)
        problems.push(
          `${name} diferente do vercel.json em ${where} (${differences.join(', ')}). Publique o mesmo commit que está no seu computador.`,
        );
      continue;
    }
    if (normalizeSpaces(live).toLowerCase() !== normalizeSpaces(value).toLowerCase())
      problems.push(
        `${name} diferente do vercel.json em ${where}: esperado ${value}, recebido ${normalizeSpaces(live)}. Publique o mesmo commit que está no seu computador.`,
      );
  }
  return problems;
}

/** `User-agent: *` seguido de `Disallow: /` no mesmo grupo. */
export function robotsClosesSite(text) {
  let inStarGroup = false;
  let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const name = field.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (name === 'user-agent') {
      inStarGroup = lastWasAgent ? inStarGroup || value === '*' : value === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (inStarGroup && name === 'disallow' && value === '/') return true;
  }
  return false;
}

const SUPABASE_ORIGIN = /https:\/\/[a-z0-9-]+\.supabase\.(?:co|in)\b/g;
const ROOT_DIV = /<div\s+id=["']root["']/i;
const NOINDEX = /<meta\s+name=["']robots["']\s+content=["']noindex,\s*nofollow["']/i;

/** A primeira página e o que se espera dela, para a conferência da página e das rotas. */
function pageProblems(response, body, where) {
  if (response.status !== 200) return [`${where} respondeu ${response.status}, não 200.`];
  if (contentType(response) !== 'text/html')
    return [`${where} respondeu ${contentType(response) || 'sem tipo'}, não text/html.`];
  if (!ROOT_DIV.test(body)) return [`${where} não traz o <div id="root"> do CRM: não é o index.html deste build.`];
  return [];
}

/**
 * Confere a instância publicada. Devolve `{ checks: [{ id, status: 'ok' | 'fail' | 'warn', title, detail }], approved,
 * local }`. `allowLocal` aceita http://localhost e http://127.0.0.1 (o ensaio contra o npm run preview) e acrescenta o
 * aviso de que o resultado não vale pela instância publicada. A chave é conferida antes de qualquer pedido.
 * `expectedVersion` é a versão do repositório (a do package.json local, por padrão), comparada com a meta crm-version.
 */
export async function verifyInstance({
  siteUrl,
  supabaseUrl,
  publishableKey,
  fetch: fetchImpl = globalThis.fetch,
  config = readVercelConfig(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  allowLocal = false,
  expectedVersion = readPackageVersion(),
}) {
  const refused = [
    keyProblem(publishableKey),
    ...urlProblems(siteUrl ?? '', { name: 'O endereço do CRM', local: allowLocal }),
    ...urlProblems(supabaseUrl ?? '', { name: 'O endereço do Supabase', local: allowLocal }),
  ].filter(Boolean);
  if (refused.length) throw new VerifyInputError(refused);
  const site = new URL(siteUrl).origin;
  const backend = new URL(supabaseUrl).origin;
  const checks = [];
  const add = (id, problems, okDetail) =>
    checks.push({
      id,
      title: CHECK_TITLES[id],
      status: problems.length ? 'fail' : 'ok',
      detail: problems.length ? problems.join(' ') : okDetail,
    });
  const get = (url, headers) => request(fetchImpl, url, { timeoutMs, headers });
  const settle = (promise) =>
    promise.then(
      (value) => ({ value }),
      (error) => {
        if (error instanceof FetchFailure) return { error: error.message };
        throw error;
      },
    );

  const [home, robots, brandFile, settings, ...routes] = await Promise.all([
    settle(get(`${site}/`)),
    settle(get(`${site}/robots.txt`)),
    settle(get(`${site}/brand/brand.json`)),
    settle(get(`${backend}/auth/v1/settings`, { apikey: publishableKey })),
    ...[...SPA_ROUTES, `/rota-que-nao-existe-${randomUUID().slice(0, 8)}`].map((route) =>
      settle(get(`${site}${route}`)).then((result) => ({ route, ...result })),
    ),
  ]);

  // A marca publicada (C5), antes da página: o <title> é conferido com o nome dela.
  let brand = null;
  const brandProblems = [];
  if (brandFile.error) brandProblems.push(brandFile.error);
  else if (brandFile.value.response.status !== 200)
    brandProblems.push(
      `/brand/brand.json respondeu ${brandFile.value.response.status}: o build publicado não tem a pasta da marca (public/brand).`,
    );
  else {
    try {
      brand = normalizeBrand(JSON.parse(brandFile.value.body), { checkFiles: false });
    } catch (error) {
      if (error instanceof SyntaxError)
        brandProblems.push(
          '/brand/brand.json publicado não é um JSON válido. Rode npm run brand:check e publique de novo.',
        );
      else if (error instanceof BrandError)
        brandProblems.push(`/brand/brand.json publicado: ${error.problems.join('. ')}.`);
      else throw error;
    }
    brandProblems.push(
      ...headerProblems(headersFor('/brand/brand.json', config), brandFile.value.response.headers, {
        where: '/brand/brand.json',
      }),
    );
  }

  // C1, a página inicial.
  const pageIssues = [];
  if (home.error) pageIssues.push(home.error);
  else {
    const { response, body } = home.value;
    if (response.status >= 300 && response.status < 400)
      pageIssues.push(
        `${site}/ redireciona para ${response.headers.get('location') ?? 'outro endereço'}: use o endereço final, o mesmo da Site URL do Auth.`,
      );
    else if (response.status === 401 || response.status === 403)
      pageIssues.push(
        `${site}/ respondeu ${response.status}: a proteção de deploy da Vercel (Vercel Authentication) está ligada no domínio de produção. Desligue-a em Settings → Deployment Protection: o CRM tem login próprio.`,
      );
    else {
      pageIssues.push(...pageProblems(response, body, `${site}/`));
      if (!pageIssues.length) {
        if (!NOINDEX.test(body))
          pageIssues.push(
            'A página não traz <meta name="robots" content="noindex, nofollow">: os buscadores podem listar o CRM.',
          );
        const title = body.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '';
        if (brand && !title.includes(escapeHtml(brand.productName)) && !title.includes(brand.productName))
          pageIssues.push(
            `O título da página ("${title}") não traz o nome da marca publicada ("${brand.productName}"): o build não usou a marca do brand.json.`,
          );
      }
    }
  }
  add(
    'page',
    pageIssues,
    `${site}/ responde com o CRM, fora dos buscadores (noindex, nofollow)${brand ? ` e com o título da marca "${brand.productName}"` : ''}.`,
  );

  // A versão publicada (item 1.7b), no HTML que a página inicial já baixou: nenhum pedido a mais.
  const versionIssues = [];
  let servedVersion = null;
  if (home.error || home.value.response.status !== 200)
    versionIssues.push('Não conferida: a página inicial não respondeu 200.');
  else {
    servedVersion = versionFromHtml(home.value.body);
    if (servedVersion === null)
      versionIssues.push(
        'A página não diz a versão: ela foi publicada antes da versão com essa informação ou não a partir deste repositório. Publique de novo (etapa 7 do guia) e rode outra vez.',
      );
    else if (servedVersion !== expectedVersion)
      versionIssues.push(
        `A URL serve a versão ${servedVersion}, e o repositório está na ${expectedVersion}. Confira em Deployments, na Vercel, se a publicação terminou e se o branch de produção é o certo; depois de uma volta atrás (Instant Rollback), use Undo Rollback.`,
      );
  }
  add('version', versionIssues, `A URL serve a versão ${servedVersion}, a mesma do repositório.`);

  // C2, os cabeçalhos da página.
  add(
    'headers',
    home.error || home.value.response.status >= 300
      ? [`Não conferidos: a página inicial não respondeu 200.`]
      : headerProblems(headersFor('/', config), home.value.response.headers, { where: `${site}/` }),
    'A página manda os cabeçalhos de segurança do vercel.json (CSP, HSTS, nosniff, Referrer-Policy, X-Frame-Options e Permissions-Policy).',
  );

  // C3, o robots.txt.
  const robotsIssues = [];
  if (robots.error) robotsIssues.push(robots.error);
  else if (robots.value.response.status !== 200)
    robotsIssues.push(`/robots.txt respondeu ${robots.value.response.status}: os buscadores podem listar o CRM.`);
  else if (!contentType(robots.value.response).startsWith('text/plain') || !robotsClosesSite(robots.value.body))
    robotsIssues.push(
      'O robots.txt publicado não fecha o site (User-agent: * com Disallow: /): os buscadores podem listar o CRM.',
    );
  add('robots', robotsIssues, 'O robots.txt fecha o site inteiro para os buscadores.');

  // C4, as rotas da SPA, com a CSP do app.
  const routeIssues = [];
  for (const { route, value, error } of routes) {
    const shown = route.startsWith('/rota-que-nao-existe-') ? 'uma rota que não existe' : route;
    if (error) {
      routeIssues.push(error);
      continue;
    }
    const issues = pageProblems(value.response, value.body, shown);
    if (issues.length && value.response.status === 404)
      routeIssues.push(
        `${shown} respondeu 404: a regra de SPA do vercel.json não está valendo (a pasta raiz do projeto na Vercel é a raiz do repositório?).`,
      );
    else routeIssues.push(...issues);
    if (!issues.length) {
      const csp = headersFor(route, config)['Content-Security-Policy'];
      routeIssues.push(...headerProblems({ 'Content-Security-Policy': csp }, value.response.headers, { where: shown }));
    }
  }
  add('routes', routeIssues, `${SPA_ROUTES.join(', ')} e uma rota que não existe abrem o CRM, com a CSP do app.`);

  add(
    'brand',
    brandProblems,
    brand ? `/brand/brand.json válido, da marca "${brand.productName}", com a CSP própria da pasta /brand/.` : '',
  );

  // C6, as imagens citadas no brand.json (depende de C5).
  const imageIssues = [];
  const images = brand ? BRAND_IMAGE_FIELDS.filter((field) => brand[field]) : [];
  if (!brand) imageIssues.push('Não conferidas: o /brand/brand.json publicado não foi lido.');
  else {
    const results = await Promise.all(
      images.map(async (field) => {
        const url = isHttpsUrl(brand[field]) ? brand[field] : `${site}/brand/${brand[field]}`;
        return { field, url, ...(await settle(get(url))) };
      }),
    );
    for (const { field, url, value, error } of results) {
      const consequence = field === 'emailLogo' ? ': os e-mails ficariam sem logo' : '';
      if (error) imageIssues.push(error);
      else if (value.response.status !== 200)
        imageIssues.push(`A imagem ${field} (${url}) respondeu ${value.response.status}${consequence}.`);
      else if (!contentType(value.response).startsWith('image/'))
        imageIssues.push(
          `A imagem ${field} (${url}) respondeu ${contentType(value.response) || 'sem tipo'}, não uma imagem${consequence}.`,
        );
      else if (field === 'emailLogo' && !EMAIL_LOGO_TYPES.includes(contentType(value.response)))
        imageIssues.push(
          `A imagem emailLogo (${url}) é ${contentType(value.response)}: os programas de e-mail só mostram PNG, JPG ou GIF.`,
        );
    }
  }
  add(
    'images',
    imageIssues,
    images.length
      ? `As ${images.length} imagens citadas no brand.json respondem com o tipo certo${images.includes('emailLogo') ? ', inclusive o logo dos e-mails' : ''}.`
      : 'O brand.json não cita imagens: o CRM mostra o nome em texto.',
  );

  // C7, o projeto Supabase de que o frontend publicado fala (depende de C1).
  const backendIssues = [];
  const script = home.value?.body?.match(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  if (home.error || home.value.response.status !== 200)
    backendIssues.push('Não conferido: a página inicial não respondeu 200.');
  else if (!script) backendIssues.push('A página não cita o JavaScript principal do CRM (<script type="module">).');
  else {
    const scriptUrl = new URL(script, `${site}/`).href;
    const main = await settle(get(scriptUrl));
    if (main.error) backendIssues.push(main.error);
    else if (main.value.response.status !== 200)
      backendIssues.push(`O JavaScript principal (${scriptUrl}) respondeu ${main.value.response.status}.`);
    else {
      const others = [...new Set(main.value.body.match(SUPABASE_ORIGIN) ?? [])].filter((origin) => origin !== backend);
      if (others.length)
        backendIssues.push(
          `O frontend publicado fala com ${others.join(', ')}, não com ${backend}: confira VITE_SUPABASE_URL na Vercel e publique de novo.`,
        );
      else if (!main.value.body.includes(backend))
        backendIssues.push(
          `O frontend publicado não cita ${backend}: confira VITE_SUPABASE_URL na Vercel (com https:// e sem barra no fim) e publique de novo.`,
        );
    }
  }
  add('backend', backendIssues, `O frontend publicado fala com ${backend}, o projeto conferido.`);

  // C8, a configuração pública do Auth.
  const authIssues = [];
  if (settings.error) authIssues.push(settings.error);
  else {
    const { response, body } = settings.value;
    if (response.status === 401 || response.status === 403)
      authIssues.push(
        `${backend}/auth/v1/settings respondeu ${response.status}: a chave não é deste projeto ou não é a chave pública.`,
      );
    else if (response.status !== 200)
      authIssues.push(`${backend}/auth/v1/settings respondeu ${response.status}: confira o endereço do Supabase.`);
    else {
      let json = null;
      try {
        json = JSON.parse(body);
      } catch {
        authIssues.push(`${backend}/auth/v1/settings não respondeu JSON: confira o endereço do Supabase.`);
      }
      if (json !== null)
        authIssues.push(
          ...authSettingsProblems(json).map((problem) => problem.charAt(0).toUpperCase() + problem.slice(1)),
        );
    }
  }
  add(
    'auth',
    authIssues,
    'Confirmação de e-mail ligada, cadastro e e-mail ligados, telefone, login anônimo e login social desligados.',
  );

  if (allowLocal)
    checks.push({
      id: 'local',
      title: 'Ensaio local',
      status: 'warn',
      detail: 'Ensaio local (--local): não vale como conferência da instância publicada.',
    });
  return { checks, approved: checks.every((entry) => entry.status !== 'fail'), local: allowLocal };
}

/** Entrada que impede a conferência (saída 2), recusada antes de qualquer pedido. */
export class VerifyInputError extends Error {
  constructor(problems) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

const LABELS = { ok: 'OK', fail: 'REPROVADO', warn: 'AVISO' };

/** O relatório em texto: uma linha por conferência e o resumo. Nenhuma linha mostra a chave inteira. */
export function formatVerifyReport(result, { siteUrl, supabaseUrl, publishableKey } = {}) {
  const lines = [];
  if (siteUrl)
    lines.push(`Conferindo ${siteUrl} com o Supabase ${supabaseUrl} e a chave ${maskKey(publishableKey)}.`, '');
  for (const entry of result.checks) lines.push(`${LABELS[entry.status].padEnd(9)} ${entry.title}: ${entry.detail}`);
  const total = result.checks.filter((entry) => entry.status !== 'warn').length;
  const failed = result.checks.filter((entry) => entry.status === 'fail').length;
  lines.push('');
  lines.push(
    result.approved
      ? `Instância aprovada: ${total} conferências. Rode também o supabase/instance-check.sql no editor SQL do painel.`
      : `Instância reprovada: ${failed} de ${total} conferências reprovadas. Corrija cada linha REPROVADO e rode npm run verify-instance de novo (${GUIDE}, "Solução de problemas").`,
  );
  const text = lines.join('\n');
  return publishableKey && publishableKey.length > 12 ? text.split(publishableKey).join(maskKey(publishableKey)) : text;
}

export { USAGE as VERIFY_USAGE };
