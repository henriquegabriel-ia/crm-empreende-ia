# Modelos de e-mail do acesso (Supabase Auth)

Os e-mails automáticos de cadastro, convite, acesso por link, troca de e-mail, redefinição de senha, código de verificação e avisos de segurança, em pt-BR e com o Design System Empreende.IA V2 para e-mail: logo no topo, fundo claro fixo, largura de 600 px, faixa escura com o título, cartão branco com borda, ponto esmeralda pontual, botão sólido e texto escondido de pré-visualização (preheader). Eles não carregam fontes remotas, rastreadores, JavaScript nem formulários; a única imagem é o logo.

Os modelos são **gerados**: a marca fica em `brand.json`, e o comando `npm run emails:build` produz os `.html`, os assuntos e o bloco do `config.toml`. Para trocar a marca, ninguém precisa editar HTML.

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `brand.json` | A marca dos e-mails. É o único arquivo desta pasta para editar. |
| `confirmation.html` … `email_changed_notification.html` | Os oito modelos, gerados. Vão para o painel do Supabase. |
| `subjects.json` | O assunto de cada modelo, gerado. |
| `config-snippet.toml` | Os mesmos modelos no formato do `supabase/config.toml`, para um Supabase local. Gerado. |
| `preview.html` | Prévia com valores fictícios, gerada por `npm run emails:preview`. Fica fora do Git. |

O gerador é [`scripts/build-auth-emails.mjs`](../../scripts/build-auth-emails.mjs). O layout comum, os textos de cada modelo e a lista de variáveis permitidas ficam em [`scripts/lib/auth-emails.mjs`](../../scripts/lib/auth-emails.mjs), e o teste em [`scripts/lib/auth-emails.test.mjs`](../../scripts/lib/auth-emails.test.mjs).

