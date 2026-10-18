import type { DealItemField, DealItemsComputation } from '@/lib/deal-logic';
import type { DealItemDraft } from '@/lib/deal-types';

/**
 * Ids dos campos do editor de itens (item 1.16; DealItemsEditor.tsx), fora do componente para o formulário e o painel
 * levarem o foco ao primeiro campo com erro ao salvar.
 */

/** Id do campo de um item no editor: o foco vai ao primeiro com erro ao salvar. */
export const dealItemFieldId = (prefix: string, itemId: string, field: DealItemField) => `${prefix}-${itemId}-${field}`;
/** Id do campo "Meses do contrato". */
export const dealItemMonthsId = (prefix: string) => `${prefix}-months`;

/**
 * O id do primeiro campo com erro (na ordem dos cartões e dos campos), ou nulo. Os meses vêm depois dos itens, e o
 * limite do contrato aponta para os meses, onde a pessoa reduz o número.
 */
export function firstDealItemErrorId(
  prefix: string,
  drafts: readonly DealItemDraft[],
  computation: DealItemsComputation,
): string | null {
  const order: DealItemField[] = ['product_id', 'name', 'quantity', 'unit', 'unit_price', 'discount_value', 'billing'];
  for (const draft of drafts) {
    const errors = computation.errors[draft.id];
    const field = errors && order.find((name) => errors[name]);
    if (field) return dealItemFieldId(prefix, draft.id, field);
  }
  if (computation.monthsError || computation.contractError) return dealItemMonthsId(prefix);
  return null;
}
