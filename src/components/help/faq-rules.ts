import type { FaqItem } from '@/components/help/faq-content';

/**
 * As regras de escrita que valem para toda pergunta da Central de ajuda, num módulo só (item 1.8): os testes da Central
 * (faq-content.test.ts) e os de quem personaliza (a pergunta de docs/PERSONALIZAR/exemplos) conferem as mesmas. As
 * regras que dependem das telas da base (os nomes entre aspas curvas em SCREENS) ficam em faq-content.test.ts.
 */
export const FAQ_MAX_ANSWER_WORDS = 130;

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Os problemas de escrita de uma pergunta da Central; lista vazia quando ela segue as regras. */
export function faqWritingProblems(item: FaqItem): string[] {
  const problems: string[] = [];
  const text = `${item.q} ${item.a}`;
  if (!/\?$/.test(item.q)) problems.push('a pergunta termina com interrogação');
  if (words(item.a) > FAQ_MAX_ANSWER_WORDS)
    problems.push(`a resposta tem no máximo ${FAQ_MAX_ANSWER_WORDS} palavras (tem ${words(item.a)})`);
  // Um dois-pontos por frase (o de um endereço, "https://", e o de um horário, "8:30", não contam).
  for (const sentence of item.a.split(/(?<=[.!?])\s+/))
    if ((sentence.match(/:(?!\/\/|\d)/g)?.length ?? 0) > 1)
      problems.push(`dois-pontos duas vezes na frase: ${sentence}`);
  if (/"/.test(text)) problems.push('aspas retas no lugar das curvas');
  // A busca tira o hífen ("mudá-lo" vira "mudalo"), e "mudar" deixa de achar a resposta.
  if (/\p{L}-(?:lo|la|los|las)\b/u.test(text)) problems.push('ênclise com hífen (-lo, -la, -los, -las)');
  // "banco" pode ser lido como o banco do dinheiro num CRM com Financeiro.
  if (/\bbanco\b/i.test(text)) problems.push('a palavra "banco"');
  return problems;
}
