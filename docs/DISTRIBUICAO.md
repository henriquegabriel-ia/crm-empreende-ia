# Distribuição da base aos alunos

Este guia é de quem mantém a base: o dono do produto e o `@devops`. Ele diz como cada versão sai do repositório da base para o repositório de distribuição, de onde os alunos clonam. Quem implanta o CRM de uma empresa não precisa dele: o caminho dessa pessoa é o [Guia de implantação](IMPLANTACAO.md) e, depois, o [Guia de atualização](ATUALIZACAO.md). O desenho técnico está em [docs/arquitetura/1.7a.md](arquitetura/1.7a.md). Os comandos são os mesmos no Windows (Prompt de Comando) e no macOS (Terminal).

## 1. O que é

- **Repositório da base:** onde a base é desenvolvida. Tem o histórico inteiro (com o legado removido e os autores pessoais), a pasta de registros do dono (estado do ambiente de desenvolvimento, o ref do projeto, prévias) e o `.git-blame-ignore-revs`. Nunca é entregue aos alunos, nem por cópia ou zip da pasta.
- **Repositório de distribuição:** privado, numa organização GitHub do programa, com o branch `main` e um commit por versão (`chore: versão X.Y.Z`), cada um filho do anterior, e a tag `vX.Y.Z` em cada um. Os alunos da turma têm leitura; eles clonam para um repositório da empresa e registram a distribuição como `upstream` ([etapa 1 do guia de implantação](IMPLANTACAO.md#1-o-código-da-empresa)). O nome e a organização ficam no registro do ambiente do dono.
- **O que vai:** só os arquivos da allowlist de `scripts/lib/distribution.mjs`, cada um com o motivo. O que fica de fora de propósito está na lista de excluídos, também com o motivo; o que nunca pode ir está nos proibidos.
- **A conferência:** `npm run release:check` reprova arquivo sem classificação, a pasta de registros do dono citada num documento, o ref do projeto do dono, os nomes e e-mails dos autores do histórico da base, segredos (inclusive um valor real de senha ou chave nos modelos `.env.example`), e-mails de domínio real, caminhos de usuário (também no formato do Git Bash e do WSL), o workflow de backup ligado e uma marca que não é a do programa. Roda no `npm test` do repositório da base e no workflow `.github/workflows/distribuicao.yml`, em todo push e pull request.

## 2. Arquivo novo na base

Todo arquivo novo precisa de uma classe. Arquivo de código em `src/`, `scripts/`, `supabase/`, `tests/` ou `public/` já entra pela pasta. Um documento novo em `docs/` (fora de `docs/PERSONALIZAR/` e `docs/arquitetura/`) ou um arquivo novo na raiz entra **por nome** em `DISTRIBUTION_ALLOWLIST`, com o motivo, ou em `DISTRIBUTION_EXCLUDED`, com o motivo. Depois:

```
npm run release:check
```

Para ver a classificação inteira (incluídos por motivo, excluídos e os sem classe):

```
npm run release:dist -- --list
```

Nenhum documento cita a pasta de registros do dono com caminho ou link: escreva "o registro do ambiente do dono (fora da distribuição)". Termos pessoais que a conferência não conhece (outro e-mail, um telefone) entram na tabela "Distribuição" do registro do ambiente do dono, no formato mostrado ali (uma linha fora dele reprova a conferência), nunca num arquivo distribuído.

## 3. Lançar a versão na base

O commit de lançamento (`chore: versão X.Y.Z`, o `CHANGELOG.md` e o `package.json`) segue o [Guia de atualização, "Para quem mantém a base"](ATUALIZACAO.md#para-quem-mantém-a-base-lançar-uma-versão), com o número combinado com o dono. A partir da primeira versão, o mesmo commit acrescenta no fim do `CHANGELOG.md` os links de comparação, com o endereço do repositório de distribuição (o `npm test` confere):

```
[Não publicado]: https://github.com/<organização>/<repositório>/compare/vX.Y.Z...HEAD
[X.Y.Z]: https://github.com/<organização>/<repositório>/releases/tag/vX.Y.Z
```

A tag nasce no repositório de distribuição (passo 7), não no da base.

## 4. Gerar e conferir a árvore

Na pasta do repositório da base, com tudo commitado e a identidade do programa como autor (nunca a sua):

- **Primeira versão:** numa pasta nova, fora do repositório da base.
- **Versões seguintes:** num clone do repositório de distribuição (`git clone https://github.com/<organização>/<repositório>.git <pasta>`), nunca numa pasta nova: sem o commit anterior, os alunos não conseguem atualizar (`refusing to merge unrelated histories`).

```
npm run release:dist -- --out "<pasta>" --author "Base do CRM <base@<domínio do programa>>" --verify --e2e
npm run release:check -- --dist "<pasta>"
```

- O script recusa, sem escrever nada: a pasta dentro do repositório da base, uma pasta não vazia que não é a distribuição, a distribuição com mudanças, uma versão igual ou menor que a já distribuída (ou com a tag já criada), a versão `.0` (`1.0.0-beta.0`, que nunca é lançada), o `package.json` diferente da última versão com data do `CHANGELOG.md`, a base com mudanças sem commit, um link simbólico ou submódulo, um arquivo de mais de 2 MB, um autor com termo pessoal e qualquer reprovação da conferência.
- `--verify` roda o `npm ci`, a conferência e a suíte da Qualidade num clone local do commit gerado, ao lado da pasta (o que os alunos recebem, e não a pasta de trabalho), e apaga o clone se tudo passar; `--e2e` acrescenta o E2E (portas 8096, 8098 e 8099: não rode ao mesmo tempo que o E2E da base).
- O commit leva exatamente os arquivos copiados, inclusive um versionado na base com `git add -f` que o `.gitignore` ignora. A pasta guarda a identidade do programa na própria configuração do Git (`user.name` e `user.email`), para a tag do passo 7.
- `--rehearsal` gera um **ensaio** numa pasta nova, aceitando a versão `.0` e mudanças sem commit, para conferir a árvore antes de lançar. O commit de ensaio nunca vai para a distribuição: o `release:check -- --dist` o recusa.
- O script nunca envia nem cria tag: no fim, mostra os comandos do `@devops`.

## 5. Primeira vez (`@devops`)

1. Criar o repositório **privado** e vazio na organização do programa (sem README, licença nem `.gitignore`).
2. Em **Settings → General**, desligar **Allow forking** (no repositório e, se possível, na organização): o aluno clona para um repositório da empresa, e um fork privado some quando ele perde o acesso.
3. Ligar o Actions e criar a variável `CRM_DISTRIBUTION_REPOSITORY` com o valor `true` (**Settings → Secrets and variables → Actions → Variables**). Nunca `CRM_BASE_REPOSITORY` ali: com ela, o E2E e o ensaio de restauração rodariam toda noite.
4. Criar o time dos alunos da turma com permissão de leitura e convidar a **conta do GitHub da empresa** de cada aluno, não a pessoal: a mesma conta busca a base e envia ao repositório da empresa ([etapa 1 do guia de implantação](IMPLANTACAO.md#1-o-código-da-empresa)).
5. No repositório da base, conferir que a variável `CRM_BASE_REPOSITORY=true` existe (agora também condição do noturno do `ci.yml`).

## 6. Antes de enviar

Na pasta gerada:

```
git log --format="%h %an <%ae> %s"
```

Deve mostrar só commits `chore: versão …`, com a identidade do programa. Se aparecer qualquer outro commit, a pasta é a base, e não a distribuição: pare. O `release:check -- --dist` confere isso, e o olho confirma.

## 7. Enviar (`@devops`)

A tag anotada guarda o nome e o e-mail de quem a cria, e vai junto com o clone dos alunos: crie-a com a identidade do programa, a mesma do `--author` (o `release:dist` mostra o comando pronto). Sem o `-c`, o `git tag -a` usaria a sua identidade pessoal.

```
cd "<pasta>"
git remote add origin https://github.com/<organização>/<repositório>.git
git -c user.name="Base do CRM" -c user.email="base@<domínio do programa>" tag -a vX.Y.Z -m "vX.Y.Z"
```

No repositório da base, confira de novo a árvore, agora com a tag (o `release:check -- --dist` reprova uma tag leve, uma tag com termo pessoal ou criada por outra identidade que não a do commit):

```
npm run release:check -- --dist "<pasta>"
```

Depois, na pasta:

```
git push origin main
git push origin vX.Y.Z
```

O `git remote add` é só na primeira vez (o clone das versões seguintes já tem o `origin`). Opcional: uma "release" no GitHub com o texto da versão no `CHANGELOG.md`.

## 8. Depois

- Anotar no registro do ambiente do dono a versão, o commit da base e a data.
- Avisar a turma, com o link do `CHANGELOG.md` e do [Guia de atualização](ATUALIZACAO.md).
- Conferir verdes o workflow "Distribuição" e a "Qualidade" do CI no repositório de distribuição.

## 9. Deu errado

- Commit ou tag já enviados nunca são reescritos: a correção sai na versão seguinte.
- Tag errada ainda não enviada (outra identidade, versão errada): `git tag -d vX.Y.Z` e crie de novo como no passo 7.
- **A distribuição não aceita pull request** (nem do Dependabot): nada entra nela fora do `release:dist`, e a correção sai na versão seguinte da base. Num pull request, o workflow "Distribuição" confere só o conteúdo (o checkout é o commit de merge que o GitHub cria, que nunca é de versão); no push, confere também o histórico e as tags. Um merge no `main` da distribuição reprova no push seguinte: se acontecer, não envie mais nada e fale com o dono.
- Geração interrompida: na primeira vez, apague a pasta e gere de novo; numa versão seguinte, rode `git reset --hard` e `git clean -fd` na pasta.

## 10. Acesso

Tirar o aluno do time corta as versões novas, não a cópia que ele já tem; o que vale depois disso está na [`LICENSE`](../LICENSE). Na beta, vale também o [termo de beta](TERMO-BETA.md).

## 11. Cópias anteriores à distribuição

Uma cópia de teste feita direto do repositório da base, antes da primeira versão, não tem histórico em comum com a distribuição. Há dois caminhos: um clone novo da distribuição com as personalizações refeitas (o recomendado), ou `git merge --allow-unrelated-histories vX.Y.Z` com cada conflito resolvido pela versão da base ([Guia de atualização, solução de problemas](ATUALIZACAO.md#13-solução-de-problemas)).
