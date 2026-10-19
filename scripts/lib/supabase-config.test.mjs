// @vitest-environment node
// Configuração do Supabase Auth da instância (item 1.3; docs/arquitetura/1.3.md, seções 4, 5 e 9.1): o leitor restrito
// de TOML, o supabase/config.toml real contra a tabela da seção 4.1, as variáveis de supabase/.env e a ordem dos
// arquivos do CLI, as mensagens do config:check, o push guardado (com o spawn trocado) e a regra do verify-instance
// do item 1.4. Pastas temporárias, como os testes dos e-mails.
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAuthEmails, configTemplateRegion, readBrand as readEmailBrand } from './auth-emails.mjs';
import {
  AUTH_SETTINGS,
  CONFIG_FILE,
  ConfigTomlError,
  ENV_EXAMPLE_FILE,
  ENV_VARIABLES,
  ROOT,
  SUPABASE_CLI_VERSION,
  TEMPLATE_REGION_END,
  TEMPLATE_REGION_START,
  authSettingsProblems,
  checkInstanceConfig,
  configProblems,
  envFileCandidates,
  envProblems,
  envReferences,
  formatReport,
  loadAuthEnv,
  overridesConfigKey,
  panelChecklist,
  parseConfigToml,
  parseDotenv,
  pushCommand,
  readDotenv,
  readConfigToml,
  replaceTemplateRegion,
  runConfigPush,
  templateRegion,
  valueAt,
} from './supabase-config.mjs';

const temporaryDirs = [];
afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temporary = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-auth-config-'));
  temporaryDirs.push(dir);
  return dir;
};

