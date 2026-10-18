// Marca da instância (item 1.6; docs/arquitetura/1.6.md): nome, slogan, logos, ícone, arte da entrada, e-mail de
// suporte, nome dos arquivos exportados e o crédito "Feito com Empreende.IA" vêm de public/brand/brand.json e das imagens
// dessa pasta. É a fonte única: o plugin do Vite (`brandPlugin`, em vite.config.ts) lê o arquivo no `dev` e no `build`, o
// gerador dos e-mails do Auth (scripts/lib/auth-emails.mjs) lê o mesmo arquivo, e `npm run brand:check`
// (scripts/check-brand.mjs) confere tudo antes da publicação. Sem dependências além do Node (o `vite` só é carregado
// dentro do plugin).
//
// Regras (seção 4 do desenho):
// - o padrão é a marca do programa (PROGRAM_BRAND, igual ao brand.json versionado); um campo ausente recebe um padrão
//   neutro e nunca herda uma imagem do programa;
// - imagens só pelo nome do arquivo nesta pasta, com as mesmas maiúsculas (o Windows não diferencia, a hospedagem sim);
// - todos os problemas aparecem de uma vez, em pt-BR e sem a pilha do JavaScript (BrandError);
// - o objeto que vai para o navegador (`appBrand`) só tem valores públicos, que já aparecem na tela.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BRAND_DIR = path.join(ROOT, 'public', 'brand');
export const BRAND_FILE = path.join(BRAND_DIR, 'brand.json');
// Arquivo de marca dos e-mails até o item 1.6: só existe para a mensagem que explica para onde foi cada campo.
export const LEGACY_EMAIL_BRAND_FILE = path.join(ROOT, 'supabase', 'templates', 'brand.json');
export const BASE_CREDIT_TEXT = 'Feito com Empreende.IA';
export const MAX_IMAGE_BYTES = 1024 * 1024;
const GUIDE = 'docs/MARCA.md';

// Valores do brand.json da base (a marca do programa). O teste confere que o arquivo versionado é igual a eles enquanto
// a marca for a do programa.
export const PROGRAM_BRAND = Object.freeze({
  productName: 'Empreende.IA · CRM',
  shortName: 'Empreende.IA · CRM',
  tagline: 'Relacionamentos que fazem o negócio crescer.',
  supportEmail: '',
  logoOnLight: 'eia-logo-on-light.svg',
  logoOnDark: 'eia-logo-on-dark.svg',
  icon: 'eia-icon.svg',
  favicon: '',
  authImage: 'eia-auth-art.jpg',
  emailLogo: 'eia-email.png',
  emailLogoWidth: 185,
  exportName: 'empreende-ia',
  showBaseCredit: true,
});

// Arquivos da marca do programa em public/brand: com outra marca, são recusados (o topo mostraria o programa e o resto
// a empresa).
const PROGRAM_ASSET_LABELS = Object.freeze({
  'eia-logo-on-light.svg': 'o logo da Empreende.IA',
  'eia-logo-on-dark.svg': 'o logo da Empreende.IA',
  'eia-icon.svg': 'o ícone da Empreende.IA',
  'eia-auth-art.jpg': 'a arte da Empreende.IA',
  'eia-email.png': 'o logo da Empreende.IA para e-mail',
});
export const PROGRAM_ASSETS = Object.freeze(Object.keys(PROGRAM_ASSET_LABELS));

// Campos aceitos, na ordem do guia. `empty` completa as mensagens com o que o "" faz em cada imagem.
const IMAGE_FIELDS = Object.freeze({
  logoOnLight: {
    extensions: ['svg', 'png', 'webp', 'jpg', 'jpeg'],
    types: 'SVG, PNG, WEBP ou JPG',
    empty: 'para mostrar o nome em texto',
    own: 'o logo da empresa',
  },
  logoOnDark: {
    extensions: ['svg', 'png', 'webp', 'jpg', 'jpeg'],
    types: 'SVG, PNG, WEBP ou JPG',
    empty: 'para mostrar o nome em texto',
    own: 'o logo da empresa',
  },
  icon: {
    extensions: ['svg', 'png', 'webp'],
    types: 'SVG, PNG ou WEBP',
    empty: 'para usar a primeira letra do nome',
    own: 'o ícone da empresa',
  },
  favicon: {
    extensions: ['svg', 'png', 'ico'],
    types: 'SVG, PNG ou ICO',
    empty: 'para usar o "icon"',
    own: 'o ícone da empresa',
  },
  authImage: {
    extensions: ['jpg', 'jpeg', 'png', 'webp'],
    types: 'JPG, PNG ou WEBP',
    empty: 'para deixar o painel da entrada sem imagem',
    own: 'a arte da empresa',
  },
  emailLogo: {
    extensions: ['png', 'jpg', 'jpeg', 'gif'],
    types: 'PNG, JPG ou GIF',
    empty: 'para mostrar o nome em texto',
    own: 'o logo da empresa para e-mail',
  },
});
const FIELDS = Object.freeze({
  productName: { kind: 'text', required: true, max: 60 },
  shortName: { kind: 'text', max: 40 },
  tagline: { kind: 'text', max: 120 },
  supportEmail: { kind: 'email' },
  logoOnLight: { kind: 'image' },
  logoOnDark: { kind: 'image' },
  icon: { kind: 'image' },
  favicon: { kind: 'image' },
  authImage: { kind: 'image' },
  emailLogo: { kind: 'emailLogo' },
  emailLogoWidth: { kind: 'int', min: 40, max: 300 },
  // Sem `max`: o limite entra na mensagem própria do campo.
  exportName: { kind: 'slug', limit: 40 },
  showBaseCredit: { kind: 'boolean' },
});
export const BRAND_FIELDS = Object.freeze(Object.keys(FIELDS));

