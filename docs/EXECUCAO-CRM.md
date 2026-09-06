# Execução do CRM Empreende IA

Data: 06/09/2026. Escopo: plano aprovado em `PLANO-CRM.md`, com confirmação de que o CRM atende qualquer segmento de negócio.

## Decisões de domínio

- **Contato** é uma pessoa; **empresa** é uma organização relacionada. Nomes não definem identidade. E-mail preenchido é único por organização, sem distinção de maiúsculas/minúsculas; ausência de e-mail é permitida. Não ocorre união automática de cadastros por nome.
- **Oportunidade** pertence a um funil e uma etapa por IDs. Renomear etapas mantém seus vínculos. Valor é não negativo em BRL; ganho exige responsável; perda exige motivo. Ganho/perda normalizam probabilidade para 100/0; reabertura usa a probabilidade da etapa. A previsão considera apenas abertas e é uma estimativa da equipe, não recebimento.
- **Atividade** representa tarefa, reunião, ligação, e-mail registrado ou nota. Agenda, Hoje, Tarefas e ficha 360 reutilizam o mesmo ID. Próxima ação é a atividade pendente, diferente de nota, com prazo mais próximo. Sem prazo, aparece como lacuna e não recebe data inventada.
- **Fila de atenção** aplica regras por organização: atraso, ausência de responsável, ausência de próxima ação e oportunidades sem atualização por um número configurável de dias. Prioridade é explícita; não existe score opaco.
- **Recebimento** pertence a `payments`; oportunidade ganha não gera pagamento por inferência. Status financeiros: pendente, pago e cancelado. Datas/valores não finitos são rejeitados no banco.
- **Papéis**: dono e administrador gerenciam configuração; colaborador altera registros comerciais; leitura não grava. Todas as pessoas consultam os dados comerciais da própria organização. Exclusões são restritas a administradores e respeitam vínculos históricos.
- **Convites** geram links, sem envio automático. O aceite exige o e-mail confirmado correspondente e uma conta ainda sem organização; o convite expira em 7 dias e é de uso único. Uma conta já vinculada recebe uma explicação, sem transferência silenciosa.
- O legado clínico e suas funções/migrações foram arquivados fora dos caminhos ativos. Nenhum dado foi transformado ou migrado.

## Frentes e aceite

| Frente | Entregue no código | Verificação |
| --- | --- | --- |
| DS e navegação | Marca oficial, temas, desktop/mobile, navegação comercial, cabeçalhos e componentes | Build/typecheck; inspeção visual e testes de layout em 320/1440 px, light/dark |
| Relacionamentos | Contatos/empresas CRUD, 360, responsáveis, timeline, próxima ação, visões locais por pessoa/org | Testes de filtros/URLs/paginação/editor e fluxo browser com fixtures |
| Pipeline | CRUD, funis configuráveis, drag e menu, regras ganho/perda, histórico e previsão | Testes de regras/formulário; browser de movimentação; PostgreSQL de integridade e RLS |
| Rotina | Hoje, agenda diária/semanal, atividades e tarefas, conclusão/reabertura/reagendamento | Testes de datas locais/duração/deduplicação e fluxo completo browser |
| Busca e recuperação | RPC parametrizada, resultado abre registro exato, contexto da lista preservado, erro/retry e estado indisponível | Browser com fixtures e consulta SQL real; resposta sem registros não mascara falha |
| Orientação | Oito tours reais, opt-in, pausa/retomada/replay, versões, escopo por conta/org, teclado e movimento reduzido | Vitest com Radix e testes browser dos oito tours em light/dark/mobile, sem mutações |
| Onboarding | Checklist e guia com uma fonte de verdade derivada de configuração/registros reais | Testes de coordenação de overlays, pausa, escopo e critérios; ver tour não conclui configuração |
| Operação | Financeiro, relatórios, templates e automações de tarefas por eventos | Testes de regras/editor/exportação e triggers PostgreSQL com histórico real |
| Integrações | CSV com prévia/validação/duplicidade/idempotência e ICS manual | Testes de parsing, células de planilha e ICS; reconsulta antes de cada tentativa de importação |
| Copiloto | Leitura por regras, evidências com links, informação desconhecida explícita e revisão de atividade sugerida | Testes de fontes/ausência de evidência e imutabilidade; sem modelo externo conectado |
| Segurança | Base nova, RLS, FKs por org, autoria, identidade/cronologia imutáveis, grants mínimos e papéis server-side | Cadeia completa aplicada em PostgreSQL descartável e suíte de isolamento/integridade |
| Ambiente definitivo | Credenciais antigas removidas; guard impede uso sem configuração exclusiva; organização HG - Aulas indicada e nova conexão OAuth autenticada | **Pendente**: confirmação do custo informado de US$ 0/mês, provisionamento do projeto exclusivo e validação da autenticação real |

## Automações e integrações: comportamento exato

Automações são criadas pausadas. Um administrador revisa o gatilho, título e prazo da tarefa antes de ativar. Eventos disponíveis: oportunidade criada, ganha ou movida. Se uma ação ganha a oportunidade e muda a etapa simultaneamente, o gatilho de ganho tem prioridade. Repetir o mesmo estado não duplica uma execução. O responsável da tarefa é herdado da oportunidade; ausência de responsável continua visível como pendência.

