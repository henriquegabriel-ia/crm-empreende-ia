import { describe, expect, it } from 'vitest';
import {
  CHANNEL_URL_MAX,
  EXTERNAL_LINK_PROPS,
  channelEmail,
  channelPhone,
  emailLink,
  encodeChannelText,
  fitsChannelUrl,
  gmailComposeUrl,
  mailtoUrl,
  outlookComposeUrl,
  telUrl,
  whatsappLink,
  whatsappUrl,
} from '@/lib/channels';

const MOBILE = channelPhone('+5511999990000')!;

describe('channelPhone', () => {
  it.each([
    ['+5511999990000', '+5511999990000', 'mobile', '(11) 99999-0000'],
    ['(11) 99999-0000', '+5511999990000', 'mobile', '(11) 99999-0000'],
    ['11 99999 0000', '+5511999990000', 'mobile', '(11) 99999-0000'],
    ['(11) 3000-0000', '+551130000000', 'landline', '(11) 3000-0000'],
    ['+1 415 555 0100', '+14155550100', 'international', '+14155550100'],
    ['+351 912 345 678', '+351912345678', 'international', '+351912345678'],
  ])('%j vira %s (%s)', (stored, e164, kind, display) => {
    expect(channelPhone(stored)).toEqual({ e164, digits: e164.slice(1), kind, display });
  });

  it.each([
    ['99999-0000', 'sem DDD'],
    ['(10) 99999-0000', 'DDD inexistente'],
    ['(11) 9999-0000', 'celular antigo com 8 dígitos'],
    ['11 99999-0000 ramal 2', 'ramal'],
    ['fone 11 99999-0000', 'letras'],
    ['1 415 555 0100', 'outro país sem o "+"'],
    ['+55 11 9999-0000', '+55 sem número válido'],
    ['+1 234', 'poucos dígitos'],
    ['+1234567890123456', 'mais de 15 dígitos'],
    ['', 'vazio'],
  ])('%j não abre canal (%s)', (stored) => expect(channelPhone(stored)).toBeNull());

  it('trata ausência de valor como sem telefone', () => {
    expect(channelPhone(null)).toBeNull();
    expect(channelPhone(undefined)).toBeNull();
  });
});

describe('whatsappUrl', () => {
  it('usa só os dígitos, sem "+", e omite ?text= com o texto vazio', () => {
    expect(whatsappUrl(MOBILE)).toBe('https://wa.me/5511999990000');
    expect(whatsappUrl(MOBILE, '')).toBe('https://wa.me/5511999990000');
    expect(whatsappUrl(MOBILE, '   ')).toBe('https://wa.me/5511999990000');
    expect(whatsappUrl(channelPhone('+1 415 555 0100')!, 'Hi')).toBe('https://wa.me/14155550100?text=Hi');
  });

  // Tabela de codificação (AC-10): cada caractere chega íntegro, com uma codificação só.
  it.each([
    ['Olá mundo', 'Ol%C3%A1%20mundo'],
    ['linha 1\nlinha 2', 'linha%201%0Alinha%202'],
    ['linha 1\r\nlinha 2', 'linha%201%0Alinha%202'],
    ['linha 1\rlinha 2', 'linha%201%0Alinha%202'],
    ['A & B', 'A%20%26%20B'],
    ['#1', '%231'],
    ['1+1=2', '1%2B1%3D2'],
    ['50% off', '50%25%20off'],
    ['%20 digitado', '%2520%20digitado'],
    ['Pode?', 'Pode%3F'],
    ['ação, coração', 'a%C3%A7%C3%A3o%2C%20cora%C3%A7%C3%A3o'],
    ['Oi 😀', 'Oi%20%F0%9F%98%80'],
  ])('%j vira %s', (text, encoded) => {
    const url = whatsappUrl(MOBILE, text);
    expect(url).toBe(`https://wa.me/5511999990000?text=${encoded}`);
    // O texto volta igual (as quebras "\r\n" e "\r" viram "\n"): uma codificação só.
    expect(new URL(url).searchParams.get('text')).toBe(text.replace(/\r\n?/g, '\n'));
  });

  it('troca um caractere substituto isolado por U+FFFD em vez de lançar', () => {
    const broken = `quebrado ${'\uD83D'} aqui ${'\uDE00'}`;
    expect(() => encodeURIComponent(broken)).toThrow(URIError);
    const url = whatsappUrl(MOBILE, broken);
    expect(new URL(url).searchParams.get('text')).toBe('quebrado � aqui �');
    // Um par válido continua sendo o emoji.
    expect(new URL(whatsappUrl(MOBILE, '😀')).searchParams.get('text')).toBe('😀');
  });
});

