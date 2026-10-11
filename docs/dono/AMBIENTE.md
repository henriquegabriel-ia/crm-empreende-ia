# Ambiente do dono do produto

Fatos do ambiente de trabalho do dono do produto, retirados do README, de `docs/PUBLICACAO-CRM.md`, de `docs/INTEGRACOES-PENDENTES.md` e do roteiro no item 0.3 (11/10/2026). Nada daqui vale para a instância de uma empresa: cada empresa usa o próprio projeto Supabase, a própria hospedagem e o próprio repositório.

## Projeto Supabase de desenvolvimento

| Campo | Valor |
| --- | --- |
| Projeto | **CRM Empreende IA** |
| Referência | `ldahvopyqkdiecchukwz` |
| URL | `https://ldahvopyqkdiecchukwz.supabase.co` |
| Organização Supabase | **HG - Aulas** (`jbsjxwtmdhewvpsygrum`), plano Free, custo informado de 0 por mês |
| Região | `sa-east-1` (São Paulo) |
| Painel | [supabase.com/dashboard/project/ldahvopyqkdiecchukwz](https://supabase.com/dashboard/project/ldahvopyqkdiecchukwz) |

Desde o item 0.1 do roteiro (11/10/2026), este é o **ambiente de desenvolvimento do dono**:

- não guarda dados reais;
- só recebe migrações depois do CI verde;
- nunca é usado em piloto, porque cada empresa usa uma instância própria.

### Estado registrado

- O projeto foi criado vazio em 06/09/2026, sem importar dados do sistema anterior, e recebeu só as migrações ativas. Ver [QA-CRM-SUPABASE.md](QA-CRM-SUPABASE.md).
- As oito migrações estão aplicadas, com RLS nas 19 tabelas. As versões das migrações locais correspondiam ao histórico remoto nessa data.
- Validação remota com contas fictícias de duas organizações: 105 verificações de Auth e PostgREST, 16 de interface com o banco real e 12 de recuperação de senha. As contas de QA foram removidas depois.
- O login por senha de contas confirmadas foi validado. A confirmação global de e-mail foi preservada; só as contas fictícias de QA receberam confirmação administrativa. A entrega de e-mail não foi testada.
- A conexão OAuth usada não tem `auth_config_read`: a leitura da configuração de Auth retornou 403, e nenhuma configuração de Auth foi alterada por esse caminho. Para configurar o Auth, usar o painel ou ampliar o escopo da conexão.
- O aceite técnico local de 06/09/2026 está registrado em [EXECUCAO-CRM.md](EXECUCAO-CRM.md).

### Arquivos locais

- `.env.local`, fora do Git, aponta para este projeto com a URL e a chave pública.
- Por isso, `npm run build` na máquina do dono embute essa URL em `dist/`. A pasta `dist/` fica fora do Git e do envio pela CLI da Vercel (`.vercelignore`). Nunca distribua a pasta do projeto por zip ou cópia: use o repositório.

## Repositório e publicação de desenvolvimento

O repositório de trabalho é `henriquegabriel-ia/crm-empreende-ia`. Até 11/10/2026 nenhum projeto de hospedagem foi criado e nenhuma URL foi publicada.

Valores para uma publicação de desenvolvimento na Vercel, que antes ficavam em `docs/PUBLICACAO-CRM.md`:

| Campo | Valor |
| --- | --- |
| Repositório | `henriquegabriel-ia/crm-empreende-ia` |
| Diretório raiz | Raiz do repositório |
| Framework | Vite |
| Instalação / build / saída | Definidos em `vercel.json` |
| `VITE_CRM_ENVIRONMENT` | `dedicated` |
| `VITE_SUPABASE_URL` | `https://ldahvopyqkdiecchukwz.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública do projeto de desenvolvimento, configurada pelo canal de ambiente |
| `VITE_SUPPORT_EMAIL` | Opcional, após definir o destino de suporte |

Ainda falta, nesse ambiente: definir a URL do frontend, configurar Site URL e redirecionamentos do Auth para ela e conferir a entrega de e-mails com SMTP próprio.

## Integração Fecha IA no ambiente do dono

O plano de correções e a ordem de ativação ficam em [INTEGRACOES-PENDENTES.md](../INTEGRACOES-PENDENTES.md#fecha-ia--crm). O estado das duas pontas no ambiente do dono era este:

### Estado em 11/10/2026

| Lado | Situação |
| --- | --- |
| CRM | PR #1 aberto, sem conflitos com `main` (mesclagem por fast-forward), 5 commits. As funções `fecha-ai-integration` e `manage-fecha-ai-connections` respondem 404 `NOT_FOUND` do gateway (não publicadas). Não há registro de aplicação da 9ª migração (`20260906075018_fecha_ai_review_receiver.sql`) no projeto `ldahvopyqkdiecchukwz`: os documentos do CRM citam oito migrações, mas o banco remoto não foi consultado diretamente. O frontend não tem hospedagem. |
| Fecha IA | Migrações `crm_review_delivery` e `crm_dispatch_expiry` e funções `crm-connection`, `crm-lookup` e `crm-review` publicadas em 06/09, segundo as evidências do repositório da Fecha IA. Em 11/10, o backend `cceinhchscphagyaokzb` respondeu, e as funções `crm-*` responderam pelo handler (401 sem sessão). Não há registro de que o secret `CRM_SUPABASE_URL` tenha sido definido: a evidência de 06/09 diz que nenhum secret foi alterado. O valor atual não foi conferido, porque isso exige acesso ao painel. |
| Ambos | Nunca houve chamada real entre os dois projetos; os testes de cada lado simulam o outro. Segundo os registros (Fecha IA em 06/09: nenhum usuário nem organização; CRM: contas de QA removidas), não há contas nem organizações reais para o primeiro envio. Site URL, retornos de Auth e SMTP continuam pendentes nos dois lados. O estado atual dos usuários não foi consultado. |

Parte dos documentos da Fecha IA está desatualizada. `PUBLICACAO-E-ACESSO.md` e as evidências de 16/09 e 03/10 registram o backend com ENOTFOUND, e o README ainda diz que a publicação das funções aguarda reconexão. README, `P4-CRM-CONTRACT.md`, `EXECUCAO-FECHA-IA.md`, `AUDITORIA-DE-CONCLUSAO.md` e `PILOTO-E-ATIVACAO.md` tratam o PR #1 como rascunho; só `PUBLICACAO-E-ACESSO.md` o descreve como aberto e pronto para revisão. Em 11/10, o backend respondia e o PR não era rascunho.

### Valores do ambiente do dono para a ativação

- Passo 4 da ativação: o secret `CRM_SUPABASE_URL` da Fecha IA recebe `https://ldahvopyqkdiecchukwz.supabase.co`, sem barra final nem caminho. Esse valor fica gravado na conexão e não pode mudar depois sem reconectar.
- Backend da Fecha IA: projeto Supabase `cceinhchscphagyaokzb`.

## Legado arquivado

O código e as migrações do sistema anterior saíram do repositório no item 0.3 do roteiro e ficam na tag anotada `legacy-archive`, criada no commit `aa94f71`, o último antes da limpeza:

- `.lovable/`: `consolidated_schema.sql`, um schema consolidado de outro produto ("CRM Imobiliário") cujas instruções mandam apagar `supabase/migrations`, e `plan.md`;
- `docs/legacy/`: migrações (`source-migrations`), funções (`source-functions`) e telas (`source-ui`) do sistema anterior, com o próprio `README.md`.

Para consultar sem restaurar nada no repositório:

```bash
git ls-tree -r --name-only legacy-archive -- .lovable docs/legacy
git show legacy-archive:docs/legacy/README.md
```

Nunca aplique essas migrações nem publique essas funções numa instância. A única fonte do schema é `supabase/migrations`.

A tag existe só no repositório local até `@devops` enviá-la ao remoto (`git push origin legacy-archive`). Os arquivos continuam no histórico do Git; o repositório de distribuição com histórico novo (item 1.7a) é que os deixa de fora para os alunos.
