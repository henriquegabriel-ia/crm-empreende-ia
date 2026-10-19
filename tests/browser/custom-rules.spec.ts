import { expect, test } from './test';
import { installCrmFixture } from './fixture';

// Item 1.13 (docs/arquitetura/1.13.md, seção 7.3): uma regra própria da empresa, acrescentada por quem publicou o CRM
// num gancho private.custom_* do banco, recusa a gravação com a mensagem dela (P0001). A tela mostra a mensagem como
// está e mantém o preenchimento, no desktop e no celular (o projeto mobile-chrome inclui este arquivo).

test('a recusa de uma regra da empresa ao salvar um contato aparece no formulário, com o preenchimento preservado', async ({
  page,
}) => {
  const state = await installCrmFixture(page);
  const rule = 'Regra da empresa: informe o cargo do contato antes de salvar.';
  state.customRules.set('contacts', rule);
  await page.goto('/contacts?action=new');
  await page.getByLabel('Nome *', { exact: true }).fill('Contato da Regra');
  await page.getByLabel('E-mail', { exact: true }).fill('regra@example.test');
  await page.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: rule })).toBeVisible();
  await expect(page.getByLabel('Nome *', { exact: true })).toHaveValue('Contato da Regra');
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('regra@example.test');
  expect(state.tables.contacts.some((contact) => contact.email === 'regra@example.test')).toBe(false);
  // Corrigido o que a regra pede (aqui, a regra sai), a mesma tela salva.
  state.customRules.clear();
  await page.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contato da Regra', exact: true })).toBeVisible();
  expect(state.tables.contacts.filter((contact) => contact.email === 'regra@example.test')).toHaveLength(1);
});

test('a recusa de uma regra da empresa ao criar uma oportunidade aparece no formulário, com o preenchimento preservado', async ({
  page,
}) => {
  const state = await installCrmFixture(page);
  const rule = 'Regra da empresa: oportunidade acima de R$ 10.000 precisa de empresa.';
  state.customRules.set('deals', rule);
  await page.goto('/pipeline?create=1');
  await page.getByLabel('Nome da oportunidade *', { exact: true }).fill('Oportunidade da Regra');
  await page.getByLabel('Valor (BRL) *', { exact: true }).fill('20000');
  await page.getByRole('button', { name: 'Criar oportunidade', exact: true }).click();
  await expect(page.getByText(rule, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Nome da oportunidade *', { exact: true })).toHaveValue('Oportunidade da Regra');
  await expect(page.getByLabel('Valor (BRL) *', { exact: true })).toHaveValue('20000');
  expect(state.tables.deals.some((deal) => deal.title === 'Oportunidade da Regra')).toBe(false);
});