CSV aceita até 500 contatos/2 MB por arquivo, com os cabeçalhos `first_name,last_name,email,phone`. A prévia informa e-mails já cadastrados e não grava até confirmação. Os IDs de uma prévia são mantidos ao repetir a mesma importação. Cada tentativa reconsulta IDs/e-mails: se outra pessoa já cadastrou algum contato, ou uma tentativa anterior gravou sem resposta, a prévia apresenta apenas os restantes para nova confirmação. A restrição de e-mail do banco impede concorrência entre a reconsulta e a gravação; nesse caso a tela explica como atualizar a lista. Exportações neutralizam fórmulas de planilha.

ICS contém reuniões pendentes na hora da exportação. Não é sincronização contínua com Google/Outlook. E-mail e WhatsApp não têm conexão ativa, envio automático ou credenciais configuradas nesta entrega.

O Copiloto atual é uma análise determinística dos registros. Não envia dados a provedores externos e não simula uma resposta de modelo generativo. Conectar um provedor de IA exige uma implementação/configuração distinta com credenciais, custos e política de dados definidos.

## Estado de configuração e dados de orientação

Os tours guardam somente IDs técnicos, versões, preferência e posição, localmente por usuário e organização, com fallback em memória. Não há sincronização entre dispositivos ou telemetria remota. O guia de configuração guarda posição, e seus critérios de conclusão vêm do banco; não usa o antigo `onboarding_completed` para fingir configuração concluída.

Não foram definidos ganhos percentuais, metas ou baseline de adoção fictícios. As evidências desta entrega são testes funcionais e inspeções. Medição operacional depende do ambiente novo e de dados reais.

A fase 5 do plano permanece parcialmente entregue. A análise por regras com fontes não representa uma integração com modelo generativo. A expansão de tours e ajuda baseada em dificuldades observadas depende de escolher participantes e executar um piloto real; nenhum teste simulado comprova essa observação. A instrumentação de eventos e seu destino continuam sem implementação. O piloto pode começar com observação manual: localizar um cadastro, criar oportunidade e próxima ação, concluir/reagendar, recuperar uma falha e configurar um recurso. Registrar resultado, intervenção necessária, passos e dificuldades por fluxo/papel/dispositivo, sem copiar conteúdo de clientes; priorizar mudanças depois dessa linha de base.

## Validação e limites de aceite

O banco de testes usa PostgreSQL real, com roles `authenticated`/`anon` e uma função `auth.uid` de teste. Isso verifica migrações, constraints, RLS, RPCs e triggers, mas não substitui a validação de Supabase Auth, PostgREST e Edge no ambiente remoto.

Os testes de navegador usam fixtures explícitas de uma API isolada. Verificam renderização, interações, gravações esperadas, erros, permissões de apresentação e tours. Eles não certificam a disponibilidade de um backend remoto nem enviam mensagens.

Antes do aceite operacional ainda é necessário: criar o projeto exclusivo após confirmar custo na organização escolhida; conferir banco vazio; aplicar migrações; executar advisors; configurar autenticação; criar contas de teste de organizações diferentes e repetir o fluxo real de cadastro, oportunidade, atividade, conclusão e isolamento. Não apontar o app para o projeto copiado ou para outro projeto existente.

Em 06/09/2026 o usuário escolheu a organização `jbsjxwtmdhewvpsygrum`, identificada no painel como **HG - Aulas** (Free). A conexão local `supabase-empreende-ia` foi cadastrada via OAuth e o login retornou sucesso. A conexão anterior só tem acesso a HG. A nova ferramenta foi carregada e confirmou acesso à organização via MCP. A consulta de custo retornou 0 por mês; a confirmação obrigatória foi apresentada ao usuário antes de criar o projeto. Nenhum projeto, banco ou recurso remoto foi criado ou alterado nesta etapa.

O código local e os testes podem ser revisados agora. A entrega operacional não deve ser marcada concluída enquanto essa pendência de ambiente não for resolvida.

## Evidências desta revisão

- **183 testes Vitest passaram** em 24 arquivos (regras comerciais, formulários, parsing, Auth, tours e onboarding).
- **51 verificações PostgreSQL passaram** aplicando toda a cadeia do zero em cluster descartável.
- **62 cenários Playwright passaram** na suíte consolidada anterior (API de fixture). Nesta revisão, os oito fluxos existentes e cinco novos cenários de recuperação passaram em execuções dirigidas; o catálogo possui 67 cenários, ainda sem uma execução consolidada dos 67.
- TypeScript e build de produção passaram. ESLint: zero erros e nove avisos de Fast Refresh em componentes compartilhados. O build mantém aviso de chunk principal acima de 500 kB (aproximadamente 713 kB / 213 kB gzip), sem impedir a compilação.
- Um build com chave privilegiada de teste foi rejeitado antes de gerar o frontend. Nenhuma credencial real foi usada nesse teste.
- Varredura de 349 arquivos do projeto: nenhuma referência às marcas excluídas pelo pedido original. Os 158 arquivos alcançáveis da aplicação e testes não contêm terminologia clínica ou imobiliária.

As imagens abaixo usam dados fictícios dos testes, não dados de uma organização real:

- [Hoje, desktop escuro](previews/hoje-desktop.png)
- [Contatos, celular claro em 320 px](previews/contatos-mobile.png)
