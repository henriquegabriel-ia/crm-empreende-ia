# Ambiente do dono do produto

Fatos do ambiente de trabalho do dono do produto, retirados do README, de `docs/PUBLICACAO-CRM.md`, de `docs/INTEGRACOES-PENDENTES.md` e do roteiro no item 0.3 (11/10/2026). Nada daqui vale para a instância de uma empresa: cada empresa usa o próprio projeto Supabase, a própria hospedagem e o próprio repositório.

## Projeto Supabase de desenvolvimento

| Campo | Valor |
| --- | --- |
| Projeto | **CRM Empreende IA** |
| Referência | `ldahvopyqkdiecchukwz` |
| URL | `https://ldahvopyqkdiecchukwz.supabase.co` |
| Organização Supabase | **HG - Aulas** (`jbsjxwtmdhewvpsygrum`), plano Free, custo informado de 0 por mês |
| Região | `sa-east-1` (São Paulo) |
| Painel | [supabase.com/dashboard/project/ldahvopyqkdiecchukwz](https://supabase.com/dashboard/project/ldahvopyqkdiecchukwz) |

Desde o item 0.1 do roteiro (11/10/2026), este é o **ambiente de desenvolvimento do dono**:

- não guarda dados reais;
- só recebe migrações depois do CI verde;
- nunca é usado em piloto, porque cada empresa usa uma instância própria.

### Estado registrado

- O projeto foi criado vazio em 06/09/2026, sem importar dados do sistema anterior, e recebeu só as migrações ativas. Ver [QA-CRM-SUPABASE.md](QA-CRM-SUPABASE.md).
- As oito migrações estão aplicadas, com RLS nas 19 tabelas. As versões das migrações locais correspondiam ao histórico remoto nessa data.
- A 9ª, a 10ª e a 11ª migrações, `20261011100000_deal_closing_probability.sql` (item 0.6 do roteiro), `20261011110000_deletions_automation_scope.sql` (item 0.7) e `20261011120000_configuration_updated_at.sql` (item 0.8), foram aplicadas em 12/10/2026, antes do CI, com autorização do dono. A aplicação foi assim:
  - Pelo editor SQL do painel (papel `postgres`, dono das tabelas), num único script com `begin`/`commit`.
  - Cada migração foi registrada em `supabase_migrations.schema_migrations` com a versão e o nome do arquivo, no mesmo formato de um statement por migração já usado no histórico.
  - Antes, o script foi ensaiado num PostgreSQL local descartável: as oito migrações anteriores, os dados de `supabase/tests/upgrade/` e o script inteiro numa só consulta. O conteúdo colado no painel foi conferido pelo SHA-256 do arquivo ensaiado.
  - Conferido depois: histórico com 13 versões; colunas, funções e gatilhos novos presentes; a oportunidade aberta passou a herdar a probabilidade da etapa; integrantes sem leitura de `automation_logs.error_detail`.
  - A partir daqui, essas três migrações não mudam mais: qualquer ajuste entra como migração nova.
  - Enquanto o histórico remoto tiver as duas versões que faltam no repositório (ver a consulta abaixo), `npx supabase db push` recusa as próximas.
- **Migrações criadas e ainda não aplicadas neste projeto:**
  - `20261012100000_single_company_admission.sql` (item 1.1, empresa única com entrada só por convite). Cria o gatilho `enforce_invite_only_signup` em `auth.users`, que recusa conta nova sem convite pendente quando a instância já tem empresa (este projeto tem uma), e dá a `anon` o `USAGE` no schema `private`. Antes de aplicar:
    - conferir se as seis Edge Functions encontradas na consulta abaixo (Instagram e entrada de leads) criam usuários no Auth: se criarem, o gatilho as recusa;
    - conferir se `public.instagram_service` e `public.intake_service` são `SECURITY INVOKER` e executáveis por `anon` e chamam funções de `private` sem `revoke ... from public`: com o `USAGE` novo, essas funções passariam a rodar para `anon`. A consulta `select p.oid::regprocedure from pg_proc p where p.pronamespace = 'private'::regnamespace and has_function_privilege('anon', p.oid, 'execute')` deve devolver só `private.instance_status()` depois da migração;
    - aplicar a migração e usar o frontend do mesmo commit juntos (hoje o `npm run dev` local, com o `.env.local` apontando para este projeto; quando houver hospedagem, a publicação do mesmo commit): a Equipe de antes do item não cria convites com o banco novo;
    - enquanto as duas versões fora do repositório estiverem no histórico remoto, `npx supabase db push` continua recusando: a aplicação seguiria o mesmo caminho das migrações da F0, pelo editor SQL, com autorização do dono.
  - `20261012110000_admission_email_proof.sql` (reforço do item 1.1, de 12/10/2026: a conta só ganha papel depois de provar o e-mail). Aplicar logo depois da anterior, no mesmo script e com o frontend do mesmo commit, com os mesmos pré-requisitos. Cria a tabela `private.email_proofs` (vazia, sem privilégio para os papéis da API), o gatilho `discard_unproven_password` (`BEFORE UPDATE` em `auth.users`), que descarta a senha de uma conta na confirmação, o gatilho `record_email_proof` (`AFTER INSERT` em `auth.mfa_amr_claims`), que grava a prova do e-mail quando a sessão do link nasce na transação da confirmação e a conta está sem senha, o gatilho `refuse_email_change_without_org` (`BEFORE UPDATE` em `auth.users`), que recusa a troca de e-mail de uma conta sem organização (os três sem lista de colunas nem `WHEN`, para não barrar as migrações do Auth; revisão de 13/10/2026), e a função `private.email_proven()`, e substitui `enforce_invite_only_signup`, `create_workspace` e `accept_invitation` (as assinaturas não mudam). Não mexe em nenhuma senha existente. Mantenha a confirmação de e-mail ligada neste projeto (ver [Primeiro dono e convites](../PUBLICACAO-CRM.md#primeiro-dono-e-convites)): desligada, o cadastro entrega a quem pedir a sessão de uma conta não confirmada. A conta do dono já é membro e não passa mais pela admissão; uma conta antiga, já confirmada e sem organização, só aceita convite numa sessão aberta pelo link enviado ao e-mail.
  - `20261013100000_member_deactivation.sql` (item 1.2, desativar membro e transferir a carteira). Aplicar depois das duas do item 1.1, no mesmo script ou logo em seguida, e com o frontend do mesmo commit. Acrescenta `user_roles.deactivated_at` (todas as linhas existentes ficam ativas), a tabela `public.portfolio_transfers` (vazia), o gatilho `refuse_inactive_assignee` em `deals`, `activities`, `contacts` e `companies` (tabelas de `public`, sem dependência do schema `auth`) e as RPCs `member_portfolio`, `deactivate_member`, `transfer_portfolio` e `reactivate_member`, e substitui `current_org`, `set_member_role`, `create_invitation` e `restore_owner` (as assinaturas não mudam). `private.current_org()` passa a exigir papel ativo: como toda a RLS depende dela, conferir logo depois, com a conta do dono, que **Hoje** carrega e que **Equipe** mostra "Pessoas ativas". O backfill transforma em membro desativado um perfil com organização e sem papel (neste projeto, `select id, email from public.profiles p where org_id is not null and not exists (select 1 from public.user_roles r where r.user_id = p.id and r.org_id = p.org_id)` deve voltar vazio antes) e exclui os convites pendentes de quem hoje não poderia criá-los, com auditoria sem autor. Com o banco novo e o frontend antigo, quem for desativado veria o CRM vazio em vez de "Seu acesso foi encerrado".
  - `20261013110000_channel_interactions.sql` (item 1.9, canais nível 1 com registro). Aplicar depois da do item 1.2, no mesmo script ou logo em seguida, e com o frontend do mesmo commit. Aditiva e sem reescrever tabela: amplia o `CHECK` de `activities.type` com `whatsapp` e `visit` (`not valid` seguido de `validate`), acrescenta `activities.outcome` (anulável) com o gatilho `normalize_activity_outcome`, as colunas `do_not_contact`, `do_not_contact_at`, `do_not_contact_by` e `do_not_contact_reason` em `contacts` e em `companies` (a primeira com padrão `false`, sem reescrita), com a FK composta para `profiles`, o índice e o gatilho `stamp_do_not_contact`, e a RPC `complete_activity`. Nenhuma linha existente muda e nenhum telefone gravado é reescrito; não cria credencial, Edge Function nem dependência do schema `auth`. Conferir logo depois, com a conta do dono: **Hoje** carrega, a ficha de um contato abre com a barra "WhatsApp", "E-mail" e "Ligar", e `select count(*) from public.contacts where do_not_contact` devolve 0. Se a entrada de leads (`intake-api` ou `intake-webhook`) estiver em uso, um lead de teste continua criando o contato: o gatilho `stamp_do_not_contact` só confere o papel quando há uma conta da API, e a chave `service_role` grava contatos e empresas como antes (revisão do item 1.9, rodada 2). Com o banco novo e o frontend antigo, as atividades de WhatsApp e as visitas aparecem como "Atividade", e "Não contatar" não desliga nada.
  - `20261013120000_contact_privacy.sql` (item 1.10, LGPD da empresa controladora). Aplicar depois da do item 1.9, no mesmo script ou logo em seguida, e com o frontend do mesmo commit. Aditiva e sem reescrever tabela nem linha: acrescenta em `organizations` o padrão da base legal (`default_legal_basis`, com padrão constante `not_informed`, e a data e o autor), em `contacts` a base legal (`legal_basis`, padrão `not_informed`), o registro dela, a data, o autor e a anonimização (`anonymized_at` e `anonymized_by`), com os `CHECK`, as FKs compostas e os índices; a tabela `public.privacy_actions` (vazia, só leitura para donos e administradores); os gatilhos `stamp_default_legal_basis`, `stamp_legal_basis`, `protect_anonymized_contact`, `guard_anonymized_contact` (em `activities`, `deals` e `payments`) e `refuse_do_not_contact_action` (em `activities`); a nova versão de `stamp_do_not_contact` (mesma assinatura); e as RPCs `contact_privacy_summary`, `anonymize_contact` e `export_contact_data`. Nenhum gatilho dispara na migração, e a auditoria não ganha linhas. Conferir logo depois, com a conta do dono: **Hoje** carrega, a ficha de um contato abre com a linha "Base legal" ("Não informada") e, para o dono, a seção "Privacidade", e `select count(*) from public.contacts where legal_basis <> 'not_informed'` devolve 0. O guia "Configurar CRM" passa a mostrar a etapa da base legal pendente. Se a entrada de leads (`intake-api` ou `intake-webhook`) estiver em uso, um lead de teste continua criando o contato (com a base padrão da empresa e o autor nulo); se ela criar ligação, WhatsApp, e-mail, reunião ou visita pendente para um contato marcado "Não contatar", a atividade passa a ser recusada (a tarefa e a nota continuam). Com o banco novo e o frontend antigo, os contatos novos recebem o padrão da empresa, agendar ação de contato para quem tem a marca é recusado com a mensagem genérica, e editar um anonimizado é recusado.
  - `20261018100000_privacy_followup.sql` (item 1.11, acompanhamento da privacidade: achados 3 e 11 da revisão do item 1.10). Aplicar por último, depois da do item 1.10, no mesmo script, com o frontend do mesmo commit. Só altera a definição de `public.contact_privacy_summary` (o `statement_timeout` de 60 s, como o de `anonymize_contact`) e de `private.anonymize_contact` (mesma assinatura, o corte dos campos de 500 caracteres de outros cadastros pela função nova `private.fit_redacted_text`, sem execução pela API); nenhuma linha muda, nenhum gatilho dispara e a auditoria não ganha linhas. Conferir logo depois, com a conta do dono: o diálogo **Anonimizar contato** de um contato de teste abre o resumo com as contagens (não precisa anonimizar), e `select proconfig from pg_proc where oid = 'public.contact_privacy_summary(uuid)'::regprocedure` mostra `statement_timeout=60s`.
  - A importação de planilha do item 1.11 não tem migração. Neste projeto, que ainda não tem as migrações dos itens 1.9 e 1.10, ela funciona com o frontend desta branch: as colunas `base_legal` e `registro_base_legal` ficam de fora, com o aviso "As colunas base_legal e registro_base_legal ficam de fora. Este CRM ainda não tem a atualização de privacidade (LGPD)…" na prévia, e uma linha com `nao_contatar` igual a "sim" vira erro ("Este CRM ainda não tem a atualização dos canais, e a marca “Não contatar” não seria gravada…"), e o aviso da linha repetida que pede "Não contatar" sem a marca no contato cadastrado não aparece (ele lê a coluna do item 1.9); sem a migração do item 1.2, todos contam como ativos na coluna `responsavel` e em "Distribuir igualmente entre".
  - Até aplicar, o frontend local desta branch (`npm run dev` na porta 8080) roda sobre o banco sem as migrações dos itens 1.1, 1.2, 1.9, 1.10 e 1.11. Sem a do item 1.10, o cadastro e a ficha não mostram a base legal, criar e editar contatos funcionam como antes, a seção "Privacidade" da ficha e "Exportações e anonimizações", em "Segurança", mostram "Este CRM ainda não tem a atualização de privacidade (LGPD). Peça a quem administra para aplicar a migração mais recente.", Configurações mostra o mesmo aviso no lugar do padrão da base legal, a etapa da base legal do guia fica pendente, e "Exportar contatos" sai com as quatro colunas de antes. Sem a do item 1.9, os botões abrem o WhatsApp, o e-mail e a ligação, mas registrar a conversa (pela faixa "Para registrar" ou por "Registrar ligação"), "Concluir e agendar a próxima", "Marcar como não contatar" e criar uma atividade (ou uma próxima ação) de WhatsApp ou uma visita mostram "Este CRM ainda não tem a atualização dos canais. Peça a quem administra para aplicar a migração mais recente."; a marca "Não contatar" conta como desligada, e o "Concluir" de um clique, a edição e o Pipeline continuam funcionando. Sem a do item 1.2, o papel é lido sem a data da desativação (todos contam como ativos), e a Equipe não mostra "Pessoas desativadas" (e, com elas, **Reativar** e **Passar carteira**). **Desativar** abre o diálogo em "Não foi possível contar a carteira.", com **Confirmar desativação** desabilitado, porque a contagem (`member_portfolio`) não existe nesse banco; a desativação nunca é chamada (achado 9 da revisão do item 1.2, corrigido no item 1.6). Sem as duas do item 1.1:
    - em **Equipe**, **Criar convite** e **Gerar novo link** falham porque a RPC `create_invitation` ainda não existe, cada um com a sua mensagem de reserva e no seu lugar: **Criar convite** mostra "Não foi possível criar o convite. Seu preenchimento foi preservado." logo abaixo do formulário, e **Gerar novo link**, que só aparece num convite expirado, mostra "Não foi possível gerar o novo link. Tente novamente." sobre a lista de convites. **Revogar** continua funcionando;
    - a tela de entrada mostra a aba **Cadastrar** sem os avisos de primeiro acesso e de só por convite, porque `instance_status` também não existe; o cadastro já é o novo (nome e e-mail, que envia o link), e o banco antigo não barra o e-mail sem convite;
    - uma conta sem organização vê "Criar empresa", que o banco antigo ainda aceita, e nem o aceite nem a criação da empresa exigem a prova do e-mail.
  - O item 1.6 (marca da instância por configuração) não tem migração: nada a aplicar neste projeto por causa dele. Os modelos de e-mail do Auth com a marca do programa não mudaram (só o cabeçalho de `config-snippet.toml`), então não há o que colar de novo.
  - Depois de aplicar: a conta do dono continua dona, com os mesmos dados; conferir em **Equipe** e no editor SQL que `select * from public.instance_status()` devolve `true` e que `select count(*) from private.email_proofs` devolve 0.
  - Para validar o convite de ponta a ponta neste projeto (pendência do item 1.1 no roteiro), antes é preciso:
    - Site URL e URL de retorno do Auth apontando para onde o frontend roda: `http://localhost:8080` (com `http://localhost:8080/**` nas URLs de retorno) ou a URL publicada, quando houver. Os links pedidos pelo CRM (cadastro, **Link por e-mail**, **Enviar link para o meu e-mail** e **Esqueceu a senha?**) já voltam à origem em que ele roda, mesmo com a Site URL atual (`http://localhost:3000`, ver [Auth](#auth-e-e-mails-12102026)): o Auth aceita outra porta de `localhost` como retorno. A Site URL continua importando para os e-mails disparados pelo painel ("Invite user", "Send magic link"), para o logo dos e-mails e para a publicação;
    - um destinatário que receba os e-mails do Auth: com o SMTP padrão do Supabase, só os endereços da equipe do projeto no painel; para outro endereço, um SMTP próprio.
  - Na mesma validação, conferir o reforço (pendência do item 1.1 no roteiro): que o painel aceita os gatilhos no schema `auth` (o de UPDATE em `auth.users` e o de INSERT em `auth.mfa_amr_claims`); que uma conta criada antes, com senha, por um cadastro pela API (`POST /auth/v1/signup` com o e-mail convidado) perde a senha quando o convidado a confirma pelo link (entrar com ela passa a responder "E-mail ou senha incorretos") e ganha a linha em `private.email_proofs`; que uma conta criada pelo painel com **Auto Confirm User** mantém a senha e fica sem prova; que o token aberto pelo link traz `amr` com `otp` e o mantém depois de uma renovação; que **Crie sua senha** numa conta sem senha não pede a senha atual; o painel **Confirme que o e-mail é seu** com o envio do link de acesso (e **Enviar de novo**); e que uma conta sem organização não troca de e-mail (`PUT /auth/v1/user` com `email` numa sessão dela é recusado, e a troca pelo painel também). Revisão de 13/10/2026: que o painel aceita o gatilho de `auth.mfa_amr_claims` sem o aviso "Gatilho record_email_proof não criado" (`select has_table_privilege('postgres', 'auth.mfa_amr_claims', 'TRIGGER')` devolve `true`); e, com os modelos de e-mail do CRM aplicados, que o link abre o CRM com **Continuar**, que só depois dele a conta é confirmada e a prova gravada, e que o código do e-mail, digitado no aviso de link enviado, também abre a sessão.
- Validação remota com contas fictícias de duas organizações: 105 verificações de Auth e PostgREST, 16 de interface com o banco real e 12 de recuperação de senha. As contas de QA foram removidas depois.
- O login por senha de contas confirmadas foi validado. A confirmação global de e-mail foi preservada; só as contas fictícias de QA receberam confirmação administrativa. A entrega de e-mail não foi testada.
- A conexão OAuth usada não tem `auth_config_read`: a leitura da configuração de Auth retornou 403, e nenhuma configuração de Auth foi alterada por esse caminho. Para configurar o Auth, usar o painel ou ampliar o escopo da conexão.
- O aceite técnico local de 06/09/2026 está registrado em [EXECUCAO-CRM.md](EXECUCAO-CRM.md).

### Consulta direta de 12/10/2026

Feita pelo painel do Supabase, só com leitura. A conexão MCP desta máquina está ligada a outra organização Supabase e não enxerga este projeto.

**Migrações fora do repositório.** Antes das migrações da F0, o histórico remoto tinha dez versões: as oito do repositório e duas aplicadas em 08/09/2026, que não existem em nenhuma branch do repositório nem nos clones locais:

- `20260908164956_instagram_backend`: motor de automação de Instagram. Cria:
  - as tabelas `instagram_connections`, `instagram_flows`, `instagram_versions`, `instagram_conversations`, `instagram_runs`, `instagram_messages`, `instagram_logs` e `instagram_tags`;
  - no schema `private`, as tabelas `instagram_credentials`, `instagram_events` e `instagram_outbox`;
  - a função `public.instagram_service` e funções auxiliares em `private`.

  As FKs para `contacts` e `activities` não têm ação na exclusão: um contato ou uma atividade com registros de Instagram não pode ser excluído. As tabelas estavam vazias.
- `20260908191332_intake_integrations`: entrada genérica de leads. Cria:
  - as tabelas `intake_integrations` e `intake_receipts`;
  - no schema `private`, as tabelas `intake_credentials`, `intake_events` e `intake_links`;
  - a função `public.intake_service`;
  - em `contacts`, a coluna `custom_fields` (jsonb, padrão `{}`) e o gatilho `intake_check_contact_fields`.

  Havia uma integração cadastrada. Uma versão para o schema da Lara (`workspaces` em vez de `organizations`) existe no projeto Lara IA, em `supabase/migrations/20260908202516_intake_integrations.sql`.

As duas migrações não alteram nenhum objeto que as migrações 0.6, 0.7 e 0.8 mudam:
- as tabelas `deals`, `automation_logs`, `automations`, `pipelines`, `pipeline_stages` e `risk_rules`;
- as funções `private.validate_deal_change` e `private.run_deal_automations`.

As FKs de `intake_receipts` e `intake_links` para `deals` usam `ON DELETE SET NULL`. Os tipos gerados (`database.types.ts`) e o `test:db` não incluem esses objetos.

**Fora de qualquer migração**, o mesmo trabalho deixou no projeto:

- **Seis Edge Functions publicadas em setembro de 2026:** `instagram-api`, `instagram-webhook-meta`, `instagram-webhook-zernio`, `instagram-worker`, `intake-api` e `intake-webhook`. Os três webhooks são endpoints públicos. O provedor Zernio é o mesmo dos canais do projeto Lara IA.
- **As extensões `pg_cron` 1.6.4 e `pg_net` 0.20.4.**
- **A tarefa agendada `instagram-worker-every-minute`** (`* * * * *`, ativa): chama `private.instagram_dispatch_worker`, que faz um POST para a função `instagram-worker` do próprio projeto. Na consulta, havia 60 respostas 200 na última hora, perto de 43 mil invocações por mês. A cota do plano Free é de 500 mil.
- **A tabela `private.instagram_scheduler_requests`**, que nenhuma migração cria. Ela guarda os IDs das requisições da tarefa e tinha 10.080 linhas, sete dias de execuções por minuto.

Decisão do dono em 12/10/2026: manter tudo por ora, sem alterar. Pendente:
- localizar o código de origem (migrações, funções e a criação da tarefa e da tabela);
- decidir entre versioná-lo no repositório ou remover tudo: tarefa, funções, objetos e as duas versões do histórico, com `npx supabase migration repair`.

Advisor de segurança do painel, depois das migrações de 12/10/2026: zero erros; um aviso no Auth (proteção contra senhas vazadas desligada); sete sugestões de RLS sem política, todas em tabelas `private` do Instagram e da entrada de leads, que negam acesso a todos por padrão.

**Demais fatos da consulta:**

- A migração do receptor da Fecha IA não está aplicada.
- Dados: uma conta no Auth (a do dono, criada em 08/09/2026), uma organização, uma oportunidade aberta e nenhum log de automação.
- Banco: PostgreSQL 17.6, com as tabelas de `public` pertencendo a `postgres`, o papel do editor SQL do painel. O histórico (`supabase_migrations.schema_migrations`) guarda cada migração como um único statement, como faz o conector MCP que as aplicou.
- Auth: Site URL `http://localhost:3000` e nenhuma URL de retorno. O servidor local roda em `http://localhost:8080`. O login com senha funciona. Os links por e-mail pedidos pelo CRM (confirmação, acesso sem senha e recuperação) voltam à porta 8080, de onde foram pedidos: o Auth aceita outra porta de `localhost` como retorno (corrigido na revisão de 13/10/2026; antes, esta linha dizia que voltavam à porta 3000). Só os e-mails disparados pelo painel ("Invite user", "Send magic link") usam a Site URL e vão para a porta 3000.

### Auth e e-mails (12/10/2026)

Configuração do Auth no painel, conferida em 12/10/2026:

| Opção | Valor |
| --- | --- |
| Envio de e-mail | SMTP padrão do Supabase (sem SMTP próprio) |
| Email OTP Expiration | 3600 s (1 hora) |
| Email OTP Length | 8 dígitos |
| Secure email change | Ligado: o e-mail de troca vai para o endereço antigo e para o novo |
| Secure password change | Desligado |
| Senha mínima | 6 caracteres |

Os modelos de e-mail em pt-BR (`supabase/templates/`, item 1.3 do roteiro) foram gerados com esses valores (`linkExpiry` = `1 hora`, `codeLength` = 8, `secureEmailChange` = `true`, desde o item 1.6 em `supabase/templates/email-settings.json`; a marca fica em `public/brand/brand.json`), mas **ainda não foram aplicados**: o painel só libera a edição dos modelos depois de configurar um SMTP próprio. Até lá, o projeto envia os e-mails padrão do Supabase, em inglês, e só para os endereços da equipe do projeto. As notificações de senha alterada e de e-mail alterado também não foram ligadas. O logo dos modelos vem de `{{ .SiteURL }}/brand/eia-email.png`: com a Site URL atual (`http://localhost:3000`), os e-mails mostrariam só o texto alternativo, então a Site URL precisa apontar para o frontend publicado antes de aplicá-los. Quando houver SMTP, seguir [Aplicar no painel](../../supabase/templates/README.md#aplicar-no-painel) e, se algum desses valores mudar, ajustar `supabase/templates/email-settings.json` e rodar `npm run emails:build` antes de colar.

**Pendente, adiado por decisão do dono em 12/10/2026** (os modelos estão prontos no repositório; a aplicação fica para depois):

- [ ] Dono: configurar o SMTP próprio em **Authentication → Emails → SMTP Settings**. As credenciais são digitadas pelo dono. Para desenvolvimento, Gmail com senha de app basta; para uso real, um provedor com domínio próprio e SPF, DKIM e DMARC.
- [ ] Conferir se Email OTP Expiration, Email OTP Length e Secure email change continuam como na tabela acima; se mudarem, ajustar `supabase/templates/email-settings.json` e rodar `npm run emails:build`.
- [ ] Colar os oito modelos e os assuntos de `subjects.json` em **Authentication → Emails → Templates**, copiando o código dos `.html`.
- [ ] Ligar as notificações **Password changed** e **Email address changed**.
- [ ] Testar os fluxos reais com um endereço da equipe: cadastro, "Link por e-mail", "Esqueceu a senha?" e a senha nova em `/reset-password`. Desde a revisão de 13/10/2026, cada link dos modelos abre o CRM em `http://localhost:8080` (o retorno pedido, `{{ .RedirectTo }}`) e só é usado depois de **Continuar**, e o cadastro e o "Link por e-mail" trazem também o código, que o aviso de link enviado aceita: conferir os dois. São os modelos do CRM que impedem um filtro de segurança do e-mail de gastar os links; com os padrão do Supabase, um filtro assim deixa a conta nova sem como entrar.
- [ ] Depois de publicar o frontend: apontar a Site URL do Auth para ele, para o logo aparecer, e conferir os e-mails em Gmail, Outlook e Apple Mail.

### Arquivos locais

- `.env.local`, fora do Git, aponta para este projeto com a URL e a chave pública (`sb_publishable_…`, preenchida em 12/10/2026).
- Por isso, `npm run build` na máquina do dono embute essa URL em `dist/`. A pasta `dist/` fica fora do Git e do envio pela CLI da Vercel (`.vercelignore`). Nunca distribua a pasta do projeto por zip ou cópia: use o repositório.

## Repositório e publicação de desenvolvimento

O repositório de trabalho é `henriquegabriel-ia/crm-empreende-ia`. Até 11/10/2026 nenhum projeto de hospedagem foi criado e nenhuma URL foi publicada.

Valores para uma publicação de desenvolvimento na Vercel, que antes ficavam em `docs/PUBLICACAO-CRM.md`:

| Campo | Valor |
| --- | --- |
| Repositório | `henriquegabriel-ia/crm-empreende-ia` |
| Diretório raiz | Raiz do repositório |
| Framework | Vite |
| Instalação / build / saída | Definidos em `vercel.json`, que também serve `/brand/*` com `Content-Security-Policy` (`sandbox`) e `X-Content-Type-Options: nosniff` (revisão do item 1.6) |
| `VITE_CRM_ENVIRONMENT` | `dedicated` |
| `VITE_SUPABASE_URL` | `https://ldahvopyqkdiecchukwz.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública do projeto de desenvolvimento, configurada pelo canal de ambiente |
| `VITE_SHOW_BASE_CREDIT` | Não definir: com a marca do programa, o crédito "Feito com Empreende.IA" nunca aparece (item 1.6) |
| `VITE_SUPPORT_EMAIL` | Obsoleta desde o item 1.6: o e-mail de suporte fica em `supportEmail`, no `public/brand/brand.json`. Não definir; se o `.env.local` ainda a tiver, o build avisa |

Ainda falta, nesse ambiente: definir a URL do frontend, configurar Site URL e redirecionamentos do Auth para ela, conferir a entrega de e-mails com SMTP próprio e aplicar os modelos de e-mail em pt-BR (ver [Auth e e-mails](#auth-e-e-mails-12102026)).

## Integração Fecha IA no ambiente do dono

O plano de correções e a ordem de ativação ficam em [INTEGRACOES-PENDENTES.md](../INTEGRACOES-PENDENTES.md#fecha-ia--crm). O estado das duas pontas no ambiente do dono era este:

### Estado em 11/10/2026

| Lado | Situação |
| --- | --- |
| CRM | PR #1 aberto, sem conflitos com `main` (mesclagem por fast-forward), 5 commits. As funções `fecha-ai-integration` e `manage-fecha-ai-connections` respondem 404 `NOT_FOUND` do gateway (não publicadas). A migração do receptor (`20260906075018_fecha_ai_review_receiver.sql`, a renomear no rebase para depois da última migração da base, hoje `20261018100000_privacy_followup.sql`) não está aplicada no projeto `ldahvopyqkdiecchukwz` (histórico remoto consultado em 12/10/2026). O frontend não tem hospedagem. |
| Fecha IA | Migrações `crm_review_delivery` e `crm_dispatch_expiry` e funções `crm-connection`, `crm-lookup` e `crm-review` publicadas em 06/09, segundo as evidências do repositório da Fecha IA. Em 11/10, o backend `cceinhchscphagyaokzb` respondeu, e as funções `crm-*` responderam pelo handler (401 sem sessão). Não há registro de que o secret `CRM_SUPABASE_URL` tenha sido definido: a evidência de 06/09 diz que nenhum secret foi alterado. O valor atual não foi conferido, porque isso exige acesso ao painel. |
| Ambos | Nunca houve chamada real entre os dois projetos; os testes de cada lado simulam o outro. Não há contas nem organizações reais para o primeiro envio. Na Fecha IA, segundo os registros de 06/09, não havia usuário nem organização; os usuários atuais não foram consultados. No CRM, a consulta de 12/10/2026 encontrou só a conta do dono e uma organização. Site URL, retornos de Auth e SMTP continuam pendentes nos dois lados. |

Parte dos documentos da Fecha IA está desatualizada. `PUBLICACAO-E-ACESSO.md` e as evidências de 16/09 e 03/10 registram o backend com ENOTFOUND, e o README ainda diz que a publicação das funções aguarda reconexão. README, `P4-CRM-CONTRACT.md`, `EXECUCAO-FECHA-IA.md`, `AUDITORIA-DE-CONCLUSAO.md` e `PILOTO-E-ATIVACAO.md` tratam o PR #1 como rascunho; só `PUBLICACAO-E-ACESSO.md` o descreve como aberto e pronto para revisão. Em 11/10, o backend respondia e o PR não era rascunho.

### Valores do ambiente do dono para a ativação

- Passo 4 da ativação: o secret `CRM_SUPABASE_URL` da Fecha IA recebe `https://ldahvopyqkdiecchukwz.supabase.co`, sem barra final nem caminho. Esse valor fica gravado na conexão e não pode mudar depois sem reconectar.
- Backend da Fecha IA: projeto Supabase `cceinhchscphagyaokzb`.

## Legado arquivado

O código e as migrações do sistema anterior saíram do repositório no item 0.3 do roteiro e ficam na tag anotada `legacy-archive`, criada no commit `aa94f71`, o último antes da limpeza:

- `.lovable/`: `consolidated_schema.sql`, um schema consolidado de outro produto ("CRM Imobiliário") cujas instruções mandam apagar `supabase/migrations`, e `plan.md`;
- `docs/legacy/`: migrações (`source-migrations`), funções (`source-functions`) e telas (`source-ui`) do sistema anterior, com o próprio `README.md`.

Para consultar sem restaurar nada no repositório:

```bash
git ls-tree -r --name-only legacy-archive -- .lovable docs/legacy
git show legacy-archive:docs/legacy/README.md
```

Nunca aplique essas migrações nem publique essas funções numa instância. A única fonte do schema é `supabase/migrations`.

A tag existe só no repositório local até `@devops` enviá-la ao remoto (`git push origin legacy-archive`). Os arquivos continuam no histórico do Git; o repositório de distribuição com histórico novo (item 1.7a) é que os deixa de fora para os alunos.
