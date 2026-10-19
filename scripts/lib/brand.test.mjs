// @vitest-environment node
// Marca da instância (item 1.6; docs/arquitetura/1.6.md, seção 10.1): leitura e validação de public/brand/brand.json,
// mensagens em pt-BR, imagens na pasta com o nome exato, crédito, e-mail de suporte, objeto público do navegador,
// marcadores do index.html, plugin do Vite e `npm run brand:check`. Pastas temporárias, como os testes dos e-mails.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BASE_CREDIT_TEXT,
  BRAND_DIR,
  BRAND_FIELDS,
  BrandError,
  MAX_IMAGE_BYTES,
  PROGRAM_ASSETS,
  PROGRAM_BRAND,
  ROOT,
  appBrand,
  brandDirMiddleware,
  brandEnvProblems,
  escapeHtml,
  brandHtml,
  brandPlugin,
  brandWarnings,
  copyBrandDir,
  E2E_BUILD_MODE,
  exportFileNameFor,
  exportSlug,
  isProgramBrand,
  loadBrandState,
  normalizeBrand,
  readBrand,
  resolveCredit,
  resolveSupportEmail,
  svgRefusal,
} from './brand.mjs';
import { headersFor } from './security-headers.mjs';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 10"><rect width="40" height="10"/></svg>';
const ACME = {
  productName: 'Acme CRM',
  logoOnLight: 'acme-light.svg',
  logoOnDark: 'acme-dark.svg',
  icon: 'acme-icon.svg',
};
const ACME_FILES = { 'acme-light.svg': SVG, 'acme-dark.svg': SVG, 'acme-icon.svg': SVG };
const temporaryDirs = [];

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Pasta de marca com o brand.json (objeto ou texto cru) e os arquivos pedidos.
function brandDir(brand, files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-brand-'));
  temporaryDirs.push(dir);
  if (brand !== undefined)
    writeFileSync(path.join(dir, 'brand.json'), typeof brand === 'string' ? brand : JSON.stringify(brand), 'utf8');
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
  return dir;
}

// Problemas da marca (BrandError), ou [] se ela passa.
function problems(input, options) {
  try {
    normalizeBrand(input, options);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(BrandError);
    return error.problems;
  }
}
const noFiles = { checkFiles: false };
const programFiles = Object.fromEntries(PROGRAM_ASSETS.map((name) => [name, readFileSync(path.join(BRAND_DIR, name))]));

describe('brand.json versionado', () => {
  it('é válido e, com a marca do programa, igual a PROGRAM_BRAND', () => {
    const brand = readBrand();
    expect(Object.keys(brand).sort()).toEqual([...BRAND_FIELDS].sort());
    // Numa instância com outra marca, só a validade conta: o teste não reprova a troca de marca.
    if (isProgramBrand(brand)) expect(brand).toEqual({ ...PROGRAM_BRAND });
    expect(normalizeBrand(PROGRAM_BRAND, noFiles)).toEqual({ ...PROGRAM_BRAND });
    // Com os arquivos do programa na pasta, que a base mantém em public/brand (docs/MARCA.md, seção 4).
    expect(readBrand({ dir: brandDir(PROGRAM_BRAND, programFiles) })).toEqual({ ...PROGRAM_BRAND });
  });

  it('a pasta da base tem os cinco arquivos do programa e o crédito tem o texto da D3', () => {
    expect(PROGRAM_ASSETS).toEqual([
      'eia-logo-on-light.svg',
      'eia-logo-on-dark.svg',
      'eia-icon.svg',
      'eia-auth-art.jpg',
      'eia-email.png',
    ]);
    expect(BASE_CREDIT_TEXT).toBe('Feito com Empreende.IA');
  });
});

