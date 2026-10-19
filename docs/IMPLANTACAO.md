# Guia de implantação do CRM

Este guia leva você da conta no Supabase até a equipe usando o CRM, numa instância segura e só da sua empresa. Foi escrito para quem não é desenvolvedor e usa Windows; quando o macOS muda, o passo aparece logo abaixo, marcado. Ele substitui o guia provisório de publicação (item 1.4 do [roteiro](ROADMAP-FINALIZACAO.md)).

- **Uma empresa por instância.** Cada empresa tem o próprio projeto Supabase, a própria hospedagem na Vercel e o próprio repositório, com várias pessoas usando. Quem implanta para várias empresas repete o guia para cada uma.
- **Quanto tempo leva.** Uma tarde, na primeira vez, com as contas já criadas (a estimativa será confirmada no [ensaio](ENSAIO-IMPLANTACAO.md)).
- **O que você terá no fim.** O CRM no endereço da empresa, com a marca dela, os e-mails de acesso em português saindo do e-mail da empresa, o primeiro Dono criado, a equipe convidada, as duas conferências aprovadas e, numa empresa com dados reais, a cópia de segurança ligada.
- **Duas conferências que reprovam.** Uma no banco (`supabase/instance-check.sql`, colada no editor SQL do painel) e outra no endereço publicado (`npm run verify-instance`). As duas dizem "aprovada" ou "reprovada" e, em cada linha reprovada, o que fazer.

Ao longo do guia, troque estes marcadores pelos valores da sua instância:

- `<SEU_PROJECT_REF>`: a referência do projeto Supabase, o trecho antes de `.supabase.co` no endereço do projeto;
- `<SUA_URL>`: o endereço público do CRM, com `https://` e sem barra no fim (por exemplo, `https://crm.suaempresa.com.br`);
- `<SEU_REPOSITORIO>`: o repositório Git da empresa, no formato `conta/repositorio`.

