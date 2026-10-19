# Ensaio do guia de implantação

Roteiro do ensaio do [Guia de implantação do CRM](IMPLANTACAO.md) por pessoas que não são desenvolvedoras, em Windows e em macOS (item 1.4 do [roteiro](ROADMAP-FINALIZACAO.md), "Saída da F1"). O ensaio prova que o guia funciona sozinho e mostra onde ele precisa melhorar antes do `v1.0.0-rc.1`.

## 1. Quem e como

- **Duas pessoas que não desenvolvem**, uma num computador com Windows 11 e outra com macOS, cada uma com projetos novos: Supabase Free e Vercel Hobby (é ensaio, não uso comercial), com contas de teste e um e-mail de teste para o SMTP.
- **Quem observa não ajuda; só anota.** Quando a pessoa travar por mais de 10 minutos numa etapa, quem observa registra no formulário (seção 5) e destrava; a etapa conta como "travou".
- **Só o guia**, na versão do commit do ensaio, e o que ele aponta. Anote o commit no topo do registro.
- **Nada de senha no registro.** As capturas de tela escondem senhas, chaves e códigos de e-mail.

## 2. Roteiro por etapa

Uma linha por etapa do guia: o que observar e como confirmar. Marque cada uma quando concluída.

| Etapa | O que observar | Como confirmar |
| --- | --- | --- |
| [0. Antes de começar](IMPLANTACAO.md#0-antes-de-começar) | A pessoa acha o Prompt de Comando (Windows) ou o Terminal (macOS) e instala o Node e o Git sem ajuda. | `node -v` mostra `v22` ou um número maior (como `v24`); `git --version` responde. |
| [1. O código da empresa](IMPLANTACAO.md#1-o-código-da-empresa) | O repositório nasce privado; o `upstream` fica registrado. | `git remote -v` mostra `origin` e `upstream`; o `npm ci` termina sem erro. |
| [2. Escolha o plano](IMPLANTACAO.md#2-escolha-o-plano) | A pessoa entende por que dados reais pedem o Pro e o aviso do Hobby. | Ela explica, com as próprias palavras, quando usar cada plano. |
| [3. Crie o projeto Supabase](IMPLANTACAO.md#3-crie-o-projeto-supabase) | A senha do banco vai para o gerenciador; a região é São Paulo; a chave secreta não é copiada. | A referência, o endereço e a chave pública anotados. |
| [4. Crie o banco](IMPLANTACAO.md#4-crie-o-banco-migrações) | O `login`, o `link` com a senha e o `db push` com a resposta **Y**. | "Finished supabase db push". |
| [5. Confira o banco](IMPLANTACAO.md#5-confira-o-banco) | A colagem do arquivo inteiro no editor e a leitura do veredito. | **APROVADA**, com "Nenhuma empresa ainda". |
| [6. Marca](IMPLANTACAO.md#6-marca-opcional-antes-de-publicar) | O guia da marca seguido sem editar código. | `npm run brand:check` aprovado; o logo novo no navegador. |
| [7. Publique na Vercel](IMPLANTACAO.md#7-publique-na-vercel) | As duas variáveis, sem a chave secreta; o deploy sem mudar as configurações de build. | A tela de entrada em `<SUA_URL>`. |
| [8. E-mail (SMTP)](IMPLANTACAO.md#8-e-mail-da-instância-smtp) | O Gmail com senha de app (ou o domínio próprio): onde a pessoa trava. | A senha de app guardada; os valores anotados. |
| [9. Acesso e modelos](IMPLANTACAO.md#9-acesso-e-modelos-de-e-mail) | A cópia do `.env` (o caso do `.env.txt`), o `config:check` até passar e a leitura da diferença do `config:push`. Nenhum cadastro de teste antes da etapa 11. | "Finished supabase config push". |
| [10. Confira a URL](IMPLANTACAO.md#10-confira-a-url-publicada) | O comando com `--supabase-url` e `--key` (ou o `.env.local`); a leitura das linhas. | "Instância aprovada: 8 conferências". |
| [11. Primeiro dono](IMPLANTACAO.md#11-primeiro-dono-logo-depois-de-publicar) | O link com **Continuar**, **Crie sua senha** e **Criar empresa**; depois, os testes do **Link por e-mail** e do **Esqueceu a senha?** com a conta do dono. | Marco 1 (seção 3); os três e-mails (confirmação, link de acesso e redefinição) em português, com a marca. |
| [12. Equipe](IMPLANTACAO.md#12-equipe) | O convite criado e mandado pelo link; o aceite noutro navegador. | Marco 2 (seção 3). |
| [13. Dados de demonstração](IMPLANTACAO.md#13-dados-de-demonstração-opcional-só-aula-e-beta) | A ordem (dono, convites, seed) e a remoção. | As telas com os dados fictícios; a remoção sem erro. |
| [14. Backup, LGPD, personalizar e atualizar](IMPLANTACAO.md#14-backup-lgpd-personalizar-e-atualizar) | A base legal padrão escolhida; o backup ligado (no bloco opcional). | O checklist LGPD feito. |
| [Checklist](IMPLANTACAO.md#checklist) | Cada item conferido pela própria pessoa. | Todas as caixas marcadas, ou o motivo de cada uma vazia. |

Por fim, a **senha recuperada** (marco 3) e o tempo total.

## 3. Marcos da Saída da F1

Para cada marco, registre a data, o sistema e a evidência (a captura da tela ou o texto do e-mail recebido, sem senha nem código):

1. **Primeiro login do dono.** O primeiro cadastro em **Cadastrar**, o link do e-mail com **Continuar**, **Crie sua senha**, **Criar empresa** e o `supabase/instance-check.sql` **APROVADA**, com a linha "Donos ativos" mostrando o e-mail esperado.
2. **Convite aceito.** O convite criado em **Equipe → Convidar uma pessoa**, o link aberto noutro navegador, o cadastro com o e-mail convidado, a senha criada e a pessoa na lista da **Equipe** com o papel certo.
3. **Senha recuperada.** **Esqueceu a senha?** na tela de entrada, o e-mail em português, com a marca, a senha nova em `/reset-password` e a entrada com ela.

O ensaio só conta como concluído com os três marcos **nos dois sistemas** e o `npm run verify-instance -- <SUA_URL>` aprovado.

## 4. Blocos opcionais (pendências de ensaio dos outros itens)

Cada item do roteiro deixou uma pendência "ensaio do 1.4". Faça os blocos que couberem no dia, marcados com o item de origem; os que ficarem de fora continuam pendentes no roteiro.

| Bloco | Item | O que fazer |
| --- | --- | --- |
| Primeiro `config:push` real | 1.3 | Ler a diferença (as chaves do `supabase/config.toml`, como `enable_confirmations`, nas linhas com `+`), conferir no painel cada campo de [Aplicar no painel](../supabase/templates/README.md#aplicar-no-painel), inclusive os rótulos marcados "a confirmar", e registrar um campo recusado no Free. |
| Cabeçalhos e CSP | 1.3 | `curl.exe -I <SUA_URL>/` (no macOS, `curl -I`) e o console sem "Refused to…" no Chrome, no Edge, no Safari e no Firefox. Conferir se a Vercel manda o HSTS em dobro e se o `verify-instance` aceita. |
| Primeiro acesso, convite e break-glass | 1.1 | **Continuar** no link do e-mail, o código usado uma vez, o convite pelo link com a criação da senha e o break-glass de [Recuperar o acesso de dono](RECUPERAR-ACESSO-DONO.md) num projeto de ensaio. |
| Marca | 1.6 | Trocar a marca seguindo [Trocar a marca do CRM](MARCA.md), sem editar código. |
| Backup e restauração | 1.5 | Ligar o backup e restaurar num projeto Free temporário seguindo [Backup e restauração](BACKUP-RESTAURACAO.md), no Windows e no macOS. |
| Drift e gancho | 1.13 | Colar `supabase/db-drift-check.sql` num projeto novo (o editor aceita os cerca de 200 KB? zero diferenças?) e criar um gancho de exemplo seguindo [Personalizar sem quebrar a atualização](PROTECAO-ATUALIZACAO.md). |
| Conferência do banco | 1.4 | Confirmar que o editor do Supabase roda `supabase/instance-check.sql` inteiro (o `query_to_xml` do histórico) e anotar o tempo. |
| Personalizar com IA | 1.8 | Pedir a uma IA, seguindo [Personalizar o CRM](PERSONALIZAR/README.md), um campo novo e uma tela simples num projeto de desenvolvimento, com a suíte verde. |
| Seed de demonstração | 1.15 | Rodar o seed, conferir as telas, ensaiar a remoção e a recusa quando um registro da equipe aponta para a demonstração. |
| Planilha | 1.11 | Excel do Windows em português (os dois formatos de CSV), Excel do Mac e Google Planilhas; o .xlsx recusado com instrução. |
| Lembretes, recorte e catálogo | 1.12, 1.14, 1.16 | O número ao lado de "Hoje" no computador e no celular; o seletor com "(desativado)"; o editor de itens no celular. |
| Canais | 1.9 | Abrir o WhatsApp e registrar a ligação. |
| Desativar e reativar | 1.2 | Desativar uma pessoa e reativá-la. |

## 5. Formulário de registro de dificuldades

Uma linha por tropeço, mesmo pequeno. Copie a tabela para um documento ou use o CSV abaixo numa planilha. Os dois vêm vazios.

| Nº | Data e sistema | Etapa do guia | Tempo na etapa | O que a pessoa esperava | O que aconteceu | Como saiu | Gravidade | Sugestão |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | |

Exemplo: "1; 19/10/2026, Windows 11; 9. Acesso e modelos; 25 min; achar o arquivo `supabase/.env`; o `config:check` não achou o arquivo, porque o Bloco de Notas gravou `.env.txt`; pela solução de problemas; atrasa; avisar do `.env.txt` antes do passo".

O que vai em cada campo:

- **Nº:** sequencial.
- **Data e sistema:** por exemplo, "19/10/2026, Windows 11" ou "19/10/2026, macOS 15".
- **Etapa do guia:** o número e o título.
- **Tempo na etapa:** em minutos.
- **O que a pessoa esperava:** nas palavras dela.
- **O que aconteceu:** o que a tela mostrou, com o texto exato do erro.
- **Como saiu:** sozinha, pela solução de problemas ou com ajuda.
- **Gravidade:** bloqueia (não segue sem ajuda), atrasa (segue, mas demorou) ou incomoda (texto confuso).
- **Sugestão:** do guia, da tela ou da conferência.

```csv
numero,data_e_sistema,etapa_do_guia,tempo_minutos,o_que_esperava,o_que_aconteceu,como_saiu,gravidade,sugestao
```

## 6. Depois do ensaio

- Cada linha **bloqueia** vira correção do guia (ou do software) antes do `v1.0.0-rc.1`, com teste quando for software.
- As linhas **atrasa** e **incomoda** entram na revisão do guia.
- O resumo (os dois sistemas, o tempo por etapa, os marcos, os blocos feitos e as correções) vai para o roteiro, numa nota do item 1.4, e as pendências "ensaio do 1.4" dos outros itens são marcadas como feitas ou continuam, com o motivo.
