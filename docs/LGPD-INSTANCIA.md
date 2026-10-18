# LGPD da instância do CRM

> **Rascunho para revisão jurídica.** Este documento e os modelos abaixo não são aconselhamento jurídico e precisam ser revisados por um advogado antes do uso. Cada empresa responde pelo tratamento que faz.

Este guia é para quem implanta o CRM para uma empresa e para a empresa que o usa. Ele diz quem é quem na Lei 13.709/2018 (LGPD), que dados pessoais a instância guarda, o que o CRM oferece para atender os pedidos das pessoas e o que fica fora dele, e traz modelos de aviso de privacidade e de termo entre as partes. O desenho técnico está em [docs/arquitetura/1.10.md](arquitetura/1.10.md); as telas, em [src/components/privacy](../src/components/privacy/README.md).

## 1. Papéis

- **A empresa que usa o CRM é a controladora** (art. 5º, VI): ela decide por que e como os dados das pessoas são tratados e responde por isso. Dentro do CRM, quem age por ela são as pessoas da equipe, conforme o papel (Dono, Administrador, Colaborador e Somente leitura).
- **Quem implanta o CRM (o aluno da Empreende IA) é operador** (art. 5º, VII) quando hospeda ou opera a instância pela empresa: as contas do Supabase e da hospedagem são dele, ou ele acessa os dados para dar suporte. Quando as contas são da empresa e ele não acessa os dados, ele é só fornecedor do software, e não operador.
- **A Empreende IA, que distribui a base do CRM, não trata dados de nenhuma instância**: o CRM não envia telemetria nem dados para a Empreende IA.
- **Suboperadores típicos**, a listar no termo e no aviso de privacidade:
  - **Supabase**: banco de dados e autenticação (Auth). A região é escolhida na criação do projeto; para dados de pessoas no Brasil, prefira São Paulo. O Supabase oferece um acordo de tratamento de dados (DPA) e publica a lista dos próprios suboperadores.
  - **Hospedagem do frontend** (a Vercel, decisão D2 do roteiro): serve os arquivos do CRM e registra os acessos ao site.
  - **Provedor de SMTP**: só os e-mails de acesso da equipe (confirmação, link de acesso, senha). O CRM não envia e-mail aos contatos.
- **WhatsApp, Google e Microsoft** entram quando alguém da equipe abre um canal pelo CRM: o número, o e-mail e o texto vão para essas ferramentas, que são da empresa ou da própria pessoa da equipe, como se a pessoa os digitasse lá, e o navegador guarda o histórico desses links. O CRM não guarda o texto enviado (item 1.9).

## 2. Mapa de dados da instância

| Dado | Onde fica | Quem lê no CRM | Por quanto tempo |
| --- | --- | --- | --- |
| Contatos: nome, e-mail, telefone, cargo, origem, observações, base legal e o registro dela, "Não contatar" com o motivo (pela tela ou pela importação de planilha, com quem importou como autor) | Tabela `contacts` | Todos os papéis da equipe | Até a empresa excluir o cadastro ou anonimizar o contato |
| Empresas: nome, segmento, site, telefone e "Não contatar" (dados de pessoa jurídica, que podem ser de uma pessoa no caso do MEI) | `companies` | Todos os papéis | Até a exclusão |
| Atividades e anotações: ligações, WhatsApp, e-mails, reuniões, visitas, tarefas e notas, com o resultado da ligação | `activities` | Todos os papéis | Até a exclusão ou a anonimização do contato |
| Oportunidades e recebimentos, com títulos e descrições digitados pela equipe | `deals`, `payments` | Todos os papéis | Até a exclusão; a anonimização tira os dados da pessoa e mantém os valores |
| Equipe: nome, e-mail, papel, convites e auditoria das alterações | `profiles`, `user_roles`, `invitations`, `audit_logs`, Auth do Supabase | Donos e administradores (a auditoria e os convites) | Enquanto a empresa mantiver a instância |
| Registros de privacidade: quem exportou ou anonimizou os dados de um contato, quando e as contagens | `privacy_actions` | Donos e administradores | Enquanto a empresa mantiver a instância |

A base do CRM não apaga nada sozinha: não há prazo de guarda automático. A empresa define a retenção (o que guardar, por quanto tempo e por quê) e a aplica com "Excluir cadastro" e "Anonimizar contato". A retenção automática é do item 2B.8 do roteiro.

## 3. Bases legais

Cada contato tem uma "Base legal" (art. 7º). O CRM grava a escolha, a data e quem registrou, e quem escolhe é a empresa:

