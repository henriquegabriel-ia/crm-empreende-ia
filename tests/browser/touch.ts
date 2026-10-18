import { expect, type Locator } from '@playwright/test';

/**
 * Alvo de toque de 44 px no celular (achado 2 da revisão do item 1.9; DESIGN.md): a altura do controle, ou da linha de
 * um rádio ou de uma caixa de marcar (`.eia-touch-row`, em que o rótulo ocupa o resto da linha). A medida aceita meio
 * pixel de arredondamento. Use só no projeto do celular: no desktop, o tamanho `sm` continua com 36 px.
 */
export async function expectTouchTarget(locator: Locator, label: string) {
  await expect(locator, label).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label}: sem medida`).not.toBeNull();
  expect(box!.height, `${label}: alvo de toque`).toBeGreaterThanOrEqual(43.5);
}

/** A linha clicável de um rádio ou de uma caixa de marcar: o ancestral mais próximo com `.eia-touch-row`. */
export const touchRow = (control: Locator) => control.locator('xpath=ancestor::*[contains(@class,"eia-touch-row")][1]');
