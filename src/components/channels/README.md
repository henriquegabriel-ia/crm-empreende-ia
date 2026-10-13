# Canais: WhatsApp, e-mail e telefone

Os componentes desta pasta ligam o CRM aos canais que a empresa já usa (item 1.9 do [roteiro](../../../docs/ROADMAP-FINALIZACAO.md); desenho em [docs/arquitetura/1.9.md](../../../docs/arquitetura/1.9.md)). O CRM abre o aplicativo da pessoa e nunca envia nada: abrir um canal cria uma pendência "Para registrar", e o registro do que aconteceu é uma atividade, na tabela `activities`, que entra sozinha na linha do tempo 360, em "Concluídas hoje", no "Último contato" e na próxima ação.

## Componentes

| Arquivo | O que faz |
| --- | --- |
| `ChannelBar.tsx` | "WhatsApp", "E-mail" e o menu "Ligar" ("Ligar", "Copiar número" e "Registrar ligação"). Na ficha 360 do contato e da empresa, no painel da oportunidade e no detalhe da atividade; com `only`, um controle só, o botão do canal de cada ligação, WhatsApp ou e-mail pendente de Hoje, Atividades, Tarefas, da "Próxima ação" da ficha e das "Próximas ações" da oportunidade (a atividade é a origem do registro). Cada controle indisponível fica desabilitado e aponta para o motivo (`aria-describedby`). Com `showPending`, mostra abaixo as pendências deste alvo |
| `ComposeDialog.tsx` | "Mensagem por WhatsApp" e "Mensagem por e-mail": modelo (`useMessageTemplates`), assunto e texto revisáveis, variáveis que faltam, "Abrir no WhatsApp", o menu "Abrir e-mail" e "Copiar texto"; acima do limite de URL, "Copiar texto e abrir sem ele" |
| `InteractionPromptProvider.tsx` | Montado no `AppLayout`: guarda as pendências da aba, mostra a faixa do rodapé e abre o diálogo do registro (`useInteractionPrompt`, em `interaction-context.ts`). Fora dele (testes de componente), os canais abrem e nada é guardado |
| `PendingInteractionsInline.tsx`, `PendingInteractionsDock.tsx` | As pendências dentro do painel de onde a pessoa partiu e na faixa "Para registrar" do rodapé, que só aparece sem diálogo aberto (`useOtherDialogOpen`, sobre `src/lib/dialogs.ts`) e reserva o próprio espaço na área de trabalho (`--eia-dock-reserve`) |
| `InteractionDialog.tsx` | O registro, em três modos: `register` (interação nova, ou a conclusão da atividade pendente sugerida), `complete` (`complete_activity`, inclusive "Concluir e agendar a próxima") e `schedule` ("Agendar a próxima" depois de um "Concluir" simples). A próxima ação é `NextActionFields` (`next-action.ts`) |
| `DoNotContactPanel.tsx` | A faixa "Não contatar" da ficha, "Marcar como não contatar" (quem edita) e "Permitir contato de novo" (donos e administradores), com textos por tipo: na empresa, a marca vale para o telefone dela, sem e-mail, e os contatos continuam liberados |
| `PhonePreview.tsx` | A prévia do telefone no cadastro ("Será salvo como (11) 99999-0000, celular."), no molde de `MoneyPreview` |
| `clipboard.ts` | `copyText` e `openChannelLink`, que abre um link de canal depois de copiar o texto, com os mesmos atributos dos links da tela |

As regras puras ficam em `src/lib`: `channels.ts` (telefone e e-mail dos canais e os links), `message-templates.ts` (variáveis dos modelos), `interactions.ts` (pendências, sugestão da atividade pendente, "Último contato", título do registro e a data da linha do tempo) e `phone.ts` (o formato brasileiro).

## Links e privacidade

