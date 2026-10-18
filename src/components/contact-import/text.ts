import type { CsvEncoding } from '@/lib/csv';

/** Textos da importação com número (item 1.11): a contagem em pt-BR ("2.441") e o singular quando é 1. */
export const formatCount = (value: number) => value.toLocaleString('pt-BR');

export const plural = (count: number, singular: string, pluralText: string) =>
  `${formatCount(count)} ${count === 1 ? singular : pluralText}`;

/**
 * O aviso do formato do arquivo quando não é UTF-8, sem o nome técnico da codificação (Windows-1252 e UTF-16 ficam no
 * README): o CSV comum do Excel pode trocar acentos (o do Mac, por exemplo), e a prévia manda conferir. Nada no UTF-8.
 */
export function encodingNotice(encoding: CsvEncoding): string | null {
  if (encoding === 'windows-1252')
    return 'Arquivo no formato CSV comum do Excel. Confira os acentos nos nomes; se algum aparecer trocado, salve a planilha como CSV UTF-8 e escolha o arquivo de novo.';
  if (encoding === 'utf-16le' || encoding === 'utf-16be') return 'Arquivo no formato Texto Unicode do Excel.';
  return null;
}

/** "Importar 1 contato" ou "Importar 2.441 contatos"; depois de uma recusa, "Continuar importação de …". */
export function importButtonLabel(count: number, resuming: boolean) {
  const contacts = plural(count, 'contato', 'contatos');
  return resuming ? `Continuar importação de ${contacts}` : `Importar ${contacts}`;
}

/** "12 empresas novas: Alfa, Beta, Gama e mais 9." */
export function newCompaniesNotice(names: readonly string[]) {
  const shown = names.slice(0, 3).join(', ');
  const rest = names.length - 3;
  const head =
    names.length === 1 ? `1 empresa nova: ${shown}` : `${formatCount(names.length)} empresas novas: ${shown}`;
  // Sem ponto duplo quando o último nome já termina com ponto ("Acme Ltda.").
  return rest > 0 ? `${head} e mais ${formatCount(rest)}.` : /[.!?]$/.test(head) ? head : `${head}.`;
}
