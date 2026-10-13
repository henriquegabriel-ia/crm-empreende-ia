import { afterEach, describe, expect, it, vi } from 'vitest';
import { isVisibleElement, otherDialogOpen } from './dialogs';

// Item 1.9: a detecção de diálogo aberto saiu de tour-dom.ts e vale também para a faixa "Para registrar".
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
const measured = () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 10, height: 10 } as DOMRect);
};

describe('diálogos abertos', () => {
  it('um diálogo visível conta; o escondido, o inerte e o da interface dos tours, não', () => {
    measured();
    expect(otherDialogOpen()).toBe(false);
    document.body.innerHTML = '<div role="dialog" hidden></div><div inert><div role="alertdialog"></div></div>';
    expect(otherDialogOpen()).toBe(false);
    document.body.innerHTML = '<div data-tour-ui><div role="dialog"></div></div>';
    expect(otherDialogOpen()).toBe(false);
    document.body.innerHTML = '<div role="dialog"></div>';
    expect(otherDialogOpen()).toBe(true);
  });

  it('um elemento sem medida não é visível', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    expect(isVisibleElement(element)).toBe(false);
  });
});
