import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PROGRAM_BRAND } from '../../scripts/lib/brand.mjs';

// Item 1.6 (docs/arquitetura/1.6.md, seção 10.3), no molde do teste de "pipeline" minúsculo em deal-logic.test.ts:
// nenhuma tela escreve o nome do programa nem o caminho de uma imagem da marca. A marca vem de BRAND (src/lib/brand.ts),
// os arquivos exportados de exportFileName e o rodapé de BrandFooter; trocar public/brand/brand.json troca tudo.
const ROOT = path.resolve(__dirname, '../..');
// Exceções, com o motivo: o texto do crédito da base (D3), que só aparece com outra marca; o PRODID e o UID do arquivo
// de calendário, invisíveis para quem usa (o UID fica para uma reimportação não duplicar as reuniões); e os termos de
// busca da pergunta do crédito na Central de ajuda, que só aparece com outra marca e nunca é mostrado.
const ALLOWED: Record<string, string[]> = {
  'src/lib/brand.ts': ['Feito com Empreende.IA'],
  'src/lib/crm-import.ts': ['PRODID:-//Empreende IA//CRM//PT-BR', '@crm.empreende-ia'],
  'src/components/help/faq-content.ts': ['credito rodape empreende base licenca feito'],
};
/**
 * Identificadores invisíveis, que não mudam com a marca (achado 1 da revisão do item 1.6, corrigido no item 1.9): as
 * chaves de armazenamento, os eventos e a chave do tema, que começam com "empreende-crm" ou "empreende-ia" e não têm
 * espaço. Trocá-los apagaria as preferências de quem já usa o CRM.
 */
const INVISIBLE_IDENTIFIER = /^empreende-(crm|ia)[\w:.-]*$/;
/** Sem acento e em minúsculas: "EMPREENDE IA", "empreende ia" e "Empreende.Ia" contam como o nome do programa. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const PROGRAM_TAGLINE = fold(PROGRAM_BRAND.tagline).replace(/[.!]+$/, '');
/** O texto cita o programa: "empreende" em qualquer grafia, ou o slogan dele, fora de um identificador invisível. */
const namesProgram = (text: string) =>
  !INVISIBLE_IDENTIFIER.test(text) && (fold(text).includes('empreende') || fold(text).includes(PROGRAM_TAGLINE));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return file === path.join(ROOT, 'src', 'test') ? [] : sources(file);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}

/**
 * Textos de um arquivo, lidos pela árvore do TypeScript (revisão do item 1.6): entre aspas, entre crases (cada parte de
 * um template, de uma ou de várias linhas) e o texto do JSX, mesmo quebrado pelo Prettier em várias linhas ou ao lado
 * de uma expressão `{…}`. Comentários e os caminhos dos imports ("@/components/brand/…") não são texto de interface.
 * Espaços seguidos viram um.
 */
function texts(code: string, fileName: string): string[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false, kind);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return;
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    )
      found.push(node.text.replace(/\s+/g, ' ').trim());
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.filter(Boolean);
}

