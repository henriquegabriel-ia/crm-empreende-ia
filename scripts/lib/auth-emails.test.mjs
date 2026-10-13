// Modelos de e-mail do Supabase Auth (npm run emails:build): variáveis permitidas em cada tipo, segurança do
// HTML, marca escapada, tamanho, arquivos versionados em dia com o gerador e contraste das cores do DS. Desde o item
// 1.6, a marca vem de public/brand/brand.json (scripts/lib/brand.mjs) e as opções do Auth de email-settings.json. Os
// testes de conteúdo usam a marca do programa por constante (PROGRAM_BRAND): trocar a marca da instância não reprova
// nenhum deles; para os arquivos versionados, valem a validade, a segurança e a igualdade com o gerador.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTH_EMAILS,
  BrandError,
  COLORS,
  EMAIL_SETTINGS_FILE,
  LEGACY_BRAND_MESSAGE,
  NARROW_CONTENT_WIDTH,
  PUBLIC_DIR,
  RECEIVED_INVITE,
  ROOT,
  TEMPLATES_DIR,
  buildAuthEmails,
  buildPreview,
  codeBoxMetrics,
  compareWithDirectory,
  contentPath,
  emailBrandFrom,
  escapeHtml,
  fillSample,
  isLogoPath,
  isProgramBrand,
  normalizeEmailSettings,
  readBrand,
  readEmailSettings,
  variablesOf,
} from './auth-emails.mjs';
import { BASE_CREDIT_TEXT, BRAND_DIR, PROGRAM_BRAND } from './brand.mjs';

// Tabela "Terminology" da documentação do Supabase (Email Templates): as sete primeiras valem para os modelos
// de Auth; NewEmail só em "Change email address"; OldEmail só na notificação "Email address changed". Nas
// notificações, Email e SiteURL (no código do Supabase Auth desde a v2.190.0, supabase/auth#2532).
// Independente da lista do gerador, de propósito.
const GENERAL = ['ConfirmationURL', 'Token', 'TokenHash', 'SiteURL', 'RedirectTo', 'Data', 'Email'];
const ALLOWED = {
  confirmation: GENERAL,
  invite: GENERAL,
  magic_link: GENERAL,
  email_change: [...GENERAL, 'NewEmail'],
  recovery: GENERAL,
  reauthentication: ['Token', 'SiteURL', 'Email', 'Data'],
  password_changed_notification: ['SiteURL', 'Email'],
  email_changed_notification: ['SiteURL', 'Email', 'OldEmail'],
};
const REQUIRED = {
  confirmation: ['RedirectTo', 'TokenHash', 'Token'],
  invite: ['RedirectTo', 'TokenHash'],
  magic_link: ['RedirectTo', 'TokenHash', 'Token'],
  recovery: ['RedirectTo', 'TokenHash'],
  email_change: ['ConfirmationURL', 'NewEmail'],
  reauthentication: ['Token'],
  password_changed_notification: [],
  email_changed_notification: ['OldEmail', 'Email'],
};
// Modelos cujo link volta ao CRM e só é usado depois do toque em “Continuar” (revisão de 13/10/2026), com o tipo do
// fragmento; os dois primeiros também trazem o código. A troca de e-mail continua com o link do Auth.
const CRM_LINKS = { confirmation: 'email', magic_link: 'email', recovery: 'recovery', invite: 'invite' };
const WITH_CODE = ['confirmation', 'magic_link'];
const IDS = Object.keys(ALLOWED);
// Cabeçalho e content_path de cada modelo no config.toml, copiados da documentação do Supabase (e não do
// gerador): uma chave errada faria o Supabase local ignorar o bloco e voltar ao modelo padrão, em inglês.
const CONFIG = {
  confirmation: ['[auth.email.template.confirmation]', './supabase/templates/confirmation.html'],
  invite: ['[auth.email.template.invite]', './supabase/templates/invite.html'],
  magic_link: ['[auth.email.template.magic_link]', './supabase/templates/magic_link.html'],
  email_change: ['[auth.email.template.email_change]', './supabase/templates/email_change.html'],
  recovery: ['[auth.email.template.recovery]', './supabase/templates/recovery.html'],
  reauthentication: ['[auth.email.template.reauthentication]', './supabase/templates/reauthentication.html'],
  password_changed_notification: [
    '[auth.email.notification.password_changed]',
    './templates/password_changed_notification.html',
  ],
  email_changed_notification: [
    '[auth.email.notification.email_changed]',
    './templates/email_changed_notification.html',
  ],
};
// Rótulo de cada linha de detalhe e a variável que ela mostra. Trocar o endereço atual pelo novo (ou o antigo
// pelo novo) inverteria a informação de segurança.
const DETAILS = {
  confirmation: [['Conta', ['Email']]],
  invite: [['Conta', ['Email']]],
  magic_link: [['Conta', ['Email']]],
  email_change: [
    ['E-mail atual', ['Email']],
    ['Novo e-mail', ['NewEmail']],
  ],
  recovery: [['Conta', ['Email']]],
  reauthentication: [],
  password_changed_notification: [['Conta', ['Email']]],
  email_changed_notification: [
    ['Antes', ['OldEmail']],
    ['Agora', ['Email']],
  ],
};
const PROGRAM_LOGO_SRC = '{{ .SiteURL }}/brand/eia-email.png';

