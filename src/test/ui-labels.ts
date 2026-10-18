import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Apoio dos testes da Ajuda, dos tours e do guia inicial: os nomes da interface que esses textos citam entre aspas
// curvas (“Criar convite”) precisam aparecer na tela de que o texto fala, ou no e-mail do Auth que a pessoa recebe.
// Cada teste declara essa tela; assim, um botão renomeado ou removido nela reprova o texto que ainda o cita, mesmo que
// a palavra continue em outra tela ou numa frase.
const ROOT = path.resolve(__dirname, '../..');
const SOURCE_FILE = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
/**
 * Os textos de ajuda nunca valem como prova, nem uns para os outros: um nome que a Ajuda e um tour citam continuaria
 * "existindo" no catálogo dos tours depois de sair da tela. src/test é o apoio dos testes.
 */
const HELP_TEXT_SOURCES = [
  'src/components/help/faq-content.ts',
  'src/components/tours/catalog.ts',
  'src/components/onboarding/setup-state.ts',
] as const;
/**
 * Os e-mails do Auth gerados por `npm run emails:build`, que as respostas da Ajuda citam pelo assunto e pelo botão.
 * A prévia (preview.html) e o gerador (scripts/lib/auth-emails.mjs) não contam: os dois descrevem quando cada e-mail
 * sai e citam nomes das telas que nenhum e-mail mostra.
 */
const AUTH_EMAILS = 'supabase/templates/';
const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', rarr: '→' };
/**
 * Botões que a tela completa com um número: a citação para antes dele, e a prova é o começo do texto do botão
 * ("Importar 12 contatos").
 */
const COMPLETED_BY_SCREEN: Record<string, string> = {
  // Item 1.11: "Importar 2.441 contatos" (src/components/contact-import/text.ts).
  Importar: 'Importar ${',
};

/** Caminho a partir da raiz do repositório, com barras, como os testes o escrevem. */
const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [relative(full)] : [];
  });
}

/** Espaços seguidos viram um: o Prettier quebra textos longos do JSX em várias linhas. */
const collapse = (text: string) => text.replace(/\s+/g, ' ');

/**
 * Sem comentários: um nome que só sobrou num comentário não prova que o botão existe. O `//` de um endereço
 * (`https://`) não começa comentário.
 */
const withoutComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

/**
 * Texto que a pessoa lê num e-mail: sem as tags e com as entidades trocadas. O gerador põe "e-mail" num <span> que não
 * quebra no hífen, então as tags de texto saem sem deixar espaço.
 */
const emailText = (html: string) =>
  collapse(
    html
      .replace(/<\/?(?:span|strong|em|b|a)\b[^>]*>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(#\d+|[a-z]+);/g, (entity, name: string) =>
        name.startsWith('#') ? String.fromCodePoint(Number(name.slice(1))) : (ENTITIES[name] ?? entity),
      ),
  );

/** Código sem comentários e com os espaços juntados. */
export const codeWithoutComments = (code: string) => collapse(withoutComments(code));

/** Código de um arquivo das telas, sem comentários e com os espaços juntados. */
export const screenCode = (file: string) => codeWithoutComments(readFileSync(path.join(ROOT, file), 'utf8'));

/** Arquivos das telas: src sem os testes, sem src/test e sem os textos de ajuda de HELP_TEXT_SOURCES. */
export function screenFiles(): string[] {
  return sourceFiles(path.join(ROOT, 'src')).filter(
    (file) => !file.startsWith('src/test/') && !(HELP_TEXT_SOURCES as readonly string[]).includes(file),
  );
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Verdadeiro se o código, já sem comentários (codeWithoutComments), mostra `label` inteiro: no começo de um literal
 * ('Pausar', "Funil", `Prévia: ${…}`) ou de um texto do JSX (>Copiar<), sem outra palavra logo depois. "Copiar link",
 * "Pausar tour" e “Continuar” no meio de uma frase não provam “Copiar”, “Pausar” e “Continuar”.
 */
export function codeShowsLabel(code: string, label: string): boolean {
  if (COMPLETED_BY_SCREEN[label]) return code.includes(COMPLETED_BY_SCREEN[label]);
  return new RegExp(`['"\`>]\\s*${escapeRegExp(label)}(?!\\s*[\\p{L}\\p{N}])`, 'u').test(collapse(code));
}

/**
 * Verdadeiro se `file` mostra `label` inteiro (codeShowsLabel), sem contar os comentários. Num e-mail do Auth vale o
 * texto lido. Os textos de ajuda e o apoio dos testes nunca contam.
 */
export function showsLabel(file: string, label: string): boolean {
  if ((HELP_TEXT_SOURCES as readonly string[]).includes(file) || file.startsWith('src/test/'))
    throw new Error(`${file} é texto de ajuda ou apoio de teste e não prova que “${label}” existe na tela`);
  if (file.startsWith(AUTH_EMAILS)) {
    if (!file.endsWith('.html') || file.endsWith('/preview.html')) throw new Error(`${file} não é um e-mail do Auth`);
    return emailText(readFileSync(path.join(ROOT, file), 'utf8')).includes(label);
  }
  return codeShowsLabel(screenCode(file), label);
}

/** Nomes citados entre aspas curvas. */
export function quotedLabels(text: string): string[] {
  return [...text.matchAll(/“([^”]+)”/g)].map((match) => collapse(match[1]));
}
