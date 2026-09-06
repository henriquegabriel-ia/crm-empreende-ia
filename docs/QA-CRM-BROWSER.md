# Verificação do CRM no navegador — 6 de setembro de 2026

O navegador percorre a interface React real e o cliente Supabase real, com respostas HTTP fictícias controladas exclusivamente pelos testes. A verificação cobre renderização, navegação, payloads enviados, mudanças em memória da fixture e atualização das telas. **Não comprova autenticação, conectividade, RLS ou execução de triggers em um projeto Supabase remoto.** Esses limites precisam permanecer explícitos ao comunicar a entrega; os testes PostgreSQL do repositório verificam as regras do banco em uma camada separada.

## Resultado

A suíte consolidada executou **62 cenários, todos aprovados**, em Chromium com fuso `America/Sao_Paulo`. Após a última compactação dos filtros de Contatos e dos indicadores de Hoje, os **11 cenários diretamente afetados de layout e tours foram repetidos e aprovados**. TypeScript e ESLint dos arquivos de relacionamentos e rotina passaram. Os helpers, persistência e formulários dessas frentes somam 31 testes unitários/de componente aprovados, incluindo execução explícita com `TZ=America/Sao_Paulo` para datas e reagendamento.

| Cobertura no navegador | Cenários | Evidência |
| --- | ---: | --- |
| Renderização sem erro JavaScript das páginas | 15 | `tests/browser/smoke.spec.ts` |
| Falha de leitura e recuperação por “Tentar novamente” | 15 | `tests/browser/smoke.spec.ts` |
| Operação e persistência de contexto | 8 | `tests/browser/flows.spec.ts` |
| Oito tours, teclado, pausa, recarga, replay, ajuda e papéis | 20 | `tests/browser/tours.spec.ts` |
| 320 e 1440 px nos temas claro e escuro | 4 | `tests/browser/smoke.spec.ts` |

Páginas: Hoje, Contatos, Empresas, Pipeline, Atividades, Tarefas, Agenda, Financeiro, Relatórios, Automações, Modelos, Equipe, Configurações, Integrações e Segurança. A falha de Configurações é exercitada na aba Organização, que consulta a configuração da organização; o formulário de perfil possui outra fonte de dados.

Os oito fluxos exercitados:

1. Criar contato → criar oportunidade vinculada → criar tarefa vinculada → encontrá-la em Hoje → concluir → conferir a ficha 360.
2. Busca global abre o cadastro exato; voltar pelo navegador restaura pesquisa, carteira e ordenação.
3. Mover oportunidade por menu acessível altera `stage_id` e adiciona evento ao histórico da fixture.
4. Falha de cadastro preserva os campos; uma nova tentativa salva exatamente um registro.
5. Um ID de outra organização produz ficha indisponível e mantém os filtros ao voltar.
6. Papel de consulta não oferece ações de gravação e não dispara mutações HTTP.
7. Cadastro sem vínculos é editado e excluído somente após confirmação explícita.
8. Visão salva restaura filtros, colunas e ordenação depois de recarregar; abrir e fechar uma ficha preserva esse contexto.

## Revisão visual

Inspeção dos screenshots de Contatos e Hoje verificou as páginas nos dois temas. No celular, o cabeçalho passou de aproximadamente 200 px para até 120 px; o launcher mantém nome acessível mesmo usando texto visual curto. Os filtros de carteira usam um select móvel, busca/ordenação/colunas ficam acessíveis, e os indicadores de Hoje usam duas colunas com rótulos completos. O documento não apresenta overflow horizontal nas 15 rotas. Tabelas e quadro mantêm a própria rolagem horizontal intencional.

Os arquivos temporários ficam em `/tmp/crm-qa/`:

- `contacts-{light,dark}-{320,1440}.png`
- `today-{light,dark}-{320,1440}.png`
- `report/index.html`: relatório da execução mais recente (cada execução substitui esse relatório).
- `results/`: traces e screenshots de falhas, quando houver.

Os screenshots contêm **dados de teste**, incluindo “Contato Alfa”, “Empresa Exemplo” e “Projeto Exemplo”. Não representam uma organização ou operação real.

## Reproduzir

```sh
npm ci
npx playwright install chromium
npx playwright test
```

O arquivo `playwright.config.ts` inicia um Vite exclusivo na porta 8096, com uma chave pública fictícia e endpoint `127.0.0.1:54329`. Os testes interceptam esse endpoint; não é necessário subir um Supabase para estes cenários. A configuração recusa reutilizar uma porta ocupada, protegendo outros projetos em execução. As fixtures estão somente em `tests/browser/fixture.ts`, sem modo de demonstração embutido no produto.

Para a regressão móvel final:

```sh
npx playwright test tests/browser/smoke.spec.ts tests/browser/tours.spec.ts --grep 'layout|contacts:|dashboard:|pause, reload|viewer receives|short landscape'
```

Para a camada de relacionamentos e rotina:

```sh
npx vitest run src/lib/contact-model.test.ts src/lib/contact-saved-views.test.ts src/hooks/useSavedViews.test.tsx src/hooks/useCrmSnapshot.test.ts src/lib/activity-logic.test.ts src/components/commercial/RecordEditor.test.tsx src/components/workday/ActivityDialog.test.tsx
```

## Contratos implementados

`useCrmSnapshot()` compartilha `contacts`, `companies`, `deals`, `activities`, `members`, `riskRules`, `pipelines` e `stages` em cache por organização e usuário. Pagina em blocos ordenados de 500; uma falha intermediária rejeita a consulta inteira em vez de publicar contagens incompletas. A ficha 360 usa o mesmo snapshot. Todos os fluxos de rotina invalidam a chave `['crm']` após gravação confirmada.

`ActivityDialog` é o editor único para Hoje, Atividades, Tarefas, Agenda, ficha 360 e sugestões revisáveis. Aceita `data`, `activity?`, `defaults?`, `onClose` e `onSaved?`. Quando `onSaved` é fornecido, ele recebe o ID e o chamador controla o fechamento; sem ele, o editor chama `onClose` após sucesso. `defaults` admite título, detalhes, tipo, responsável, vínculos e prazo. Reagendar reunião/ligação preserva duração; converter em nota remove datas. O usuário confirma qualquer gravação.

Próxima ação é a atividade pendente, diferente de nota, com menor prazo válido. IDs são deduplicados nos indicadores e filas. “Vencidas” e “Para hoje” podem se sobrepor como indicadores; a lista do dia reúne cada atividade uma vez e explica esse recorte. As regras de atenção usam apenas critérios habilitados, prioridade configurada e limite de dias da regra de oportunidade sem atualização.

As visões salvas ficam no navegador, versionadas e isoladas por usuário/organização. Não há alegação de sincronização entre dispositivos.

A confirmação por `.select()` após update segue a [referência oficial do Supabase](https://supabase.com/docs/reference/javascript/update). Os limites inclusivos e a ordenação usada na paginação seguem a [documentação de range](https://docs-supabase.vercel.app/docs/reference/javascript/using-modifiers-range).