describe('validação do brand.json (mensagens 1 a 15)', () => {
  it('JSON inválido, BOM do Bloco de Notas e arquivo ausente', () => {
    expect(() => readBrand({ dir: brandDir('{ "productName": "Acme", }') })).toThrow(
      /o arquivo não é um JSON válido \(.+\)\. Confira vírgulas e aspas: cada linha termina com vírgula, menos a última antes de "}"\./,
    );
    expect(readBrand({ dir: brandDir(`﻿${JSON.stringify({ productName: 'Acme' })}`) }).productName).toBe('Acme');
    expect(() => readBrand({ dir: brandDir(undefined) })).toThrow(/o arquivo não existe/);
    expect(problems([])).toEqual(['o arquivo precisa ser um objeto JSON, como { "productName": "…" }']);
  });

  it('campos desconhecidos, obrigatórios, vazios, longos e com o tipo errado', () => {
    expect(problems({ productName: 'Acme', logoOnligth: '' }, noFiles)).toEqual([
      '"logoOnligth" não é um campo conhecido (confira a grafia; campos: productName, shortName, tagline, supportEmail, logoOnLight, logoOnDark, icon, favicon, authImage, emailLogo, emailLogoWidth, exportName, showBaseCredit)',
    ]);
    expect(problems({ shortName: 'Acme' }, noFiles)).toEqual(['"productName" é obrigatório']);
    expect(problems({ productName: '   ' }, noFiles)).toEqual(['"productName" não pode ficar vazio']);
    expect(problems({ productName: 'x'.repeat(61), shortName: 'x' }, noFiles)).toEqual([
      '"productName" passa de 60 caracteres',
    ]);
    expect(problems({ productName: 'Acme', tagline: 3 }, noFiles)).toEqual([
      '"tagline" precisa ser um texto entre aspas',
    ]);
    expect(problems({ productName: 'Acme', tagline: 'x'.repeat(121) }, noFiles)).toEqual([
      '"tagline" passa de 120 caracteres',
    ]);
  });

  it('quebras de linha, {{ }} e caracteres trocados de um arquivo salvo fora do UTF-8', () => {
    expect(problems({ productName: 'Acme\nCRM' }, noFiles)).toEqual([
      '"productName" não pode ter quebras de linha nem caracteres de controle',
    ]);
    expect(problems({ productName: 'Acme', tagline: 'Olá {{ .Email }}' }, noFiles)).toEqual([
      '"tagline" não pode conter {{ nem }}, que o Supabase leria como variável',
    ]);
    expect(problems({ productName: 'Acme Solu��es' }, noFiles)).toEqual([
      '"productName" tem caracteres trocados (�): salve o brand.json em UTF-8 (no Bloco de Notas: Arquivo → Salvar como → Codificação: UTF-8)',
    ]);
    // O ç salvo em ANSI (Windows-1252) vira � na leitura em UTF-8.
    const ansi = Buffer.concat([
      Buffer.from('{ "productName": "Acme Solu'),
      Buffer.from([0xe7, 0xf5]),
      Buffer.from('es" }'),
    ]);
    expect(() => readBrand({ dir: brandDir(ansi.toString('latin1')) })).not.toThrow();
    const dir = brandDir(undefined, { 'brand.json': ansi });
    expect(() => readBrand({ dir })).toThrow(/tem caracteres trocados/);
  });

  it('brand.json em UTF-16, com e sem a marca do Bloco de Notas, recebe a mensagem de como salvar em UTF-8', () => {
    // Revisão do item 1.6, achado 4 (corrigido no item 1.9).
    const json = JSON.stringify({ productName: 'Acme' });
    const message =
      'o arquivo está salvo em UTF-16 (Unicode). Salve de novo como UTF-8: no Bloco de Notas, Arquivo → Salvar como → Codificação: UTF-8.';
    for (const [label, content] of [
      ['UTF-16 LE com BOM', Buffer.from(`\ufeff${json}`, 'utf16le')],
      ['UTF-16 LE sem BOM', Buffer.from(json, 'utf16le')],
      ['UTF-16 BE com BOM', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(json, 'utf16le').swap16()])],
      ['UTF-16 BE sem BOM', Buffer.from(json, 'utf16le').swap16()],
    ]) {
      const dir = brandDir(undefined, { 'brand.json': content });
      try {
        readBrand({ dir });
        expect.unreachable(label);
      } catch (error) {
        expect(error, label).toBeInstanceOf(BrandError);
        expect(error.problems, label).toEqual([message]);
      }
    }
  });

  it('e-mail, crédito, largura do logo e nome dos arquivos exportados', () => {
    const base = { productName: 'Acme' };
    expect(problems({ ...base, supportEmail: 'suporte' }, noFiles)).toEqual([
      '"supportEmail" precisa ser um e-mail, como suporte@suaempresa.com.br, ou "" para não mostrar',
    ]);
    expect(problems({ ...base, showBaseCredit: 'false' }, noFiles)).toEqual([
      '"showBaseCredit" precisa ser true ou false, sem aspas',
    ]);
    for (const emailLogoWidth of [39, 301, 120.5, '185'])
      expect(problems({ ...base, emailLogoWidth }, noFiles)).toEqual([
        '"emailLogoWidth" precisa ser um número inteiro de 40 a 300',
      ]);
    for (const exportName of ['Acme', 'acme vendas', 'ação', '-acme', 'x'.repeat(41)])
      expect(problems({ ...base, exportName }, noFiles), exportName).toEqual([
        '"exportName" precisa ter só letras minúsculas sem acento, números e hífen, como "acme-vendas" (até 40 caracteres), ou "" para os arquivos saírem sem o nome',
      ]);
    expect(problems({ productName: 'Acme Soluções Comerciais Integradas · CRM' }, noFiles)).toEqual([
      '"shortName" ficou com o productName, que passa de 40 caracteres: defina "shortName" com até 40 para os assuntos dos e-mails',
    ]);
  });

  it('junta vários problemas de uma vez e mostra o arquivo e o guia, sem a pilha do JavaScript', () => {
    try {
      normalizeBrand({ productName: '', supportEmail: 'x', showBaseCredit: 'sim', extra: 1 }, noFiles);
      expect.unreachable();
    } catch (error) {
      expect(error.problems).toHaveLength(4);
      expect(error.message.split('\n')).toEqual([
        `${error.file} inválido:`,
        ...error.problems.map((problem) => `  - ${problem}`),
        `  Corrija ${error.file} (campos explicados em docs/MARCA.md).`,
      ]);
      expect(error.stack).toBe(error.message);
    }
  });

  it('chaves com "_" são comentários, e os campos ausentes recebem padrões neutros', () => {
    expect(normalizeBrand({ _leia: 'nota', productName: '  Acme Soluções · CRM  ' }, noFiles)).toEqual({
      productName: 'Acme Soluções · CRM',
      shortName: 'Acme Soluções · CRM',
      tagline: '',
      supportEmail: '',
      logoOnLight: '',
      logoOnDark: '',
      icon: '',
      favicon: '',
      authImage: '',
      emailLogo: '',
      emailLogoWidth: 185,
      exportName: 'acme-solucoes-crm',
      showBaseCredit: true,
    });
    // "shortName": "" vale como ausente; "exportName": "" tira a marca dos arquivos.
    expect(normalizeBrand({ productName: 'Acme', shortName: '', exportName: '' }, noFiles)).toMatchObject({
      shortName: 'Acme',
      exportName: '',
    });
  });
});

