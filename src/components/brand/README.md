# Marca da instância

Os componentes desta pasta mostram a marca da instância: `Wordmark` (o logo, nos dois temas), `BrandGlyph` (o ícone, ou o monograma sem ícone), `AuthBrandPanel` (o painel escuro das telas de entrada), `BrandFooter` (o rodapé das telas de entrada, com o crédito) e `ThemeToggle`.

## De onde vem a marca

A marca fica em `public/brand/brand.json` e nas imagens dessa pasta ([Trocar a marca do CRM](../../../docs/MARCA.md)). O plugin `crm-brand` (`scripts/lib/brand.mjs`, ligado em `vite.config.ts`) lê e confere o arquivo no `dev` e no `build` e injeta o objeto público `__CRM_BRAND__`, que o código lê só por `BRAND`, de `src/lib/brand.ts`:

| Campo de `BRAND` | Uso |
| --- | --- |
| `productName` | Texto alternativo dos logos, nome em texto sem logo, rodapé da entrada e monograma |
| `tagline` | Linha de baixo do `AuthBrandPanel` (some vazia) |
| `supportEmail` | `SUPPORT_EMAIL` (`src/lib/support.ts`): "Falar com suporte" e a tela de erro |
| `logoOnLight`, `logoOnDark`, `icon`, `authImage` | Endereços `/brand/<arquivo>?v=<hash do conteúdo>`, ou `null` sem a imagem |
| `exportName` | `exportFileName` |
| `baseCredit` | Mostra o crédito "Feito com Empreende.IA" (`BASE_CREDIT_TEXT`) |

O título da aba, o `og:title` e o favicon saem dos marcadores `%CRM_BRAND_NAME%` e `<!-- %CRM_BRAND_ICON% -->` do `index.html`, trocados pelo mesmo plugin. No Vitest, `BRAND` é sempre a marca do programa, sem o hash (`vitest.config.ts`); para testar outra marca, simule `@/lib/brand` (veja `src/test/brand-mock.ts` e os testes desta pasta).

## Regras para quem personaliza

- **Nunca escreva o nome, o slogan ou o caminho de uma imagem da marca num componente.** Use `BRAND`. O teste `src/test/brand-literals.test.ts` lê os textos pela árvore do TypeScript (entre aspas, entre crases e o texto do JSX, mesmo quebrado em várias linhas ou ao lado de uma expressão `{…}`) e reprova "Empreende" num texto de interface (fora do crédito e do PRODID do calendário) e qualquer caminho `/brand/…` ou `/materials/…`; comentários e caminhos de import não contam.
- **Arquivo exportado novo:** monte o nome com `exportFileName('base', 'extensão', data?)`, que dá `base-<exportName>-<data>.extensão` (`contatos-acme.csv`). Identificadores técnicos que a pessoa não vê, como o `UID` e o `PRODID` do ICS, as chaves do `localStorage` e os eventos `empreende-crm:*`, ficam como estão.
- **Tela de entrada nova** (uma coluna `eia-auth` com o painel): use `AuthBrandPanel` e, no fim do painel do formulário, `BrandFooter`. O crédito não vai para o shell do CRM, que não tem rodapé: dentro do CRM, ele fica no rodapé da "Ajuda do CRM".
- **Logo:** a caixa tem largura fixa (176 px, ou 128 px no `compact`) e altura máxima de 48 px (36 px); sem o logo de um tema, o nome aparece em texto nesse tema, em até duas linhas. O rótulo "CRM" abaixo do logo (`Wordmark` e `AuthBrandPanel`) leva `aria-hidden`, porque o texto alternativo do logo já é o nome inteiro. Os padrões visuais estão no [DESIGN.md](../../../DESIGN.md).
- **Campo novo na marca:** entra opcional, com padrão no código, em `scripts/lib/brand.mjs` (validação e `appBrand`), em `brand.d.mts` e em `src/lib/brand.ts`, com teste em `scripts/lib/brand.test.mjs` e no guia [docs/MARCA.md](../../../docs/MARCA.md). A base nunca muda os valores do `brand.json` de uma instância.
