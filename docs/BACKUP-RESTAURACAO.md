# Backup e restauração do CRM

Este guia mostra como escolher o plano do Supabase, ligar a cópia de segurança (backup) do banco do CRM sem serviço pago e restaurar essa cópia num projeto novo. Ele foi escrito para quem usa Windows e não é desenvolvedor: cada comando aparece no PowerShell e, quando a forma muda, também no Terminal do macOS e do Linux. O guia de implantação (item 1.4 do [roteiro](ROADMAP-FINALIZACAO.md), ainda por fazer) vai apontar para cá. O desenho técnico está em [docs/arquitetura/1.5.md](arquitetura/1.5.md).

Resumo:

- **Aula, demonstração e beta sem dados reais:** plano Free do Supabase, sem backup.
- **Empresa com dados reais:** plano Pro do Supabase, numa organização Supabase da empresa, e o backup deste guia ligado também (é a cópia fora do Supabase).
- **Backup:** o workflow "Backup do banco" do GitHub, que já vem no repositório desligado. Ligado, ele faz uma cópia por dia, cifrada com senha, guardada por 7 dias.
- **Restauração:** sempre num projeto Supabase novo, com `npm run backup:restore`. A ferramenta nunca apaga nada e confere tudo antes de gravar.

## 1. Qual plano escolher