describe('imagens da marca', () => {
  it('nome com pasta, espaço ou extensão que o campo não aceita', () => {
    expect(problems({ productName: 'Acme', logoOnDark: 'Logo Acme.png' }, noFiles)).toEqual([
      '"logoOnDark" é "Logo Acme.png", mas o nome do arquivo só pode ter letras sem acento, números, ponto, hífen e sublinhado, sem espaços nem pastas, como "logo-acme.png"',
    ]);
    for (const value of ['/brand/logo.svg', 'img\\logo.svg', '../logo.svg', 'logo..svg', 'logô.svg', '.logo.svg'])
      expect(problems({ productName: 'Acme', logoOnLight: value }, noFiles)[0], value).toMatch(
        /sem espaços nem pastas/,
      );
    expect(problems({ productName: 'Acme', icon: 'icone.jpg' }, noFiles)).toEqual([
      '"icon" precisa ser uma imagem SVG, PNG ou WEBP desta pasta, ou "" para usar a primeira letra do nome',
    ]);
    expect(problems({ productName: 'Acme', favicon: 'favicon.webp' }, noFiles)[0]).toMatch(/SVG, PNG ou ICO/);
    expect(problems({ productName: 'Acme', authImage: 'arte.svg' }, noFiles)[0]).toMatch(/JPG, PNG ou WEBP/);
    expect(problems({ productName: 'Acme', logoOnLight: 'logo.gif' }, noFiles)[0]).toMatch(
      /SVG, PNG, WEBP ou JPG desta pasta, ou "" para mostrar o nome em texto/,
    );
    expect(problems({ productName: 'Acme', emailLogo: 'logo.svg' }, noFiles)).toEqual([
      '"emailLogo" precisa ser uma imagem PNG, JPG ou GIF desta pasta (como "logo-email.png"), um endereço https:// completo ou "" para mostrar o nome em texto. E-mail não aceita SVG',
    ]);
    expect(problems({ productName: 'Acme', emailLogo: 'http://acme.example/logo.png' }, noFiles)[0]).toMatch(
      /https:\/\//,
    );
    expect(problems({ productName: 'Acme', emailLogo: 'https://acme.example/logo.png' }, noFiles)).toEqual([]);
  });

  it('arquivo ausente lista a pasta, para achar o "logo.png.png" das extensões ocultas', () => {
    const dir = brandDir({ productName: 'Acme', logoOnLight: 'logo-acme.png' }, { 'logo-acme.png.png': 'x' });
    expect(() => readBrand({ dir })).toThrow(BrandError);
    try {
      readBrand({ dir });
    } catch (error) {
      expect(error.problems).toEqual([
        `"logoOnLight" é "logo-acme.png", mas ${error.file.replace(/brand\.json$/, '')}logo-acme.png não existe. Arquivos nesta pasta: brand.json, logo-acme.png.png. No Windows, ative "Extensões de nomes de arquivos" no Explorador (Exibir → Mostrar) para ver o nome inteiro`,
      ]);
    }
  });

  it('maiúsculas diferentes reprovam também no Windows, que não as diferencia', () => {
    const dir = brandDir({ productName: 'Acme', logoOnLight: 'logo-acme.png' }, { 'Logo-Acme.png': 'x' });
    expect(() => readBrand({ dir })).toThrow(
      '"logoOnLight" é "logo-acme.png", mas o arquivo na pasta se chama "Logo-Acme.png". Use o nome exatamente igual, com as mesmas maiúsculas: o site publicado diferencia maiúsculas de minúsculas',
    );
  });

  it('pasta no lugar do arquivo e imagem acima de 1 MB', () => {
    const dir = brandDir({ productName: 'Acme', authImage: 'arte.jpg', logoOnDark: 'logo.png' });
    writeFileSync(path.join(dir, 'arte.jpg'), Buffer.alloc(MAX_IMAGE_BYTES + 1));
    mkdirSync(path.join(dir, 'logo.png'));
    try {
      readBrand({ dir });
      expect.unreachable();
    } catch (error) {
      expect(error.problems).toEqual([
        expect.stringMatching(/^"logoOnDark" é "logo\.png", mas .*logo\.png não é um arquivo$/),
        '"authImage" (arte.jpg) tem 1,1 MB; o limite é 1 MB. Reduza a imagem, por exemplo para 1600 × 900 px',
      ]);
    }
    writeFileSync(path.join(dir, 'arte.jpg'), Buffer.alloc(MAX_IMAGE_BYTES));
    rmSync(path.join(dir, 'logo.png'), { recursive: true });
    writeFileSync(path.join(dir, 'logo.png'), 'x');
    expect(readBrand({ dir }).authImage).toBe('arte.jpg');
  });

  // Revisão do item 1.6: os contornos de uma busca só pelo texto cru (namespace, referências de caractere, entidade do
  // DOCTYPE, srcdoc e ">" dentro de um atributo) também são recusados.
  const XHTML = 'xmlns:h="http://www.w3.org/1999/xhtml"';
  it.each([
    ['<script>', `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`],
    ['onload=', `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>`],
    ['javascript:', `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>`],
    [
      '<h:script> (prefixo de namespace)',
      `<svg xmlns="http://www.w3.org/2000/svg" ${XHTML}><h:script>alert(1)</h:script></svg>`,
    ],
    [
      'javascript&#58; (referência de caractere)',
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript&#58;alert(1)"><rect/></a></svg>`,
    ],
    [
      'java&#x09;script: (tabulação no meio)',
      `<svg xmlns="http://www.w3.org/2000/svg"><a href="java&#x09;script&colon;alert(1)"><rect/></a></svg>`,
    ],
    [
      '<!ENTITY> com o script codificado',
      `<!DOCTYPE svg [<!ENTITY x "&#60;script&#62;alert(1)&#60;/script&#62;">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>`,
    ],
    [
      'srcdoc com &lt;script&gt;',
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="9" height="9"><iframe xmlns="http://www.w3.org/1999/xhtml" srcdoc="&lt;script&gt;alert(document.domain)&lt;/script&gt;"></iframe></foreignObject></svg>`,
    ],
    [
      'onclick= depois de um ">" num atributo',
      `<svg xmlns="http://www.w3.org/2000/svg"><rect title=">" onclick="alert(1)"/></svg>`,
    ],
  ])('SVG com %s é recusado', (_label, svg) => {
    const dir = brandDir({ productName: 'Acme', logoOnDark: 'logo.svg' }, { 'logo.svg': svg });
    expect(() => readBrand({ dir })).toThrow(
      '"logoOnDark" (logo.svg) tem script e foi recusado. Exporte o SVG de novo, sem scripts',
    );
  });

  it.each([
    [
      '<foreignObject>',
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="9" height="9"><div xmlns="http://www.w3.org/1999/xhtml">Acme</div></foreignObject></svg>`,
    ],
    [
      '<!ENTITY>',
      `<!DOCTYPE svg [<!ENTITY nome "Acme">]><svg xmlns="http://www.w3.org/2000/svg"><text>&nome;</text></svg>`,
    ],
    ['<iframe>', `<svg xmlns="http://www.w3.org/2000/svg" ${XHTML}><h:iframe src="https://acme.example"/></svg>`],
    ['<embed>', `<svg xmlns="http://www.w3.org/2000/svg" ${XHTML}><h:embed src="x.svg"/></svg>`],
    ['<object>', `<svg xmlns="http://www.w3.org/2000/svg" ${XHTML}><h:object data="x.svg"/></svg>`],
  ])('SVG com %s, que abriria outro documento, é recusado', (found, svg) => {
    const dir = brandDir({ productName: 'Acme', icon: 'icone.svg' }, { 'icone.svg': svg });
    expect(() => readBrand({ dir })).toThrow(
      `"icon" (icone.svg) tem ${found}, que um logo não usa, e foi recusado. Exporte o SVG de novo como SVG simples`,
    );
  });

  // Revisão do item 1.6, achado 3 (corrigido no item 1.9): o SVG que é a própria folha XSLT gera um <script> sem escrever
  // "<script". O arquivo exato da revisão, e as variações que a regra cobre.
  const REVIEW_XSLT_SVG = `<?xml version="1.0"?>
<?xml-stylesheet type="text/xsl" href="logo-acme.svg"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xsl:version="1.0" viewBox="0 0 40 10"><rect width="40" height="10"/><text id="t" y="8">logo</text><xsl:element name="script" namespace="http://www.w3.org/2000/svg">document.getElementById('t').textContent='SCRIPT RAN '+location.origin+' '+typeof localStorage;</xsl:element></svg>
`;
  it('o SVG da revisão que é a própria folha XSLT é recusado', () => {
    expect(svgRefusal(Buffer.from(REVIEW_XSLT_SVG))).toEqual({ reason: 'active', found: '<?xml-stylesheet?>' });
    const dir = brandDir({ productName: 'Acme', logoOnLight: 'logo-acme.svg' }, { 'logo-acme.svg': REVIEW_XSLT_SVG });
    expect(() => readBrand({ dir })).toThrow(
      '"logoOnLight" (logo-acme.svg) tem <?xml-stylesheet?>, que um logo não usa, e foi recusado. Exporte o SVG de novo como SVG simples',
    );
  });

  it.each([
    [
      '<?xml-stylesheet?> com CSS',
      `<?xml-stylesheet type="text/css" href="estilo.css"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`,
      '<?xml-stylesheet?>',
    ],
    [
      '<?php ?>',
      `<?php echo 1; ?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`,
      'uma instrução de processamento',
    ],
    [
      'XSLT com o prefixo x:',
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/XSL/Transform" x:version="1.0"><x:element name="script">alert(1)</x:element></svg>`,
      'XSLT',
    ],
    [
      'o namespace do XSLT com &#58; e &#x2F;',
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:t="http&#58;//www.w3.org&#x2F;1999&#x2F;XSL&#x2F;Transform" t:version="1.0"><rect/></svg>`,
      'XSLT',
    ],
    [
      'o prefixo xsl: sem o namespace declarado aqui',
      `<svg xmlns="http://www.w3.org/2000/svg"><xsl:element name="script">alert(1)</xsl:element></svg>`,
      'XSLT',
    ],
  ])('SVG com %s é recusado', (_label, svg, found) => {
    expect(svgRefusal(Buffer.from(svg))).toEqual({ reason: 'active', found });
  });

  it('a declaração XML com a codificação continua aceita num logo comum', () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${SVG}`;
    expect(svgRefusal(Buffer.from(svg))).toBeNull();
    expect(svgRefusal(Buffer.from(`<?xml version='1.0' standalone='no'?>${SVG}`))).toBeNull();
    const dir = brandDir({ productName: 'Acme', logoOnLight: 'logo.svg' }, { 'logo.svg': svg });
    expect(readBrand({ dir }).logoOnLight).toBe('logo.svg');
  });

  it('SVG em UTF-16 ou binário é recusado, e o DOCTYPE com DTD externo continua aceito', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
    const message =
      '"logoOnLight" (logo.svg) não é um SVG em texto UTF-8 (está em UTF-16 ou compactado) e foi recusado. Exporte o SVG de novo em UTF-8';
    for (const content of [
      Buffer.from(`﻿${svg}`, 'utf16le'),
      Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(svg, 'utf16le').swap16()]),
      Buffer.from(svg, 'utf16le'),
    ]) {
      const dir = brandDir({ productName: 'Acme', logoOnLight: 'logo.svg' }, { 'logo.svg': content });
      expect(() => readBrand({ dir })).toThrow(message);
    }
    const doctype = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${SVG}`;
    const dir = brandDir({ productName: 'Acme', logoOnLight: 'logo.svg' }, { 'logo.svg': `﻿${doctype}` });
    expect(readBrand({ dir }).logoOnLight).toBe('logo.svg');
    expect(svgRefusal(Buffer.from(SVG))).toBeNull();
    for (const name of PROGRAM_ASSETS.filter((asset) => asset.endsWith('.svg')))
      expect(svgRefusal(programFiles[name]), name).toBeNull();
  });

  it('o vercel.json serve /brand/* sem deixar script nenhum rodar, mesmo com o SVG aberto direto', () => {
    const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    // Desde o item 1.3, o nosniff vem da regra comum a tudo, e a CSP de /brand/* continua só dela.
    const headers = headersFor('/brand/eia-icon.svg', vercel);
    const csp = headers['Content-Security-Policy'].split(';').map((directive) => directive.trim());
    expect(csp).toEqual(expect.arrayContaining(["default-src 'none'", 'sandbox']));
    expect(csp.some((directive) => /^script-src\b/.test(directive))).toBe(false);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    // As imagens continuam servidas como arquivo: a reescrita do SPA só vale quando não há arquivo.
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
  });

  it('SVG com fonte ou imagem externa só avisa, e o logo do programa (fonte embutida) passa', () => {
    const external = `<svg xmlns="http://www.w3.org/2000/svg"><style>@font-face{src:url(https://fonts.example/a.woff2)}</style><image href="https://cdn.example/x.png"/></svg>`;
    const dir = brandDir({ productName: 'Acme', logoOnLight: 'logo.svg' }, { 'logo.svg': external });
    const brand = readBrand({ dir });
    expect(brandWarnings(brand, { dir })).toEqual([
      '"logoOnLight" (logo.svg) busca fonte ou imagem fora do arquivo (http): numa página, o recurso externo não carrega. Converta o texto em curvas ou embuta a fonte no SVG',
    ]);
    const program = brandDir(PROGRAM_BRAND, programFiles);
    expect(brandWarnings(readBrand({ dir: program }), { dir: program })).toEqual([]);
  });

  it('os arquivos do programa são recusados com outra marca e aceitos com a do programa', () => {
    const fields = {
      logoOnLight: 'eia-logo-on-light.svg',
      logoOnDark: 'eia-logo-on-dark.svg',
      icon: 'eia-icon.svg',
      favicon: 'eia-icon.svg',
      authImage: 'eia-auth-art.jpg',
      emailLogo: 'eia-email.png',
    };
    const dir = brandDir({ productName: 'Acme CRM', ...fields }, programFiles);
    try {
      readBrand({ dir });
      expect.unreachable();
    } catch (error) {
      expect(error.problems).toEqual([
        '"logoOnLight" aponta para eia-logo-on-light.svg, o logo da Empreende.IA, mas a marca é outra ("Acme CRM"). Coloque o logo da empresa nesta pasta e use o nome do arquivo, ou "" para mostrar o nome em texto',
        '"logoOnDark" aponta para eia-logo-on-dark.svg, o logo da Empreende.IA, mas a marca é outra ("Acme CRM"). Coloque o logo da empresa nesta pasta e use o nome do arquivo, ou "" para mostrar o nome em texto',
        '"icon" aponta para eia-icon.svg, o ícone da Empreende.IA, mas a marca é outra ("Acme CRM"). Coloque o ícone da empresa nesta pasta e use o nome do arquivo, ou "" para usar a primeira letra do nome',
        '"favicon" aponta para eia-icon.svg, o ícone da Empreende.IA, mas a marca é outra ("Acme CRM"). Coloque o ícone da empresa nesta pasta e use o nome do arquivo, ou "" para usar o "icon"',
        '"authImage" aponta para eia-auth-art.jpg, a arte da Empreende.IA, mas a marca é outra ("Acme CRM"). Coloque a arte da empresa nesta pasta e use o nome do arquivo, ou "" para deixar o painel da entrada sem imagem',
        '"emailLogo" aponta para eia-email.png, o logo da Empreende.IA para e-mail, mas a marca é outra ("Acme CRM"). Coloque o logo da empresa para e-mail nesta pasta e use o nome do arquivo, ou "" para mostrar o nome em texto',
      ]);
    }
    // Revisão do item 1.6, achados 2 e 5 (corrigidos no item 1.9): a frase é neutra para todos os campos.
    const messages = problems({ productName: 'Acme CRM', ...fields }, noFiles);
    expect(messages).toHaveLength(6);
    for (const message of messages) expect(message).not.toMatch(/o nome del[ea]\b/);
    // Sem diferenciar maiúsculas, e também pelo endereço https:// que termina no logo dos e-mails do programa.
    expect(problems({ productName: 'Acme', icon: 'EIA-ICON.svg' }, noFiles)[0]).toMatch(/o ícone da Empreende\.IA/);
    expect(
      problems({ productName: 'Acme', emailLogo: 'https://crm.acme.example/brand/eia-email.png?v=2' }, noFiles)[0],
    ).toMatch(/aponta para eia-email\.png/);
    const program = brandDir(
      { ...PROGRAM_BRAND, productName: 'Empreende IA CRM', shortName: 'Empreende IA' },
      programFiles,
    );
    expect(readBrand({ dir: program }).icon).toBe('eia-icon.svg');
  });

  // Revisão do item 1.6: o productName decide se a marca é a do programa, e o resto do arquivo versionado que ficou com
  // os valores da Empreende.IA aparece de uma vez, campo por campo.
  it('quem troca só o productName do arquivo versionado vê cada campo que ficou com o valor do programa', () => {
    expect(isProgramBrand({ productName: 'Acme Vendas · CRM', shortName: PROGRAM_BRAND.shortName })).toBe(false);
    expect(isProgramBrand({ productName: 'Empreende IA CRM' })).toBe(true);
    const dir = brandDir({ ...PROGRAM_BRAND, productName: 'Acme Vendas · CRM' }, programFiles);
    try {
      readBrand({ dir });
      expect.unreachable();
    } catch (error) {
      expect(error.problems.slice(0, 2)).toEqual([
        '"shortName" ainda é o da Empreende.IA ("Empreende.IA · CRM"), mas o "productName" é "Acme Vendas · CRM". Troque o "shortName" pelo nome curto da empresa (até 40 caracteres) ou apague a linha para usar o "productName"',
        '"exportName" ainda é o da Empreende.IA ("empreende-ia"), mas a marca é outra ("Acme Vendas · CRM"). Use um nome da empresa, como "acme-vendas-crm", ou apague a linha para gerar o nome a partir do "productName"',
      ]);
      // Os cinco arquivos do programa também, na mesma lista.
      expect(error.problems.slice(2).map((problem) => problem.match(/^"(\w+)" aponta para/)?.[1])).toEqual([
        'logoOnLight',
        'logoOnDark',
        'icon',
        'authImage',
        'emailLogo',
      ]);
    }
    // O contrário: o nome curto trocado com o productName ainda do programa.
    expect(problems({ ...PROGRAM_BRAND, shortName: 'Acme CRM' }, noFiles)).toEqual([
      '"shortName" é "Acme CRM", mas o "productName" ainda é o da Empreende.IA ("Empreende.IA · CRM"). Troque também o "productName" pelo nome da empresa',
    ]);
    // Com a marca do programa, o exportName é livre; com outra, "empreende-ia" em qualquer grafia é recusado.
    expect(problems({ ...PROGRAM_BRAND, exportName: 'crm' }, noFiles)).toEqual([]);
    expect(problems({ productName: 'Acme', exportName: 'acme-empreende-ia' }, noFiles)[0]).toMatch(
      /^"exportName" ainda é o da Empreende\.IA \("acme-empreende-ia"\), mas a marca é outra \("Acme"\)\. Use um nome da empresa, como "acme"/,
    );
    // O slogan do programa não cita a Empreende.IA: só avisa.
    const tagline = normalizeBrand({ productName: 'Acme', tagline: PROGRAM_BRAND.tagline }, noFiles);
    expect(brandWarnings(tagline)).toEqual([
      `"tagline" ainda é o slogan da Empreende.IA ("${PROGRAM_BRAND.tagline}"): troque pelo slogan da empresa ou use "" para tirar a linha`,
    ]);
    expect(
      brandWarnings(normalizeBrand(PROGRAM_BRAND, noFiles), { dir: brandDir(PROGRAM_BRAND, programFiles) }),
    ).toEqual([]);
  });
});

