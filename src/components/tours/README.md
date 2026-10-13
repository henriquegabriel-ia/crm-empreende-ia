# Tours do CRM Empreende IA

Engine adaptada dos componentes locais de orientação da Lara. O catálogo (`catalog.ts`) descreve oito fluxos comerciais. Nenhum passo dispara a ação destacada, consulta dados pessoais ou marca onboarding como concluído. Os textos acompanham o comportamento das telas: a revisão de 13/10/2026 os pôs em dia com a F0 do roteiro (valores no padrão brasileiro, probabilidade da etapa, movimentação otimista no kanban, automações editadas sem pausar, com filtro de funil e etapa e com as execuções, e a fila que agrupa contatos sem próxima ação), sem mudar passos nem versões. Os passos citam entre aspas curvas os botões que ensinam (“Revisar e ativar”, “Execuções”, “Baixar modelo CSV”…), e o seletor do Pipeline é o do funil, como em Configurações (aba Funis).

## Integração

No layout autenticado, dentro do Router, envolva o shell **uma única vez**. `scope` usa os IDs canônicos da pessoa e da organização (não e-mail ou nome). Use `null` durante saída da conta e até a organização estar disponível.

```tsx
import { ProductTourProvider, TourLauncher, TourHelpCatalog } from '@/components/tours';

<ProductTourProvider
  scope={user && orgId ? { userId: user.id, orgId } : null}
  blocked={onboardingOpen}
>
  {/* shell e páginas */}
  <TourLauncher />
</ProductTourProvider>
```

`TourLauncher` deve ficar no cabeçalho/ajuda persistente; não colocar dentro de um modal. A primeira visita elegível mostra “Conhecer esta tela”, sem capturar foco. Depois de pausa mostra “Continuar tour” e “Recomeçar”. O botão permanece disponível para replay após conclusão/dispensa. Em telas sem alvos disponíveis, o botão desabilitado informa o motivo por `title` e nome acessível.

Na página Ajuda renderize `<TourHelpCatalog />` **dentro do provider**. O catálogo oferece os oito destinos e preferências separadas de convite e orientação automática. “Abrir tela” navega; a pessoa começa pelo disparador da tela de destino.

Os formulários Radix/HTML já bloqueiam os tours pela detecção de diálogos visíveis. `blocked` cobre também onboarding ou outros fluxos que não sejam diálogos. Troca de rota, query string, hash, organização, conta ou abertura de formulário encerra o overlay preservando o último passo. Nenhum pedido fica aguardando para abrir em uma rota diferente.

Se o shell tiver um destino estável de foco, marque seu botão/título com `data-tour-focus-fallback`. Quando o disparador não existir mais, o fechamento usa esse destino ou `main`. Um formulário aberto e um campo que a pessoa já focou têm prioridade sobre a restauração.

## Contrato de âncoras

Marque a região da página com `data-product-tour`. Cada alvo usa `data-tour`; não depende de classes CSS nem IDs de registros. Pode haver a mesma âncora em versões desktop/mobile: a engine escolhe a primeira visível. Ações sem permissão devem ficar ausentes conforme as regras da própria página.

| Roteiro (`data-product-tour`) | Caminho do catálogo | Âncoras `data-tour`, na ordem |
| --- | --- | --- |
| `dashboard` (aceita `today`) | `/dashboard` | `today-summary`, `today-attention`, `today-activities`, `shell-quick-actions` |
| `contacts` | `/contacts` | `contacts-search`, `contacts-filters`, `contacts-views`, `contacts-list`, `contacts-create` (quem edita) |
| `pipeline` | `/pipeline` | `pipeline-selector`, `pipeline-summary`, `pipeline-board`, `pipeline-move` (quem edita, no primeiro cartão), `pipeline-create` (quem edita) |
| `agenda` | `/agenda` | `agenda-view`, `agenda-date`, `agenda-filters`, `agenda-calendar`, `agenda-create` (quem edita) |
| `tasks` | `/tasks` | `tasks-filters`, `tasks-list`, `tasks-create` (quem edita), `tasks-status` (quem edita, na primeira tarefa) |
| `financeiro` | `/financeiro` | `finance-summary`, `finance-filters`, `finance-list`, `finance-create` (quem edita) |
| `automations` | `/automations` | `automations-list`, `automations-trigger` (na primeira automação), `automations-create` (dono e admin), `automations-status` (dono e admin, na primeira automação) |
| `integrations` (versão 2) | `/settings/integrations` | `integrations-catalog`, `integrations-import` (quem edita), `integrations-export` (dono e admin), `integrations-help` |