| Arquivo | Modelo no painel | Quando o Supabase envia |
| --- | --- | --- |
| `confirmation.html` | Confirm sign up | Primeiro acesso de um e-mail sem conta, com a confirmação de e-mail ligada: cadastro pela aba "Cadastrar" ou pedido pela aba "Link por e-mail" da tela de entrada. O link volta à raiz do CRM com `?invite=` e `?next=`. Um novo pedido de link para uma conta ainda não confirmada reenvia esta confirmação. |
| `invite.html` | Invite user | Convite feito pelo painel do Supabase. Ele cria a conta, mas não coloca a pessoa na equipe (ver [Convite pelo painel](#antes-de-usar-com-clientes)). Os convites da equipe são feitos no CRM, em **Equipe → Convidar uma pessoa → Criar convite**, com o link `/invite` e sem este e-mail. |
| `magic_link.html` | Magic link | Aba "Link por e-mail" da tela de entrada, para quem já tem conta confirmada. |
| `email_change.html` | Change email address | Troca do e-mail de acesso pedida pela própria pessoa (`updateUser` com `email`). **O CRM não envia este e-mail hoje**: não há tela de troca de e-mail. O modelo fica pronto para quando houver. Com "Secure email change" ligado, vai para o endereço atual e para o novo. |
| `recovery.html` | Reset password | Botão "Esqueceu a senha?". O link abre `/reset-password`, em que a pessoa escolhe a senha nova. |
| `reauthentication.html` | Reauthentication | Código para confirmar uma alteração sensível, enviado só quando o app chama `supabase.auth.reauthenticate()`. **O CRM não envia este e-mail hoje**: não faz essa chamada nem tem campo para o código. O modelo fica pronto para quando houver. |
| `password_changed_notification.html` | Password changed | Aviso depois que a pessoa troca a própria senha, como em `/reset-password`. Só com a notificação ligada. |
| `email_changed_notification.html` | Email address changed | Aviso depois que uma troca de e-mail pedida pela pessoa é confirmada. Como o CRM não tem tela de troca de e-mail, não sai hoje. Só com a notificação ligada. |

**Secure password change** não envia o código de verificação. Ligada no painel, ela faz a troca de senha (`updateUser` com `password`) exigir esse código (o `nonce`) quando a sessão tem mais de 24 horas, e o CRM não tem campo para ele. Pelo link de "Esqueceu a senha?" a sessão é nova e a redefinição continua funcionando, mas quem abrir `/reset-password` com uma sessão antiga recebe um erro. Por isso a opção fica desligada.

## Trocar a marca

1. Edite `brand.json` (campos abaixo). Mantenha as aspas e as vírgulas; chaves que começam com `_` são comentários.
2. Rode `npm run emails:build`. O comando recusa valores inválidos e diz qual campo corrigir.
3. Rode `npm run emails:preview` e abra `supabase/templates/preview.html` no navegador para revisar os oito modelos em 640, 375 e 320 px de largura.
4. Faça commit de `brand.json`, dos arquivos gerados e, com logo próprio, do PNG em `public/brand/` (por exemplo, `public/brand/logo-email.png`), que não é gerado.
5. Com logo próprio, publique o frontend de novo (o push para a Vercel faz isso) e abra `<SUA_URL>/brand/logo-email.png` no navegador. Os e-mails buscam o logo no site publicado: se o endereço não abrir a imagem, todos saem com a imagem quebrada. O `emails:build` e a prévia não confirmam isso, porque só olham o arquivo na sua máquina.
6. [Aplique os modelos no painel](#aplicar-no-painel).

A coluna "No repositório" mostra o valor do `brand.json` versionado (a marca do programa e a configuração do projeto de desenvolvimento). A coluna "Sem o campo" mostra o que o gerador usa quando a linha é apagada.

| Campo | No repositório | Sem o campo | O que muda |
| --- | --- | --- | --- |
| `productName` | `Empreende.IA · CRM` | obrigatório | Texto alternativo do logo (ou o nome no topo, sem logo) e assinatura do rodapé. Até 60 caracteres. |
| `shortName` | `Empreende.IA · CRM` | obrigatório | Final de cada assunto, como em "Redefina sua senha · Empreende.IA · CRM". O assunto também é o título da página do e-mail. Até 40 caracteres. |
| `tagline` | `Relacionamentos que fazem o negócio crescer.` | `""` | Slogan abaixo do nome no rodapé. `""` não mostra. |
| `supportEmail` | `""` | `""` | Com um endereço, o rodapé ganha "Precisa de ajuda? Escreva para …", e os avisos de segurança o indicam. Use o mesmo destino de `VITE_SUPPORT_EMAIL`. |
| `logoUrl` | `/brand/eia-email.png` | `""` | Logo do topo. Um caminho que começa com `/` é um arquivo de `public/` do frontend: o e-mail usa `{{ .SiteURL }}/brand/…`, e o Supabase completa com a Site URL do projeto no envio. Também aceita um endereço `https://` completo. `""` mostra o `productName` em texto. Ver [Logo](#logo). |
| `logoWidth` | `185` | `185` | Largura do logo em pixels, de 40 a 300. A altura acompanha a proporção da imagem. |
| `linkExpiry` | `1 hora` | `""` | Validade escrita nos e-mails ("o link vale por 1 hora"). Precisa corresponder a **Email OTP Expiration** do painel: 3600 s = `1 hora`. `""` escreve "tem validade limitada". |
| `codeLength` | `8` | `6` | Dígitos do código de verificação, igual a **Email OTP Length** do painel (6 a 10). Dimensiona a caixa do código para caber em 320 px. |
| `secureEmailChange` | `true` | `true` | Igual a **Secure email change** do painel. Com `true`, o e-mail de troca explica que a confirmação foi para os dois endereços. |
| `showBaseCredit` | `true` | `true` | Crédito discreto "Feito com Empreende.IA" no rodapé, quando a marca é outra (decisão D3). Use `false` ao revender com marca própria. |

### Logo

- **Marca do programa.** O padrão é `/brand/eia-email.png`, o arquivo [`public/brand/eia-email.png`](../../public/brand/eia-email.png) que o build do frontend publica. Ele é o `eia-email-2x.png` do kit do DS (960 × 208, rasterizado do SVG oficial com a fonte Sora e o ponto esmeralda, exibido a 185 px), composto sobre o fundo `#f4f7f5` do e-mail. O PNG de 480 × 104 de `public/brand/` no repositório do DS saiu sem a fonte Sora e não foi usado.
- **Site URL.** O logo só aparece depois que a **Site URL** do Auth (Authentication → URL Configuration) aponta para o frontend publicado, sem barra no final, como `https://crm.suaempresa.com.br`. Enquanto ela for `http://localhost:3000`, o cliente de e-mail não acha a imagem e mostra o texto alternativo, que é o `productName`. O `{{ .SiteURL }}` dos avisos de segurança exige o Supabase Auth v2.190.0 ou mais novo (junho de 2026), que os projetos hospedados já usam; numa versão anterior, esses dois avisos saem com o texto alternativo no lugar do logo.
- **Marca própria.** Com outro nome, o `eia-email.png` é recusado pelo `emails:build`: o topo mostraria a Empreende.IA e o rodapé a empresa. Coloque o PNG da empresa em `public/brand/` (por exemplo, `public/brand/logo-email.png`, com o dobro da largura exibida, para telas de alta densidade), use `"logoUrl": "/brand/logo-email.png"` e ajuste `logoWidth`. O comando confere só que o arquivo existe em `public/` na sua máquina; o e-mail busca a imagem no site publicado. Antes de colar os modelos no painel, faça commit do PNG, publique o frontend de novo e confira que `<SUA_URL>/brand/logo-email.png` abre a imagem no navegador. Sem logo, use `""`: o topo mostra o nome em texto simples, sem imitar um logotipo.
- **Fundo opaco.** Use um PNG ou JPG com fundo opaco na cor `#f4f7f5`, não transparente. Alguns aplicativos (Gmail e Outlook no celular, Outlook.com e o Outlook novo) escurecem o fundo do e-mail, mas não a imagem: um logo escuro sobre fundo transparente quase desaparece. Com o fundo opaco, ele aparece numa placa clara.
- **Sem SVG nem caminho relativo.** E-mail não aceita SVG, e o caminho só funciona porque o Supabase o transforma em endereço completo. Muitos clientes só mostram imagens depois que a pessoa libera, por isso o texto alternativo do logo é o `productName`.

### Outras decisões

- **Crédito (D3).** O crédito só aparece quando a marca não é a do programa: se `productName` ou `shortName` já contêm "Empreende.IA" (ou "Empreende IA"), ele repetiria a marca e fica de fora. O padrão do repositório, portanto, não mostra o crédito.
- **Nome no meio das frases.** Os textos dizem "o CRM" em vez do nome da marca, para não errar a concordância ("no", "na", "ao") com qualquer nome que a empresa escolher. A marca aparece no logo, no assunto e no rodapé.
- **Sem código nos e-mails de link.** Os modelos de link mostram o botão e o endereço para copiar e colar, mas não o código `{{ .Token }}`: o CRM não tem tela para digitá-lo (não há `verifyOtp` em `src/`). O teste falha se `verifyOtp` aparecer no código, para lembrar de rever estes modelos.
- **Endereços empilhados.** Nas linhas de detalhe, o rótulo ("Conta", "Novo e-mail") fica numa linha e o endereço na de baixo, já no HTML. Assim, mesmo num cliente que ignora o `<style>`, um endereço só quebra se for mais largo que o cartão inteiro.

## Gerar, conferir e ver a prévia

```bash
npm run emails:build     # grava os .html, subjects.json e config-snippet.toml a partir do brand.json
npm run emails:check     # só confere: sai com erro se algum arquivo não bate com o gerador
npm run emails:preview   # grava preview.html (fora do Git) com valores fictícios
```

O CI roda `emails:check` no job **Qualidade**, então um `.html` editado à mão ou um `brand.json` alterado sem `emails:build` reprova o push. Não edite os `.html`: para mudar um texto ou o layout, edite `scripts/lib/auth-emails.mjs` e rode `npm run emails:build`. O gerador recusa uma variável que o Supabase não oferece naquele modelo (por exemplo, `{{ .ConfirmationURL }}` no código de verificação), e o teste `scripts/lib/auth-emails.test.mjs`, que roda no `npm test`, confere:

- só as variáveis permitidas em cada modelo, pela tabela "Terminology" da documentação do Supabase, e as obrigatórias: `{{ .ConfirmationURL }}` nos de link, `{{ .Token }}` no código de verificação, `{{ .NewEmail }}` na troca de e-mail, `{{ .OldEmail }}` e `{{ .Email }}` no aviso de e-mail alterado;
- o rótulo de cada endereço: "E-mail atual" com `{{ .Email }}` e "Novo e-mail" com `{{ .NewEmail }}`, "Antes" com `{{ .OldEmail }}` e "Agora" com `{{ .Email }}`;
- os cabeçalhos e o `content_path` do `config-snippet.toml`, por uma lista copiada da documentação do Supabase;
- nenhum comentário HTML, `<script>`, `<form>` ou `<iframe>`, nenhum recurso remoto além do logo, `lang="pt-BR"`, `<title>` igual ao assunto, título terminado em pontuação, texto de pelo menos 12 px e menos de 100 KB por modelo (o Gmail corta mensagens acima de cerca de 102 KB);
- os valores da marca escapados no HTML, no TOML e no JSON, e o logo do programa recusado com outra marca;
- a caixa do código de verificação pelo estilo da própria célula de `{{ .Token }}`: de 6 a 10 dígitos, ela cabe nos 238 px úteis do cartão numa tela de 320 px (320 − 2 × 12 de margem − 2 × 28 de respiro − 2 × 1 de borda) e não quebra;
- as palavras com hífen ("e-mail") protegidas contra quebra no hífen, inclusive no fim da frase, e os endereços de e-mail livres para quebrar em qualquer ponto, inclusive um `supportEmail` longo e sem hífen;
- no `invite.html`, o aviso antes do botão, com o nome do botão da tela do CRM ("Criar espaço de trabalho", conferido em `src/components/workspace/WorkspaceSetup.tsx`);
- o contraste AA das cores do DS usadas em texto e o fundo opaco de `public/brand/eia-email.png`.

A prévia simula o que o Supabase envia, trocando cada variável por um exemplo (`pessoa@exemplo.com.br`, código `48203917` e links que não funcionam). Os links de exemplo usam o domínio do Auth do projeto (`https://<ref>.supabase.co/auth/v1/verify?...`), como no e-mail real; o logo com caminho abre o arquivo de `public/`.

## Aplicar no painel

No projeto hospedado, os modelos são aplicados pelo painel. **O painel só deixa editar os modelos depois de configurar um SMTP próprio**, em **Authentication → Emails → SMTP Settings**. Com o envio padrão do Supabase, o projeto continua com os e-mails em inglês.

1. Configure o SMTP próprio (ver [Antes de usar com clientes](#antes-de-usar-com-clientes)) e confira a **Site URL** em **Authentication → URL Configuration**: o logo vem dela. Com um `logoUrl` que começa com `/`, abra a Site URL seguida desse caminho (como `<SUA_URL>/brand/logo-email.png`) no navegador e confira que a imagem aparece.
2. Em **Authentication → Sign In / Providers → Email**, confira **Email OTP Expiration**, **Email OTP Length** e **Secure email change**. Se forem diferentes de `linkExpiry`, `codeLength` e `secureEmailChange` no `brand.json`, ajuste o arquivo e rode `npm run emails:build` antes de continuar.
3. Em **Authentication → Emails → Templates**, abra cada modelo da tabela acima, cole o assunto de `subjects.json` e substitua todo o corpo pelo conteúdo do `.html` correspondente. Salve.
4. Nas notificações de segurança, ligue **Password changed** e **Email address changed** antes de colar o assunto e o corpo. Elas só são enviadas ligadas.
5. Teste os fluxos reais com um endereço de teste: "Esqueceu a senha?" (`recovery.html`), "Link por e-mail" com uma conta existente (`magic_link.html`) e com um e-mail novo (`confirmation.html`), um cadastro novo (`confirmation.html`) e a senha nova em `/reset-password` (aviso de senha alterada).

Cole o arquivo inteiro e não altere as variáveis (`{{ .ConfirmationURL }}`, `{{ .SiteURL }}`, `{{ .Token }}`, `{{ .Email }}`, `{{ .NewEmail }}`, `{{ .OldEmail }}`), inclusive dentro de `href="mailto:..."` e do `src` do logo. Depois de mudar o `brand.json`, repita os passos 3 e 4: o painel guarda uma cópia, que não acompanha o repositório.

## Ambiente local (config.toml)

`config-snippet.toml` traz os oito modelos no formato do Supabase CLI e fica fora do `supabase/config.toml` de propósito. Para usá-los num Supabase local, com o Docker Desktop aberto, cole os blocos no `config.toml` e rode, um de cada vez:

```bash
npx supabase stop
npx supabase start
```

O CLI lê o `content_path` dos modelos de Auth a partir da raiz do repositório (`./supabase/templates/...`) e o das notificações a partir da pasta `supabase/` (`./templates/...`), como nos exemplos da documentação oficial; as notificações levam `enabled = true`.

**Não use `supabase config push` no projeto hospedado** enquanto o `config.toml` não espelhar toda a configuração de Auth do painel: `site_url`, `additional_redirect_urls`, `enable_signup`, `[auth.email] enable_confirmations = true`, `double_confirm_changes`, `secure_password_change`, `otp_expiry`, `otp_length`, `max_frequency` e SMTP. O push compara a seção `[auth]` inteira com os padrões do CLI e pode, por exemplo, desligar a confirmação de e-mail (o padrão do CLI é `enable_confirmations = false`) ou trocar a Site URL pelo endereço local. A configuração completa do Auth no `config.toml` é outra parte do item 1.3 do [roteiro](../../docs/ROADMAP-FINALIZACAO.md).

## Antes de usar com clientes

- **SMTP próprio.** O envio padrão do Supabase só entrega para os endereços da equipe do projeto, tem limite baixo de mensagens por hora e mostra o remetente "Supabase Auth". Configure um SMTP com remetente do domínio da empresa (por exemplo, `CRM <acesso@suaempresa.com.br>`) e SPF, DKIM e DMARC no domínio. Desligue o rastreamento de cliques no provedor: ele reescreve os links e quebra a confirmação.
- **Domínio dos links.** O botão e o endereço "copie e cole" apontam para o Auth do projeto (`https://<SEU_PROJECT_REF>.supabase.co/auth/v1/verify?...`), que depois leva a `<SUA_URL>`, e não direto para o site. Para mostrar um domínio próprio, configure um domínio personalizado no Supabase.
- **Scanners de link.** Filtros corporativos, como o Safe Links do Microsoft Defender, podem abrir o link antes da pessoa e consumi-lo. Ela vê então "Este link é inválido ou expirou" (em `/reset-password`) ou volta à tela de entrada sem sessão. A saída é pedir um link novo; a solução definitiva (digitar um código numa tela do CRM, com `verifyOtp`) não existe hoje.
- **Confirmação expirada.** O e-mail de confirmação orienta a pedir outro link em "Link por e-mail", que reenvia a confirmação sem mudar a conta. Um segundo cadastro com o mesmo e-mail também reenviaria, mas o Supabase não grava a senha nova de uma conta ainda não confirmada: a pessoa confirmaria achando que a senha é a nova.
- **Outlook para Windows.** O Supabase processa os modelos com o `html/template` do Go, que remove comentários HTML; por isso o layout não usa comentários condicionais `<!--[if mso]>` nem VML. O Outlook usa a largura fixa de 600 px (atributo `width`), mostra cantos retos e a faixa em verde-escuro sólido (`#10251a`), sem degradê, e só o texto do botão é clicável. Os demais clientes reduzem até 320 px, mesmo sem ler o `<style>`.
- **Gmail.** Os endereços em destaque ficam num link `mailto:` com estilo próprio, para o Gmail não os transformar em links azuis.
- **Texto simples e tema escuro.** O Supabase Auth envia só a parte HTML: não há versão `.txt`. Os modelos pedem tema claro fixo (`color-scheme: light only`), mas alguns aplicativos, como o Gmail e o Outlook no celular, ainda escurecem o fundo e os textos. O logo tem fundo opaco para continuar legível nesses casos (ver [Logo](#logo)).
- **Convite pelo painel.** O "Invite user" cria a conta no Auth, mas não coloca a pessoa na equipe do CRM: depois de ativar a conta, ela cai na tela de criar um espaço novo, e nada impede que crie uma segunda organização. Prefira o convite do próprio CRM (**Equipe → Convidar uma pessoa → Criar convite**) e envie o link à pessoa: ao abri-lo, ela cria a conta com o e-mail convidado, confirma o e-mail e aceita o convite, sem passar pela tela de espaço novo. Se usar o painel, mande também o link de convite do CRM: o e-mail `invite.html` avisa, antes do botão "Ativar conta", que é preciso abrir esse link e pede para não usar o botão "Criar espaço de trabalho" da tela que aparece depois da ativação. A faixa do e-mail diz "Ativação de conta", e não "Convite", para não ser confundida com o link de convite do CRM.

## Modelos que ficam de fora

O Supabase tem mais cinco notificações de segurança. O CRM entra só com e-mail e senha, sem telefone, login social ou verificação em duas etapas, então nenhuma delas é enviada:

| Notificação | Por que fica de fora |
| --- | --- |
| Phone number changed | O CRM não usa telefone para entrar. |
| Sign-in method linked (`identity_linked`) | Não há login com Google ou outros provedores. |
| Sign-in method removed (`identity_unlinked`) | Idem. |
| Verification method added (`mfa_factor_enrolled`) | O CRM não tem verificação em duas etapas (MFA). |
| Verification method removed (`mfa_factor_unenrolled`) | Idem. |

Se uma instância passar a usar um desses recursos, inclua o modelo em `scripts/lib/auth-emails.mjs` com as variáveis próprias (`{{ .Phone }}` e `{{ .OldPhone }}`, `{{ .Provider }}` ou `{{ .FactorType }}`), acrescente-as à lista do teste e rode `npm run emails:build`.
