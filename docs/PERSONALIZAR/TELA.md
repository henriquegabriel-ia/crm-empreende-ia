# Tela nova

Exemplo: a tela "Contratos", que lista os contratos da empresa e registra um novo. Ela usa a tabela de [Entidade nova](ENTIDADE.md). Leia antes o [índice da personalização](README.md) e [Personalizar sem quebrar a atualização](../PROTECAO-ATUALIZACAO.md). Os arquivos completos estão em `docs/PERSONALIZAR/exemplos/src/custom/contratos/`, com os caminhos que terão no seu repositório (`src/custom/contratos/`).

## 1. Onde fica o código

Tudo o que é seu fica em `src/custom/<módulo>/`. A base nunca cria arquivos nessa pasta, então uma atualização não mexe neles. O ESLint, o `npm run typecheck` e o `npm test` já cobrem a pasta.

| Arquivo | O que faz |
| --- | --- |
| `src/custom/contratos/data.ts` | As consultas e a gravação, com o cliente da base (`crmDb`) e o tipo gerado |
| `src/custom/contratos/useContratos.ts` | As consultas no TanStack Query, com a chave `['crm', orgId, 'custom_contratos']` |
| `src/custom/contratos/ContratosPage.tsx` | A tela |
| `src/custom/contratos/help.ts` | A pergunta da Central de ajuda |
| `src/custom/contratos/ContratosPage.test.tsx` | O teste da tela |

Dentro do módulo, os arquivos se importam pelo caminho relativo (`./data`); os componentes da base, pelo caminho absoluto (`@/components/...`).

## 2. Dados

O tipo vem do `npm run gen:types` (sem ele, o TypeScript não conhece `custom_contratos`):

<!-- exemplo: src/custom/contratos/data.ts -->

```ts
type ContratosTable = Database['public']['Tables']['custom_contratos'];
/** Uma linha de public.custom_contratos, como o tipo gerado a descreve. */
export type Contrato = ContratosTable['Row'];
```

A gravação devolve a recusa do banco como está, para a tela mostrar:

<!-- exemplo: src/custom/contratos/data.ts -->

```ts
export async function createContrato(orgId: string, contrato: NovoContrato): Promise<void> {
  const { error } = await crmDb.from('custom_contratos').insert({ ...contrato, org_id: orgId });
  if (error) throw error;
}
```

## 3. A tela

- Use os componentes da base: `PageScaffold` (título e ações no topo), `EmptyState` (lista vazia, com a dica do que fazer), `LoadingState`, `Panel`, o diálogo e os campos do design system (`DESIGN.md`).
- Todo estado tem orientação, inclusive dentro do diálogo: com as oportunidades carregando, o seletor mostra “Carregando oportunidades…”; com falha, diz que não carregou e oferece “Tentar novamente”, que busca as oportunidades de novo sem fechar o diálogo; sem nenhuma oportunidade, diz para criar uma no “Pipeline” antes e desabilita “Salvar contrato”.
- O botão "Novo contrato" só aparece para quem edita (`useCrmPermissions().canWrite`). Isso é conforto: quem protege é a RLS.
- A recusa do banco aparece pelo `errorMessage` da base, que mostra a mensagem de um gancho (P0001) como está e troca a falta de permissão (42501) pela mensagem de papel:

<!-- exemplo: src/custom/contratos/ContratosPage.tsx -->

```tsx
    try {
      await onSave({ deal_id: dealId, numero: numero.trim(), assinado_em: assinadoEm || null });
      onClose();
    } catch (error) {
      setFailure(errorMessage(error));
```

- Texto em pt-BR com acentuação; identificadores em inglês ou no seu domínio, sem acento. A lista tem `data-tour="custom-contratos-list"`, para um tour futuro.

### A rota e o menu

Mude só a linha necessária nos arquivos da base, com o comentário `custom:`. Em `src/App.tsx`, junto das outras telas carregadas sob demanda:

```tsx
const ContratosPage = lazy(() => import('@/custom/contratos/ContratosPage')); // custom: contratos
```

E, dentro das rotas protegidas, como a de `/templates` (menu “Templates”):

```tsx
{/* custom: contratos */}
<Route path="/contratos" element={<SuspenseRoute><ContratosPage /></SuspenseRoute>} />
```

No menu, cada lista tem o formato dela. Em `src/components/shell/AppRail.tsx`, com o ícone:

```tsx
{ title: 'Contratos', url: '/contratos', icon: FileSignature }, // custom: contratos
```

No celular, se quiser, na lista `moreItems` (o menu “Mais”) de `src/components/layout/MobileBottomNav.tsx`, sem ícone:

```tsx
{ title: 'Contratos', url: '/contratos' }, // custom: contratos
```

E na busca de `src/components/CommandPalette.tsx`, como par de nome e rota:

```tsx
['Contratos', '/contratos'], // custom: contratos
```

Na atualização, um conflito numa linha `custom:` se resolve mantendo as duas partes: a linha da base e a sua.

## 4. Ajuda

Todo comportamento novo aparece na Ajuda. A pergunta fica em `src/custom/contratos/help.ts`, no tipo das perguntas da base:

<!-- exemplo: src/custom/contratos/help.ts -->

```ts
export const CONTRATOS_HELP: FaqItem = {
  q: 'Onde vejo os contratos de uma oportunidade?',
```

Acrescente-a numa categoria de `src/components/help/faq-content.ts`, com uma linha marcada: `CONTRATOS_HELP, // custom: contratos` (e o `import` dela). Os testes da Central conferem a escrita (`src/components/help/faq-rules.ts`) e que cada nome entre aspas curvas existe na tela; acrescente a tela nova à lista `SCREENS` de `src/components/help/faq-content.test.ts`, que é um arquivo da base, com uma linha só e o marcador:

```ts
  'src/custom/contratos/ContratosPage.tsx': ['Contratos', 'Novo contrato'], // custom: contratos
```

Esse teste muda em quase toda versão da base: num conflito nele, na atualização, mantenha as duas partes (as linhas novas da base e a sua).

## 5. Teste

O teste simula o cliente com `vi.mock`, como os da base, e confere a lista, o estado vazio, a gravação, a recusa do banco e o papel de leitura:

<!-- exemplo: src/custom/contratos/ContratosPage.test.tsx -->

```tsx
  it('para “Somente leitura”, só a lista, sem “Novo contrato”', async () => {
    mocks.canWrite = false;
    setup();
```

Rode `npm test` e o resto da [suíte](../../AGENTS.md#como-validar). Para uma tela que muda o fluxo da equipe, um teste no navegador em `tests/browser/` (Playwright) é o próximo passo.