describe('crédito e e-mail de suporte', () => {
  const other = normalizeBrand({ productName: 'Acme CRM' }, noFiles);
  const off = { ...other, showBaseCredit: false };
  const program = normalizeBrand(PROGRAM_BRAND, noFiles);

  it('matriz da AC-4: programa, brand.json e VITE_SHOW_BASE_CREDIT', () => {
    expect(resolveCredit(program, {})).toEqual({ show: false, source: 'programa' });
    expect(resolveCredit(program, { VITE_SHOW_BASE_CREDIT: 'true' })).toEqual({ show: false, source: 'programa' });
    expect(resolveCredit(other, {})).toEqual({ show: true, source: 'brand.json' });
    expect(resolveCredit(other, { VITE_SHOW_BASE_CREDIT: '  ' })).toEqual({ show: true, source: 'brand.json' });
    expect(resolveCredit(off, {})).toEqual({ show: false, source: 'brand.json' });
    expect(resolveCredit(other, { VITE_SHOW_BASE_CREDIT: ' FALSE ' })).toEqual({
      show: false,
      source: 'VITE_SHOW_BASE_CREDIT',
    });
    expect(resolveCredit(off, { VITE_SHOW_BASE_CREDIT: 'True' })).toEqual({
      show: true,
      source: 'VITE_SHOW_BASE_CREDIT',
    });
    for (const value of ['nao', '0', 'sim'])
      for (const brand of [program, other])
        expect(() => resolveCredit(brand, { VITE_SHOW_BASE_CREDIT: value })).toThrow(
          `VITE_SHOW_BASE_CREDIT é "${value}": use true ou false, ou apague a variável para seguir o brand.json`,
        );
  });

  it('o aviso explica a diferença entre o app e os e-mails', () => {
    expect(brandWarnings(other, { env: { VITE_SHOW_BASE_CREDIT: 'false' } })).toEqual([
      'VITE_SHOW_BASE_CREDIT=false é diferente do "showBaseCredit" do brand.json (true): o app segue a variável, e os e-mails seguem o brand.json',
    ]);
    expect(brandWarnings(other, { env: { VITE_SHOW_BASE_CREDIT: 'true' } })).toEqual([]);
    expect(brandWarnings(program, { env: { VITE_SHOW_BASE_CREDIT: 'true' } })).toEqual([
      'VITE_SHOW_BASE_CREDIT não tem efeito: com a marca do programa, o crédito nunca aparece',
    ]);
  });

  it('VITE_SUPPORT_EMAIL é obsoleta: recuo com aviso, ignorada com o arquivo preenchido e inválida reprova', () => {
    const withEmail = { ...other, supportEmail: 'suporte@acme.example' };
    expect(resolveSupportEmail(withEmail, {})).toEqual({
      email: 'suporte@acme.example',
      source: 'brand.json',
      warnings: [],
    });
    const fallback = resolveSupportEmail(other, { VITE_SUPPORT_EMAIL: ' antigo@acme.example ' });
    expect(fallback).toMatchObject({ email: 'antigo@acme.example', source: 'VITE_SUPPORT_EMAIL' });
    expect(fallback.warnings[0]).toMatch(/^VITE_SUPPORT_EMAIL está obsoleta: .*os e-mails de acesso saem sem suporte/);
    const ignored = resolveSupportEmail(withEmail, { VITE_SUPPORT_EMAIL: 'antigo@acme.example' });
    expect(ignored).toMatchObject({ email: 'suporte@acme.example', source: 'brand.json' });
    expect(ignored.warnings[0]).toMatch(/^VITE_SUPPORT_EMAIL está obsoleta e foi ignorada/);
    expect(resolveSupportEmail(other, {})).toEqual({ email: '', source: null, warnings: [] });
    expect(() => resolveSupportEmail(other, { VITE_SUPPORT_EMAIL: 'x' })).toThrow(
      'VITE_SUPPORT_EMAIL é "x": use um e-mail ou apague a variável (o e-mail de suporte agora fica em "supportEmail", no brand.json)',
    );
  });

  it('CRM_BRAND_DIR só vale fora do build', () => {
    expect(brandEnvProblems({}, { build: true, customDir: 'tests/browser/brand/acme' })).toEqual([
      'CRM_BRAND_DIR só vale no servidor de desenvolvimento dos testes; no build, a marca vem de public/brand/brand.json.',
    ]);
    expect(brandEnvProblems({}, { build: false, customDir: 'tests/browser/brand/acme' })).toEqual([]);
    // Item 1.11: o build do E2E (--mode e2e) aceita a pasta; os demais modos de build continuam recusando.
    expect(E2E_BUILD_MODE).toBe('e2e');
    expect(brandEnvProblems({}, { build: true, customDir: 'tests/browser/brand/acme', mode: 'e2e' })).toEqual([]);
    for (const mode of ['production', 'deployment', 'development', 'E2E', 'e2e '])
      expect(brandEnvProblems({}, { build: true, customDir: 'tests/browser/brand/acme', mode }), mode).toHaveLength(1);
  });
});

