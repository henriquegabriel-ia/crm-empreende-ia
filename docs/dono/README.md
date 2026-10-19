# Registros do dono do produto

Esta pasta guarda registros do **ambiente do dono do produto**: o projeto Supabase de desenvolvimento, as validações feitas nele, o histórico da execução e o plano original. São registros internos, **fora da distribuição aos alunos**. Uma instância de empresa não depende de nada daqui.

Quem implanta o CRM para uma empresa deve seguir o [README da raiz](../../README.md) e o [Guia de implantação](../IMPLANTACAO.md) (item 1.4 do [roteiro](../ROADMAP-FINALIZACAO.md)).

## Conteúdo

| Arquivo | O que registra |
| --- | --- |
| [AMBIENTE.md](AMBIENTE.md) | Fatos do ambiente do dono: projeto Supabase de desenvolvimento, organização, repositório de trabalho, valores de publicação de desenvolvimento e estado da integração Fecha IA nesse ambiente |
| [EXECUCAO-CRM.md](EXECUCAO-CRM.md) | Execução de 06/09/2026: decisões de domínio, frentes entregues e evidências do aceite técnico local |
| [QA-CRM-SUPABASE.md](QA-CRM-SUPABASE.md) | Validação do projeto Supabase de desenvolvimento com Auth e PostgREST reais |
| [QA-CRM-BROWSER.md](QA-CRM-BROWSER.md) | Verificação no navegador com fixtures, de 06/09/2026 |
| [PILOTO-CRM.md](PILOTO-CRM.md) | Roteiro do primeiro piloto com participantes, ainda não realizado |
| [PLANO-CRM.md](PLANO-CRM.md) | Plano de produto, UX e tours, com a inspeção do código de origem |
| [ENTREGA-REDESIGN.md](ENTREGA-REDESIGN.md) | Entrega inicial do redesign com o Design System |
| [previews/](previews/) | Capturas de tela com dados fictícios usadas em `EXECUCAO-CRM.md` |

Os documentos registram o estado da data em que foram escritos. Os números atuais da suíte de testes estão no [README da raiz](../../README.md#validação) e no [roteiro](../ROADMAP-FINALIZACAO.md).

## Regras

- Fatos do ambiente do dono (referência do projeto Supabase, organização, contas, contagens de validação remota e caminhos locais) ficam só nesta pasta. README, `DESIGN.md` e os demais documentos de `docs/` usam marcadores como `<SEU_PROJECT_REF>`, `<SUA_URL>` e `<SEU_REPOSITORIO>`.
- O repositório de distribuição aos alunos (item 1.7a do roteiro) não leva esta pasta. Os links para ela nos documentos distribuídos (README, `DESIGN.md` e roteiro) saem junto na geração da distribuição.
- O código e as migrações do sistema anterior não estão mais no repositório: ficam na tag `legacy-archive` (ver [AMBIENTE.md](AMBIENTE.md#legado-arquivado)).
