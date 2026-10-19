# Modelos de e-mail do acesso (Supabase Auth)

Os e-mails automáticos de cadastro, convite, acesso por link, troca de e-mail, redefinição de senha, código de verificação e avisos de segurança, em pt-BR e com o Design System Empreende.IA V2 para e-mail: logo no topo, fundo claro fixo, largura de 600 px, faixa escura com o título, cartão branco com borda, ponto esmeralda pontual, botão sólido e texto escondido de pré-visualização (preheader). Eles não carregam fontes remotas, rastreadores, JavaScript nem formulários; a única imagem é o logo.

Os modelos são **gerados**: desde o item 1.6, a marca é a da instância, em [`public/brand/brand.json`](../../public/brand/brand.json) (a mesma do app: nome, slogan, suporte, logo dos e-mails e crédito), e, desde o item 1.3, as opções do Auth citadas nos textos vêm de [`supabase/config.toml`](../config.toml) (`otp_expiry`, `otp_length` e `double_confirm_changes`, na tabela `[auth.email]`), o mesmo arquivo que configura o Auth da instância. O comando `npm run emails:build` produz os `.html`, os assuntos e os blocos dos modelos dentro do `config.toml`. Para trocar a marca, ninguém precisa editar HTML: siga [Trocar a marca do CRM](../../docs/MARCA.md).

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `confirmation.html` … `email_changed_notification.html` | Os oito modelos, gerados. Vão para o Supabase pelo `npm run config:push` ou pelo painel. |
| `subjects.json` | O assunto de cada modelo, gerado. |
| `preview.html` | Prévia com valores fictícios, gerada por `npm run emails:preview`. Fica fora do Git. |

Nenhum arquivo desta pasta é para editar. Os blocos dos modelos no formato do Supabase CLI ficam no próprio [`supabase/config.toml`](../config.toml), entre as marcas `# >>> Modelos de e-mail do Auth` e `# <<< Modelos de e-mail do Auth`, também gerados. O `config-snippet.toml` e o `email-settings.json` saíram no item 1.3: o `emails:build` recusa o `email-settings.json` antigo e diz para onde foi cada campo, e o `emails:check` aponta um `config-snippet.toml` que sobrou.

O gerador é [`scripts/build-auth-emails.mjs`](../../scripts/build-auth-emails.mjs). O layout comum, os textos de cada modelo e a lista de variáveis permitidas ficam em [`scripts/lib/auth-emails.mjs`](../../scripts/lib/auth-emails.mjs), e o teste em [`scripts/lib/auth-emails.test.mjs`](../../scripts/lib/auth-emails.test.mjs).