| No CRM | Quando costuma valer | Cuidados |
| --- | --- | --- |
| Não informada | Contatos antigos, ainda sem análise | Não é uma base legal: revise esses contatos. |
| Consentimento | Marketing para quem pediu para receber, formulário com caixa de aceite | O CRM exige o registro de como e quando a pessoa aceitou ("Como a pessoa consentiu"): a empresa precisa provar o consentimento (art. 8º, § 2º). A pessoa pode retirar o consentimento a qualquer momento. |
| Contrato ou pedido da pessoa | Clientes, pedidos de orçamento e propostas feitos pela própria pessoa | Vale para o que é necessário ao contrato ou ao pedido. |
| Legítimo interesse | Prospecção de empresas (B2B), relacionamento com clientes antigos | Exige avaliação da empresa (art. 10) e respeito ao direito de oposição: quem pedir para não ser procurado é marcado "Não contatar". |
| Obrigação legal | Dados guardados por exigência de lei, como notas fiscais e cobranças | Indique a obrigação no registro. |
| Exercício de direitos | Dados guardados para defesa num processo ou numa cobrança | Indique o caso no registro. |

**O padrão da empresa.** Em "Configurações", na aba "Organização", donos e administradores escolhem a "Base legal padrão dos contatos novos". O banco a aplica a todo contato novo sem outra escolha, inclusive os importados por planilha sem base legal (sem a coluna `base_legal`, com ela vazia ou com "Não informada", que a exportação escreve para quem não tem base; a prévia da importação avisa quantos recebem o padrão) e os que chegam por integração. A planilha pode trazer a base (`base_legal`, pelo nome ou pelo código), o registro (`registro_base_legal`, obrigatório no consentimento) e a marca "Não contatar" (`nao_contatar`, só nos contatos novos: a importação não muda um contato já cadastrado, e a prévia avisa quando uma linha repetida pede a marca que o cadastro não tem, para marcar na ficha); quem importa fica como autor do registro, e a prévia avisa quantos contatos chegam com consentimento, para conferir se o registro prova o aceite. Consentimento não pode ser o padrão, porque depende do registro de cada pessoa. Mudar o padrão não altera os contatos que já existem. Os contatos das instâncias anteriores ao item 1.10 começam como "Não informada". Confira a escolha com quem cuida do jurídico da empresa.

## 4. Direitos do titular e como atender no CRM

| Direito (art. 18) | Como atender |
| --- | --- |
| Confirmação e acesso (art. 19) | Na ficha do contato, donos e administradores usam "Exportar dados deste contato". O CRM gera um `.zip` com um LEIA-ME, os dados em JSON e planilhas do cadastro, das atividades, das oportunidades e dos recebimentos, sem os nomes da equipe, e registra quem exportou e quando. Vão também as atividades e os recebimentos das oportunidades da pessoa ligados a outros contatos, com o nome, o e-mail e o telefone gravados no cadastro desses contatos (cada número do campo de telefone) trocados por "[anonimizado]". Um telefone antigo ou que não está no cadastro continua no texto. A LGPD prevê o formato simplificado na hora ou a declaração completa em até 15 dias. |
| Correção | "Editar cadastro", por quem edita: o nome, o e-mail, o telefone, a empresa, o cargo, a origem, as observações, o responsável e a base legal com o registro. |
| Anonimização, bloqueio ou eliminação | "Anonimizar contato" (donos e administradores) apaga os dados pessoais e mantém o histórico comercial sem nomes, também num contato sem vínculos, e fica registrada em "Exportações e anonimizações". Não há volta. "Excluir cadastro" remove só o cadastro sem vínculos: não tira o nome da pessoa dos outros registros e não fica em "Exportações e anonimizações" (só no "Histórico de alterações", em "Segurança", com quem excluiu e quando), então não atende sozinho o pedido de exclusão. |
| Portabilidade | O `dados.json` do pacote exportado, num formato que outro sistema consegue ler. |
| Oposição e revogação do consentimento | "Marcar como não contatar" e a troca da base legal em "Editar cadastro". Com a marca, o CRM recusa agendar ligação, WhatsApp, e-mail, reunião ou visita para a pessoa. |
| Informação sobre o compartilhamento | O aviso de privacidade da empresa (seção 9). |

**Procedimento sugerido para cada pedido:**