describe('objeto público do navegador (appBrand)', () => {
  it('endereços com ?v= do conteúdo, null nos vazios, crédito efetivo e só as chaves públicas', () => {
    const dir = brandDir(
      { ...ACME, tagline: 'Vendas', supportEmail: 'suporte@acme.example', exportName: 'acme' },
      ACME_FILES,
    );
    const brand = readBrand({ dir });
    const app = appBrand(brand, { dir, env: {} });
    expect(Object.keys(app).sort()).toEqual(
      [
        'authImage',
        'baseCredit',
        'exportName',
        'icon',
        'logoOnDark',
        'logoOnLight',
        'productName',
        'supportEmail',
        'tagline',
      ].sort(),
    );
    expect(app).toMatchObject({
      productName: 'Acme CRM',
      tagline: 'Vendas',
      supportEmail: 'suporte@acme.example',
      authImage: null,
      exportName: 'acme',
      baseCredit: true,
    });
    expect(app.logoOnLight).toMatch(/^\/brand\/acme-light\.svg\?v=[0-9a-f]{8}$/);
    expect(app.icon).toMatch(/^\/brand\/acme-icon\.svg\?v=[0-9a-f]{8}$/);
    // O hash acompanha o conteúdo: um logo trocado com o mesmo nome muda o endereço.
    writeFileSync(path.join(dir, 'acme-light.svg'), SVG.replace('40', '41'));
    expect(appBrand(brand, { dir }).logoOnLight).not.toBe(app.logoOnLight);
    expect(appBrand(brand, { dir }).logoOnDark).toBe(app.logoOnDark);
    expect(appBrand(brand, { dir, env: { VITE_SHOW_BASE_CREDIT: 'false' } }).baseCredit).toBe(false);
    expect(appBrand(brand, { dir, hashes: false }).logoOnDark).toBe('/brand/acme-dark.svg');
    // Com a marca do programa, sem o hash (como no Vitest).
    expect(appBrand(normalizeBrand(PROGRAM_BRAND, noFiles), { hashes: false })).toEqual({
      productName: 'Empreende.IA · CRM',
      tagline: 'Relacionamentos que fazem o negócio crescer.',
      supportEmail: '',
      logoOnLight: '/brand/eia-logo-on-light.svg',
      logoOnDark: '/brand/eia-logo-on-dark.svg',
      icon: '/brand/eia-icon.svg',
      authImage: '/brand/eia-auth-art.jpg',
      exportName: 'empreende-ia',
      baseCredit: false,
    });
  });

  it('nome dos arquivos exportados', () => {
    expect(exportSlug('Acme Soluções · CRM')).toBe('acme-solucoes-crm');
    expect(exportSlug('···')).toBe('');
    expect(exportSlug(`${'Muito longo '.repeat(5)}CRM`)).toHaveLength(40);
    expect(exportSlug(`${'Muito longo '.repeat(5)}CRM`)).not.toMatch(/-$/);
    expect(exportFileNameFor('empreende-ia', 'contatos', 'csv')).toBe('contatos-empreende-ia.csv');
    expect(exportFileNameFor('acme', 'oportunidades', 'csv', '2026-10-13')).toBe('oportunidades-acme-2026-10-13.csv');
    expect(exportFileNameFor('', 'agenda', 'ics')).toBe('agenda.ics');
  });
});