// Caminho público de uma imagem: "/brand/…", "/materials/…" ou o favicon antigo.
const IMAGE_PATH = /(^|[\s(=])\/(brand|materials)\/|favicon\.svg/;

describe('marca escrita no código', () => {
  const files = sources(path.join(ROOT, 'src'));
  const found = files.flatMap((file) => {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    return texts(readFileSync(file, 'utf8'), file).map((text) => ({ file: relative, text }));
  });

  it('nenhuma tela escreve o nome ou o slogan do programa, em qualquer grafia, fora das exceções', () => {
    const offending = found
      .filter(({ text }) => namesProgram(text))
      .filter(({ file, text }) => !(ALLOWED[file] ?? []).includes(text))
      .map(({ file, text }) => `${file}: ${text}`);
    expect(offending).toEqual([]);
    // As exceções continuam existindo: uma que sobrasse esconderia um texto novo no mesmo arquivo.
    for (const [file, allowed] of Object.entries(ALLOWED))
      for (const text of allowed) expect(found, `${file}: ${text}`).toContainEqual({ file, text });
  });

  it('nenhuma tela aponta para uma imagem da marca ou para public/materials', () => {
    const offending = found.filter(({ text }) => IMAGE_PATH.test(text)).map(({ file, text }) => `${file}: ${text}`);
    expect(offending).toEqual([]);
  });

  // Desde o item 1.3, o script do tema saiu do index.html para public/theme-init.js (a CSP recusa script inline).
  it('o index.html não cita a marca, e o script do tema só tem a chave do tema', () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, ' ');
    expect(html.match(/empreende/gi)).toBeNull();
    expect(fold(html)).not.toContain(PROGRAM_TAGLINE);
    const theme = readFileSync(path.join(ROOT, 'public', 'theme-init.js'), 'utf8').replace(/^\s*\/\/.*$/gm, ' ');
    expect(theme.match(/empreende/gi)).toEqual(['empreende']);
    expect(theme).toContain("localStorage.getItem('empreende-ia-theme')");
  });

  it('a regra pega o nome em qualquer grafia e o slogan, e deixa os identificadores invisíveis', () => {
    for (const text of [
      'EMPREENDE IA',
      'empreende ia',
      'Empreende.Ia',
      'Feito com a EmPrEeNdE',
      PROGRAM_BRAND.tagline.toUpperCase(),
      'relacionamentos que fazem o negocio crescer',
      'empreende-crm chave com espaço',
    ])
      expect(namesProgram(text), text).toBe(true);
    for (const text of [
      'empreende-crm:tours:v1:',
      'empreende-ia-theme',
      'empreende-crm-auth',
      'Relacionamentos do dia',
    ])
      expect(namesProgram(text), text).toBe(false);
  });

  it('o guarda lê o JSX de várias linhas das telas, como a dica da aba Organização', () => {
    expect(found).toContainEqual({
      file: 'src/pages/Settings.tsx',
      text: expect.stringMatching(/^O nome e o logo da tela de entrada, da aba do navegador e dos e-mails de acesso/),
    });
  });

  it('o guarda reconhece um nome ou um logo fixos num componente, em qualquer formato, e não os comentários', () => {
    const sample = [
      '// Empreende.IA no comentário não conta',
      "import Wordmark from '@/components/brand/Wordmark';",
      "const Lazy = lazy(() => import('@/components/brand/AuthBrandPanel'));",
      '/* Empreende.IA também não */',
      "const ics = ['PRODID:-//Empreende IA//CRM//PT-BR']; // Empreende",
      'export function Tela({ name }: { name: string }) {',
      '  return (',
      '    <div>',
      '      <p className="x">Empreende.IA · CRM</p>',
      '      {/* Empreende.IA num comentário do JSX */}',
      '      <p className="text-xs">',
      '        O CRM da Empreende.IA organiza',
      '        a sua carteira.',
      '      </p>',
      '      <p>Bem-vindo ao CRM Empreende IA, {name}</p>',
      '      <img src="/brand/eia-icon.svg" alt="" />',
      '      {`Primeira linha',
      '      Empreende.IA na segunda`}',
      '      {`${name} usa Empreende IA`}',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const caught = texts(sample, 'amostra.tsx').filter((text) => /Empreende/.test(text) || IMAGE_PATH.test(text));
    expect(caught.sort()).toEqual(
      [
        '/brand/eia-icon.svg',
        'Bem-vindo ao CRM Empreende IA,',
        'Empreende.IA · CRM',
        'O CRM da Empreende.IA organiza a sua carteira.',
        'PRODID:-//Empreende IA//CRM//PT-BR',
        'Primeira linha Empreende.IA na segunda',
        'usa Empreende IA',
      ].sort(),
    );
  });
});