1. Confirme a identidade de quem pediu (por exemplo, pelo e-mail ou telefone já cadastrados). O CRM não verifica identidade.
2. Registre o pedido fora do CRM, com a data, o pedido e a resposta (uma planilha da empresa basta). O CRM registra as exportações e anonimizações, mas não os pedidos.
3. Para acesso, exporte e revise o arquivo antes de enviar: anotações internas podem ter segredo comercial (art. 19 e 18) ou dados de outras pessoas que o CRM não reconhece (apelidos, nomes digitados nas anotações, um telefone antigo). Nos registros ligados a outro contato, o CRM já troca o nome, o e-mail e o telefone gravados no cadastro dele.
4. Responda por um canal seguro e apague o arquivo do seu computador depois.
5. Para exclusão, prefira "Não contatar" quando a pessoa só pediu para não ser procurada; anonimize quando ela pediu a exclusão dos dados. Revise antes os títulos das oportunidades e dos recebimentos (seção 5).

## 5. O que a anonimização alcança e o que não alcança

"Anonimizar contato" roda no banco, numa transação só, e não tem volta:

| Registro | O que muda | O que fica |
| --- | --- | --- |
| O contato | Vira "Contato anonimizado": saem o sobrenome, o e-mail, o telefone, o cargo, as observações, o vínculo com a empresa (a empresa continua cadastrada), o motivo do "Não contatar" e o registro da base legal. "Não contatar" fica ligado. | A situação (lead, cliente…), o responsável, a base legal (sem o registro) e a data de criação |
| Atividades com a pessoa | As concluídas e as notas ficam com o título pelo tipo ("Ligação (contato anonimizado)") e sem detalhes; as pendentes são excluídas | Tipo, resultado, datas e responsável |
| Oportunidades e recebimentos da pessoa | O nome, o e-mail e o telefone dela viram "[anonimizado]" nos títulos e descrições, e o vínculo com o contato sai | Valores, situações, etapas, datas e responsáveis: os relatórios mantêm os números |
| O resto do CRM | O nome completo, o e-mail e o telefone viram "[anonimizado]" onde aparecem: atividades, oportunidades, recebimentos, as observações, a origem, o cargo, o registro da base legal e o motivo do "Não contatar" de outros contatos, e o motivo do "Não contatar" das empresas | O primeiro nome sozinho não é trocado, para não apagar outras pessoas. Perto do limite de 500 caracteres, o fim do registro da base legal e do motivo do "Não contatar" de outros cadastros pode ser cortado, marcado com "…" (a troca pelo marcador pode passar do limite) |
| Auditoria (`audit_logs`) | Nada: a auditoria guarda só os nomes dos campos alterados, nunca os valores | As linhas antigas apontam para o id do "Contato anonimizado" |

**O que a anonimização não alcança**, e precisa estar na política da empresa:

- **Apelidos, nome abreviado, CPF, um telefone antigo ou que não está no cadastro e outros dados digitados nos títulos**: não são reconhecidos. O CRM procura o nome, o e-mail e cada número do telefone gravados no cadastro (com ou sem acentos, DDD e separadores). O diálogo de anonimização pede para revisar antes.
- **Cópias de segurança**: no plano Free do Supabase não há cópia automática, e o `db dump` do item 1.5 do roteiro fica com quem o guardou; no plano Pro, as cópias diárias ficam 7 dias; com PITR, conforme o contratado. Essas cópias guardam o estado anterior até expirarem. **Se uma cópia for restaurada, refaça as anonimizações feitas depois dela**: por isso a lista de pedidos atendidos fica fora do CRM.
- **Registros do Supabase** (API e banco): podem guardar o caminho dos pedidos e mensagens de erro, conforme o plano e por pouco tempo. O CRM grava os dados no corpo dos pedidos, e não na URL.
- **Arquivos exportados** (planilhas, calendário, o pacote do titular): ficam no computador de quem exportou.
- **WhatsApp, Gmail, Outlook e o discador**: as conversas ficam nesses aplicativos.
- **O navegador de cada pessoa da equipe**: as pendências "Para registrar" (só ids), as visões salvas (o texto da busca pode ter um nome) e a memória da página aberta, que some ao recarregar.
- **Empresas**: a anonimização vale para contatos, que são pessoas. Se a empresa for a própria pessoa (um MEI com o nome dela), edite ou exclua o cadastro da empresa à mão. A anonimização de empresas é do item 2B.8.

## 6. Segurança da instância

