# Configuração comercial e orientação

`CrmOnboardingProvider` monta uma fonte compartilhada de evidências e o `ProductTourProvider`. Ele envolve o shell autenticado no `AppLayout`, após os estados de sessão, erro de perfil e criação de organização. O guia é manual e bloqueia tours enquanto estiver aberto.

`CrmSetupChecklist`, na Ajuda, e `CrmSetupGuide` leem os mesmos resultados de `useCrmOnboarding`. Os seis critérios são:

1. Nome da organização e nome do perfil atual preenchidos.
2. Existência de funil e etapa da organização. O esquema comercial garante o vínculo da etapa ao funil por chave estrangeira composta. A empresa nasce com o funil Comercial, quatro etapas e as quatro regras da fila de atenção (`create_workspace`, por `private.provision_organization` desde o item 1.1), então este critério já começa verificado; o guia diz isso e manda ajustar nomes, ordem e probabilidades.
3. Base legal padrão dos contatos novos escolhida (item 1.10): `organizations.default_legal_basis` diferente de "Não informada". Vem antes do primeiro contato, porque o padrão vale para os contatos que vierem depois. Num banco sem a migração `20261013120000_contact_privacy.sql`, a etapa fica pendente, sem erro. As instâncias que já existiam começam com ela pendente.
4. Contato disponível na organização (cadastrado ou importado em Integrações).
5. Oportunidade disponível na organização.
6. Próxima ação: atividade pendente, com prazo e que não seja nota (tarefa, ligação, WhatsApp, e-mail, reunião ou visita, desde o item 1.9), o mesmo critério da próxima ação da ficha 360. Uma tarefa sem prazo não conta, e o texto da etapa avisa. O responsável não entra no critério: a etapa só o recomenda.

As consultas selecionam apenas `name`, `id` ou `default_legal_basis`, filtram organização e pessoa quando aplicável e retornam estados `done`, `pending` ou `error`. Falhas parciais ficam visíveis e não contam como conclusão. A Ajuda e a abertura do guia atualizam a verificação; a pessoa também pode usar **Verificar novamente**.

Nenhuma etapa é concluída por avançar no guia ou assistir a um tour. Não há gravação em `profiles.onboarding_completed` nem na antiga estrutura de `onboarding_progress`. Apenas a posição do guia (`version`, `stepId`) fica no navegador, com chave por usuário e organização e fallback em memória. Isso não representa configuração concluída.

O evento `empreende-crm:open-onboarding` abre o guia manualmente em Configurações (aba Preferências, **Configurar meu CRM**). O mesmo fluxo é acessível pela Ajuda e pelas ações rápidas. As ações levam aos formulários reais: `/settings?tab=organization`, `/settings?tab=profile`, `/settings?tab=pipelines`, `/contacts`, `/pipeline` e `/tasks`. Esc e fechar preservam a posição; trocar de rota, organização ou conta fecha o guia.

O shell expõe `TourLauncher` no cabeçalho em desktop e celular. Busca usa `ShellContext`; o Copiloto usa `empreende-crm:open-copilot`. Ações rápidas de criação respeitam `useCrmPermissions` e os contratos atuais de rota.

As etapas de funis e da base legal são marcadas `admin`: para colaboradores e quem tem acesso somente leitura, **Configurar funis** e **Escolher a base legal** ficam desabilitados, cada um com o aviso da etapa (`adminNotice`, em `setup-state.ts`): "Funis e etapas são configurados por donos e administradores…" e "A base legal padrão é escolhida por donos e administradores…". A primeira etapa lembra que donos e administradores convidam a equipe em “Equipe”, porque desde o item 1.1 a entrada é só por convite. Os textos das etapas seguem as regras da [Central de ajuda](../help/README.md): pt-BR simples, quem pode fazer o quê e as telas e abas a que levam entre aspas curvas (“Equipe”, “Configurações”, “Funis”, “Organização”, “Integrações”). `setup-state.test.ts` confere que cada um desses nomes aparece inteiro na tela a que a etapa leva (Equipe, Configurações e Integrações), sem contar comentários, a Ajuda e os tours (`src/test/ui-labels.ts`), e que as citações são exatamente essas cinco; o botão de cada etapa é o próprio guia e fica fora da conferência.

Validação automatizada cobre derivação dos critérios, erros, escopo das consultas, guia manual, Esc/foco/retomada, troca de organização, permissões, navegação real, catálogo na Ajuda, fechamento entre diálogos e bloqueio de tours. As consultas reais e o comportamento visual devem integrar o teste do ambiente comercial.