describe('index.html (brandHtml)', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  it('o index.html versionado tem os marcadores e sai com o título, o og:title e o favicon da marca', () => {
    // Com a marca da instância, qualquer que seja ela.
    const brand = readBrand();
    const output = brandHtml(html, brand);
    expect(output).not.toContain('%CRM_BRAND_');
    expect(output).toContain(`<title>${escapeHtml(brand.productName)}</title>`);
    expect(output).toContain(`<meta property="og:title" content="${escapeHtml(brand.productName)}" />`);
    const icon = brand.favicon || brand.icon;
    if (icon) expect(output).toContain(`href="/brand/${icon}?v=`);
    else expect(output).not.toContain('rel="icon"');
    // Com a marca do programa (sem o hash, para não depender dos arquivos da pasta).
    const program = brandHtml(html, normalizeBrand(PROGRAM_BRAND, noFiles), { hashes: false });
    expect(program).toContain('<link rel="icon" type="image/svg+xml" href="/brand/eia-icon.svg" />');
    expect(program).toContain('<title>Empreende.IA · CRM</title>');
    expect(program).toContain('<meta property="og:title" content="Empreende.IA · CRM" />');
  });

  it('escapa o nome, escolhe o tipo do ícone e prefere o favicon', () => {
    const icon = (fields, files) => {
      const dir = brandDir({ productName: 'A & B <"CRM">', ...fields }, files);
      return brandHtml(html, readBrand({ dir }), { dir });
    };
    const svg = icon({ icon: 'i.svg' }, { 'i.svg': SVG });
    expect(svg).toContain('<title>A &amp; B &lt;&quot;CRM&quot;&gt;</title>');
    expect(svg).toContain('<meta property="og:title" content="A &amp; B &lt;&quot;CRM&quot;&gt;" />');
    expect(svg).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/brand\/i\.svg\?v=[0-9a-f]{8}" \/>/);
    expect(icon({ icon: 'i.png' }, { 'i.png': 'x' })).toMatch(/type="image\/png" href="\/brand\/i\.png\?v=/);
    expect(icon({ icon: 'i.svg', favicon: 'f.ico' }, { 'i.svg': SVG, 'f.ico': 'x' })).toMatch(
      /<link rel="icon" type="image\/x-icon" href="\/brand\/f\.ico\?v=[0-9a-f]{8}" \/>/,
    );
    const none = icon({}, {});
    expect(none).not.toContain('rel="icon"');
    expect(none).not.toContain('%CRM_BRAND_');
    // "$&" no nome não vira padrão de substituição.
    expect(icon({ productName: 'R$& CRM' }, {})).toContain('<title>R$&amp; CRM</title>');
  });

  it('recusa o index.html sem os marcadores ou com um marcador desconhecido', () => {
    const brand = normalizeBrand(PROGRAM_BRAND, noFiles);
    expect(() => brandHtml('<title>CRM</title>', brand, { hashes: false })).toThrow(
      /faltam os marcadores da marca: <title>%CRM_BRAND_NAME%<\/title>, <meta property="og:title" content="%CRM_BRAND_NAME%" \/>, <!-- %CRM_BRAND_ICON% -->/,
    );
    expect(() => brandHtml(`${html}<p>%CRM_BRAND_SLOGAN%</p>`, brand, { hashes: false })).toThrow(
      /sobrou um marcador %CRM_BRAND_/,
    );
  });
});

