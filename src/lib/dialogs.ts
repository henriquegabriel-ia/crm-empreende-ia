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

const DIALOGS = '[role="dialog"], [role="alertdialog"], dialog[open]';

/** Há um diálogo visível, fora da interface dos próprios tours ([data-tour-ui]). */
export function otherDialogOpen(root: ParentNode = document): boolean {
  return Array.from(root.querySelectorAll(DIALOGS)).some(
    (element) => !element.closest('[data-tour-ui]') && isVisibleElement(element),
  );
}

/**
 * Há uma janela modal visível (Dialog, AlertDialog, Sheet, Drawer ou a própria busca), que deixa o resto da tela inerte,
 * fora da interface dos tours. O conteúdo do Popover do Radix também tem role="dialog", mas não é modal (os filtros de
 * "Contatos" e "Empresas", o menu da pessoa no rodapé do menu): mora dentro do invólucro do posicionamento do Radix
 * ([data-radix-popper-content-wrapper]) e fica de fora. O CRM não usa o Popover modal nem o Dialog não modal. Usada
 * pelo atalho da busca (achado 7 da revisão do 1.11 e revisão do item 1.12).
 */
export function modalDialogOpen(root: ParentNode = document): boolean {
  return Array.from(root.querySelectorAll(DIALOGS)).some(
    (element) =>
      !element.closest('[data-tour-ui]') &&
      !element.closest('[data-radix-popper-content-wrapper]') &&
      isVisibleElement(element),
  );
}
