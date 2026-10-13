// Modelos de e-mail do Supabase Auth do CRM, gerados a partir da marca em supabase/templates/brand.json.
// Um layout comum (a anatomia dos e-mails do DS Empreende.IA V2: fundo claro fixo, 600 px, tabelas de
// apresentação, estilos inline, faixa escura com título, cartão branco com borda, CTA sólido e preheader)
// recebe o conteúdo de cada modelo. Quem usa é `scripts/build-auth-emails.mjs` (npm run emails:build,
// emails:check e emails:preview) e o teste `auth-emails.test.mjs`.
//
// Restrições do Supabase (o corpo é um html/template do Go):
// - os placeholders `{{ .ConfirmationURL }}`, `{{ .Token }}` etc. saem literais; os valores da marca são
//   escapados para HTML e não podem conter `{{` nem `}}`, que o Go leria como ação de template;
// - o Go remove comentários HTML, então o layout não usa `<!--[if mso]>` nem VML;
// - nenhum recurso remoto além do logo (`logoUrl`): sem fontes externas, rastreadores ou scripts. Um logo com
//   caminho do frontend ("/brand/eia-email.png") vira `{{ .SiteURL }}/brand/eia-email.png`, que o Supabase
//   completa com a Site URL do projeto no envio.
//
// O markup fica em templates com a tag `markup` (e não `html`) de propósito: o Prettier formataria um template
// com a tag `html` e mudaria o HTML gerado.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Pasta publicada na raiz do frontend: um logo "/brand/x.png" precisa existir em public/brand/x.png.
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const TEMPLATES_DIR = path.join(ROOT, 'supabase', 'templates');
export const BRAND_FILE = path.join(TEMPLATES_DIR, 'brand.json');
export const PREVIEW_NAME = 'preview.html';
export const PREVIEW_FILE = path.join(TEMPLATES_DIR, PREVIEW_NAME);

// Cores do tema claro do DS V2 (`styles/eia-light.css`) e dos modelos de e-mail V2 (`public/emails-v2/`).
// E-mail não aceita `var(--eia-*)`: os valores ficam em hex literal.
export const COLORS = Object.freeze({
  canvas: '#f4f7f5', // --eia-color-bg
  surface: '#ffffff', // --eia-color-surface
  text: '#10251a', // --eia-color-text
  muted: '#405d4c', // --eia-color-text-muted
  subtle: '#546f5f', // --eia-color-text-subtle
  accent: '#0fa968', // --eia-color-accent (marca; nunca texto no tema claro)
  accentText: '#08643e', // --eia-color-accent-text
  action: '#08643e', // CTA dos e-mails V2
  actionBorder: '#075534', // borda do CTA dos e-mails V2
  onAction: '#ffffff', // --eia-color-on-accent
  line: '#d5dfd8', // borda do cartão dos e-mails V2
  codeBg: '#eaf1ed', // --eia-color-code-bg
  codeText: '#254b37', // --eia-color-code-text
  band: '#10251a', // faixa escura dos e-mails V2 (início do degradê)
  bandEnd: '#254b37', // fim do degradê da faixa
  bandBorder: '#466b55', // borda da faixa
  bandLabel: '#c9ebd7', // --eia-color-selection: rótulo sobre a faixa
  onBand: '#ffffff',
});

const FONT = 'Manrope,Arial,Helvetica,sans-serif';
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,'Courier New',monospace";
// Largura do e-mail no desktop e no Outlook (atributo width). Os demais clientes reduzem até 320 px.
export const EMAIL_WIDTH = 600;
// Área útil do cartão numa tela de 320 px sem media queries: 320 − 2 × 12 (margem) − 2 × 28 (respiro do
// cartão) − 2 × 1 (borda do cartão).
export const NARROW_CONTENT_WIDTH = 238;

// ---------------------------------------------------------------------------------------------------------
// Marca

// Valores usados quando o campo falta no brand.json (o brand.json versionado preenche todos). Sem logoUrl, o
// topo mostra o nome em texto, para uma marca nova nunca herdar o logo do programa por omissão.
export const BRAND_DEFAULTS = Object.freeze({
  tagline: '',
  supportEmail: '',
  logoUrl: '',
  logoWidth: 185,
  linkExpiry: '',
  codeLength: 6,
  secureEmailChange: true,
  showBaseCredit: true,
});

const BRAND_FIELDS = {
  productName: { kind: 'text', required: true, max: 60 },
  shortName: { kind: 'text', required: true, max: 40 },
  tagline: { kind: 'text', max: 120 },
  supportEmail: { kind: 'email' },
  logoUrl: { kind: 'logo' },
  logoWidth: { kind: 'int', min: 40, max: 300 },
  linkExpiry: { kind: 'text', max: 40 },
  codeLength: { kind: 'int', min: 6, max: 10 },
  secureEmailChange: { kind: 'boolean' },
  showBaseCredit: { kind: 'boolean' },
};