// Opções do Auth de exemplo (as do email-settings.json da base).
const SETTINGS = { linkExpiry: '1 hora', codeLength: 8, secureEmailChange: true };
// Marca do programa sem o logo dos e-mails: o topo mostra o nome em texto.
const BASE = { ...PROGRAM_BRAND, emailLogo: '' };
// Marca de aluno: nenhum arquivo do programa (recusados com outra marca), o logo dos e-mails por endereço https://.
const STUDENT = {
  productName: 'Acme & Filhos <CRM> "Sul"',
  shortName: 'Acme "Vendas" \\ Sul',
  tagline: "Vendas d'Acme",
  supportEmail: 'suporte@acme.example',
  emailLogo: 'https://crm.acme.example/brand/logo.png?v=2&tema=claro',
};
const emailBrand = (brand, settings = {}) => emailBrandFrom(brand, { ...SETTINGS, ...settings });

// Os modelos com a marca do programa (conteúdo) e os da instância (arquivos versionados).
const programBrand = emailBrand(PROGRAM_BRAND);
const program = buildAuthEmails(programBrand);
const instanceBrand = readBrand();
const versioned = buildAuthEmails(instanceBrand);
const htmlOf = (files, id) => files.get(`${id}.html`);
const temporaryDirs = [];

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

// Pares [rótulo, variáveis] das linhas de detalhe, na ordem do e-mail: o rótulo numa linha da tabela e o valor
// na linha seguinte.
function detailPairs(content) {
  const pattern =
    /class="eia-row-label"[^>]*>([\s\S]*?)<\/td>\s*<\/tr>\s*<tr>\s*<td class="eia-row-value"[^>]*>([\s\S]*?)<\/td>/g;
  return [...content.matchAll(pattern)].map(([, label, value]) => [label.replace(/<[^>]+>/g, ''), variablesOf(value)]);
}

const sourcesOf = (content) => [...content.matchAll(/\bsrc="([^"]*)"/g)].map((match) => match[1]);

// Medidas lidas do HTML gerado (e não do gerador): o estilo inline vale mesmo num cliente que ignora o <style>.
const styleOf = (content, className) => content.match(new RegExp(`class="${className}"[^>]*style="([^"]*)"`))[1];
const pixels = (style, property) => {
  const match = style.match(new RegExp(`(?:^|;)${property}:([^;]+);`));
  expect(match, `${property} em "${style}"`).not.toBeNull();
  return match[1].split(' ').map((value) => parseFloat(value));
};
function horizontalPadding(style) {
  const [top, right = top, , left = right] = pixels(style, 'padding');
  return left + right;
}
// Área útil do cartão numa tela de 320 px: margem externa, respiro e borda do cartão.
function cardContentAt320(content) {
  const card = styleOf(content, 'eia-card');
  return (
    320 - horizontalPadding(styleOf(content, 'eia-outer')) - horizontalPadding(card) - 2 * pixels(card, 'border')[0]
  );
}
// Estilo da célula que mostra {{ .Token }} no código de verificação.
function codeCellStyle(content) {
  const match = content.match(/<td [^>]*style="([^"]*)"[^>]*>\{\{ \.Token \}\}<\/td>/);
  expect(match, 'célula com {{ .Token }}').not.toBeNull();
  return match[1];
}
// Largura da caixa com a fonte monoespaçada mais larga da pilha (0,6 em, como a Courier New): cada dígito com o
// espaçamento depois dele, os respiros laterais e a borda.
function codeCellWidth(style, digits) {
  const [fontSize] = pixels(style, 'font-size');
  const [letterSpacing] = pixels(style, 'letter-spacing');
  return digits * (0.6 * fontSize + letterSpacing) + horizontalPadding(style) + 2 * pixels(style, 'border')[0];
}

// Trechos com hífen ("e-mail") fora de um <span> que impede a quebra, nos textos do <body>.
function unprotectedHyphens(content) {
  const body = content.slice(content.indexOf('<body')).replace(/<span style="white-space:nowrap;">[^<]*<\/span>/g, '');
  return [...body.matchAll(/>([^<]+)</g)].flatMap(([, text]) => text.match(/\p{L}+(?:-\p{L}+)+/gu) ?? []);
}