Consulta à documentação oficial do Supabase em **19/10/2026**. Preços e limites mudam: confira as páginas antes de decidir ([preços e planos](https://supabase.com/docs/guides/platform/billing-on-supabase), [perguntas sobre cobrança](https://supabase.com/docs/guides/platform/billing-faq), [pausa do Free](https://supabase.com/docs/guides/platform/free-project-pausing), [cópias de segurança](https://supabase.com/docs/guides/platform/backups), [usuários ativos](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users), [computação](https://supabase.com/docs/guides/platform/manage-your-usage/compute), [e-mails com SMTP próprio](https://supabase.com/docs/guides/auth/auth-smtp) e [lista para produção](https://supabase.com/docs/guides/deployment/going-into-prod)).

| | Free | Pro |
| --- | --- | --- |
| Custo | US$ 0. | US$ 25 por mês por **organização**, com US$ 10 de créditos de computação por mês, que cobrem um projeto pequeno (Micro). Cada projeto a mais custa a partir de cerca de US$ 10 por mês. Fatura em dólar, no cartão de crédito. |
| Pausa | O projeto é pausado depois de 7 dias com pouca atividade, com aviso por e-mail cerca de uma semana antes. Volta pelo painel em até 90 dias. Pausado, o CRM fica fora do ar para a equipe. | Nunca pausa. |
| Projetos ativos | 2, somando todas as organizações em que você é Owner ou Administrator (pausados não contam). | Sem limite; cada projeto cobra computação. |
| Cópias de segurança | **Nenhuma automática.** A documentação recomenda exportar com `supabase db dump` e guardar fora: é o backup deste guia. | Diárias, com os últimos 7 dias, restauráveis pelo painel (com o projeto fora do ar durante a restauração). As cópias somem se o projeto for excluído. PITR (restaurar a qualquer minuto) é um adicional de cerca de US$ 100 por mês. |
| Banco | 500 MB por projeto. | 8 GB por projeto, depois US$ 0,125 por GB. |
| Arquivos (Storage) | 1 GB. | 100 GB. |
| Tráfego | 5 GB. | 250 GB. |
| Usuários ativos por mês | 50.000. | 100.000. |
| E-mails de acesso | O servidor de e-mail padrão só entrega para os endereços da equipe da organização no Supabase, com um limite baixo por hora (o número está na página de SMTP). Nos dois planos, o CRM precisa de SMTP próprio (veja [Publicação](PUBLICACAO-CRM.md)). | Igual. |
| Ao passar do limite | Aviso e prazo; depois, restrições (pausa ou banco só para leitura). | Teto de gastos ligado por padrão: as mesmas restrições, ou cobrança do excedente se a empresa desligar o teto. |

### Quando cada um serve

- **Aula, demonstração, beta sem dados reais e o ensaio de restauração: Free.** A pausa não faz mal, os [dados de demonstração](../supabase/seed-demo.sql) não têm dado pessoal e o backup não é necessário. O ensaio de restauração conta como projeto ativo: com dois projetos Free já ativos, pause um antes ou exclua o projeto do ensaio no fim.
- **Empresa com dados reais: Pro, numa organização Supabase da empresa, com o cartão da empresa.** No Free, a pausa tiraria o CRM do ar no meio do expediente, não há cópia nenhuma e 500 MB são pouco para anos de histórico. A conta ser da empresa resolve também a LGPD: a empresa é a controladora dos dados; quem implanta, se ficar com a conta, vira operador, com o termo da [seção 10 da LGPD da instância](LGPD-INSTANCIA.md#10-modelo-de-termo-entre-quem-implanta-e-a-empresa-cliente).
- **Quem implanta para várias empresas:** uma organização Supabase por empresa (a cobrança é por organização, e as cópias do Pro valem para os projetos dela).

### No Pro, ligue o backup também

As cópias diárias do Pro ficam na mesma conta e somem com o projeto. Uma conta invadida, um projeto excluído por engano ou um atraso de pagamento (que pausa os projetos e volta a organização ao Free) leva o CRM e as cópias juntos. O backup deste guia é a cópia fora do Supabase. A restauração do Pro pelo painel continua sendo o caminho mais simples para voltar a um dia recente no mesmo projeto; o `npm run backup:restore` é o caminho para um projeto novo, inclusive em outra conta.

## 2. O que o backup guarda

O workflow "Backup do banco" (`.github/workflows/backup-banco.yml`) roda o `supabase db dump` do CLI do Supabase e guarda quatro arquivos e um índice:

| Arquivo | O que tem |
| --- | --- |
| `data.sql` | Todos os dados do CRM (contatos, empresas, oportunidades, atividades, recebimentos, configurações, equipe, convites, auditoria e privacidade) e as contas de acesso, com as senhas (só o hash). Em `INSERT`, para restaurar sem `psql`. |
| `history.sql` | O histórico das migrações aplicadas no banco: diz em que versão do CRM os dados estão. |
| `schema.sql` e `roles.sql` | A estrutura do banco e os papéis criados à mão, para diagnóstico e comparação. A restauração não usa estes dois. |
| `backup-info.json` | A data (`createdAt`, em UTC), o commit do repositório, a versão do CLI e o `sha256` de cada arquivo, para conferir que nada foi alterado. |

**Fica de fora:**

- as sessões e os tokens de acesso (por segurança): depois de restaurar, todos entram de novo, com a senha de sempre;
- os arquivos do Storage (o CRM ainda não guarda arquivos);
- a configuração do Auth, que vem do `supabase/config.toml` pelo `npm run config:push` ([Publicação](PUBLICACAO-CRM.md));
- as variáveis da hospedagem (Vercel).

O histórico das migrações é lido antes e depois dos dados: se uma migração for aplicada no meio do backup, ele falha e pede para rodar de novo. Os dados saem de uma fotografia só do banco, então ficam coerentes entre si mesmo com a equipe trabalhando.

## 3. Ligar o backup

Você vai precisar de: acesso de administrador ao repositório do CRM no GitHub (que precisa ser **privado**), acesso ao painel do Supabase do projeto e um gerenciador de senhas da empresa.

### 3.1 A senha do arquivo

1. No gerenciador de senhas da empresa, gere uma senha com **pelo menos 16 caracteres** e guarde com o nome "Backup do CRM".
2. Essa senha abre todos os backups. Sem ela, o backup não abre; com ela, qualquer pessoa abre. Ela fica com o Dono e com quem ele designar, nunca no repositório, num e-mail ou numa conversa.

### 3.2 A conexão do banco

1. No painel do Supabase, abra o projeto do CRM e clique em **Connect**.
2. Escolha **Session pooler** e copie a conexão (começa com `postgresql://postgres.<ref>:`). Não use a conexão direta (`db.<ref>.supabase.co`): ela só funciona por IPv6, e o GitHub não tem IPv6.
3. Troque `[YOUR-PASSWORD]` pela senha do banco (Database → Settings, se precisar redefinir). Se a senha tiver algum destes símbolos, troque cada um pelo código da tabela:

| Símbolo | Código | Símbolo | Código |
| --- | --- | --- | --- |
| `@` | `%40` | `?` | `%3F` |
| `#` | `%23` | `&` | `%26` |
| `/` | `%2F` | `:` | `%3A` |
| `%` | `%25` | espaço | `%20` |

### 3.3 Secrets e variáveis no GitHub

No repositório, abra **Settings → Secrets and variables → Actions**.

1. Na aba **Secrets**, clique em **New repository secret** e crie:
   - `CRM_BACKUP_DB_URL`: a conexão do passo 3.2;
   - `CRM_BACKUP_PASSWORD`: a senha do passo 3.1.
2. Na aba **Variables**, clique em **New repository variable** e crie `CRM_BACKUP_ENABLED` com o valor `true`. Opcional: `CRM_BACKUP_RETENTION_DAYS` com os dias que cada arquivo fica no GitHub, de 1 a 90 (sem ela, 7).
3. Abra a aba **Actions**, escolha **Backup do banco** na lista, clique nos três pontos e em **Disable workflow**; depois, **Enable workflow**. Isso faz os avisos de falha por e-mail irem para você, e não para quem escreveu o arquivo.
4. Clique em **Run workflow** para rodar a primeira vez agora. Daí em diante, ele roda todo dia às 02:30 de Brasília.

O primeiro passo do workflow confere a configuração antes de conectar no banco e para com uma mensagem clara se: o repositório for público, faltar um dos dois secrets, a conexão não começar por `postgresql://` ou não for válida (inclusive com um `#` ou `?` da senha sem o código da tabela), for a conexão direta, a senha tiver menos de 16 caracteres, a retenção estiver fora de 1 a 90 ou a cópia no armazenamento da empresa estiver configurada pela metade.

### 3.4 Abrir o primeiro backup

Faça isto uma vez logo depois de ligar, para saber que a senha funciona:

1. Na aba **Actions**, abra a execução de **Backup do banco** que terminou com o sinal verde e, em **Artifacts**, baixe o arquivo `crm-backup-…`.
2. O GitHub entrega um `.zip` com o `crm-backup-AAAAMMDD-HHMM-UTC.7z` dentro. Instale o [7-Zip](https://www.7-zip.org/) (gratuito), clique com o botão direito no `.7z`, escolha **7-Zip → Extrair arquivos…** e digite a senha. No macOS, use o Keka ou `brew install sevenzip`.
3. Confira que saíram `data.sql`, `history.sql`, `schema.sql`, `roles.sql` e `backup-info.json`.
4. Apague a pasta extraída e o arquivo baixado e esvazie a Lixeira.

Olhe a aba **Actions** uma vez por mês. Um projeto Free pausado não tem backup: o workflow falha e o GitHub avisa por e-mail.

### 3.5 Quanto custa

Nada, dentro do plano Free do GitHub para repositórios privados: 2.000 minutos por mês e 500 MB para guardar arquivos. Cada execução leva alguns minutos (cerca de 30 a 120 minutos por mês), e o backup de um time de até 50 pessoas tem poucos MB cifrado; 7 cópias ficam muito abaixo de 500 MB. Desligado, o workflow aparece como pulado e não gasta minutos.

A mesma cota de minutos é usada pelo workflow **CI** do repositório, que roda toda noite os testes de tela (E2E) e o ensaio de restauração, além dos testes a cada envio de código: algo como 15 a 25 minutos por noite, ou 450 a 750 por mês. Somado ao backup, fica dentro dos 2.000, mas sem muita folga se o repositório também recebe código todo dia. Numa instância em que ninguém desenvolve código, desligue o CI: na aba **Actions**, escolha **CI**, clique nos três pontos e em **Disable workflow**. O backup continua.

### 3.6 Cópia no armazenamento da empresa (opcional)

Quem quer guardar por mais tempo ou fora do GitHub pode mandar o mesmo arquivo cifrado para o armazenamento da empresa, pelo [rclone](https://rclone.org/): Google Drive ou OneDrive da empresa (numa pasta com acesso restrito), Backblaze B2 ou Cloudflare R2 (que têm camada gratuita; confira a cota atual).

1. No seu computador, instale o rclone e rode `rclone config` para criar um remoto (por exemplo, `empresa`) com a conta **da empresa**.
2. Copie o conteúdo do arquivo `rclone.conf` (o comando `rclone config file` mostra onde ele fica) para o secret `CRM_BACKUP_RCLONE_CONFIG`.
3. Crie a variável `CRM_BACKUP_REMOTE` com o destino, como `empresa:backups/crm`.

O workflow nunca apaga nada no destino. Configure no próprio armazenamento a regra que apaga os arquivos antigos (o ciclo de vida do bucket, ou a limpeza de uma pasta do Drive), com o prazo da política da empresa. A cópia do GitHub continua.

### 3.7 Versões presas no workflow

O workflow usa o CLI do Supabase na versão fixada no repositório e uma única ação de terceiro, a `supabase/setup-cli`, que instala esse CLI. Como é esse programa que recebe a conexão do banco, a ação fica presa ao código exato de uma versão (o SHA do commit, com a versão num comentário ao lado), e não a um nome que pode mudar de dono, como `v1`. Trocar a versão da ação ou do CLI é uma mudança revisada da base: confira as notas da versão nova no GitHub da ação e rode o ensaio de restauração do CI antes de aceitar. Quem só usa o CRM não precisa mexer nisso.

## 4. LGPD: onde guardar, quem acessa e por quanto tempo

O backup tem **todos os dados pessoais do CRM**: contatos, anotações, e-mails e telefones da equipe e os hashes das senhas. Trate cada arquivo como a própria base.

- **Onde:** só no artefato do GitHub do repositório privado da empresa e, se ligada, na pasta do armazenamento da empresa com acesso restrito. Nunca no computador de alguém, num e-mail, num chat ou dentro da pasta do repositório (o `.gitignore` já recusa `crm-backup-*`). Depois de abrir ou restaurar, apague a pasta extraída e esvazie a Lixeira.
- **Quem acessa:** quem tem leitura no repositório baixa o arquivo; só quem tem a senha o abre. Deixe como colaboradores do repositório só as pessoas necessárias, e a senha só com o Dono e quem ele designar. Se quem implanta guarda as cópias, ele é operador, e o termo da [LGPD da instância](LGPD-INSTANCIA.md#10-modelo-de-termo-entre-quem-implanta-e-a-empresa-cliente) registra o plano e a retenção.
- **Por quanto tempo:** 7 dias no GitHub (ou o que estiver em `CRM_BACKUP_RETENTION_DAYS`) e o prazo da empresa no armazenamento dela. Esse prazo entra na política de retenção. Cópias mais longas guardam por mais tempo os dados de quem pediu anonimização.
- **Restaurar traz de volta dados anonimizados.** A lista dos pedidos atendidos fica fora do CRM, com a data. Depois de restaurar, refaça as anonimizações feitas depois da data do backup (`createdAt` do `backup-info.json`, que a ferramenta mostra no fim).
- **Troca da senha:** se alguém que conhecia a senha sair, gere outra e troque o secret `CRM_BACKUP_PASSWORD`. As cópias antigas expiram sozinhas no prazo.
- **Repositório tornado público:** o próximo backup é recusado, mas os arquivos antigos continuam baixáveis até expirar. Exclua-os na aba **Actions** (cada execução, **Artifacts**, ícone da lixeira).

## 5. Restaurar num projeto novo

A restauração é sempre num projeto Supabase **novo**, nunca por cima do projeto em uso (que pode ter dados mais novos que o backup). O caminho é "migrações + dados": o `npx supabase db push` cria o banco completo do CRM (com as regras de segurança, os gatilhos e o histórico das migrações), e a ferramenta grava só os dados do backup.

Você vai precisar do Node.js, do Git e do repositório do CRM no computador, como na [Publicação](PUBLICACAO-CRM.md). Não precisa de Docker, `psql` nem PostgreSQL instalado. Num desastre, muitas vezes o computador é outro: o passo 0 prepara tudo do zero.

### 5.1 Passo a passo

Os comandos estão no PowerShell do Windows. No Terminal do macOS e do Linux, eles são iguais, menos as linhas com `$env:`, que aparecem também na forma desses sistemas.

0. Prepare o repositório e o CLI do Supabase:

   - **Num computador sem o repositório:** abra o terminal na pasta onde quer guardá-lo (por exemplo, `Documentos`) e rode `git clone <endereço do repositório do CRM no GitHub>` e depois `cd <pasta criada pelo clone>`;
   - **Num computador que já tem o repositório:** abra o terminal na pasta dele e rode `git fetch`, para trazer os commits mais novos (sem isso, o `git switch` do passo 3 pode responder "unable to read tree");
   - nos dois casos, rode `npm ci` (instala as ferramentas do repositório, inclusive a de restauração) e `npx supabase login` (abre o navegador para entrar na conta do Supabase; sem isso, o `link` do passo 3 responde "Access token not provided").

1. No painel do Supabase, crie um projeto novo (na organização da empresa, na região de São Paulo). Anote o **ref** (o código de 20 letras do endereço do projeto) e a senha do banco.
2. Baixe o backup (seção 3.4 ou o armazenamento da empresa) e extraia com a senha numa pasta **fora** do repositório, como `C:\Users\<você>\Documents\crm-restauracao`.
3. Deixe o repositório na versão do backup. Abra o `backup-info.json` e copie o `commit`. No terminal, na pasta do repositório:

   ```powershell
   git switch --detach <commit do backup-info.json>
   npm ci
   npx supabase link --project-ref <ref do projeto novo>
   npx supabase db push
   ```

   O `npm ci` de novo instala as ferramentas daquela versão (elas podem ter mudado desde então). Se o `backup-info.json` não tiver o `commit`, ou ele não for um código de letras e números, a ferramenta não sugere nenhum: peça ajuda a quem implantou.

4. Pegue a conexão do **Session pooler** do projeto novo (seção 3.2) e rode o ensaio, que grava tudo, confere e desfaz. A primeira linha pede a conexão: cole-a quando aparecer "Cole a conexão" e tecle Enter. Colada assim, ela não fica no histórico do terminal (o PowerShell grava em arquivo cada linha digitada, e a conexão traz a senha do banco que vai virar o de produção):

   ```powershell
   $env:CRM_RESTORE_DB_URL = Read-Host 'Cole a conexão'
   npm run backup:restore -- --dir "C:\Users\<você>\Documents\crm-restauracao" --confirm <ref do projeto novo>
   ```

   No macOS e no Linux (o `read -rs` espera a conexão colada, sem mostrá-la nem gravá-la no histórico; tecle Enter depois de colar):

   ```bash
   read -rs CRM_RESTORE_DB_URL && export CRM_RESTORE_DB_URL
   npm run backup:restore -- --dir ~/Documents/crm-restauracao --confirm <ref do projeto novo>
   ```

5. Se o ensaio terminar com "Ensaio concluído: nada foi gravado", rode de novo com `--apply`:

   ```powershell
   npm run backup:restore -- --dir "C:\Users\<você>\Documents\crm-restauracao" --confirm <ref do projeto novo> --apply
   ```

   (No macOS e no Linux, o mesmo comando com `--dir ~/Documents/crm-restauracao`.)

6. Volte o repositório à versão atual e aplique as migrações mais novas sobre os dados restaurados (o caminho normal de atualização). Num repositório recém-clonado, o `git switch -` volta ao branch principal:

   ```powershell
   git switch -
   npm ci
   npx supabase db push
   ```

7. Rode `npm run config:push` no projeto novo (configuração do Auth e dos e-mails), troque na Vercel a URL e a chave pública pelas do projeto novo e faça um deploy novo ([Publicação](PUBLICACAO-CRM.md)).
8. Entre com a conta do Dono. Todos entram de novo: as sessões não fazem parte do backup.
9. No SQL Editor do projeto novo, cole o [check de drift](../supabase/db-drift-check.sql) e confira o resumo ([Personalizar sem quebrar a atualização](PROTECAO-ATUALIZACAO.md)).
10. Refaça as anonimizações atendidas depois da data do backup (seção 4) e apague a pasta extraída. Limpe a conexão do terminal com `Remove-Item Env:CRM_RESTORE_DB_URL` (no macOS e no Linux, `unset CRM_RESTORE_DB_URL`), ou feche o terminal.

A conexão fica só na variável `CRM_RESTORE_DB_URL`, colada como no passo 4: nunca na linha de comando, no histórico do terminal ou num arquivo. Se você a digitou ou colou direto numa linha (`$env:CRM_RESTORE_DB_URL = '...'` ou `export ...`), ela ficou no histórico: apague a linha do arquivo `%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt` (no macOS e no Linux, `~/.zsh_history` ou `~/.bash_history`) ou troque a senha do banco do projeto novo no painel (Database → Settings → Reset database password). O `--confirm` precisa ser o ref da conexão: isso evita restaurar no projeto errado.

### 5.2 O que a ferramenta confere

Antes de gravar, `npm run backup:restore` recusa, com a mensagem em português e sem gravar nada:

- uma pasta sem `data.sql`, `history.sql` e `backup-info.json`, ou com um arquivo alterado (o `sha256` não bate);
- um `data.sql` com qualquer comando fora do que o backup tem (os `SET` do `pg_dump`, cada um com o seu valor exato, o `set_config` do `search_path` vazio, `setval`, `INSERT` nos dados e nas contas, `RESET ALL`) ou com comando do `psql`, como `\ir`;
- um projeto com migrações diferentes das do backup, com a lista do que falta e do que sobra;
- um projeto que não está vazio (qualquer dado do CRM ou qualquer conta): a ferramenta nunca apaga nada;
- um `--confirm` diferente do projeto da conexão.

Cada comando do `data.sql` é conferido inteiro, no formato exato que o `supabase db dump` escreve: um `INSERT` só passa com valores escritos por extenso (texto, número, verdadeiro ou falso, vazio), sem nenhuma consulta ou função dentro, e um `SET` só passa com o parâmetro e o valor que o `pg_dump` escreve (um `SET standard_conforming_strings = off`, que mudaria a leitura das aspas no banco, é recusado). Cada comando vai ao banco sozinho, numa mensagem que não aceita um segundo comando, e antes de cada `INSERT` a ferramenta confere que o banco lê as aspas do jeito que ela leu. Assim, um arquivo adulterado não consegue rodar outro comando no banco, mesmo que quem o alterou tenha refeito o `sha256`.

Depois, grava tudo numa transação só e, antes de confirmar, confere as contagens de cada tabela, as ligações entre os registros (um contato apontando para uma empresa que não veio, por exemplo), os gatilhos e as regras de segurança. Qualquer falha, uma queda de internet ou um `Ctrl+C` desfazem tudo: o projeto continua vazio e você pode rodar de novo. Sem `--apply`, faz tudo isso e desfaz no fim.

**Recursos ligados no painel do Supabase.** Se a empresa ligou no painel recursos que guardam dados no banco, como jobs agendados (`pg_cron`), chamadas HTTP (`pg_net`), Database Webhooks ou filas (Queues), o backup traz esses dados, mas eles não são do CRM. A ferramenta os deixa de fora, restaura o resto e avisa no fim, com a lista ("Atenção: ficaram de fora os dados de recursos da plataforma…"). Hoje a base do CRM não usa nenhum desses recursos: o que estiver ali foi ligado pela empresa. No projeto novo, ligue o recurso de novo pelo painel e recrie os jobs, webhooks ou filas que a empresa usava.

### 5.3 Alternativa com psql

Para quem já tem o `psql` (Linux, macOS) ou para um banco grande demais para a ferramenta (ela lê o arquivo inteiro na memória, até algumas centenas de MB), a mesma ordem, com os mesmos arquivos de apoio, depois do `db push`:

```bash
psql --single-transaction -v ON_ERROR_STOP=1 -f supabase/backup/restore-prepare.sql -f <pasta>/data.sql -f supabase/backup/restore-check.sql "$CRM_RESTORE_DB_URL"
```

Esse caminho não compara as versões das migrações nem as contagens, que só a ferramenta faz: confira o `commit` à mão.

### 5.4 Um registro excluído por engano

A restauração volta o CRM **inteiro** à data do backup, e nunca grava por cima do projeto em uso. Para recuperar um registro só (um contato, uma oportunidade) excluído por engano:

1. Restaure o backup mais recente que ainda tem o registro num projeto Free **temporário**, seguindo a seção 5 com a troca do passo 7 descrita na seção 6.
2. Entre no CRM do projeto temporário pelo `npm run dev`, abra o registro e anote ou exporte o que precisa.
3. Cadastre o registro de novo, à mão, no CRM em uso. Ele volta como um registro novo: o histórico de atividades e as ligações precisam ser refeitas também à mão.
4. Exclua o projeto temporário e apague a pasta extraída.

Se forem muitos registros, decida com a empresa entre refazer à mão, restaurar o CRM inteiro (perdendo o que foi feito depois do backup) ou aceitar a perda. A pressa importa: as cópias ficam só 7 dias no GitHub (ou o prazo de `CRM_BACKUP_RETENTION_DAYS`), e as cópias do Pro também guardam só os últimos 7 dias. Depois disso, a cópia que tinha o registro some.

### 5.5 Por que não o caminho da documentação do Supabase

A documentação do Supabase restaura `roles.sql`, `schema.sql` e `data.sql` pelo `psql`. No CRM, isso perde as regras de acesso que o CRM cria no schema `auth` (a entrada só por convite e a prova do e-mail), porque o `schema.sql` deixa esse schema de fora; as tabelas herdam as permissões padrão do projeto novo, e o histórico das migrações fica vazio, o que quebra a próxima atualização. Por isso o CRM usa "migrações + dados".

## 6. Ensaio

- **Ensaio periódico:** a cada três meses, restaure o backup mais recente num projeto Free temporário seguindo a seção 5 e exclua o projeto no fim. Assim você sabe que a senha e o caminho funcionam antes de precisar. No ensaio, o passo 7 muda, porque o CRM publicado continua no projeto em uso:
  1. pule o `config:push` e a troca na Vercel;
  2. guarde uma cópia do `.env.local` da pasta do repositório (se ele existir) e troque nele a URL e a chave pública pelas do projeto temporário (em **Connect**, no painel dele);
  3. rode `npm run dev`, abra o endereço que ele mostra e entre com o e-mail e a senha do Dono (o passo 8);
  4. no fim, volte o `.env.local` à cópia guardada, exclua o projeto temporário e apague a pasta extraída.
- **Ensaio automatizado:** `npm run test:restore` faz, num PostgreSQL descartável no seu computador, um dump real com o `pg_dump` 17 e as mesmas opções do CLI e uma restauração com o código do `backup:restore`, e confere o conteúdo de cada tabela, as senhas, as regras de segurança, os gatilhos e as recusas. O CI do repositório roda esse ensaio (job "Ensaio de restauração do backup") em todo pull request para `main` e toda noite. Para rodar no computador, o `pg_dump` 17 precisa estar instalado: no Windows, o instalador oficial do PostgreSQL 17 com só "Command Line Tools" marcado, ou os binários em zip extraídos numa pasta, com `$env:CRM_PG_BIN = "<pasta>\pgsql\bin"`; no macOS, `brew install libpq` e `export CRM_PG_BIN="$(brew --prefix libpq)/bin"`; no Linux, o pacote `postgresql-client-17`. Sem ele, o comando para e diz como instalar.
- **Ensaio a cada envio de código:** o `npm run test:db` roda o mesmo ensaio com um `pg_dump` simulado, que escreve o mesmo formato. Ele prova o código da restauração em qualquer computador, mas não substitui o ensaio com o programa de verdade.

## 7. Problemas comuns

| Mensagem | O que fazer |
| --- | --- |
| "Este repositório é público" | Torne o repositório privado (Settings → General → Danger Zone) e rode de novo. |
| "CRM_BACKUP_DB_URL é a conexão direta" | Use a conexão do Session pooler (seção 3.2). |
| "não é uma conexão válida" | A senha do banco tem um símbolo sem código; veja a tabela da seção 3.2. |
| "O dump falhou duas vezes" | O projeto pode estar pausado (Free) ou a senha do banco mudou. Retome o projeto ou atualize o secret e rode de novo. |
| "Uma migração foi aplicada durante o backup" | Rode o workflow de novo (Run workflow). |
| "As migrações do projeto não são as mesmas do backup" | Faça o passo 3 da seção 5.1 com o `commit` do `backup-info.json`, num projeto novo. |
| "Access token not provided" | Rode `npx supabase login` (passo 0 da seção 5.1) e repita o `link`. |
| "unable to read tree", "reference is not a tree" ou "invalid reference" | O repositório no computador não tem o commit do backup: rode `git fetch` e repita o `git switch --detach`. |
| "Atenção: ficaram de fora os dados de recursos da plataforma" | Não é erro: ligue o recurso no painel do projeto novo e recrie os jobs, webhooks ou filas (seção 5.2). |
| "comando fora da lista permitida" | O `data.sql` não saiu do workflow "Backup do banco" ou foi alterado. Use outro arquivo do backup e não restaure este. |
| "Este projeto não está vazio" | Restaure num projeto novo, logo depois do `db push` e antes do primeiro acesso. |
| "O Node não aceitou o certificado do banco" | Baixe o certificado em Database → Settings → SSL Configuration e rode de novo com `$env:CRM_RESTORE_SSL_CA = '<caminho do arquivo .crt>'` (no macOS e no Linux, `export CRM_RESTORE_SSL_CA='<caminho do arquivo .crt>'`). |
| "Esta pasta não é um backup completo do CRM" | Extraia o `.7z` inteiro, com a senha, e aponte `--dir` para a pasta com os arquivos. |

Pendências conhecidas (a confirmar no primeiro ensaio num projeto real, registrado no [roteiro](ROADMAP-FINALIZACAO.md)): o `postgres` do Supabase aceitar o modo de carga sem gatilhos, nenhuma tabela de `auth` já preenchida num projeto novo, o certificado do pooler aceito pelo Node e os avisos de falha depois de desativar e reativar o workflow.
