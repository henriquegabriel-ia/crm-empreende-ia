# Personalizar o CRM

Este guia é para quem publicou um CRM a partir desta base e quer acrescentar campos, tabelas e telas próprios da empresa, sozinho ou com uma ferramenta de inteligência artificial (Claude Code, Codex, Cursor, Lovable), sem quebrar a segurança nem perder as atualizações. Ele foi escrito para quem usa Windows; no macOS e no Linux os passos são os mesmos, com o terminal do sistema.

## O que se personaliza, e onde

| Quero mudar… | Caminho | Guia |
| --- | --- | --- |
| Nome, logo, cores e e-mails de acesso | Sem código: os arquivos da marca | [Trocar a marca do CRM](../MARCA.md) |
| Uma regra ("sem empresa, a oportunidade não passa de R$ 10.000") | Um gancho `private.custom_*` | [Personalizar sem quebrar a atualização](../PROTECAO-ATUALIZACAO.md) |
| Um campo novo num contato, empresa ou oportunidade | Uma coluna `custom_<nome>` e uma linha na tela | [Campo novo](CAMPO.md) |
| Uma tabela nova | Uma tabela `custom_<nome>` com RLS por organização | [Entidade nova](ENTIDADE.md) |
| Uma tela nova | Código em `src/custom/` e uma rota | [Tela nova](TELA.md) |
| Usar o Lovable | Leia antes os riscos | [Lovable com Supabase externo](LOVABLE.md) |

Os três guias de código usam o mesmo exemplo, "Contratos": o CNPJ da empresa cliente (`companies.custom_cnpj`), a tabela de contratos de cada oportunidade (`public.custom_contratos`) e a tela que lista e registra contratos. Os arquivos completos estão em [exemplos/](exemplos/supabase/migrations/20261101091000_custom_contratos.sql), com os caminhos que eles terão no seu repositório, e passam na suíte da base: as migrações rodam no `npm run test:db`, os tipos são gerados pelo `npm run gen:types`, e a tela passa no `npm run typecheck`, no `npm run lint:ci` e no `npm test`.

## Princípios

1. **O banco protege.** Toda regra de segurança fica no banco (RLS, papéis, permissões). A tela só esconde o que o papel não faz; ela nunca é a única barreira.
2. **O prefixo e a pasta são seus.** Tabelas, colunas, funções, políticas e índices seus começam com `custom_`; as suas migrações se chamam `<data e hora>_custom_<nome>.sql`; o seu código fica em `src/custom/`. A base nunca cria nada com esse prefixo nem nessa pasta, e as conferências da base deixam tudo isso de fora.
3. **Mudança mínima nas telas da base.** Onde for preciso mexer num arquivo da base (a rota em `src/App.tsx`, um item de menu, a pergunta da Central de ajuda, um campo no formulário), mude só a linha necessária e marque-a com o comentário `custom:`. Na atualização, um conflito nessa linha se resolve mantendo as duas partes.
4. **Permissões explícitas.** Desde a migração `20261019120000_default_privileges.sql` da base, uma tabela ou função nova nasce sem permissão nenhuma para a API: o CRM recebe "permission denied" (42501) até você dar o `grant`. Nada fica aberto por esquecimento.
5. **A suíte verde antes de publicar.** Os comandos estão em [AGENTS.md](../../AGENTS.md#como-validar). Não desligue nem afrouxe um teste para passar.

## Como pedir à IA

1. Abra a pasta do repositório na ferramenta (Claude Code, Codex ou Cursor). Ela lê o [AGENTS.md](../../AGENTS.md), na raiz, com as regras deste repositório; o `CLAUDE.md` só o importa.
2. Peça um passo por vez, citando o guia: "Siga docs/PERSONALIZAR/CAMPO.md e crie um campo custom_segmento em companies, com a migração, o tipo gerado, o campo no formulário e o teste".
3. Leia o SQL antes de aplicar. Recuse qualquer `drop`, `create or replace` ou `alter` num objeto da base (sem o prefixo `custom_`) e qualquer mudança num arquivo que já existe em `supabase/migrations`.
4. Peça para rodar a suíte e confira o resultado você mesmo no terminal.

## Testar a sua migração

O `npm run test:db` confere só a base (as suas migrações `_custom_` ficam de fora). Teste as suas no projeto de desenvolvimento do Supabase, nunca direto no da empresa:

1. No terminal (PowerShell ou Prompt), na pasta do projeto, ligue o repositório ao projeto de desenvolvimento. Quem seguiu o [Guia de implantação](../IMPLANTACAO.md) deixou o repositório ligado ao projeto da empresa, e o `db push` aplica no projeto ligado:

   ```powershell
   npx supabase link --project-ref <ref do projeto de desenvolvimento>
   npx supabase projects list
   ```

   O ref é o código de 20 letras do endereço do projeto no painel do Supabase. O `projects list` marca o projeto ligado na coluna **LINKED**: confira que é o de desenvolvimento antes de seguir.
2. `npx supabase db push`. Ele mostra as migrações que vai aplicar e pede confirmação: confira que são só as suas.
3. `npm run gen:types`, para o tipo gerado ganhar as suas tabelas e colunas.
4. No CRM de desenvolvimento, entre com uma conta de cada papel e confira o que cada uma lê e grava.
5. Rode a conferência de drift ([seção 5 do guia de proteção](../PROTECAO-ATUALIZACAO.md#5-conferir-o-banco-db-drift-check)): os seus objetos aparecem como extras, sem atenção.
6. Só então aplique no projeto da empresa: `npx supabase link --project-ref <ref do projeto da empresa>`, `npx supabase projects list` (agora o da empresa marcado) e `npx supabase db push`. Deixe o repositório ligado ao projeto da empresa no fim, como a Publicação espera.

Os testes de banco do exemplo (no `scripts/test-database.mjs` da base, função `personalizationExampleChecks`) mostram o que conferir: o colaborador grava, o papel de leitura só lê, outra organização não enxerga nada e `anon` recebe 42501.
