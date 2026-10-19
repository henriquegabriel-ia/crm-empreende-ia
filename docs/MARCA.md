# Trocar a marca do CRM

Este guia mostra como trocar o nome, o logo, o ícone e os demais itens da marca do CRM para a marca da empresa, sem editar código. Ele foi escrito para quem usa Windows e não é desenvolvedor; no macOS e no Linux os passos são os mesmos, com o terminal do sistema. O guia de implantação (`docs/IMPLANTACAO.md`, item 1.4 do [roteiro](ROADMAP-FINALIZACAO.md)) aponta para cá.

Tudo fica num lugar só: o arquivo `public/brand/brand.json` e as imagens da mesma pasta. O CRM lê esse arquivo ao ser publicado, e os e-mails de acesso (cadastro, convite, senha) são gerados a partir dele. O desenho técnico está em [docs/arquitetura/1.6.md](arquitetura/1.6.md).

## 1. O que muda e onde

| Campo do `brand.json` | Onde aparece | Sem o campo (ou com `""`) |
| --- | --- | --- |
| `productName` (obrigatório, até 60 caracteres) | Título da aba do navegador, prévia do link no WhatsApp, texto alternativo do logo, rodapé das telas de entrada e assinatura dos e-mails | — |
| `shortName` (até 40) | Final do assunto dos e-mails, como "Redefina sua senha · Acme CRM" | Usa o `productName` (que então precisa ter até 40) |
| `tagline` (até 120) | Linha de baixo do painel escuro da entrada (computador) e assinatura dos e-mails | A linha some |
| `supportEmail` | "Falar com suporte" na Ajuda do CRM, botão "Reportar" da tela de erro e rodapé dos e-mails | Nada de suporte aparece |
| `logoOnLight` | Logo sobre fundo claro (tema claro) | O nome aparece em texto no tema claro |
| `logoOnDark` | Logo sobre fundo escuro (tema escuro, que é o padrão, e painel da entrada) | O nome aparece em texto no tema escuro |
| `icon` | Menu recolhido, cabeçalho das telas no celular e ícone da aba | Uma letra (a primeira do nome) no menu; a aba fica com o ícone padrão do navegador |
| `favicon` | Ícone da aba, quando você quer um diferente do `icon` | Usa o `icon` |
| `authImage` | Arte do painel escuro da tela de entrada (computador) | O painel fica escuro, sem imagem |
| `emailLogo` | Topo dos e-mails de acesso | O nome aparece em texto no topo dos e-mails |
| `emailLogoWidth` (40 a 300) | Largura do logo nos e-mails, em pixels | 185 |
| `exportName` | Nome dos arquivos exportados: `contatos-acme.csv`, `agenda-acme.ics`, `oportunidades-acme-AAAA-MM-DD.csv` | Gerado a partir do `productName`; com `""`, os arquivos saem sem a marca (`contatos.csv`) |
| `showBaseCredit` (`true` ou `false`) | O crédito discreto "Feito com Empreende.IA" (seção 10) | `true` |

O nome da organização, em "Configurações → Organização", é outro: ele identifica a empresa nos dados do CRM e é mudado ali por donos e administradores. Ele não troca o nome nem o logo da entrada, da aba ou dos e-mails.

Cores, fontes e o texto das telas não fazem parte da marca: são personalização do código (item 1.8 do roteiro).

## 2. Antes de começar

