# Desenhos de arquitetura

Desenhos técnicos finais dos itens do [roteiro de finalização](../ROADMAP-FINALIZACAO.md) que pedem decisão de `@architect` antes do código. Cada arquivo leva o número do item e reúne objetivo, critérios de aceite, modelo de dados, RPCs, fluxos de tela, casos de borda, caminho de atualização, alternativas descartadas, riscos, plano de testes e pendências de pessoas.

O desenho orienta a implementação (`@dev`) e a revisão (`@qa`). Se a implementação precisar mudar uma decisão, o arquivo é atualizado no mesmo commit, com o motivo.

| Item | Desenho | Estado |
| --- | --- | --- |
| 1.1 Empresa única com entrada só por convite | [1.1.md](1.1.md) | Implementado em 12/10/2026 (seção 15: ajustes da implementação); reforço desenhado e implementado em 12/10/2026 (seção 16: a conta só ganha papel depois de provar o e-mail; ajustes da implementação na seção 16.18 e revisões nas 16.19, 16.20 e 16.21, esta de 13/10/2026: links do e-mail só usados depois de "Continuar", código do e-mail e gatilhos sem dependência de coluna) |
| 1.2 Desativar membro e transferir a carteira | [1.2.md](1.2.md) | Desenhado e implementado em 13/10/2026 (seção 16: ajustes da implementação; revisão de 13/10/2026 na 16.6: travas da carteira em `FOR NO KEY UPDATE`, corridas verificadas no runner e textos sem gênero) |

Próximo desenho previsto pelo roteiro: 1.16 (catálogo de produtos e serviços).