- Cada dado tem a organização gravada e é protegido por RLS no banco; cada pessoa da equipe vê o que o papel dela permite. Exportar, anonimizar e escolher a base legal padrão são de donos e administradores.
- A entrada é só por convite (item 1.1), e quem sai da equipe é desativado (item 1.2), com a carteira passada a outra pessoa.
- A auditoria registra quem alterou o quê, sem os valores; os registros de privacidade, quem exportou e quem anonimizou.
- Ative a autenticação em dois fatores (MFA) nas contas do Supabase e da hospedagem de quem implanta e de quem administra.
- Para dados reais, use um plano pago do Supabase, com cópias de segurança (premissa 4 e item 1.5 do roteiro). O recomendado é a conta ser da empresa; se a instância ficar nas contas de quem implanta, ele é operador, e o termo da seção 10 registra isso.
- Chaves privilegiadas (`service_role`, `sb_secret_`) nunca vão para o frontend nem para variáveis `VITE_`.

## 7. Incidentes

- **Quem avisa**: a controladora (a empresa) comunica à ANPD e às pessoas afetadas um incidente que possa trazer risco ou dano relevante (art. 48), no prazo da regra vigente da ANPD (referência a conferir: Resolução CD/ANPD nº 15/2024).
- **O operador** (quem implanta) avisa a empresa sem demora, com o que sabe: o que aconteceu, quando, que dados e quantas pessoas.
- **Onde olhar**: os registros do Supabase (API, Auth e banco), a auditoria do CRM em "Segurança" e os registros de acesso da hospedagem.

## 8. Encarregado e canal do titular

A LGPD pede a indicação de um encarregado (art. 41). A Resolução CD/ANPD nº 2/2022 dispensa os agentes de tratamento de pequeno porte dessa indicação, mas exige um canal de comunicação com os titulares. Confira com a revisão jurídica se a empresa se enquadra e publique o canal (um e-mail de privacidade, por exemplo) no aviso de privacidade.

## 9. Modelo de aviso de privacidade

> Rascunho para revisão jurídica. Troque os marcadores entre `< >` e apague o que não se aplica.

**Aviso de privacidade de `<EMPRESA>`**

1. **Quem somos.** `<EMPRESA>`, `<CNPJ>`, com sede em `<ENDEREÇO>`, é a controladora dos dados pessoais tratados no relacionamento comercial descrito aqui. Contato de privacidade: `<CANAL DE PRIVACIDADE>`.
2. **Que dados tratamos.** Nome, e-mail, telefone, cargo, empresa em que você trabalha, a origem do contato, o histórico das nossas conversas (ligações, mensagens, e-mails, reuniões e visitas), as propostas e os pagamentos ligados a você.
3. **Para que usamos.** Para responder aos seus pedidos, apresentar e negociar nossos produtos e serviços, cumprir contratos, cobrar e manter o relacionamento comercial.
4. **Bases legais.** `<LISTE AS BASES USADAS, POR EXEMPLO: execução de contrato ou de procedimentos preliminares a seu pedido; legítimo interesse na prospecção e no relacionamento, com o seu direito de oposição; consentimento para o envio de novidades, quando você o der; cumprimento de obrigação legal>`.
5. **Com quem compartilhamos.** Com os fornecedores que operam nossos sistemas: `<SUPABASE (banco de dados e autenticação), HOSPEDAGEM, PROVEDOR DE E-MAIL, QUEM IMPLANTOU E MANTÉM O SISTEMA>`. Quando falamos com você pelo WhatsApp ou por e-mail, seus dados de contato e a mensagem passam por esses aplicativos (`<WhatsApp, Google, Microsoft>`).
6. **Transferência internacional.** Nossos dados ficam na região `<REGIÃO>` do Supabase. `<DESCREVA AS TRANSFERÊNCIAS INTERNACIONAIS DOS FORNECEDORES E A HIPÓTESE DO ART. 33 USADA, CONFORME A RESOLUÇÃO CD/ANPD Nº 19/2024>`.
7. **Por quanto tempo.** Enquanto durar o relacionamento e, depois, pelo prazo de `<PRAZO>` ou pelo exigido em lei. Depois disso, excluímos ou anonimizamos os dados.
8. **Seus direitos.** Você pode pedir a confirmação e o acesso aos seus dados, a correção, a anonimização ou a eliminação, a portabilidade, a informação sobre o compartilhamento, a revogação do consentimento e se opor ao tratamento, pelo `<CANAL DE PRIVACIDADE>`. Podemos pedir uma confirmação da sua identidade. Respondemos em até `<PRAZO>` dias. Você também pode reclamar à ANPD.
9. **Segurança.** Usamos controle de acesso por pessoa e por função, registro das alterações e fornecedores com medidas de segurança.
10. **Atualizações.** Este aviso pode mudar; a versão vigente fica em `<ENDEREÇO DO AVISO>`, com a data da última atualização: `<DATA>`.

## 10. Modelo de termo entre quem implanta e a empresa cliente