describe('telUrl', () => {
  it('usa o número global com "+" (RFC 3966)', () => {
    expect(telUrl(MOBILE)).toBe('tel:+5511999990000');
    expect(telUrl(channelPhone('(11) 3000-0000')!)).toBe('tel:+551130000000');
  });
});

describe('mailtoUrl', () => {
  it('codifica o endereço mantendo o "@" e omite os parâmetros vazios', () => {
    expect(mailtoUrl({ to: 'ana@example.com' })).toBe('mailto:ana@example.com');
    expect(mailtoUrl({ to: 'ana@example.com', subject: 'Proposta' })).toBe('mailto:ana@example.com?subject=Proposta');
    expect(mailtoUrl({ to: 'ana@example.com', body: 'Oi' })).toBe('mailto:ana@example.com?body=Oi');
  });

  it('usa %0D%0A nas quebras do corpo (RFC 6068), e não no assunto', () => {
    expect(mailtoUrl({ to: 'ana@example.com', subject: 'Olá, Ana', body: 'Linha 1\nLinha 2\r\nLinha 3' })).toBe(
      'mailto:ana@example.com?subject=Ol%C3%A1%2C%20Ana&body=Linha%201%0D%0ALinha%202%0D%0ALinha%203',
    );
  });

  it.each([
    ['a@b.com?cc=x@y.com', 'mailto:a@b.com%3Fcc%3Dx@y.com'],
    ['a@b.com&bcc=x@y.com', 'mailto:a@b.com%26bcc%3Dx@y.com'],
    ['a@b.com,x@y.com', 'mailto:a@b.com%2Cx@y.com'],
    ['a%20b@c.com', 'mailto:a%2520b@c.com'],
  ])('um endereço com caracteres de URL não vira parâmetro nem destinatário: %j', (to, url) => {
    expect(mailtoUrl({ to, subject: 'S' })).toBe(`${url}?subject=S`);
    // O navegador lê um único destinatário e só o parâmetro subject.
    const parsed = new URL(`${url}?subject=S`);
    expect([...parsed.searchParams.keys()]).toEqual(['subject']);
  });
});

describe('Gmail e Outlook web', () => {
  const draft = { to: 'ana@example.com', subject: 'Proposta & prazo', body: 'Olá, Ana!\nSegue a proposta.' };

  it('monta a composição do Gmail com os parâmetros na ordem exata', () => {
    const url = gmailComposeUrl(draft);
    expect(url).toBe(
      'https://mail.google.com/mail/?view=cm&fs=1&to=ana@example.com&su=Proposta%20%26%20prazo&body=Ol%C3%A1%2C%20Ana!%0ASegue%20a%20proposta.',
    );
    const params = new URL(url).searchParams;
    expect([...params.keys()]).toEqual(['view', 'fs', 'to', 'su', 'body']);
    expect(params.get('to')).toBe(draft.to);
    expect(params.get('su')).toBe(draft.subject);
    expect(params.get('body')).toBe(draft.body);
  });

  it('monta a composição do Outlook web com os parâmetros na ordem exata', () => {
    const url = outlookComposeUrl(draft);
    expect(url.startsWith('https://outlook.office.com/mail/deeplink/compose?to=ana@example.com&subject=')).toBe(true);
    const params = new URL(url).searchParams;
    expect([...params.keys()]).toEqual(['to', 'subject', 'body']);
    expect(params.get('subject')).toBe(draft.subject);
    expect(params.get('body')).toBe(draft.body);
  });

  it('omite assunto e texto vazios e protege o endereço', () => {
    expect(gmailComposeUrl({ to: 'ana@example.com' })).toBe(
      'https://mail.google.com/mail/?view=cm&fs=1&to=ana@example.com',
    );
    expect(outlookComposeUrl({ to: 'a@b.com?cc=x@y.com' })).toBe(
      'https://outlook.office.com/mail/deeplink/compose?to=a@b.com%3Fcc%3Dx@y.com',
    );
    expect([...new URL(gmailComposeUrl({ to: 'a@b.com&su=x' })).searchParams.keys()]).toEqual(['view', 'fs', 'to']);
  });

  it('não leva nada do CRM além do destinatário, do assunto e do texto', () => {
    for (const url of [gmailComposeUrl(draft), outlookComposeUrl(draft), mailtoUrl(draft), whatsappUrl(MOBILE, 'Oi')])
      expect(url).not.toMatch(/contact=|deal=|crm|utm_|cc=|bcc=/i);
  });
});