"Quem edita" são dono, administrador e colaborador (`EDITOR_ROLES`); "dono e admin", os papéis de `MANAGER_ROLES` (`src/lib/roles.ts`). Para os demais papéis a âncora não existe, e o passo é omitido: com acesso somente leitura, o tour de Contatos tem 4 passos, e não 5. Uma âncora marcada só no primeiro item some quando a lista está vazia.

Âncoras sem roteiro no catálogo: `data-product-tour="activities"` e `companies`, com as âncoras `activities-*` e `companies-*` geradas pelos mesmos componentes de Tarefas e Contatos, `today-status` (primeira atividade de Hoje), `agenda-status` e `agenda-undated-status` (primeira atividade da lista da Agenda e da lista sem data, pelo `tourPrefix` de `ActivityList`), `pipeline-record` e `pipeline-stages` no quadro e `360-summary`, `360-next-action`, `360-timeline` e `360-deals` na ficha 360. Ficam prontas para roteiros futuros; nessas telas, o disparador do tour fica desabilitado e explica o motivo.

`/settings/integrations` fica atrás do `RequireRole` (`src/components/layout/RequireRole.tsx`): quem tem acesso somente leitura vê a tela explicativa, sem `data-product-tour`, então o tour `integrations` só funciona para quem edita. O catálogo da Ajuda (`TourHelpCatalog`) ainda lista esse tour para todos os papéis: com acesso somente leitura, "Abrir tela" leva à tela explicativa, com o disparador desabilitado. Esconder ou marcar a entrada por papel fica para a fonte única de navegação (roteiro, item 2B.12). Uma rota nova guardada por papel tem o mesmo efeito sobre o tour dela.

Alvo ausente antes do início é omitido. Se desaparecer durante um passo, o cartão explica a ausência e permite avançar ou pausar. Uma tela sem alvos não abre máscara. O catálogo deve ser revisto quando mudar o comportamento ensinado, junto com a Central de ajuda ([`src/components/help`](../help/README.md)). Alterar apenas texto não exige nova versão; mudanças incompatíveis nos passos (passo novo, removido ou trocado de âncora) exigem incrementá-la, e quem já concluiu o roteiro recebe de novo o convite discreto. Os textos dizem quem pode usar o recurso com os nomes dos papéis da Equipe e citam entre aspas curvas o nome exato dos botões e telas que ensinam. `tour-state.test.ts` confere que cada nome citado aparece inteiro num dos arquivos da tela do roteiro (`TOUR_SCREENS`), no começo de um texto da tela e sem outra palavra logo depois, como na Ajuda (`src/test/ui-labels.ts`; comentários, a Ajuda e o guia não contam como prova), e exige ao menos 15 citações, para o teste não passar vazio. Assim, um botão renomeado na tela do roteiro, como “Pausar” em Automações, reprova o passo que ainda o cita, mesmo que a palavra continue numa frase ou em outra tela; o limite é o mesmo nome inteiro em outro texto dos arquivos do roteiro. Um roteiro novo entra também em `TOUR_SCREENS`.

## Estado e verificação

Chave: `empreende-crm:tours:v1:<orgId codificado>:<userId codificado>`. Guarda apenas preferências, IDs/versões do roteiro e IDs dos passos pausados. `automatic=false` por padrão. Posição é salva a cada passo para resistir a recarga. JSON inválido volta ao padrão; storage bloqueado usa memória isolada por escopo. Não há sincronização entre dispositivos ou telemetria remota.

Os testes usam o diálogo Radix real, simulação de geometria no JSDOM, persistência real do ambiente de teste e stubs apenas para APIs de layout. Verificam opt-in, pause/replay, Esc, retorno de foco, bloqueios, ausência de alvos, recarga, versão, escopo, dados inválidos, fallback de storage e posicionamento em 320 px/teclado/zoom. No navegador, `tests/browser/tours.spec.ts` percorre os oito roteiros como dono, a 320 px, em claro e escuro, e confere que cada âncora do catálogo existe na tela real; com acesso somente leitura, que só os passos permitidos aparecem.

```sh
npm test -- src/components/tours
npx tsc --noEmit -p tsconfig.app.json
npx eslint src/components/tours
```