// Sem o campo: padrões neutros. `shortName` e `exportName` derivam do productName (null = derivar).
const DEFAULTS = Object.freeze({
  shortName: null,
  tagline: '',
  supportEmail: '',
  logoOnLight: '',
  logoOnDark: '',
  icon: '',
  favicon: '',
  authImage: '',
  emailLogo: '',
  emailLogoWidth: 185,
  exportName: null,
  showBaseCredit: true,
});

export const EMAIL_PATTERN = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]+$/;
// Nome de arquivo desta pasta: letras sem acento, números, ponto, hífen e sublinhado, sem pasta.
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTENT_TYPES = Object.freeze({
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  json: 'application/json',
});

/** Caminho para as mensagens: relativo à raiz do repositório, com barras, ou absoluto quando fica fora dele. */
export function displayPath(file) {
  const relative = path.relative(ROOT, file);
  const inside = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  return (inside ? relative : file).split(path.sep).join('/');
}

/**
 * Lista de problemas de um arquivo de configuração, com o arquivo no título e o que fazer no fim. A pilha do JavaScript
 * sai da mensagem (`stack === message`): o Vite e a Vercel mostram só o texto.
 */
export class BrandError extends Error {
  constructor(problems, { file = displayPath(BRAND_FILE), title, hint } = {}) {
    const heading = title ?? `${file} inválido:`;
    const footer = hint === undefined ? `Corrija ${file} (campos explicados em ${GUIDE}).` : hint;
    super([heading, ...problems.map((problem) => `  - ${problem}`), ...(footer ? [`  ${footer}`] : [])].join('\n'));
    this.name = 'BrandError';
    this.file = file;
    this.problems = problems;
    this.stack = this.message;
  }

  /** Junta os blocos de vários arquivos numa mensagem só (marca e variáveis de ambiente). */
  static join(errors) {
    const [first, ...rest] = errors;
    if (!rest.length) return first;
    const joined = new BrandError([], { file: first.file });
    joined.message = errors.map((error) => error.message).join('\n');
    joined.stack = joined.message;
    joined.problems = errors.flatMap((error) => error.problems);
    return joined;
  }
}

const ENV_ERROR = Object.freeze({
  file: 'variáveis de ambiente',
  title: 'Variáveis de ambiente da marca inválidas (na hospedagem ou no .env.local):',
  hint: 'Corrija o valor ou apague a variável na hospedagem (na Vercel: Settings → Environment Variables), no .env.local ou no terminal e rode de novo.',
});

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const extensionOf = (name) => (name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? '').toLowerCase();