| Arquivo | Modelo no painel | Quando o Supabase envia |
| --- | --- | --- |
| `confirmation.html` | Confirm sign up | Primeiro acesso de um e-mail sem conta, com a confirmação de e-mail ligada: cadastro pela aba "Cadastrar" (nome e e-mail; a senha é criada no CRM depois da confirmação) ou pedido pela aba "Link por e-mail" da tela de entrada. O link abre a raiz do CRM com `?invite=` e `?next=` e o token depois do `#`; o CRM só o usa quando a pessoa aperta **Continuar** (ver [Scanners de link](#antes-de-usar-com-clientes)) e pede, então, que ela crie a senha antes do aceite ou da criação da empresa. O e-mail traz também o código, que a pessoa pode digitar no aviso de link enviado. Um novo pedido de link para uma conta ainda não confirmada reenvia esta confirmação. Com a empresa criada, só um e-mail com convite pendente do CRM cria conta (item 1.1). |
| `invite.html` | Invite user | Convite feito pelo painel do Supabase. Ele cria a conta, mas não coloca a pessoa na equipe (ver [Convite pelo painel](#antes-de-usar-com-clientes)). Os convites da equipe são feitos no CRM, em **Equipe → Convidar uma pessoa → Criar convite**, com o link de convite (`<SUA_URL>/?invite=…`, copiado em "Copiar link") e sem este e-mail. Com a empresa criada, o painel só cria a conta de quem já tem convite no CRM. |
| `magic_link.html` | Magic link | Aba "Link por e-mail" da tela de entrada, para quem já tem conta confirmada. Como a confirmação, leva ao CRM, que pede **Continuar**, e traz o código. Também sai pela aba "Cadastrar" quando o e-mail já tem conta confirmada (a tela responde como a um cadastro novo, sem dizer que a conta existe) e pelo botão **Enviar link para o meu e-mail** (ou **Enviar de novo**) da conta sem organização que precisa provar o e-mail antes do aceite do convite ou da criação da empresa. Com a empresa criada e sem convite, o pedido de um e-mail sem conta é recusado. |
| `email_change.html` | Change email address | Troca do e-mail de acesso pedida por quem está conectado (`updateUser` com `email`). O CRM não tem tela para isso, mas o pedido pode ser feito pela API. Numa conta que já está na empresa, a troca vale; numa conta sem organização, o banco recusa o pedido e a conclusão (reforço do item 1.1, gatilho `refuse_email_change_without_org`), mas o Auth envia este e-mail antes de gravar o pedido, então ele pode chegar com um link que não funciona. Com "Secure email change" ligado, vai para o endereço atual e para o novo. |
| `recovery.html` | Reset password | Botão "Esqueceu a senha?". O link abre `/reset-password`, que pede **Continuar** e depois a senha nova. |
| `reauthentication.html` | Reauthentication | Código para confirmar uma alteração sensível, enviado só quando o app chama `supabase.auth.reauthenticate()`. **O CRM não envia este e-mail hoje**: não faz essa chamada nem tem campo para o código. O modelo fica pronto para quando houver. |
| `password_changed_notification.html` | Password changed | Aviso depois que a pessoa troca a própria senha, como em `/reset-password`, e também quando cria a primeira senha em **Crie sua senha**, no aceite do convite ou na criação da empresa: o Auth manda o aviso em toda gravação de senha. Por isso o texto diz "criada ou alterada". Só com a notificação ligada. |
| `email_changed_notification.html` | Email address changed | Aviso depois que uma troca de e-mail pedida por quem está conectado é confirmada. Vai para o endereço **antigo**. O CRM não tem tela de troca de e-mail: sai só se a troca for feita pela API, numa conta que já está na empresa. Só com a notificação ligada. |

**Secure password change** não envia o código de verificação. Ligada no painel, ela faz a troca de senha (`updateUser` com `password`) exigir esse código (o `nonce`) quando a sessão tem mais de 24 horas, e o CRM não tem campo para ele. Pelo link de "Esqueceu a senha?" a sessão é nova e a redefinição continua funcionando, mas quem abrir `/reset-password` com uma sessão antiga recebe um erro. Por isso a opção fica desligada.

## Trocar a marca

A marca dos e-mails é a da instância, em `public/brand/brand.json`, e o passo a passo completo (imagens, `brand.json`, conferência e publicação) está em [Trocar a marca do CRM](../../docs/MARCA.md). Para os e-mails:

1. Edite `public/brand/brand.json` (os campos que os e-mails usam estão abaixo). Mantenha as aspas e as vírgulas; chaves que começam com `_` são comentários. A validade do link, o tamanho do código e a troca segura de e-mail não são marca: ficam no `supabase/config.toml` (tabela abaixo) e raramente mudam.
2. Rode `npm run emails:build`. O comando recusa valores inválidos, diz qual arquivo e qual campo corrigir e recusa os arquivos antigos `supabase/templates/brand.json` (até o item 1.6) e `supabase/templates/email-settings.json` (até o item 1.3), explicando para onde foi cada campo.
3. Rode `npm run emails:preview` e abra `supabase/templates/preview.html` no navegador para revisar os oito modelos em 640, 375 e 320 px de largura.
4. Faça commit do `brand.json`, dos arquivos gerados (os `.html`, o `subjects.json` e o `supabase/config.toml`, com a região dos modelos) e, com logo próprio, do PNG em `public/brand/` (por exemplo, `public/brand/logo-email.png`), que não é gerado.
5. Com logo próprio, publique o frontend de novo (o push para a Vercel faz isso) e abra `<SUA_URL>/brand/logo-email.png` no navegador. Os e-mails buscam o logo no site publicado: se o endereço não abrir a imagem, todos saem com a imagem quebrada. O `emails:build` e a prévia não confirmam isso, porque só olham o arquivo na sua máquina.
6. Aplique os modelos no Supabase: [`npm run config:push`](#aplicar-pelo-npm-run-configpush-recomendado) ou [o painel](#aplicar-no-painel).

Os e-mails nunca leem variáveis de ambiente: o `emails:check` depende só de arquivos versionados e dá o mesmo resultado na sua máquina e no CI.

A coluna "No repositório" mostra o valor versionado (a marca do programa e a configuração do projeto de desenvolvimento). A coluna "Sem o campo" mostra o que o gerador usa quando a linha é apagada.

Campos da marca usados nos e-mails (`public/brand/brand.json`; os demais estão em [Trocar a marca do CRM](../../docs/MARCA.md#1-o-que-muda-e-onde)):

| Campo | No repositório | Sem o campo | O que muda |
| --- | --- | --- | --- |
| `productName` | `Empreende.IA · CRM` | obrigatório | Texto alternativo do logo (ou o nome no topo, sem logo) e assinatura do rodapé. Até 60 caracteres. |
| `shortName` | `Empreende.IA · CRM` | o `productName` | Final de cada assunto, como em "Redefina sua senha · Empreende.IA · CRM". O assunto também é o título da página do e-mail. Até 40 caracteres. |
| `tagline` | `Relacionamentos que fazem o negócio crescer.` | `""` | Slogan abaixo do nome no rodapé. `""` não mostra. |
| `supportEmail` | `""` | `""` | Com um endereço, o rodapé ganha "Precisa de ajuda? Escreva para …", e os avisos de segurança o indicam. É o mesmo endereço de "Falar com suporte" no app. |
| `emailLogo` | `eia-email.png` | `""` | Logo do topo: o nome de um arquivo de `public/brand` (PNG, JPG ou GIF), que o e-mail busca em `{{ .SiteURL }}/brand/<arquivo>`, completado pelo Supabase com a Site URL do projeto no envio. Também aceita um endereço `https://` completo. `""` mostra o `productName` em texto. Ver [Logo](#logo). |
| `emailLogoWidth` | `185` | `185` | Largura do logo em pixels, de 40 a 300. A altura acompanha a proporção da imagem. |
| `showBaseCredit` | `true` | `true` | Crédito discreto "Feito com Empreende.IA" no rodapé, quando a marca é outra (decisão D3). Use `false` ao revender com marca própria. |

Opções do Auth citadas nos e-mails (`supabase/config.toml`, tabela `[auth.email]`). São as mesmas que o `npm run config:push` aplica no Supabase, então o texto dos e-mails e o comportamento do Auth nunca ficam diferentes; o `config:check` recusa um valor fora da faixa. Depois de mudar uma delas, rode `npm run emails:build` e aplique de novo:

| Chave | No repositório | Faixa | O que muda |
| --- | --- | --- | --- |
| `otp_expiry` | `3600` | de 60 a 86400 segundos, em minutos inteiros | Validade do link e do código, escrita nos e-mails por extenso: 3600 = "1 hora", 900 = "15 minutos", 5400 = "1 hora e 30 minutos". |
| `otp_length` | `8` | de 6 a 10 | Dígitos do código de verificação. Dimensiona a caixa do código para caber em 320 px. |
| `double_confirm_changes` | `true` | `true` ou `false` | Troca segura de e-mail. Com `true`, o e-mail de troca explica que a confirmação foi para os dois endereços. |

### Logo

- **Marca do programa.** O padrão é `"emailLogo": "eia-email.png"`, o arquivo [`public/brand/eia-email.png`](../../public/brand/eia-email.png) que o build do frontend publica. Ele é o `eia-email-2x.png` do kit do DS (960 × 208, rasterizado do SVG oficial com a fonte Sora e o ponto esmeralda, exibido a 185 px), composto sobre o fundo `#f4f7f5` do e-mail. O PNG de 480 × 104 de `public/brand/` no repositório do DS saiu sem a fonte Sora e não foi usado.
- **Site URL.** O logo só aparece depois que a **Site URL** do Auth (Authentication → URL Configuration) aponta para o frontend publicado, sem barra no final, como `https://crm.suaempresa.com.br`. Enquanto ela for `http://localhost:3000`, o cliente de e-mail não acha a imagem e mostra o texto alternativo, que é o `productName`. O `{{ .SiteURL }}` dos avisos de segurança exige o Supabase Auth v2.190.0 ou mais novo (junho de 2026), que os projetos hospedados já usam; numa versão anterior, esses dois avisos saem com o texto alternativo no lugar do logo.
- **Marca própria.** Com outro nome, o `eia-email.png` é recusado pelo `emails:build` (e pelo `brand:check`, pelo `dev` e pelo `build`): o topo mostraria a Empreende.IA e o rodapé a empresa. Coloque o PNG da empresa em `public/brand/` (por exemplo, `public/brand/logo-email.png`, com o dobro da largura exibida, para telas de alta densidade), use `"emailLogo": "logo-email.png"` e ajuste `emailLogoWidth`. O comando confere que o arquivo existe em `public/brand` na sua máquina, com o nome exato; o e-mail busca a imagem no site publicado. Antes de aplicar os modelos (`npm run config:push` ou o painel), faça commit do PNG, publique o frontend de novo e confira que `<SUA_URL>/brand/logo-email.png` abre a imagem no navegador. Ao trocar a imagem mais tarde, use um nome de arquivo novo (como `logo-email-2.png`): os clientes de e-mail, como o proxy de imagens do Gmail, guardam a imagem pelo endereço. Sem logo, use `""`: o topo mostra o nome em texto simples, sem imitar um logotipo.
- **Fundo opaco.** Use um PNG ou JPG com fundo opaco na cor `#f4f7f5`, não transparente. Alguns aplicativos (Gmail e Outlook no celular, Outlook.com e o Outlook novo) escurecem o fundo do e-mail, mas não a imagem: um logo escuro sobre fundo transparente quase desaparece. Com o fundo opaco, ele aparece numa placa clara.
- **Sem SVG nem caminho relativo.** E-mail não aceita SVG, e o caminho só funciona porque o Supabase o transforma em endereço completo. Muitos clientes só mostram imagens depois que a pessoa libera, por isso o texto alternativo do logo é o `productName`.

### Outras decisões

- **Crédito (D3).** O crédito só aparece quando a marca não é a do programa: se o `productName` já contém "Empreende.IA" (ou "Empreende IA"), ele repetiria a marca e fica de fora. O `shortName` e o `exportName` precisam concordar com o `productName`: com outro nome, "Empreende.IA · CRM" no `shortName` ou "empreende-ia" no `exportName` reprovam o `emails:build`, como os arquivos do programa. O padrão do repositório, portanto, não mostra o crédito. Com outra marca, os e-mails seguem só o `showBaseCredit` do `brand.json`; a variável `VITE_SHOW_BASE_CREDIT` muda só o app daquela implantação, e o `npm run brand:check` mostra quando os dois ficam diferentes ([Trocar a marca do CRM](../../docs/MARCA.md#10-o-crédito-feito-com-empreendeia)).
- **Nome no meio das frases.** Os textos dizem "o CRM" em vez do nome da marca, para não errar a concordância ("no", "na", "ao") com qualquer nome que a empresa escolher. A marca aparece no logo, no assunto e no rodapé.
- **Link que só vale depois de "Continuar", e o código.** Os modelos de confirmação, link de acesso, redefinição de senha e "Invite user" levam ao CRM, e não ao Auth: `{{ .RedirectTo }}#token_hash={{ .TokenHash }}&type=<tipo>` (`email`, `recovery` ou `invite`). O CRM mostra **Continuar** e só confere o token (`verifyOtp`) nesse momento (`src/components/workspace/EmailLinkGate.tsx`), então um filtro de segurança que abre o link antes da pessoa não o gasta (revisão de 13/10/2026; [desenho](../../docs/arquitetura/1.1.md#1621-revisão-de-13102026-rodada-3)). A confirmação e o link de acesso trazem também o código `{{ .Token }}`, que a pessoa digita no aviso de link enviado (`src/components/workspace/EmailCodeForm.tsx`), também quando abriu o e-mail em outro aparelho. O link e o código são o mesmo token: usar um gasta o outro. A troca de e-mail continua com `{{ .ConfirmationURL }}`.
- **Endereços empilhados.** Nas linhas de detalhe, o rótulo ("Conta", "Novo e-mail") fica numa linha e o endereço na de baixo, já no HTML. Assim, mesmo num cliente que ignora o `<style>`, um endereço só quebra se for mais largo que o cartão inteiro.

## Gerar, conferir e ver a prévia

```bash
npm run emails:build     # grava os .html, subjects.json e a região dos modelos no supabase/config.toml
npm run emails:check     # só confere: sai com erro se algum arquivo ou a região não bate com o gerador
npm run emails:preview   # grava preview.html (fora do Git) com valores fictícios
```

O CI roda `emails:check` no job **Qualidade**, então um `.html` ou a região do `config.toml` editados à mão, ou um `public/brand/brand.json` ou uma opção de `[auth.email]` alterados sem `emails:build`, reprovam o push. Não edite os `.html`: para mudar um texto ou o layout, edite `scripts/lib/auth-emails.mjs` e rode `npm run emails:build`. O gerador recusa uma variável que o Supabase não oferece naquele modelo (por exemplo, `{{ .ConfirmationURL }}` no código de verificação), e o teste `scripts/lib/auth-emails.test.mjs`, que roda no `npm test`, confere:

- só as variáveis permitidas em cada modelo, pela tabela "Terminology" da documentação do Supabase, e as obrigatórias: `{{ .RedirectTo }}` e `{{ .TokenHash }}` nos links que voltam ao CRM (com o tipo aceito por `src/lib/email-link.ts` e sem `{{ .ConfirmationURL }}`), `{{ .Token }}` na confirmação, no link de acesso e no código de verificação, `{{ .ConfirmationURL }}` na troca de e-mail, `{{ .NewEmail }}` na troca de e-mail, `{{ .OldEmail }}` e `{{ .Email }}` no aviso de e-mail alterado;
- o rótulo de cada endereço: "E-mail atual" com `{{ .Email }}` e "Novo e-mail" com `{{ .NewEmail }}`, "Antes" com `{{ .OldEmail }}` e "Agora" com `{{ .Email }}`;
- os cabeçalhos e o `content_path` da região dos modelos no `supabase/config.toml`, por uma lista copiada da documentação do Supabase, lidos de volta pelo leitor do `config:check`;
- a validade escrita a partir de `otp_expiry` (minutos e horas por extenso) e a recusa dos arquivos antigos `brand.json` e `email-settings.json`;
- nenhum comentário HTML, `<script>`, `<form>` ou `<iframe>`, nenhum recurso remoto além do logo, `lang="pt-BR"`, `<title>` igual ao assunto, título terminado em pontuação, texto de pelo menos 12 px e menos de 100 KB por modelo (o Gmail corta mensagens acima de cerca de 102 KB);
- os valores da marca escapados no HTML, no TOML e no JSON, o logo do programa recusado com outra marca, o `emailLogo` com nome de arquivo virando `{{ .SiteURL }}/brand/<arquivo>`, o arquivo antigo `supabase/templates/brand.json` recusado e nenhuma leitura de variável de ambiente (as regras da marca em si ficam em `scripts/lib/brand.test.mjs`);
- a caixa do código de verificação pelo estilo da própria célula de `{{ .Token }}`: de 6 a 10 dígitos, ela cabe nos 238 px úteis do cartão numa tela de 320 px (320 − 2 × 12 de margem − 2 × 28 de respiro − 2 × 1 de borda) e não quebra;
- as palavras com hífen ("e-mail") protegidas contra quebra no hífen, inclusive no fim da frase, e os endereços de e-mail livres para quebrar em qualquer ponto, inclusive um `supportEmail` longo e sem hífen;
- no `invite.html`, o aviso antes do botão, com o nome do botão das telas do CRM ("Recebi um convite", conferido em `src/components/workspace/ReceivedInvite.tsx`, usado pela tela de entrada e pela conta sem equipe), e nenhuma menção ao antigo "Criar espaço de trabalho";
- o contraste AA das cores do DS usadas em texto e o fundo opaco de `public/brand/eia-email.png`.

A Central de ajuda do CRM explica cada e-mail pelo assunto e pelo botão (pergunta "Que e-mails o CRM envia?", em [`src/components/help/faq-content.ts`](../../src/components/help/faq-content.ts)). Ao mudar o assunto ou o nome de um botão em `scripts/lib/auth-emails.mjs`, atualize também a resposta: `src/components/help/faq-content.test.ts` confere os assuntos de `subjects.json` e os nomes citados.

A prévia simula o que o Supabase envia, trocando cada variável por um exemplo (`pessoa@exemplo.com.br`, código `48203917` e links que não funcionam). Como no e-mail real, os links de cadastro, acesso, redefinição e ativação levam ao CRM (`https://crm.exemplo.com.br/…#token_hash=…`), e o da troca de e-mail, ao Auth do projeto (`https://<ref>.supabase.co/auth/v1/verify?...`); o logo com caminho abre o arquivo de `public/`.

## Aplicar pelo `npm run config:push` (recomendado)

Desde o item 1.3, o `supabase/config.toml` traz toda a configuração do Auth da instância, com os modelos, e o `npm run config:push` a aplica no projeto ligado: os oito modelos, os assuntos, as duas notificações ligadas, a Site URL, o retorno dos links, o SMTP e os valores de segurança. O passo a passo completo, com o `supabase/.env`, está em [Guia de implantação, etapa 9](../../docs/IMPLANTACAO.md#9-acesso-e-modelos-de-e-mail). Em resumo:

1. Copie `supabase/.env.example` para `supabase/.env` e preencha o endereço do CRM e o SMTP.
2. Rode `npm run config:check` e corrija até passar.
3. Rode `npm run config:push`, leia a diferença que o CLI mostra e responda **y** a cada serviço. Responda **n** se, nas linhas com `+` (o lado local da diferença, com as chaves deste arquivo), aparecer `enable_confirmations = false`, um `site_url` com `env(` ou um endereço inesperado. O push grava só `<SUA_URL>/**` como retorno e apaga as outras URLs de retorno do painel; depois dele, um link de e-mail pedido pelo `npm run dev` contra o projeto volta ao CRM publicado, e não ao `localhost` (para testar e-mails no computador, use o [Supabase local](#ambiente-local-configtoml)).
4. Não faça um cadastro de teste agora: os testes de envio do passo 5 de [Aplicar no painel](#aplicar-no-painel) ficam para depois do primeiro dono, com a conta dele ([Guia de implantação, etapa 11](../../docs/IMPLANTACAO.md#11-primeiro-dono-logo-depois-de-publicar)).

**Nunca rode `npx supabase config push` direto.** O CLI envia a seção `[auth]` inteira; uma variável de `supabase/.env` que falta só gera um aviso, e o texto `env(NOME)` vai como valor (a Site URL e todos os links dos e-mails quebrariam). O `npm run config:push` confere tudo antes e só então chama o CLI na versão analisada. A conferência também recusa uma tabela fora das deste arquivo (como `[remotes.*]` ou `[auth.hook.*]`) e uma variável `SUPABASE_<CAMINHO>` no ambiente ou num `.env` (como `SUPABASE_AUTH_EMAIL_ENABLE_CONFIRMATIONS`), que o CLI leria no lugar da chave.

## Aplicar no painel

Alternativa ao `config:push`, para quem não quer usar o Supabase CLI. **O painel só deixa editar os modelos depois de configurar um SMTP próprio**, em **Authentication → Emails → SMTP Settings**. Com o envio padrão do Supabase, o projeto continua com os e-mails em inglês. O painel guarda uma cópia de cada campo, que não acompanha o repositório: a cada mudança do `config.toml` ou da marca, repita os passos que mudaram.

1. Configure o SMTP próprio (ver [Antes de usar com clientes](#antes-de-usar-com-clientes)) e, em **Authentication → URL Configuration**, a **Site URL** (o endereço do CRM, sem barra no final) e, em **Redirect URLs**, o mesmo endereço seguido de `/**`. O logo vem da Site URL: com um `emailLogo` que é o nome de um arquivo, abra a Site URL seguida de `/brand/` e desse nome (como `<SUA_URL>/brand/logo-email.png`) no navegador e confira que a imagem aparece.
2. Confira os campos abaixo, que são os valores do `supabase/config.toml` (o teste `scripts/lib/supabase-config.test.mjs` confere esta lista contra o arquivo). Login social e telefone ficam desligados: o CRM só aceita e-mail e senha. Os nomes em negrito são os rótulos do painel, em inglês; o campo marcado "rótulo a confirmar no ensaio do 1.4" ainda não teve o rótulo conferido no painel e aparece descrito em português: procure-o pela descrição na tela indicada.

- Authentication → Sign In / Providers → **Allow new users to sign up**: ligado (`[auth] enable_signup = true`).
- Authentication → Sign In / Providers → **Allow anonymous sign-ins**: desligado (`[auth] enable_anonymous_sign_ins = false`).
- Authentication → Sign In / Providers → **Allow manual linking**: desligado (`[auth] enable_manual_linking = false`).
- Authentication → Sign In / Providers → Email → **Minimum password length**: 6 (`[auth] minimum_password_length = 6`).
- Authentication → Sign In / Providers → Email → **Password requirements**: No required characters (`[auth] password_requirements = ""`).
- Authentication → Rate Limits → **Rate limit for sending emails**: 100 por hora (`[auth.rate_limit] email_sent = 100`).
- Authentication → Sign In / Providers → Email → **Enable Email provider**: ligado (`[auth.email] enable_signup = true`).
- Authentication → Sign In / Providers → Email → **Confirm email**: ligado, e nunca desligue (`[auth.email] enable_confirmations = true`).
- Authentication → Sign In / Providers → Email → **Secure email change**: ligado (`[auth.email] double_confirm_changes = true`).
- Authentication → Sign In / Providers → Email → **Secure password change**: desligado (`[auth.email] secure_password_change = false`).
- Authentication → Rate Limits → **intervalo mínimo entre e-mails ao mesmo endereço**: 60 segundos (rótulo a confirmar no ensaio do 1.4) (`[auth.email] max_frequency = "60s"`).
- Authentication → Sign In / Providers → Email → **Email OTP Length**: 8 (`[auth.email] otp_length = 8`).
- Authentication → Sign In / Providers → Email → **Email OTP Expiration**: 3600 segundos (`[auth.email] otp_expiry = 3600`).
- Authentication → Emails → SMTP Settings → **Enable Custom SMTP**: ligado, com os dados do supabase/.env (`[auth.email.smtp] enabled = true`).
- Authentication → Sign In / Providers → Phone → **Enable Phone provider**: desligado (`[auth.sms] enable_signup = false`).
- Authentication → Multi-Factor → **TOTP (App Authenticator)**: desligado (`[auth.mfa.totp] enroll_enabled = false`).

3. Em **Authentication → Emails → Templates**, abra cada modelo da tabela acima, cole o assunto de `subjects.json` e substitua todo o corpo pelo conteúdo do `.html` correspondente. Salve. Copie o **código** do arquivo, não a página: abra o `.html` no VS Code ou, no Windows, clique com o botão direito → **Abrir com** → **Bloco de Notas**, use Ctrl+A e Ctrl+C e cole no campo do corpo. Copiar da página aberta no navegador cola só o texto, sem o layout e sem as variáveis dos links.
4. Nas notificações de segurança, ligue **Password changed** e **Email address changed** antes de colar o assunto e o corpo. Elas só são enviadas ligadas.
5. Teste os fluxos reais com a conta do dono, e não com um endereço de teste. **Numa instância sem empresa, qualquer cadastro, inclusive o "Link por e-mail" com um e-mail sem conta, cria a empresa e dá o papel de Dono a esse e-mail**; depois do primeiro dono, só entra conta com convite, e o cadastro ou o link para um e-mail sem conta falha. Por isso, os testes ficam para o primeiro dono ([Guia de implantação, etapa 11](../../docs/IMPLANTACAO.md#11-primeiro-dono-logo-depois-de-publicar)), nesta ordem:
   - o cadastro do próprio dono testa a confirmação (`confirmation.html`) e a primeira senha em **Crie sua senha** (o aviso de senha criada); no aviso de link enviado, digite o código do e-mail em vez de abrir o link, se quiser testar o código;
   - com a empresa criada, saia do CRM e peça o link em **Link por e-mail** com o e-mail do dono (`magic_link.html`);
   - saia de novo, use **Esqueceu a senha?** com o mesmo e-mail (`recovery.html`) e crie a senha nova em `/reset-password` (o aviso de senha alterada);
   - o cadastro de outra pessoa é testado por um convite do CRM, em **Equipe** (`invite.html`, [etapa 12 do guia](../../docs/IMPLANTACAO.md#12-equipe)).

   Confira que cada link abre o CRM com **Continuar** (e não entra sozinho). Se um cadastro de teste já criou a empresa, siga [Outra pessoa virou Dono](../../docs/IMPLANTACAO.md#outra-pessoa-virou-dono).

Cole o arquivo inteiro e não altere as variáveis (`{{ .ConfirmationURL }}`, `{{ .RedirectTo }}`, `{{ .TokenHash }}`, `{{ .SiteURL }}`, `{{ .Token }}`, `{{ .Email }}`, `{{ .NewEmail }}`, `{{ .OldEmail }}`), inclusive dentro de `href="mailto:..."`, do `src` do logo e do `#token_hash=…&type=…` dos links. Depois de mudar `public/brand/brand.json` ou uma opção de `[auth.email]` (e rodar `npm run emails:build`), repita os passos 2 a 4.

## Ambiente local (config.toml)

O mesmo `supabase/config.toml` serve a um Supabase local (Docker), fora do caminho da implantação: os modelos já estão nele, e não há bloco para colar. Crie `supabase/.env.local` com a Site URL `http://localhost:8080`, o retorno `http://localhost:8080/**` e o SMTP do Mailpit local (host `127.0.0.1`, porta `54325`, quaisquer usuário, senha, remetente e nome), como explica o fim de `supabase/.env.example`. Confira com `npm run config:check -- --local`, que aceita o endereço local e não serve ao push (o CLI lê o `supabase/.env.local` antes do `supabase/.env` também no push, então apague ou renomeie o arquivo antes de um `npm run config:push`; o check recusa enquanto ele existir), e rode, com o Docker Desktop aberto, um de cada vez:

```bash
npx supabase stop
npx supabase start
```

O CLI lê o `content_path` dos modelos de Auth a partir da raiz do repositório (`./supabase/templates/...`) e o das notificações a partir da pasta `supabase/` (`./templates/...`), como nos exemplos da documentação oficial; as notificações levam `enabled = true`. O CLI também lê o `supabase/.env.local` antes do `supabase/.env`: apague-o (ou rode o `config:check` sem `--local`, que recusa `localhost`) antes de um `config:push` no projeto hospedado.

## Antes de usar com clientes

- **SMTP próprio.** O envio padrão do Supabase só entrega para os endereços da equipe do projeto, tem limite baixo de mensagens por hora e mostra o remetente "Supabase Auth". Com SMTP próprio, o `config.toml` limita o projeto a 100 e-mails por hora (`[auth.rate_limit] email_sent`, dimensionado para uma equipe de 50 pessoas entrando na mesma hora); o limite diário do provedor vale antes. Configure um SMTP com remetente do domínio da empresa (por exemplo, `CRM <acesso@suaempresa.com.br>`) e SPF, DKIM e DMARC no domínio. Desligue o rastreamento de cliques no provedor: ele reescreve os links e quebra a confirmação.
- **Domínio dos links.** Desde a revisão de 13/10/2026, o botão e o endereço "copie e cole" da confirmação, do link de acesso, da redefinição de senha e do "Invite user" apontam para o próprio CRM, no endereço de retorno pedido (`{{ .RedirectTo }}`, por exemplo `<SUA_URL>/?invite=…#token_hash=…`). O Auth confere esse retorno na lista de URLs de retorno (**Authentication → URL Configuration**) e o troca pela Site URL quando ele não está nela: mantenha `<SUA_URL>/**` na lista. O e-mail de troca de e-mail continua apontando para o Auth do projeto (`https://<SEU_PROJECT_REF>.supabase.co/auth/v1/verify?...`).
- **Scanners de link.** Filtros corporativos, como o Safe Links do Microsoft Defender, abrem os links do e-mail antes da pessoa. Um link direto ao `GET /auth/v1/verify` do Auth (o `{{ .ConfirmationURL }}` dos modelos padrão do Supabase) é gasto nessa visita: o Auth confirma a conta e abre a sessão para o filtro, e a pessoa vê "O link expirou ou já foi usado" em todo link novo, inclusive no de "Esqueceu a senha?"; como a conta nasce pelo link, ela fica sem senha. Pedir outro link não resolve com um filtro que abre todos. Os modelos deste repositório resolvem (revisão de 13/10/2026): o link abre o CRM, que só o usa quando a pessoa aperta **Continuar**, e o código do e-mail é uma segunda via. Por isso, aplique-os antes de liberar o acesso. Com os modelos padrão, a saída provisória é a senha definida por quem administra ([Recuperar o acesso de dono](../../docs/RECUPERAR-ACESSO-DONO.md#pessoa-que-não-consegue-usar-nenhum-link-do-e-mail)).
- **Confirmação expirada.** O e-mail de confirmação orienta a pedir outro link em "Link por e-mail" (ou de novo em "Cadastrar"), que reenvia a confirmação sem mudar a conta. A senha só nasce depois da confirmação, no CRM: desde o reforço do item 1.1, qualquer senha gravada antes dela (por quem criou a conta com a API) é descartada no banco quando o link é aberto (`supabase/migrations/20261012110000_admission_email_proof.sql`).
- **Outlook para Windows.** O Supabase processa os modelos com o `html/template` do Go, que remove comentários HTML; por isso o layout não usa comentários condicionais `<!--[if mso]>` nem VML. O Outlook usa a largura fixa de 600 px (atributo `width`), mostra cantos retos e a faixa em verde-escuro sólido (`#10251a`), sem degradê, e só o texto do botão é clicável. Os demais clientes reduzem até 320 px, mesmo sem ler o `<style>`.
- **Gmail.** Os endereços em destaque ficam num link `mailto:` com estilo próprio, para o Gmail não os transformar em links azuis.
- **Texto simples e tema escuro.** O Supabase Auth envia só a parte HTML: não há versão `.txt`. Os modelos pedem tema claro fixo (`color-scheme: light only`), mas alguns aplicativos, como o Gmail e o Outlook no celular, ainda escurecem o fundo e os textos. O logo tem fundo opaco para continuar legível nesses casos (ver [Logo](#logo)).
- **Convite pelo painel.** O "Invite user" cria a conta no Auth, mas não coloca a pessoa na equipe do CRM. Desde o item 1.1 do roteiro, com a empresa criada, o banco só aceita conta nova de um e-mail com convite pendente do CRM: para os demais, o painel mostra "Database error saving new user". Prefira o convite do próprio CRM (**Equipe → Convidar uma pessoa → Criar convite**) e envie o link à pessoa: ao abri-lo, ela informa o e-mail convidado, abre o link de confirmação, cria a senha e aceita o convite. Se usar o painel, crie antes o convite no CRM e mande também o link dele: depois de ativar a conta, a pessoa cai na tela "Falta o convite da sua equipe", e o e-mail `invite.html` avisa, antes do botão "Ativar conta", que é preciso abrir esse link ou colá-lo em "Recebi um convite". Ativar a conta abre o CRM, que pede **Continuar** e abre a sessão do link; no aceite, o CRM pede que a pessoa crie a senha (a conta criada pelo painel não tem uma), e o e-mail diz que é com ela que a pessoa entra nas próximas vezes. A faixa do e-mail diz "Ativação de conta", e não "Convite", para não ser confundida com o link de convite do CRM.

## Modelos que ficam de fora

O Supabase tem mais cinco notificações de segurança. O CRM entra só com e-mail e senha, sem telefone, login social ou verificação em duas etapas, então nenhuma delas é enviada:

| Notificação | Por que fica de fora |
| --- | --- |
| Phone number changed | O CRM não usa telefone para entrar. |
| Sign-in method linked (`identity_linked`) | Não há login com Google ou outros provedores. |
| Sign-in method removed (`identity_unlinked`) | Idem. |
| Verification method added (`mfa_factor_enrolled`) | O CRM não tem verificação em duas etapas (MFA). |
| Verification method removed (`mfa_factor_unenrolled`) | Idem. |

Telefone, login social e verificação em duas etapas não se ligam só no `config.toml` nem só no painel: o `npm run config:check` recusa esses provedores ligados, e o código de outro canal não prova o e-mail que a admissão exige ([desenho do 1.1](../../docs/arquitetura/1.1.md)). Eles exigem uma mudança da base, que nenhum item do [roteiro](../../docs/ROADMAP-FINALIZACAO.md) planeja hoje (o item 1.8 só registra a regra nas instruções para IA: telefone, login social e verificação em duas etapas exigem mudar a prova do e-mail do 1.1), e só nessa mudança entram os modelos correspondentes no gerador (`scripts/lib/auth-emails.mjs`), com as variáveis próprias (`{{ .Phone }}` e `{{ .OldPhone }}`, `{{ .Provider }}` ou `{{ .FactorType }}`) e o teste.
