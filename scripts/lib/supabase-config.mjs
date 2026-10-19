// Configuração do Supabase Auth da instância (item 1.3; docs/arquitetura/1.3.md, seções 4 e 5): leitura de
// supabase/config.toml, as regras do `npm run config:check`, a chamada guardada do `supabase config push`
// (`npm run config:push`) e a regra pura que o `verify-instance` do item 1.4 aplica ao GET /auth/v1/settings. Quem usa é
// `scripts/supabase-config.mjs`, o gerador dos e-mails (scripts/lib/auth-emails.mjs, que lê otp_expiry, otp_length e
// double_confirm_changes e grava a região dos modelos) e o teste `supabase-config.test.mjs`. Sem dependências além do
// Node.
//
// Por que o push precisa de guarda (o que o código do Supabase CLI 2.119.0 mostra, seção 4.3 do desenho):
// - o CLI envia a seção [auth] inteira, e uma chave que falta vai com o padrão dele (enable_confirmations = false,
//   email_sent = 2, max_frequency = "1s", site_url = "http://127.0.0.1:3000"); por isso o config.toml declara cada uma e
//   o check recusa o valor de segurança alterado;
// - uma variável de `env(NOME)` sem valor só gera um aviso, e o texto "env(NOME)" vai como valor; por isso o check
//   recusa a variável ausente antes de chamar o CLI;
// - o viper do CLI troca qualquer chave pela variável SUPABASE_<CAMINHO> (do processo ou de um .env que ele carrega) e
//   aplica por cima o bloco [remotes.<nome>] do projeto ligado; por isso o check recusa essas variáveis e só aceita as
//   tabelas da lista de permissão (ALLOWED_TABLES).
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './brand.mjs';

export { ROOT };
export const SUPABASE_DIR = path.join(ROOT, 'supabase');
export const CONFIG_FILE = path.join(SUPABASE_DIR, 'config.toml');
export const ENV_EXAMPLE_FILE = path.join(SUPABASE_DIR, '.env.example');
export const PROJECT_REF_FILE = path.join(SUPABASE_DIR, '.temp', 'project-ref');
// Versão fixa do CLI do push: a semântica da seção 4.3 do desenho foi conferida no código desta tag. Trocar de versão
// exige refazer a conferência.
export const SUPABASE_CLI_VERSION = '2.119.0';

const display = (file, root = ROOT) => path.relative(root, file).split(path.sep).join('/');

// ---------------------------------------------------------------------------------------------------------
// Leitor de TOML restrito (seção 4.7)

export class ConfigTomlError extends Error {
  constructor(line, message) {
    super(`linha ${line}: ${message}`);
    this.name = 'ConfigTomlError';
    this.line = line;
  }
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
// O Supabase CLI lê o arquivo pelo viper, que não diferencia maiúsculas: "ENABLE_CONFIRMATIONS" e
// "enable_confirmations" seriam a mesma chave, e o check validaria uma enquanto o CLI enviaria a outra. O arquivo da
// base só usa minúsculas, então o leitor recusa qualquer maiúscula em chave ou tabela.
const UPPERCASE = /[A-Z]/;
const ESCAPES = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };

// Lê uma string com aspas duplas a partir de `start` (na aspa). Devolve o valor e a posição depois da aspa final.
function readBasicString(text, start, line) {
  let value = '';
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') return { value, end: index + 1 };
    if (char === '\\') {
      const next = text[index + 1];
      if (next in ESCAPES) {
        value += ESCAPES[next];
        index += 2;
        continue;
      }
      const size = next === 'u' ? 4 : next === 'U' ? 8 : 0;
      const hex = text.slice(index + 2, index + 2 + size);
      if (!size || !new RegExp(`^[0-9A-Fa-f]{${size}}$`).test(hex))
        throw new ConfigTomlError(line, `escape inválido \\${next ?? ''} na string`);
      value += String.fromCodePoint(parseInt(hex, 16));
      index += 2 + size;
      continue;
    }
    value += char;
    index += 1;
  }
  throw new ConfigTomlError(line, 'string sem a aspa final (strings de várias linhas não são aceitas)');
}

function readLiteralString(text, start, line) {
  const end = text.indexOf("'", start + 1);
  if (end < 0) throw new ConfigTomlError(line, 'string sem a aspa final (strings de várias linhas não são aceitas)');
  return { value: text.slice(start + 1, end), end: end + 1 };
}

// O resto da linha depois de um valor só pode ter espaços e um comentário.
function assertLineEnd(rest, line) {
  const trimmed = rest.trim();
  if (trimmed && !trimmed.startsWith('#'))
    throw new ConfigTomlError(line, `texto inesperado depois do valor: ${trimmed}`);
}

