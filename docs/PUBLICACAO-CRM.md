# Publicação do CRM

O que já está preparado para publicar uma instância do CRM na Vercel (decisão D2 do [roteiro](ROADMAP-FINALIZACAO.md)). Cada empresa publica a própria instância, com projeto Supabase, hospedagem e repositório próprios.

> **Provisório.** Este documento será substituído pelo guia de implantação (`docs/IMPLANTACAO.md`, item 1.4 do roteiro), que cobre criação do projeto Supabase, migrações, Auth, SMTP, hospedagem, primeiro dono e solução de problemas. Até lá, os marcadores abaixo indicam o que cada instância preenche:
>
> - `<SEU_PROJECT_REF>`: referência do seu projeto Supabase, o trecho antes de `.supabase.co` na URL;
> - `<SUA_URL>`: endereço público da instância, por exemplo o domínio da empresa;
> - `<SEU_REPOSITORIO>`: repositório Git da instância, no formato `conta/repositorio`.

## Artefato preparado

`vercel.json` define Vite, instalação com `npm ci`, build `npm run build:deploy` e saída `dist`. O npm é o gerenciador único (decisão D1 do roteiro), e o lockfile validado é `package-lock.json`. O projeto usa Node 22 (`.nvmrc`), e `engines.node` em `package.json` aceita a partir do Node 20. Se a Vercel avisar sobre essa faixa, fixar Node 22.x nas configurações do projeto. A regra de SPA direciona as rotas internas para `index.html`, permitindo que o React Router abra fichas, convites e recuperação de senha por link direto. É a configuração indicada pela [documentação oficial de Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas).

