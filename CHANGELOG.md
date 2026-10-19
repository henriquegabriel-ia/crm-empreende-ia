# Registro de mudanças

Todas as mudanças da base do CRM que importam para quem implanta ou atualiza uma instância. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), com duas subseções a mais no começo de cada versão, "Migrações" e "Ao atualizar", e as versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/), com as regras do [Guia de atualização](docs/ATUALIZACAO.md#0-versões-e-notas). Para atualizar uma instância, siga o [Guia de atualização](docs/ATUALIZACAO.md) e leia o "Ao atualizar" de cada versão entre a sua e a nova.

Cada linha termina com o item do roteiro de finalização entre parênteses. Nenhuma versão foi publicada ainda: todo o trabalho até aqui está em "Não publicado" e entra na primeira versão (`1.0.0-beta.1` ou `1.0.0-rc.1`).

## [Não publicado]

### Migrações

Uma linha por migração da base, em ordem. **backfill**: reescreve dados que já existem (com o teste em `supabase/tests/upgrade/`); **recria**: funções, gatilhos ou políticas da base recriados (confira no drift-check, antes de atualizar, se você tinha alterado algum); **guarda**: começa por `private.assert_base_definition`, que para a atualização se o objeto foi alterado à mão.

- `20260906051319_commercial_foundation.sql`, `20260906051330_commercial_search.sql`, `20260906051332_relationship_metadata.sql`, `20260906051334_workspace_membership_audit.sql`, `20260906051336_contact_identity.sql`, `20260906051338_security_followup.sql`, `20260906051341_immutable_metadata.sql` e `20260906051832_configuration_policies_by_operation.sql`: o schema inicial (organizações, perfis e papéis, contatos, empresas, funis, oportunidades, atividades, automações, recebimentos, busca, auditoria e as políticas por organização). (base inicial)
- `20261011100000_deal_closing_probability.sql`: data de fechamento (`deals.closed_at`) editável e probabilidade vazia herdando a da etapa. **backfill** (a data de fechamento pelo histórico); **recria** `private.validate_deal_change`. (0.6)
- `20261011110000_deletions_automation_scope.sql`: exclusão de oportunidade com vínculos pela RPC `public.delete_deal`, registros de automação preservados e automação por funil e etapa. **backfill** (o escopo das automações); **recria** `private.run_deal_automations`. (0.7)
- `20261011120000_configuration_updated_at.sql`: `updated_at` nas tabelas de configuração, para a guarda de edição simultânea. **backfill** (o instante da migração). (0.8)
- `20261012100000_single_company_admission.sql`: uma empresa por instância, entrada só por convite e o papel Dono. **recria** `private.create_workspace`, `private.accept_invitation` e as políticas de `public.invitations`; gatilho novo em `auth.users`. (1.1)
- `20261012110000_admission_email_proof.sql`: o papel só depois de provar o e-mail. **recria** `private.create_workspace`, `private.accept_invitation` e `private.enforce_invite_only_signup`; gatilhos novos em `auth.users` e `auth.mfa_amr_claims`. (1.1)
- `20261013100000_member_deactivation.sql`: desativar e reativar membros e passar a carteira. **recria** `private.current_org`, `private.create_invitation`, `private.set_member_role`, `private.restore_owner` e as políticas `profile_update` e `roles_read`. (1.2)
- `20261013110000_channel_interactions.sql`: WhatsApp e visita como atividades, o resultado da interação e o "Não contatar". (1.9)
- `20261013120000_contact_privacy.sql`: base legal, exportação e anonimização de contatos, com o registro em `public.privacy_actions`. **recria** `private.stamp_do_not_contact`. (1.10)
- `20261018100000_privacy_followup.sql`: ajustes da anonimização. **recria** `private.anonymize_contact`. (1.11)
- `20261019100000_product_catalog.sql`: catálogo de produtos e serviços e itens na oportunidade. **recria** `private.anonymize_contact`, `private.export_contact_data` e `private.contact_privacy_counts`. (1.16)
- `20261019110000_update_protection.sql`: os oito ganchos `private.custom_*`, a guarda das atualizações e `private.base_fingerprints`, de que o drift-check depende. **recria** `private.move_member_portfolio`. (1.13)
- `20261019120000_default_privileges.sql`: o que o dono do banco cria nasce sem permissão para a API, e a `service_role` ganha permissões explícitas. **guarda** e **recria** `private.base_fingerprints`. (1.8)

### Ao atualizar

- **Instalação nova:** siga o [Guia de implantação](docs/IMPLANTACAO.md) inteiro; nada desta lista se aplica.
- **Cópia anterior à primeira versão** (um projeto montado com o código de antes das tags, como um projeto de desenvolvimento):
  1. `npx supabase@2.119.0 db push` aplica as migrações que faltam, em ordem, e o frontend do mesmo commit sai no mesmo dia ([Guia de implantação, A.8](docs/IMPLANTACAO.md#a8-publicar-migração-e-frontend-juntos-e-voltar-uma-versão)). As de 0.6, 0.7 e 0.8 reescrevem dados (backfill) e rodam como dono das tabelas, como o `db push` faz.
  2. `npm run emails:build`, `npm run config:check` e `npm run config:push`: o `supabase/config.toml` completo e os modelos de e-mail dentro dele. Apague da pasta supabase/templates os arquivos antigos email-settings.json, brand.json e config-snippet.toml, se ainda existirem (os comandos dizem para onde foi cada campo).
  3. A marca da empresa em `public/brand/brand.json` ([Trocar a marca](docs/MARCA.md)).
  4. Apague a variável `VITE_CRM_ENVIRONMENT` e passe o endereço de `VITE_SUPPORT_EMAIL` para o `supportEmail` do `public/brand/brand.json`.
  5. As conferências da etapa 5 e da etapa 10 do guia (`supabase/instance-check.sql` e `npm run verify-instance`) e o `supabase/db-drift-check.sql`.
  6. O workflow "Backup do banco" chega desligado ([Backup e restauração](docs/BACKUP-RESTAURACAO.md)).
  7. O Supabase CLI passa a ser o fixado, `2.119.0`, em todos os comandos dos guias (`npx supabase@2.119.0 …`).

### Adicionado

- Esteira com npm, CI no GitHub Actions dividido em qualidade, E2E e ensaio de restauração, e testes que rodam no Windows. (0.1)
- Prettier, LF em todos os sistemas e `npm run format:check`. (0.2)
- Instância fora dos buscadores (`noindex` e `public/robots.txt`). (0.3)
- `npm run gen:types`, que gera os tipos do banco a partir das migrações, sem Docker nem login. (0.4)
- Valores, telefones e CSV no padrão brasileiro. (0.5)
- Data de fechamento editável e probabilidade herdada da etapa, com os relatórios pela data de fechamento. (0.6)
- Exclusão de oportunidade com vínculos e automações por funil e etapa. (0.7)
- Guarda de edição simultânea em contatos, empresas e configurações. (0.8)
- Aviso de sem conexão, rotas por papel e volta ao link depois do login. (0.9)
- Desempenho no cliente com 5 mil contatos e `npm run test:perf`. (0.10)
- Empresa única por instância, entrada só por convite, o papel Dono e o papel só depois de provar o e-mail. (1.1)
- Desativar e reativar membros e passar a carteira. (1.2)
- `supabase/config.toml` completo, com `env()`, `npm run config:check` e `npm run config:push`, e os cabeçalhos de segurança no `vercel.json`. (1.3)
- [Guia de implantação](docs/IMPLANTACAO.md), `supabase/instance-check.sql` e `npm run verify-instance`. (1.4)
- [Backup e restauração](docs/BACKUP-RESTAURACAO.md): o workflow "Backup do banco", desligado por padrão, `npm run backup:restore` e `npm run test:restore`. (1.5)
- A marca da empresa por configuração em `public/brand/brand.json`, `npm run brand:check` e o crédito "Feito com Empreende.IA". (1.6)
- A licença ([`LICENSE`](LICENSE), rascunho para revisão jurídica, explicada em [Licença da base](docs/LICENCA.md)), este registro de mudanças, o [Guia de atualização](docs/ATUALIZACAO.md), a versão no rodapé da Ajuda e a conferência "Versão publicada" no `npm run verify-instance`. (1.7b)
- Depois de uma publicação nova, uma tela aberta com a versão anterior recarrega sozinha uma vez em vez de mostrar a tela de erro; sem conexão, não recarrega e mostra o aviso de sem conexão. (1.7b)
- A distribuição aos alunos por um repositório próprio, com histórico novo: `npm run release:dist` (allowlist com classificação total), `npm run release:check` (a conferência contra vazamento, também no workflow `.github/workflows/distribuicao.yml`) e o [termo de beta](docs/TERMO-BETA.md), rascunho para revisão jurídica. (1.7a)
- Na Ajuda, a pergunta sobre beta e rc na versão, que só aparece numa pré-versão. (1.7a)
- Regras para ferramentas de IA ([`AGENTS.md`](AGENTS.md)) e o guia [Personalizar o CRM](docs/PERSONALIZAR/README.md). (1.8)
- WhatsApp, e-mail e telefone com o registro da interação. (1.9)
- LGPD da empresa controladora: base legal, exportação e anonimização ([LGPD da instância](docs/LGPD-INSTANCIA.md)). (1.10)
- Importação de planilha com prévia e divisão entre pessoas. (1.11)
- Lembretes de atividades vencidas e do dia no menu. (1.12)
- Ganchos `private.custom_*`, o manifesto da base, o `supabase/db-drift-check.sql` e a guarda das atualizações ([Personalizar sem quebrar a atualização](docs/PROTECAO-ATUALIZACAO.md)). (1.13)
- Filtro por responsável, ganhos por responsável e origem do lead. (1.14)
- Dados de demonstração para aula e beta (`supabase/seed-demo.sql` e `supabase/seed-demo-remove.sql`). (1.15)
- Catálogo de produtos e serviços com itens na oportunidade. (1.16)

### Alterado

- A versão da base passa a seguir o Versionamento Semântico; o `package.json` fica em `1.0.0-beta.0` até a primeira versão publicada. (1.7b)
- Os guias usam o Supabase CLI fixado (`npx supabase@2.119.0`), o mesmo do `npm run config:push`. (1.7b)
- O que o dono do banco cria nasce sem permissão para a API: tabela ou função nova precisa de `grant` explícito. (1.8)
- O E2E e o ensaio de restauração agendados (noturnos) do `ci.yml` só rodam no repositório da base (variável `CRM_BASE_REPOSITORY=true`): no repositório da empresa, pull request para `main` e "Run workflow" continuam valendo, sem gastar minutos toda noite. (1.7a)
- Sem conexão, a tela de erro diz "Esta tela não abriu sem conexão" e só deixa recarregar quando a conexão volta; aí ela diz "A conexão voltou". Um erro que aconteceu com conexão continua "Algo deu errado", mesmo se a conexão cair depois. (1.7a)
- A Ajuda foi conferida por inteiro com o comportamento do CRM no fim da F1: a resposta dos papéis e a descrição do administrador na Equipe dizem o que donos e administradores exportam (contatos, reuniões e os dados de um contato), e não "dados" (os relatórios saem para todos), e as da atualização e da internet ficaram mais claras. (varredura final da F1)

### Obsoleto

Avisam no build, ou são recusados com a indicação do substituto, até a próxima versão principal (2.0.0), que os remove de vez:

- `VITE_SUPPORT_EMAIL`: o suporte fica no `supportEmail` do `public/brand/brand.json`; a variável só vale, com aviso no build, quando ele está vazio. (1.6)
- `VITE_CRM_ENVIRONMENT`: não faz mais nada e só avisa no build. (1.3)
- Os arquivos antigos email-settings.json, brand.json e config-snippet.toml da pasta supabase/templates: o `npm run emails:build` recusa cada um e diz para onde foi cada campo. (1.3 e 1.6)

### Corrigido

- A conferência do banco aceita toda forma de `security_invoker` que o PostgreSQL entende como ligada (`yes`, `t`, `on`), e o drift-check também; o apêndice A.9 do guia cita as três verificações que reprovam depois do remédio de emergência. (1.7b)
- A tela aberta durante uma publicação reconhece a página nascida do próprio recarregamento sem comparar relógios, e uma tela própria criada pelo guia de tela nova também espera o recarregamento, sem piscar a tela de erro. (1.7a)

### Segurança

- Entrada só por convite e o papel só depois de provar o e-mail. (1.1)
- Cabeçalhos de segurança (CSP, HSTS e outros) no `vercel.json`. (1.3)
- Privilégios padrão revogados para a API. (1.8)