describe('modelos de e-mail do Auth', () => {
  it('gera os oito modelos, subjects.json e config-snippet.toml', () => {
    expect(AUTH_EMAILS.map((email) => email.id)).toEqual(IDS);
    expect([...versioned.keys()]).toEqual([...IDS.map((id) => `${id}.html`), 'subjects.json', 'config-snippet.toml']);
  });

  it.each(IDS)('%s usa só variáveis que o Supabase oferece nesse modelo e as obrigatórias', (id) => {
    const content = htmlOf(versioned, id);
    const used = variablesOf(content);
    expect(used.filter((name) => !ALLOWED[id].includes(name))).toEqual([]);
    for (const name of REQUIRED[id]) expect(used).toContain(name);
    // Toda ação de template é uma variável simples ({{ .Nome }}): nada de if, range ou template.
    const actions = content.match(/\{\{[\s\S]*?\}\}/g) ?? [];
    for (const action of actions) expect(action).toMatch(/^\{\{ \.[A-Za-z]+ \}\}$/);
    expect(content.replace(/\{\{ \.[A-Za-z]+ \}\}/g, '')).not.toMatch(/\{\{|\}\}/);
  });

  it('os links de cadastro, acesso, redefinição e ativação voltam ao CRM e só valem depois do toque', () => {
    // Filtros de segurança do e-mail abrem os links antes da pessoa: um link direto ao /auth/v1/verify do Auth
    // ({{ .ConfirmationURL }}) seria gasto nessa visita. O link leva ao CRM com o token no fragmento, e a tela
    // EmailLinkGate só o confere (verifyOtp com token_hash) quando a pessoa toca em “Continuar”.
    const accepted = readFileSync(path.join(ROOT, 'src', 'lib', 'email-link.ts'), 'utf8');
    const gate = readFileSync(path.join(ROOT, 'src', 'components', 'workspace', 'EmailLinkGate.tsx'), 'utf8');
    expect(gate).toContain('verifyOtp({');
    expect(gate).toContain('token_hash: complete.tokenHash');
    for (const [id, linkType] of Object.entries(CRM_LINKS)) {
      const content = htmlOf(program, id);
      const link = `{{ .RedirectTo }}#token_hash={{ .TokenHash }}&amp;type=${linkType}`;
      expect(variablesOf(content), id).not.toContain('ConfirmationURL');
      expect(content.split(`href="${link}"`), id).toHaveLength(3);
      expect(content, id).toContain(`>${link}</a>`);
      expect(accepted, id).toContain(`'${linkType}'`);
    }
    const emailChange = htmlOf(program, 'email_change');
    expect(emailChange.match(/href="\{\{ \.ConfirmationURL \}\}"/g)).toHaveLength(2);
    expect(variablesOf(emailChange)).not.toContain('Token');
  });

  it('a confirmação e o link de acesso trazem o código, que o aviso de link enviado aceita', () => {
    for (const id of WITH_CODE) {
      const content = htmlOf(program, id);
      expect(content, id).toContain('em outro aparelho? Digite este código no CRM, no aparelho em que pediu o link:');
      expect(content, id).toMatch(/<td [^>]*>\{\{ \.Token \}\}<\/td>/);
      expect(content, id).toContain('o link (ou o código) vale por');
    }
    for (const id of ['invite', 'recovery']) expect(variablesOf(htmlOf(program, id)), id).not.toContain('Token');
    // O código é conferido com o tipo email (o Auth o procura na confirmação e no link de acesso).
    const form = readFileSync(path.join(ROOT, 'src', 'components', 'workspace', 'EmailCodeForm.tsx'), 'utf8');
    expect(form).toContain("verifyOtp({ email, token, type: 'email' })");
    const panel = readFileSync(path.join(ROOT, 'src', 'components', 'workspace', 'LinkSentPanel.tsx'), 'utf8');
    expect(panel).toContain('<EmailCodeForm');
  });

  it('o convite pelo painel avisa, antes do botão, para abrir o link de convite do CRM ou usar "Recebi um convite"', () => {
    const content = htmlOf(program, 'invite');
    const warning = content.indexOf('abra o link de convite do CRM');
    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(content.indexOf('class="eia-cta"'));
    const button = content.indexOf(`use “${RECEIVED_INVITE}” e cole o link`);
    expect(button).toBeGreaterThan(warning);
    expect(button).toBeLessThan(content.indexOf('class="eia-cta"'));
    // Desde o item 1.1 a conta sem equipe não cria empresa: o e-mail não cita mais o botão antigo.
    expect(content).not.toContain('Criar espaço de trabalho');
    expect(content).not.toContain('Criar empresa');
    // A faixa não diz "Convite": o texto pede o link de convite do CRM, que é outro.
    expect(content).not.toMatch(/>CONVITE</);
    // O nome do botão é o das telas que a pessoa vê depois de ativar a conta: a entrada e a conta sem equipe.
    const component = readFileSync(path.join(ROOT, 'src', 'components', 'workspace', 'ReceivedInvite.tsx'), 'utf8');
    expect(component).toContain(`'${RECEIVED_INVITE}'`);
    for (const screen of ['src/pages/Login.tsx', 'src/components/workspace/WorkspaceSetup.tsx']) {
      const source = readFileSync(path.join(ROOT, ...screen.split('/')), 'utf8');
      expect(source, screen).toContain("from '@/components/workspace/ReceivedInvite'");
      expect(source, screen).toContain('<ReceivedInvite');
    }
  });

  it('a confirmação e a ativação pelo painel dizem que a senha é criada no CRM, depois do link', () => {
    // Reforço do item 1.1: a conta nasce pelo link, e o campo “Crie sua senha” aparece na sessão aberta por ele.
    const confirmation = htmlOf(program, 'confirmation');
    expect(confirmation).toContain('pede que você crie sua senha antes de entrar na equipe ou de criar a empresa');
    expect(confirmation.indexOf('pede que você crie sua senha')).toBeGreaterThan(
      confirmation.indexOf('class="eia-cta"'),
    );
    expect(AUTH_EMAILS.find((email) => email.id === 'confirmation').when).toContain(
      'a senha é criada no CRM depois da confirmação',
    );
    expect(htmlOf(program, 'invite')).toContain('Ao aceitar o convite da equipe, o CRM pede que você crie uma senha');
    const setup = readFileSync(path.join(ROOT, 'src', 'components', 'workspace', 'WorkspaceSetup.tsx'), 'utf8');
    expect(setup).toContain('Crie sua senha');
  });

  it('as descrições de quando cada e-mail sai acompanham os disparos do reforço do item 1.1', () => {
    const when = (id) => AUTH_EMAILS.find((email) => email.id === id).when;
    // O link de acesso também sai pelo "Cadastrar" de um e-mail com conta e pelo painel da prova do e-mail.
    expect(when('magic_link')).toContain('Também sai pela aba “Cadastrar” quando o e-mail já tem conta confirmada');
    expect(when('magic_link')).toContain('“Enviar link para o meu e-mail” (ou “Enviar de novo”)');
    // O aviso de senha sai também na primeira senha, criada depois do link.
    expect(when('password_changed_notification')).toContain('cria a primeira senha em “Crie sua senha”');
    const notice = htmlOf(program, 'password_changed_notification');
    expect(notice).toContain('acabou de ser criada ou alterada');
    expect(JSON.parse(program.get('subjects.json')).password_changed_notification).toMatch(
      /^Sua senha foi criada ou alterada · /,
    );
    // A troca de e-mail é recusada na conta sem organização, mas o e-mail do pedido ainda pode sair.
    expect(when('email_change')).not.toContain('este e-mail não sai');
    expect(when('email_change')).toContain('numa conta sem organização, o banco recusa o pedido e a conclusão');
    // Os botões citados existem nas telas.
    const login = readFileSync(path.join(ROOT, 'src', 'pages', 'Login.tsx'), 'utf8');
    const setup = readFileSync(path.join(ROOT, 'src', 'components', 'workspace', 'WorkspaceSetup.tsx'), 'utf8');
    expect(login).toContain('Cadastrar');
    expect(setup).toContain('Enviar link para o meu e-mail');
    expect(setup).toContain('Enviar de novo');
  });

  it('palavras com hífen não quebram no hífen, nem no fim da frase, e os endereços continuam quebrando', () => {
    for (const id of IDS) expect(unprotectedHyphens(htmlOf(program, id)), id).toEqual([]);
    expect(htmlOf(program, 'confirmation')).toContain(
      'Confirme seu <span style="white-space:nowrap;">e-mail</span>.</h1>',
    );
    // Partes com hífen antes de "@", depois de "@" e antes de um ponto do endereço.
    const supportEmail = 'fale-conosco.vendas@acme-sul.com.br';
    const brand = emailBrand({ ...STUDENT, tagline: 'Bem-vindo à Acme-Sul.', supportEmail });
    const files = buildAuthEmails(brand);
    for (const id of IDS) {
      const content = htmlOf(files, id);
      expect(content).toContain(
        '<span style="white-space:nowrap;">Bem-vindo</span> à <span style="white-space:nowrap;">Acme-Sul</span>.',
      );
      // Só o e-mail de suporte fica sem o <span>, para poder quebrar numa tela estreita.
      expect(new Set(unprotectedHyphens(content)), id).toEqual(new Set(['fale-conosco', 'acme-sul']));
    }
  });

  it('os e-mails de suporte e os endereços em destaque quebram em qualquer ponto, mesmo longos e sem hífen', () => {
    const supportEmail = 'atendimento@distribuidorasilvaautopecas.com.br';
    const files = buildAuthEmails(emailBrand({ ...STUDENT, supportEmail }));
    for (const id of IDS) {
      const links = [...htmlOf(files, id).matchAll(/<a href="mailto:([^"]*)" style="([^"]*)"/g)];
      const support = links.filter(([, to]) => to === supportEmail);
      // Rodapé em todos; nas notificações, também a orientação "Não foi você?".
      expect(support, id).toHaveLength(id.endsWith('_notification') ? 2 : 1);
      for (const [, , style] of support) expect(style).toContain('word-break:break-all;overflow-wrap:anywhere;');
      for (const [, , style] of links) expect(style).toContain('word-break:break-all;');
    }
    // Cada endereço em destaque fica num mailto com estilo próprio, para o Gmail não o transformar em link azul.
    for (const id of IDS) {
      const values = [...htmlOf(program, id).matchAll(/class="eia-row-value"[^>]*>([\s\S]*?)<\/td>/g)];
      expect(values).toHaveLength(DETAILS[id].length);
      for (const [, value] of values)
        expect(value).toMatch(/^<a href="mailto:(\{\{ \.\w+ \}\})" style="[^"]*word-break:break-all;[^"]*">\1<\/a>$/);
    }
  });

  // Endereço do logo que cada conjunto busca: o do programa ou o da marca da instância (nenhum sem emailLogo).
  const logoSources = (brand) =>
    brand.logoUrl ? [isLogoPath(brand.logoUrl) ? `{{ .SiteURL }}${brand.logoUrl}` : escapeHtml(brand.logoUrl)] : [];
  it.each(
    IDS.flatMap((id) => [
      [id, 'programa', program, programBrand],
      [id, 'instância', versioned, instanceBrand],
    ]),
  )('%s (marca do %s) é HTML seguro para o Supabase e para os clientes de e-mail', (id, _label, files, brand) => {
    const content = htmlOf(files, id);
    expect(content).toMatch(/^<!DOCTYPE html>\n<html lang="pt-BR"/);
    expect(content).not.toContain('<!--');
    expect(content).not.toMatch(/<(script|form|iframe|object|embed|input|button|link|base)\b/i);
    expect(content).not.toMatch(/@import|url\(|background=/i);
    // Único recurso remoto: o logo da marca, servido pelo frontend publicado na Site URL (o do programa é
    // eia-email.png).
    expect(sourcesOf(content)).toEqual(logoSources(brand));
    if (files === program) expect(sourcesOf(content)).toEqual([PROGRAM_LOGO_SRC]);
    // DS: <title> = assunto; o <h1> termina com pontuação, como os títulos dos e-mails V2.
    const subject = JSON.parse(files.get('subjects.json'))[id];
    expect(content).toContain(`<title>${escapeHtml(subject)}</title>`);
    expect(content).toMatch(/<h1 [^>]*>[^<]*(<span[^>]*>[^<]*<\/span>[^<]*)*[.?!]<\/h1>/);
    // Linhas de detalhe: cada rótulo com a variável certa, empilhados (sem duas colunas lado a lado).
    expect(detailPairs(content)).toEqual(DETAILS[id]);
    expect(content.match(/class="eia-row-label"/g) ?? []).toHaveLength(DETAILS[id].length);
    expect(content).toContain('<meta name="color-scheme" content="light only">');
    expect(Buffer.byteLength(content, 'utf8')).toBeLessThan(100 * 1024);
    // DESIGN.md: nenhum texto abaixo de 12 px (1 px só no preheader oculto e no ponto decorativo).
    const sizes = [...content.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]));
    expect(sizes.filter((size) => size !== 1 && size < 12)).toEqual([]);
    // Preheader oculto, motivo do envio e orientação para quem não pediu.
    expect(content).toMatch(/<div style="display:none;[^"]*">[^<]{10,}<\/div>/);
    expect(content).toContain('Você recebeu este');
    expect(content).toMatch(/Se (não foi você|você não esperava)|Não foi você?/);
  });

  it('a saída é determinística, em LF e UTF-8 sem BOM', () => {
    const again = buildAuthEmails(readBrand());
    expect(buildAuthEmails(emailBrand(PROGRAM_BRAND))).toEqual(program);
    for (const [name, content] of versioned) {
      expect(again.get(name)).toBe(content);
      expect(content).not.toContain('\r');
      expect(content.charCodeAt(0)).not.toBe(0xfeff);
      expect(content.endsWith('\n')).toBe(true);
    }
  });

  it('os arquivos versionados estão em dia com o gerador (npm run emails:check)', () => {
    expect(compareWithDirectory(versioned)).toEqual([]);
    const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-auth-emails.mjs'), '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(check.stderr).toBe('');
    expect(check.status).toBe(0);
    const usage = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-auth-emails.mjs'), '--outro'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(usage.status).toBe(2);
  });

  it('a conferência acusa arquivo editado, ausente, em CRLF ou sobrando', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'crm-emails-'));
    temporaryDirs.push(dir);
    for (const [name, content] of versioned) writeFileSync(path.join(dir, name), content, 'utf8');
    writeFileSync(path.join(dir, 'preview.html'), 'prévia ignorada', 'utf8');
    expect(compareWithDirectory(versioned, dir)).toEqual([]);

    writeFileSync(path.join(dir, 'recovery.html'), htmlOf(versioned, 'recovery').replace('Redefinir senha', 'Trocar'));
    writeFileSync(path.join(dir, 'invite.html'), htmlOf(versioned, 'invite').replace(/\n/g, '\r\n'));
    rmSync(path.join(dir, 'subjects.json'));
    writeFileSync(path.join(dir, 'antigo.html'), '<p>modelo antigo</p>');
    const problems = compareWithDirectory(versioned, dir);
    expect(problems.map(({ name, reason }) => [name, reason])).toEqual([
      ['invite.html', 'diferente'],
      ['recovery.html', 'diferente'],
      ['subjects.json', 'ausente'],
      ['antigo.html', 'sobrando: o gerador não produz este modelo'],
    ]);
    expect(problems[0].actual).toBe('CRLF');
    expect(problems[1].expected).toContain('Redefinir senha');
  });

  it('subjects.json e config-snippet.toml apontam para os modelos certos', () => {
    const subjects = JSON.parse(versioned.get('subjects.json'));
    expect(Object.keys(subjects)).toEqual(IDS);
    // Os assuntos terminam com o nome curto da marca da instância; com a do programa, na mesma forma do CRM (título da
    // página e tela de entrada).
    for (const subject of Object.values(subjects)) expect(subject.endsWith(` · ${instanceBrand.shortName}`)).toBe(true);
    for (const subject of Object.values(JSON.parse(program.get('subjects.json')))) {
      expect(subject).toMatch(/ · Empreende\.IA · CRM$/);
      expect(subject.length).toBeLessThanOrEqual(60);
      expect(subject).not.toContain('{{');
    }
    const snippet = versioned.get('config-snippet.toml');
    expect(snippet.match(/^\[auth\.email\.[^\]]+\]$/gm)).toEqual(IDS.map((id) => CONFIG[id][0]));
    for (const id of IDS) {
      const [header, file] = CONFIG[id];
      const block = snippet.slice(snippet.indexOf(header)).split('\n\n')[0];
      expect(block).toContain(`subject = "${subjects[id]}"`);
      expect(block).toContain(`content_path = "${file}"`);
      const notification = header.startsWith('[auth.email.notification.');
      expect(block.includes('enabled = true')).toBe(notification);
      // Modelos de Auth: caminho a partir da raiz do repositório; notificações: a partir de supabase/.
      expect(existsSync(path.join(notification ? path.join(ROOT, 'supabase') : ROOT, file))).toBe(true);
      expect(contentPath(AUTH_EMAILS.find((email) => email.id === id))).toBe(file);
    }
    expect(snippet).not.toMatch(/^\[auth\]$/m);
    // O comentário do arquivo funciona no PowerShell 5.1 do Windows, que não aceita "&&".
    expect(snippet).not.toContain('&&');
    expect(snippet).toContain('npx supabase stop');
  });

  it('o código de verificação cabe numa tela de 320 px, de 6 a 10 dígitos', () => {
    const content = htmlOf(versioned, 'reauthentication');
    // 320 − 2 × 12 (margem) − 2 × 28 (respiro do cartão) − 2 × 1 (borda do cartão), lido do HTML.
    const narrow = cardContentAt320(content);
    expect(narrow).toBe(238);
    expect(NARROW_CONTENT_WIDTH).toBe(narrow);
    for (let length = 6; length <= 10; length += 1) {
      const box = codeBoxMetrics(length);
      expect(box.width).toBeLessThanOrEqual(narrow);
      expect(box.fontSize).toBeGreaterThanOrEqual(24);
      // A caixa gerada para esse tamanho de código, medida pelo estilo da própria célula.
      const files = buildAuthEmails(emailBrand(BASE, { codeLength: length }));
      const cell = codeCellStyle(htmlOf(files, 'reauthentication'));
      expect(cell).toContain(`font-size:${box.fontSize}px;`);
      expect(codeCellWidth(cell, length)).toBeLessThanOrEqual(narrow);
    }
    // O arquivo que vai para o painel: a célula de {{ .Token }} tem as medidas da caixa do tamanho de código de
    // email-settings.json (8 dígitos na base) e não quebra.
    const digits = readEmailSettings().codeLength;
    const box = codeBoxMetrics(digits);
    const cell = codeCellStyle(content);
    expect(cell).toContain(`font-size:${box.fontSize}px;`);
    expect(cell).toContain(`letter-spacing:${box.letterSpacing}px;`);
    expect(cell).toContain(`line-height:${box.lineHeight}px;`);
    expect(cell).toContain('white-space:nowrap;');
    expect(codeCellWidth(cell, digits)).toBeLessThanOrEqual(narrow);
  });

  it('as cores do DS usadas em texto têm contraste AA', () => {
    const pairs = [
      [COLORS.onAction, COLORS.action],
      [COLORS.text, COLORS.surface],
      [COLORS.muted, COLORS.surface],
      [COLORS.subtle, COLORS.surface],
      [COLORS.accentText, COLORS.surface],
      [COLORS.muted, COLORS.canvas],
      [COLORS.subtle, COLORS.canvas],
      [COLORS.text, COLORS.canvas],
      [COLORS.codeText, COLORS.codeBg],
      [COLORS.onBand, COLORS.band],
      [COLORS.onBand, COLORS.bandEnd],
      [COLORS.bandLabel, COLORS.band],
      [COLORS.bandLabel, COLORS.bandEnd],
    ];
    for (const [foreground, background] of pairs) expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('a prévia troca todas as variáveis por exemplos', () => {
    const brand = programBrand;
    for (const email of AUTH_EMAILS) {
      const filled = fillSample(email, htmlOf(program, email.id), brand);
      expect(filled).not.toContain('{{');
      expect(filled).toContain(email.id === 'reauthentication' ? '>48203917</td>' : '>pessoa');
    }
    expect(() => fillSample(AUTH_EMAILS[5], '<p>{{ .ConfirmationURL }}</p>', brand)).toThrow(/ConfirmationURL/);
    const preview = buildPreview(brand, program);
    expect(preview).toContain(
      'a partir de <code>public/brand/brand.json</code> e <code>supabase/templates/email-settings.json</code>',
    );
    expect(preview.match(/<iframe /g)).toHaveLength(8);
    expect(preview).toContain('<html lang="pt-BR">');
    // Na prévia (supabase/templates/preview.html), o logo do frontend abre o arquivo de public/.
    expect(preview.match(/src=&quot;\.\.\/\.\.\/public\/brand\/eia-email\.png&quot;/g)).toHaveLength(8);
  });

  it('o logo para e-mail do programa tem fundo opaco, para não sumir quando o cliente escurece o fundo', () => {
    const png = readFileSync(path.join(PUBLIC_DIR, 'brand', 'eia-email.png'));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([960, 208]);
    // Tipo de cor 2 = RGB sem canal alfa (o PNG do kit do DS, composto sobre o fundo #f4f7f5 do e-mail).
    expect(png[25]).toBe(2);
  });
});

