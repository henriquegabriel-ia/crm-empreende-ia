# Guia de atualização do CRM

Este guia é para quem publicou o CRM de uma empresa seguindo o [Guia de implantação](IMPLANTACAO.md) e quer trazer uma versão nova da base para essa instância: o código, o banco, o acesso (Auth) e a publicação. Ele foi escrito para o Windows, no **Prompt de Comando**, como o guia de implantação; no macOS, os comandos são os mesmos, no **Terminal**. O desenho técnico está em [docs/arquitetura/1.7b.md](arquitetura/1.7b.md).

O que a base promete a quem personalizou (ganchos que ficam, o prefixo `custom_` reservado, migrações aditivas e nada apagado em silêncio) está na [seção 1 de Personalizar sem quebrar a atualização](PROTECAO-ATUALIZACAO.md#1-o-que-a-base-promete). Este guia não repete aquele: aponta para ele onde precisa.

- **Faça primeiro num projeto de teste**, quando puder: o projeto Free de desenvolvimento, se você tiver um, como em [Personalizar o CRM](PERSONALIZAR/README.md#testar-a-sua-migração).
- **Quanto tempo leva:** de 30 minutos a uma hora numa versão sem conflitos; mais, se a sua instância tem muitas personalizações.
- **O que muda em cada versão** fica no [`CHANGELOG.md`](../CHANGELOG.md), na raiz do repositório.

## 0. Versões e notas

As versões da base seguem o Versionamento Semântico:

| Versão | O que é |
| --- | --- |
| `1.0.0-beta.1`, `1.0.0-beta.2`… | Distribuição antecipada, com o termo de beta. |
| `1.0.0-rc.1`, `1.0.0-rc.2`… | Candidatas, usadas no piloto. |
| `1.0.0`, `1.1.0`, `1.0.1`… | Versões para todos. |

- **Principal** (`2.0.0`): remove ou renomeia algo de que a sua instância depende (uma coluna, uma RPC, um campo do `public/brand/brand.json`, uma variável de ambiente) ou exige uma ação manual sem volta. Antes, uma versão anterior avisa em "Obsoleto", e o que fica obsoleto continua funcionando até a principal seguinte.
- **Secundária** (`1.1.0`): acrescenta algo (uma migração aditiva, um campo opcional, um comando, uma verificação nova numa conferência).
- **Correção** (`1.0.1`): corrige sem acrescentar funcionalidade.
- **Pré-versão** (`-beta.N`, `-rc.N`): qualquer mudança, inclusive incompatível; as notas sempre dizem o que fazer.

**Qual versão está instalada:** o rodapé da **Ajuda** do CRM mostra "Versão X"; no terminal, `git fetch upstream --tags` e depois `git describe --tags --abbrev=0` mostram a última versão que você trouxe; a conferência "Versão publicada" do `npm run verify-instance` diz se o endereço publicado serve essa versão.

**Leia as notas antes:** no `CHANGELOG.md`, leia o "Ao atualizar" **de cada versão** entre a sua e a nova, de baixo para cima. Dá para pular versões secundárias e de correção; de uma versão principal para outra, vá uma de cada vez (a última versão de cada principal, em ordem).

## 1. Antes de começar

- No terminal, na pasta do projeto, `git status` precisa mostrar "nothing to commit, working tree clean" no branch `main`. Se mostrar arquivos, faça commit ou descarte antes.
- Uma pessoa só atualiza de cada vez.
- Escolha um horário de pouco uso: a publicação troca o site, e as telas abertas recarregam sozinhas uma vez ao trocar de página (um formulário aberto e ainda não salvo nessa hora se perde).

## 2. Cópia de segurança

Antes de mexer no banco, faça uma cópia. Há três casos:

- **Com o workflow ligado:** no GitHub da empresa, **Actions → Backup do banco → Run workflow**, espere terminar verde e confira que o artefato apareceu na execução.
- **Sem o workflow, numa instância Pro:** confira que a cópia diária do Supabase do dia existe (**Database → Backups**).
- **Sem o workflow, numa instância Free sem dados reais** (aula, demonstração, beta com dados de teste): a cópia não é necessária, e você pode seguir. Se a instância já tem dados que não podem se perder, ligue o workflow e faça a cópia antes de continuar.

Os detalhes, inclusive como ligar o workflow e abrir o arquivo, estão em [Backup e restauração](BACKUP-RESTAURACAO.md).

Deu certo se: com o workflow, a execução terminou verde e o artefato está lá; no Pro sem o workflow, a cópia do dia aparece em **Database → Backups**; no Free sem dados reais, você confirmou que nada ali precisa ser guardado.

## 3. Conferências antes

Com o código da versão **instalada** (ainda sem a versão nova):

1. `npm run manifest:check`: os arquivos gerados do repositório estão como a base os entrega. Se reprovar, a mensagem diz o arquivo e como voltá-lo (`git checkout HEAD -- <arquivo>`).
2. `supabase/instance-check.sql` no editor SQL do painel ([Guia de implantação, etapa 5](IMPLANTACAO.md#5-confira-o-banco)): precisa dar **APROVADA**. Não atualize uma instância reprovada: os dois problemas se misturam.
3. `supabase/db-drift-check.sql` no editor SQL, **com o arquivo da versão instalada**. Os "alterados" e "ausentes" são o que a atualização pode apagar ou quebrar: mova cada alteração para um gancho antes de seguir ([seção 5](PROTECAO-ATUALIZACAO.md#5-conferir-o-banco-db-drift-check) e [seção 6](PROTECAO-ATUALIZACAO.md#6-atualizar-a-base) do guia de proteção). Esta conferência é obrigatória: depois da atualização, uma função que a base recriou volta igual à da base, e a sua alteração some sem deixar diferença para mostrar (etapa 11).

## 4. Trazer a versão nova

A base fica registrada como `upstream` desde a [etapa 1 do guia de implantação](IMPLANTACAO.md#1-o-código-da-empresa). Troque `vX.Y.Z` pela versão nova, por exemplo `v1.0.0-rc.2`:

```
git fetch upstream --tags
git switch -c atualizacao-vX.Y.Z
git merge --no-ff vX.Y.Z -m "chore: atualiza a base para vX.Y.Z"
```

- Atualize sempre por uma versão marcada (tag), nunca pelo `upstream/main`, que pode ter trabalho no meio.
- O branch `atualizacao-vX.Y.Z` existe porque a Vercel publica o `main` sozinha: o código novo só chega ao `main` depois do banco pronto (etapa 9). O branch fica só no seu computador até a etapa 9 (não é preciso enviá-lo ao GitHub). Se você o enviar, a Vercel cria uma publicação de pré-visualização dele: não entre nela antes da etapa 7, porque ela usa o mesmo Supabase com o banco ainda antigo, e o endereço dela não está na lista de retorno do Auth.
- Use `merge`, nunca `rebase` nem o botão "Sync fork" do GitHub: o `main` da empresa já foi enviado, e o repositório nasceu de um `git clone`, não de um fork.

Deu certo se o `merge` termina sem "CONFLICT". Com conflitos, siga a etapa 5.

## 5. Conflitos

O Git marca os arquivos em conflito (`git status` mostra "both modified"). Resolva cada um pela tabela, depois `git add <arquivo>` e, no fim, `git commit` (sem mensagem: o Git propõe a do merge).

| Arquivo | Por que conflita | Como resolver |
| --- | --- | --- |
| `public/brand/brand.json` | A base acrescentou um campo (sempre opcional); ela nunca muda os seus valores | Mantenha os seus valores e acrescente o campo novo, se quiser; rode `npm run brand:check`. Uma imagem em `public/brand/` mudada dos dois lados: fique com a sua (`git checkout --ours -- public/brand/<arquivo>`). A política da marca está em [Trocar a marca, seção 13](MARCA.md#13-atualizar-de-uma-versão-anterior). |
| Modelos de e-mail gerados (os `.html` de `supabase/templates/` e `supabase/templates/subjects.json`) e o bloco entre `# >>> Modelos de e-mail do Auth` e `# <<< Modelos de e-mail do Auth` no `supabase/config.toml` | São gerados a partir da marca e dos textos da base | Aceite qualquer lado e rode `npm run emails:build`, depois `npm run emails:check`. |
| `supabase/config.toml` (fora do bloco dos modelos) | A base mudou um valor ou acrescentou uma opção | Fique com a versão da base (`git checkout --theirs -- supabase/config.toml`), refaça só as suas mudanças que o `npm run config:check` aceita e rode `npm run emails:build`. O `config:push` vem depois do banco (etapa 8). |
| Migrações | Não conflitam: a base nunca edita uma migração existente, e as suas têm `_custom_` no nome | Um conflito num arquivo de `supabase/migrations` que não é seu quer dizer que alguém o editou: volte-o ao da base (`git checkout --theirs -- <arquivo>`) e leve a mudança para uma migração `_custom_` ([seção 4 do guia de proteção](PROTECAO-ATUALIZACAO.md#4-a-sua-migração)). |
| `src/custom/` | Não conflita: a base nunca cria nada ali | Nada a fazer. |
| Uma linha marcada `custom:` numa tela da base (rotas em `src/App.tsx`, menu, Central de ajuda) | A base mudou as linhas vizinhas | Mantenha as duas partes: a linha nova da base e a sua linha `custom:`. O `CHANGELOG.md` avisa quando uma dessas telas mudou. |
| Uma tela da base editada fora das linhas `custom:` | A personalização reescreveu a tela | Fique com a versão da base e refaça a mudança como [Tela nova](PERSONALIZAR/TELA.md) manda. |
| Arquivos gerados: `src/integrations/supabase/database.types.ts`, `docs/PERSONALIZAR/exemplos/database.types.ts`, `supabase/base-manifest.json`, `supabase/db-drift-check.sql`, `supabase/instance-check.sql` e `supabase/seed-demo.sql` | Gerados a partir das migrações | Aceite qualquer lado e rode `npm run gen:types` (o tipo inclui as suas tabelas) e `npm run manifest:check`, que deixa as suas migrações de fora; se ele reprovar um arquivo gerado, volte-o ao da versão nova (`git checkout vX.Y.Z -- <arquivo>`). Nunca rode `manifest:build` numa instância personalizada. |
| `package.json` e `package-lock.json` | A base mudou dependências ou comandos; a empresa acrescentou dependências | `package.json`: mantenha os dois lados (as dependências da base e as suas); o `"version"` é sempre o da base. `package-lock.json`: aceite o da base (`git checkout --theirs -- package-lock.json`) e rode `npm install`, que acrescenta as suas. |
| `AGENTS.md` e `CLAUDE.md` | A base mudou as regras | Aceite a versão da base. Regras próprias da empresa ficam numa seção `## Regras desta instância`, curta, no fim do `AGENTS.md`; num conflito, mantenha essa seção. |
| `vercel.json` | A base mudou um cabeçalho; a empresa acrescentou um endereço na CSP | Fique com a versão da base e acrescente de novo o seu endereço, na diretiva certa, com o motivo; o `npm test` confere os cabeçalhos. |
| `.env.example` e `supabase/.env.example` | A base acrescentou uma variável | Aceite a versão da base e compare com o seu `.env.local` e o `supabase/.env` (o `npm run config:check` e o build dizem o que falta). |
| `LICENSE`, `CHANGELOG.md`, `docs/` e `.github/workflows/` | São arquivos da base | Aceite a versão da base. |

Deu certo se `git status` não mostra mais "both modified" e o `git commit` terminou.

## 6. Conferir no computador

Ainda no branch `atualizacao-vX.Y.Z`:

```
npm ci
npm run gen:types
npm run manifest:check
npm run emails:check
npm run config:check
npm run typecheck
npm test
npm run build
```

- Se a empresa acrescentou dependências próprias e o `npm ci` recusar o `package-lock.json`, rode `npm install` e faça commit do lock.
- Se o `npm run gen:types` mudar `src/integrations/supabase/database.types.ts`, faça commit (ele inclui as suas tabelas).
- Quem tem as ferramentas roda a suíte inteira do [`AGENTS.md`](../AGENTS.md#como-validar).

Deu certo se todos terminam sem erro.

## 7. Banco

Confira o projeto ligado e aplique as migrações da versão nova:

```
npx supabase@2.119.0 projects list
npx supabase@2.119.0 db push --dry-run
npx supabase@2.119.0 db push
```

- O `projects list` marca o projeto ligado: precisa ser o da empresa. Se a pasta não estiver ligada (num computador novo, por exemplo), rode antes `npx supabase@2.119.0 login` e `npx supabase@2.119.0 link --project-ref <SEU_PROJECT_REF>`.
- O `--dry-run` só lista o que seria aplicado, sem aplicar nada: a lista precisa ter só as migrações da versão nova (as da seção "Migrações" do `CHANGELOG.md`) e as suas ainda não aplicadas. Se aparecer outra coisa, pare e peça ajuda a quem mantém a base.
- O `db push` lista as migrações, pergunta se pode continuar (responda **Y**) e termina com "Finished supabase db push".
- **Se o `db push` recusar uma migração anterior à última aplicada**, é esperado quando você criou uma migração sua depois da data de uma migração nova da base: rode `npx supabase@2.119.0 db push --dry-run --include-all`, confira que a lista tem só as migrações da versão nova e as suas, e aplique com `npx supabase@2.119.0 db push --include-all`. É seguro: uma migração da base não depende de nada seu (o prefixo `custom_` é reservado).
- **Se a mesma data e hora já existir** (uma migração sua com o mesmo número de uma migração da base), o histórico recusa por chave repetida. Uma migração sua ainda não aplicada se renomeia com a hora atual; uma já aplicada exige ajuda de quem mantém a base.
- **Se a migração parar com "A atualização vai substituir…"**, a guarda achou uma função, um gatilho ou uma política da base alterada à mão nesta instância: nada daquela migração foi aplicado. Siga a [seção 7 do guia de proteção](PROTECAO-ATUALIZACAO.md#7-quando-a-atualização-para) e rode o `db push` de novo; as migrações anteriores à que parou já ficaram aplicadas, e o `db push` continua da que falta.

Deu certo se o `db push` termina com "Finished supabase db push".

## 8. Acesso (Auth)

Só se o "Ao atualizar" de alguma versão pedir (a versão mudou o `supabase/config.toml` ou os modelos de e-mail):

```
npm run config:push
npm run config:check
```

O `config:push` roda a conferência antes e só então aplica, como na [etapa 9 do guia de implantação](IMPLANTACAO.md#9-acesso-e-modelos-de-e-mail). Depois, o `config:check` mostra o que ainda falta, como uma variável nova em `supabase/.env`.

## 9. Publicar o frontend

Só depois da etapa 7 (e da 8, se ela se aplicou):

```
git switch main
git merge atualizacao-vX.Y.Z
git push
```

A Vercel publica o `main` sozinha. Espere a publicação terminar em **Deployments** (o status vira **Ready**).

Por que nessa ordem: as migrações da base só acrescentam, então o site antigo continua funcionando com o banco novo; o contrário não funciona (as telas novas mostram "Este CRM ainda não tem a atualização…"). Uma versão principal que remova algo diz no "Ao atualizar" se a ordem muda.

## 10. Conferências depois

1. `supabase/instance-check.sql` no editor SQL: **APROVADA**.
2. `supabase/db-drift-check.sql` com o arquivo **da versão nova**: só o resumo, os ganchos em uso e os seus extras devem sobrar.
3. `npm run config:check`.
4. `npm run verify-instance -- <SUA_URL>` ([Guia de implantação, etapa 10](IMPLANTACAO.md#10-confira-a-url-publicada)), inclusive a linha "Versão publicada", que precisa mostrar a versão nova.
5. Abra o CRM, entre e confira uma tela que a versão mudou (o `CHANGELOG.md` diz quais).

## 11. Quando a base recriou uma função que você alterou

- **Antes (etapa 3):** o drift-check mostra a função como "alterado". O caminho bom é mover a regra para um gancho e voltar a função ao texto da base antes de atualizar ([seção 6 do guia de proteção](PROTECAO-ATUALIZACAO.md#6-atualizar-a-base)).
- **Durante (etapa 7):** a migração que recria a função para na guarda, sem aplicar nada dela. Se você aceitar a substituição, a alteração se perde: refaça a regra num gancho.
- **O que a guarda não vê:** o que a migração recria por SQL montado na hora e um objeto que ficou sem guarda por engano. Por isso o drift-check **antes** é obrigatório. As notas de cada versão no `CHANGELOG.md` listam as funções recriadas (a marca **recria**): confira se alguma delas é uma que você tinha alterado.
- **Uma migração da base editada:** se a personalização editou um arquivo antigo de `supabase/migrations` (o `AGENTS.md` proíbe), o `npm run manifest:check` da etapa 3 reprova. Volte o arquivo ao da base e leve a mudança para uma migração `_custom_`.

## 12. Voltar atrás

- **Site:** na Vercel, **Deployments**, a publicação anterior, menu **…** → **Instant Rollback**. No plano Hobby, só a publicação imediatamente anterior; no Pro, qualquer publicação de produção. Depois disso, a Vercel não publica sozinha os próximos envios ao `main` até **Undo Rollback**, e a conferência "Versão publicada" mostra a versão anterior até lá. As variáveis de ambiente não voltam junto.
- **Banco:** as migrações só andam para frente. Como elas só acrescentam, o site anterior continua funcionando com o banco novo. Um problema grave nos dados se resolve restaurando a cópia num projeto novo ([Backup e restauração](BACKUP-RESTAURACAO.md)); nunca tente "desfazer" uma migração à mão.
- **Código:** `git revert -m 1 <commit do merge>` no `main` volta o código. Um novo `git merge` da mesma versão, depois, exige reverter esse revert: prefira corrigir para frente.

## 13. Solução de problemas

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| `fatal: … not something we can merge` | As versões (tags) não foram buscadas | `git fetch upstream --tags` e repita o `merge`. |
| `git fetch upstream`: "Repository not found" | O login do Git guardado é de uma conta sem acesso à distribuição (trocado, por exemplo, para enviar ao repositório da empresa), ou o acesso do programa acabou | Use uma conta com acesso à base e ao repositório da empresa, como explica [Uma conta do GitHub para tudo](IMPLANTACAO.md#1-o-código-da-empresa), e siga a [solução de problemas da implantação](IMPLANTACAO.md#solução-de-problemas). Se o acesso acabou, fale com o programa. |
| `fatal: refusing to merge unrelated histories` | A cópia da empresa foi feita antes da primeira versão, direto do repositório da base, e não tem histórico em comum com a distribuição | O recomendado: um clone novo da distribuição ([etapa 1 do guia de implantação](IMPLANTACAO.md#1-o-código-da-empresa)) com as personalizações refeitas. Ou `git merge --allow-unrelated-histories vX.Y.Z`, resolvendo cada conflito com a versão da base (etapa 5). |
| `db push` recusa uma migração anterior à última aplicada | Uma migração sua com data posterior à de uma migração nova da base | Etapa 7: `--dry-run --include-all`, conferir a lista e aplicar com `--include-all`. |
| A migração para com "A atualização vai substituir…" | A guarda achou um objeto da base alterado à mão | [Seção 7 do guia de proteção](PROTECAO-ATUALIZACAO.md#7-quando-a-atualização-para). |
| `supabase/instance-check.sql` reprova "Migrações" depois do merge | O `db push` não rodou ou parou no meio | Etapa 7. |
| `verify-instance` reprova "Versão publicada" | A publicação da Vercel não terminou ou falhou, o branch de produção é outro, ou uma volta atrás continua ativa | **Deployments** na Vercel: espere terminar, confira o branch de produção ou use **Undo Rollback**, e rode de novo. |
| Telas com "Este CRM ainda não tem a atualização…" | O site foi publicado antes do `db push` | Etapa 7 agora; o código não precisa voltar. |
| `npm ci` recusa o `package-lock.json` | O lock ficou fora de sincronia com o `package.json` mesclado | `npm install` e commit do lock. |
| `npm run emails:check` ou `npm run manifest:check` reprova | Um arquivo gerado ficou de um lado do conflito | `npm run emails:build`, ou volte o arquivo gerado ao da versão nova, e faça commit. |
| `npm run config:check` aponta uma variável nova | A versão acrescentou uma opção ao Auth | Preencha em `supabase/.env` e rode `npm run config:push`. |
| `git push` recusado ("non-fast-forward") | Outra pessoa atualizou ou enviou algo ao mesmo tempo | Pare, combine com a outra pessoa e recomece da etapa 1. |

## Para quem mantém a base: lançar uma versão

Esta seção é de quem mantém a base, e não de quem atualiza uma instância. O commit de lançamento e a tag ficam com o `@devops`, que segue estes passos sem decidir nada sozinho:

1. A suíte completa verde no commit a lançar ([`AGENTS.md`, "Como validar"](../AGENTS.md#como-validar)).
2. Escolher o número pelas regras da [etapa 0](#0-versões-e-notas), olhando o `[Não publicado]` do `CHANGELOG.md`.
3. Commit de lançamento (`chore: versão X.Y.Z`): no `CHANGELOG.md`, renomear `## [Não publicado]` para `## [X.Y.Z] - AAAA-MM-DD` e abrir acima um `## [Não publicado]` vazio, com "Nada por enquanto."; conferir que o "Ao atualizar" está completo; `npm version X.Y.Z --no-git-tag-version` (muda o `package.json` e o `package-lock.json`); `npm test`, que confere a coerência do `CHANGELOG.md` com o `package.json`.
4. Gerar a árvore da versão e enviá-la ao repositório de distribuição, onde nasce a tag anotada `vX.Y.Z`, pelo processo de [Distribuição da base aos alunos](DISTRIBUICAO.md) (`npm run release:dist`, `npm run release:check` e os comandos do `@devops`). A primeira versão é a `1.0.0-beta.1`; o `1.0.0-beta.0` de antes dela nunca vira tag. A partir da primeira versão, o commit de lançamento também acrescenta os links de comparação no fim do `CHANGELOG.md` (o formato está no guia de distribuição).
5. Opcional: uma "release" no GitHub com o texto da seção da versão.

Regras das notas de cada versão (o teste `scripts/lib/changelog.test.mjs` confere as marcadas com †):

- toda migração nova da base, uma vez só, na subseção "Migrações" da versão que a traz †, com as marcas **backfill**, **recria** e **guarda**, e todo objeto protegido pela guarda citado na mesma versão †;
- "rode `npm run config:push`" quando o `supabase/config.toml` mudar;
- "rode `npm run emails:build`" quando mudar um texto ou botão citado nos e-mails, a marca dos e-mails ou o gerador;
- a versão nova do Supabase CLI fixado, quando ela mudar, com os guias atualizados junto (um teste reprova o guia com outra versão);
- uma verificação nova no `supabase/instance-check.sql` ou no `npm run verify-instance`;
- uma tela com ponto `custom:` comum que mudou (rotas em `src/App.tsx`, menu, Central de ajuda) e as mudanças no `AGENTS.md`;
- coluna, RPC ou campo removido: só em versão principal, com aviso numa versão anterior em "Obsoleto";
- variável de ambiente nova ou obsoleta;
- uma mudança na `LICENSE`.

As regras de quem escreve as migrações da base (a guarda, o manifesto e o prefixo reservado) estão na [seção 8 do guia de proteção](PROTECAO-ATUALIZACAO.md#8-para-quem-mantém-a-base).