describe('channelEmail', () => {
  it.each([
    [' Ana.Souza@Empresa.com.br ', 'Ana.Souza@Empresa.com.br'],
    ['a+vendas@b.co', 'a+vendas@b.co'],
  ])('aceita %j', (stored, email) => expect(channelEmail(stored)).toBe(email));

  it.each([
    ['ana@empresa', 'sem ponto no domínio'],
    ['ana.empresa.com', 'sem "@"'],
    ['ana @empresa.com', 'com espaço'],
    ['ana@empresa.com, bia@empresa.com', 'com vírgula'],
    ['ana@empresa.com;bia@empresa.com', 'com ponto e vírgula'],
    ['Ana <ana@empresa.com>', 'com < e >'],
    ['"ana"@empresa.com', 'com aspas'],
    ['a@b.com?cc=x@y.com', 'com dois "@"'],
    [`${'a'.repeat(243)}@empresa.com`, '255 caracteres'],
    ['', 'vazio'],
  ])('recusa %j (%s)', (stored) => expect(channelEmail(stored)).toBeNull());

  it('aceita 254 caracteres', () => {
    expect(channelEmail(`${'a'.repeat(242)}@empresa.com`)).toHaveLength(254);
  });
});

describe('limite de URL', () => {
  it('cabe com 2.000 caracteres e passa com 2.001', () => {
    expect(CHANNEL_URL_MAX).toBe(2000);
    expect(fitsChannelUrl('x'.repeat(2000))).toBe(true);
    expect(fitsChannelUrl('x'.repeat(2001))).toBe(false);
  });

  it('texto acentuado consome o limite mais rápido: o link sem o texto é oferecido', () => {
    const long = 'ã'.repeat(400); // 400 × "%C3%A3" = 2.400 caracteres
    expect(encodeChannelText(long)).toHaveLength(2400);
    expect(whatsappLink(MOBILE, long)).toEqual({ url: 'https://wa.me/5511999990000', full: false });
    expect(whatsappLink(MOBILE, 'Oi')).toEqual({ url: 'https://wa.me/5511999990000?text=Oi', full: true });
  });

  it('o e-mail longo demais abre com o destinatário e o assunto, sem o texto', () => {
    const draft = { to: 'ana@example.com', subject: 'Proposta', body: 'x'.repeat(2100) };
    expect(emailLink('mailto', draft)).toEqual({ url: 'mailto:ana@example.com?subject=Proposta', full: false });
    expect(emailLink('gmail', draft)).toEqual({
      url: 'https://mail.google.com/mail/?view=cm&fs=1&to=ana@example.com&su=Proposta',
      full: false,
    });
    expect(emailLink('outlook', { ...draft, subject: 'y'.repeat(2100) })).toEqual({
      url: 'https://outlook.office.com/mail/deeplink/compose?to=ana@example.com',
      full: false,
    });
    expect(emailLink('mailto', { to: 'ana@example.com', body: 'Oi' })).toEqual({
      url: 'mailto:ana@example.com?body=Oi',
      full: true,
    });
  });
});

describe('atributos dos links externos', () => {
  it('abrem em aba nova sem acesso ao CRM e sem Referer', () => {
    expect(EXTERNAL_LINK_PROPS).toEqual({
      target: '_blank',
      rel: 'noopener noreferrer',
      referrerPolicy: 'no-referrer',
    });
  });
});