describe('marca dos e-mails (public/brand/brand.json e email-settings.json)', () => {
  it('escapa os valores da marca no HTML, no TOML e no JSON', () => {
    const files = buildAuthEmails(emailBrand(STUDENT));
    for (const id of IDS) {
      const content = htmlOf(files, id);
      expect(content).toContain(escapeHtml(STUDENT.productName));
      expect(content).toContain('Acme &amp; Filhos &lt;CRM&gt; &quot;Sul&quot;');
      expect(content).not.toContain('<CRM>');
      expect(content).toContain('Vendas d&#39;Acme');
      expect(content).toContain('src="https://crm.acme.example/brand/logo.png?v=2&amp;tema=claro"');
      // Único recurso remoto: o logo configurado.
      const sources = [...content.matchAll(/\bsrc="([^"]*)"/g)].map((match) => match[1]);
      expect(sources).toEqual(['https://crm.acme.example/brand/logo.png?v=2&amp;tema=claro']);
    }
    const subjects = JSON.parse(files.get('subjects.json'));
    expect(subjects.recovery).toBe('Redefina sua senha · Acme "Vendas" \\ Sul');
    expect(files.get('config-snippet.toml')).toContain('subject = "Redefina sua senha · Acme \\"Vendas\\" \\\\ Sul"');
    expect(htmlOf(files, 'recovery')).toContain('aria-label="Redefina sua senha · Acme &quot;Vendas&quot; \\ Sul"');
  });

  it('recusa valores que quebrariam o modelo ou o link', () => {
    // A marca é conferida por scripts/lib/brand.mjs (brand.test.mjs cobre cada mensagem); aqui, o que os e-mails usam.
    const problems = (brand, settings = {}) => {
      try {
        emailBrand({ ...BASE, ...brand }, settings);
        return [];
      } catch (error) {
        expect(error).toBeInstanceOf(BrandError);
        return error.problems;
      }
    };
    expect(problems({ productName: 'CRM {{ .Email }}' })[0]).toMatch(/\{\{/);
    expect(problems({ tagline: 'linha 1\nlinha 2' })[0]).toMatch(/quebras de linha/);
    expect(problems({ productName: '  ' })[0]).toMatch(/vazio/);
    expect(problems({ shortName: 'x'.repeat(41) })[0]).toMatch(/40 caracteres/);
    for (const emailLogo of [
      'http://crm.example/logo.png',
      'javascript:alert(1)',
      'logo.svg',
      'https://crm.example/logo".png',
      'https://user:senha@crm.example/logo.png',
    ])
      expect(problems({ emailLogo })[0], emailLogo).toMatch(/https:\/\//);
    for (const emailLogo of ['/brand/logo.png', '//cdn.example/logo.png', '../segredo.png', 'logo email.png'])
      expect(problems({ emailLogo })[0], emailLogo).toMatch(/sem espaços nem pastas/);
    expect(problems({ emailLogo: 'eia-email.png' })).toEqual([]);
    expect(problems({ emailLogo: 'logo-email.jpg' })).toEqual([]);
    // Marca própria com o logo da Empreende.IA: o topo mostraria o programa e o rodapé a empresa.
    for (const emailLogo of ['eia-email.png', 'https://crm.acme.example/brand/EIA-EMAIL.png?v=2'])
      expect(problems({ ...STUDENT, emailLogo }).join('\n')).toMatch(/logo da Empreende\.IA para e-mail/);
    expect(problems({ supportEmail: 'suporte' })[0]).toMatch(/e-mail/);
    expect(problems({ showBaseCredit: 'sim' })[0]).toMatch(/true ou false/);
    expect(problems({ logoURL: 'https://crm.example/logo.png' })[0]).toMatch(/"logoURL" não é um campo conhecido/);
    // As opções do Auth, em email-settings.json.
    expect(problems({}, { codeLength: 5 })[0]).toMatch(/de 6 a 10/);
    expect(problems({}, { codeLength: '8' })[0]).toMatch(/de 6 a 10/);
    expect(problems({}, { linkExpiry: '{{ .Data }}' })[0]).toMatch(/\{\{/);
    expect(problems({}, { secureEmailChange: 'sim' })[0]).toMatch(/true ou false/);
    expect(problems({}, { productName: 'X' })[0]).toMatch(/"productName" não é um campo conhecido.*public\/brand/);
    expect(() => normalizeEmailSettings([])).toThrow(BrandError);
    // Chaves com "_" são comentários; os campos ausentes recebem o padrão (coluna "Sem o campo" do README): sem logo,
    // nome em texto.
    expect(emailBrandFrom({ _leia: 'nota', productName: 'X' }, { _leia: 'nota' })).toMatchObject({
      shortName: 'X',
      logoUrl: '',
      logoWidth: 185,
      codeLength: 6,
      linkExpiry: '',
      secureEmailChange: true,
      showBaseCredit: true,
    });
  });

  it('confere que o logo dos e-mails existe em public/brand e aponta o arquivo de cada erro', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'crm-brand-'));
    temporaryDirs.push(dir);
    const read = () => readBrand({ dir, legacyFile: null });
    writeFileSync(path.join(dir, 'brand.json'), JSON.stringify({ ...STUDENT, emailLogo: 'logo-email.png' }), 'utf8');
    expect(read).toThrow(/"emailLogo" é "logo-email\.png", mas .*logo-email\.png não existe/);
    try {
      read();
    } catch (error) {
      // A mensagem do emails:build começa pelo arquivo com o problema (antes do item 1.6, sempre o brand.json antigo).
      expect(error.message.split('\n')[0]).toBe(`${error.file} inválido:`);
      expect(error.file.endsWith('/brand.json')).toBe(true);
    }
    writeFileSync(path.join(dir, 'logo-email.png'), readFileSync(path.join(BRAND_DIR, 'eia-email.png')));
    expect(read().logoUrl).toBe('/brand/logo-email.png');
    // Opções do Auth inválidas: o erro aponta email-settings.json.
    const settingsFile = path.join(dir, 'email-settings.json');
    writeFileSync(settingsFile, '{ "codeLength": 4 }', 'utf8');
    try {
      readBrand({ dir, settingsFile, legacyFile: null });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BrandError);
      expect(error.file.endsWith('/email-settings.json')).toBe(true);
      expect(error.message).toContain('"codeLength" precisa ser um número inteiro de 6 a 10');
      expect(error.message).toContain('campos explicados em supabase/templates/README.md');
    }
    expect(readBrand({ dir, settingsFile: EMAIL_SETTINGS_FILE, legacyFile: null }).codeLength).toBe(
      readEmailSettings().codeLength,
    );
  });

  it('recusa o brand.json antigo dos e-mails e diz para onde foi cada campo', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'crm-legacy-'));
    temporaryDirs.push(dir);
    const legacyFile = path.join(dir, 'brand.json');
    writeFileSync(legacyFile, JSON.stringify({ productName: 'Acme', logoUrl: '/brand/logo.png' }), 'utf8');
    expect(() => readBrand({ legacyFile })).toThrow(BrandError);
    try {
      readBrand({ legacyFile });
    } catch (error) {
      expect(error.problems).toEqual([LEGACY_BRAND_MESSAGE]);
      expect(error.message).toContain('logoUrl virou "emailLogo", só com o nome do arquivo');
      expect(error.message).toContain(
        'linkExpiry, codeLength e secureEmailChange foram para supabase/templates/email-settings.json',
      );
      expect(error.message).toContain('Passe os valores e apague o arquivo antigo.');
    }
  });

  it('os e-mails seguem só o brand.json, nunca VITE_SHOW_BASE_CREDIT', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'crm-credit-'));
    temporaryDirs.push(dir);
    writeFileSync(path.join(dir, 'brand.json'), JSON.stringify({ ...STUDENT, emailLogo: '' }), 'utf8');
    const previous = process.env.VITE_SHOW_BASE_CREDIT;
    process.env.VITE_SHOW_BASE_CREDIT = 'false';
    try {
      const brand = readBrand({ dir, legacyFile: null });
      expect(brand.showBaseCredit).toBe(true);
      expect(htmlOf(buildAuthEmails(brand), 'recovery')).toContain(BASE_CREDIT_TEXT);
    } finally {
      if (previous === undefined) delete process.env.VITE_SHOW_BASE_CREDIT;
      else process.env.VITE_SHOW_BASE_CREDIT = previous;
    }
    const generator = readFileSync(path.join(ROOT, 'scripts', 'lib', 'auth-emails.mjs'), 'utf8');
    expect(generator).not.toMatch(/process\.env|import\.meta\.env|loadEnv/);
  });

  it('mostra o crédito "Feito com Empreende.IA" só quando a marca é outra e o crédito está ligado (D3)', () => {
    expect(isProgramBrand(programBrand)).toBe(true);
    const credit = (brand) => htmlOf(buildAuthEmails(emailBrand(brand)), 'recovery').includes(BASE_CREDIT_TEXT);
    expect(credit(BASE)).toBe(false);
    expect(credit({ ...BASE, productName: 'Empreende IA CRM' })).toBe(false);
    expect(credit(STUDENT)).toBe(true);
    expect(credit({ ...STUDENT, showBaseCredit: false })).toBe(false);
  });

  it('usa o nome em texto sem logo e mostra suporte, validade e troca segura conforme a configuração', () => {
    const plain = buildAuthEmails(emailBrand(BASE));
    // Sem logo: o nome em peso 600, sem imitar o desenho do wordmark (peso 800 e espaçamento negativo).
    expect(htmlOf(plain, 'recovery')).toMatch(
      /<td class="eia-brand"[^>]*>\n<p style="[^"]*font-weight:600;">Empreende\.IA · CRM<\/p>/,
    );
    expect(htmlOf(plain, 'recovery')).not.toMatch(/font-weight:800/);
    expect(sourcesOf(htmlOf(plain, 'recovery'))).toEqual([]);
    // "emailLogo" com o nome de um arquivo de public/brand vira o caminho do frontend, completado pela Site URL, e
    // "emailLogoWidth" chega ao width.
    const withPath = buildAuthEmails(emailBrand({ ...STUDENT, emailLogo: 'logo-email.png', emailLogoWidth: 160 }));
    for (const id of IDS) {
      expect(sourcesOf(htmlOf(withPath, id))).toEqual(['{{ .SiteURL }}/brand/logo-email.png']);
      expect(htmlOf(withPath, id)).toContain('width="160" alt="Acme &amp; Filhos &lt;CRM&gt; &quot;Sul&quot;"');
      expect(htmlOf(withPath, id)).toContain('width:160px;');
    }
    expect(htmlOf(plain, 'recovery')).toContain('vale por 1 hora e só pode ser usado uma vez');
    expect(htmlOf(plain, 'recovery')).not.toContain('Precisa de ajuda?');
    expect(htmlOf(plain, 'email_change')).toContain('enviada aos dois endereços');

    const custom = buildAuthEmails(emailBrand(STUDENT, { linkExpiry: '', secureEmailChange: false }));
    expect(htmlOf(custom, 'recovery')).toContain('expira em breve e só pode ser usado uma vez');
    expect(htmlOf(custom, 'recovery')).toContain('href="mailto:suporte@acme.example"');
    expect(htmlOf(custom, 'password_changed_notification')).toContain('ou escreva para');
    expect(htmlOf(custom, 'email_change')).not.toContain('enviada aos dois endereços');
  });
});

describe('arquivos da pasta supabase/templates', () => {
  it('a marca e as opções versionadas são válidas, o brand.json antigo saiu e a prévia fica fora do Git', () => {
    expect(() => readBrand()).not.toThrow();
    expect(() => readEmailSettings()).not.toThrow();
    expect(existsSync(path.join(TEMPLATES_DIR, 'brand.json'))).toBe(false);
    const ignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^supabase\/templates\/preview\.html$/m);
    expect(existsSync(path.join(TEMPLATES_DIR, 'README.md'))).toBe(true);
  });
});
