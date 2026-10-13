# Desenhos de arquitetura

Desenhos técnicos finais dos itens do [roteiro de finalização](../ROADMAP-FINALIZACAO.md) que pedem decisão de `@architect` antes do código. Cada arquivo leva o número do item e reúne objetivo, critérios de aceite, modelo de dados, RPCs, fluxos de tela, casos de borda, caminho de atualização, alternativas descartadas, riscos, plano de testes e pendências de pessoas.

O desenho orienta a implementação (`@dev`) e a revisão (`@qa`). Se a implementação precisar mudar uma decisão, o arquivo é atualizado no mesmo commit, com o motivo.

| Item | Desenho | Estado |
| --- | --- | --- |
| 1.1 Empresa única com entrada só por convite | [1.1.md](1.1.md) | Implementado em 12/10/2026 (seção 15: ajustes da implementação); reforço desenhado e implementado em 12/10/2026 (seção 16: a conta só ganha papel depois de provar o e-mail; ajustes da implementação na seção 16.18 e revisões nas 16.19, 16.20 e 16.21, esta de 13/10/2026: links do e-mail só usados depois de "Continuar", código do e-mail e gatilhos sem dependência de coluna) |
| 1.2 Desativar membro e transferir a carteira | [1.2.md](1.2.md) | Desenhado e implementado em 13/10/2026 (seção 16: ajustes da implementação; revisão de 13/10/2026 na 16.6: travas da carteira em `FOR NO KEY UPDATE`, corridas verificadas no runner e textos sem gênero) |
| 1.6 Identidade da empresa por configuração | [1.6.md](1.6.md) | Desenhado e implementado em 13/10/2026: marca em `public/brand/brand.json` (frontend e e-mails), crédito por `showBaseCredit` e `VITE_SHOW_BASE_CREDIT`, sem migração; inclui os 9 achados de baixa severidade do 1.2 (seção 16: ajustes da implementação, com a pergunta do crédito na Ajuda só onde ele aparece e os testes que dependiam da marca da instância) |
| 1.9 Canais nível 1 com registro | [1.9.md](1.9.md) | Desenhado e implementado em 13/10/2026: WhatsApp, e-mail e telefone por link, com o registro oferecido (pendências "Para registrar", sem duplicar), `complete_activity`, tipos `whatsapp` e `visit`, resultado da ligação, "Não contatar" e modelos com variáveis; inclui os 8 achados de baixa severidade do 1.6 (seção 13). Seção 17: ajustes da implementação (faixa "Para registrar" centralizada no desktop e com espaço reservado, botão do canal pela própria barra) e a revisão de 13/10/2026 (rodada 1: nova tentativa depois de um conflito com a versão relida, edição de ligação num banco sem a migração, linha do tempo pela data do fato) |

Próximo desenho previsto pelo roteiro: 1.16 (catálogo de produtos e serviços).