export class BrandError extends Error {
  constructor(problems) {
    super(`brand.json inválido:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'BrandError';
    this.problems = problems;
  }
}

// Confere a marca e devolve uma cópia com os padrões aplicados. Chaves que começam com "_" são comentários.
export function normalizeBrand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BrandError(['o arquivo precisa ser um objeto JSON, como { "productName": "…" }']);
  const problems = [];
  const brand = { ...BRAND_DEFAULTS };
  for (const key of Object.keys(input)) {
    if (!key.startsWith('_') && !(key in BRAND_FIELDS))
      problems.push(
        `"${key}" não é um campo conhecido (confira a grafia; campos: ${Object.keys(BRAND_FIELDS).join(', ')})`,
      );
  }
  for (const [key, rule] of Object.entries(BRAND_FIELDS)) {
    const value = input[key];
    if (value === undefined) {
      if (rule.required) problems.push(`"${key}" é obrigatório`);
      continue;
    }
    const problem = checkField(key, rule, value);
    if (problem) problems.push(problem);
    else brand[key] = typeof value === 'string' ? value.trim() : value;
  }
  if (!problems.length && usesProgramLogo(brand) && !isProgramBrand(brand))
    problems.push(
      `"logoUrl" aponta para ${PROGRAM_LOGO}, o logo da Empreende.IA, mas a marca é outra. Publique o logo da empresa (por exemplo, em public/brand/logo-email.png) e use "/brand/logo-email.png", ou "" para mostrar o nome em texto`,
    );
  if (problems.length) throw new BrandError(problems);
  return brand;
}

// Logo para e-mail do programa (public/brand/eia-email.png): só vale com a marca do programa.
export const PROGRAM_LOGO = 'eia-email.png';
const usesProgramLogo = (brand) =>
  new RegExp(`(^|/)${PROGRAM_LOGO.replace('.', '\\.')}($|[?#])`, 'i').test(brand.logoUrl);

// "/brand/logo-email.png": caminho no frontend publicado, completado com a Site URL no envio.
const LOGO_PATH_PATTERN = /^\/[A-Za-z0-9_-][A-Za-z0-9._~-]*(\/[A-Za-z0-9_-][A-Za-z0-9._~-]*)*\.(png|jpe?g|gif)$/i;
export const isLogoPath = (value) => LOGO_PATH_PATTERN.test(value) && !value.split('/').includes('..');

const EMAIL_PATTERN = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]+$/;

function checkField(key, rule, value) {
  if (rule.kind === 'boolean') return typeof value === 'boolean' ? null : `"${key}" precisa ser true ou false`;
  if (rule.kind === 'int') {
    if (!Number.isInteger(value) || value < rule.min || value > rule.max)
      return `"${key}" precisa ser um número inteiro de ${rule.min} a ${rule.max}`;
    return null;
  }
  if (typeof value !== 'string') return `"${key}" precisa ser um texto entre aspas`;
  const content = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(content)) return `"${key}" não pode ter quebras de linha nem caracteres de controle`;
  if (/\{\{|\}\}/.test(content)) return `"${key}" não pode conter {{ nem }}, que o Supabase leria como variável`;
  if (rule.required && !content) return `"${key}" não pode ficar vazio`;
  if (rule.max && content.length > rule.max) return `"${key}" passa de ${rule.max} caracteres`;
  if (rule.kind === 'email' && content && !EMAIL_PATTERN.test(content))
    return `"${key}" precisa ser um e-mail, como suporte@suaempresa.com.br, ou "" para não mostrar`;
  if (rule.kind === 'logo' && content && !isLogoPath(content) && !isHttpsUrl(content))
    return `"${key}" precisa ser o caminho de uma imagem PNG, JPG ou GIF do frontend publicado, como "/brand/logo-email.png", um endereço https:// completo ou "" para mostrar o nome em texto`;
  return null;
}

function isHttpsUrl(value) {
  if (/[\s"'<>`\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

// Lê e confere o brand.json. Um logo com caminho do frontend precisa existir em public/, que o build publica.
export function readBrand(file = BRAND_FILE, publicDir = PUBLIC_DIR) {
  const brand = parseBrandFile(file);
  if (isLogoPath(brand.logoUrl) && !existsSync(path.join(publicDir, ...brand.logoUrl.split('/').filter(Boolean))))
    throw new BrandError([
      `"logoUrl" é "${brand.logoUrl}", mas public${brand.logoUrl} não existe. Coloque a imagem nesse caminho, corrija o campo ou use "" para mostrar o nome em texto`,
    ]);
  return brand;
}

function parseBrandFile(file) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch (error) {
    throw new BrandError([`não foi possível ler ${path.relative(ROOT, file)}: ${error?.message ?? error}`]);
  }
  let data;
  try {
    data = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new BrandError([`o arquivo não é um JSON válido (${error.message}). Confira vírgulas e aspas.`]);
  }
  return normalizeBrand(data);
}

// A marca já é a do programa? Então o crédito "Feito com Empreende.IA" repetiria a marca e fica de fora (D3).
export function isProgramBrand(brand) {
  const compact = `${brand.productName} ${brand.shortName}`.toLowerCase().replace(/[^a-z]/g, '');
  return compact.includes('empreendeia');
}

export const showsBaseCredit = (brand) => brand.showBaseCredit && !isProgramBrand(brand);

// Caixa do código: cabe numa tela de 320 px mesmo sem media queries, com a fonte monoespaçada mais larga da
// pilha (avanço de 0,6 em, como a Courier New) e o espaçamento entre os dígitos.
export function codeBoxMetrics(codeLength) {
  const border = 2;
  const padding = 12;
  const fontSize = Math.min(34, Math.floor((NARROW_CONTENT_WIDTH - border - 2 * padding) / (0.8 * codeLength + 0.2)));
  const letterSpacing = Math.round(fontSize * 0.2);
  const width = codeLength * (0.6 * fontSize + letterSpacing) + letterSpacing + 2 * padding + border;
  return { fontSize, letterSpacing, lineHeight: Math.round(fontSize * 1.25), padding, width };
}

// ---------------------------------------------------------------------------------------------------------
// Markup seguro: valores interpolados são escapados, a menos que venham de raw() (markup do próprio gerador).

class SafeMarkup {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const raw = (value) => new SafeMarkup(String(value));

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toMarkup(value) {
  if (value instanceof SafeMarkup) return value.value;
  if (Array.isArray(value)) return value.map(toMarkup).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

function markup(strings, ...values) {
  let out = strings[0];
  values.forEach((value, index) => {
    out += toMarkup(value) + strings[index + 1];
  });
  return raw(out);
}

// Placeholder do Supabase, mantido literal no arquivo gerado.
const variable = (name) => raw(`{{ .${name} }}`);
const V = {
  ConfirmationURL: variable('ConfirmationURL'),
  SiteURL: variable('SiteURL'),
  Token: variable('Token'),
  Email: variable('Email'),
  NewEmail: variable('NewEmail'),
  OldEmail: variable('OldEmail'),
};

// Tipografia repetida em cada elemento com texto: o Outlook não herda a fonte do body.
const type = (size, lineHeight, color, extra = '') =>
  raw(
    `font-family:${FONT};font-size:${size}px;line-height:${lineHeight}px;color:${color};mso-line-height-rule:exactly;${extra}`,
  );

const lines = (parts) => parts.filter(Boolean).map((part) => markup`${part}\n`);

// ---------------------------------------------------------------------------------------------------------
// Blocos do corpo

const paragraph = (content) => markup`<p style="margin:0 0 16px 0;${type(15, 26, COLORS.muted)}">${content}</p>`;

const strong = (content) => markup`<strong style="font-weight:700;color:${COLORS.text};">${content}</strong>`;

// E-mail em destaque dentro de um mailto com estilo próprio, para o Gmail não o transformar em link azul.
const address = (placeholder) =>
  markup`<a href="mailto:${placeholder}" style="color:${COLORS.text};text-decoration:none;font-weight:600;word-break:break-all;">${placeholder}</a>`;

// Espaço depois de um bloco em tabela, porque o Outlook ignora margin em tabelas.
const spaced = (
  content,
  bottom = 24,
) => markup`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr>
<td style="padding:0 0 ${raw(bottom ? `${bottom}px` : '0')} 0;">
${content}
</td>
</tr>
</table>`;

// Linhas de detalhe (rótulo e valor). Os valores são endereços de e-mail, então o rótulo fica numa linha e o
// valor na de baixo já no HTML inline: sem depender do <style>, um endereço só quebra se passar da largura
// inteira do cartão, mesmo a 320 px.
function details(rows) {
  const items = rows.map(
    ([label, value]) => markup`<tr>
<td class="eia-row-label" style="padding:12px 0 2px 0;${type(13, 20, COLORS.muted)}">${label}</td>
</tr>
<tr>
<td class="eia-row-value" style="padding:0 0 12px 0;border-bottom:1px solid ${COLORS.line};${type(14, 20, COLORS.text, 'font-weight:600;word-break:break-all;overflow-wrap:anywhere;')}">${value}</td>
</tr>`,
  );
  return spaced(markup`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid ${COLORS.line};table-layout:fixed;">
${lines(items)}</table>`);
}

const button = (label) =>
  spaced(markup`<table role="presentation" class="eia-cta-table" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center" bgcolor="${COLORS.action}" style="background-color:${COLORS.action};border:1px solid ${COLORS.actionBorder};border-radius:12px;mso-padding-alt:14px 22px;">
<a class="eia-cta" href="${V.ConfirmationURL}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 22px;${type(14, 20, COLORS.onAction, 'font-weight:600;text-decoration:none;border-radius:12px;mso-padding-alt:0;')}">${label}&nbsp;&rarr;</a>
</td>
</tr>
</table>`);

const linkFallback = () =>
  spaced(markup`<p style="margin:0 0 6px 0;${type(13, 20, COLORS.subtle)}">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;">
<tr>
<td style="${type(13, 20, COLORS.accentText, 'word-break:break-all;overflow-wrap:anywhere;')}"><a href="${V.ConfirmationURL}" target="_blank" rel="noopener" style="color:${COLORS.accentText};text-decoration:underline;word-break:break-all;">${V.ConfirmationURL}</a></td>
</tr>
</table>`);

// Caixa de orientação; é sempre o último bloco do cartão.
const note = (content) =>
  spaced(
    markup`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;">
<tr>
<td bgcolor="${COLORS.canvas}" style="background-color:${COLORS.canvas};border:1px solid ${COLORS.line};border-radius:12px;padding:14px 16px;${type(13, 20, COLORS.muted)}">${content}</td>
</tr>
</table>`,
    0,
  );

function codeBox(codeLength) {
  const box = codeBoxMetrics(codeLength);
  return spaced(markup`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;table-layout:fixed;">
<tr>
<td align="center" bgcolor="${COLORS.codeBg}" style="background-color:${COLORS.codeBg};border:1px solid ${COLORS.line};border-radius:12px;padding:18px ${box.padding}px 18px ${box.padding + box.letterSpacing}px;font-family:${raw(MONO)};font-size:${box.fontSize}px;line-height:${box.lineHeight}px;font-weight:700;letter-spacing:${box.letterSpacing}px;color:${COLORS.codeText};white-space:nowrap;mso-line-height-rule:exactly;">${V.Token}</td>
</tr>
</table>`);
}

// "o link vale por 1 hora" (ou "expira em breve", sem linkExpiry) "e só pode ser usado uma vez".
const validity = (brand, subject, tail) => {
  const lasts = brand.linkExpiry ? `vale por ${brand.linkExpiry}` : 'expira em breve';
  return markup`${strong('Validade:')} ${subject} ${lasts} e só pode ser usado uma vez.${tail ? ` ${tail}` : ''}`;
};

// Link para o e-mail de suporte da marca. O endereço vem do brand.json e pode ser longo e sem hífen: sem a
// quebra em qualquer ponto, ele alargaria o e-mail inteiro além de uma tela de 320 px.
const supportLink = (brand, color) =>
  markup`<a href="mailto:${brand.supportEmail}" style="color:${color};text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${brand.supportEmail}</a>`;

const adminContact = (brand, start) => {
  const verb = start ? 'Avise' : 'avise';
  if (!brand.supportEmail) return `${verb} quem administra o CRM da sua empresa`;
  return markup`${verb} quem administra o CRM da sua empresa ou escreva para ${supportLink(brand, COLORS.accentText)}`;
};

// ---------------------------------------------------------------------------------------------------------
// Os oito modelos. `config` é a chave do config.toml; `panel`, o nome do modelo no painel do Supabase. O
// `title` é o <h1> e, como nos e-mails do DS, termina com pontuação; o assunto não.

const LOGIN = 'na tela de entrada';
// Botão da tela de entrada e da tela de quem entra sem equipe para colar o link do convite
// (src/components/workspace/ReceivedInvite.tsx, usado por Login.tsx e WorkspaceSetup.tsx; conferido no teste).
export const RECEIVED_INVITE = 'Recebi um convite';
// Com a empresa criada (item 1.1), conta nova só nasce para um e-mail com convite do CRM.
const INVITE_ONLY = 'Com a empresa criada, o CRM só aceita conta nova de um e-mail com convite pendente da equipe.';

export const AUTH_EMAILS = Object.freeze([
  {
    id: 'confirmation',
    group: 'template',
    config: 'confirmation',
    panel: 'Confirm sign up',
    label: 'Confirmação de e-mail',
    eyebrow: 'Confirmação de e-mail',
    when: `Primeiro acesso de um e-mail sem conta, com a confirmação de e-mail ligada: cadastro pela aba “Cadastrar” ou pedido pela aba “Link por e-mail” da tela de entrada. Um novo pedido de link para uma conta ainda não confirmada reenvia esta confirmação. ${INVITE_ONLY}`,
    subject: (brand) => `Confirme seu e-mail · ${brand.shortName}`,
    preheader: 'Falta um passo para ativar seu acesso.',
    title: 'Confirme seu e-mail.',
    body: (brand) => [
      paragraph(
        'Este endereço foi usado para criar uma conta ou entrar no CRM pela primeira vez. Confirme que ele é seu para ativar o acesso.',
      ),
      details([['Conta', address(V.Email)]]),
      button('Confirmar e-mail'),
      paragraph('Depois da confirmação, o CRM abre com você já conectado.'),
      linkFallback(),
      // Um novo cadastro com o mesmo e-mail reenviaria a confirmação, mas o Supabase não grava a senha nova de uma
      // conta não confirmada; o pedido em “Link por e-mail” reenvia a confirmação sem trocar nada.
      note(validity(brand, 'o link', `Se ele expirar, peça outro em “Link por e-mail”, ${LOGIN}.`)),
    ],
    reason:
      'Você recebeu este e-mail porque este endereço foi usado para criar uma conta ou entrar no CRM pela primeira vez.',
    ifNotYou: 'Se não foi você, ignore este e-mail: o acesso só é ativado com a confirmação.',
  },
  {
    id: 'invite',
    group: 'template',
    config: 'invite',
    panel: 'Invite user',
    label: 'Conta criada pelo painel',
    // Não "Convite": o texto pede o link de convite do CRM, e a pessoa ficaria com dois "convites".
    eyebrow: 'Ativação de conta',
    when: `Convite enviado pelo painel do Supabase (Authentication → Users → Add user → Send invitation). Ele cria a conta, mas não coloca a pessoa na equipe: os convites da equipe são feitos no CRM (Equipe → Convidar uma pessoa → Criar convite), com o link de convite (<SUA_URL>/?invite=…, em “Copiar link”) e sem este e-mail. ${INVITE_ONLY} Por isso, o painel só cria a conta de quem já tem convite no CRM.`,
    subject: (brand) => `Ative sua conta · ${brand.shortName}`,
    preheader: 'Quem administra o CRM criou uma conta para você.',
    title: 'Ative sua conta.',
    body: (brand) => [
      paragraph('Quem administra o CRM criou uma conta para este endereço. Ative a conta pelo botão abaixo.'),
      details([['Conta', address(V.Email)]]),
      // Antes do botão, porque ativar a conta não coloca a pessoa na equipe; o nome do botão é o das telas do CRM
      // (src/components/workspace/ReceivedInvite.tsx, conferido no teste).
      paragraph(
        markup`${strong('Importante:')} depois de ativar, abra o link de convite do CRM que quem administra enviou: é ele que coloca você na equipe. Se o CRM pedir um convite, use “${RECEIVED_INVITE}” e cole o link.`,
      ),
      button('Ativar conta'),
      // Desde a revisão do item 1.1, o aceite do convite pede a senha da conta (WorkspaceSetup).
      paragraph(
        `Ao aceitar o convite da equipe, o CRM pede uma senha para a conta. Nas próximas vezes, entre com ela ou por “Link por e-mail”, ${LOGIN}.`,
      ),
      linkFallback(),
      note(validity(brand, 'o link', 'Se ele expirar, peça um novo a quem criou a sua conta.')),
    ],
    reason: 'Você recebeu este e-mail porque quem administra o CRM criou uma conta para este endereço.',
    ifNotYou: 'Se você não esperava este e-mail, ignore-o: a conta só é ativada com o seu clique.',
  },
  {
    id: 'magic_link',
    group: 'template',
    config: 'magic_link',
    panel: 'Magic link',
    label: 'Link de acesso',
    eyebrow: 'Link por e-mail',
    when: `Acesso sem senha pela aba “Link por e-mail” da tela de entrada, para quem já tem conta (um e-mail sem conta recebe a confirmação de cadastro). ${INVITE_ONLY} Sem convite, o pedido de um e-mail sem conta é recusado.`,
    subject: (brand) => `Seu link de acesso · ${brand.shortName}`,
    preheader: 'Entre no CRM sem digitar a senha.',
    title: 'Seu link de acesso.',
    body: (brand) => [
      paragraph('Use o botão abaixo para entrar no CRM sem digitar a senha.'),
      details([['Conta', address(V.Email)]]),
      button('Acessar minha conta'),
      linkFallback(),
      note(validity(brand, 'o link', `Se ele expirar, peça outro em “Link por e-mail”, ${LOGIN}.`)),
    ],
    reason: 'Você recebeu este e-mail porque alguém pediu um link de acesso para este endereço.',
    ifNotYou: 'Se não foi você, ignore este e-mail: nada muda na sua conta.',
  },
  {
    id: 'email_change',
    group: 'template',
    config: 'email_change',
    panel: 'Change email address',
    label: 'Troca de e-mail',
    eyebrow: 'Troca de e-mail',
    when: 'Pedido de troca do e-mail de acesso feito pela própria pessoa (updateUser com email). O CRM não tem tela para isso hoje, então este e-mail não sai; o modelo fica pronto para quando houver. Com “Secure email change” ligado, vai para o endereço atual e para o novo, cada um com o próprio link.',
    subject: (brand) => `Confirme a troca de e-mail · ${brand.shortName}`,
    preheader: 'O novo endereço só passa a valer depois da confirmação.',
    title: 'Confirme a troca de e-mail.',
    body: (brand) => [
      paragraph('Recebemos um pedido para trocar o e-mail de acesso desta conta:'),
      details([
        ['E-mail atual', address(V.Email)],
        ['Novo e-mail', address(V.NewEmail)],
      ]),
      paragraph(
        brand.secureEmailChange
          ? 'Por segurança, esta confirmação foi enviada aos dois endereços. A troca só vale depois que o link for aberto nos dois.'
          : 'A troca só vale depois que você confirmar pelo botão abaixo.',
      ),
      button('Confirmar troca de e-mail'),
      linkFallback(),
      note(validity(brand, 'o link', 'Se ele expirar, faça o pedido de novo.')),
    ],
    reason:
      'Você recebeu este e-mail porque este endereço aparece num pedido de troca do e-mail de acesso de uma conta.',
    ifNotYou:
      'Se não foi você, não confirme: o e-mail de acesso continua o mesmo. Se a conta é sua, redefina a senha, porque só quem está conectado consegue fazer esse pedido.',
  },
  {
    id: 'recovery',
    group: 'template',
    config: 'recovery',
    panel: 'Reset password',
    label: 'Redefinição de senha',
    eyebrow: 'Redefinição de senha',
    when: 'Botão “Esqueceu a senha?” da tela de entrada. O link abre /reset-password, em que a pessoa escolhe a senha nova.',
    subject: (brand) => `Redefina sua senha · ${brand.shortName}`,
    preheader: 'O link abre a página para escolher uma senha nova.',
    title: 'Crie uma senha nova.',
    body: (brand) => [
      paragraph('Recebemos um pedido para redefinir a senha desta conta:'),
      details([['Conta', address(V.Email)]]),
      paragraph('O botão abre a página em que você escolhe a senha nova.'),
      button('Redefinir senha'),
      linkFallback(),
      note(validity(brand, 'o link', `Se ele expirar, peça outro em “Esqueceu a senha?”, ${LOGIN}.`)),
    ],
    reason: 'Você recebeu este e-mail porque foi pedida a redefinição da senha da conta ligada a este endereço.',
    ifNotYou:
      'Se não foi você, ignore este e-mail: sua senha atual continua valendo. Nunca responda a um e-mail com a sua senha.',
  },
  {
    id: 'reauthentication',
    group: 'template',
    config: 'reauthentication',
    panel: 'Reauthentication',
    label: 'Código de verificação',
    eyebrow: 'Verificação de segurança',
    when: 'Só quando o app chama reauthenticate() para confirmar uma alteração sensível. O CRM não faz essa chamada nem tem campo para o código, então este e-mail não sai hoje; o modelo fica pronto para quando houver.',
    subject: (brand) => `Seu código de verificação · ${brand.shortName}`,
    preheader: 'Use o código para confirmar que é você.',
    title: 'Seu código de verificação.',
    body: (brand) => [
      paragraph('Use este código para confirmar uma alteração de segurança na sua conta:'),
      codeBox(brand.codeLength),
      note(validity(brand, 'o código', 'Não compartilhe: ninguém da equipe vai pedir este código.')),
    ],
    reason: 'Você recebeu este e-mail porque alguém conectado à sua conta pediu uma alteração de segurança.',
    ifNotYou: `Se não foi você, não use o código e redefina sua senha em “Esqueceu a senha?”, ${LOGIN}.`,
  },
  {
    id: 'password_changed_notification',
    group: 'notification',
    config: 'password_changed',
    panel: 'Password changed',
    label: 'Aviso de senha alterada',
    eyebrow: 'Aviso de segurança',
    when: 'Depois que a pessoa troca a própria senha, como em /reset-password. Só é enviado com a notificação ligada.',
    subject: (brand) => `Sua senha foi alterada · ${brand.shortName}`,
    preheader: 'Se foi você, não precisa fazer nada.',
    title: 'Sua senha foi alterada.',
    body: (brand) => [
      paragraph('A senha da conta abaixo acabou de ser alterada:'),
      details([['Conta', address(V.Email)]]),
      paragraph('Se foi você, está tudo certo e não precisa fazer nada.'),
      note(
        markup`${strong('Não foi você?')} Redefina a senha agora em “Esqueceu a senha?”, ${LOGIN}, e ${adminContact(brand, false)}.`,
      ),
    ],
    reason: 'Você recebeu este aviso porque a senha da conta ligada a este endereço foi alterada.',
    ifNotYou: 'Este é um aviso automático: não é preciso responder.',
  },
  {
    id: 'email_changed_notification',
    group: 'notification',
    config: 'email_changed',
    panel: 'Email address changed',
    label: 'Aviso de e-mail alterado',
    eyebrow: 'Aviso de segurança',
    when: 'Depois que uma troca de e-mail pedida pela própria pessoa é confirmada. Como o CRM não tem tela de troca de e-mail, não sai hoje. Só é enviado com a notificação ligada.',
    subject: (brand) => `Seu e-mail de acesso mudou · ${brand.shortName}`,
    preheader: 'Confira se a troca foi feita por você.',
    title: 'Seu e-mail de acesso mudou.',
    body: (brand) => [
      paragraph('O e-mail usado para entrar na sua conta foi trocado:'),
      details([
        ['Antes', address(V.OldEmail)],
        ['Agora', address(V.Email)],
      ]),
      paragraph('Se foi você, está tudo certo. Daqui em diante, entre com o novo endereço.'),
      note(
        markup`${strong('Não foi você?')} Quem fez a troca tinha acesso à sua conta. ${adminContact(brand, true)} o quanto antes.`,
      ),
    ],
    reason: 'Você recebeu este aviso porque o e-mail de acesso de uma conta que usava este endereço foi alterado.',
    ifNotYou: 'Este é um aviso automático: não é preciso responder.',
  },
]);

// ---------------------------------------------------------------------------------------------------------
// Layout comum

// Caracteres invisíveis depois do preheader, para o cliente não completar a prévia com o texto do corpo.
const PREHEADER_FILLER = '&#847;&zwnj;&nbsp;'.repeat(60);
const HIDDEN =
  'display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;';

const STYLE = `<style>
body { margin: 0 !important; padding: 0 !important; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
:root { color-scheme: light only; supported-color-schemes: light only; }
table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
@media only screen and (max-width: 620px) {
.eia-outer { padding: 16px 8px !important; }
.eia-brand { padding: 8px 4px 20px 4px !important; }
.eia-band { padding: 28px 20px !important; }
.eia-card { padding: 28px 20px !important; }
.eia-foot { padding: 20px 4px 8px 4px !important; }
.eia-h1 { font-size: 26px !important; line-height: 31px !important; }
.eia-cta-table { width: 100% !important; }
.eia-cta { display: block !important; text-align: center !important; }
}
</style>`;

// Endereço do logo no e-mail: um caminho do frontend é completado pela Site URL do projeto no envio.
export const logoSource = (brand) => (isLogoPath(brand.logoUrl) ? markup`${V.SiteURL}${brand.logoUrl}` : brand.logoUrl);

function brandHeader(brand) {
  // Com as imagens bloqueadas, o cliente mostra o texto alternativo com o estilo do <img>.
  const nameStyle = type(16, 24, COLORS.text, 'font-weight:600;');
  if (brand.logoUrl)
    return markup`<img src="${logoSource(brand)}" width="${brand.logoWidth}" alt="${brand.productName}" style="display:block;border:0;outline:none;text-decoration:none;width:${brand.logoWidth}px;max-width:100%;height:auto;${nameStyle}">`;
  // Sem logo, o nome do produto em texto simples, sem imitar o desenho do wordmark (o DS proíbe recriá-lo em texto).
  return markup`<p style="margin:0;${nameStyle}">${brand.productName}</p>`;
}

// Rótulo da faixa com o ponto esmeralda: o acento pontual da marca, decorativo. Peso 600 e 12 px, como o
// .eyebrow do DS (o eyebrow dos e-mails V2 tem 11 px, abaixo do mínimo de 12 px do DESIGN.md).
const bandLabel = (label) => markup`<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td valign="middle" style="padding:0 10px 0 0;">
<table role="presentation" aria-hidden="true" cellpadding="0" cellspacing="0" border="0">
<tr>
<td width="8" height="8" bgcolor="${COLORS.accent}" style="width:8px;height:8px;background-color:${COLORS.accent};border-radius:2px;font-size:1px;line-height:1px;mso-line-height-rule:exactly;">&nbsp;</td>
</tr>
</table>
</td>
<td valign="middle" style="${type(12, 16, COLORS.bandLabel, 'font-weight:600;letter-spacing:1px;')}">${label.toLocaleUpperCase('pt-BR')}</td>
</tr>
</table>`;

function footer(brand, email) {
  const line = (content, top = 0) =>
    markup`<p style="margin:${raw(top ? `${top}px` : '0')} 0 8px 0;${type(12, 20, COLORS.subtle)}">${content}</p>`;
  const signature = brand.tagline
    ? markup`<strong style="font-weight:700;color:${COLORS.muted};">${brand.productName}</strong><br>${brand.tagline}`
    : markup`<strong style="font-weight:700;color:${COLORS.muted};">${brand.productName}</strong>`;
  return lines([
    line(email.reason),
    line(email.ifNotYou),
    brand.supportEmail && line(markup`Precisa de ajuda? Escreva para ${supportLink(brand, COLORS.muted)}.`),
    line(signature, 8),
    showsBaseCredit(brand) && line('Feito com Empreende.IA'),
  ]);
}

export function renderEmail(email, brand) {
  const subject = email.subject(brand);
  const document = markup`<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${subject}</title>
${raw(STYLE)}
</head>
<body style="margin:0;padding:0;width:100%;background-color:${COLORS.canvas};">
<div role="article" aria-roledescription="email" aria-label="${subject}" lang="pt-BR" style="background-color:${COLORS.canvas};">
<div style="${raw(HIDDEN)}color:${COLORS.canvas};">${email.preheader}</div>
<div style="${raw(HIDDEN)}color:${COLORS.canvas};">${raw(PREHEADER_FILLER)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.canvas}" style="width:100%;background-color:${COLORS.canvas};table-layout:fixed;">
<tr>
<td class="eia-outer" align="center" style="padding:28px 12px;">
<table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" align="center" style="width:${EMAIL_WIDTH}px;max-width:100%;">
<tr>
<td class="eia-brand" style="padding:16px 8px 28px 8px;">
${brandHeader(brand)}
</td>
</tr>
<tr>
<td class="eia-band" bgcolor="${COLORS.band}" style="background-color:${COLORS.band};background-image:linear-gradient(135deg,${COLORS.band},${COLORS.bandEnd});border:1px solid ${COLORS.bandBorder};border-bottom:0;border-radius:24px 24px 0 0;padding:36px 28px;">
${bandLabel(email.eyebrow)}
<h1 class="eia-h1" style="margin:20px 0 0 0;${type(32, 37, COLORS.onBand, 'font-weight:600;letter-spacing:-1px;')}">${email.title}</h1>
</td>
</tr>
<tr>
<td class="eia-card" bgcolor="${COLORS.surface}" style="background-color:${COLORS.surface};border:1px solid ${COLORS.line};border-top:0;border-radius:0 0 24px 24px;padding:32px 28px;">
${lines(email.body(brand))}</td>
</tr>
<tr>
<td class="eia-foot" style="padding:24px 8px 8px 8px;">
${footer(brand, email)}</td>
</tr>
</table>
</td>
</tr>
</table>
</div>
</body>
</html>
`;
  return { subject, html: keepWordsTogether(document.value) };
}

// Palavras com hífen ("e-mail", "cadastre-se") não quebram no hífen, inclusive no fim da frase ("e-mail.").
// Só nos textos do body: no <title> e nos atributos, um <span> viraria texto literal. Partes de um endereço
// ("fale-conosco@", "@empresa-x.com", ".empresa-x.com") ficam de fora: lá a quebra é necessária.
const HYPHENATED = /(?<![\p{L}\p{N}_@.-])(\p{L}+(?:-\p{L}+)+)(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}])/gu;

function keepWordsTogether(document) {
  const start = document.indexOf('<body');
  const body = document
    .slice(start)
    .replace(
      />([^<]+)</g,
      (match, content) => `>${content.replace(HYPHENATED, '<span style="white-space:nowrap;">$1</span>')}<`,
    );
  return document.slice(0, start) + body;
}

// ---------------------------------------------------------------------------------------------------------
// Variáveis do Supabase

// Variáveis que o Supabase oferece em cada modelo (documentação oficial, tabela "Terminology"). Nas
// notificações, Email (e OldEmail no aviso de e-mail alterado) e SiteURL, que o Supabase Auth passa a elas
// desde a v2.190.0, de junho de 2026 (supabase/auth#2532). Uma variável fora da lista sai vazia ou quebra o link.
const LINK_VARIABLES = ['ConfirmationURL', 'Token', 'TokenHash', 'SiteURL', 'RedirectTo', 'Data', 'Email'];
export const SUPPORTED_VARIABLES = Object.freeze({
  confirmation: LINK_VARIABLES,
  invite: LINK_VARIABLES,
  magic_link: LINK_VARIABLES,
  recovery: LINK_VARIABLES,
  email_change: [...LINK_VARIABLES, 'NewEmail'],
  reauthentication: ['Token', 'SiteURL', 'Email', 'Data'],
  password_changed_notification: ['SiteURL', 'Email'],
  email_changed_notification: ['SiteURL', 'Email', 'OldEmail'],
});

const VARIABLE_PATTERN = /\{\{\s*\.([A-Za-z]\w*)((?:\.\w+)*)\s*\}\}/g;

export function variablesOf(content) {
  return [...new Set([...content.matchAll(VARIABLE_PATTERN)].map((match) => match[1]))];
}

// ---------------------------------------------------------------------------------------------------------
// Arquivos gerados

const tomlString = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// O Supabase CLI resolve o content_path dos modelos de Auth a partir da raiz do repositório e o das
// notificações a partir da pasta supabase/, como nos exemplos da documentação oficial.
export const contentPath = (email) =>
  email.group === 'template' ? `./supabase/templates/${email.id}.html` : `./templates/${email.id}.html`;

function configSnippet(rendered) {
  const blocks = rendered.map(({ email, subject }) =>
    [
      `[auth.email.${email.group}.${email.config}]`,
      ...(email.group === 'notification' ? ['enabled = true'] : []),
      `subject = ${tomlString(subject)}`,
      `content_path = ${tomlString(contentPath(email))}`,
    ].join('\n'),
  );
  return `# Modelos de e-mail do Supabase Auth do CRM, no formato do Supabase CLI.
# Gerado por scripts/build-auth-emails.mjs a partir de supabase/templates/brand.json. Não edite à mão:
# troque a marca no brand.json e rode npm run emails:build.
#
# Este arquivo fica FORA do supabase/config.toml de propósito.
# - Supabase local (com o Docker Desktop aberto): cole os blocos abaixo no config.toml e rode, um de
#   cada vez, npx supabase stop e npx supabase start.
#   O CLI lê o content_path dos modelos a partir da raiz do repositório e o das notificações a partir
#   da pasta supabase/. As notificações só são enviadas com enabled = true.
# - Projeto hospedado: aplique pelo painel (Authentication → Emails → Templates), como explica
#   supabase/templates/README.md. Não use "supabase config push" enquanto o config.toml não espelhar
#   toda a configuração de Auth do painel (site_url, additional_redirect_urls, enable_signup,
#   [auth.email] enable_confirmations = true, double_confirm_changes, secure_password_change,
#   otp_expiry, otp_length, max_frequency e SMTP). O push compara a seção [auth] inteira com os
#   padrões do CLI e pode, por exemplo, desligar a confirmação de e-mail ou trocar a Site URL.

${blocks.join('\n\n')}
`;
}

// Tudo o que o gerador grava em supabase/templates/: nome do arquivo → conteúdo (LF, UTF-8 sem BOM).
export function buildAuthEmails(brand) {
  const rendered = AUTH_EMAILS.map((email) => ({ email, ...renderEmail(email, brand) }));
  for (const { email, html } of rendered) {
    const invalid = variablesOf(html).filter((name) => !SUPPORTED_VARIABLES[email.id].includes(name));
    if (invalid.length)
      throw new Error(
        `${email.id}.html usaria variáveis que o Supabase não oferece neste modelo: ${invalid.join(', ')}`,
      );
  }
  const files = new Map();
  for (const { email, html } of rendered) files.set(`${email.id}.html`, html);
  const subjects = Object.fromEntries(rendered.map(({ email, subject }) => [email.id, subject]));
  files.set('subjects.json', `${JSON.stringify(subjects, null, 2)}\n`);
  files.set('config-snippet.toml', configSnippet(rendered));
  return files;
}

// Arquivos gerados que estão diferentes no disco, ausentes ou sobrando (um .html que o gerador não produz).
export function compareWithDirectory(files, directory = TEMPLATES_DIR) {
  const problems = [];
  for (const [name, expected] of files) {
    let current;
    try {
      current = readFileSync(path.join(directory, name), 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      problems.push({ name, reason: 'ausente' });
      continue;
    }
    if (current !== expected) problems.push({ name, reason: 'diferente', ...firstDifference(expected, current) });
  }
  let entries = [];
  try {
    entries = readdirSync(directory);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const entry of entries.sort()) {
    if (entry.endsWith('.html') && entry !== PREVIEW_NAME && !files.has(entry))
      problems.push({ name: entry, reason: 'sobrando: o gerador não produz este modelo' });
  }
  return problems;
}

function firstDifference(expected, actual) {
  if (actual.includes('\r') && !expected.includes('\r'))
    return { line: null, expected: 'quebras de linha LF', actual: 'CRLF' };
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < length; index += 1) {
    if (expectedLines[index] !== actualLines[index])
      return {
        line: index + 1,
        expected: expectedLines[index] ?? '(fim do arquivo)',
        actual: actualLines[index] ?? '(fim do arquivo)',
      };
  }
  return { line: null, expected: '', actual: '' };
}

// ---------------------------------------------------------------------------------------------------------
// Prévia local (supabase/templates/preview.html, ignorada pelo Git)

const SAMPLE_SITE = 'https://crm.exemplo.com.br';
const PREVIEW_SITE_URL = '../../public';
// {{ .ConfirmationURL }} aponta para o Auth do projeto Supabase, não para o site: é esse domínio que aparece
// no endereço "copie e cole" do e-mail real. O ref abaixo é fictício.
const SAMPLE_AUTH = 'https://abcdefghijklmnopqrst.supabase.co/auth/v1/verify';
const SAMPLE_LINKS = {
  confirmation: ['signup', `${SAMPLE_SITE}/?next=%2Fpipeline`],
  invite: ['invite', `${SAMPLE_SITE}/`],
  magic_link: ['magiclink', `${SAMPLE_SITE}/?next=%2Fpipeline`],
  email_change: ['email_change', `${SAMPLE_SITE}/`],
  recovery: ['recovery', `${SAMPLE_SITE}/reset-password`],
};

// `overrides` troca valores de exemplo; a prévia usa SiteURL = "../../public" para o logo com caminho do
// frontend (como "/brand/eia-email.png") abrir o arquivo de public/ a partir de supabase/templates/preview.html.
export function sampleValues(email, brand, overrides = {}) {
  const [linkType, redirect] = SAMPLE_LINKS[email.id] ?? [null, SAMPLE_SITE];
  return {
    ConfirmationURL: linkType
      ? `${SAMPLE_AUTH}?token=pkce_3f9a1c27b84e5d60&type=${linkType}&redirect_to=${encodeURIComponent(redirect)}`
      : '',
    Token: '4820391765'.slice(0, brand.codeLength),
    TokenHash: 'pkce_3f9a1c27b84e5d60',
    SiteURL: SAMPLE_SITE,
    RedirectTo: redirect,
    Email: email.id === 'email_changed_notification' ? 'pessoa.nova@exemplo.com.br' : 'pessoa@exemplo.com.br',
    NewEmail: 'pessoa.nova@exemplo.com.br',
    OldEmail: 'pessoa@exemplo.com.br',
    ...overrides,
  };
}

// Simula o que o Supabase envia: troca cada {{ .X }} por um valor fictício escapado. Falha se o modelo usar
// uma variável que o Supabase não oferece naquele tipo de e-mail.
export function fillSample(email, content, brand, overrides = {}) {
  const allowed = SUPPORTED_VARIABLES[email.id];
  const values = sampleValues(email, brand, overrides);
  const invalid = variablesOf(content).filter((name) => !allowed.includes(name));
  if (invalid.length)
    throw new Error(`${email.id}.html usa variáveis que o Supabase não oferece neste modelo: ${invalid.join(', ')}`);
  const filled = content.replace(VARIABLE_PATTERN, (match, name) => escapeHtml(values[name] ?? ''));
  if (filled.includes('{{')) throw new Error(`${email.id}.html tem uma ação de template que a prévia não simula`);
  return filled;
}

export function buildPreview(brand, files = buildAuthEmails(brand)) {
  const subjects = JSON.parse(files.get('subjects.json'));
  const cards = AUTH_EMAILS.map((email) => {
    const content = files.get(`${email.id}.html`);
    const filled = fillSample(email, content, brand, { SiteURL: PREVIEW_SITE_URL });
    const variables = variablesOf(content)
      .map((name) => `<code>{{ .${escapeHtml(name)} }}</code>`)
      .join(' ');
    return `<article class="card">
<header class="card-head">
<div class="card-title"><h2>${escapeHtml(email.label)}</h2><code>${escapeHtml(email.id)}.html</code></div>
<dl class="meta">
<div><dt>Assunto</dt><dd>${escapeHtml(subjects[email.id])}</dd></div>
<div><dt>Pré-cabeçalho</dt><dd>${escapeHtml(email.preheader)}</dd></div>
<div><dt>No painel</dt><dd>${escapeHtml(email.panel)}</dd></div>
<div><dt>Quando</dt><dd>${escapeHtml(email.when)}</dd></div>
<div><dt>Variáveis</dt><dd>${variables || 'nenhuma'}</dd></div>
</dl>
</header>
<div class="frame-wrap"><iframe title="Prévia: ${escapeHtml(email.label)}" srcdoc="${escapeHtml(filled)}"></iframe></div>
</article>`;
  }).join('\n');
  const logo = !brand.logoUrl
    ? 'nome do produto em texto, sem <code>logoUrl</code>'
    : isLogoPath(brand.logoUrl)
      ? `logo em <code>{{ .SiteURL }}${escapeHtml(brand.logoUrl)}</code>, que aqui abre <code>public${escapeHtml(brand.logoUrl)}</code>`
      : `logo de <code>${escapeHtml(brand.logoUrl)}</code>`;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>E-mails de acesso</title>
<meta name="description" content="Prévia dos modelos de e-mail do Supabase Auth do CRM, com valores fictícios.">
<style>
:root { color-scheme: light; --bg: #f4f7f5; --surface: #ffffff; --text: #10251a; --muted: #405d4c; --subtle: #546f5f; --border: #d5dfd8; --action: #08643e; --on-action: #ffffff; --focus: #07683f; --font: Manrope, 'Segoe UI', Arial, Helvetica, sans-serif; --mono: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; --frame-w: 640px; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --bg: #080a09; --surface: #111613; --text: #f6f7f6; --muted: #b4bdb7; --subtle: #929f96; --border: #2a342e; --action: #13794f; --focus: #91f2c3; } }
:root[data-theme="dark"] { color-scheme: dark; --bg: #080a09; --surface: #111613; --text: #f6f7f6; --muted: #b4bdb7; --subtle: #929f96; --border: #2a342e; --action: #13794f; --focus: #91f2c3; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); line-height: 1.6; }
main { max-width: 1960px; margin: 0 auto; padding: 32px 16px 56px; }
.top { display: flex; flex-wrap: wrap; gap: 20px 32px; align-items: flex-end; justify-content: space-between; margin-bottom: 28px; }
h1 { margin: 0; font-size: clamp(1.5rem, 2.2vw, 2rem); line-height: 1.12; letter-spacing: -0.03em; font-weight: 750; }
.lead { margin: 8px 0 0; color: var(--muted); max-width: 72ch; font-size: 0.95rem; }
code { font-family: var(--mono); font-size: 0.85em; }
.controls { display: flex; flex-direction: column; gap: 6px; }
.controls span { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.075em; text-transform: uppercase; color: var(--subtle); }
.seg { display: inline-flex; padding: 3px; gap: 3px; border-radius: 13px; background: var(--surface); border: 1px solid var(--border); }
.seg button { font: inherit; font-size: 0.875rem; font-weight: 600; color: var(--muted); background: transparent; border: 0; border-radius: 10px; padding: 7px 12px; cursor: pointer; min-height: 36px; }
.seg button[aria-pressed="true"] { background: var(--action); color: var(--on-action); }
.seg button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.grid { display: grid; gap: 20px; align-items: start; grid-template-columns: repeat(auto-fill, minmax(min(100%, calc(var(--frame-w) + 34px)), 1fr)); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 23px; overflow: hidden; min-width: 0; }
.card-head { padding: 16px 16px 14px; border-bottom: 1px solid var(--border); }
.card-title { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; }
h2 { margin: 0; font-size: 1.05rem; letter-spacing: -0.01em; }
.card-title code { color: var(--subtle); }
.meta { margin: 10px 0 0; display: grid; gap: 4px; font-size: 0.85rem; }
.meta div { display: grid; grid-template-columns: 7.5rem 1fr; gap: 8px; }
.meta dt { color: var(--subtle); }
.meta dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.frame-wrap { background: #f4f7f5; display: flex; justify-content: center; }
iframe { display: block; border: 0; width: var(--frame-w); max-width: 100%; height: 900px; background: #f4f7f5; }
footer.note { margin-top: 28px; color: var(--subtle); font-size: 0.85rem; max-width: 80ch; }
@media (max-width: 520px) { .meta div { grid-template-columns: 1fr; gap: 0; } .meta div + div { margin-top: 6px; } }
</style>
</head>
<body>
<main>
<div class="top">
<div>
<h1>E-mails de acesso · ${escapeHtml(brand.productName)}</h1>
<p class="lead">Os ${AUTH_EMAILS.length} modelos do Supabase Auth com valores fictícios: <code>pessoa@exemplo.com.br</code>, código <code>${escapeHtml(sampleValues(AUTH_EMAILS[0], brand).Token)}</code> e links de exemplo que não funcionam. Os links usam o domínio do projeto Supabase (<code>…supabase.co</code>), como no e-mail real. Marca: ${logo}.</p>
</div>
<div class="controls" role="group" aria-label="Largura da prévia">
<span>Largura do e-mail</span>
<div class="seg">
<button type="button" data-w="640" aria-pressed="true">Desktop 640</button>
<button type="button" data-w="375" aria-pressed="false">Celular 375</button>
<button type="button" data-w="320" aria-pressed="false">Mínimo 320</button>
</div>
</div>
</div>
<section class="grid" aria-label="Modelos">
${cards}
</section>
<footer class="note">Gerado por <code>npm run emails:preview</code> a partir de <code>supabase/templates/brand.json</code>. Cada moldura mostra o mesmo <code>.html</code> que vai para o painel, com as variáveis trocadas por exemplos. Os e-mails usam o tema claro fixo; esta página acompanha o tema do sistema.</footer>
</main>
<script>
(function () {
  var frames = Array.prototype.slice.call(document.querySelectorAll('iframe'));
  function fit(frame) {
    try {
      var doc = frame.contentDocument;
      if (!doc || !doc.documentElement) return;
      frame.style.height = '60px';
      frame.style.height = Math.ceil(doc.documentElement.scrollHeight) + 'px';
    } catch (e) { frame.style.height = '900px'; }
  }
  frames.forEach(function (f) {
    f.addEventListener('load', function () { fit(f); });
    if (f.contentDocument && f.contentDocument.readyState === 'complete') fit(f);
  });
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.seg button'));
  function setWidth(w) {
    document.documentElement.style.setProperty('--frame-w', w + 'px');
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-w') === String(w))); });
    requestAnimationFrame(function () { frames.forEach(fit); });
    try { localStorage.setItem('crm-email-preview-width', String(w)); } catch (e) {}
  }
  buttons.forEach(function (b) { b.addEventListener('click', function () { setWidth(b.getAttribute('data-w')); }); });
  var saved = null;
  try { saved = localStorage.getItem('crm-email-preview-width'); } catch (e) {}
  if (saved === '640' || saved === '375' || saved === '320') setWidth(saved);
  window.addEventListener('resize', function () { frames.forEach(fit); });
})();
</script>
</body>
</html>
`;
}