export function isHttpsUrl(value) {
  if (/[\s"'<>`\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** "Acme Soluções · CRM" vira "acme-solucoes-crm": sem acento, minúsculas e hífen, até 40 caracteres. */
export function exportSlug(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/**
 * Nome de um arquivo exportado: `base[-exportName][-data].extensão`. Igual ao buildExportFileName de
 * src/lib/export-file-name.ts, que as telas usam (o teste confere); aqui, para o brand:check em Node puro.
 */
export function exportFileNameFor(exportName, base, extension, date) {
  return `${[base, exportName, date].filter(Boolean).join('-')}.${extension}`;
}

// Sugestão de nome válido para a mensagem: "Logo Acme.png" vira "logo-acme.png".
function suggestFileName(value) {
  const base = value.split(/[\\/]/).filter(Boolean).pop() ?? '';
  const extension = extensionOf(base);
  const stem = exportSlug(extension ? base.slice(0, -(extension.length + 1)) : base) || 'logo';
  return extension ? `${stem}.${extension}` : stem;
}

// "Empreende.IA · CRM", "Empreende IA CRM" e "empreende-ia" citam o programa: "empreendeia" só com as letras.
const mentionsProgram = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .includes('empreendeia');

/**
 * A marca já é a do programa? Então o crédito "Feito com Empreende.IA" repetiria a marca e nunca aparece (D3), e os
 * arquivos do programa são aceitos. Decide só o `productName`: o aluno que troca o nome e esquece o resto do arquivo
 * versionado tem a marca tratada como outra, e a validação aponta cada campo que ficou com o valor do programa (revisão
 * do item 1.6). O `shortName` e o `exportName` precisam concordar com ele (`normalizeBrand`).
 */
export function isProgramBrand(brand) {
  return mentionsProgram(brand.productName);
}

function checkText(key, rule, value) {
  if (typeof value !== 'string') return `"${key}" precisa ser um texto entre aspas`;
  const content = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(content)) return `"${key}" não pode ter quebras de linha nem caracteres de controle`;
  if (/\{\{|\}\}/.test(content)) return `"${key}" não pode conter {{ nem }}, que o Supabase leria como variável`;
  if (content.includes('�'))
    return `"${key}" tem caracteres trocados (�): salve o brand.json em UTF-8 (no Bloco de Notas: Arquivo → Salvar como → Codificação: UTF-8)`;
  if (rule.required && !content) return `"${key}" não pode ficar vazio`;
  if (rule.max && content.length > rule.max) return `"${key}" passa de ${rule.max} caracteres`;
  return null;
}

// Formato do nome de uma imagem (sem olhar a pasta): mensagens 6, 7 e 13 do desenho.
function checkImageName(key, value) {
  const image = IMAGE_FIELDS[key];
  if (key === 'emailLogo' && /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return isHttpsUrl(value) ? null : emailLogoMessage();
  }
  if (!FILE_NAME.test(value) || value.includes('..'))
    return `"${key}" é "${value}", mas o nome do arquivo só pode ter letras sem acento, números, ponto, hífen e sublinhado, sem espaços nem pastas, como "${suggestFileName(value)}"`;
  if (!image.extensions.includes(extensionOf(value)))
    return key === 'emailLogo'
      ? emailLogoMessage()
      : `"${key}" precisa ser uma imagem ${image.types} desta pasta, ou "" ${image.empty}`;
  return null;
}

const emailLogoMessage = () =>
  '"emailLogo" precisa ser uma imagem PNG, JPG ou GIF desta pasta (como "logo-email.png"), um endereço https:// completo ou "" para mostrar o nome em texto. E-mail não aceita SVG';

// Arquivo do programa (pelo nome, sem diferenciar maiúsculas) ou endereço https:// que termina nele.
function programAssetOf(key, value) {
  if (/^https:/i.test(value)) {
    const match = value.match(/(?:^|\/)(eia-email\.png)(?:$|[?#])/i);
    return match ? 'eia-email.png' : null;
  }
  return PROGRAM_ASSETS.find((asset) => asset.toLowerCase() === value.toLowerCase()) ?? null;
}

const formatMegabytes = (bytes) => `${(Math.ceil(bytes / 104857.6) / 10).toFixed(1).replace('.', ',')} MB`;

// Referências de caractere do XML decodificadas, para "javascript&#58;" ou "&lt;script&gt;" (num srcdoc) não escaparem.
const NAMED_ENTITIES = Object.freeze({
  colon: ':',
  tab: '\t',
  newline: '\n',
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
});
function decodeEntities(text) {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));?/gi, (match, hex, decimal, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? match;
    const code = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/**
 * SVG que executaria script se aberto direto no domínio do CRM: recusado (numa <img>, o SVG nunca executa script).
 * Confere o texto como está e com as referências de caractere decodificadas: `<script` com ou sem prefixo de namespace
 * (`<h:script>`), atributo `on…=` e endereço `javascript:` ou `vbscript:`, mesmo com espaços ou tabulações no meio. É um
 * reforço: o que protege de verdade é o cabeçalho de /brand/* no vercel.json (CSP com `sandbox`), que não deixa nenhum
 * script do SVG rodar.
 */
export function svgHasScript(svg) {
  return [svg, decodeEntities(svg)].some(
    (text) =>
      /<(?:[\w.-]+:)?script\b/i.test(text) ||
      /\son[a-z]+\s*=/i.test(text) ||
      /(?:java|vb)script:/i.test(text.replace(/[\s\u0000-\u001f]+/g, '')),
  );
}

// Conteúdo que um logo não usa e que abriria HTML ou outro documento dentro do SVG: a primeira ocorrência entra na
// mensagem. `<!ENTITY` declara texto que só aparece depois de expandido (o "<script>" de uma entidade). Revisão do item
// 1.6, achado 3 (corrigido no item 1.9): um SVG que é a própria folha XSLT (`<?xml-stylesheet type="text/xsl"
// href="#"?>` com `xsl:version` e `<xsl:element name="script">`) gera o script sem escrever "<script"; por isso saem
// qualquer instrução de processamento além da declaração XML (`<?xml-stylesheet`, `<?php`…), o namespace do XSLT com
// qualquer prefixo e o prefixo `xsl:`.
const SVG_ACTIVE_CONTENT = Object.freeze([
  [/<\?xml-stylesheet\b/i, '<?xml-stylesheet?>'],
  [/<\?(?!xml[\s?])/i, 'uma instrução de processamento'],
  [/http:\/\/www\.w3\.org\/1999\/XSL\/Transform/i, 'XSLT'],
  [/<\/?xsl:|\sxsl:[\w.-]+\s*=/i, 'XSLT'],
  [/<!ENTITY/i, '<!ENTITY>'],
  [/<(?:[\w.-]+:)?foreignObject\b/i, '<foreignObject>'],
  [/<(?:[\w.-]+:)?iframe\b/i, '<iframe>'],
  [/<(?:[\w.-]+:)?embed\b/i, '<embed>'],
  [/<(?:[\w.-]+:)?object\b/i, '<object>'],
  [/\ssrcdoc\s*=/i, 'srcdoc'],
]);

/**
 * Motivo para recusar um SVG da pasta, ou null: `encoding` (UTF-16 ou binário, que a leitura em UTF-8 não enxergaria),
 * `script` (mensagem 11) ou `active` (instrução de processamento, XSLT, <!ENTITY>, <foreignObject>, <iframe>, <embed>,
 * <object> ou srcdoc; mensagem 11b, com o que foi achado em `found`).
 */
export function svgRefusal(content) {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (utf16 || bytes.includes(0)) return { reason: 'encoding' };
  const svg = bytes.toString('utf8');
  if (svgHasScript(svg)) return { reason: 'script' };
  const decoded = decodeEntities(svg);
  const active = SVG_ACTIVE_CONTENT.find(([pattern]) => pattern.test(svg) || pattern.test(decoded));
  return active ? { reason: 'active', found: active[1] } : null;
}

/** SVG que busca fonte ou imagem fora: numa <img>, o recurso externo não carrega (aviso). */
export const svgHasExternalReference = (svg) =>
  /(?:href|src)\s*=\s*["']\s*https?:/i.test(svg) || /url\(\s*["']?\s*https?:/i.test(svg);

function listDirectory(dir) {
  try {
    return readdirSync(dir).sort();
  } catch {
    return null;
  }
}

// Conferência na pasta: mensagens 8, 9, 10 e 11 do desenho.
function checkImageFile(key, name, dir, listing) {
  const folder = displayPath(dir);
  if (!listing) return `"${key}" é "${name}", mas a pasta ${folder} não existe`;
  if (!listing.includes(name)) {
    const other = listing.find((entry) => entry.toLowerCase() === name.toLowerCase());
    if (other)
      return `"${key}" é "${name}", mas o arquivo na pasta se chama "${other}". Use o nome exatamente igual, com as mesmas maiúsculas: o site publicado diferencia maiúsculas de minúsculas`;
    return `"${key}" é "${name}", mas ${folder}/${name} não existe. Arquivos nesta pasta: ${listing.join(', ') || '(nenhum)'}. No Windows, ative "Extensões de nomes de arquivos" no Explorador (Exibir → Mostrar) para ver o nome inteiro`;
  }
  const file = path.join(dir, name);
  const stat = statSync(file);
  if (!stat.isFile()) return `"${key}" é "${name}", mas ${folder}/${name} não é um arquivo`;
  if (stat.size > MAX_IMAGE_BYTES)
    return `"${key}" (${name}) tem ${formatMegabytes(stat.size)}; o limite é 1 MB. Reduza a imagem, por exemplo para 1600 × 900 px`;
  if (extensionOf(name) !== 'svg') return null;
  const refusal = svgRefusal(readFileSync(file));
  if (refusal?.reason === 'encoding')
    return `"${key}" (${name}) não é um SVG em texto UTF-8 (está em UTF-16 ou compactado) e foi recusado. Exporte o SVG de novo em UTF-8`;
  if (refusal?.reason === 'script')
    return `"${key}" (${name}) tem script e foi recusado. Exporte o SVG de novo, sem scripts`;
  if (refusal?.reason === 'active')
    return `"${key}" (${name}) tem ${refusal.found}, que um logo não usa, e foi recusado. Exporte o SVG de novo como SVG simples`;
  return null;
}

/**
 * Confere a marca e devolve uma cópia com todos os campos preenchidos. Chaves que começam com "_" são comentários; uma
 * chave desconhecida é recusada, para pegar erro de grafia. Com `checkFiles`, as imagens citadas precisam existir em
 * `dir` com o nome exato, ter até 1 MB e, se forem SVG, não ter script.
 */
export function normalizeBrand(input, { dir = BRAND_DIR, checkFiles = true } = {}) {
  const file = displayPath(path.join(dir, 'brand.json'));
  if (!isPlainObject(input))
    throw new BrandError(['o arquivo precisa ser um objeto JSON, como { "productName": "…" }'], { file });
  const problems = [];
  const brand = { productName: '', ...DEFAULTS };
  for (const key of Object.keys(input)) {
    if (!key.startsWith('_') && !(key in FIELDS))
      problems.push(`"${key}" não é um campo conhecido (confira a grafia; campos: ${BRAND_FIELDS.join(', ')})`);
  }
  const invalid = new Set();
  for (const [key, rule] of Object.entries(FIELDS)) {
    const value = input[key];
    if (value === undefined) {
      if (rule.required) {
        problems.push(`"${key}" é obrigatório`);
        invalid.add(key);
      }
      continue;
    }
    const problem = checkField(key, rule, value);
    if (problem) {
      problems.push(problem);
      invalid.add(key);
    } else brand[key] = typeof value === 'string' ? value.trim() : value;
  }
  // "shortName": "" vale como ausente: o assunto dos e-mails nunca termina em "· ".
  if (brand.shortName === '') brand.shortName = null;
  // O nome curto e o nome dos arquivos escritos no arquivo concordam com o productName: o aluno que trocou só o nome no
  // brand.json versionado ainda tem "Empreende.IA · CRM" e "empreende-ia" ali (revisão do item 1.6).
  if (!invalid.has('productName')) {
    const program = isProgramBrand(brand);
    if (brand.shortName !== null && !invalid.has('shortName') && mentionsProgram(brand.shortName) !== program) {
      problems.push(
        program
          ? `"shortName" é "${brand.shortName}", mas o "productName" ainda é o da Empreende.IA ("${brand.productName}"). Troque também o "productName" pelo nome da empresa`
          : `"shortName" ainda é o da Empreende.IA ("${brand.shortName}"), mas o "productName" é "${brand.productName}". Troque o "shortName" pelo nome curto da empresa (até 40 caracteres) ou apague a linha para usar o "productName"`,
      );
      invalid.add('shortName');
    }
    if (!program && brand.exportName && !invalid.has('exportName') && mentionsProgram(brand.exportName)) {
      problems.push(
        `"exportName" ainda é o da Empreende.IA ("${brand.exportName}"), mas a marca é outra ("${brand.productName}"). Use um nome da empresa, como "${exportSlug(brand.productName) || 'acme-vendas'}", ou apague a linha para gerar o nome a partir do "productName"`,
      );
      invalid.add('exportName');
    }
  }
  if (brand.shortName === null && !invalid.has('productName')) {
    if (brand.productName.length > FIELDS.shortName.max) {
      problems.push(
        '"shortName" ficou com o productName, que passa de 40 caracteres: defina "shortName" com até 40 para os assuntos dos e-mails',
      );
      invalid.add('shortName');
    } else brand.shortName = brand.productName;
  }
  if (brand.exportName === null) brand.exportName = exportSlug(brand.productName);
  // As imagens dependem do nome (arquivos do programa) e da pasta: só com o productName válido.
  if (!invalid.has('productName')) {
    const program = isProgramBrand(brand);
    const listing = checkFiles ? listDirectory(dir) : null;
    for (const key of Object.keys(IMAGE_FIELDS)) {
      const value = brand[key];
      if (!value || invalid.has(key)) continue;
      const asset = programAssetOf(key, value);
      if (asset && !program) {
        problems.push(
          `"${key}" aponta para ${asset}, ${PROGRAM_ASSET_LABELS[asset]}, mas a marca é outra ("${brand.productName}"). Coloque ${IMAGE_FIELDS[key].own} nesta pasta e use o nome do arquivo, ou "" ${IMAGE_FIELDS[key].empty}`,
        );
        continue;
      }
      if (!checkFiles || isHttpsUrl(value)) continue;
      const problem = checkImageFile(key, value, dir, listing);
      if (problem) problems.push(problem);
    }
  }
  if (problems.length) throw new BrandError(problems, { file });
  return brand;
}

function checkField(key, rule, value) {
  if (rule.kind === 'boolean')
    return typeof value === 'boolean' ? null : `"${key}" precisa ser true ou false, sem aspas`;
  if (rule.kind === 'int')
    return Number.isInteger(value) && value >= rule.min && value <= rule.max
      ? null
      : `"${key}" precisa ser um número inteiro de ${rule.min} a ${rule.max}`;
  const textProblem = checkText(key, rule, value);
  if (textProblem) return textProblem;
  const content = value.trim();
  if (!content) return null;
  if (rule.kind === 'email' && !EMAIL_PATTERN.test(content))
    return `"${key}" precisa ser um e-mail, como suporte@suaempresa.com.br, ou "" para não mostrar`;
  if (rule.kind === 'slug' && (!SLUG.test(content) || content.length > rule.limit))
    return `"${key}" precisa ter só letras minúsculas sem acento, números e hífen, como "acme-vendas" (até 40 caracteres), ou "" para os arquivos saírem sem o nome`;
  if (rule.kind === 'image' || rule.kind === 'emailLogo') return checkImageName(key, content);
  return null;
}

/**
 * Revisão do item 1.6, achado 4 (corrigido no item 1.9): o Bloco de Notas oferece "UTF-16 LE" e "UTF-16 BE" no "Salvar
 * como", e o PowerShell 5.1 grava UTF-16 com ">". Lido como UTF-8, o JSON falha, e a mensagem de vírgulas e aspas
 * mandaria procurar um erro que não existe. Vale para o brand.json e para o email-settings.json dos e-mails.
 */
export const UTF16_FILE_MESSAGE =
  'o arquivo está salvo em UTF-16 (Unicode). Salve de novo como UTF-8: no Bloco de Notas, Arquivo → Salvar como → Codificação: UTF-8.';
/** UTF-16 com marca (FF FE ou FE FF) ou sem ela (o byte nulo, que um JSON em UTF-8 nunca tem). */
export const isUtf16Text = (bytes) =>
  (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff) || bytes.includes(0);

/** Lê e confere `<dir>/brand.json` (o BOM do Bloco de Notas é retirado) e as imagens citadas. */
export function readBrand({ dir = BRAND_DIR } = {}) {
  const file = path.join(dir, 'brand.json');
  const shown = displayPath(file);
  let content;
  try {
    const bytes = readFileSync(file);
    if (isUtf16Text(bytes)) throw new BrandError([UTF16_FILE_MESSAGE], { file: shown });
    content = bytes.toString('utf8');
  } catch (error) {
    if (error instanceof BrandError) throw error;
    throw new BrandError(
      [
        error?.code === 'ENOENT'
          ? `o arquivo não existe. Crie ${shown} com pelo menos { "productName": "…" } (exemplo em ${GUIDE})`
          : `não foi possível ler o arquivo (${error?.message ?? error})`,
      ],
      { file: shown },
    );
  }
  let data;
  try {
    data = JSON.parse(content.replace(/^﻿/, ''));
  } catch (error) {
    throw new BrandError(
      [
        `o arquivo não é um JSON válido (${error.message}). Confira vírgulas e aspas: cada linha termina com vírgula, menos a última antes de "}".`,
      ],
      { file: shown },
    );
  }
  return normalizeBrand(data, { dir, checkFiles: true });
}

const envValue = (env, key) => (typeof env?.[key] === 'string' ? env[key].trim() : '');

/**
 * Modo do build do E2E (item 1.11; docs/arquitetura/1.11.md, seção 12): o único build que aceita CRM_BRAND_DIR. Só
 * scripts/e2e-server.mjs o usa, e ele escreve em dist-e2e/, fora do dist de uma implantação. No build de produção e no
 * de implantação, a recusa do 1.6 continua: nenhuma implantação publica a marca de outro cliente.
 */
export const E2E_BUILD_MODE = 'e2e';

/** Problemas das variáveis de ambiente da marca (mensagens 16 a 18 do desenho). */
export function brandEnvProblems(env = {}, { build = false, customDir = '', mode = '' } = {}) {
  const problems = [];
  const credit = envValue(env, 'VITE_SHOW_BASE_CREDIT');
  if (credit && !['true', 'false'].includes(credit.toLowerCase()))
    problems.push(
      `VITE_SHOW_BASE_CREDIT é "${credit}": use true ou false, ou apague a variável para seguir o brand.json`,
    );
  const support = envValue(env, 'VITE_SUPPORT_EMAIL');
  if (support && !EMAIL_PATTERN.test(support))
    problems.push(
      `VITE_SUPPORT_EMAIL é "${support}": use um e-mail ou apague a variável (o e-mail de suporte agora fica em "supportEmail", no brand.json)`,
    );
  if (build && customDir && mode !== E2E_BUILD_MODE)
    problems.push(
      'CRM_BRAND_DIR só vale no servidor de desenvolvimento dos testes; no build, a marca vem de public/brand/brand.json.',
    );
  return problems;
}

function assertEnv(env) {
  const problems = brandEnvProblems(env);
  if (problems.length) throw new BrandError(problems, ENV_ERROR);
}

/**
 * Crédito "Feito com Empreende.IA" no app (AC-4): nunca com a marca do programa; `VITE_SHOW_BASE_CREDIT` ("true" ou
 * "false", sem diferença de maiúsculas) sobrepõe o `showBaseCredit` do brand.json só no app daquela implantação.
 */
export function resolveCredit(brand, env = {}) {
  assertEnv({ VITE_SHOW_BASE_CREDIT: env.VITE_SHOW_BASE_CREDIT });
  if (isProgramBrand(brand)) return { show: false, source: 'programa' };
  const value = envValue(env, 'VITE_SHOW_BASE_CREDIT').toLowerCase();
  if (!value) return { show: brand.showBaseCredit, source: 'brand.json' };
  return { show: value === 'true', source: 'VITE_SHOW_BASE_CREDIT' };
}

/** E-mail de suporte do app: o do brand.json; `VITE_SUPPORT_EMAIL` (obsoleta) só como recuo, sempre com aviso. */
export function resolveSupportEmail(brand, env = {}) {
  assertEnv({ VITE_SUPPORT_EMAIL: env.VITE_SUPPORT_EMAIL });
  const legacy = envValue(env, 'VITE_SUPPORT_EMAIL');
  if (brand.supportEmail)
    return {
      email: brand.supportEmail,
      source: 'brand.json',
      warnings: legacy
        ? [
            `VITE_SUPPORT_EMAIL está obsoleta e foi ignorada: vale o "supportEmail" do brand.json (${brand.supportEmail}). Apague a variável na hospedagem e no .env.local`,
          ]
        : [],
    };
  if (legacy)
    return {
      email: legacy,
      source: 'VITE_SUPPORT_EMAIL',
      warnings: [
        `VITE_SUPPORT_EMAIL está obsoleta: o app usa ${legacy} por enquanto, mas os e-mails de acesso saem sem suporte. Passe o endereço para "supportEmail", no brand.json, rode npm run emails:build e apague a variável`,
      ],
    };
  return { email: '', source: null, warnings: [] };
}

const fileHash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);

/** Endereço público de uma imagem da marca, com `?v=` do conteúdo para um arquivo trocado com o mesmo nome aparecer logo. */
export function brandAssetUrl(name, { dir = BRAND_DIR, hashes = true } = {}) {
  if (!name) return null;
  return `/brand/${name}${hashes ? `?v=${fileHash(path.join(dir, name))}` : ''}`;
}

/** Objeto público que o build injeta no navegador (`__CRM_BRAND__`, src/lib/brand.ts): só valores que aparecem na tela. */
export function appBrand(brand, { dir = BRAND_DIR, env = {}, hashes = true } = {}) {
  const url = (name) => brandAssetUrl(name, { dir, hashes });
  return {
    productName: brand.productName,
    tagline: brand.tagline,
    supportEmail: resolveSupportEmail(brand, env).email,
    logoOnLight: url(brand.logoOnLight),
    logoOnDark: url(brand.logoOnDark),
    icon: url(brand.icon),
    authImage: url(brand.authImage),
    exportName: brand.exportName,
    baseCredit: resolveCredit(brand, env).show,
  };
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const NAME_MARKER = '%CRM_BRAND_NAME%';
export const ICON_MARKER = '<!-- %CRM_BRAND_ICON% -->';
const HTML_MARKERS = Object.freeze([
  ['<title>%CRM_BRAND_NAME%</title>', /<title>\s*%CRM_BRAND_NAME%\s*<\/title>/],
  [
    '<meta property="og:title" content="%CRM_BRAND_NAME%" />',
    /<meta\s+property="og:title"\s+content="%CRM_BRAND_NAME%"\s*\/?>/,
  ],
  [ICON_MARKER, /<!-- %CRM_BRAND_ICON% -->/],
]);

/** Troca os marcadores do index.html pelo nome (título e og:title) e pelo favicon da marca (ou nada, sem ícone). */
export function brandHtml(html, brand, { dir = BRAND_DIR, hashes = true } = {}) {
  const missing = HTML_MARKERS.filter(([, pattern]) => !pattern.test(html)).map(([marker]) => marker);
  if (missing.length)
    throw new BrandError([`faltam os marcadores da marca: ${missing.join(', ')}`], {
      file: 'index.html',
      hint: 'Copie os marcadores do index.html da base: o título, o og:title e o favicon vêm de public/brand/brand.json (docs/MARCA.md).',
    });
  const iconName = brand.favicon || brand.icon;
  const icon = iconName
    ? `<link rel="icon" type="${CONTENT_TYPES[extensionOf(iconName)]}" href="${brandAssetUrl(iconName, { dir, hashes })}" />`
    : '';
  const name = escapeHtml(brand.productName);
  const output = html.replaceAll(NAME_MARKER, () => name).replace(ICON_MARKER, () => icon);
  if (output.includes('%CRM_BRAND_'))
    throw new BrandError(['sobrou um marcador %CRM_BRAND_… que a marca não conhece'], {
      file: 'index.html',
      hint: 'Use só %CRM_BRAND_NAME% e <!-- %CRM_BRAND_ICON% --> (docs/MARCA.md).',
    });
  return output;
}

/**
 * Avisos que não reprovam: o slogan do programa com outra marca, SVG com recurso externo, VITE_SUPPORT_EMAIL obsoleta e
 * o crédito diferente nos e-mails.
 */
export function brandWarnings(brand, { dir = BRAND_DIR, env = {} } = {}) {
  const warnings = [];
  // O slogan não cita o programa, então não reprova; mas é o da Empreende.IA, e o aluno que trocou o resto o esquece.
  if (!isProgramBrand(brand) && brand.tagline === PROGRAM_BRAND.tagline)
    warnings.push(
      `"tagline" ainda é o slogan da Empreende.IA ("${PROGRAM_BRAND.tagline}"): troque pelo slogan da empresa ou use "" para tirar a linha`,
    );
  for (const key of Object.keys(IMAGE_FIELDS)) {
    const name = brand[key];
    if (!name || extensionOf(name) !== 'svg' || isHttpsUrl(name)) continue;
    let svg = '';
    try {
      svg = readFileSync(path.join(dir, name), 'utf8');
    } catch {
      continue;
    }
    if (svgHasExternalReference(svg))
      warnings.push(
        `"${key}" (${name}) busca fonte ou imagem fora do arquivo (http): numa página, o recurso externo não carrega. Converta o texto em curvas ou embuta a fonte no SVG`,
      );
  }
  warnings.push(...resolveSupportEmail(brand, env).warnings);
  const credit = envValue(env, 'VITE_SHOW_BASE_CREDIT').toLowerCase();
  if (credit && isProgramBrand(brand))
    warnings.push('VITE_SHOW_BASE_CREDIT não tem efeito: com a marca do programa, o crédito nunca aparece');
  else if (credit && (credit === 'true') !== brand.showBaseCredit)
    warnings.push(
      `VITE_SHOW_BASE_CREDIT=${credit} é diferente do "showBaseCredit" do brand.json (${brand.showBaseCredit}): o app segue a variável, e os e-mails seguem o brand.json`,
    );
  return warnings;
}

const CREDIT_SOURCES = {
  programa: 'marca do programa',
  'brand.json': 'brand.json',
  VITE_SHOW_BASE_CREDIT: 'VITE_SHOW_BASE_CREDIT',
};

/**
 * Marca da instância para o build: escolhe a pasta, lê e confere a marca e as variáveis e monta o objeto público.
 * `CRM_BRAND_DIR` só vale no servidor de desenvolvimento e no build do E2E (`--mode e2e`, item 1.11); nos demais builds
 * reprova, e na `preview`, que serve o dist já gerado, é ignorada. Junta os problemas da marca e das variáveis numa
 * mensagem só.
 */
export function loadBrandState({
  root = ROOT,
  env = {},
  command = 'serve',
  isPreview = false,
  mode = '',
  customDir = process.env.CRM_BRAND_DIR,
} = {}) {
  const custom = typeof customDir === 'string' ? customDir.trim() : '';
  const useCustom =
    Boolean(custom) && ((command === 'serve' && !isPreview) || (command === 'build' && mode === E2E_BUILD_MODE));
  const dir = useCustom ? path.resolve(root, custom) : BRAND_DIR;
  const errors = [];
  let brand = null;
  try {
    brand = readBrand({ dir });
  } catch (error) {
    if (!(error instanceof BrandError)) throw error;
    errors.push(error);
  }
  const envProblems = brandEnvProblems(env, { build: command === 'build', customDir: custom, mode });
  if (envProblems.length) errors.push(new BrandError(envProblems, ENV_ERROR));
  if (errors.length) throw BrandError.join(errors);
  const credit = resolveCredit(brand, env);
  return {
    dir,
    custom: useCustom,
    brand,
    app: appBrand(brand, { dir, env }),
    credit,
    warnings: brandWarnings(brand, { dir, env }),
    summary: `Marca: ${brand.productName} (${displayPath(path.join(dir, 'brand.json'))}) · crédito: ${
      credit.source === 'programa' ? 'não aparece' : credit.show ? 'ligado' : 'desligado'
    } (${CREDIT_SOURCES[credit.source]})`,
  };
}

/**
 * Com CRM_BRAND_DIR, /brand/<arquivo> sai da pasta da marca dos testes (o resto de public/ continua igual). Um nome fora
 * da pasta responde 404, para nenhuma imagem do programa aparecer por engano; um nome com barra, contrabarra ou ".."
 * (também codificados, como "..%2F") nunca sai da pasta (o teste confere).
 */
export function brandDirMiddleware(dir) {
  return (request, response, next) => {
    const pathname = (request.url ?? '').split(/[?#]/)[0];
    if (!pathname.startsWith('/brand/')) return next();
    let name = '';
    try {
      name = decodeURIComponent(pathname.slice('/brand/'.length));
    } catch {
      name = '';
    }
    const type = CONTENT_TYPES[extensionOf(name)];
    if (!FILE_NAME.test(name) || !type || !(listDirectory(dir) ?? []).includes(name)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader('Content-Type', type);
    response.setHeader('Cache-Control', 'no-cache');
    response.end(readFileSync(path.join(dir, name)));
  };
}

/**
 * No build do E2E com CRM_BRAND_DIR (item 1.11), troca a pasta brand/ do build (copiada de public/brand) pelos arquivos
 * da pasta da marca dos testes, com a mesma regra de nomes e tipos de brandDirMiddleware: nenhuma imagem do programa
 * fica por engano, e nada de fora da pasta entra. Devolve os nomes copiados.
 */
export function copyBrandDir(dir, target) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const copied = [];
  for (const name of listDirectory(dir) ?? []) {
    const source = path.join(dir, name);
    if (!FILE_NAME.test(name) || !CONTENT_TYPES[extensionOf(name)] || !statSync(source).isFile()) continue;
    copyFileSync(source, path.join(target, name));
    copied.push(name);
  }
  return copied;
}

const isInside = (dir, file) => {
  const relative = path.relative(dir, file);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * Plugin `crm-brand` do Vite (vite.config.ts): injeta `__CRM_BRAND__` (define), troca os marcadores do index.html,
 * escreve a linha de resumo e os avisos no terminal e, no servidor de desenvolvimento, reinicia quando um arquivo da
 * pasta da marca muda (com erro, o servidor anterior continua e a mensagem aparece no terminal). No build do E2E com
 * CRM_BRAND_DIR, a pasta brand/ do build recebe as imagens da marca dos testes (copyBrandDir).
 */
export function brandPlugin() {
  let state = null;
  let building = false;
  return {
    name: 'crm-brand',
    async config(userConfig, { mode, command, isPreview }) {
      const root = path.resolve(userConfig.root ?? process.cwd());
      const { loadEnv } = await import('vite');
      const env = { ...loadEnv(mode, root, 'VITE_'), ...process.env };
      state = loadBrandState({ root, env, command, isPreview, mode, customDir: process.env.CRM_BRAND_DIR });
      building = command === 'build';
      return { define: { __CRM_BRAND__: JSON.stringify(state.app) } };
    },
    writeBundle(options) {
      if (building && state.custom && options.dir) copyBrandDir(state.dir, path.join(options.dir, 'brand'));
    },
    configResolved(config) {
      config.logger.info(state.summary);
      for (const warning of state.warnings) config.logger.warn(`Marca (aviso): ${warning}.`);
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => brandHtml(html, state.brand, { dir: state.dir }),
    },
    configureServer(server) {
      const { dir } = state;
      let restarting = false;
      // Um logo trocado também reinicia: o ?v= do endereço acompanha o conteúdo do arquivo.
      // Arquivos temporários dos editores não contam: só o brand.json e as imagens.
      const restart = (file) => {
        if (restarting || !isInside(dir, file) || !CONTENT_TYPES[extensionOf(path.basename(file))]) return;
        restarting = true;
        server.config.logger.info(`Marca: ${path.basename(file)} mudou; reiniciando o servidor.`, { timestamp: true });
        void server.restart().finally(() => {
          restarting = false;
        });
      };
      server.watcher.add(dir);
      for (const event of ['add', 'change', 'unlink']) server.watcher.on(event, restart);
      if (state.custom) server.middlewares.use(brandDirMiddleware(dir));
    },
  };
}