const CONFIG_TEXT = readFileSync(CONFIG_FILE, 'utf8');
const config = readConfigToml();
const VALID_ENV = Object.freeze({
  SUPABASE_AUTH_SITE_URL: 'https://crm.acme.com.br',
  SUPABASE_AUTH_REDIRECT_URL: 'https://crm.acme.com.br/**',
  SUPABASE_AUTH_SMTP_HOST: 'smtp.acme.com.br',
  SUPABASE_AUTH_SMTP_PORT: '587',
  SUPABASE_AUTH_SMTP_USER: 'acesso@acme.com.br',
  SUPABASE_AUTH_SMTP_PASS: 'segredo-do-smtp',
  SUPABASE_AUTH_SMTP_ADMIN_EMAIL: 'acesso@acme.com.br',
  SUPABASE_AUTH_SMTP_SENDER_NAME: 'CRM Acme',
});
const dotenv = (values) =>
  `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
const expectedRegion = () => configTemplateRegion(buildAuthEmails(readEmailBrand()));

/** Um repositório falso com o config.toml real (ou outro texto) e os arquivos .env pedidos. */
function fakeRoot({ text = CONFIG_TEXT, files = {}, projectRef } = {}) {
  const root = temporary();
  mkdirSync(path.join(root, 'supabase', '.temp'), { recursive: true });
  writeFileSync(path.join(root, 'supabase', 'config.toml'), text, 'utf8');
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(root, name), content, 'utf8');
  if (projectRef) writeFileSync(path.join(root, 'supabase', '.temp', 'project-ref'), `${projectRef}\n`, 'utf8');
  return root;
}

describe('leitor de TOML restrito', () => {
  it('lê tabelas (com hífen), chaves, strings com escapes, literais, inteiros, booleanos, listas e comentários', () => {
    const parsed = parseConfigToml(
      [
        '# comentário',
        'project_id = "crm" # depois do valor',
        '[auth]',
        "site_url = 'C:\\sem\\escape'",
        'jwt_expiry = 3_600',
        'enable_signup = true',
        'additional_redirect_urls = ["a", \'b\', ]',
        'vazia = []',
        '[auth.email.template.recovery]',
        'subject = "Aspas \\"duplas\\", barra \\\\ e \\u00e7"',
        '[functions.fecha-ai-integration]',
        'verify_jwt = false',
        'import_map = "./functions/fecha-ai-integration/deno.json"',
      ].join('\r\n'),
    );
    expect(parsed).toEqual({
      project_id: 'crm',
      auth: {
        site_url: 'C:\\sem\\escape',
        jwt_expiry: 3600,
        enable_signup: true,
        additional_redirect_urls: ['a', 'b'],
        vazia: [],
        email: { template: { recovery: { subject: 'Aspas "duplas", barra \\ e ç' } } },
      },
      functions: {
        'fecha-ai-integration': { verify_jwt: false, import_map: './functions/fecha-ai-integration/deno.json' },
      },
    });
    expect(valueAt(parsed, 'auth.email.template.recovery.subject')).toContain('duplas');
    expect(valueAt(parsed, 'auth.nada.aqui')).toBeUndefined();
  });

  it.each([
    ['[a]\nx = { y = 1 }', 2, /tabelas em linha/],
    ['[[a]]\nx = 1', 1, /listas de tabelas/],
    ['x = """\ntexto\n"""', 1, /várias linhas/],
    ['x = "sem fim', 1, /aspa final/],
    ['x = 2026-10-19', 1, /datas/],
    ['x = 1.5', 1, /casas decimais/],
    ['[a]\nx = 1\n[a]', 3, /aparece duas vezes/],
    ['x = 1\nx = 2', 2, /aparece duas vezes/],
    ['a.b = 1', 1, /chaves com ponto/],
    ['x = [1, 2]', 1, /só podem ter textos/],
    ['x = ["a",\n"b"]', 1, /colchete final/],
    ['x = "a" "b"', 1, /texto inesperado/],
    ['x = "\\q"', 1, /escape inválido/],
    ['x = talvez', 1, /não reconhecido/],
    ['x', 1, /sem "="/],
    ['[a b]', 1, /nome de tabela inválido/],
    ['x = 1\nX = 2', 2, /a chave X tem letra maiúscula; use x/],
    ['[Auth.Email]\nx = 1', 1, /a tabela \[Auth\.Email\] tem letra maiúscula; use \[auth\.email\]/],
  ])('recusa %j na linha %i', (text, line, message) => {
    try {
      parseConfigToml(text);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigTomlError);
      expect(error.line).toBe(line);
      expect(error.message).toMatch(message);
    }
  });

  it('uma cópia de chave ou tabela com outra caixa nunca passa: o CLI não diferencia maiúsculas', () => {
    const twin = CONFIG_TEXT.replace(
      'enable_confirmations = true',
      'enable_confirmations = true\nENABLE_CONFIRMATIONS = false',
    );
    expect(() => parseConfigToml(twin)).toThrow(/ENABLE_CONFIRMATIONS tem letra maiúscula/);
    expect(() => parseConfigToml(`${CONFIG_TEXT}\n[Auth.Email]\nenable_confirmations = false\n`)).toThrow(/maiúscula/);
  });
});

describe('supabase/config.toml da base (AC-1 e AC-2)', () => {
  it.each(AUTH_SETTINGS.map((setting) => [setting.key, setting.value]))('%s = %j', (key, value) => {
    expect(valueAt(config, key)).toEqual(value);
  });

  it('a confirmação de e-mail está ligada, e telefone, anônimo, social e MFA desligados', () => {
    expect(config.auth.email.enable_confirmations).toBe(true);
    expect(config.auth.enable_anonymous_sign_ins).toBe(false);
    expect(config.auth.sms.enable_signup).toBe(false);
    expect(config.auth.mfa.totp.enroll_enabled).toBe(false);
    expect(config.auth.external).toBeUndefined();
    expect(configProblems(config)).toEqual({ problems: [], warnings: [] });
  });

  it('os únicos env() são as variáveis de supabase/.env.example, que tem todas e só elas, com marcadores', () => {
    const references = envReferences(config);
    expect(references.map((reference) => reference.name).sort()).toEqual(
      ENV_VARIABLES.map((variable) => variable.name).sort(),
    );
    for (const { name, key } of references)
      expect(ENV_VARIABLES.find((variable) => variable.name === name).key).toBe(key);
    const example = parseDotenv(readFileSync(ENV_EXAMPLE_FILE, 'utf8'));
    expect(example).toEqual(Object.fromEntries(ENV_VARIABLES.map((variable) => [variable.name, variable.example])));
    // Nenhum valor de verdade no exemplo: os domínios e a senha são marcadores.
    for (const value of Object.values(example))
      expect(value).toMatch(/suaempresa|seuprovedor|cole-aqui|Sua Empresa|^587$/);
  });

  it('o arquivo explica o push e diz para nunca rodar o CLI direto; a região é a do gerador', () => {
    expect(CONFIG_TEXT).toContain('NUNCA rode "npx supabase config push" direto.');
    expect(CONFIG_TEXT).toContain('npm run config:push');
    expect(templateRegion(CONFIG_TEXT)).toBe(expectedRegion());
    expect(CONFIG_TEXT).not.toContain('\r');
  });

  it('o .gitignore deixa supabase/.env fora do Git e o exemplo dentro; o .vercelignore exclui supabase/', () => {
    const ignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
    expect(readFileSync(path.join(ROOT, '.vercelignore'), 'utf8')).toMatch(/^supabase\/$/m);
  });

  it('a lista de campos do painel em supabase/templates/README.md é a da tabela', () => {
    const readme = readFileSync(path.join(ROOT, 'supabase', 'templates', 'README.md'), 'utf8');
    for (const line of panelChecklist()) expect(readme).toContain(line);
    expect(panelChecklist().join('\n')).toContain('**Confirm email**: ligado, e nunca desligue');
  });
});

describe('config:check: o arquivo alterado', () => {
  const edit = (from, to) => {
    expect(CONFIG_TEXT).toContain(from);
    return configProblems(parseConfigToml(CONFIG_TEXT.replace(from, to)));
  };

  it('recusa a confirmação desligada, com o motivo', () => {
    const { problems } = edit('enable_confirmations = true', 'enable_confirmations = false');
    expect(problems).toEqual([
      'supabase/config.toml: [auth.email] enable_confirmations precisa ser true. Desligada, qualquer conta ainda não confirmada fica com quem pedir o cadastro com o e-mail dela (docs/arquitetura/1.1.md, R11).',
    ]);
  });

  it('recusa uma chave que falta, porque o push enviaria o padrão do CLI', () => {
    const { problems } = edit('max_frequency = "60s"\n', '');
    expect(problems[0]).toMatch(/\[auth\.email\] max_frequency está faltando; precisa ser "60s"/);
    expect(problems[0]).toContain('o padrão do CLI');
  });

  it('acumula os problemas: anônimo, telefone, social, env() desconhecido e retorno sem env()', () => {
    let text = CONFIG_TEXT.replace('enable_anonymous_sign_ins = false', 'enable_anonymous_sign_ins = true')
      .replace(
        '[auth.sms]\n# Telefone desligado: o código do SMS valeria como prova do e-mail.\nenable_signup = false',
        '[auth.sms]\nenable_signup = true',
      )
      .replace(
        'additional_redirect_urls = ["env(SUPABASE_AUTH_REDIRECT_URL)"]',
        'additional_redirect_urls = ["https://x/**"]',
      )
      .replace('host = "env(SUPABASE_AUTH_SMTP_HOST)"', 'host = "env(SMTP_HOST)"');
    text += '\n[auth.external.google]\nenabled = true\nclient_id = "x"\n';
    const { problems } = configProblems(parseConfigToml(text));
    expect(problems).toHaveLength(6);
    expect(problems.join('\n')).toContain('enable_anonymous_sign_ins precisa ser false');
    expect(problems.join('\n')).toContain('[auth.sms] enable_signup precisa ser false');
    expect(problems.join('\n')).toContain('usa env(SMTP_HOST) em [auth.email.smtp] host, que o CRM não conhece');
    expect(problems.join('\n')).toContain('[auth.email.smtp] host precisa ser "env(SUPABASE_AUTH_SMTP_HOST)"');
    expect(problems.join('\n')).toContain('additional_redirect_urls precisa ser ["env(SUPABASE_AUTH_REDIRECT_URL)"]');
    expect(problems.join('\n')).toContain('[auth.external.google] está ligado');
  });

  it('só aceita as tabelas do arquivo da base: recusa [remotes.*], hooks, passkey, webauthn, oauth_server, captcha e [db] (revisão, rodada 2)', () => {
    const text = `${CONFIG_TEXT}
