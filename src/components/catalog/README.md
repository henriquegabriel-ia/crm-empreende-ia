# Catálogo de produtos e serviços

Os componentes desta pasta são a aba "Catálogo" de "Configurações" (item 1.16 do [roteiro](../../../docs/ROADMAP-FINALIZACAO.md); desenho em [docs/arquitetura/1.16.md](../../../docs/arquitetura/1.16.md)): a lista, o cadastro, o arquivamento e a importação por planilha dos produtos e serviços que a empresa vende. Os itens da oportunidade (o editor, a seção do painel e a gravação por `save_deal`) ficam em `src/components/pipeline`.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `CatalogSettings.tsx` | A aba. A lista com a busca por nome ou código (sem acento nem maiúscula, por `textKey`) e o filtro "Ativos" (padrão), "Arquivados" e "Todos", com a contagem; no desktop, uma linha por item com as colunas (Nome e código, Tipo e unidade, Preço com "/mês" e a cobrança, Situação e as ações), e abaixo de 768 px, a mesma linha empilhada como cartão, num único DOM. Donos e administradores veem "Novo item", "Importar planilha" e "Baixar modelo" e, em cada item, editar, arquivar ou reativar e excluir (com a confirmação); os demais papéis consultam, com o aviso de `Settings.tsx`. O estado vazio muda com o papel. Num banco sem a migração do catálogo, a aba mostra `CATALOG_MIGRATION_MISSING` |
| `ProductDialog.tsx` | "Novo item do catálogo" e "Editar item do catálogo": Nome, Código (opcional e único), Tipo (Produto ou Serviço), Unidade (com sugestões), Preço (com a prévia do padrão brasileiro, D7) e Cobrança (Única ou Mensal), com os limites do banco. A falha (código repetido, conflito de versão, papel) aparece no diálogo, com o preenchimento preservado |
| `CatalogImportDialog.tsx` | "Revisar importação do catálogo", no molde do diálogo de contatos do 1.11, em três estados: a prévia (as contagens, as colunas reconhecidas e ignoradas e as abas "Prontas", "Repetidas" e "Com erro", com a linha do Excel e os motivos; nada é gravado antes de "Importar {n} itens"), a gravação (lotes de 500 com o id da prévia, a barra `ImportProgress` com os rótulos do catálogo, "Parar" e o aviso do navegador ao sair) e o resultado ("Baixar itens não importados" e "Continuar importação"). Um código cadastrado por um colega no meio (23505) relê o catálogo e reenvia o lote sem a linha, uma vez; o papel rebaixado (42501) para e diz o motivo, sem "Continuar"; a falha de rede oferece "Continuar", que reenvia os mesmos ids |
| `data.ts` | A gravação: `createProduct`, `updateProduct` e `setProductArchived` (as duas últimas só na versão lida, `.eq('updated_at', …)` com `maybeSingle`, item 0.8), `deleteProduct` (o item usado é recusado pela FK de `deal_items`, 23503) e `insertProductBatch` (`upsert` pelo id da prévia com `ignoreDuplicates`); `duplicateCodeOf` e `catalogErrorMessage` traduzem as recusas; `CATALOG_MESSAGES` e `PRODUCT_LIMITS`. A leitura (`loadProducts`, paginada) mora em `src/components/pipeline/deal-items-data.ts`, com a dos itens |

As regras puras ficam em `src/lib`: `product-import-headers.ts` (as colunas do modelo, os sinônimos e o modelo para baixar), `product-import.ts` (a leitura pelo leitor comum `sheet-import.ts`, a análise com as repetidas por código ou, sem código, por nome, os lotes e a planilha de não importados) e `deal-logic.ts` (os rótulos `PRODUCT_KIND_LABELS` e `DEAL_ITEM_BILLING_LABELS`). A consulta é `useProducts` (`src/hooks/useProducts.ts`), na chave `['crm', orgId, 'products']`, a mesma do editor de itens.

## Regras de tela

- **As regras são do banco.** A RLS de `products` deixa todos da organização lerem e só donos e administradores gravarem; o índice único `products_org_code` recusa o mesmo código sem diferença de maiúscula e de espaços nas pontas. A tela explica antes e traduz a recusa.
- **Arquivar em vez de excluir.** Um item usado numa oportunidade não sai do catálogo (a FK de `deal_items` não tem `ON DELETE`): arquivado, ele some do seletor dos itens novos e continua, com "(arquivado)", nos itens que já o têm. A importação não reativa arquivados.
- **O catálogo sugere, a oportunidade negocia.** O nome, a unidade, o preço e a cobrança são copiados para o item da oportunidade ao escolher; mudar o catálogo não muda oportunidades já registradas.
- **Celular**: a lista empilha cada item, os botões de ação têm 44 px (`.eia-touch-target`), e os diálogos ocupam a largura da tela menos a margem, com `max-h-[92dvh]` e rolagem interna, sem rolagem lateral.

## O que testar ao mexer aqui

- Unitários: `CatalogSettings.test.tsx` (a busca e o filtro, os papéis, criar, o código repetido, o conflito de versão, arquivar, excluir o usado, o banco sem a migração, o modelo e a importação com a prévia e a planilha de não importados), `CatalogImportDialog.test.tsx` (o 23505 no meio, o 42501, a falha de rede e "Continuar" com os mesmos ids), `src/lib/product-import*.test.ts`, `src/lib/sheet-import.test.ts` e `src/hooks/useProducts.test.tsx`; a aba em `src/pages/Settings.test.tsx`.
- Banco: `supabase/tests/catalog.sql` (a RLS, o código único, a FK e a auditoria), no `npm run test:db`.
- E2E: `tests/browser/catalog.spec.ts`, no desktop e no celular: cadastrar, editar, o código repetido, arquivar e reativar; o colaborador só consulta; excluir o usado; a importação de um CSV do Excel (Windows-1252, `;`) com a prévia, a gravação e a planilha de não importados; o banco sem a migração; e o layout a 320, 375 e 1440 px, claro e escuro, com um nome longo sem espaços.
- Ajuda: a Central cita "Catálogo", "Novo item", "Importar planilha", "Baixar modelo" e "Baixar itens não importados", conferidos por `faq-content.test.ts` nesta pasta e em `Settings.tsx`.
