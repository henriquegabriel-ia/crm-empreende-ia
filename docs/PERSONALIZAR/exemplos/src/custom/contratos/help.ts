// Exemplo de docs/PERSONALIZAR/TELA.md: a pergunta da Central de ajuda sobre a tela nova, no tipo das perguntas da
// base. Uma linha marcada com o comentário custom: acrescenta a pergunta numa categoria de
// src/components/help/faq-content.ts; o teste confere as regras de escrita da Central (faq-rules.ts).
import type { FaqItem } from '@/components/help/faq-content';

export const CONTRATOS_HELP: FaqItem = {
  q: 'Onde vejo os contratos de uma oportunidade?',
  a: 'Em “Contratos”, no menu. A lista mostra o número de cada contrato, a oportunidade e a data de assinatura. Donos, administradores e colaboradores usam “Novo contrato”, escolhem a oportunidade e informam o número e a data. Quem tem “Somente leitura” consulta a lista e não registra contratos.',
  terms: 'contrato contratos assinatura assinado numero oportunidade fechada',
};
