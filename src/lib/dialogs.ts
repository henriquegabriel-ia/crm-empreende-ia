/**
 * Diálogos abertos na tela, num lugar só (item 1.9): os tours não começam nem avançam com um diálogo aberto, e a faixa
 * "Para registrar" some enquanto há um. Os diálogos do CRM são do Radix (role="dialog" ou "alertdialog"), e um diálogo
 * modal deixa o resto da tela inerte: o que mora fora dele não pode ser usado.
 */

/** Elemento conectado, com tamanho e sem `hidden`, `inert`, `display: none` ou `visibility: hidden`. */
export function isVisibleElement(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected || !element.getClientRects().length) return false;
  if (element.closest('[hidden], [inert]')) return false;
  const style = getComputedStyle(element);
  const bounds = element.getBoundingClientRect();
  return (
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    style.display !== 'none' &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

/** Há um diálogo visível, fora da interface dos próprios tours ([data-tour-ui]). */
export function otherDialogOpen(root: ParentNode = document): boolean {
  return Array.from(root.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')).some(
    (element) => !element.closest('[data-tour-ui]') && isVisibleElement(element),
  );
}
