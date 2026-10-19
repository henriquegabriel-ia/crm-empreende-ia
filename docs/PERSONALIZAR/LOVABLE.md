# Lovable com Supabase externo

Resultado do estudo (spike) do item 1.8 do [roteiro](../ROADMAP-FINALIZACAO.md): dá para personalizar este CRM com o Lovable, ligado ao Supabase da sua instância? A resposta, pela documentação atual, é **viável com restrições, e não recomendada como caminho principal**. O desenho técnico está na [seção 7 do desenho do 1.8](../arquitetura/1.8.md#7-spike-lovable-com-supabase-externo).

Fontes, consultadas em **19/10/2026** (nenhuma conta foi criada para este estudo):

- Lovable, [Supabase integration](https://docs.lovable.dev/integrations/supabase).
- Lovable, [Git sync](https://docs.lovable.dev/integrations/git-sync-overview).
- Supabase, [Securing your API](https://supabase.com/docs/guides/api/securing-your-api), seção dos privilégios padrão, e o [changelog da mudança](https://github.com/orgs/supabase/discussions/45329).

## Viabilidade

| Pergunta | O que a documentação diz | Consequência para o CRM |
| --- | --- | --- |
| Dá para trazer o repositório do CRM para o Lovable? | Não diretamente: o Git sync é só de exportação ("Export only"). Conectar o GitHub cria um repositório novo, com sincronização nos dois sentidos de um branch. | O caminho possível é criar o projeto no Lovable, conectar o GitHub e enviar o código do CRM para o branch sincronizado. A documentação não diz se aceita um histórico sem relação com o do repositório criado. O repositório do aluno passa a ser o do Lovable, e a atualização da base vira `git pull` num clone local seguido de `git push` para ele. |
| Dá para ligar um Supabase próprio? | Sim. Um dono ou administrador do workspace do Lovable liga uma **organização** do Supabase, e qualquer pessoa com edição num projeto do Lovable o conecta a qualquer projeto dessa organização. O backend próprio do Lovable (Lovable Cloud) vem ligado por padrão. | Recuse o Lovable Cloud e nunca ligue a organização em que está o projeto da empresa. |
| Como ele muda o banco? | Escreve o SQL, mostra no chat, espera a aprovação, executa no projeto conectado e salva o arquivo em `supabase/migrations/`. Pede aprovação também para gravar dados e mexer no Storage. | O SQL é aplicado direto, fora do `npx supabase db push`; a documentação não diz como nomeia o arquivo nem se registra a versão no histórico de migrações. |
| E os commits feitos fora dele? | Entram no Lovable pelo branch sincronizado, passam pela auditoria de dependências, e **os arquivos de migração não são executados** na sincronização. Um force-push ou rebase faz a próxima sincronização guardar uma cópia da versão do Lovable e trocar pela sua. | Migrações escritas no repositório continuam sendo aplicadas por você (`npx supabase db push`). Não reescreva o histórico do branch sincronizado. |
| E os tipos? | Depois de cada migração, o Lovable regenera "os tipos que o app usa", sem dizer o caminho. | O CRM usa `src/integrations/supabase/database.types.ts`, gerado por `npm run gen:types`. Um segundo arquivo de tipos diverge. |

## Riscos

| Risco | Por quê | Como reduzir |
| --- | --- | --- |
| Sobrescrever ou "consolidar" o esquema | O legado `.lovable/` desta base (arquivado na tag `legacy-archive`) mandava apagar todas as migrações e pôr um esquema único. Um agente pode propor isso de novo. | Cole o resumo abaixo no conhecimento do projeto do Lovable. Leia todo SQL antes de aprovar e recuse `drop`, `create or replace` fora de `custom_*` e qualquer mudança num arquivo que já existe em `supabase/migrations`. O CI da base (`npm run manifest:check` e as regras das migrações) reprova no push. |
| Migração sem `_custom_` no nome | As conferências da base tratam o arquivo como da base: o `manifest:check` e o `test:db` ficam vermelhos no CI. | Renomeie para `<data e hora>_custom_<nome>.sql` antes do commit, ou não conecte o Supabase e escreva as migrações no repositório. |
| SQL aplicado fora do `db push` | O arquivo e o banco podem divergir, e o histórico de migrações pode ficar sem a versão. | Rode a conferência de drift depois de cada mudança ([seção 5 do guia de proteção](../PROTECAO-ATUALIZACAO.md#5-conferir-o-banco-db-drift-check)). |
| Acesso à organização inteira | Quem edita qualquer projeto do Lovable conecta qualquer projeto da organização ligada, inclusive o da empresa, com dados reais. | Use um projeto de desenvolvimento numa organização Supabase à parte, só para isso. |
| Segredos compartilhados | Projetos do Lovable que usam o mesmo projeto Supabase sobrescrevem os segredos uns dos outros. | Um projeto Supabase por projeto do Lovable. |
| Gerenciador de pacotes | O Lovable costuma gravar `bun.lockb`; esta base usa só npm, e a Vercel escolhe o gerenciador pelo arquivo de trava. | Apague `bun.lock` e `bun.lockb` antes de publicar (está em "Não tocar" do [AGENTS.md](../../AGENTS.md#não-tocar)). |
| Tabela sem permissão | Desde a migração `20261019120000_default_privileges.sql` (e, no Supabase, para todo projeto a partir de 30/10/2026), uma tabela criada sem `grant` responde 42501. | Esperado e seguro: peça o `grant` e a RLS como em [Entidade nova](ENTIDADE.md). |
| Recursos que só existem no Lovable Cloud | Login social, visualizações do backend e outros recursos dependem do Cloud. | Ficam de fora; o CRM não depende deles. |

## Recomendações

1. **Caminho principal**: Claude Code, Codex ou Cursor no clone do repositório, lendo o [AGENTS.md](../../AGENTS.md) e seguindo estes guias.
2. **Lovable, se você preferir**: só para telas, **sem Supabase conectado**. O app continua apontando para o seu Supabase pelas variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` de sempre, e as mudanças no banco vêm como migrações `_custom_` escritas no repositório e aplicadas por você com `npx supabase db push`, depois de revisar.
3. **Se conectar o Supabase**: só um projeto de desenvolvimento, numa organização Supabase à parte. Renomeie cada migração gerada para `_custom_`, rode `npm run gen:types` e a conferência de drift, e nunca aprove SQL que toque objetos da base.
4. **Cole este resumo** no conhecimento (Knowledge) do projeto do Lovable:

```text
Este é um CRM com regras em AGENTS.md. Nunca edite, apague ou consolide arquivos de supabase/migrations.
Toda migração nova se chama <data e hora>_custom_<nome>.sql. Objetos novos começam com custom_.
Nunca altere funções, políticas ou gatilhos que não começam com custom_. Regras próprias vão nos ganchos private.custom_*.
Toda tabela nova tem org_id, FK composta (id, org_id), RLS com private.current_org() e grant explícito para authenticated.
Nunca coloque chave service_role ou sb_secret_ em variável VITE_. Use só npm; nunca gere bun.lock nem bun.lockb.
Os tipos vêm de npm run gen:types, em src/integrations/supabase/database.types.ts.
```

## O que fica fora

Suporte oficial ao Lovable como ferramenta de implantação, e qualquer ajuste da base para ele (nome das migrações, caminho dos tipos) antes do ensaio prático.

## Pendente: o ensaio prático

Fica para uma pessoa do programa, com uma conta do Lovable do programa e um projeto Supabase de desenvolvimento numa organização à parte:

1. Enviar o código do CRM ao repositório criado pelo Lovable: ele aceita o histórico? O build passa com npm? Aparece `bun.lockb`?
2. Pedir uma tabela nova e anotar o nome do arquivo de migração, se a versão entra no histórico de migrações, se vêm o `grant` e a RLS, e o caminho dos tipos regenerados.
3. Pedir algo que tente mudar uma função da base e ver se o Lovable respeita o resumo colado no conhecimento.
4. Rodar a conferência de drift no fim, registrar aqui o que mudou e decidir se a recomendação muda.
