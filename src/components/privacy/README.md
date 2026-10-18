# Privacidade e LGPD

Os componentes desta pasta ajudam a empresa que usa o CRM, a controladora, a atender a LGPD (item 1.10 do [roteiro](../../../docs/ROADMAP-FINALIZACAO.md); desenho em [docs/arquitetura/1.10.md](../../../docs/arquitetura/1.10.md)): a base legal de cada contato, a exportação dos dados de uma pessoa a pedido dela, a anonimização e o registro de quem fez cada uma. As regras valem no banco (`supabase/migrations/20261013120000_contact_privacy.sql`); a tela explica e desabilita antes do pedido. O que a instância precisa fora do CRM (papéis, aviso de privacidade, termo entre quem implanta e a empresa) está em [docs/LGPD-INSTANCIA.md](../../../docs/LGPD-INSTANCIA.md).

## Componentes

| Arquivo | O que faz | Quem vê |
| --- | --- | --- |
| `LegalBasisFields.tsx` | O grupo "Privacidade" do cadastro do contato (`RecordEditor`): "Base legal" e o registro dela ("Como a pessoa consentiu \*" no consentimento, "Registro da base legal (opcional)" nas demais), com a dica ligada ao campo e o carimbo do banco na edição. Na criação, a primeira opção é "Padrão da empresa: …" e nada é enviado se ela ficar; "Não informada" fica de fora, porque o banco a troca pelo padrão | Quem edita |
| `LegalBasisSummary.tsx` | A linha "Base legal" do resumo da ficha 360, com o registro e o carimbo; "Não informada" vem com "Defina em “Editar cadastro”." para quem edita | Todos os papéis |
| `ContactPrivacySection.tsx` | A seção "Privacidade" da ficha 360 (`data-tour="360-privacy"`), antes de "Excluir cadastro": "Exportar dados deste contato", "Anonimizar contato" e o último registro de `privacy_actions` | Donos e administradores, num contato não anonimizado |
| `ExportContactDialog.tsx` | A confirmação da exportação, com o cuidado antes de enviar; chama `export_contact_data`, monta o `.zip` e baixa com o nome da marca | Donos e administradores |
| `AnonymizeContactDialog.tsx` | O resumo (`contact_privacy_summary`), o que sai e o que fica, os avisos, "Esta ação não pode ser desfeita." e a palavra ANONIMIZAR digitada; chama `anonymize_contact` com a versão do resumo | Donos e administradores |
| `AnonymizedBanner.tsx` | A faixa "Contato anonimizado" da ficha, no tom neutro, com quem anonimizou e quando | Todos os papéis |
| `PrivacyActionsTable.tsx` | "Exportações e anonimizações" em "Segurança": quando, a ação, o contato atual (com link) e quem fez (com "(desativado)" para quem saiu da equipe), 30 por página | Donos e administradores; os demais leem o aviso |
| `data.ts` | As três RPCs, as leituras de `privacy_actions`, o padrão da base legal da empresa, a planilha de contatos, os hooks, as chaves e as invalidações | — |
| `stamp.ts`, `anonymization-text.ts` | O carimbo do banco em texto ("Registrada por Ana Lima em 12/10/2026.") e os textos da anonimização, com singular e plural | — |

As regras puras ficam em `src/lib`: `privacy.ts` (rótulos, a gravação da base legal só com o que mudou, a recusa de "Não contatar", o congelamento do anonimizado, a leitura das respostas), `contact-export.ts` (o pacote: LEIA-ME, `dados.json` e as quatro planilhas) e `zip.ts` (o `.zip` sem compressão, sem dependência nova).

## Regras de tela

- **A base legal é do banco**: a data e o autor vêm do gatilho, e a tela nunca os envia. A gravação manda `legal_basis` e `legal_basis_note` só quando mudam, e num banco sem a migração (o contato lido não tem a coluna) o grupo some e criar e editar continuam como antes. Consentimento sem registro é recusado na tela, com o erro ligado ao campo, e pelo `CHECK` (23514, traduzido para "Descreva como a pessoa consentiu.").
- **O padrão da empresa** fica em "Configurações", na aba "Organização" ("Base legal padrão dos contatos novos"), gravado no mesmo "Salvar organização" só quando muda; consentimento não pode ser o padrão. O guia "Configurar CRM" tem a etapa `privacy`.
- **Exportar e anonimizar** são só de donos e administradores, nas telas e nas RPCs. O arquivo exportado não leva o nome da pessoa no nome (`dados-contato-<8 primeiros do id>-<marca>-<data>.zip`, por `exportFileName`) nem nomes da equipe no conteúdo. Leva as atividades e os recebimentos das oportunidades da pessoa ligados a outro contato, com o nome, o e-mail e o telefone gravados no cadastro desse contato (cada número do campo) trocados por "[anonimizado]" pelo banco (o registro de interação do 1.9 grava "Ligação para <nome>"); o diálogo, o LEIA-ME e a Ajuda dizem isso, e a confirmação pede a revisão do resto do texto, onde um apelido ou um telefone antigo continuam.
- **A anonimização** só se habilita com o resumo carregado e a palavra digitada (sem diferenciar maiúsculas e sem os espaços das pontas). A recusa "Este contato mudou desde o resumo…" recarrega o resumo e limpa a palavra; o aviso de sucesso usa as contagens devolvidas, que podem ser maiores que as do resumo.
- **O contato anonimizado** fica congelado: a ficha mostra a faixa, sem canais, sem "Editar cadastro", sem "Criar ação", sem "Registrar nota" e sem a seção "Privacidade"; as atividades dele (em todas as listas e no detalhe) ficam sem "Editar" e sem "Reabrir" (`isFrozenActivity`); os seletores de contato das atividades, das oportunidades e dos recebimentos deixam ele de fora (`linkableContacts`); o diretório mostra a etiqueta "Anonimizado".
- **As recusas do banco (P0001)** aparecem como estão (`privacyErrorMessage`, `relationshipError`); num banco sem a migração, `PRIVACY_MIGRATION_MISSING` (`src/lib/rpc-errors.ts`).
- **Celular**: os diálogos têm `max-h-[92dvh]` com rolagem interna, e os botões, `.eia-touch-target` (44 px).

## O que testar ao mexer aqui

- Unitários: `src/lib/privacy.test.ts`, `contact-export.test.ts`, `zip.test.ts`, os testes desta pasta (`data.test.ts`, `helpers.test.ts` e `PrivacyDialogs.test.tsx`: o `.zip` lido de volta por `src/test/zip-reader.ts`, a recusa, a palavra, a versão do resumo e o conflito) e os das telas que os usam (`RecordEditor`, `Relationship360`, `Settings`, `SecuritySettings`, `ActivityList`, `ActivityDetail`).
- Banco: `supabase/tests/privacy.sql` e as corridas `anonymizationRace` e `anonymizationVolume` de `scripts/test-database.mjs`, no `npm run test:db`.
- E2E: `tests/browser/privacy.spec.ts`, no desktop e no celular: a base legal, o padrão da empresa, a exportação (o arquivo baixado lido pelo leitor do teste), a anonimização com o conflito, os papéis, "Já aconteceu", a planilha de contatos e o layout a 320, 375 e 1440 px, claro e escuro.
- Ajuda: a categoria "Privacidade e LGPD" da [Central](../help/README.md) cita os nomes destes componentes, conferidos por `faq-content.test.ts`.