`.vercelignore` exclui arquivos de ambiente, documentação, banco e testes do envio pelo CLI. As variáveis de ambiente devem ser configuradas no projeto de hospedagem. Os arquivos locais da conexão Vercel ficam ignorados pelo Git. [Contrato do arquivo de exclusão](https://vercel.com/docs/deployments/vercel-ignore).

O comando de publicação usa o modo `deployment`: falha antes de gerar o frontend se a configuração do Supabase estiver ausente ou inválida. Em 11/10/2026, `npm ci` numa cópia limpa do repositório e `npm run build:deploy` com variáveis públicas fictícias foram conferidos localmente, no Windows. Essa verificação não comprova execução na infraestrutura da Vercel.

A instância sai fora dos buscadores: `index.html` traz `noindex, nofollow` e `public/robots.txt` fecha o site inteiro. A reversão está na seção "Instância fora dos buscadores" do [README](../README.md#instância-fora-dos-buscadores).

## Configuração do projeto de hospedagem

| Campo | Valor |
| --- | --- |
| Repositório | `<SEU_REPOSITORIO>` |
| Diretório raiz | Raiz do repositório |
| Framework | Vite |
| Instalação / build / saída | Definidos em `vercel.json` |
| `VITE_CRM_ENVIRONMENT` | `dedicated` |
| `VITE_SUPABASE_URL` | `https://<SEU_PROJECT_REF>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública (`sb_publishable_…` ou JWT `anon`) do seu projeto, configurada pelo canal de ambiente |
| `VITE_SUPPORT_EMAIL` | Opcional, após definir o destino de suporte |

Essas variáveis entram no bundle do navegador. Credenciais administrativas, SMTP e provedores de IA não pertencem a esse frontend. Mudanças nas variáveis requerem um novo build. A hospedagem deve apontar só para o projeto Supabase da própria instância.

## Acesso e e-mails

Depois de existir uma URL estável (`<SUA_URL>`), configurar no Supabase o Site URL e os destinos de confirmação e recuperação dessa origem. O CRM usa a raiz para confirmação/login e `/reset-password` para recuperação. O link por e-mail (confirmação de cadastro e acesso sem senha) volta à raiz com dois parâmetros na consulta: `invite`, o convite, e `next`, a tela que a pessoa abriu antes de entrar (por exemplo, `/pipeline?deal=…`). O Supabase aceita esse retorno porque o host é o mesmo do Site URL; se você restringir os destinos a uma lista exata, permita a raiz com consulta (por exemplo, `<SUA_URL>/**`). Conferir o retorno dos dois parâmetros no fluxo completo do convite e num link aberto sem sessão. [Destinos permitidos pelo Supabase](https://supabase.com/docs/guides/auth/redirect-urls).

Conferir o serviço de entrega e o remetente antes de liberar o acesso à equipe. Manter a confirmação de e-mail ligada. O serviço de e-mail padrão do Supabase restringe destinatários e não serve para uso geral; configure um SMTP próprio. [SMTP no Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

Depois do SMTP, aplicar os modelos de e-mail do acesso em pt-BR, versionados em `supabase/templates/`. O painel só libera a edição dos modelos com SMTP próprio configurado; até lá, os e-mails saem no padrão do Supabase, em inglês. Antes de colar:

1. Conferir em **Authentication → Sign In / Providers → Email** a validade do link (**Email OTP Expiration**), o tamanho do código (**Email OTP Length**) e **Secure email change**, e em **Authentication → URL Configuration** que a Site URL é `<SUA_URL>`, sem barra no final: o logo dos e-mails vem dela.
2. Ajustar `supabase/templates/brand.json`: `linkExpiry`, `codeLength` e `secureEmailChange` iguais ao painel; o nome (`productName`), o nome curto que fecha os assuntos (`shortName`), o slogan e o e-mail de suporte; e o logo (`logoUrl`). O `/brand/eia-email.png` do repositório é o logo da Empreende.IA e só vale com a marca do programa. Com a marca da empresa, colocar o PNG dela, com fundo opaco, em `public/brand/` (por exemplo, `public/brand/logo-email.png`), usar `"logoUrl": "/brand/logo-email.png"` e ajustar `logoWidth`, ou usar `""` para mostrar o nome em texto. Depois, rodar `npm run emails:build`, que recusa o logo do programa com outra marca e confere que o arquivo existe na sua máquina. Com logo próprio, fazer commit do PNG junto com o `brand.json` e os arquivos gerados, publicar o frontend de novo e abrir `<SUA_URL>/brand/logo-email.png` no navegador: os e-mails buscam o logo no site publicado, e nem o `emails:build` nem a prévia confirmam que ele está lá.
3. Em **Authentication → Emails → Templates**, colar o assunto de `subjects.json` e o `.html` de cada um dos oito modelos e ligar as notificações **Password changed** e **Email address changed**. Copiar o código do `.html` aberto num editor (VS Code ou Bloco de Notas), não a página aberta no navegador; o passo a passo está em [`supabase/templates/README.md`](../supabase/templates/README.md#aplicar-no-painel).

O passo a passo, os avisos sobre o logo, o domínio dos links, scanners de link e Outlook, o convite pelo painel e as notificações que ficam de fora estão em [Modelos de e-mail do acesso](../supabase/templates/README.md).

## Primeiro dono e convites

Cada instância tem uma empresa só (decisão D6 do roteiro, item 1.1). Enquanto não há empresa, o primeiro cadastro cria a empresa e fica com o papel de Dono; depois disso, o banco só aceita conta nova de um e-mail com convite do CRM (gatilho em `auth.users`), e ninguém cria outra empresa.

- **Faça o primeiro cadastro logo depois de publicar.** Quem chegar antes vira dono. A instância já sai fora dos buscadores, mas o endereço pode circular.
- **Quem faz o primeiro cadastro.** A pessoa que vai administrar o CRM na empresa. Se você implanta o CRM para um cliente, escolha um dos caminhos e combine antes da publicação:
  - o responsável do cliente faz o primeiro cadastro logo depois de você publicar e confirma o e-mail; ou
  - você faz o primeiro cadastro, cria a empresa e, em **Equipe**, convida o responsável do cliente com o papel **Dono**. Depois que ele aceitar, ele (ou você) muda o papel da sua conta para o que você vai precisar (por exemplo, Administrador ou Somente leitura) em **Alterar papel**.
- **Mantenha o cadastro ligado no Auth** (Authentication → Sign In / Providers → "Allow new users to sign up"): a regra de convite está no banco, e com o cadastro desligado nem o convidado consegue criar a conta. **Mantenha também a confirmação de e-mail ligada** ("Confirm email"): o aceite do convite e a criação da empresa só valem para conta confirmada, e só quem controla o e-mail abre o link de confirmação. Sem a confirmação, quem tiver o link de um convite e souber o e-mail convidado cria a conta e entra na equipe, e o primeiro cadastro pode virar dono com um e-mail que não é seu. Desligada, o CRM continua funcionando (o Supabase marca o e-mail como confirmado no cadastro), mas sem essa proteção. A confirmação sozinha não basta: outra pessoa pode criar antes a conta de um e-mail convidado (ou, antes da empresa, de qualquer e-mail), com uma senha própria, e o Supabase não troca essa senha quando o dono do e-mail se cadastra depois. Por isso, o aceite do convite e a criação da empresa pedem a senha da conta: ela substitui qualquer outra, e as outras sessões abertas com esse e-mail são encerradas.
- **Publique a migração e o frontend juntos.** Aplique as migrações e publique o frontend do mesmo commit no mesmo dia: com o banco novo e o frontend antigo, a Equipe não consegue criar convites (a tela antiga grava direto na tabela, e o banco passou a exigir a RPC `create_invitation`).
- **Convites.** Em **Equipe → Convidar uma pessoa**, crie o convite e envie o link `<SUA_URL>/?invite=…` à pessoa (o CRM não envia e-mail). Ela se cadastra com o e-mail convidado, confirma o e-mail e aceita, informando a senha da conta. Para o convite pelo painel do Supabase ("Invite user"), crie antes o convite no CRM: sem ele, o painel mostra "Database error saving new user".
- **Perdeu o papel de dono?** Siga [Recuperar o acesso de dono](RECUPERAR-ACESSO-DONO.md), pelo editor SQL do painel.

## Aceite na URL escolhida

1. Conferir que JS, CSS, fontes e marca carregam e que abrir/recarregar `/contacts`, `/pipeline`, `/invite` e `/reset-password` não resulta em erro da hospedagem.
2. Confirmar que o navegador chama somente o Supabase da instância (`https://<SEU_PROJECT_REF>.supabase.co`). Validar o primeiro cadastro criando a empresa (com a confirmação do e-mail e a senha pedida em **Criar empresa**), login, recarga de sessão e os papéis esperados. Depois, numa janela sem sessão, conferir a entrada só por convite: a aba **Cadastrar** mostra "Este CRM aceita novas contas só por convite…", sem formulário; o **Link por e-mail** com um e-mail sem conta responde "Não há conta com este e-mail…"; e, ao abrir o link de um convite criado em **Equipe** e cadastrar um e-mail diferente do convidado, aparece "Este e-mail não tem convite válido neste CRM…". Por fim, conferir que esse convite funciona de ponta a ponta com o e-mail convidado (cadastro, confirmação e aceite com a senha da conta). Abrir `/pipeline?deal=<id>` numa janela sem sessão, entrar com senha e pelo link por e-mail, e conferir que o CRM volta à oportunidade.
3. Repetir contato → oportunidade → próxima ação → conclusão → 360; comparar os mesmos IDs e estados.
4. Com os destinatários de teste definidos, verificar confirmação, convite e recuperação de senha, incluindo expiração e recarga, e conferir que os e-mails chegam em pt-BR, com a marca da instância. Envio de mensagens de teste depende dessa autorização específica.
5. Conferir que `<SUA_URL>/robots.txt` responde com `Disallow: /`.
6. Fazer um piloto curto com participantes reais antes de liberar para toda a equipe e registrar as dificuldades que motivarão a revisão de tours e ajuda.

O retorno à versão anterior do frontend deve usar uma implantação já validada. Não reverter o banco por inferência: as migrações só andam para frente, e cada mudança entra como arquivo novo em `supabase/migrations`.