| Etapa | O que você faz | Onde |
| --- | --- | --- |
| [0](#0-antes-de-começar) | Contas, programas e o terminal | Computador |
| [1](#1-o-código-da-empresa) | O repositório privado da empresa | GitHub e terminal |
| [2](#2-escolha-o-plano) | Free para aula e beta; Pro para dados reais | Supabase e Vercel |
| [3](#3-crie-o-projeto-supabase) | O projeto do banco | Supabase |
| [4](#4-crie-o-banco-migrações) | As migrações, em ordem | Terminal |
| [5](#5-confira-o-banco) | A conferência do banco | Editor SQL do painel |
| [6](#6-marca-opcional-antes-de-publicar) | Nome, logos e e-mail de suporte | Computador |
| [7](#7-publique-na-vercel) | O site publicado | Vercel |
| [8](#8-e-mail-da-instância-smtp) | O e-mail que envia os acessos | Provedor de e-mail |
| [9](#9-acesso-e-modelos-de-e-mail) | A configuração do Auth e os modelos | Terminal |
| [10](#10-confira-a-url-publicada) | A conferência do endereço publicado | Terminal |
| [11](#11-primeiro-dono-logo-depois-de-publicar) | O primeiro cadastro | Navegador |
| [12](#12-equipe) | Os convites | CRM |
| [13](#13-dados-de-demonstração-opcional-só-aula-e-beta) | Dados fictícios, só em aula e beta | Editor SQL do painel |
| [14](#14-backup-lgpd-personalizar-e-atualizar) | Backup, LGPD, personalização e atualização | GitHub e CRM |

No fim estão o [checklist](#checklist), a [solução de problemas](#solução-de-problemas) e a [referência técnica](#apêndice-a-referência-técnica), com os detalhes que não cabem nos passos.

## 0. Antes de começar

**O que você precisa:**

- contas no [GitHub](https://github.com), no [Supabase](https://supabase.com) e na [Vercel](https://vercel.com), todas **da empresa**, com o e-mail da empresa e não o pessoal (quem sai da empresa não leva o CRM junto);
- um gerenciador de senhas da empresa, para a senha do banco, a senha do e-mail que envia os acessos e, mais tarde, a do backup;
- o domínio da empresa, se o CRM for ter endereço próprio (opcional: a Vercel dá um endereço `vercel.app`);
- uma caixa de e-mail que vai enviar os e-mails do CRM (etapa 8).

**Instale os programas** (uma vez por computador):

1. **Node.js, versão LTS (22 ou mais nova)**: baixe o instalador "LTS" em [nodejs.org](https://nodejs.org) e avance com as opções padrão (mantenha marcado "Add to PATH"). Quem já usa o `winget` pode rodar `winget install OpenJS.NodeJS.LTS`. O projeto é testado no Node 22, e o LTS que o site oferece hoje (o 24, ou um mais novo) também serve.
2. **Git**: baixe em [git-scm.com](https://git-scm.com) e avance com as opções padrão.
3. **Um editor de texto**: o [VS Code](https://code.visualstudio.com) é o mais confortável; o Bloco de Notas também serve.
4. Deixe as extensões dos arquivos visíveis no Explorador (aparece `public/brand/brand.json`, e não só `brand`), como em [Trocar a marca, seção 2](MARCA.md#2-antes-de-começar).

**Abra o terminal**, a janela onde você digita comandos. No Windows, use o **Prompt de Comando**: aperte a tecla Windows, digite `cmd` e Enter. O PowerShell, com a configuração padrão do Windows, recusa os comandos `npm` e `npx` com "não pode ser carregado porque a execução de scripts foi desabilitada"; se preferir o PowerShell, troque `npm` por `npm.cmd` e `npx` por `npx.cmd` em todos os comandos (não mude a política de segurança do sistema). Confira a instalação, uma linha por vez:

```
node -v
npm -v
git --version
```

Deu certo se cada linha mostra um número de versão (o do Node começa com `v22` ou com um número maior, como `v24`). Se aparecer "não é reconhecido", feche o terminal e abra de novo.

> **macOS:** instale o Node pelo instalador de [nodejs.org](https://nodejs.org) e o Git com `xcode-select --install` no **Terminal** (Aplicativos → Utilitários). Os comandos são os mesmos, no Terminal.

## 1. O código da empresa

O CRM da empresa mora num **repositório privado no GitHub da empresa**, criado a partir da base do programa, com a base registrada como `upstream` para receber as atualizações (decisão D5 do roteiro). Nunca publique esse repositório como público.

1. No GitHub da empresa, crie um repositório **vazio** e **privado** (**New repository**, sem README, sem `.gitignore` e sem licença). O nome dele, no formato `conta/repositorio`, é o seu `<SEU_REPOSITORIO>`.
2. No terminal, entre na pasta onde quer guardar o projeto (por exemplo, `cd %USERPROFILE%\Documents`; no macOS, `cd ~/Documents`) e rode, trocando o endereço da base pelo que o programa entregou a você:

   ```
   git clone <ENDERECO_DA_BASE> crm-empresa
   cd crm-empresa
   git remote rename origin upstream
   git remote add origin https://github.com/<SEU_REPOSITORIO>.git
   git push -u origin main
   npm ci
   ```

3. Deu certo se o `git push` termina sem erro, o repositório da empresa no GitHub mostra os arquivos e o `npm ci` termina com "added … packages". O `npm ci` instala as ferramentas do repositório; rode-o de novo sempre que atualizar a base.

A partir daqui, todos os comandos rodam **nesta pasta** (`crm-empresa`). O endereço do repositório de distribuição da base e as versões marcadas (tags) chegam com o item 1.7a do roteiro.

## 2. Escolha o plano

| Uso | Supabase | Vercel |
| --- | --- | --- |
| Aula, demonstração e beta, sem dados reais | Free | Hobby |
| Empresa com dados reais, mesmo pequena | **Pro, numa organização Supabase da empresa**, com o cartão da empresa | **Pro**, na conta da empresa |

- O Free do Supabase pausa o projeto depois de 7 dias com pouca atividade e não tem cópia de segurança automática. A tabela completa, com preços, limites e a data da consulta, está em [Backup e restauração, seção 1](BACKUP-RESTAURACAO.md#1-qual-plano-escolher).
- **O plano Hobby da Vercel é só para uso pessoal e não comercial** (decisão D2). A instância de uma empresa real precisa do Pro.
- Quem implanta para várias empresas cria **uma organização Supabase por empresa cliente**: a cobrança e as cópias do Pro são por organização, e a empresa fica dona dos próprios dados ([LGPD da instância](LGPD-INSTANCIA.md)).

## 3. Crie o projeto Supabase

1. No painel do Supabase, escolha a organização da empresa e clique em **New project**.
2. Dê um nome (por exemplo, "CRM Empresa"), clique em **Generate a password** para a senha do banco e **guarde essa senha no gerenciador de senhas** agora: ela é pedida na etapa 4 e não aparece de novo.
3. Em **Region**, escolha **South America (São Paulo)** (`sa-east-1`): os dados ficam no Brasil, como no mapa de dados da [LGPD da instância](LGPD-INSTANCIA.md#2-mapa-de-dados-da-instância).
4. Se aparecer uma opção sobre os privilégios padrão das tabelas novas, deixe como vier: a migração do item 1.8 deixa os dois casos iguais.
5. Clique em **Create new project** e espere a tela do projeto abrir (um ou dois minutos).

Anote, no gerenciador de senhas ou num arquivo da empresa:

- a referência do projeto, `<SEU_PROJECT_REF>`: em **Project Settings → General**, "Project ID" (também é o trecho do endereço do painel depois de `/project/`);
- o endereço do projeto, `https://<SEU_PROJECT_REF>.supabase.co`;
- a **chave pública** (`sb_publishable_…`), em **Project Settings → API Keys**. Na mesma tela há a chave secreta (`sb_secret_…`): **ela nunca sai do painel**, nunca vai para a Vercel nem para nenhum arquivo do repositório.

## 4. Crie o banco (migrações)

O banco do CRM é criado pelas migrações da pasta `supabase/migrations`, aplicadas em ordem pela ferramenta do Supabase (a CLI), que também registra o histórico. **Nunca cole os arquivos das migrações no editor SQL**: fora de ordem ou sem o histórico, as atualizações futuras quebram.

```
npx supabase@2.119.0 login
npx supabase@2.119.0 link --project-ref <SEU_PROJECT_REF>
npx supabase@2.119.0 db push
```

- O `login` abre o navegador para você entrar na conta do Supabase (na primeira vez, o `npx` pergunta se pode instalar o pacote `supabase`: responda **y**).
- O `link` pede a senha do banco da etapa 3. Confira que o projeto ligado é o da empresa: um `db push` no projeto errado cria o CRM no lugar errado.
- O `db push` lista as migrações que vai aplicar e pergunta se pode continuar: responda **Y**. Ele termina com "Finished supabase db push".

Deu certo se o `db push` termina sem erro. Se ele recusar, veja a [solução de problemas](#solução-de-problemas).

## 5. Confira o banco

1. Abra `supabase/instance-check.sql` no VS Code ou no Bloco de Notas, selecione tudo com **Ctrl+A** e copie com **Ctrl+C**. No GitHub, abra o arquivo e use o botão **Copy raw file**.
2. No painel do Supabase, abra **SQL Editor → New query**, cole com **Ctrl+V** e clique em **Run**. Deixe o papel do editor no padrão (`postgres`).
3. A primeira linha é o veredito. Antes do primeiro cadastro, o esperado é **APROVADA**, com a informação "Nenhuma empresa ainda".

A conferência só lê: ela nunca grava nada. Cada verificação aparece numa linha, `aprovado` ou `reprovado`, com o que foi visto e o que fazer; as linhas de `informação` nunca mudam o veredito. O que ela confere: as migrações da base no histórico e em ordem, as tabelas da base com a RLS ligada e as políticas delas iguais às da base (sem política permissiva a mais), nenhuma tabela sem RLS, view sem `security_invoker` ou função `SECURITY DEFINER` própria aberta para a API, os gatilhos (inclusive os do Auth, que mantêm a entrada só por convite), o privilégio que o gatilho da prova do e-mail exige, os privilégios padrão fechados, as permissões da API (inclusive as por coluna), as funções que decidem o acesso e a admissão, o `SECURITY DEFINER` e o `search_path` de todas as funções da base, o índice dos lembretes, uma empresa só e um dono ativo. A configuração do Auth não fica no banco: ela é conferida na etapa 10.

**APROVADA é o mínimo de segurança, e não a comparação do banco inteiro.** Ela não confere o corpo de todas as funções, as tabelas próprias que têm RLS mas uma política aberta demais, nem cada coluna, restrição e índice. Depois de cada personalização ou atualização, o `supabase/db-drift-check.sql` também é obrigatório.

Rode esta conferência de novo depois do primeiro cadastro (etapa 11) e depois de cada atualização da base. A comparação do banco inteiro com a base é o `supabase/db-drift-check.sql` ([Personalizar sem quebrar a atualização, seção 5](PROTECAO-ATUALIZACAO.md#5-conferir-o-banco-db-drift-check)).

## 6. Marca (opcional, antes de publicar)

O nome, o slogan, os logos, o ícone, a arte da entrada, o e-mail de suporte, os nomes dos arquivos exportados e a marca dos e-mails vêm de `public/brand/brand.json` e das imagens dessa pasta, sem editar código. Para a marca da empresa, siga [Trocar a marca do CRM](MARCA.md) até o fim: ele termina com `npm run brand:check`, o commit e o push para o repositório da empresa. Com a marca do programa, pule esta etapa.

Faça a marca antes de publicar: o logo dos e-mails é buscado no site publicado, e a etapa 9 confere que ele está lá.

## 7. Publique na Vercel

1. Na Vercel, na conta da empresa, clique em **Add New → Project** e importe `<SEU_REPOSITORIO>` (na primeira vez, autorize a Vercel a ler os repositórios da empresa no GitHub).
2. Mantenha **Root Directory** na raiz do repositório. O framework (Vite), a instalação (`npm ci`), o build (`npm run build:deploy`) e a pasta de saída (`dist`) já vêm do `vercel.json`: não mude nada em **Build and Output Settings**.
3. Em **Environment Variables**, cadastre:

   | Variável | Valor |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<SEU_PROJECT_REF>.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | A chave pública (`sb_publishable_…`) da etapa 3 |
   | `VITE_SHOW_BASE_CREDIT` | Opcional: `false` tira, só no app, o crédito "Feito com Empreende.IA", quando a licença permite ([Trocar a marca, seção 10](MARCA.md#10-o-crédito-feito-com-empreendeia)) |

   Essas variáveis vão para o navegador de quem usa o CRM: nunca cadastre aqui a chave secreta, a senha do SMTP nem nenhuma outra senha. O build recusa a chave secreta.

4. Clique em **Deploy** e espere "Congratulations". Se a Vercel avisar sobre a versão do Node, escolha **22.x** em **Settings → General → Node.js Version** e publique de novo.
5. Domínio próprio (opcional): em **Settings → Domains**, acrescente o domínio e crie no registro do domínio o apontamento DNS que a Vercel mostrar.

`<SUA_URL>` é o endereço final do CRM: o domínio próprio ou o `https://….vercel.app` da produção, com `https://` e sem barra no fim. Abra-o no navegador: aparece a tela de entrada do CRM. **Ainda não faça o cadastro**: primeiro o e-mail (etapas 8 e 9).

Se o build falhar, a mensagem diz o que corrigir (variável ausente, endereço sem `https://`, Supabase com domínio próprio fora da CSP ou marca inválida) e a versão anterior continua no ar. Os detalhes estão no [Apêndice A.1](#a1-o-artefato-da-publicação).

## 8. E-mail da instância (SMTP)

O CRM entra por e-mail: confirmação do cadastro, link de acesso e redefinição de senha. O serviço de e-mail padrão do Supabase só entrega para os endereços da equipe do projeto no Supabase, com limite baixo, e serve só para teste ([SMTP no Supabase](https://supabase.com/docs/guides/auth/auth-smtp)). Por isso, **o SMTP próprio é obrigatório**. Escolha uma opção:

- **Domínio próprio (recomendado):** o e-mail do domínio da empresa ou um provedor de e-mail transacional. No DNS do domínio, configure SPF, DKIM e DMARC como o provedor ensina (sem eles, os e-mails caem no spam) e desligue o rastreamento de cliques no provedor (ele troca os links dos e-mails).
- **Gmail com senha de app (times pequenos):**
  1. Na conta Google que vai enviar, ligue a **Verificação em duas etapas**.
  2. Em [myaccount.google.com](https://myaccount.google.com), procure "Senhas de app", crie uma para "CRM" e guarde no gerenciador de senhas a senha de 16 letras que aparece (ela não aparece de novo).
  3. Os valores do SMTP são: servidor `smtp.gmail.com`, porta `587`, usuário e remetente o próprio endereço do Gmail, senha a senha de app.
  4. No Google Workspace, o administrador pode ter bloqueado as senhas de app. O Gmail tem limite diário de envio (confira o número atual na ajuda do Google), que vale antes do limite por hora do CRM.

Anote o servidor, a porta, o usuário, a senha, o e-mail remetente e o nome que aparece na caixa de entrada (por exemplo, o nome da empresa). Eles vão para o arquivo da etapa 9, que fica só no seu computador, **nunca para a Vercel**.

## 9. Acesso e modelos de e-mail

A configuração do Auth da instância fica no repositório, em `supabase/config.toml`: confirmação de e-mail ligada, cadastro ligado (o portão de convites está no banco), só e-mail e senha, código de 8 dígitos válido por 1 hora, limites de envio e os oito modelos de e-mail em português, com a marca. Você preenche só o que é da instância (o endereço do CRM e o SMTP) e aplica com um comando.

**Caminho recomendado, pelo terminal:**

1. Copie o modelo das variáveis:
   - no Prompt de Comando do Windows: `copy supabase\.env.example supabase\.env`
   - no PowerShell: `Copy-Item supabase/.env.example supabase/.env`
   - no macOS: `cp supabase/.env.example supabase/.env`
2. Abra o arquivo novo, `supabase/.env`, e preencha: `SUPABASE_AUTH_SITE_URL` com `<SUA_URL>`, `SUPABASE_AUTH_REDIRECT_URL` com `<SUA_URL>/**` e o SMTP da etapa 8. Um valor com `$` (comum em senhas) vai entre aspas simples, como `SUPABASE_AUTH_SMTP_PASS='abc$123'`. No Bloco de Notas, salve com **Tipo: Todos os arquivos**; senão ele grava `supabase/.env.txt`, que a ferramenta não lê. O arquivo fica fora do Git.
3. Confira a marca dos e-mails: abra `<SUA_URL>/brand/` seguido do nome do `emailLogo` do `public/brand/brand.json` (por exemplo, `<SUA_URL>/brand/eia-email.png`) no navegador. Se o logo não abrir, volte à etapa 6 ([Trocar a marca, seção 8](MARCA.md#8-e-mails-de-acesso)): se você mudou a marca, rode `npm run emails:build`, faça commit e publique de novo.
4. Rode `npm run config:check`. Ele confere o `supabase/config.toml` e o `supabase/.env` e lista todos os problemas de uma vez, em português, com o que fazer. Corrija até ele terminar sem problemas e confira, no resumo, o projeto ligado e a Site URL.
5. Rode `npm run config:push`. Ele repete a conferência e chama a ferramenta do Supabase, que mostra a diferença e pergunta, serviço por serviço, antes de gravar. Responda **y** a cada serviço e confira, no fim, "Finished supabase config push". Responda **n** e peça ajuda se, nas linhas com `+`, aparecer `enable_confirmations = false`, um `site_url` com `env(` ou um endereço que você não reconhece.
6. **Não faça um cadastro de teste agora.** Numa instância sem empresa, o primeiro cadastro cria a empresa e fica com o papel de Dono, seja de quem for o e-mail. Os testes de envio usam a conta do dono: o cadastro da etapa 11 testa a confirmação, e o fim da etapa 11 testa o link de acesso e a redefinição de senha. Se você já fez um cadastro de teste e ele não criou a empresa, exclua essa conta em **Authentication → Users** antes da etapa 11; se ele criou a empresa, siga [Outra pessoa virou Dono](#outra-pessoa-virou-dono).

**Nunca rode `npx supabase config push` direto**: sem a conferência, uma variável ausente vai como o texto `env(NOME)` e quebra todos os links dos e-mails ([Apêndice A.3](#a3-o-configpush-em-detalhe)).

**Alternativa, pelo painel:** quem não quer usar a ferramenta preenche campo a campo no painel do Supabase, seguindo [Aplicar no painel](../supabase/templates/README.md#aplicar-no-painel): a Site URL, o retorno, o SMTP, a lista dos campos com os valores do `supabase/config.toml` e a colagem dos oito modelos (passos 1 a 4). O passo 5, os testes de envio, fica para o fim da etapa 11, com a conta do dono: não faça um cadastro de teste agora (item 6 acima). Nada confere os campos colados à mão: a cada mudança do `supabase/config.toml` ou da marca, repita os passos que mudaram.

## 10. Confira a URL publicada

No terminal, na pasta do projeto, numa linha só, com o endereço do projeto e a chave pública da etapa 3:

```
npm run verify-instance -- <SUA_URL> --supabase-url https://<SEU_PROJECT_REF>.supabase.co --key sb_publishable_…
```

A conferência usa só a chave pública e recusa a chave secreta antes de qualquer pedido.

Para não repetir as duas opções a cada conferência, guarde os dois valores num arquivo `.env.local` na raiz do projeto, que fica fora do Git: copie o modelo com `copy .env.example .env.local` no Prompt de Comando (`cp .env.example .env.local` no macOS), abra o arquivo novo e preencha `VITE_SUPABASE_URL` com `https://<SEU_PROJECT_REF>.supabase.co` e `VITE_SUPABASE_PUBLISHABLE_KEY` com a chave pública (no Bloco de Notas, salve com **Tipo: Todos os arquivos**, como na etapa 9). Daí em diante, basta `npm run verify-instance -- <SUA_URL>`.

O esperado é uma linha `OK` por conferência e, no fim, "Instância aprovada: 9 conferências". Ela confere:

1. a página inicial: o CRM responde, fora dos buscadores, com o título da marca;
2. a versão publicada: a página diz a mesma versão do `package.json` da sua pasta (uma publicação que não terminou, outro branch ou uma volta atrás esquecida reprovam);
3. os cabeçalhos de segurança iguais aos do `vercel.json`;
4. o `robots.txt` fechando o site;
5. as rotas do app (fichas, convites e redefinição de senha) abrindo por link direto;
6. a marca publicada (`/brand/brand.json`) válida;
7. as imagens da marca, sobretudo o logo dos e-mails;
8. que o site publicado fala com o projeto Supabase informado;
9. a configuração do Auth: **confirmação de e-mail ligada**, cadastro e e-mail ligados, telefone, login anônimo e login social desligados.

Cada linha `REPROVADO` diz o que fazer; a [solução de problemas](#solução-de-problemas) traz os casos comuns. A conferência sai com 0 (aprovada), 1 (reprovada) ou 2 (entrada inválida, nenhum pedido feito).

## 11. Primeiro dono, logo depois de publicar

Cada instância tem uma empresa só (decisão D6). Enquanto não há empresa, **o primeiro cadastro cria a empresa e fica com o papel de Dono**; depois, o banco só aceita conta nova com convite do CRM. Por isso, faça o primeiro cadastro **logo depois** das etapas 9 e 10: quem chegar antes vira dono. O site já sai fora dos buscadores, mas o endereço pode circular.

**Quem faz.** A pessoa que vai administrar o CRM na empresa. Se você implanta para um cliente, combine antes um dos caminhos:

- o responsável do cliente faz o primeiro cadastro logo depois de você publicar; ou
- você faz o primeiro cadastro, cria a empresa e, em **Equipe**, convida o responsável do cliente com o papel **Dono**; depois que ele aceitar, ele (ou você) muda o papel da sua conta em **Alterar papel** e, quando você não precisar mais de acesso, usa **Desativar** na sua conta.

**Na tela:**

1. Abra `<SUA_URL>`. A tela de entrada abre na aba **Cadastrar** e avisa que a primeira conta cria a empresa.
2. Informe o nome e o e-mail e envie. Abra o e-mail que chega e clique no link: o CRM abre e mostra **Continuar** (o link só vale depois desse clique, o que protege dos filtros de segurança que abrem os links sozinhos). O e-mail também traz um código, que serve se você abriu o e-mail em outro aparelho.
3. Em **Crie sua senha**, crie a senha.
4. Em **Criar empresa**, informe o nome da empresa.
5. Rode `supabase/instance-check.sql` de novo (etapa 5): o esperado é **APROVADA**, com a linha "Donos ativos" mostrando o seu e-mail.
6. Termine os testes de envio com a sua conta, seguindo [Aplicar no painel, passo 5](../supabase/templates/README.md#aplicar-no-painel), que vale também para quem usou o `npm run config:push`: saia do CRM, peça o link em **Link por e-mail** e entre por ele; depois, saia de novo, use **Esqueceu a senha?** e crie uma senha nova. O e-mail de confirmação do passo 2 e esses dois chegam em português, com a marca. O convite da etapa 12 testa o cadastro de outra pessoa.

**Nunca desligue a confirmação de e-mail** no Auth. É ela que prova que a pessoa controla o e-mail; com ela desligada, qualquer conta ainda não confirmada fica com quem chamar o cadastro. O motivo completo está no [Apêndice A.4](#a4-primeiro-dono-convites-e-a-confirmação-de-e-mail).

### Outra pessoa virou Dono

Se a linha "Donos ativos" mostrar um e-mail que você não esperava, alguém fez o primeiro cadastro antes. A instância nova não tem dados para vazar, e o remédio já existe:

1. Quem administra o projeto Supabase cria a conta da pessoa certa e devolve a ela o papel de dono pelo editor SQL, seguindo [Recuperar o acesso de dono](RECUPERAR-ACESSO-DONO.md) (a conta criada no painel com **Auto Confirm User**, como o guia exige).
2. A pessoa certa entra e, em **Equipe**, usa **Desativar** na conta de quem se adiantou: o acesso acaba na hora, e os convites que essa conta criou são revogados.
3. Em **Configurações → Organização**, ela troca o nome da empresa, se preciso.
4. Rode `supabase/instance-check.sql` de novo e confira os donos ativos.

O mesmo guia serve depois, se a empresa perder o único dono (rebaixado ou desativado).

## 12. Equipe

- **Convidar:** em **Equipe → Convidar uma pessoa**, informe o e-mail e o papel, crie o convite e mande o link `<SUA_URL>/?invite=…` à pessoa, por WhatsApp ou e-mail (o CRM não envia o convite). Ela abre o link, cadastra o nome e o e-mail convidado, abre o link de confirmação que chega e cria a senha.
- **Quem sai da equipe:** em **Equipe**, use **Desativar** no cartão da pessoa e escolha quem recebe a carteira. Nunca exclua a conta em **Authentication → Users**: o histórico continua no nome dela, e a desativação já corta o acesso.
- **Perdeu o papel de dono:** se houver outro dono, ele resolve em **Equipe**; sem outro dono, siga [Recuperar o acesso de dono](RECUPERAR-ACESSO-DONO.md).

A Ajuda do CRM explica à equipe cada tela, cada e-mail e cada papel. Os detalhes dos convites, das contas criadas pelo painel e do e-mail digitado errado estão no [Apêndice A.4](#a4-primeiro-dono-convites-e-a-confirmação-de-e-mail).

## 13. Dados de demonstração (opcional, só aula e beta)

Para uma aula ou para o beta, `supabase/seed-demo.sql` enche um CRM vazio com dados fictícios. **Nunca use numa empresa com dados reais.** A ordem:

1. o primeiro cadastro do Dono (etapa 11);
2. opcional: os convites e os aceites da equipe (os dados se dividem entre as pessoas ativas);
3. `supabase/seed-demo.sql` no editor SQL do painel, copiado e colado como na etapa 5.

Para apagar a demonstração (a turma recomeça ou o beta vira uso real), rode `supabase/seed-demo-remove.sql` do mesmo jeito. Enquanto os dados fictícios existirem, a conferência do banco mostra a linha "Dados de demonstração". Os detalhes, as recusas e o que a remoção mantém estão no [Apêndice A.7](#a7-catálogo-e-dados-de-demonstração).

## 14. Backup, LGPD, personalizar e atualizar

- **Backup (empresa com dados reais):** ligue o workflow "Backup do banco" do GitHub, que já vem no repositório desligado, abra o primeiro arquivo com o 7-Zip e guarde a senha do arquivo no gerenciador de senhas da empresa ([Backup e restauração, seção 3](BACKUP-RESTAURACAO.md#3-ligar-o-backup)). No Pro, ligue também: é a cópia fora do Supabase. A restauração é sempre num projeto novo, com `npm run backup:restore` ([seção 5](BACKUP-RESTAURACAO.md#5-restaurar-num-projeto-novo)).
- **LGPD:** como dono, escolha em **Configurações → Organização** a base legal padrão dos contatos novos e siga o [checklist LGPD da implantação](LGPD-INSTANCIA.md#11-checklist-lgpd-da-implantação). Quem implanta para um cliente revisa também o [aviso de privacidade e o termo](LGPD-INSTANCIA.md#9-modelo-de-aviso-de-privacidade).
- **Restaurar:** os comandos da restauração rodam no **PowerShell**, e não no Prompt de Comando das outras etapas, porque a conexão do banco é colada com `Read-Host` e não fica gravada. No PowerShell, use `npm.cmd` e `npx.cmd` no lugar de `npm` e `npx`, como diz o [guia de backup](BACKUP-RESTAURACAO.md#5-restaurar-num-projeto-novo).
- **Personalizar:** para regras, campos, tabelas e telas próprios da empresa sem perder as atualizações, siga [Personalizar o CRM](PERSONALIZAR/README.md) e [Personalizar sem quebrar a atualização](PROTECAO-ATUALIZACAO.md). Quem usa Claude Code, Codex, Cursor ou Lovable aponta para a ferramenta o arquivo [`AGENTS.md`](../AGENTS.md), com as regras do repositório.
- **Atualizar:** antes e depois de cada atualização da base, rode `supabase/db-drift-check.sql` ([Proteção de atualização, seção 5](PROTECAO-ATUALIZACAO.md#5-conferir-o-banco-db-drift-check)); depois de aplicar, rode também `supabase/instance-check.sql` e `npm run verify-instance -- <SUA_URL>`. O passo a passo, da cópia de segurança às conferências de depois, está no [Guia de atualização](ATUALIZACAO.md), e o que muda em cada versão, no [`CHANGELOG.md`](../CHANGELOG.md).

## Checklist

- [ ] Contas da empresa (GitHub, Supabase e Vercel) e as senhas no gerenciador de senhas da empresa.
- [ ] Repositório privado da empresa, com a base registrada como `upstream`.
- [ ] Plano escolhido: para dados reais, Pro do Supabase numa organização da empresa e Pro da Vercel.
- [ ] `npx supabase@2.119.0 db push` sem erro e `supabase/instance-check.sql` **APROVADA** antes do primeiro cadastro.
- [ ] Marca conferida com `npm run brand:check`, ou a marca do programa mantida de propósito.
- [ ] Vercel publicada com as duas variáveis, o domínio e `<SUA_URL>` estável.
- [ ] SMTP próprio configurado, sem nenhum cadastro de teste antes do primeiro dono.
- [ ] `npm run config:check` e `npm run config:push` concluídos (ou o painel, campo a campo).
- [ ] `npm run verify-instance -- <SUA_URL> --supabase-url https://<SEU_PROJECT_REF>.supabase.co --key sb_publishable_…` aprovado (ou só `npm run verify-instance -- <SUA_URL>`, com o `.env.local` da etapa 10).
- [ ] Primeiro dono criado logo depois de publicar e `supabase/instance-check.sql` **APROVADA** com o dono esperado.
- [ ] Os e-mails testados com a conta do dono: a confirmação, o link de acesso e a redefinição de senha chegam em português, com a marca.
- [ ] Um convite aceito pelo link, com a senha criada.
- [ ] Uma senha recuperada por **Esqueceu a senha?**.
- [ ] Base legal padrão escolhida e o checklist LGPD feito.
- [ ] Numa instância com dados reais: backup ligado, primeira execução verde, arquivo aberto com o 7-Zip e a senha guardada.
- [ ] Dados de demonstração só em aula ou beta, e removidos antes do uso real.
- [ ] Console do navegador (F12) sem "Refused to…" nas telas principais.
- [ ] Quem implanta para cliente: o aviso de privacidade e o termo revisados, e o próprio acesso ajustado ou desativado.

## Solução de problemas

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| "npm.ps1 não pode ser carregado" ou "npx.ps1 não pode ser carregado" | O PowerShell com a política de execução padrão | Use o Prompt de Comando, ou `npm.cmd` e `npx.cmd`. Não mude a política do sistema. |
| `node` ou `git` "não é reconhecido" | O terminal foi aberto antes da instalação | Feche e abra o terminal; se continuar, reinstale marcando "Add to PATH". |
| `db push` pede a senha e recusa | Senha do banco errada | Em **Project Settings → Database**, use **Reset database password**, guarde a nova e repita o `link`. |
| `db push` recusa por versões que não existem no repositório | O banco tem migrações de outra origem | Não force nada: peça ajuda a quem mantém a base. Um projeto novo não tem esse caso. |
| `supabase/instance-check.sql`: "permission denied" ou "relation … does not exist" | A consulta rodou com outro papel no seletor do editor | Rode no editor SQL do painel com o papel padrão (`postgres`). |
| `supabase/instance-check.sql` **REPROVADA** | A linha `reprovado` diz o quê | Siga o detalhe da linha. Em "Migrações", rode o `db push` de novo. |
| Build da Vercel falha com "VITE_SUPABASE_URL…" ou "A CSP do vercel.json…" | Variável ausente, sem `https://` ou Supabase com domínio próprio | A mensagem diz o que acrescentar e onde ([Apêndice A.1](#a1-o-artefato-da-publicação)). |
| Build falha com a marca | `public/brand/brand.json` ou imagem inválidos | Rode `npm run brand:check` e veja [Trocar a marca, seção 12](MARCA.md#12-problemas-comuns). |
| Página 404 da Vercel ao recarregar uma tela | Projeto sem o `vercel.json` (pasta raiz errada) | Em **Settings → General**, **Root Directory** na raiz do repositório; publique de novo. |
| E-mails chegam em inglês | Modelos não aplicados | Etapa 9 (o `config:push` ou a colagem no painel). |
| E-mail não chega | SMTP errado, limite do provedor, spam, SPF ou DKIM ausentes | Os testes de envio do fim da etapa 11, a caixa de spam, o painel do provedor e o limite diário do Gmail. |
| "O link do e-mail expirou ou já foi usado" | Filtro de segurança do e-mail com os modelos padrão, ou link antigo | Aplique os modelos do CRM (etapa 9), peça um novo link ou use o código do e-mail. |
| "Database error saving new user" | Cadastro sem convite numa instância com empresa, ou "Invite user" do painel sem convite no CRM | Crie antes o convite no CRM, em **Equipe**. |
| `verify-instance`: confirmação de e-mail desligada | "Confirm email" desligado no Auth | Ligue já ([Apêndice A.4](#a4-primeiro-dono-convites-e-a-confirmação-de-e-mail)). |
| `verify-instance`: cabeçalho diferente ou ausente | Publicação de outro commit, ou hospedagem que não lê o `vercel.json` | Publique o mesmo commit; noutra hospedagem, repita os cabeçalhos ([Apêndice A.2](#a2-cabeçalhos-de-segurança-e-a-instância-fora-dos-buscadores)). |
| `verify-instance`: a página respondeu 401 ou redirecionou | Proteção de deploy da Vercel ligada no domínio de produção, ou endereço com `www` que redireciona | Desligue a proteção em **Settings → Deployment Protection** (o CRM tem login próprio) ou use o endereço final, o mesmo da Site URL. |
| `verify-instance`: "Versão publicada" reprovada | A publicação da Vercel não terminou ou falhou, o branch de produção é outro, ou uma volta atrás (Instant Rollback) continua ativa | Confira em **Deployments**, espere a publicação terminar ou use **Undo Rollback**, e rode de novo ([Guia de atualização](ATUALIZACAO.md#13-solução-de-problemas)). |
| `verify-instance`: o frontend fala com outro Supabase | `VITE_SUPABASE_URL` da Vercel aponta para outro projeto | Corrija a variável na Vercel e publique de novo. |
| `verify-instance`: a chave não é deste projeto | Chave de outro projeto, ou a chave secreta | Use a chave pública do projeto da empresa (etapa 3). |
| Outra pessoa virou Dono | Alguém fez o primeiro cadastro antes | [Outra pessoa virou Dono](#outra-pessoa-virou-dono). |
| Projeto Supabase pausado | Plano Free com pouca atividade | Restaure no painel; dados reais pedem o Pro (etapa 2). |
| O Auth parou depois de uma atualização da plataforma | Gatilho do CRM numa tabela do Auth | [Apêndice A.9](#a9-o-auth-parou-depois-de-uma-atualização-da-plataforma). |
| Perdeu o papel de dono | O único dono foi rebaixado ou desativado | [Recuperar o acesso de dono](RECUPERAR-ACESSO-DONO.md). |

## Apêndice A. Referência técnica

### A.1 O artefato da publicação

`vercel.json` define Vite, a instalação com `npm ci`, o build `npm run build:deploy` e a saída `dist`. O npm é o gerenciador único (decisão D1), e o lockfile validado é `package-lock.json`. O projeto usa Node 22 (`.nvmrc`), e `engines.node` em `package.json` aceita a partir do Node 20. A regra de SPA direciona as rotas internas para `index.html`, para o CRM abrir fichas, convites e redefinição de senha por link direto ([Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas)).

`.vercelignore` exclui arquivos de ambiente, documentação, banco e testes do envio pelo CLI da Vercel; os arquivos locais da conexão Vercel ficam ignorados pelo Git ([arquivo de exclusão](https://vercel.com/docs/deployments/vercel-ignore)).

O build de publicação usa o modo `deployment`: falha antes de gerar o site se a configuração do Supabase estiver ausente ou inválida, se `VITE_SUPABASE_URL` não começar com `https://`, se a chave for a secreta ou se a CSP do `vercel.json` não cobrir esse endereço (um domínio próprio do Supabase ou um Supabase auto-hospedado; a mensagem diz o que acrescentar ao `connect-src` e onde). As variáveis `VITE_` entram no código que vai para o navegador; credenciais administrativas, SMTP e provedores de IA não pertencem a ele. Mudanças nas variáveis pedem um novo build. `VITE_CRM_ENVIRONMENT` foi aposentada no item 1.3: se ainda estiver na hospedagem, o build passa e só avisa; pode apagá-la. `VITE_SUPPORT_EMAIL` ficou obsoleta: o e-mail de suporte é o `supportEmail` do `public/brand/brand.json`, e a variável só vale, com aviso, quando ele está vazio.

A marca é conferida no build: com o arquivo ou uma imagem inválidos, a publicação falha com a lista de problemas, e a versão anterior continua no ar. O `public/brand/brand.json` também é publicado em `<SUA_URL>/brand/brand.json`: ele não tem segredo, porque tudo nele aparece na tela. Quem implanta para várias empresas usa um branch (ou fork) por empresa, com o **Production Branch** de cada projeto da Vercel apontado para ele ([Várias empresas](MARCA.md#11-várias-empresas)).

### A.2 Cabeçalhos de segurança e a instância fora dos buscadores

Desde o item 1.3, o `vercel.json` responde cada página com cabeçalhos de segurança, conferidos por `scripts/lib/security-headers.test.mjs`, pelo E2E sobre o build e, na instância publicada, pelo `npm run verify-instance`:

- `Content-Security-Policy` do app: só a própria origem para scripts, estilos, imagens e fontes (`'unsafe-inline'` só nos estilos, que o Radix, o sonner e o vaul injetam), conexões só com a própria origem e com `https://*.supabase.co` e `wss://*.supabase.co`, nada de quadros, objetos, `eval` ou script inline e `frame-ancestors 'none'`: o CRM não abre dentro de outro site. Os links do WhatsApp, do Gmail e do Outlook são navegação, e a CSP não os restringe.
- `/brand/*` tem a CSP própria do item 1.6, com `sandbox` e sem `script-src`: um SVG da marca aberto direto no domínio do CRM não executa script. O `X-Content-Type-Options: nosniff` vem da regra comum a todas as páginas.
- `Strict-Transport-Security` de dois anos, com `includeSubDomains` e sem `preload` (a inscrição na lista de pré-carga é pública e difícil de desfazer); `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin` (os links de saída levam só a origem, nunca o `?invite=`); `X-Frame-Options: DENY`; e `Permissions-Policy` sem câmera, microfone, localização, pagamento nem USB.

A Vercel pode mandar o próprio `Strict-Transport-Security` além do do `vercel.json`; o `verify-instance` aceita a duplicata quando nenhuma das duas é mais fraca. Outra hospedagem (Netlify, Cloudflare Pages) não lê o `vercel.json` e precisa repetir esses cabeçalhos no formato dela. Uma imagem ou API de outro endereço exige acrescentar o host à diretiva certa da regra `/((?!brand/).*)` do `vercel.json`, com o motivo ([README](../README.md#configuração-do-auth-e-cabeçalhos)). Os deploys de pré-visualização da Vercel (`*-git-*.vercel.app`) não estão na lista de retorno do Auth: um link de e-mail pedido numa pré-visualização volta à Site URL. Não acrescente um curinga de `vercel.app` à lista, porque qualquer outro projeto da Vercel passaria.

A instância sai fora dos buscadores: `index.html` traz `noindex, nofollow` e `public/robots.txt` fecha o site inteiro. A reversão está em "Instância fora dos buscadores", no [README](../README.md#instância-fora-dos-buscadores).

Conferência manual, além do `verify-instance`: `curl.exe -I <SUA_URL>/` e `curl.exe -I <SUA_URL>/brand/brand.json` no Windows (`curl -I` no macOS) e, com o console do navegador aberto (F12), navegar pelas telas e conferir que não aparece "Refused to…" nem "Content Security Policy".

### A.3 O config:push em detalhe

O link por e-mail volta à raiz do CRM com `?invite=` (o convite) e `?next=` (a tela que a pessoa abriu antes de entrar), e a redefinição de senha volta a `/reset-password`. Por isso o retorno é `<SUA_URL>/**`: um retorno fora da lista vira a Site URL, e o link perde o convite e o destino ([destinos permitidos](https://supabase.com/docs/guides/auth/redirect-urls)).

Os modelos do CRM não são só idioma e marca: só eles resistem aos filtros de segurança do e-mail (como o Safe Links do Microsoft Defender), que abrem os links antes da pessoa. O link dos modelos abre o CRM, que só o usa quando a pessoa aperta **Continuar**, e os e-mails de cadastro e de link de acesso trazem também um código. Com os modelos padrão, o filtro gasta cada link e a conta fica sem senha; a saída provisória está em [Recuperar o acesso de dono](RECUPERAR-ACESSO-DONO.md#pessoa-que-não-consegue-usar-nenhum-link-do-e-mail). Por isso, aplique a configuração antes de liberar o acesso à equipe.

O `npm run config:push` chama o Supabase CLI fixado (`npx supabase@2.119.0 config push`) só depois da conferência. No primeiro push, a diferença traz a Site URL, o retorno, o SMTP, os limites, os modelos, o intervalo entre e-mails e a verificação em duas etapas desligada; nos seguintes, só o que mudou. O push grava só `<SUA_URL>/**` como retorno e apaga qualquer outra URL de retorno cadastrada no painel: depois dele, um link pedido pelo `npm run dev` contra este projeto volta ao CRM publicado; para testar e-mails no computador, use o [Supabase local](../supabase/templates/README.md#ambiente-local-configtoml).

O que ele recusa antes de chamar o CLI: uma variável de `supabase/.env` ausente (o CLI a mandaria como o texto `env(NOME)`), uma chave de segurança diferente no `supabase/config.toml` (o CLI envia a seção `[auth]` inteira, e a chave que falta vai com o padrão dele, como a confirmação desligada), uma tabela fora das que o `supabase/config.toml` da base usa (como `[remotes.*]` ou `[auth.hook.*]`), uma variável `SUPABASE_<CAMINHO>` no ambiente ou num `.env` que o CLI lê (como `SUPABASE_AUTH_EMAIL_ENABLE_CONFIRMATIONS`), um `supabase/.env.local` do Supabase local que venceria o `supabase/.env` e um valor com `$` fora de aspas simples.

**Várias empresas no mesmo computador.** O `supabase/.env` e o projeto ligado ficam na pasta, não no branch: use um clone por empresa ou refaça o `link` e o `supabase/.env` ao trocar de empresa, e confira o projeto ligado e a Site URL no resumo do `config:check` antes do push ([Várias empresas](MARCA.md#11-várias-empresas)).

**Trocar o domínio do CRM.** Atualize o domínio na Vercel e as duas URLs em `supabase/.env` e rode `npm run config:push`: a diferença mostra só a Site URL e o retorno. Os links de e-mails enviados antes da troca voltam ao endereço antigo, que a Vercel redireciona se o domínio antigo continuar no projeto.

**Instância configurada antes pelo painel.** Preencha o `supabase/.env` com os valores atuais (a senha do SMTP não aparece no painel e precisa ser digitada de novo) e rode o `config:check` e o `config:push`. A diferença do primeiro push mostra o que o painel tinha de diferente. Um hook do Auth ligado no painel não é tocado. Login social e telefone são desligados, porque o CRM só aceita e-mail e senha. As URLs de retorno do painel são trocadas por `<SUA_URL>/**`: confira na diferença se alguma delas ainda é usada e responda **n** se não quiser perdê-la.

O passo a passo do painel, os avisos sobre o logo, o domínio dos links, os filtros de link e o Outlook, o convite pelo painel e as notificações que ficam de fora estão em [Modelos de e-mail do acesso](../supabase/templates/README.md).

### A.4 Primeiro dono, convites e a confirmação de e-mail

Cada instância tem uma empresa só (decisão D6, item 1.1). Enquanto não há empresa, o primeiro cadastro cria a empresa e fica com o papel de Dono; depois disso, o banco só aceita conta nova de um e-mail com convite do CRM (gatilho em `auth.users`), e ninguém cria outra empresa.

- **Mantenha o cadastro ligado no Auth** (Authentication → Sign In / Providers → "Allow new users to sign up"): a regra de convite está no banco, e com o cadastro desligado nem o convidado consegue criar a conta.
- **Mantenha a confirmação de e-mail ligada** ("Confirm email"): é ela que prova que a pessoa controla o e-mail. Outra pessoa pode criar antes a conta de um e-mail convidado (ou, antes da empresa, de qualquer e-mail), com uma senha própria, e o Supabase não troca essa senha quando o dono do e-mail se cadastra depois. Por isso, quando a conta é confirmada, o banco descarta a senha anterior; quando a confirmação vem do link aberto pela pessoa, grava também a prova do e-mail, e o aceite do convite e a criação da empresa exigem essa prova (ou uma sessão aberta pelo link): quem pré-cadastrou a conta nunca entra nela. A senha nasce depois, no CRM, em **Crie sua senha**.
- **Nunca desligue a confirmação de e-mail.** Com ela desligada, qualquer conta ainda não confirmada fica com quem chamar o cadastro com o e-mail dela: o Supabase confirma a conta e entrega uma sessão a quem pediu, sem conferir senha nenhuma. Contas assim surgem quando o e-mail de confirmação não chegou, num pré-cadastro e nas contas criadas pelo painel sem Auto Confirm ou pelo "Invite user". O banco não grava a prova nesse caso, então essa sessão não aceita convite nem cria a empresa; mas ela continua aberta até a pessoa entrar pelo link e criar a senha. Se precisar desligar, exclua antes as contas não confirmadas: no editor SQL, `select id, email from auth.users where email_confirmed_at is null` lista essas contas (a conferência do banco mostra quantas são), que você exclui em **Authentication → Users**. O `npm run verify-instance` reprova a confirmação desligada.
- **Prefira o convite do CRM a criar contas pelo painel.** Criar a conta em **Authentication → Users → Add user → Create new user** não envia e-mail nenhum. Se precisar criar assim, deixe **Auto Confirm User** desligado e peça à pessoa que abra o link do convite e use **Link por e-mail** (ou **Cadastrar**): o link que chega confirma a conta, a senha do painel é descartada, e a pessoa cria a dela no aceite. A exceção é o [break-glass](RECUPERAR-ACESSO-DONO.md): lá o Auto Confirm é exigido, e a pessoa troca a senha logo depois.
- **E-mail digitado errado.** O banco recusa a troca de e-mail de uma conta que ainda não entrou na empresa. Para corrigir, exclua a conta em **Authentication → Users**, revogue em **Equipe** o convite do e-mail errado, se ainda estiver pendente, e crie o convite para o e-mail certo.
- **Convites.** A pessoa abre o link `<SUA_URL>/?invite=…`, informa o nome e o e-mail convidado na aba **Cadastrar**, abre o link de confirmação que chega nesse e-mail, cria a senha em **Crie sua senha** e aceita o convite. Quem já tem conta entra pela aba **Entrar**; se a conta não tiver a prova do e-mail, o aceite pede o link de acesso em **Enviar link para o meu e-mail**. Para o convite pelo painel do Supabase ("Invite user"), crie antes o convite no CRM: sem ele, o painel mostra "Database error saving new user".
- **Quando alguém sai da equipe.** Um dono ou administrador usa **Desativar** no cartão da pessoa (o de um dono, só outro dono): a confirmação mostra quantas oportunidades em aberto, atividades pendentes, contatos e empresas estão com ela e pede quem recebe a carteira. A pessoa perde o acesso na consulta seguinte, mesmo com o CRM aberto, e os convites pendentes que ela criou são revogados. O histórico continua no nome dela, com a marca "(desativado)", e **Reativar** devolve o acesso. A desativação não depende do Auth: nenhuma Edge Function nem chave secreta é necessária.

### A.5 Canais

WhatsApp, e-mail e telefone (item 1.9) não exigem configuração, credencial nem serviço novo: o CRM abre o aplicativo da pessoa por link (`wa.me`, a composição do Gmail e a do Outlook web, `mailto:` e `tel:`) e nunca envia nada. Integrações que gravam com a chave secreta (n8n, Make, Edge Functions, entrada de leads) continuam criando contatos e empresas. Avise a equipe de duas coisas:

- **"Abrir no Outlook web"** serve para contas Microsoft 365 de trabalho ou escola (`outlook.office.com`). Com Outlook.com ou Hotmail, e no celular, use **Abrir no aplicativo de e-mail**.
- **O número, o e-mail e o texto da mensagem** vão ao WhatsApp, ao Google ou à Microsoft só para abrir a mensagem, como se a pessoa os digitasse lá, e o navegador guarda o histórico desses links. O CRM não guarda o texto enviado ([mapa de dados](LGPD-INSTANCIA.md#2-mapa-de-dados-da-instância)).

### A.6 Privacidade, importação, lembretes e gestão

A empresa que usa o CRM é a controladora dos dados das pessoas cadastradas, e quem implanta pode ser operador quando hospeda ou opera a instância. O guia [LGPD da instância](LGPD-INSTANCIA.md) traz os papéis, o mapa de dados, as bases legais, como atender os pedidos das pessoas, o que a anonimização não alcança (cópias de segurança, registros do Supabase, arquivos exportados e aplicativos de mensagem) e os modelos de aviso de privacidade e de termo, que são rascunhos para revisão jurídica. A base legal por contato é preenchida pelo banco, com o padrão da empresa; "Não contatar" é recusado no banco para ações de contato agendadas; "Exportar dados deste contato" e "Anonimizar contato" são só para donos e administradores, com o registro em "Segurança". Integrações que gravam com a chave secreta passam a receber a recusa ao agendar ligação, WhatsApp, e-mail, reunião ou visita para um contato marcado e ao ligar um registro a um contato anonimizado; a tarefa e a nota passam.

A importação de planilha (item 1.11), os lembretes no menu (item 1.12) e a gestão mínima (item 1.14) não exigem configuração nem serviço novo. "Exportar contatos" sai com os cabeçalhos do modelo de importação (`nome`, `sobrenome`, `email`, `telefone`, `nao_contatar`, `base_legal` e `registro_base_legal`): quem tem automação lendo `first_name` na planilha exportada precisa trocar o nome da coluna. O número ao lado de "Hoje" lê as atividades pendentes da pessoa, e o CRM não envia notificação nem e-mail de lembrete.

### A.7 Catálogo e dados de demonstração

O catálogo de produtos e serviços e os itens na oportunidade (item 1.16) não exigem configuração nem serviço novo. Integrações que inserem oportunidades com a chave secreta continuam gravando o valor enviado.

`supabase/seed-demo.sql` (item 1.15) enche um CRM **vazio** com dados fictícios: o funil "Parcerias", empresas, contatos com origem, cargo, base legal e celular fictício, oportunidades abertas, ganhas e perdidas, algumas com itens do catálogo, atividades de WhatsApp, e-mail, ligação e visita (uma vencida e uma do dia para o Dono), um contato "Não contatar", um anonimizado, recebimentos, automações e modelos. Ele não cria contas no Auth. Rode-o de preferência durante o dia (a atividade "do dia" vence à meia-noite de Brasília); o resultado é uma linha "Dados de demonstração criados" com as contagens.

O seed recusa, sem gravar nada, um CRM sem empresa ou que já tenha qualquer contato, empresa, oportunidade, atividade, recebimento, item do catálogo, automação ou modelo, e só roda no editor SQL do painel. Os e-mails são de `example.test` e os celulares têm o formato "(DDD) 90000-NNNN", que não são de ninguém conhecido; avise a turma para não enviar mensagens a eles pelo botão **WhatsApp**.

`supabase/seed-demo-remove.sql` apaga só o que o seed criou e as atividades e os recebimentos ligados a esses registros, inclusive os registrados em aula; o que a equipe criou fica. Se um registro da equipe aponta para a demonstração (um contato real ligado a uma empresa fictícia, uma oportunidade ligada a um registro fictício ou que passou pelo funil "Parcerias", um item de oportunidade com um item fictício do catálogo, uma automação com filtro nesse funil), a remoção recusa sem apagar nada e diz quantos são e o que fazer. A auditoria e os registros das automações ficam, como todo histórico. Depois da remoção, o seed só roda de novo com o CRM vazio outra vez.

### A.8 Publicar migração e frontend juntos e voltar uma versão

Aplique as migrações e publique o frontend do mesmo commit no mesmo dia. Com o banco novo e o frontend antigo, telas antigas podem gravar direto numa tabela que passou a exigir uma função do banco (os convites desde o item 1.1) ou não conhecer um tipo novo (os canais do item 1.9); com o frontend novo e um banco sem a migração, as telas novas mostram "Este CRM ainda não tem a atualização…" e pedem a quem administra para aplicar a migração mais recente. As notas de cada versão, no [`CHANGELOG.md`](../CHANGELOG.md), dizem o que muda e o que fazer ("Ao atualizar"); o passo a passo de uma atualização, com a ordem banco, Auth e frontend, está no [Guia de atualização](ATUALIZACAO.md).

Para voltar o frontend à versão anterior, use o **Instant Rollback** da Vercel ([Guia de atualização, etapa 12](ATUALIZACAO.md#12-voltar-atrás)). Não reverta o banco por inferência: as migrações só andam para frente, e cada mudança entra como arquivo novo em `supabase/migrations`.

### A.9 O Auth parou depois de uma atualização da plataforma

Os gatilhos do CRM nas tabelas do Auth não citam colunas, para não barrar as migrações do Supabase (a conferência do banco reprova o gatilho que citar). Se mesmo assim uma migração do Auth falhar por causa deles, o remédio de emergência é remover os três gatilhos pelas funções, no editor SQL:

```sql
drop function private.discard_unproven_password(), private.record_email_proof(), private.refuse_email_change_without_org() cascade
```

O que deixa de valer: a senha criada antes da confirmação deixa de ser descartada e a prova do e-mail deixa de ser gravada. A admissão continua fechada, porque o aceite do convite e a criação da empresa passam a exigir a sessão aberta pelo link do e-mail. Depois do comando, a conferência do banco reprova três verificações, "Gatilhos", "Permissões da API" e "Funções da base" (esperado: as três sentem a falta das funções removidas), até uma migração nova da base recriá-los: avise quem mantém a base. O mesmo comando é a volta atrás do reforço do item 1.1, para quem precisar sair dele por decisão ([desenho do 1.1, seção 16.9](arquitetura/1.1.md#169-caminho-de-atualização), passos 5 e 8).

### A.10 Aceite completo na URL escolhida

Além das conferências e do checklist, um aceite funcional antes de liberar para toda a equipe (as dificuldades encontradas viram revisão dos tours e da Ajuda):

1. Abrir e recarregar `/contacts`, `/pipeline`, `/invite` e `/reset-password` sem erro da hospedagem, com o console sem "Refused to…".
2. Confirmar que o navegador chama só o Supabase da instância. Validar o primeiro acesso pelo link (nome e e-mail em **Cadastrar**, o link com **Continuar**, **Crie sua senha** e **Criar empresa**) e, noutro cadastro, o código do e-mail digitado no aviso de link enviado. Numa janela sem sessão, conferir a entrada só por convite: a aba **Cadastrar** avisa que o CRM aceita novas contas só por convite; o **Link por e-mail** com um e-mail sem conta responde que não há conta; um e-mail diferente do convidado é recusado. Abrir `/pipeline?deal=<id>` sem sessão, entrar e conferir que o CRM volta à oportunidade.
3. Repetir contato → oportunidade → próxima ação → conclusão → ficha 360. Num contato com celular e e-mail, abrir **WhatsApp**, **Abrir no Gmail** e **Ligar** num celular e num computador, voltar ao CRM, usar **Registrar** e conferir a ligação na linha do tempo. Conferir o número ao lado de **Hoje** com uma tarefa vencida e outra do dia, e o seletor de pessoa em Hoje e **Ganhos por responsável** nos Relatórios.
4. Com destinatários de teste, verificar confirmação, convite e redefinição de senha, inclusive expiração e recarga, em português e com a marca.
5. Como dono, escolher a base legal padrão, cadastrar um contato de teste, usar **Exportar dados deste contato**, **Anonimizar contato** e **Excluir cadastro**, e conferir os registros em **Segurança → Exportações e anonimizações**. Apagar do computador o arquivo exportado.
6. Em **Integrações**, importar um CSV de teste salvo no Excel, com acentos, e conferir a prévia, a distribuição entre pessoas, a marca "Não contatar" e a recusa do .xlsx; depois, excluir os contatos e a empresa de teste.
7. Em **Configurações → Catálogo**, criar um item mensal e um único, usá-los numa oportunidade com desconto e meses de contrato, marcar como ganha e conferir os Relatórios e as planilhas de **Exportar CSV**; depois, excluir a oportunidade e os itens de teste.
8. Abrir a **Ajuda** como dono e como uma pessoa com acesso somente leitura: o checklist "Configuração do CRM", a busca por "senha", "convite" e "planilha" e os tours.