describe('plugin do Vite (crm-brand)', () => {
  // Isola as variáveis do .env.local de quem roda: process.env vence o arquivo.
  async function runConfig(command, { isPreview = false, customDir, extraEnv = {}, mode = 'test' } = {}) {
    const keys = ['CRM_BRAND_DIR', 'VITE_SHOW_BASE_CREDIT', 'VITE_SUPPORT_EMAIL', ...Object.keys(extraEnv)];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, { VITE_SHOW_BASE_CREDIT: '', VITE_SUPPORT_EMAIL: '', ...extraEnv });
    if (customDir) process.env.CRM_BRAND_DIR = customDir;
    else delete process.env.CRM_BRAND_DIR;
    try {
      const plugin = brandPlugin();
      const result = await plugin.config({ root: ROOT }, { mode, command, isPreview });
      return { plugin, result, app: JSON.parse(result.define.__CRM_BRAND__) };
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it('no servidor de desenvolvimento, CRM_BRAND_DIR troca a pasta da marca', async () => {
    const dir = brandDir({ ...ACME, exportName: 'acme' }, ACME_FILES);
    const { app, plugin } = await runConfig('serve', { customDir: dir });
    expect(app.productName).toBe('Acme CRM');
    expect(app.baseCredit).toBe(true);
    const html = await plugin.transformIndexHtml.handler(readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
    expect(html).toContain('<title>Acme CRM</title>');
    expect(plugin.transformIndexHtml.order).toBe('pre');
    const off = await runConfig('serve', { customDir: dir, extraEnv: { VITE_SHOW_BASE_CREDIT: 'false' } });
    expect(off.app.baseCredit).toBe(false);
  });

  it('no build, CRM_BRAND_DIR reprova; na preview, é ignorada', async () => {
    const dir = brandDir({ ...ACME }, ACME_FILES);
    const failure = await runConfig('build', { customDir: dir }).catch((error) => error);
    expect(failure).toBeInstanceOf(BrandError);
    expect(failure.message).toContain('CRM_BRAND_DIR só vale no servidor de desenvolvimento dos testes');
    expect(failure.stack).toBe(failure.message);
    const preview = await runConfig('serve', { customDir: dir, isPreview: true });
    expect(preview.app.productName).toBe(readBrand().productName);
  });

  // Item 1.11 (achado 1 da revisão do 1.10): o E2E roda sobre o build, e a marca dos testes vai num build --mode e2e.
  it('no build --mode e2e, CRM_BRAND_DIR troca a marca, e o build de produção continua recusando', async () => {
    const dir = brandDir({ ...ACME, exportName: 'acme' }, ACME_FILES);
    const { app, plugin } = await runConfig('build', { customDir: dir, mode: 'e2e' });
    expect(app.productName).toBe('Acme CRM');
    expect(app.icon).toMatch(/^\/brand\/acme-icon\.svg\?v=[0-9a-f]{8}$/);
    const html = await plugin.transformIndexHtml.handler(readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
    expect(html).toContain('<title>Acme CRM</title>');
    // A pasta brand/ do build (copiada de public/brand) passa a ter só as imagens da marca dos testes.
    const out = mkdtempSync(path.join(tmpdir(), 'crm-e2e-build-'));
    temporaryDirs.push(out);
    mkdirSync(path.join(out, 'brand'));
    writeFileSync(path.join(out, 'brand', 'eia-icon.svg'), SVG);
    plugin.writeBundle({ dir: out });
    expect(readdirSync(path.join(out, 'brand')).sort()).toEqual([
      'acme-dark.svg',
      'acme-icon.svg',
      'acme-light.svg',
      'brand.json',
    ]);
    for (const mode of ['production', 'deployment']) {
      const failure = await runConfig('build', { customDir: dir, mode }).catch((error) => error);
      expect(failure, mode).toBeInstanceOf(BrandError);
      expect(failure.message).toContain('CRM_BRAND_DIR só vale no servidor de desenvolvimento dos testes');
    }
    // Sem a pasta, o build e2e é igual ao de produção, e a pasta brand/ do build fica como veio de public/brand.
    const plain = await runConfig('build', { mode: 'e2e' });
    expect(plain.app.productName).toBe(readBrand().productName);
    plain.plugin.writeBundle({ dir: out });
    expect(existsSync(path.join(out, 'brand', 'acme-icon.svg'))).toBe(true);
  });

  it('copyBrandDir copia só os arquivos da pasta com nome e tipo aceitos', () => {
    const dir = brandDir({ ...ACME }, { ...ACME_FILES, 'notas.txt': 'x', 'acme icon.svg': SVG });
    mkdirSync(path.join(dir, 'sub.svg'));
    const out = mkdtempSync(path.join(tmpdir(), 'crm-e2e-copy-'));
    temporaryDirs.push(out);
    mkdirSync(path.join(out, 'brand'));
    writeFileSync(path.join(out, 'brand', 'eia-light.svg'), SVG);
    expect(copyBrandDir(dir, path.join(out, 'brand'))).toEqual([
      'acme-dark.svg',
      'acme-icon.svg',
      'acme-light.svg',
      'brand.json',
    ]);
    expect(readdirSync(path.join(out, 'brand')).sort()).toEqual([
      'acme-dark.svg',
      'acme-icon.svg',
      'acme-light.svg',
      'brand.json',
    ]);
  });

  // Revisão do item 1.6: o servidor de desenvolvimento do E2E com CRM_BRAND_DIR não serve nada fora da pasta da marca.
  it('o middleware de CRM_BRAND_DIR serve só os arquivos da pasta, pelo nome exato', () => {
    const dir = brandDir({ ...ACME }, ACME_FILES);
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'logo.svg'), SVG);
    const middleware = brandDirMiddleware(dir);
    // Resposta falsa, no formato do servidor do Vite (connect): statusCode, setHeader e end.
    const request = (url) => {
      const response = {
        statusCode: 200,
        headers: {},
        body: undefined,
        next: false,
        setHeader(name, value) {
          this.headers[name.toLowerCase()] = value;
        },
        end(body) {
          this.body = body;
        },
      };
      middleware({ url }, response, () => {
        response.next = true;
      });
      return response;
    };
    const ok = request('/brand/acme-icon.svg?v=12345678');
    expect(ok).toMatchObject({ statusCode: 200, headers: { 'content-type': 'image/svg+xml' }, next: false });
    expect(ok.body.toString('utf8')).toBe(SVG);
    expect(request('/brand/brand.json').headers['content-type']).toBe('application/json');
    for (const url of [
      // Saídas da pasta: o package.json da raiz do repositório e o brand.json da base.
      `/brand/..%2F..%2F..%2F..%2Fpackage.json`,
      `/brand/..%5C..%5C..%5C..%5Cpackage.json`,
      `/brand/${encodeURIComponent(path.relative(dir, path.join(ROOT, 'package.json')))}`,
      `/brand/${encodeURIComponent(path.join(ROOT, 'package.json'))}`,
      '/brand/../package.json',
      '/brand/sub/logo.svg',
      '/brand/sub%2Flogo.svg',
      // Fora da pasta ou com outra grafia.
      '/brand/eia-icon.svg',
      '/brand/ACME-ICON.svg',
      '/brand/acme-icon.svg.bak',
      '/brand/%E0%A4%A',
    ]) {
      const response = request(url);
      expect(response, url).toMatchObject({ statusCode: 404, next: false });
      expect(response.body, url).toBeUndefined();
    }
    // O resto de public/ segue para o próximo middleware.
    expect(request('/index.html').next).toBe(true);
    expect(request('/brandx/acme-icon.svg').next).toBe(true);
  });

  it('junta os problemas da marca e das variáveis numa mensagem só, sem pilha', () => {
    const dir = brandDir({ productName: '', logoOnLight: 'x y.svg' });
    try {
      loadBrandState({ env: { VITE_SHOW_BASE_CREDIT: 'nao' }, customDir: dir });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BrandError);
      expect(error.problems).toHaveLength(3);
      expect(error.message).toMatch(/brand\.json inválido:\n {2}- "productName" não pode ficar vazio/);
      expect(error.message).toContain('Variáveis de ambiente da marca inválidas');
      expect(error.stack).toBe(error.message);
    }
    const state = loadBrandState({ env: {}, customDir: brandDir({ ...ACME }, ACME_FILES) });
    expect(state.summary).toMatch(/^Marca: Acme CRM \(.+brand\.json\) · crédito: ligado \(brand\.json\)$/);
  });
});

