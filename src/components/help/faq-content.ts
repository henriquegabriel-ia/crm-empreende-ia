export interface FaqItem {
  q: string;
  a: string;
}
export interface FaqCategory {
  id: string;
  title: string;
  items: FaqItem[];
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    id: 'primeiros-passos',
    title: 'Primeiros passos',
    items: [
      {
        q: 'Como começo a usar o CRM?',
        a: 'Abra Configurar CRM nesta Ajuda ou nas ações rápidas do cabeçalho. O guia leva aos dados da organização e do perfil, pipeline, contatos, oportunidades e atividades. O progresso é verificado nos registros atuais. Você pode usar as demais telas sem terminar o guia.',
      },
      {
        q: 'Sair da configuração apaga o que já salvei?',
        a: 'Não. Esc ou o botão de fechar pausam apenas o guia. Os dados salvos nas telas do CRM ficam preservados. Ao reabrir, você continua da etapa escolhida e pode verificar novamente o progresso.',
      },
      {
        q: 'Terminar um tour conclui a configuração?',
        a: 'Não. Tours explicam a interface. O checklist de configuração é atualizado somente quando os registros necessários existem e podem ser verificados no CRM.',
      },
      {
        q: 'A empresa criada no primeiro acesso aparece em Empresas?',
        a: 'Não. A empresa criada no primeiro acesso é a dona deste CRM: nas demais telas ela aparece como organização, e o nome dela fica em Configurações, na aba Organização, onde donos e administradores podem mudá-lo. Empresas, no menu, reúne as empresas com que você se relaciona, como clientes e parceiros.',
      },
    ],
  },
  {
    id: 'contatos',
    title: 'Contatos e empresas',
    items: [
      {
        q: 'Qual é a diferença entre contato, empresa e oportunidade?',
        a: 'Contato é uma pessoa; empresa é a organização com a qual você se relaciona; oportunidade é uma negociação específica. Use os vínculos da ficha para manter esse contexto sem criar cadastros duplicados.',
      },
      {
        q: 'Onde encontro o histórico de um relacionamento?',
        a: 'Abra a ficha do contato ou da empresa pela lista ou pela busca global. Consulte as atividades e oportunidades vinculadas e confira a próxima ação disponível.',
      },
      {
        q: 'Por que não consigo excluir um contato ou uma empresa?',
        a: 'A exclusão só fica disponível para cadastros sem vínculos. A ficha informa o que impede: contatos da empresa, oportunidades, atividades ou recebimentos do Financeiro. Para manter o histórico, preserve o cadastro; para excluí-lo, resolva antes esses vínculos.',
      },
      {
        q: 'Como reutilizo filtros da minha rotina?',
        a: 'Nas telas com visões salvas, aplique os filtros e salve uma visão com um nome que faça sentido para você. Elas ficam neste navegador, separadas por conta e organização. A opção padrão remove o recorte salvo.',
      },
    ],
  },
  {
    id: 'pipeline',
    title: 'Pipeline e oportunidades',
    items: [
      {
        q: 'Como acompanho uma negociação?',
        a: 'Crie uma oportunidade no pipeline adequado, defina a etapa e confira responsável, valor e relacionamento vinculado. Abra o cartão para consultar ou editar os detalhes disponíveis para seu papel.',
      },
      {
        q: 'Como movo uma oportunidade pelo teclado?',
        a: 'Use a ação de movimentação do cartão para escolher a etapa de destino. O cartão muda de coluna na hora, o foco continua nele, e só ele fica travado até o banco confirmar; os outros cartões seguem livres. Se a gravação falhar, ele volta à etapa anterior e a mensagem aparece.',
      },
      {
        q: 'Renomear uma etapa muda as oportunidades de coluna?',
        a: 'Não. As oportunidades ficam vinculadas ao identificador da etapa, e não ao texto do nome. A edição de pipelines e etapas fica em Configurações e exige o acesso apropriado.',
      },
      {
        q: 'O valor do pipeline é dinheiro recebido?',
        a: 'Não. O valor da oportunidade representa a negociação. Consulte os lançamentos no Financeiro e seus estados para distinguir recebimentos de valores pendentes.',
      },
      {
        q: 'De onde vem a probabilidade de uma oportunidade?',
        a: 'Por padrão, da etapa em que ela está: ao mudar de etapa, a probabilidade acompanha. Para fixar outro valor, preencha Probabilidade em Editar; apague o campo para voltar a usar a da etapa. Ganha conta como 100% e perdida como 0%; ao reabrir, volta a valer a da etapa. A previsão ponderada soma valor × probabilidade das oportunidades em aberto. Por isso, alterar a probabilidade de uma etapa em Configurações muda na hora a previsão das oportunidades que a acompanham.',
      },
      {
        q: 'O que acontece ao excluir uma oportunidade com atividades ou recebimentos?',
        a: 'Antes de confirmar, dono e administradores veem quantas atividades, recebimentos e registros de automação estão vinculados. Ao confirmar, a oportunidade e o histórico de movimentações de etapa são excluídos; atividades e recebimentos continuam no CRM, sem o vínculo, e os registros de automação ficam no histórico. Para encerrar uma negociação preservando tudo, marque-a como perdida.',
      },
      {
        q: 'Em que período uma venda ganha aparece nos Relatórios?',
        a: 'No período da data de fechamento: uma oportunidade criada em agosto e ganha em outubro conta em outubro. A data é registrada ao marcar como ganha ou perdida e pode ser corrigida em Editar, entre a criação e hoje. Oportunidades em aberto entram pela data de criação.',
      },
    ],
  },
  {
    id: 'rotina',
    title: 'Hoje, agenda e tarefas',
    items: [
      {
        q: 'O que significa a fila de atenção?',
        a: 'Cada item deve mostrar um motivo verificável, como tarefa vencida, oportunidade sem responsável ou retorno pendente. Abra o registro de origem para avaliar o contexto e resolver a pendência.',
      },
      {
        q: 'Por que a fila mostra "N contatos sem próxima ação" num item só?',
        a: 'Com mais de 10 contatos sem próxima ação, por exemplo depois de uma importação, a fila os reúne num único item para não esconder as tarefas vencidas e as oportunidades. "Ver contatos sem próxima ação" abre Contatos com esse filtro, para você definir o próximo passo de cada um. Contatos cadastrados há menos de 1 dia e os encerrados não entram na contagem, e em "Minha rotina" ela considera só os contatos sob sua responsabilidade. O filtro de Contatos lista os de toda a equipe, inclusive os encerrados e os cadastrados nas últimas 24 horas, por isso pode mostrar mais contatos que o número do item.',
      },
      {
        q: 'Por que a mesma atividade aparece em mais de uma tela?',
        a: 'Hoje, Agenda, Tarefas e a ficha do relacionamento são visões dos mesmos registros. Alterar a situação de uma atividade atualiza esse registro nas outras visões; não é uma nova atividade.',
      },
      {
        q: 'O que acontece se um colega alterar o mesmo registro que eu?',
        a: 'Se o colega salvou antes, a sua gravação não apaga a dele: a tela avisa que o registro mudou ou não está mais disponível e mantém o que você preencheu. Copie suas alterações, reabra o registro para ver a versão atual e salve de novo. Vale para contatos, empresas, oportunidades, atividades, recebimentos, modelos, automações e, em Configurações, funis, etapas e regras da fila. Hoje, Agenda, Atividades, Tarefas, contatos, empresas e o Pipeline buscam as novidades quando você volta para a aba do CRM; enquanto você fica na aba, a tela mostra a última leitura.',
      },
      {
        q: 'Como registro a próxima ação?',
        a: 'Crie uma tarefa, retorno ou compromisso com descrição clara, responsável e prazo quando conhecido. Vincule ao contato ou à oportunidade para manter o contexto acessível.',
      },
    ],
  },
  {
    id: 'automacoes',
    title: 'Automações e conexões',
    items: [
      {
        q: 'O que devo conferir antes de ativar uma automação?',
        a: 'Leia o gatilho e as ações disponíveis na configuração. Confira o estado da rotina e as informações de execução exibidas. O tour nunca ativa uma automação nem envia mensagens.',
      },
      {
        q: 'Ao editar uma automação ativa, ela é pausada?',
        a: 'Não. A edição vale para os próximos eventos assim que é salva, e a automação continua ativa; só uma automação nova nasce pausada. Para interromper os disparos, use Pausar. Em "Oportunidade mudou de etapa", escolha o funil e a etapa de entrada para criar a tarefa só quando a oportunidade entrar nela; se esse funil ou essa etapa deixarem de existir, uma automação ativa é pausada.',
      },
      {
        q: 'Posso excluir uma automação ou uma tarefa criada por ela?',
        a: 'Sim, dono e administradores podem. As tarefas que a automação já criou continuam na rotina, e o histórico de execuções fica guardado no banco com o nome dela, mas deixa de aparecer na tela de Automações; para manter o histórico visível, use Pausar. Em Execuções, uma falha mostra a mensagem para todos e, para administradores, o detalhe técnico do banco.',
      },
      {
        q: 'Os contatos e a agenda são sincronizados automaticamente?',
        a: 'Não. A página Integrações oferece importação e exportação de contatos por CSV e exportação de compromissos por arquivo ICS, sempre de forma manual. Quem edita registros pode importar contatos e revisar a prévia antes de confirmar; dono e administradores podem exportar. Gere uma nova exportação depois de alterar a agenda.',
      },
    ],
  },
  {
    id: 'copiloto',
    title: 'Copiloto e informações',
    items: [
      {
        q: 'Como confiro uma sugestão do Copiloto?',
        a: 'Abra os registros citados para conferir os dados usados e avalie as lacunas informadas. Revise o contexto antes de transformar uma sugestão em uma ação do seu trabalho.',
      },
      {
        q: 'O tour ou a Ajuda alteram meus registros?',
        a: 'Não. Eles explicam o produto e abrem telas. Criação, edição e confirmação de operações acontecem pelos controles da tela correspondente.',
      },
    ],
  },
  {
    id: 'acesso',
    title: 'Acesso e recuperação',
    items: [
      {
        q: 'Como uma pessoa nova entra na equipe?',
        a: 'Só por convite. Um dono ou administrador abre Equipe, informa o e-mail e o papel e usa Criar convite. O CRM gera um link válido por 7 dias, que você envia à pessoa: o CRM não manda o e-mail. Ela abre o link, se cadastra com o e-mail convidado, confirma o e-mail e aceita o convite. No aceite, o CRM pede a senha da conta (pode ser a mesma do cadastro): só ela passa a valer, e outros acessos abertos com esse e-mail são encerrados. Quem já tem conta abre o link e entra pela aba Entrar. Quem chega à tela de entrada sem o link pode usar Recebi um convite e colar o link inteiro.',
      },
      {
        q: 'Recebi um convite e o cadastro foi recusado. E agora?',
        a: 'Neste CRM, só o e-mail convidado cria conta, e só enquanto o convite é válido. Confira se digitou exatamente o e-mail que recebeu o convite. Se o convite expirou, foi revogado ou trocado por outro, peça um link novo a quem administra: em Equipe, Gerar novo link cria outro, e o anterior deixa de valer. Se a mensagem disser que o e-mail já tem conta, entre pela aba Entrar ou use a opção Esqueceu a senha, na mesma aba. Se ela disser que o CRM ainda não consegue enviar e-mails, o convite está certo: avise quem administra, porque falta configurar o envio de e-mails do Supabase.',
      },
      {
        q: 'Quem administra o CRM perdeu o acesso de dono. Como recuperar?',
        a: 'Outro dono pode devolver o papel em Equipe, com Alterar papel. Sem outro dono, quem administra o projeto Supabase do CRM segue o guia Recuperar o acesso de dono (docs/RECUPERAR-ACESSO-DONO.md, no repositório do CRM), que devolve o papel de Dono pelo editor SQL do painel do Supabase. Esse editor tem acesso total aos dados: só quem administra o projeto deve usá-lo.',
      },
      {
        q: 'Por que não consigo criar ou editar um registro?',
        a: 'As ações disponíveis dependem do seu papel e da organização ativa. Consulte a explicação mostrada pela tela. Se precisar de outro acesso, fale com o administrador da organização.',
      },
      {
        q: 'Por que Integrações diz que a tela não é para o meu papel?',
        a: 'Integrações importa contatos de planilhas, o que exige permissão de edição; exportar contatos e reuniões fica com donos e administradores. Com acesso somente leitura, a tela explica o motivo e leva para Hoje. Equipe, Configurações, Automações e Segurança continuam abertas para consulta: a Equipe mostra quem são os donos e administradores, a quem pedir outro acesso, e cada pessoa ajusta o próprio perfil e encerra as próprias sessões.',
      },
      {
        q: 'O que acontece se a internet cair?',
        a: 'Aparece o aviso "Sem conexão" no topo da tela. O CRM não guarda alterações para enviar depois: enquanto o aviso estiver aberto, salvar falha na hora com uma mensagem, e o que estava preenchido continua na tela. Quando a conexão voltar, o aviso some; salve de novo.',
      },
      {
        q: 'Abri um link do CRM antes de entrar na conta. Perco o endereço?',
        a: 'Não. Depois de entrar, o CRM abre o mesmo endereço, como uma oportunidade específica. Isso vale também para o link de acesso enviado por e-mail e para o aceite de convite. Endereços de outros sites são ignorados, e a entrada segue para Hoje. Depois de usar Sair da conta, a próxima entrada abre Hoje, e não a última tela de quem saiu.',
      },
      {
        q: 'O que faço quando uma lista não carrega?',
        a: 'Confira a conexão e use Tentar novamente. Uma falha de consulta é diferente de uma lista vazia; não conclua que os dados foram apagados. Se o erro persistir, informe a tela e a ação ao administrador ou suporte.',
      },
      {
        q: 'Quais atalhos de orientação estão disponíveis?',
        a: 'Ctrl+K ou ⌘K abre a busca global. Nos tours, Esc pausa e o botão Continuar tour retoma o passo salvo. Recomeçar volta ao início do roteiro.',
      },
    ],
  },
];