- **Só `src/lib/channels.ts` monta link de canal**: `whatsappUrl`, `telUrl`, `mailtoUrl`, `gmailComposeUrl`, `outlookComposeUrl` e `emailLink`/`whatsappLink`, que dizem se o link coube com o texto. Uma codificação por parâmetro (`encodeURIComponent` sobre o texto final), quebras `%0D%0A` no `mailto:` e `%0A` nos demais, caractere substituto isolado trocado por U+FFFD, o endereço de e-mail codificado com `@` mantido (um "a@b.com?cc=x@y.com" não acrescenta destinatário) e limite de 2.000 caracteres por URL (`CHANNEL_URL_MAX`).
- **Nada além do necessário vai a terceiros**: nos parâmetros do WhatsApp, do Google e da Microsoft só vão o número ou o endereço, o assunto e o texto que a pessoa revisou; nada de id, URL ou nome do CRM. Todo link externo é um `<a>` com `EXTERNAL_LINK_PROPS` (`target="_blank"`, `rel="noopener noreferrer"` e `referrerpolicy="no-referrer"`), para o endereço do CRM, que tem o id do contato na consulta, não ir no `Referer`; `tel:` e `mailto:` usam `APP_LINK_PROPS`, na mesma aba.
- **O texto da mensagem nunca é guardado**: nem na URL do CRM, nem no armazenamento do navegador, nem no banco. O assunto do e-mail fica só na memória do provedor, para o título do registro.
- **"Abrir no Outlook web"** é para contas Microsoft 365 (`outlook.office.com`); com conta pessoal, "Abrir no aplicativo de e-mail".

## Pendências e registro

- A pendência nasce no clique de "Abrir no WhatsApp", de cada item de "Abrir e-mail", de "Ligar" e de "Copiar número", só para quem edita. Fica na `sessionStorage` da aba (`empreende-crm:interactions:v1:<organização>:<pessoa>`), só com ids, canal e hora: até 10, por até 12 horas. A mesma chave (atividade de origem, ou canal + contato ou empresa + oportunidade) renova a hora e mantém os ids: abrir de novo não duplica.
- Os ids da interação e da próxima ação nascem com a pendência: o registro é um único `POST` em lote em `activities`, com as duas linhas com as mesmas chaves, e a nova tentativa depois de uma resposta perdida é reconhecida pelo id (`23505` seguido da leitura).
- Com uma atividade de origem pendente, ou com exatamente uma do mesmo canal para o contato até o fim do dia (`matchingPendingActivity`), o registro conclui essa atividade por `complete_activity`, com a guarda de versão. Uma recusa por versão relê a atividade no snapshot: pendente, a nova tentativa vale para a versão atual; concluída, nada mais é gravado e "Registrar como nova" não aparece, porque duplicaria; excluída, sobra registrar como nova.
- "Não contatar" no registro: o aviso aparece, a próxima ação vem desmarcada e do tipo tarefa, e "Concluir e agendar a próxima" vira um "Concluir" com a próxima ação opcional. O banco não recusa (registrar o que já aconteceu continua possível); a recusa de ações planejadas no servidor é do item 1.10.
- Num banco sem a migração `20261013110000_channel_interactions.sql`, as gravações novas mostram `CHANNELS_MIGRATION_MISSING` (`src/lib/rpc-errors.ts`), a marca ausente conta como falsa, e a edição de uma ligação concluída só manda o resultado quando a pessoa o muda.

## O que testar ao mexer aqui

- Unitários: `src/lib/channels.test.ts` (telefone, e-mail, cada link, a tabela de codificação e o limite), `message-templates.test.ts`, `interactions.test.ts`, `phone.test.ts` e os testes desta pasta (motivos de desabilitado, "Não contatar", Somente leitura, pendências, corpo do `POST`, `complete_activity`, conflito, resposta perdida e banco sem a migração).
- Banco: `supabase/tests/channels.sql` e a corrida `completeActivityRace` de `scripts/test-database.mjs`, no `npm run test:db`.
- E2E: `tests/browser/channels.spec.ts`, no desktop e no celular (o projeto `mobile-chrome` o inclui): os links abertos com os parâmetros exatos, o registro, a resposta perdida, "Não contatar" em todas as telas, o diretório, "Concluir e agendar a próxima" com o conflito e o layout a 320, 375 e 1440 px, claro e escuro, com a faixa "Para registrar" acima da navegação inferior sem cobrir o fim da tela.
- Ajuda: a categoria "WhatsApp, e-mail e telefone" da [Central](../help/README.md) cita os nomes destes componentes, conferidos por `faq-content.test.ts`; um botão renomeado aqui reprova a resposta que o cita.
- Pendente de pessoas (roteiro, item 1.9): conferir em aparelhos reais o WhatsApp (Android, iPhone e WhatsApp Desktop), o Gmail, o Outlook web com Microsoft 365, o `mailto:` com o Outlook para Windows e o `tel:`, e a volta ao CRM no celular.