describe('npm run brand:check', () => {
  const script = path.join(ROOT, 'scripts', 'check-brand.mjs');
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, VITE_SHOW_BASE_CREDIT: '', VITE_SUPPORT_EMAIL: '', ...env },
    });

  it('a marca da instância passa e mostra o resumo', () => {
    const result = run([]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^public\/brand\/brand\.json: marca ".+" válida\.\n {2}Aba do navegador: /);
    expect(result.stdout).toContain('  E-mails do Auth (supabase/templates/): em dia');
  });

  it('com outra marca, resume a marca e avisa dos e-mails desatualizados sem reprovar', () => {
    const dir = brandDir({ ...ACME, exportName: 'acme', supportEmail: 'suporte@acme.example' }, ACME_FILES);
    const result = run(['--dir', dir], { VITE_SHOW_BASE_CREDIT: 'false' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('marca "Acme CRM" válida.');
    expect(result.stdout).toContain('  Aba do navegador: Acme CRM (ícone acme-icon.svg)');
    expect(result.stdout).toContain(
      '  Arquivos exportados: contatos-acme.csv, agenda-acme.ics e oportunidades-acme-AAAA-MM-DD.csv',
    );
    expect(result.stdout).toContain('  E-mail de suporte: suporte@acme.example (brand.json)');
    expect(result.stdout).toContain(
      '  Crédito "Feito com Empreende.IA": não aparece no app (VITE_SHOW_BASE_CREDIT=false); nos e-mails, segue o brand.json (aparece)',
    );
    expect(result.stdout).toContain(
      '  E-mails do Auth (supabase/templates/): desatualizados: rode npm run emails:build e aplique os modelos no painel (supabase/templates/README.md)',
    );
    expect(result.stdout).toContain('Avisos:\n  - VITE_SHOW_BASE_CREDIT=false é diferente do "showBaseCredit"');
  });

  it('com erro, sai com 1 e lista os problemas da marca e das variáveis', () => {
    const dir = brandDir({ productName: 'Acme', logoOnLight: 'logo.png' });
    const result = run(['--dir', dir], { VITE_SHOW_BASE_CREDIT: 'nao' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('"logoOnLight" é "logo.png", mas');
    expect(result.stderr).toContain('VITE_SHOW_BASE_CREDIT é "nao"');
    expect(result.stderr).not.toMatch(/\bat \w+ \(/);
    expect(run(['--outro']).status).toBe(2);
  });

  it('o SVG da revisão que é a própria folha XSLT reprova o brand:check (achado 3 da revisão do item 1.6)', () => {
    const svg = `<?xml version="1.0"?>
<?xml-stylesheet type="text/xsl" href="logo-acme.svg"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xsl:version="1.0" viewBox="0 0 40 10"><rect width="40" height="10"/><text id="t" y="8">logo</text><xsl:element name="script" namespace="http://www.w3.org/2000/svg">document.getElementById('t').textContent='SCRIPT RAN '+location.origin+' '+typeof localStorage;</xsl:element></svg>
`;
    const dir = brandDir(
      { productName: 'Acme Vendas', logoOnLight: 'logo-acme.svg', logoOnDark: 'logo-acme.svg', icon: 'logo-acme.svg' },
      { 'logo-acme.svg': svg },
    );
    const result = run(['--dir', dir]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    for (const field of ['logoOnLight', 'logoOnDark', 'icon'])
      expect(result.stderr).toContain(
        `"${field}" (logo-acme.svg) tem <?xml-stylesheet?>, que um logo não usa, e foi recusado`,
      );
  });

  it('a cópia da pasta da base com só o productName trocado reprova, campo por campo (revisão do item 1.6)', () => {
    const versioned = JSON.parse(readFileSync(path.join(BRAND_DIR, 'brand.json'), 'utf8'));
    const dir = brandDir({ ...versioned, ...PROGRAM_BRAND, productName: 'Acme Vendas · CRM' }, programFiles);
    const result = run(['--dir', dir]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    for (const field of ['shortName', 'exportName', 'logoOnLight', 'logoOnDark', 'icon', 'authImage', 'emailLogo'])
      expect(result.stderr, field).toContain(`  - "${field}" `);
  });
});