- **Editor:** o VS Code (gratuito) ou o Bloco de Notas. No Bloco de Notas, salve sempre em UTF-8: **Arquivo → Salvar como → Codificação: UTF-8**. Um arquivo salvo em ANSI troca o "ç" e os acentos por `�`, e a conferência avisa.
- **Terminal:** o terminal do VS Code (**Terminal → Novo Terminal**, que abre o PowerShell na pasta do projeto). Se aparecer "a execução de scripts foi desabilitada neste sistema", use `npm.cmd` no lugar de `npm` nos comandos deste guia (por exemplo, `npm.cmd run brand:check`).
- **Extensões dos arquivos visíveis:** no Explorador de Arquivos, **Exibir → Mostrar → Extensões de nomes de arquivos**. Sem isso, um arquivo salvo como `logo.png.png` aparece como `logo.png`, e o CRM não o encontra.
- O projeto instalado com `npm ci`, como no [README](../README.md#desenvolvimento).

## 3. Prepare as imagens

| Imagem | Formato | Tamanho recomendado |
| --- | --- | --- |
| Logo para fundo claro (tinta escura) | SVG ou PNG com fundo transparente | Horizontal, perto de 4:1, com pelo menos 352 × 96 px |
| Logo para fundo escuro (tinta clara) | SVG ou PNG com fundo transparente | Igual ao anterior |
| Ícone | SVG ou PNG (ou WEBP) quadrado | 512 × 512 px |
| Logo dos e-mails | PNG (ou JPG, GIF) com fundo opaco `#f4f7f5` | O dobro da largura exibida, por exemplo 370 px de largura para 185 px |
| Arte da entrada (opcional) | JPG (ou PNG, WEBP), escura | 1600 × 900 px |

Regras que a conferência cobra:

- cada imagem com até **1 MB**;
- nome do arquivo só com letras sem acento, números, ponto, hífen e sublinhado, sem espaços: `logo-acme.svg`, e não `Logo Acme.svg`;
- o nome no `brand.json` exatamente igual ao do arquivo, com as mesmas maiúsculas. O Windows não diferencia `Logo.png` de `logo.png`, mas o site publicado diferencia, e a imagem quebraria só depois de publicar;
- SVG sem scripts, salvo em UTF-8 e sem conteúdo que um logo não usa (`<foreignObject>`, `<iframe>`, `<embed>`, `<object>` ou declarações `<!ENTITY>`): os programas de desenho exportam assim quando você escolhe "SVG simples" (Inkscape) ou **Exportar como → SVG** (Illustrator). Um SVG com texto que depende de uma fonte da internet aparece com a fonte do sistema: converta o texto em curvas (no Inkscape, **Caminho → Objeto para caminho**; no Figma, **Outline stroke**/**Flatten**) ou embuta a fonte.

O logo fica numa caixa de 176 × 48 px na entrada e de 128 × 36 px no menu: um logo quadrado ou muito alto fica pequeno. Sem uma versão de tinta clara, prefira `""` em `logoOnDark` (o nome aparece em texto no tema escuro) a usar o logo escuro nos dois campos, que sumiria sobre o fundo escuro.

## 4. Coloque as imagens em `public/brand`

Copie as imagens para a pasta `public\brand` do projeto pelo Explorador de Arquivos. **Não apague os arquivos `eia-*`**: eles são a marca padrão da base e as próximas versões da base contam com eles. Com outro `productName` no `brand.json`, a conferência recusa usar esses arquivos por engano.

## 5. Edite o `brand.json`

Abra `public\brand\brand.json`. **Apague todo o conteúdo e cole um dos exemplos abaixo**, trocando os valores pelos da empresa: o arquivo da base vem com os valores da Empreende.IA em `productName`, `shortName`, `tagline`, `exportName` e nas imagens, e trocar só o nome deixaria o resto para trás (se sobrar algum, a conferência da seção 6 aponta cada campo). Cada linha tem `"campo": valor`, e todas terminam com vírgula, **menos a última antes do `}`**. Textos e nomes de arquivo ficam entre aspas; `true`, `false` e números ficam sem aspas. Linhas que começam com `"_` são comentários.

Exemplo mínimo, só com o nome (sem imagens próprias ainda):

```json
{
  "productName": "Acme Vendas · CRM",
  "logoOnLight": "",
  "logoOnDark": "",
  "icon": "",
  "authImage": "",
  "emailLogo": ""
}
```

Exemplo completo:

```json
{
  "_leia": "Marca deste CRM (docs/MARCA.md).",
  "productName": "Acme Vendas · CRM",
  "shortName": "Acme CRM",
  "tagline": "Vendas organizadas, clientes por perto.",
  "supportEmail": "suporte@acme.com.br",
  "logoOnLight": "logo-acme-fundo-claro.svg",
  "logoOnDark": "logo-acme-fundo-escuro.svg",
  "icon": "icone-acme.svg",
  "favicon": "",
  "authImage": "arte-acme.jpg",
  "emailLogo": "logo-acme-email.png",
  "emailLogoWidth": 185,
  "exportName": "acme",
  "showBaseCredit": true
}
```

Um campo que você não escrever recebe o padrão da tabela da seção 1. Os campos de imagem nunca herdam as imagens da Empreende.IA: sem eles, o CRM mostra o nome em texto. Dê aos logos nomes pelo fundo em que ficam (`fundo-claro`, `fundo-escuro`), como os da base: "logo claro" costuma querer dizer a tinta clara, que é a do fundo escuro.

## 6. Confira com `npm run brand:check`

No terminal, na pasta do projeto:

```bash
npm run brand:check
```

A saída esperada é um resumo como este:

```
public/brand/brand.json: marca "Acme Vendas · CRM" válida.
  Aba do navegador: Acme Vendas · CRM (ícone icone-acme.svg)
  Logos: logo-acme-fundo-claro.svg (fundo claro) e logo-acme-fundo-escuro.svg (fundo escuro); ícone do menu: icone-acme.svg; arte da entrada: arte-acme.jpg
  Arquivos exportados: contatos-acme.csv, agenda-acme.ics e oportunidades-acme-AAAA-MM-DD.csv
  E-mail de suporte: suporte@acme.com.br (brand.json)
  Crédito "Feito com Empreende.IA": aparece no app e nos e-mails ("showBaseCredit": true)
  E-mails do Auth (supabase/templates/): desatualizados: rode npm run emails:build e aplique os modelos no painel (supabase/templates/README.md)
```

Com algum problema, o comando lista todos de uma vez, diz o campo e o que fazer, e termina com erro. Os mais comuns estão na seção 12. O `npm run dev` e o `npm run build` fazem a mesma conferência: com a marca inválida, o CRM não sobe nem é publicado.

## 7. Veja no navegador

```bash
npm run dev
```

Abra `http://localhost:8080`. Com o servidor aberto, salvar o `brand.json` ou trocar uma imagem reinicia o servidor sozinho; recarregue a página. Confira:

- a tela de entrada nos dois temas (o botão do sol e da lua, no canto);
- o menu expandido e recolhido;
- o modo celular: **F12**, depois o ícone de celular (**Alternar barra de dispositivos**), e recarregue;
- a aba do navegador, com o nome e o ícone.

Se o terminal mostrar a lista de problemas depois de salvar, o servidor anterior continua no ar até você corrigir o arquivo.

## 8. E-mails de acesso

Os e-mails de cadastro, convite, link de acesso e senha usam a mesma marca. Depois de trocar a marca:

```bash
npm run emails:build
npm run emails:preview
```

O primeiro grava os modelos em `supabase/templates/`; o segundo gera uma prévia para abrir no navegador. As opções do Supabase citadas nos textos (validade do link, tamanho do código e troca segura de e-mail) não são marca: desde o item 1.3, ficam em `supabase/config.toml` (`otp_expiry`, `otp_length` e `double_confirm_changes`, na tabela `[auth.email]`), o mesmo arquivo que o `npm run config:push` aplica no Supabase, então os textos e o Auth não ficam diferentes. O `emails:build` também grava os modelos nesse arquivo.

O logo dos e-mails é buscado no site publicado (`<SUA_URL>/brand/<arquivo>`). Por isso, a ordem é: **publicar o CRM, abrir `<SUA_URL>/brand/<emailLogo>` no navegador e só então aplicar os modelos (`npm run config:push` ou o painel)**, como explicam [Guia de implantação, etapa 9](IMPLANTACAO.md#9-acesso-e-modelos-de-e-mail) e [Modelos de e-mail do acesso](../supabase/templates/README.md#aplicar-no-painel). Ao trocar a imagem do logo dos e-mails mais tarde, use um nome de arquivo novo (por exemplo, `logo-acme-email-2.png`): os serviços de e-mail, como o Gmail, guardam a imagem pelo endereço.

## 9. Publique

1. Faça commit das imagens novas, do `brand.json` e dos arquivos gerados em `supabase/templates/`, pelo **Controle do Código-Fonte** do VS Code (o ícone de ramos, à esquerda) ou pelo GitHub Desktop, e envie (**Sync**/**Push**).
2. A Vercel publica sozinha a partir do repositório. Se a marca estiver inválida, a publicação falha com a mesma lista de problemas do `brand:check`, e a versão anterior continua no ar.
3. Abra o CRM publicado e use **Ctrl+F5** para recarregar sem o cache. O ícone da aba pode levar um pouco mais para trocar.
4. Aplique os modelos de e-mail no Supabase, com `npm run config:push` ou pelo painel (seção 8).

## 10. O crédito "Feito com Empreende.IA"

Quando a marca é de outra empresa, o CRM mostra um crédito discreto à base: "Feito com Empreende.IA", no rodapé das telas de entrada, no rodapé da "Ajuda do CRM" e no rodapé dos e-mails de acesso. Com a marca do programa, o crédito nunca aparece, porque repetiria a marca.

O crédito pode ser removido nos casos que a licença da base permite, como a revenda como SaaS com marca própria (decisões D3 e D4 do [roteiro](ROADMAP-FINALIZACAO.md#decisões); as regras ficam na licença do item 1.7b). Para remover:

- **no app e nos e-mails:** `"showBaseCredit": false` no `brand.json`, e rode `npm run emails:build`;
- **só no app de uma implantação:** a variável `VITE_SHOW_BASE_CREDIT` com `false` (ou `true`) nas variáveis de ambiente da hospedagem (na Vercel, **Settings → Environment Variables**) e publique de novo. Ela vale só para o app daquela implantação; os e-mails seguem o `brand.json`, e o `brand:check` mostra a diferença. Outro valor, como `nao`, faz a publicação falhar.

## 11. Várias empresas

Cada empresa já é uma instância separada: projeto Supabase, projeto na hospedagem e modelos de e-mail próprios. A marca acompanha o repositório da instância:

- **Uma empresa (o caso comum):** edite `public/brand/` no seu clone.
- **Agência com várias empresas, cada uma com a sua marca:** um branch por empresa (`empresa/acme`, `empresa/beta`) ou um fork por empresa. Na Vercel, cada projeto aponta o **Production Branch** (Settings → Git) para o branch da empresa. As atualizações da base entram no `main` e depois em cada branch. As imagens da empresa, com nomes próprios, não conflitam; dois lugares podem conflitar, e a solução é a mesma em todo branch:
  - **`public/brand/brand.json`:** como o arquivo da empresa substitui o da base inteiro, uma mudança da base nele (um comentário `_leia` novo, um campo novo) aparece como conflito. Fique com a versão da empresa e confira se a base acrescentou um campo: se acrescentou, copie a linha para o arquivo da empresa, com o valor da empresa (campo novo é sempre opcional).
  - **`supabase/templates/*.html` e `subjects.json`:** são gerados com a marca de cada empresa, e qualquer mudança do gerador na base conflita com eles. Aceite qualquer um dos lados e rode `npm run emails:build`, que refaz os arquivos com a marca do branch.
  - **`supabase/config.toml`:** só a região entre `# >>> Modelos de e-mail do Auth` e `# <<< Modelos de e-mail do Auth` é gerada (os assuntos levam a marca do branch). Um conflito dentro dessas marcas se resolve como os modelos: aceite qualquer um dos lados e rode `npm run emails:build`. Fora delas, o arquivo traz os valores de segurança, as variáveis `env()` e o que a empresa personalizou: resolva o conflito à mão, linha por linha, sem aceitar um lado inteiro.
  - Depois de resolver, rode `npm run brand:check`, `npm run emails:check` e `npm run config:check`. O passo a passo da atualização chega com o item 1.7b do [roteiro](ROADMAP-FINALIZACAO.md) (`docs/ATUALIZACAO.md`, ainda não publicado).
- **Agência com várias empresas: o `supabase/.env` e o projeto ligado não acompanham o branch.** O `supabase/.env` fica fora do Git, e o projeto ligado pelo `npx supabase link` fica gravado na pasta (`supabase/.temp/project-ref`). Com um clone só e um branch por empresa, um `npm run config:push` depois de trocar de branch enviaria o SMTP e a Site URL de uma empresa para o projeto Supabase de outra. Use um clone (uma pasta) por empresa, cada um com o seu `supabase/.env` e o seu `link`, ou refaça o `link` e o `supabase/.env` a cada troca de branch. Antes de cada push, confira a linha "Projeto ligado" e a Site URL no resumo do `npm run config:check`.
- **Revenda como SaaS com marca própria:** um branch com a marca do revendedor e `"showBaseCredit": false`, e vários projetos na hospedagem, cada um com o seu `VITE_SUPABASE_URL` e a sua chave.
- **Mesmo repositório, com e sem crédito:** `VITE_SHOW_BASE_CREDIT` na hospedagem de cada projeto.

Variáveis de ambiente para a marca inteira não existem de propósito: imagens não cabem numa variável, os e-mails gerados na sua máquina não enxergam as variáveis da hospedagem, e a marca sairia do histórico do Git.

## 12. Problemas comuns

| Mensagem (resumida) | O que fazer |
| --- | --- |
| `o arquivo não é um JSON válido` | Falta ou sobra uma vírgula ou uma aspa. Cada linha termina com vírgula, menos a última antes do `}`. A mensagem diz a posição do erro. |
| `"logoOnligth" não é um campo conhecido` | Erro de grafia no nome do campo. A mensagem lista os campos aceitos. |
| `tem caracteres trocados (�)` | O arquivo foi salvo fora do UTF-8. No Bloco de Notas: **Arquivo → Salvar como → Codificação: UTF-8**. |
| `o arquivo está salvo em UTF-16 (Unicode)` | O Bloco de Notas ("UTF-16 LE" ou "UTF-16 BE") ou o PowerShell 5.1 com `>` gravaram o `brand.json` (ou o `supabase/config.toml`) em UTF-16. Salve de novo: **Arquivo → Salvar como → Codificação: UTF-8**. |
| `o nome do arquivo só pode ter letras sem acento…` | Renomeie a imagem sem espaços nem acentos (por exemplo, `logo-acme.png`) e use o mesmo nome no campo. |
| `… não existe. Arquivos nesta pasta: …` | Confira o nome na lista. Um `logo.png.png` indica as extensões ocultas: ative-as no Explorador (seção 2) e renomeie. |
| `o arquivo na pasta se chama "Logo-Acme.png"` | Use o nome exatamente igual, com as mesmas maiúsculas. |
| `tem 3,4 MB; o limite é 1 MB` | Reduza a imagem (por exemplo, para 1600 × 900 px) ou exporte com mais compressão. |
| `tem script e foi recusado` | Exporte o SVG de novo, sem scripts (no Inkscape, como "SVG simples"). |
| `tem <foreignObject>, que um logo não usa` (ou `<iframe>`, `<embed>`, `<object>`, `<!ENTITY>`, `<?xml-stylesheet?>`, `uma instrução de processamento` ou `XSLT`) | Exporte o SVG de novo como SVG simples, só com o desenho. A declaração `<?xml version="1.0" encoding="UTF-8"?>` do começo do arquivo continua aceita. |
| `não é um SVG em texto UTF-8` | O arquivo foi salvo em UTF-16 ou compactado. Exporte o SVG de novo em UTF-8, o padrão dos programas de desenho. |
| `"shortName" ainda é o da Empreende.IA` ou `"exportName" ainda é o da Empreende.IA` | Você trocou o `productName`, mas o arquivo ainda tem os valores da base. Troque o campo pelo da empresa ou apague a linha (seção 5). |
| `"shortName" é "…", mas o "productName" ainda é o da Empreende.IA` | Troque também o `productName` pelo nome da empresa. |
| Aviso: `"tagline" ainda é o slogan da Empreende.IA` | Troque pelo slogan da empresa ou use `""` para tirar a linha. O aviso não impede a publicação. |
| `aponta para eia-…, o logo da Empreende.IA, mas a marca é outra` | Coloque a imagem da empresa na pasta e use o nome do arquivo, ou `""`. |
| `"emailLogo" precisa ser uma imagem PNG, JPG ou GIF…` | E-mail não aceita SVG: use um PNG com fundo opaco. |
| `"shortName" ficou com o productName, que passa de 40 caracteres` | Escreva um `shortName` curto para os assuntos dos e-mails. |
| `VITE_SHOW_BASE_CREDIT é "nao"` | Use `true` ou `false`, ou apague a variável na hospedagem ou no `.env.local`. |
| `Modelos de e-mail fora de dia` (no `emails:check`) | Rode `npm run emails:build` e faça commit dos arquivos gerados. |

## 13. Atualizar de uma versão anterior

Até o item 1.6, a marca dos e-mails ficava em `supabase/templates/brand.json`, e o e-mail de suporte do app, na variável `VITE_SUPPORT_EMAIL`. Até o item 1.3, as opções do Auth citadas nos e-mails ficavam em `supabase/templates/email-settings.json`.

- **`supabase/templates/brand.json` antigo:** o `npm run emails:build` recusa o arquivo e diz para onde foi cada campo. Passe `productName`, `shortName`, `tagline`, `supportEmail` e `showBaseCredit` para `public/brand/brand.json` com os mesmos nomes; `logoUrl` vira `emailLogo`, só com o nome do arquivo (`"/brand/logo.png"` vira `"logo.png"`); `logoWidth` vira `emailLogoWidth`; `linkExpiry`, `codeLength` e `secureEmailChange` vão para `supabase/config.toml` (veja o item abaixo). Depois, apague o arquivo antigo e rode `npm run emails:build`. Ao atualizar a partir da base, o Git pode mostrar o arquivo como "modificado aqui e apagado lá": faça a passagem acima e aceite a remoção.
- **`supabase/templates/email-settings.json` antigo:** o `npm run emails:build` recusa o arquivo e diz para onde foi cada campo. Em `supabase/config.toml`, na tabela `[auth.email]`, `linkExpiry` vira `otp_expiry`, em segundos (`"1 hora"` = `3600`, `"30 minutos"` = `1800`); `codeLength` vira `otp_length`; `secureEmailChange` vira `double_confirm_changes`. Apague o arquivo antigo, rode `npm run emails:build` e `npm run config:check` e aplique a configuração ([Guia de implantação, etapa 9](IMPLANTACAO.md#9-acesso-e-modelos-de-e-mail)). O `config-snippet.toml` também saiu: os blocos dos modelos ficam no `config.toml`, e o `emails:check` aponta o arquivo que sobrou.
- **`VITE_SUPPORT_EMAIL`:** continua funcionando por enquanto, com um aviso no build, quando o `supportEmail` do `brand.json` está vazio. Passe o endereço para `supportEmail` (assim ele vale também nos e-mails) e apague a variável na hospedagem e no `.env.local`. A variável sai numa versão futura (item 1.7b).
- **Arquivos do programa renomeados:** os logos da base passaram a se chamar `eia-logo-on-light.svg`, `eia-logo-on-dark.svg`, `eia-icon.svg` e `eia-auth-art.jpg`; `public/favicon.svg` e `public/materials/` saíram. Só importa para quem tinha editado esses arquivos: use imagens próprias, com nomes próprios, como nas seções 3 a 5.
