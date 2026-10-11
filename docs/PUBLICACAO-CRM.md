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

Depois de existir uma URL estável (`<SUA_URL>`), configurar no Supabase o Site URL e os destinos de confirmação e recuperação dessa origem. O CRM usa a raiz para confirmação/login e `/reset-password` para recuperação; convites preservam o parâmetro `invite`. Conferir o retorno do parâmetro no fluxo completo do convite. [Destinos permitidos pelo Supabase](https://supabase.com/docs/guides/auth/redirect-urls).

Conferir o serviço de entrega e o remetente antes de liberar o acesso à equipe. Manter a confirmação de e-mail ligada. O serviço de e-mail padrão do Supabase restringe destinatários e não serve para uso geral; configure um SMTP próprio. [SMTP no Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

## Aceite na URL escolhida

1. Conferir que JS, CSS, fontes e marca carregam e que abrir/recarregar `/contacts`, `/pipeline`, `/invite` e `/reset-password` não resulta em erro da hospedagem.
2. Confirmar que o navegador chama somente o Supabase da instância (`https://<SEU_PROJECT_REF>.supabase.co`). Validar login, recarga de sessão, criação do espaço e os papéis esperados.
3. Repetir contato → oportunidade → próxima ação → conclusão → 360; comparar os mesmos IDs e estados.
4. Com os destinatários de teste definidos, verificar confirmação, convite e recuperação de senha, incluindo expiração e recarga. Envio de mensagens de teste depende dessa autorização específica.
5. Conferir que `<SUA_URL>/robots.txt` responde com `Disallow: /`.
6. Fazer um piloto curto com participantes reais antes de liberar para toda a equipe e registrar as dificuldades que motivarão a revisão de tours e ajuda.

O retorno à versão anterior do frontend deve usar uma implantação já validada. Não reverter o banco por inferência: as migrações só andam para frente, e cada mudança entra como arquivo novo em `supabase/migrations`.