[remotes.prod]
project_id = "abcdefghijklmnopqrst"

[remotes.prod.auth.email]
enable_confirmations = false

[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/hook"

[auth.passkey]
enabled = false

[auth.webauthn]
rp_id = "x"

[auth.oauth_server]
enabled = false

[auth.captcha]
enabled = false

[auth.sms.twilio]
enabled = false

[db]
major_version = 17

[auth.external.github]
enabled = false

[auth.web3.ethereum]
enabled = true
`;
    const { problems } = configProblems(parseConfigToml(text));
    const tables = problems
      .map((problem) => problem.match(/^supabase\/config\.toml tem \[([^\]]+)\]/)?.[1])
      .filter(Boolean);
    expect(tables).toEqual([
      'auth.sms.twilio',
      'auth.hook',
      'auth.passkey',
      'auth.webauthn',
      'auth.oauth_server',
      'auth.captcha',
      'remotes.prod',
      'db',
    ]);
    expect(problems.join('\n')).toContain(
      '[remotes.prod], que o config:check recusa. O Supabase CLI aplica esse bloco',
    );
    expect(problems.join('\n')).toContain('[auth.web3.ethereum] está ligado');
    expect(problems.join('\n')).not.toContain('auth.external.github');
    expect(problems).toHaveLength(9);
    expect(configProblems(parseConfigToml(`project_id = "x"\nsolta = 1\n`)).problems).toContain(
      'supabase/config.toml tem a chave solta no topo, fora das tabelas que o CRM confere. Tire a chave (docs/arquitetura/1.3.md, seção 4.3).',
    );
  });

  it('aceita o limite de e-mails de 30 a 1000, avisa acima de 300 e recusa fora da faixa', () => {
    expect(edit('email_sent = 100', 'email_sent = 250')).toEqual({ problems: [], warnings: [] });
    expect(edit('email_sent = 100', 'email_sent = 500').warnings[0]).toMatch(/passa de 300/);
    expect(edit('email_sent = 100', 'email_sent = 2').problems[0]).toMatch(/de 30 a 1000/);
    expect(edit('otp_length = 8', 'otp_length = 6').problems).toEqual([]);
    expect(edit('otp_expiry = 3600', 'otp_expiry = 3630').problems[0]).toMatch(/múltiplo de 60/);
  });
});

describe('config:check: as variáveis', () => {
  const problems = (values, options) => envProblems({ ...VALID_ENV, ...values }, options).problems;

  it('aceita as variáveis válidas, sem problema nem aviso', () => {
    expect(envProblems(VALID_ENV)).toEqual({ problems: [], warnings: [] });
  });

  it('variável vazia diz o que o Supabase gravaria', () => {
    expect(problems({ SUPABASE_AUTH_SITE_URL: '' })[0]).toBe(
      'SUPABASE_AUTH_SITE_URL está vazia. Sem ela, o Supabase gravaria o texto env(SUPABASE_AUTH_SITE_URL) como endereço do CRM, e os links dos e-mails quebrariam.',
    );
    expect(problems({ SUPABASE_AUTH_SMTP_PASS: '   ' })[0]).toMatch(/SUPABASE_AUTH_SMTP_PASS está vazia/);
  });

  it.each([
    ['http://crm.acme.com.br', /precisa começar com https:\/\/.*Use https:\/\/crm\.acme\.com\.br\./],
    ['https://crm.acme.com.br/', /não pode terminar com barra\. Use https:\/\/crm\.acme\.com\.br\./],
    ['https://crm.acme.com.br/app', /não pode ter caminho \("\/app"\)/],
    ['https://crm.acme.com.br/?x=1', /consulta/],
    ['https://localhost:8080', /aponta para este computador/],
    ['https://127.0.0.1', /aponta para este computador/],
    ['https://[::1]', /aponta para este computador/],
    ['crm.acme.com.br', /não é um endereço válido/],
    [
      'https://CRM.acme.com.br',
      /letras minúsculas \("https:\/\/CRM\.acme\.com\.br"\).*Use https:\/\/crm\.acme\.com\.br\./,
    ],
    ['HTTPS://crm.acme.com.br', /letras minúsculas/],
  ])('Site URL %s', (value, message) => {
    expect(problems({ SUPABASE_AUTH_SITE_URL: value }).join('\n')).toMatch(message);
  });

  it('a Site URL local não sugere https://localhost: diz para usar o --local', () => {
    const text = problems({ SUPABASE_AUTH_SITE_URL: 'http://localhost:8080' }).join('\n');
    expect(text).toContain('SUPABASE_AUTH_SITE_URL precisa começar com https:// ("http://localhost:8080").');
    expect(text).not.toContain('Use https://localhost');
    expect(text).toContain('aponta para este computador');
  });

  it('recusa os valores de exemplo do supabase/.env.example, e não só a senha (revisão, rodada 1)', () => {
    const example = parseDotenv(readFileSync(ENV_EXAMPLE_FILE, 'utf8'));
    const result = envProblems({ ...example, SUPABASE_AUTH_SMTP_PASS: 'x1' }, { brandName: 'CRM Acme' });
    expect(result.problems).toEqual([
      'SUPABASE_AUTH_SITE_URL ainda usa o domínio de exemplo (suaempresa.com.br). Use o endereço do CRM publicado.',
      'SUPABASE_AUTH_REDIRECT_URL ainda usa o domínio de exemplo (suaempresa.com.br). Use o endereço do CRM publicado seguido de /**.',
      'SUPABASE_AUTH_SMTP_HOST ainda usa o domínio de exemplo (seuprovedor.com). Use o servidor SMTP do seu provedor.',
      'SUPABASE_AUTH_SMTP_USER ainda usa o domínio de exemplo (suaempresa.com.br). Use o usuário do SMTP, que o provedor informa.',
      'SUPABASE_AUTH_SMTP_ADMIN_EMAIL ainda usa o domínio de exemplo (suaempresa.com.br). Use o e-mail remetente da empresa.',
      'SUPABASE_AUTH_SMTP_SENDER_NAME ainda é o exemplo ("CRM Sua Empresa"). Use o nome da empresa, como o productName de public/brand/brand.json.',
    ]);
    expect(result.warnings).toEqual([]);
    // Com --local, o exemplo não importa: o Supabase local não envia e-mail de verdade.
    expect(problems({ SUPABASE_AUTH_SMTP_USER: 'acesso@suaempresa.com.br' })).toHaveLength(1);
  });

  it('o retorno precisa ser exatamente <SITE_URL>/**', () => {
    for (const redirect of ['https://crm.acme.com.br', 'https://crm.acme.com.br/*', 'https://outro.com.br/**'])
      expect(problems({ SUPABASE_AUTH_REDIRECT_URL: redirect })).toEqual([
        'SUPABASE_AUTH_REDIRECT_URL precisa ser https://crm.acme.com.br/** (o endereço do CRM seguido de /**), para os links dos e-mails voltarem ao convite.',
      ]);
  });

  it('SMTP: host sem esquema nem porta, porta de 1 a 65535, senha do exemplo, remetente e nome', () => {
    for (const host of ['https://smtp.acme.com', 'smtp.acme.com:587', 'smtp acme', 'smtp.acme.com/'])
      expect(problems({ SUPABASE_AUTH_SMTP_HOST: host })[0], host).toMatch(/só o nome do servidor/);
    expect(problems({ SUPABASE_AUTH_SMTP_HOST: '10.0.0.5' })).toEqual([]);
    for (const port of ['0', '65536', 'abc', '58 7'])
      expect(problems({ SUPABASE_AUTH_SMTP_PORT: port })[0], port).toMatch(/de 1 a 65535/);
    expect(envProblems({ ...VALID_ENV, SUPABASE_AUTH_SMTP_PORT: '2526' }).warnings[0]).toMatch(/não é uma porta comum/);
    expect(problems({ SUPABASE_AUTH_SMTP_PASS: 'cole-aqui-a-senha-do-smtp' })).toEqual([
      'SUPABASE_AUTH_SMTP_PASS ainda é o exemplo. Cole a senha do SMTP.',
    ]);
    expect(problems({ SUPABASE_AUTH_SMTP_ADMIN_EMAIL: 'acesso' })[0]).toMatch(/e-mail válido/);
    expect(problems({ SUPABASE_AUTH_SMTP_SENDER_NAME: 'x'.repeat(65) })[0]).toMatch(/64 caracteres/);
    expect(envProblems(VALID_ENV, { brandName: 'Acme · CRM' }).warnings[0]).toMatch(/diferente do nome da marca/);
  });

  it('--local aceita o Supabase local (localhost e o Mailpit) e recusa um endereço publicado', () => {
    const local = {
      ...VALID_ENV,
      SUPABASE_AUTH_SITE_URL: 'http://localhost:8080',
      SUPABASE_AUTH_REDIRECT_URL: 'http://localhost:8080/**',
      SUPABASE_AUTH_SMTP_HOST: '127.0.0.1',
      SUPABASE_AUTH_SMTP_PORT: '54325',
      SUPABASE_AUTH_SMTP_PASS: 'cole-aqui-a-senha-do-smtp',
    };
    expect(envProblems(local, { local: true })).toEqual({ problems: [], warnings: [] });
    expect(envProblems(local).problems.join('\n')).toMatch(/https:\/\//);
    expect(envProblems(VALID_ENV, { local: true }).problems[0]).toMatch(/endereço local/);
  });
});

describe('os arquivos .env, na ordem do Supabase CLI', () => {
  it('lê supabase/ antes da raiz e, em cada pasta, .env.development.local, .env.local, .env.development e .env', () => {
    const root = '/repo';
    const names = (supabaseEnv) =>
      envFileCandidates({ root, supabaseEnv }).map((file) => path.relative(root, file).split(path.sep).join('/'));
    expect(names()).toEqual([
      'supabase/.env.development.local',
      'supabase/.env.local',
      'supabase/.env.development',
      'supabase/.env',
      '.env.development.local',
      '.env.local',
      '.env.development',
      '.env',
    ]);
    // Com SUPABASE_ENV, o nome muda; no ambiente "test", sem o .env.local (loadDefaultEnv do CLI).
    expect(names('test').slice(0, 3)).toEqual(['supabase/.env.test.local', 'supabase/.env.test', 'supabase/.env']);
  });

  it('marca o "$" fora de aspas simples, que o godotenv do CLI expandiria (revisão, rodada 1)', () => {
    const { values, dollar } = readDotenv("A=abc$def9\nB=\"x$Y\"\nC='z$W'\nD=sem\nE='aberta$\n");
    expect(values).toMatchObject({ A: 'abc$def9', B: 'x$Y', C: 'z$W', D: 'sem' });
    expect([...dollar].sort()).toEqual(['A', 'B', 'E']);
  });

  it('o primeiro valor lido vence, a variável do processo vence todos, e cada valor diz a origem', () => {
    const root = fakeRoot({
      files: {
        'supabase/.env.local': dotenv({ SUPABASE_AUTH_SITE_URL: 'http://localhost:8080' }),
        'supabase/.env': dotenv(VALID_ENV),
        '.env': dotenv({ SUPABASE_AUTH_SMTP_USER: 'raiz@acme.com.br', OUTRA: 'x' }),
      },
    });
    const { values, sources } = loadAuthEnv({ root, env: { SUPABASE_AUTH_SMTP_HOST: 'smtp.processo.com' } });
    expect(values.SUPABASE_AUTH_SITE_URL).toBe('http://localhost:8080');
    expect(sources.SUPABASE_AUTH_SITE_URL).toBe('supabase/.env.local');
    expect(values.SUPABASE_AUTH_SMTP_HOST).toBe('smtp.processo.com');
    expect(sources.SUPABASE_AUTH_SMTP_HOST).toBe('ambiente');
    expect(values.SUPABASE_AUTH_SMTP_USER).toBe('acesso@acme.com.br');
    expect(values.OUTRA).toBeUndefined();
  });

  it('o leitor de .env entende export, aspas, comentários e o BOM', () => {
    expect(
      parseDotenv(
        '\uFEFF# nota\nexport A=1\nB = "com # dentro"\nC=\'simples\'\nD=valor # comentário\nE=\nlinha solta\n',
      ),
    ).toEqual({ A: '1', B: 'com # dentro', C: 'simples', D: 'valor', E: '' });
  });
});

describe('npm run config:check (AC-3)', () => {
  it('sem supabase/.env nem as variáveis, uma mensagem só, com o primeiro passo', () => {
    const result = checkInstanceConfig({ root: fakeRoot(), env: {}, expectedRegion: expectedRegion() });
    expect(result.problems).toEqual([
      'Falta o supabase/.env. Copie supabase/.env.example para supabase/.env e preencha o endereço do CRM e o SMTP.',
    ]);
  });

  it('com o Bloco de Notas tendo gravado supabase/.env.txt, diz para renomear', () => {
    const root = fakeRoot({ files: { 'supabase/.env.txt': dotenv(VALID_ENV) } });
    expect(checkInstanceConfig({ root, env: {} }).problems).toEqual([
      'Falta o supabase/.env, mas existe supabase/.env.txt (o Bloco de Notas acrescentou ".txt"). Renomeie o arquivo para supabase/.env, com as extensões visíveis no Explorador de Arquivos.',
    ]);
  });

  it('recusa a senha com "$" sem aspas simples e aceita entre aspas simples', () => {
    const files = (pass) => ({ 'supabase/.env': dotenv({ ...VALID_ENV, SUPABASE_AUTH_SMTP_PASS: pass }) });
    const refused = checkInstanceConfig({ root: fakeRoot({ files: files('abc$DEF9') }), env: {} });
    expect(refused.problems).toEqual([
      'SUPABASE_AUTH_SMTP_PASS, em supabase/.env, tem "$" fora de aspas simples. O Supabase CLI troca "$NOME" e "${NOME}" pelo valor de outra variável e enviaria outro texto. Escreva o valor entre aspas simples, como SUPABASE_AUTH_SMTP_PASS=\'...\'.',
    ]);
    expect(checkInstanceConfig({ root: fakeRoot({ files: files("'abc$DEF9'") }), env: {} }).problems).toEqual([]);
  });

  it('um supabase/.env.local do Supabase local vence o supabase/.env: o push é recusado até ele sair', () => {
    const local = {
      SUPABASE_AUTH_SITE_URL: 'http://localhost:8080',
      SUPABASE_AUTH_REDIRECT_URL: 'http://localhost:8080/**',
    };
    const root = fakeRoot({ files: { 'supabase/.env.local': dotenv(local), 'supabase/.env': dotenv(VALID_ENV) } });
    const result = checkInstanceConfig({ root, env: {} });
    expect(result.problems).toContain(
      'supabase/.env.local define SUPABASE_AUTH_SITE_URL, SUPABASE_AUTH_REDIRECT_URL e vence o supabase/.env, porque o Supabase CLI lê esse arquivo antes. Ele serve só ao Supabase local: apague ou renomeie supabase/.env.local antes do push.',
    );
    expect(result.problems.join('\n')).not.toContain('Use https://localhost');
    expect(checkInstanceConfig({ root, env: {}, local: true }).problems.join('\n')).not.toContain('apague ou renomeie');
  });

  it('recusa SUPABASE_<CAMINHO> do ambiente ou de qualquer .env, que o CLI leria no lugar da chave (revisão, rodada 2)', () => {
    const root = fakeRoot({
      files: {
        'supabase/.env': `${dotenv(VALID_ENV)}SUPABASE_AUTH_EMAIL_ENABLE_CONFIRMATIONS=false\nSUPABASE_DB_PASSWORD=x\nSUPABASE_URL=x\n`,
        '.env': dotenv({ supabase_auth_additional_redirect_urls: 'https://outro.com/**', SUPABASE_ACCESS_TOKEN: 'x' }),
      },
    });
    const result = checkInstanceConfig({
      root,
      env: { SUPABASE_STORAGE_FILE_SIZE_LIMIT: '5GiB', OUTRA: 'x' },
    });
    expect(result.problems).toHaveLength(3);
    expect(result.problems[0]).toBe(
      'SUPABASE_STORAGE_FILE_SIZE_LIMIT, definida no ambiente, trocaria uma chave do config.toml: o Supabase CLI lê cada chave também da variável SUPABASE_ com o mesmo caminho (SUPABASE_AUTH_EMAIL_ENABLE_CONFIRMATIONS vale como [auth.email] enable_confirmations), e o push enviaria um valor que o config:check não confere. Apague a variável; o CRM só usa as de supabase/.env.example.',
    );
    expect(result.problems[1]).toMatch(/^SUPABASE_AUTH_EMAIL_ENABLE_CONFIRMATIONS, em supabase\/\.env, trocaria/);
    expect(result.problems[2]).toMatch(/^supabase_auth_additional_redirect_urls, em \.env, trocaria/);
    expect(overridesConfigKey('SUPABASE_AUTH_SITE_URL')).toBe(false);
    expect(overridesConfigKey('SUPABASE_REMOTES_PROD_PROJECT_ID')).toBe(true);
    expect(overridesConfigKey('SUPABASE_EXPERIMENTAL_WEBHOOKS_ENABLED')).toBe(true);
  });

  it('a sonda da revisão (rodada 2): [remotes.*] e SUPABASE_AUTH_EMAIL_ENABLE_CONFIRMATIONS reprovam o push', () => {
    const text = `${CONFIG_TEXT}\n[remotes.prod]\nproject_id = "abcdefghijklmnopqrst"\n\n[remotes.prod.auth.email]\nenable_confirmations = false\n`;
    const root = fakeRoot({
      text,
      files: { 'supabase/.env': `${dotenv(VALID_ENV)}SUPABASE_AUTH_EMAIL_ENABLE_CONFIRMATIONS=false\n` },
      projectRef: 'abcdefghijklmnopqrst',
    });
    const result = checkInstanceConfig({ root, env: {}, requireLink: true });
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toMatch(/^supabase\/config\.toml tem \[remotes\.prod\]/);
    expect(result.problems[1]).toMatch(/^SUPABASE_AUTH_EMAIL_ENABLE_CONFIRMATIONS, em supabase\/\.env/);
  });

  it('com um supabase/.env válido, passa e mostra o resumo sem a senha', () => {
    const root = fakeRoot({ files: { 'supabase/.env': dotenv(VALID_ENV) }, projectRef: 'abcdefghijklmnopqrst' });
    const result = checkInstanceConfig({ root, env: {}, expectedRegion: expectedRegion(), requireLink: true });
    expect(result.problems).toEqual([]);
    const report = formatReport(result, { failed: false });
    expect(report).toContain('Projeto ligado: abcdefghijklmnopqrst');
    expect(report).toContain('Site URL: https://crm.acme.com.br (supabase/.env)');
    expect(report).toContain('Limite de e-mails: 100 por hora; confirmação de e-mail: ligada');
    expect(report).toContain('senha preenchida');
    expect(report).not.toContain(VALID_ENV.SUPABASE_AUTH_SMTP_PASS);
  });

  it('lista todos os problemas: arquivo, variáveis, região defasada, SUPABASE_ENV e projeto ligado', () => {
    const text = CONFIG_TEXT.replace('enable_confirmations = true', 'enable_confirmations = false').replace(
      'subject = "Redefina sua senha',
      'subject = "Redefina a senha',
    );
    const root = fakeRoot({ text, files: { 'supabase/.env': dotenv({ ...VALID_ENV, SUPABASE_AUTH_SMTP_PORT: '' }) } });
    const result = checkInstanceConfig({
      root,
      env: { SUPABASE_ENV: 'staging' },
      expectedRegion: expectedRegion(),
      requireLink: true,
    });
    expect(result.problems).toHaveLength(4);
    expect(result.problems.join('\n')).toContain('enable_confirmations precisa ser true');
    expect(result.problems).toContain(
      'Os modelos de e-mail do config.toml estão defasados. Rode npm run emails:build.',
    );
    expect(result.problems.join('\n')).toContain('SUPABASE_AUTH_SMTP_PORT está vazia');
    expect(result.problems).toContain(
      'Nenhum projeto Supabase ligado. Rode npx supabase link --project-ref <REF> antes.',
    );
    expect(result.warnings[0]).toMatch(/SUPABASE_ENV está definida/);
    expect(formatReport(result, { failed: true })).toMatch(/^Configuração do Auth com 4 problemas:/);
  });

  it('um config.toml que o leitor não entende é recusado com a linha, sem validar pela metade', () => {
    const root = fakeRoot({ text: '[auth]\nsite_url = { x = 1 }\n', files: { 'supabase/.env': dotenv(VALID_ENV) } });
    const result = checkInstanceConfig({ root, env: {} });
    expect(result.problems[0]).toMatch(/^supabase\/config\.toml, linha 2: tabelas em linha/);
  });

  it('sem as marcas da região, diz onde colocá-las', () => {
    const text = CONFIG_TEXT.replace(`${TEMPLATE_REGION_START}\n`, '');
    const root = fakeRoot({ text, files: { 'supabase/.env': dotenv(VALID_ENV) } });
    const result = checkInstanceConfig({ root, env: {}, expectedRegion: expectedRegion() });
    expect(result.problems.join('\n')).toContain('não tem as marcas da região dos modelos de e-mail');
  });
});

describe('a região dos modelos no config.toml', () => {
  it('troca só o que está entre as marcas e preserva o fim de linha', () => {
    const text = `a = 1\r\n${TEMPLATE_REGION_START}\r\nvelho\r\n${TEMPLATE_REGION_END}\r\nb = 2\r\n`;
    const replaced = replaceTemplateRegion(text, '[x]\ny = 1');
    expect(replaced).toBe(`a = 1\r\n${TEMPLATE_REGION_START}\r\n[x]\r\ny = 1\r\n${TEMPLATE_REGION_END}\r\nb = 2\r\n`);
    expect(templateRegion(replaced)).toBe('[x]\ny = 1');
    expect(() => replaceTemplateRegion('a = 1\n', 'x')).toThrow(/não tem as marcas/);
  });
});

describe('npm run config:push (AC-4)', () => {
  const ok = () => ({ problems: [], warnings: [], summary: ['Projeto ligado: abc'] });
  function fakeSpawn(code = 0) {
    const calls = [];
    const spawn = (command, args, options) => {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', code));
      return child;
    };
    return { spawn, calls };
  }
  const quiet = { log: () => {}, logError: () => {} };

  it('com a conferência reprovada, não chama o CLI e sai com 1', async () => {
    const { spawn, calls } = fakeSpawn();
    const errors = [];
    const code = await runConfigPush({
      check: () => ({ problems: ['SUPABASE_AUTH_SITE_URL está vazia.'], warnings: [], summary: [] }),
      spawn,
      log: () => {},
      logError: (text) => errors.push(text),
    });
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(errors[0]).toContain('Nada foi enviado ao Supabase.');
  });

  it('com a conferência aprovada, chama o CLI fixado com stdio herdado e repassa o código de saída', async () => {
    const { spawn, calls } = fakeSpawn(3);
    const code = await runConfigPush({ check: ok, spawn, platform: 'linux', cwd: '/repo', ...quiet });
    expect(code).toBe(3);
    expect(calls).toEqual([
      {
        command: 'npx',
        args: ['--yes', `supabase@${SUPABASE_CLI_VERSION}`, 'config', 'push'],
        options: { stdio: 'inherit', cwd: '/repo' },
      },
    ]);
  });

  it('no Windows, chama o npx.cmd com shell', async () => {
    const { spawn, calls } = fakeSpawn(0);
    expect(await runConfigPush({ check: ok, spawn, platform: 'win32', ...quiet })).toBe(0);
    expect(calls[0].command).toBe('npx.cmd');
    expect(calls[0].options).toMatchObject({ stdio: 'inherit', shell: true });
    expect(pushCommand('darwin').options.shell).toBeUndefined();
  });

  it('a versão do CLI é fixa e exata', () => {
    expect(SUPABASE_CLI_VERSION).toMatch(/^2\.\d+\.\d+$/);
  });

  it('o CLI que não abre vira mensagem e código 1', async () => {
    const errors = [];
    const spawn = () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('error', new Error('ENOENT')));
      return child;
    };
    const code = await runConfigPush({ check: ok, spawn, log: () => {}, logError: (text) => errors.push(text) });
    expect(code).toBe(1);
    expect(errors[0]).toMatch(/Não foi possível chamar o Supabase CLI/);
  });
});

describe('GET /auth/v1/settings (regra do verify-instance do item 1.4)', () => {
  const healthy = {
    disable_signup: false,
    mailer_autoconfirm: false,
    phone_autoconfirm: false,
    external: { email: true, phone: false, anonymous_users: false, google: false, github: false },
  };

  it('aprova o projeto configurado pelo config.toml', () => {
    expect(authSettingsProblems(healthy)).toEqual([]);
  });

  it('reprova a confirmação desligada, o cadastro desligado e cada login que o CRM não aceita', () => {
    expect(authSettingsProblems({ ...healthy, mailer_autoconfirm: true })[0]).toMatch(
      /confirmação de e-mail está desligada/,
    );
    expect(authSettingsProblems({ ...healthy, disable_signup: true })[0]).toMatch(/cadastro está desligado/);
    const external = (flags) => authSettingsProblems({ ...healthy, external: { ...healthy.external, ...flags } });
    expect(external({ email: false })[0]).toMatch(/e-mail está desligado/);
    expect(external({ phone: true })[0]).toMatch(/telefone está ligado/);
    expect(external({ anonymous_users: true })[0]).toMatch(/anônimo está ligado/);
    expect(external({ google: true, github: true })[0]).toBe(
      'login social ligado: google, github. O CRM só aceita e-mail e senha.',
    );
    expect(authSettingsProblems(null)).toHaveLength(1);
    // Sem o campo, a resposta mudou de formato: reprova em vez de aprovar sem conferir.
    const { mailer_autoconfirm: _omitted, ...withoutField } = healthy;
    expect(authSettingsProblems(withoutField)[0]).toMatch(/mailer_autoconfirm/);
  });
});
