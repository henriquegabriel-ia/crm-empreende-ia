import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './test';
import { installCrmFixture } from './fixture';

// Item 1.7b (docs/arquitetura/1.7b.md, seções 8.4, 9 e 12.3): a versão da base no rodapé da "Ajuda do CRM", a mesma do
// package.json, no desktop e no celular (este arquivo roda também no projeto mobile-chrome), e a pergunta nova da
// Central achada pela busca por "versão".
const VERSION = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

async function openHelp(page: Page, isMobile: boolean) {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Hoje', exact: true })).toBeVisible();
  if (isMobile) {
    await page.getByRole('button', { name: 'Mais opções', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Central de ajuda', exact: true }).click();
  } else await page.getByRole('button', { name: 'Ajuda', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Ajuda do CRM', exact: true });
  await expect(help.getByRole('heading', { name: 'Perguntas frequentes', exact: true })).toBeVisible();
  return help;
}

test('o rodapé da Ajuda mostra a versão da base, e a busca por "versão" acha a pergunta da atualização', async ({
  page,
  isMobile,
}) => {
  await installCrmFixture(page);
  const help = await openHelp(page, isMobile);
  const footer = help.getByText(`Versão ${VERSION}`, { exact: true });
  await expect(footer).toBeVisible();
  // A mesma versão na meta da página, que o verify-instance confere.
  await expect(page.locator('meta[name="crm-version"]')).toHaveAttribute('content', VERSION);
  await help.getByRole('searchbox', { name: 'Buscar nas perguntas frequentes' }).fill('versão');
  const question = help.getByRole('button', { name: 'Este CRM é atualizado sozinho?', exact: true });
  await question.click();
  await expect(help.getByText(/A versão em uso aparece no rodapé desta Ajuda\./)).toBeVisible();
  // O rodapé não estoura a largura da tela (no celular, o painel ocupa a largura toda). O Sheet entra deslizando da
  // direita em 500 ms (src/components/ui/sheet.tsx): a conta espera a animação terminar, nos dois projetos.
  await expect
    .poll(() =>
      help.evaluate((element) => {
        const viewport = document.documentElement.clientWidth;
        const settled = element
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState !== 'running');
        return (
          settled &&
          element.getBoundingClientRect().right <= viewport + 1 &&
          document.documentElement.scrollWidth <= viewport + 1
        );
      }),
    )
    .toBe(true);
});