function readScalar(text, start, line) {
  const char = text[start];
  if (text.startsWith('"""', start) || text.startsWith("'''", start))
    throw new ConfigTomlError(line, 'strings de várias linhas não são aceitas');
  if (char === '"') return readBasicString(text, start, line);
  if (char === "'") return readLiteralString(text, start, line);
  if (char === '{')
    throw new ConfigTomlError(line, 'tabelas em linha ({ ... }) não são aceitas; use uma tabela [nome]');
  const token = text.slice(start).match(/^[^\s,\]#]+/)?.[0] ?? '';
  if (token === 'true' || token === 'false') return { value: token === 'true', end: start + token.length };
  if (/^[+-]?(0|[1-9](_?[0-9])*)$/.test(token))
    return { value: Number(token.replace(/_/g, '')), end: start + token.length };
  if (/^\d{4}-\d{2}-\d{2}/.test(token)) throw new ConfigTomlError(line, `datas não são aceitas: ${token}`);
  if (/^[+-]?[0-9_]+(\.[0-9_]+)?([eE][+-]?\d+)?$/.test(token) || /^[+-]?(inf|nan)$/.test(token))
    throw new ConfigTomlError(line, `números com casas decimais não são aceitos: ${token}`);
  throw new ConfigTomlError(line, `valor não reconhecido: ${token || text.slice(start).trim()}`);
}

function readValue(text, start, line) {
  if (text[start] !== '[') return readScalar(text, start, line);
  const items = [];
  let index = start + 1;
  for (;;) {
    while (text[index] === ' ' || text[index] === '\t') index += 1;
    if (index >= text.length)
      throw new ConfigTomlError(line, 'lista sem o colchete final (listas de várias linhas não são aceitas)');
    if (text[index] === ']') return { value: items, end: index + 1 };
    if (text[index] !== '"' && text[index] !== "'")
      throw new ConfigTomlError(line, 'listas só podem ter textos entre aspas, numa linha');
    const item = readScalar(text, index, line);
    items.push(item.value);
    index = item.end;
    while (text[index] === ' ' || text[index] === '\t') index += 1;
    if (text[index] === ',') index += 1;
    else if (text[index] !== ']') throw new ConfigTomlError(line, 'lista com separador inválido (use vírgulas)');
  }
}

const isTable = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Lê o subconjunto de TOML que o config.toml do CRM usa: tabelas `[a.b-c]`, chaves simples, strings com aspas duplas
 * (com os escapes do TOML) ou simples, inteiros, booleanos, listas de strings numa linha e comentários. Recusa, com a
 * linha, o que não entende (tabelas em linha, listas de tabelas, strings de várias linhas, datas, chave ou tabela
 * repetida, maiúscula em chave ou tabela), para o check nunca validar um arquivo lido pela metade.
 */
export function parseConfigToml(text) {
  const root = {};
  const defined = new Set();
  let current = root;
  let currentName = '';
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((raw, position) => {
    const line = position + 1;
    const content = raw.trim();
    if (!content || content.startsWith('#')) return;
    if (content.startsWith('[[')) throw new ConfigTomlError(line, 'listas de tabelas ([[nome]]) não são aceitas');
    if (content.startsWith('[')) {
      const close = content.indexOf(']');
      if (close < 0) throw new ConfigTomlError(line, 'tabela sem o colchete final');
      assertLineEnd(content.slice(close + 1), line);
      const name = content.slice(1, close).trim();
      const parts = name.split('.').map((part) => part.trim());
      if (!parts.every((part) => BARE_KEY.test(part)))
        throw new ConfigTomlError(line, `nome de tabela inválido: [${name}]`);
      const key = parts.join('.');
      if (UPPERCASE.test(key))
        throw new ConfigTomlError(
          line,
          `a tabela [${key}] tem letra maiúscula; use [${key.toLowerCase()}] (o Supabase CLI não diferencia maiúsculas)`,
        );
      if (defined.has(key)) throw new ConfigTomlError(line, `a tabela [${key}] aparece duas vezes`);
      defined.add(key);
      let table = root;
      for (const part of parts) {
        if (table[part] === undefined) table[part] = {};
        else if (!isTable(table[part])) throw new ConfigTomlError(line, `[${key}] repete a chave ${part}`);
        table = table[part];
      }
      current = table;
      currentName = key;
      return;
    }
    const equals = content.indexOf('=');
    if (equals < 0) throw new ConfigTomlError(line, `linha sem "=": ${content}`);
    const key = content.slice(0, equals).trim();
    if (key.includes('.')) throw new ConfigTomlError(line, `chaves com ponto não são aceitas: ${key}; use uma tabela`);
    if (!BARE_KEY.test(key)) throw new ConfigTomlError(line, `nome de chave inválido: ${key}`);
    if (UPPERCASE.test(key))
      throw new ConfigTomlError(
        line,
        `a chave ${key} tem letra maiúscula; use ${key.toLowerCase()} (o Supabase CLI não diferencia maiúsculas)`,
      );
    if (Object.prototype.hasOwnProperty.call(current, key))
      throw new ConfigTomlError(line, `a chave ${currentName ? `[${currentName}] ` : ''}${key} aparece duas vezes`);
    let start = equals + 1;
    while (content[start] === ' ' || content[start] === '\t') start += 1;
    if (start >= content.length) throw new ConfigTomlError(line, `a chave ${key} está sem valor`);
    const { value, end } = readValue(content, start, line);
    assertLineEnd(content.slice(end), line);
    current[key] = value;
  });
  return root;
}

/** Valor de uma chave pelo caminho com pontos ("auth.email.otp_length"); `undefined` se faltar. */
export function valueAt(config, dotted) {
  let value = config;
  for (const part of dotted.split('.')) {
    if (!isTable(value)) return undefined;
    value = value[part];
  }
  return value;
}

export function readConfigToml(file = CONFIG_FILE) {
  return parseConfigToml(readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------------------------------------
// Região gerada dos modelos de e-mail (seção 4.4)

export const TEMPLATE_REGION_START =
  '# >>> Modelos de e-mail do Auth: gerado por npm run emails:build (não edite entre as marcas)';
export const TEMPLATE_REGION_END = '# <<< Modelos de e-mail do Auth';

/** Conteúdo entre as marcas (sem elas, com LF) ou `null` sem as marcas. */
export function templateRegion(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(TEMPLATE_REGION_START);
  const end = lines.indexOf(TEMPLATE_REGION_END);
  if (start < 0 || end < start || lines.lastIndexOf(TEMPLATE_REGION_START) !== start) return null;
  return lines.slice(start + 1, end).join('\n');
}

/**
 * Troca o conteúdo entre as marcas por `region` (LF), sem tocar no resto e preservando o fim de linha do arquivo (CRLF
 * se ele usa CRLF). Recusa um arquivo sem as marcas.
 */
export function replaceTemplateRegion(text, region) {
  if (templateRegion(text) === null)
    throw new Error(
      `supabase/config.toml não tem as marcas da região dos modelos de e-mail. Acrescente, entre a tabela [auth.email.smtp] e a [auth.sms], as duas linhas:\n  ${TEMPLATE_REGION_START}\n  ${TEMPLATE_REGION_END}\ne rode npm run emails:build de novo.`,
    );
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(TEMPLATE_REGION_START);
  const end = lines.indexOf(TEMPLATE_REGION_END);
  const body = region ? region.replace(/\n$/, '').split('\n') : [];
  return [...lines.slice(0, start + 1), ...body, ...lines.slice(end)].join(eol);
}

// ---------------------------------------------------------------------------------------------------------
// Valores fixos (seção 4.1)

const R11 = 'docs/arquitetura/1.1.md, R11';
/**
 * Cada chave que o CLI enviaria com outro valor se faltasse, com o valor do CRM e o motivo. `range` aceita outro valor
 * na faixa (o limite de e-mails e as opções citadas nos e-mails, que o gerador acompanha); as demais são exatas.
 * `panel` é o campo correspondente no painel do Supabase, para a lista de "Aplicar no painel" do
 * supabase/templates/README.md, que o teste confere.
 */
export const AUTH_SETTINGS = Object.freeze([
  { key: 'api.enabled', value: true, reason: 'a API de dados do CRM' },
  { key: 'api.schemas', value: ['public', 'graphql_public'], reason: 'os esquemas que o CRM lê pela API' },
  { key: 'api.extra_search_path', value: ['public', 'extensions'], reason: 'o padrão do Supabase' },
  { key: 'api.max_rows', value: 1000, reason: 'o tamanho de página que as leituras paginadas do CRM supõem' },
  { key: 'storage.file_size_limit', value: '50MiB', reason: 'o limite do plano Free' },
  { key: 'auth.enabled', value: true, reason: 'o login do CRM' },
  { key: 'auth.jwt_expiry', value: 3600, reason: 'o padrão do Supabase' },
  { key: 'auth.enable_refresh_token_rotation', value: true, reason: 'o padrão do Supabase' },
  { key: 'auth.refresh_token_reuse_interval', value: 10, reason: 'o padrão do Supabase' },
  {
    key: 'auth.enable_signup',
    value: true,
    reason: 'o portão de convites está no banco; desligado, nem o primeiro Dono nem os convidados se cadastram',
    panel: ['Authentication → Sign In / Providers', 'Allow new users to sign up', 'ligado'],
  },
  {
    key: 'auth.enable_anonymous_sign_ins',
    value: false,
    reason: 'o login anônimo daria uma sessão sem e-mail (docs/arquitetura/1.1.md)',
    panel: ['Authentication → Sign In / Providers', 'Allow anonymous sign-ins', 'desligado'],
  },
  {
    key: 'auth.enable_manual_linking',
    value: false,
    reason: 'o CRM não junta identidades',
    panel: ['Authentication → Sign In / Providers', 'Allow manual linking', 'desligado'],
  },
  {
    key: 'auth.minimum_password_length',
    value: 6,
    reason: 'é o mínimo dos campos "Crie sua senha" e "Nova senha" do CRM',
    panel: ['Authentication → Sign In / Providers → Email', 'Minimum password length', '6'],
  },
  {
    key: 'auth.password_requirements',
    value: '',
    reason: 'o CRM não mostra regra de composição da senha',
    panel: ['Authentication → Sign In / Providers → Email', 'Password requirements', 'No required characters'],
  },
  {
    key: 'auth.rate_limit.email_sent',
    value: 100,
    range: [30, 1000],
    warnAbove: 300,
    reason: 'dimensionado para convites (docs/arquitetura/1.3.md, seção 4.5)',
    panel: ['Authentication → Rate Limits', 'Rate limit for sending emails', '100 por hora'],
  },
  { key: 'auth.rate_limit.sms_sent', value: 30, reason: 'o padrão do Supabase' },
  { key: 'auth.rate_limit.anonymous_users', value: 30, reason: 'o padrão do Supabase' },
  { key: 'auth.rate_limit.token_refresh', value: 150, reason: 'o padrão do Supabase' },
  { key: 'auth.rate_limit.sign_in_sign_ups', value: 30, reason: 'o padrão do Supabase' },
  { key: 'auth.rate_limit.token_verifications', value: 30, reason: 'o padrão do Supabase' },
  { key: 'auth.rate_limit.web3', value: 30, reason: 'o padrão do Supabase' },
  {
    key: 'auth.email.enable_signup',
    value: true,
    reason: 'o CRM entra por e-mail e senha',
    panel: ['Authentication → Sign In / Providers → Email', 'Enable Email provider', 'ligado'],
  },
  {
    key: 'auth.email.enable_confirmations',
    value: true,
    reason: `desligada, qualquer conta ainda não confirmada fica com quem pedir o cadastro com o e-mail dela (${R11})`,
    panel: ['Authentication → Sign In / Providers → Email', 'Confirm email', 'ligado, e nunca desligue'],
  },
  {
    key: 'auth.email.double_confirm_changes',
    value: true,
    reason: 'a troca de e-mail é confirmada nos dois endereços, como dizem os e-mails',
    panel: ['Authentication → Sign In / Providers → Email', 'Secure email change', 'ligado'],
  },
  {
    key: 'auth.email.secure_password_change',
    value: false,
    reason: 'ligada, a troca de senha com sessão de mais de 24 horas pede um código que o CRM não tem onde digitar',
    panel: ['Authentication → Sign In / Providers → Email', 'Secure password change', 'desligado'],
  },
  {
    key: 'auth.email.max_frequency',
    value: '60s',
    reason: 'o intervalo mínimo entre dois e-mails ao mesmo endereço; o padrão do CLI (1 s) enfraqueceria o projeto',
    // Achado 10 da revisão do item 1.3 (corrigido no item 1.13): o rótulo do painel deste campo não foi confirmado; fica
    // descrito em pt-BR e marcado até o ensaio do 1.4 conferir no painel.
    panel: [
      'Authentication → Rate Limits',
      'intervalo mínimo entre e-mails ao mesmo endereço',
      '60 segundos (rótulo a confirmar no ensaio do 1.4)',
    ],
  },
  {
    key: 'auth.email.otp_length',
    value: 8,
    range: [6, 10],
    reason: 'o tamanho do código citado nos e-mails (rode npm run emails:build depois de mudar)',
    panel: ['Authentication → Sign In / Providers → Email', 'Email OTP Length', '8'],
  },
  {
    key: 'auth.email.otp_expiry',
    value: 3600,
    range: [60, 86400],
    reason: 'a validade citada nos e-mails (rode npm run emails:build depois de mudar)',
    panel: ['Authentication → Sign In / Providers → Email', 'Email OTP Expiration', '3600 segundos'],
  },
  {
    key: 'auth.email.smtp.enabled',
    value: true,
    reason: 'sem SMTP próprio, o convidado não recebe a confirmação do cadastro',
    panel: ['Authentication → Emails → SMTP Settings', 'Enable Custom SMTP', 'ligado, com os dados do supabase/.env'],
  },
  {
    key: 'auth.sms.enable_signup',
    value: false,
    reason: 'o código do SMS valeria como prova do e-mail (docs/arquitetura/1.1.md)',
    panel: ['Authentication → Sign In / Providers → Phone', 'Enable Phone provider', 'desligado'],
  },
  { key: 'auth.sms.enable_confirmations', value: false, reason: 'o telefone fica desligado' },
  { key: 'auth.mfa.max_enrolled_factors', value: 10, reason: 'o padrão do Supabase' },
  {
    key: 'auth.mfa.totp.enroll_enabled',
    value: false,
    reason: 'o CRM não tem tela de verificação em duas etapas',
    panel: ['Authentication → Multi-Factor', 'TOTP (App Authenticator)', 'desligado'],
  },
  { key: 'auth.mfa.totp.verify_enabled', value: false, reason: 'o CRM não tem tela de verificação em duas etapas' },
  { key: 'auth.mfa.phone.enroll_enabled', value: false, reason: 'o CRM não tem tela de verificação em duas etapas' },
  { key: 'auth.mfa.phone.verify_enabled', value: false, reason: 'o CRM não tem tela de verificação em duas etapas' },
]);

// As chaves com env(): o que muda por instância (seção 4.2). `example` é o valor de supabase/.env.example.
export const ENV_VARIABLES = Object.freeze([
  { name: 'SUPABASE_AUTH_SITE_URL', key: 'auth.site_url', example: 'https://crm.suaempresa.com.br' },
  {
    name: 'SUPABASE_AUTH_REDIRECT_URL',
    key: 'auth.additional_redirect_urls',
    example: 'https://crm.suaempresa.com.br/**',
  },
  { name: 'SUPABASE_AUTH_SMTP_HOST', key: 'auth.email.smtp.host', example: 'smtp.seuprovedor.com' },
  { name: 'SUPABASE_AUTH_SMTP_PORT', key: 'auth.email.smtp.port', example: '587' },
  { name: 'SUPABASE_AUTH_SMTP_USER', key: 'auth.email.smtp.user', example: 'acesso@suaempresa.com.br' },
  { name: 'SUPABASE_AUTH_SMTP_PASS', key: 'auth.email.smtp.pass', example: 'cole-aqui-a-senha-do-smtp' },
  { name: 'SUPABASE_AUTH_SMTP_ADMIN_EMAIL', key: 'auth.email.smtp.admin_email', example: 'acesso@suaempresa.com.br' },
  { name: 'SUPABASE_AUTH_SMTP_SENDER_NAME', key: 'auth.email.smtp.sender_name', example: 'CRM Sua Empresa' },
]);
const ENV_NAMES = new Set(ENV_VARIABLES.map((variable) => variable.name));

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const formatValue = (value) => (typeof value === 'string' ? `"${value}"` : JSON.stringify(value).replace(/,/g, ', '));
const splitKey = (key) => {
  const parts = key.split('.');
  return { table: parts.slice(0, -1).join('.'), name: parts.at(-1) };
};
const describeKey = (key) => {
  const { table, name } = splitKey(key);
  return table ? `[${table}] ${name}` : name;
};

/** Todos os `env(NOME)` do arquivo, com a chave onde aparecem. */
export function envReferences(config, prefix = '') {
  const found = [];
  for (const [key, value] of Object.entries(config)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (isTable(value)) found.push(...envReferences(value, dotted));
    for (const item of Array.isArray(value) ? value : [value]) {
      const match = typeof item === 'string' ? item.match(/^env\((.*)\)$/) : null;
      if (match) found.push({ name: match[1], key: dotted });
    }
  }
  return found;
}

// Linhas da lista de campos do painel em supabase/templates/README.md ("Aplicar no painel"), na ordem da tabela.
export function panelChecklist() {
  return AUTH_SETTINGS.filter((setting) => setting.panel).map(({ key, value, panel: [where, field, shown] }) => {
    return `- ${where} → **${field}**: ${shown} (\`${describeKey(key)} = ${formatValue(value)}\`).`;
  });
}

/** Problemas do config.toml (valores fixos, faixas, env() e provedores), em pt-BR; `warnings` não reprovam. */
export function configProblems(config) {
  const problems = [];
  const warnings = [];
  for (const setting of AUTH_SETTINGS) {
    const actual = valueAt(config, setting.key);
    const label = `supabase/config.toml: ${describeKey(setting.key)}`;
    if (actual === undefined) {
      problems.push(
        `${label} está faltando; precisa ser ${formatValue(setting.value)} (${setting.reason}). Sem a chave, o "supabase config push" enviaria o padrão do CLI.`,
      );
      continue;
    }
    if (setting.range) {
      const [min, max] = setting.range;
      if (!Number.isInteger(actual) || actual < min || actual > max)
        problems.push(`${label} precisa ser um número inteiro de ${min} a ${max} (${setting.reason}).`);
      else if (setting.warnAbove && actual > setting.warnAbove)
        warnings.push(
          `${label} = ${actual} passa de ${setting.warnAbove}. Provedores de SMTP gratuitos costumam segurar de 100 a 500 e-mails por dia.`,
        );
      continue;
    }
    if (!sameValue(actual, setting.value))
      problems.push(`${label} precisa ser ${formatValue(setting.value)}. ${capitalize(setting.reason)}.`);
  }
  const expiry = valueAt(config, 'auth.email.otp_expiry');
  if (Number.isInteger(expiry) && expiry % 60 !== 0)
    problems.push(
      'supabase/config.toml: [auth.email] otp_expiry precisa ser um múltiplo de 60 (minutos inteiros), porque os e-mails dizem a validade em minutos e horas.',
    );
  for (const reference of envReferences(config)) {
    if (!ENV_NAMES.has(reference.name))
      problems.push(
        `supabase/config.toml usa env(${reference.name}) em ${describeKey(reference.key)}, que o CRM não conhece. Use só as variáveis de supabase/.env.example.`,
      );
  }
  for (const variable of ENV_VARIABLES) {
    const actual = valueAt(config, variable.key);
    const expected = `env(${variable.name})`;
    const ok = Array.isArray(actual) ? sameValue(actual, [expected]) : actual === expected;
    if (!ok)
      problems.push(
        `supabase/config.toml: ${describeKey(variable.key)} precisa ser ${variable.key.endsWith('urls') ? `["${expected}"]` : `"${expected}"`}, com o valor em supabase/.env.`,
      );
  }
  problems.push(...tableProblems(config));
  for (const [name, provider] of Object.entries(valueAt(config, 'auth.external') ?? {})) {
    if (isTable(provider) && provider.enabled === true)
      problems.push(
        `supabase/config.toml: [auth.external.${name}] está ligado. O CRM só aceita e-mail e senha: o login social não passa pela prova do e-mail nem pelo convite (docs/arquitetura/1.1.md).`,
      );
  }
  for (const [name, wallet] of Object.entries(valueAt(config, 'auth.web3') ?? {})) {
    if (isTable(wallet) && wallet.enabled === true)
      problems.push(`supabase/config.toml: [auth.web3.${name}] está ligado. O CRM só aceita e-mail e senha.`);
  }
  return { problems, warnings };
}

// As únicas tabelas que o config.toml pode ter (seção 4.3, lista de permissão): as do arquivo da base, mais os
// provedores desligados de [auth.external.*] e [auth.web3.*]. O CLI envia qualquer outra que o check não conhece, e um
// bloco [remotes.<nome>] com o project_id do projeto ligado é aplicado por cima do resto, depois da conferência.
const ALLOWED_TABLES = Object.freeze([
  'api',
  'storage',
  'auth',
  'auth.rate_limit',
  'auth.email',
  'auth.email.smtp',
  'auth.email.template',
  'auth.email.template.*',
  'auth.email.notification',
  'auth.email.notification.*',
  'auth.sms',
  'auth.mfa',
  'auth.mfa.totp',
  'auth.mfa.phone',
  'auth.external',
  'auth.external.*',
  'auth.web3',
  'auth.web3.*',
]);
// O motivo de cada tabela recusada que alguém tende a acrescentar; as demais recebem a mensagem geral.
const REFUSED_TABLE_REASONS = Object.freeze({
  remotes:
    'o Supabase CLI aplica esse bloco por cima do resto do arquivo quando o project_id dele é o do projeto ligado, e o que ele muda (a confirmação de e-mail, por exemplo) escaparia da conferência. Cada instância tem o próprio repositório e o próprio config.toml',
  'auth.hook': 'os hooks do Auth rodam uma função em cada login e cadastro, fora das regras do CRM',
  'auth.passkey': 'o CRM só aceita e-mail e senha',
  'auth.webauthn': 'o CRM só aceita e-mail e senha',
  'auth.oauth_server': 'o CRM não é servidor de login para outros sistemas',
  'auth.captcha': 'o CAPTCHA exige um campo que as telas de entrada do CRM não têm',
  // Achado 2 da revisão do item 1.3 (corrigido no item 1.13): Firebase, Auth0, Cognito, Clerk e WorkOS.
  'auth.third_party': 'provedores de terceiros dão sessão sem a prova do e-mail do CRM (docs/arquitetura/1.1.md)',
});

function allowedTable(dotted) {
  return ALLOWED_TABLES.some((pattern) =>
    pattern.endsWith('.*')
      ? dotted.startsWith(pattern.slice(0, -1)) && !dotted.slice(pattern.length - 1).includes('.')
      : pattern === dotted,
  );
}

/** Tabelas fora da lista de permissão e chaves soltas no topo, uma mensagem por tabela recusada (sem as de dentro). */
function tableProblems(config) {
  const problems = [];
  for (const [key, value] of Object.entries(config)) {
    if (!isTable(value) && key !== 'project_id')
      problems.push(
        `supabase/config.toml tem a chave ${key} no topo, fora das tabelas que o CRM confere. Tire a chave (docs/arquitetura/1.3.md, seção 4.3).`,
      );
  }
  const visit = (table, prefix) => {
    for (const [key, value] of Object.entries(table)) {
      if (!isTable(value)) continue;
      const dotted = prefix ? `${prefix}.${key}` : key;
      if (allowedTable(dotted)) {
        visit(value, dotted);
        continue;
      }
      const family = Object.keys(REFUSED_TABLE_REASONS).find(
        (name) => dotted === name || dotted.startsWith(`${name}.`),
      );
      const reason = family
        ? capitalize(REFUSED_TABLE_REASONS[family])
        : 'O CRM não usa essa tabela, e o "supabase config push" a enviaria ao projeto sem que o config:check a conferisse';
      // Cada bloco de [remotes] pelo nome, que é o que a pessoa procura no arquivo.
      const names = dotted === 'remotes' && Object.keys(value).length ? Object.keys(value) : [null];
      for (const name of names)
        problems.push(
          `supabase/config.toml tem [${name ? `remotes.${name}` : dotted}], que o config:check recusa. ${reason}. Tire a tabela (docs/arquitetura/1.3.md, seção 4.3).`,
        );
    }
  };
  visit(config, '');
  return problems;
}

// O CLI lê o config.toml pelo viper com o prefixo SUPABASE, o "." trocado por "_" e AutomaticEnv: a variável
// SUPABASE_AUTH_EMAIL_ENABLE_CONFIRMATIONS, no processo ou num .env que o CLI carrega, troca o valor de
// [auth.email] enable_confirmations depois de o check ler o arquivo. São recusadas as variáveis com o caminho de uma
// tabela que o push envia (api, db, auth, storage, experimental e remotes), menos as do CRM e a senha do banco, que o
// CLI não liga a chave nenhuma (`toml:"-"`). A SUPABASE_AUTH_SITE_URL coincide com [auth] site_url e tem o mesmo valor.
const CLI_OVERRIDE = /^SUPABASE_(API|DB|AUTH|STORAGE|EXPERIMENTAL|REMOTES)_/;
const CLI_UNBOUND = new Set(['SUPABASE_DB_PASSWORD']);

/** Se a variável trocaria uma chave do config.toml no Supabase CLI (o Windows não diferencia maiúsculas no nome). */
export function overridesConfigKey(name) {
  const upper = name.toUpperCase();
  return CLI_OVERRIDE.test(upper) && !ENV_NAMES.has(name) && !CLI_UNBOUND.has(upper);
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// ---------------------------------------------------------------------------------------------------------
// Variáveis (seção 4.2) e os arquivos .env, na ordem do CLI

/**
 * Lê um arquivo .env no formato do godotenv: NOME=valor, `export` opcional, aspas e comentários. Devolve também os
 * nomes cujo valor tem "$" fora de aspas simples (`dollar`): o godotenv do Supabase CLI expande `$NOME` e `${NOME}`
 * nos valores sem aspas e entre aspas duplas, e só as aspas simples deixam o texto literal. O CRM não reproduz a
 * expansão; o check recusa esses valores e pede aspas simples, para nunca aprovar um texto que o CLI enviaria trocado.
 * Pela mesma regra (achado 4 da revisão do item 1.3, corrigido no item 1.13), `ambiguous` lista os nomes cujo valor o
 * godotenv 1.5.1 lê de outro jeito: sem aspas e com "#" (ele corta o comentário no último " #", e não no primeiro) e
 * entre aspas duplas com "\" (ele pula \" ao procurar a aspa final e tira a barra de qualquer outra sequência). O check
 * recusa e pede aspas simples, em vez de imitar o godotenv.
 */
export function readDotenv(text) {
  const values = {};
  const dollar = new Set();
  const ambiguous = new Set();
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*[=:]\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    const quote = value[0];
    const quoted = (quote === '"' || quote === "'") && value.indexOf(quote, 1) > 0;
    if ((quoted && quote === '"' && value.includes('\\')) || (!quoted && value.includes('#'))) ambiguous.add(match[1]);
    else ambiguous.delete(match[1]);
    if (quoted) {
      value = value.slice(1, value.indexOf(quote, 1));
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\(["\\])/g, '$1');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[match[1]] = value;
    if (!(quoted && quote === "'") && value.includes('$')) dollar.add(match[1]);
    else dollar.delete(match[1]);
  }
  return { values, dollar, ambiguous };
}

/** Só os valores de `readDotenv`. */
export const parseDotenv = (text) => readDotenv(text).values;

/**
 * Os arquivos que o CLI lê, na ordem (`loadNestedEnv` e `loadDefaultEnv` do CLI 2.x): de supabase/ até a raiz do
 * repositório e, em cada pasta, .env.<ambiente>.local, .env.local (fora do ambiente "test"), .env.<ambiente> e .env. O
 * primeiro valor lido vence, e a variável do processo vence todos.
 */
export function envFileCandidates({ root = ROOT, supabaseEnv } = {}) {
  const environment = supabaseEnv || 'development';
  const names = [`.env.${environment}.local`, ...(environment === 'test' ? [] : ['.env.local'])];
  names.push(`.env.${environment}`, '.env');
  const folders = [path.join(root, 'supabase'), root];
  return folders.flatMap((folder) => names.map((name) => path.join(folder, name)));
}

/**
 * Os valores das variáveis do CRM e de onde veio cada um ("ambiente" ou o arquivo). `overrides` lista, com a origem,
 * toda variável lida que trocaria uma chave do config.toml no CLI (`overridesConfigKey`), em qualquer arquivo.
 */
export function loadAuthEnv({ root = ROOT, env = process.env, readFile = readFileSync, exists = existsSync } = {}) {
  const values = {};
  const sources = {};
  const filesRead = [];
  // Variáveis cujo valor vencedor tem "$" fora de aspas simples, com o arquivo (o CLI o expandiria).
  const dollar = [];
  // Variáveis cujo valor vencedor o godotenv leria de outro jeito ("#" sem aspas, "\" entre aspas duplas), com o arquivo.
  const ambiguous = [];
  const overrides = [];
  for (const name of ENV_NAMES) {
    if (env[name] !== undefined) {
      values[name] = env[name];
      sources[name] = 'ambiente';
    }
  }
  for (const name of Object.keys(env)) {
    if (overridesConfigKey(name)) overrides.push({ name, source: 'ambiente' });
  }
  for (const file of envFileCandidates({ root, supabaseEnv: env.SUPABASE_ENV })) {
    if (!exists(file)) continue;
    filesRead.push(file);
    const parsed = readDotenv(readFile(file, 'utf8'));
    for (const name of Object.keys(parsed.values)) {
      if (overridesConfigKey(name)) overrides.push({ name, source: display(file, root) });
    }
    for (const name of ENV_NAMES) {
      if (values[name] === undefined && parsed.values[name] !== undefined) {
        values[name] = parsed.values[name];
        sources[name] = display(file, root);
        if (parsed.dollar.has(name)) dollar.push({ name, file: sources[name] });
        if (parsed.ambiguous.has(name)) ambiguous.push({ name, file: sources[name] });
      }
    }
  }
  return { values, sources, filesRead, dollar, ambiguous, overrides };
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const HOST_NAME =
  /^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const EMAIL =
  /^[^\s@"<>(),;:\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const COMMON_SMTP_PORTS = [25, 465, 587, 2525];
const exampleOf = (name) => ENV_VARIABLES.find((variable) => variable.name === name).example;
const PASS_EXAMPLE = exampleOf('SUPABASE_AUTH_SMTP_PASS');
const SENDER_NAME_EXAMPLE = exampleOf('SUPABASE_AUTH_SMTP_SENDER_NAME');
const EXAMPLE_DOMAINS = ['suaempresa.com.br', 'seuprovedor.com'];
// O que pôr no lugar de cada valor de exemplo com domínio.
const EXAMPLE_HINTS = Object.freeze({
  SUPABASE_AUTH_SITE_URL: 'Use o endereço do CRM publicado.',
  SUPABASE_AUTH_REDIRECT_URL: 'Use o endereço do CRM publicado seguido de /**.',
  SUPABASE_AUTH_SMTP_HOST: 'Use o servidor SMTP do seu provedor.',
  SUPABASE_AUTH_SMTP_USER: 'Use o usuário do SMTP, que o provedor informa.',
  SUPABASE_AUTH_SMTP_ADMIN_EMAIL: 'Use o e-mail remetente da empresa.',
});

function siteUrlProblems(value, local) {
  const name = 'SUPABASE_AUTH_SITE_URL';
  let url;
  try {
    url = new URL(value);
  } catch {
    return [
      `${name} não é um endereço válido ("${value}"). Use o endereço do CRM publicado, como https://crm.suaempresa.com.br.`,
    ];
  }
  const problems = [];
  const isLocal = LOCAL_HOSTS.includes(url.hostname);
  if (local) {
    if (!(url.protocol === 'http:' || url.protocol === 'https:') || !isLocal)
      problems.push(
        `${name} precisa ser um endereço local (http://localhost:8080 ou http://127.0.0.1:8080) com --local, que só serve ao Supabase local.`,
      );
  } else {
    // Para um endereço local, a sugestão de https:// não ajuda: a mensagem de baixo diz o que fazer.
    if (url.protocol !== 'https:')
      problems.push(
        `${name} precisa começar com https:// ("${value}"). ${url.protocol === 'http:' && !isLocal ? `Use ${value.replace(/^http:/i, 'https:').replace(/\/+$/, '')}.` : ''}`.trim(),
      );
    if (isLocal)
      problems.push(
        `${name} aponta para este computador (${url.hostname}). O push grava o endereço do CRM publicado; para o Supabase local, use npm run config:check -- --local.`,
      );
  }
  // A origem sugerida já com https://, fora do modo local.
  const origin = local ? url.origin : url.origin.replace(/^http:/, 'https:');
  // O objeto URL põe o esquema e o host em minúsculas, mas o Auth compara a Site URL e a lista de retorno como texto, e
  // o CRM monta o retorno com window.location.origin, sempre em minúsculas: com uma maiúscula, o link do e-mail cairia
  // fora da lista e perderia o ?invite=.
  const authority = value.match(/^[^:/?#]+:\/\/[^/?#]*/)?.[0] ?? '';
  if (authority !== authority.toLowerCase())
    problems.push(
      `${name} precisa estar em letras minúsculas ("${value}"): o Supabase compara o endereço como texto, e o CRM volta dos e-mails com o endereço em minúsculas. Use ${origin}.`,
    );
  // Achado 3 da revisão do item 1.3 (corrigido no item 1.13): pela mesma razão, um domínio acentuado (o navegador usa a
  // forma xn--, que o objeto URL calcula) e o ponto no fim do domínio (que o navegador mantém e o endereço publicado não
  // tem) fariam o link do e-mail cair fora da lista.
  const rawHost = authority.replace(/^[^:]+:\/\//, '').replace(/^.*@/, '');
  if (/[^\x00-\x7F]/.test(rawHost))
    problems.push(
      `${name} tem acento ou outro caractere especial no domínio ("${value}"): o Supabase compara o endereço como texto, e o navegador mostra o domínio na forma ${url.hostname}. Use ${origin}.`,
    );
  if (url.hostname.endsWith('.'))
    problems.push(
      `${name} não pode terminar o domínio com ponto ("${value}"). Use ${origin.replace(`//${url.hostname}`, `//${url.hostname.replace(/\.+$/, '')}`)}.`,
    );
  if (url.username || url.password) problems.push(`${name} não pode ter usuário nem senha no endereço.`);
  if (url.search || url.hash || value.includes('?') || value.includes('#'))
    problems.push(`${name} não pode ter consulta (?) nem fragmento (#): use só a origem do CRM.`);
  else if (url.pathname !== '/' || value.endsWith('/'))
    problems.push(
      url.pathname === '/'
        ? `${name} não pode terminar com barra. Use ${origin}.`
        : `${name} não pode ter caminho ("${url.pathname}"): use só a origem do CRM, como ${origin}.`,
    );
  return problems;
}

/** Problemas e avisos das variáveis, todos de uma vez (seção 5.2). `brandName` é o productName da marca. */
export function envProblems(values, { local = false, brandName } = {}) {
  const problems = [];
  const warnings = [];
  const value = (name) => (values[name] ?? '').trim();
  for (const { name } of ENV_VARIABLES) {
    if (!value(name)) {
      problems.push(
        name === 'SUPABASE_AUTH_SITE_URL'
          ? `${name} está vazia. Sem ela, o Supabase gravaria o texto env(${name}) como endereço do CRM, e os links dos e-mails quebrariam.`
          : `${name} está vazia. Sem ela, o Supabase gravaria o texto env(${name}) no lugar do valor. Preencha em supabase/.env.`,
      );
    }
  }
  const site = value('SUPABASE_AUTH_SITE_URL');
  const siteProblems = site ? siteUrlProblems(site, local) : [];
  problems.push(...siteProblems);
  const redirect = value('SUPABASE_AUTH_REDIRECT_URL');
  if (site && redirect && !siteProblems.length && redirect !== `${site}/**`)
    problems.push(
      `SUPABASE_AUTH_REDIRECT_URL precisa ser ${site}/** (o endereço do CRM seguido de /**), para os links dos e-mails voltarem ao convite.`,
    );
  const host = value('SUPABASE_AUTH_SMTP_HOST');
  if (host && (/[:/@\s]/.test(host) || (!HOST_NAME.test(host) && !IPV4.test(host))))
    problems.push(
      `SUPABASE_AUTH_SMTP_HOST precisa ser só o nome do servidor, sem https://, porta ou barra (por exemplo, smtp.seuprovedor.com); está "${host}".`,
    );
  const port = value('SUPABASE_AUTH_SMTP_PORT');
  if (port) {
    const number = /^\d+$/.test(port) ? Number(port) : NaN;
    if (!Number.isInteger(number) || number < 1 || number > 65535)
      problems.push(
        `SUPABASE_AUTH_SMTP_PORT precisa ser um número de 1 a 65535 (em geral 587 ou 465); está "${port}".`,
      );
    else if (!COMMON_SMTP_PORTS.includes(number) && !(local && number === 54325))
      warnings.push(
        `SUPABASE_AUTH_SMTP_PORT = ${number} não é uma porta comum de SMTP (587, 465, 2525 ou 25). Confira com o provedor.`,
      );
  }
  if (!local && value('SUPABASE_AUTH_SMTP_PASS') === PASS_EXAMPLE)
    problems.push('SUPABASE_AUTH_SMTP_PASS ainda é o exemplo. Cole a senha do SMTP.');
  // Os domínios de supabase/.env.example são de terceiros e podem existir: o push gravaria a Site URL de outro site, e
  // os links e o logo dos e-mails apontariam para ele.
  if (!local) {
    for (const [name, hint] of Object.entries(EXAMPLE_HINTS)) {
      const domain = EXAMPLE_DOMAINS.find((candidate) => value(name).toLowerCase().includes(candidate));
      if (domain) problems.push(`${name} ainda usa o domínio de exemplo (${domain}). ${hint}`);
    }
  }
  const senderNameIsExample = !local && value('SUPABASE_AUTH_SMTP_SENDER_NAME') === SENDER_NAME_EXAMPLE;
  if (senderNameIsExample)
    problems.push(
      `SUPABASE_AUTH_SMTP_SENDER_NAME ainda é o exemplo ("${SENDER_NAME_EXAMPLE}"). Use o nome da empresa, como o productName de public/brand/brand.json.`,
    );
  const sender = value('SUPABASE_AUTH_SMTP_ADMIN_EMAIL');
  if (sender && !EMAIL.test(sender))
    problems.push(
      `SUPABASE_AUTH_SMTP_ADMIN_EMAIL precisa ser um e-mail válido, o remetente dos e-mails; está "${sender}".`,
    );
  const senderName = value('SUPABASE_AUTH_SMTP_SENDER_NAME');
  if (senderName.length > 64)
    problems.push(`SUPABASE_AUTH_SMTP_SENDER_NAME passa de 64 caracteres (${senderName.length}).`);
  else if (senderName && brandName && senderName !== brandName && !senderNameIsExample)
    warnings.push(
      `SUPABASE_AUTH_SMTP_SENDER_NAME ("${senderName}") é diferente do nome da marca ("${brandName}", em public/brand/brand.json). Tudo bem se for de propósito.`,
    );
  return { problems, warnings };
}

// ---------------------------------------------------------------------------------------------------------
// O check completo, o resumo e o push

export function linkedProjectRef({ file = PROJECT_REF_FILE, readFile = readFileSync, exists = existsSync } = {}) {
  if (!exists(file)) return null;
  const ref = readFile(file, 'utf8').trim();
  return ref || null;
}

/**
 * Tudo o que o `npm run config:check` confere: o config.toml (leitor, valores, env() e a região dos modelos, quando
 * `expectedRegion` vem do gerador), as variáveis e o projeto ligado (exigido só com `requireLink`). Devolve
 * `{ problems, warnings, summary }`, sem nunca incluir a senha do SMTP.
 */
export function checkInstanceConfig({
  root = ROOT,
  env = process.env,
  local = false,
  requireLink = false,
  expectedRegion,
  brandName,
  readFile = readFileSync,
  exists = existsSync,
} = {}) {
  const problems = [];
  const warnings = [];
  const configFile = path.join(root, 'supabase', 'config.toml');
  let config = null;
  let text = '';
  try {
    text = readFile(configFile, 'utf8');
    config = parseConfigToml(text);
  } catch (error) {
    problems.push(
      error instanceof ConfigTomlError
        ? `supabase/config.toml, ${error.message}. O leitor do CRM só aceita o formato do arquivo da base (docs/arquitetura/1.3.md, seção 4.7).`
        : `não foi possível ler supabase/config.toml (${error?.message ?? error}).`,
    );
  }
  if (config) {
    const result = configProblems(config);
    problems.push(...result.problems);
    warnings.push(...result.warnings);
    if (expectedRegion !== undefined) {
      const region = templateRegion(text);
      if (region === null)
        problems.push(
          `supabase/config.toml não tem as marcas da região dos modelos de e-mail ("${TEMPLATE_REGION_START}" e "${TEMPLATE_REGION_END}"). Acrescente as duas linhas depois de [auth.email.smtp] e rode npm run emails:build.`,
        );
      else if (region !== expectedRegion.replace(/\n$/, ''))
        problems.push('Os modelos de e-mail do config.toml estão defasados. Rode npm run emails:build.');
    }
  }
  // Nenhuma das variáveis em lugar nenhum: uma mensagem só, com o primeiro passo.
  const { values, sources, dollar, ambiguous, overrides } = loadAuthEnv({ root, env, readFile, exists });
  if (!Object.keys(values).length)
    problems.push(
      // O Bloco de Notas, com as extensões ocultas, grava "supabase/.env.txt", que o CLI não lê.
      exists(path.join(root, 'supabase', '.env.txt'))
        ? 'Falta o supabase/.env, mas existe supabase/.env.txt (o Bloco de Notas acrescentou ".txt"). Renomeie o arquivo para supabase/.env, com as extensões visíveis no Explorador de Arquivos.'
        : 'Falta o supabase/.env. Copie supabase/.env.example para supabase/.env e preencha o endereço do CRM e o SMTP.',
    );
  else {
    const result = envProblems(values, { local, brandName });
    problems.push(...result.problems);
    warnings.push(...result.warnings);
  }
  for (const { name, file } of dollar)
    problems.push(
      `${name}, em ${file}, tem "$" fora de aspas simples. O Supabase CLI troca "$NOME" e "\${NOME}" pelo valor de outra variável e enviaria outro texto. Escreva o valor entre aspas simples, como ${name}='...'.`,
    );
  for (const { name, file } of ambiguous)
    problems.push(
      `${name}, em ${file}, tem "#" sem aspas ou "\\" entre aspas duplas. O Supabase CLI lê esses valores de outro jeito (corta o comentário em outro lugar ou tira a barra) e enviaria outro texto. Escreva o valor entre aspas simples, como ${name}='...'.`,
    );
  for (const { name, source } of overrides)
    problems.push(
      `${name}, ${source === 'ambiente' ? 'definida no ambiente' : `em ${source}`}, trocaria uma chave do config.toml: o Supabase CLI lê cada chave também da variável SUPABASE_ com o mesmo caminho (SUPABASE_AUTH_EMAIL_ENABLE_CONFIRMATIONS vale como [auth.email] enable_confirmations), e o push enviaria um valor que o config:check não confere. Apague a variável; o CRM só usa as de supabase/.env.example.`,
    );
  // Fora do --local, um supabase/.env.local (ou outro .local) do Supabase local vence o supabase/.env, porque o CLI o
  // lê antes: o push enviaria os valores dele.
  if (!local) {
    const fromLocalFiles = new Map();
    for (const [name, source] of Object.entries(sources)) {
      if (source === 'ambiente' || !path.basename(source).endsWith('.local')) continue;
      fromLocalFiles.set(source, [...(fromLocalFiles.get(source) ?? []), name]);
    }
    for (const [file, names] of fromLocalFiles)
      problems.push(
        `${file} define ${names.join(', ')} e vence o supabase/.env, porque o Supabase CLI lê esse arquivo antes. Ele serve só ao Supabase local: apague ou renomeie ${file} antes do push.`,
      );
  }
  if (env.SUPABASE_ENV)
    warnings.push(
      `SUPABASE_ENV está definida ("${env.SUPABASE_ENV}"): o CLI procuraria supabase/.env.${env.SUPABASE_ENV} e outros arquivos. Apague a variável e use supabase/.env.`,
    );
  const projectRef = linkedProjectRef({ file: path.join(root, 'supabase', '.temp', 'project-ref'), readFile, exists });
  if (requireLink && !projectRef)
    problems.push(
      `Nenhum projeto Supabase ligado. Rode npx supabase@${SUPABASE_CLI_VERSION} link --project-ref <REF> antes.`,
    );
  const from = (name) => (sources[name] ? ` (${sources[name]})` : '');
  const summary = [
    `Projeto ligado: ${projectRef ?? `nenhum (rode npx supabase@${SUPABASE_CLI_VERSION} link --project-ref <REF> antes do push)`}`,
    `Site URL: ${values.SUPABASE_AUTH_SITE_URL ?? '(vazia)'}${from('SUPABASE_AUTH_SITE_URL')}`,
    `Retorno dos links: ${values.SUPABASE_AUTH_REDIRECT_URL ?? '(vazio)'}${from('SUPABASE_AUTH_REDIRECT_URL')}`,
    `SMTP: ${values.SUPABASE_AUTH_SMTP_HOST ?? '(vazio)'}:${values.SUPABASE_AUTH_SMTP_PORT ?? '?'}, usuário ${values.SUPABASE_AUTH_SMTP_USER ?? '(vazio)'}${from('SUPABASE_AUTH_SMTP_HOST')}; senha ${values.SUPABASE_AUTH_SMTP_PASS ? 'preenchida' : 'vazia'}`,
    `Remetente: ${values.SUPABASE_AUTH_SMTP_SENDER_NAME ?? '(vazio)'} <${values.SUPABASE_AUTH_SMTP_ADMIN_EMAIL ?? ''}>`,
    `Limite de e-mails: ${config ? valueAt(config, 'auth.rate_limit.email_sent') : '?'} por hora; confirmação de e-mail: ${config && valueAt(config, 'auth.email.enable_confirmations') === true ? 'ligada' : 'DESLIGADA'}`,
  ];
  return { problems, warnings, summary, projectRef };
}

/** O comando do push: o CLI fixado pelo npx, que mostra a diferença e pergunta antes de gravar cada serviço. */
export function pushCommand(platform = process.platform) {
  return {
    command: platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--yes', `supabase@${SUPABASE_CLI_VERSION}`, 'config', 'push'],
    options: { stdio: 'inherit', ...(platform === 'win32' ? { shell: true } : {}) },
  };
}

/**
 * `npm run config:push`: roda a conferência e, só sem problemas, chama o CLI. Devolve o código de saída (1 sem chamar o
 * CLI quando a conferência falha; o do CLI, quando chamado). `spawn` e `log` são trocados nos testes.
 */
export async function runConfigPush({
  check,
  spawn = nodeSpawn,
  platform = process.platform,
  cwd = ROOT,
  log = console.log,
  logError = console.error,
} = {}) {
  const result = check();
  if (result.problems.length) {
    logError(formatReport(result, { failed: true, push: true }));
    return 1;
  }
  log(formatReport(result, { failed: false, push: true }));
  const { command, args, options } = pushCommand(platform);
  log(`\nChamando ${command} ${args.join(' ')}: leia a diferença e responda a cada pergunta do CLI.`);
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, cwd });
    child.on('error', (error) => {
      logError(
        `Não foi possível chamar o Supabase CLI (${error.message}). Confira se o Node e o npx estão instalados.`,
      );
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

export function formatReport({ problems, warnings, summary }, { failed, push = false } = {}) {
  const lines = [];
  if (failed) {
    lines.push(`Configuração do Auth com ${problems.length} problema${problems.length === 1 ? '' : 's'}:`);
    for (const problem of problems) lines.push(`  - ${problem}`);
    lines.push(
      push
        ? '  Nada foi enviado ao Supabase. Corrija e rode npm run config:push de novo.'
        : '  Corrija e rode npm run config:check de novo.',
    );
  } else {
    lines.push('Configuração do Auth em dia:');
    for (const line of summary) lines.push(`  ${line}`);
  }
  for (const warning of warnings) lines.push(`Aviso: ${warning}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------
// GET /auth/v1/settings (para o verify-instance do item 1.4)

const NON_SOCIAL = new Set(['email', 'phone', 'anonymous_users']);

/**
 * Problemas da configuração pública do Auth de um projeto no ar (`GET /auth/v1/settings`), em pt-BR: a confirmação
 * desligada (`mailer_autoconfirm`), o cadastro desligado, o e-mail desligado e o telefone, o anônimo ou qualquer login
 * social ligados. O item 1.4 faz a leitura pela rede e chama esta regra.
 */
export function authSettingsProblems(settings) {
  const problems = [];
  if (!isTable(settings)) return ['a resposta de /auth/v1/settings não é um objeto JSON.'];
  if (settings.mailer_autoconfirm !== false)
    problems.push(
      `a confirmação de e-mail está desligada (mailer_autoconfirm). Ligue "Confirm email" já: desligada, qualquer conta ainda não confirmada fica com quem pedir o cadastro (${R11}).`,
    );
  if (settings.disable_signup !== false)
    problems.push(
      'o cadastro está desligado (disable_signup): nem o primeiro Dono nem os convidados conseguem entrar.',
    );
  const external = isTable(settings.external) ? settings.external : {};
  if (external.email !== true) problems.push('o login por e-mail está desligado (external.email).');
  if (external.phone === true) problems.push('o login por telefone está ligado (external.phone).');
  if (external.anonymous_users === true) problems.push('o login anônimo está ligado (external.anonymous_users).');
  const social = Object.entries(external)
    .filter(([name, enabled]) => !NON_SOCIAL.has(name) && enabled === true)
    .map(([name]) => name);
  if (social.length) problems.push(`login social ligado: ${social.join(', ')}. O CRM só aceita e-mail e senha.`);
  return problems;
}