> Rascunho para revisão jurídica. Serve quando quem implanta (o operador) hospeda ou opera a instância. Quando as contas são da empresa e quem implanta não acessa os dados, adapte o termo a um contrato de fornecimento de software.

**Termo de tratamento de dados pessoais**

Entre `<EMPRESA>`, `<CNPJ>`, controladora, e `<IMPLANTADOR>`, `<CPF OU CNPJ>`, operador.

1. **Objeto e papéis.** O operador implanta, hospeda e mantém a instância do CRM da controladora (`<SUA_URL>`) e trata os dados pessoais nela só para isso. A controladora decide as finalidades e as bases legais.
2. **Instruções.** O operador trata os dados só conforme as instruções documentadas da controladora, inclusive este termo, e avisa se uma instrução lhe parecer contrária à lei.
3. **Confidencialidade.** O operador e quem age por ele guardam sigilo sobre os dados, também depois do fim deste termo.
4. **Segurança.** O operador mantém, no mínimo, estas medidas ou outras equivalentes: isolamento dos dados por organização no banco e acesso de cada pessoa conforme o papel; registro das alterações e das exportações e anonimizações; entrada da equipe só por convite e desativação imediata de quem sai; autenticação em dois fatores nas contas de administração do banco e da hospedagem; chaves privilegiadas fora do site e do navegador; atualizações do sistema aplicadas; e cópias de segurança no plano combinado (`<PLANO E RETENÇÃO DAS CÓPIAS>`).
5. **Suboperadores.** Ficam autorizados `<SUPABASE, HOSPEDAGEM, PROVEDOR DE SMTP>`. O operador avisa a controladora com `<N>` dias de antecedência antes de trocar ou acrescentar um suboperador, e a controladora pode se opor.
6. **Transferência internacional.** `<REGIÃO DO PROJETO E HIPÓTESE DO ART. 33>`.
7. **Apoio aos titulares.** O operador apoia a controladora no atendimento dos pedidos das pessoas, com as ferramentas do CRM ("Exportar dados deste contato", "Anonimizar contato", "Não contatar"), e não responde a um titular sem a autorização da controladora.
8. **Incidentes.** O operador avisa a controladora em até `<N>` horas depois de saber de um incidente, com as informações disponíveis, e ajuda na comunicação à ANPD e às pessoas afetadas.
9. **Registro.** O operador mantém o registro das operações que faz na instância (acessos de suporte, migrações, restaurações).
10. **Término.** No fim do termo, o operador entrega os dados à controladora (por `db dump` ou transferência do projeto) e, depois da confirmação, exclui o projeto, as cópias e os arquivos que tiver, salvo obrigação legal.
11. **Auditoria.** A controladora pode pedir as informações necessárias para conferir este termo, com aviso de `<N>` dias.
12. **Responsabilidades e foro.** `<RESPONSABILIDADES DE CADA PARTE (ART. 42 A 45)>`. Foro de `<CIDADE>`.

Local e data: `<CIDADE>`, `<DATA>`. Assinaturas: `<CONTROLADORA>` e `<OPERADOR>`.

## 11. Checklist LGPD da implantação

- [ ] Contas do Supabase e da hospedagem: da empresa (recomendado) ou de quem implanta, com o termo da seção 10 assinado.
- [ ] Projeto Supabase na região escolhida (de preferência São Paulo), na conta combinada, com o DPA do Supabase aceito.
- [ ] Plano adequado para dados reais, com cópias de segurança e a retenção delas definida (item 1.5).
- [ ] MFA nas contas do Supabase e da hospedagem.
- [ ] Migrações `20261013120000_contact_privacy.sql` e `20261018100000_privacy_followup.sql` aplicadas, com o frontend do mesmo commit.
- [ ] Planilhas importadas com consentimento conferidas: o registro da base legal precisa provar o aceite, e quem importou fica como autor.
- [ ] "Base legal padrão dos contatos novos" escolhida em "Configurações", na aba "Organização" (etapa do guia "Configurar CRM").
- [ ] Contatos antigos com "Não informada" revisados: "Exportar contatos", em "Integrações", traz a coluna `base_legal`, que lista os "Não informada"; ajuste cada um em "Editar cadastro".
- [ ] Aviso de privacidade publicado, com o canal do titular.
- [ ] Termo entre quem implanta e a empresa assinado, quando quem implanta é operador.
- [ ] Equipe treinada em "Não contatar", "Exportar dados deste contato" e "Anonimizar contato".
- [ ] Prazo de guarda dos dados definido pela empresa.
- [ ] Lista dos pedidos atendidos mantida fora do CRM, para refazer as anonimizações depois de restaurar uma cópia.
