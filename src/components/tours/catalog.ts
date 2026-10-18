import type { ProductTourDefinition, ProductTourStep } from './types';

const step = (id: string, title: string, description: string): ProductTourStep => ({
  id,
  target: `[data-tour="${id}"]`,
  title,
  description,
});

/** Anchors describe capabilities actually rendered by each page. Missing/forbidden targets are omitted. */
export const productTours: ProductTourDefinition[] = [
  {
    id: 'dashboard',
    version: 1,
    path: '/dashboard',
    title: 'Sua rotina de hoje',
    description: 'Encontre compromissos, pendências e a próxima ação do dia.',
    steps: [
      step(
        'today-summary',
        'Comece pelo panorama',
        'Leia os indicadores no recorte escolhido: a sua rotina, a de toda a organização ou a de uma pessoa da equipe, inclusive quem foi desativado. Um valor zero significa que nenhum registro entrou nesse recorte; não é uma estimativa.',
      ),
      step(
        'today-attention',
        'Saiba por que um item precisa de atenção',
        'A fila mostra o motivo de cada pendência, como prazo vencido ou ausência de responsável. Muitos contatos sem próxima ação, ou de uma mesma pessoa desativada, aparecem num item só. Use “Abrir ficha e resolver” para tratar o que falta no registro de origem.',
      ),
      step(
        'today-activities',
        'Encontre o próximo compromisso',
        'Consulte tarefas, ligações, mensagens, reuniões e visitas. Numa ligação, WhatsApp ou e-mail com contato, o botão do canal abre o seu aplicativo, e quem edita registra depois o que aconteceu. Ao abrir uma atividade, você vê seu responsável, prazo e relacionamento vinculado. No menu, o número ao lado de “Hoje” conta sempre as suas vencidas e as que vencem até o fim do dia, mesmo com outra pessoa escolhida aqui.',
      ),
      step(
        'shell-quick-actions',
        'Crie a próxima ação',
        'Use os atalhos disponíveis para seu papel. O guia apenas explica: criar ou alterar registros depende de uma ação sua na tela.',
      ),
    ],
  },
  {
    id: 'contacts',
    version: 1,
    path: '/contacts',
    title: 'Relacionamentos e contatos',
    description: 'Localize pessoas e acompanhe o histórico de cada relacionamento.',
    steps: [
      step(
        'contacts-search',
        'Encontre a pessoa certa',
        'Digite no campo de busca para localizar contatos pelos campos indicados. Abra o resultado para consultar sua ficha.',
      ),
      step(
        'contacts-filters',
        'Reduza a lista com filtros',
        'Use os filtros para focar na carteira desejada e na origem dos contatos, inclusive as que estão fora da lista. A indicação de filtro ativo ajuda a diferenciar uma lista vazia de uma pesquisa sem resultados.',
      ),
      step(
        'contacts-views',
        'Guarde uma visão da sua rotina',
        'Salve os filtros que você reutiliza em “Salvar visão atual”. Suas visões ficam neste navegador, só para a sua conta nesta organização; “Limpar filtros” volta à lista completa.',
      ),
      step(
        'contacts-list',
        'Abra o relacionamento completo',
        'A ficha reúne dados do contato, empresa, oportunidades e atividades vinculadas. Confira a próxima ação para entender como dar continuidade. Na ficha, “WhatsApp”, “E-mail” e “Ligar” abrem o seu aplicativo, e o CRM oferece a quem edita registrar a conversa. Donos e administradores também usam ali “Exportar dados deste contato” e “Anonimizar contato”, a pedido da pessoa.',
      ),
      step(
        'contacts-create',
        'Cadastre com contexto',
        'O novo contato começa por suas informações de identificação e relacionamento. Confira possíveis duplicidades antes de salvar.',
      ),
    ],
  },
  {
    id: 'pipeline',
    version: 1,
    path: '/pipeline',
    title: 'Pipeline comercial',
    description: 'Leia as etapas e acompanhe cada oportunidade até seu resultado.',
    steps: [
      step(
        'pipeline-selector',
        'Escolha o processo comercial',
        'O funil selecionado define as etapas e as oportunidades que aparecem no quadro. Uma oportunidade pertence a um funil específico.',
      ),
      step(
        'pipeline-summary',
        'Interprete valores e situações',
        'Confira o recorte e a situação das oportunidades ao ler os totais. A previsão ponderada usa a probabilidade de cada oportunidade ou, sem ela, a da etapa. Com itens, o valor é o do contrato: o total único mais a mensalidade × meses. Valor de oportunidade representa negociação; recebimento é acompanhado no Financeiro.',
      ),
      step(
        'pipeline-board',
        'Acompanhe as oportunidades por etapa',
        'Abra um cartão para consultar seus detalhes, responsável e próxima ação. Cada etapa mantém seus vínculos mesmo quando seu nome muda.',
      ),
      step(
        'pipeline-move',
        'Mova com controle',
        'Use o menu “Mover ou alterar situação” do cartão para escolher a etapa ou marcar como ganha, perdida ou reaberta, inclusive pelo teclado. O cartão muda na hora e fica travado até a gravação terminar; se a gravação falhar, ele volta à etapa anterior.',
      ),
      step(
        'pipeline-create',
        'Crie uma oportunidade',
        'Em “Nova oportunidade”, associe o negócio ao contato, escolha etapa e responsável e informe o valor como 1.500,00 ou adicione itens do catálogo. Sem probabilidade própria, vale a da etapa. Avançar neste tour nunca cria um negócio.',
      ),
    ],
  },
  {
    id: 'agenda',
    version: 1,
    path: '/agenda',
    title: 'Agenda comercial',
    description: 'Organize horários e consulte os compromissos da equipe.',
    steps: [
      step(
        'agenda-view',
        'Escolha como ver a agenda',
        'Alterne entre as visões disponíveis para encontrar a escala de tempo mais útil para sua rotina.',
      ),
      step(
        'agenda-date',
        'Reconheça o período atual',
        'Navegue pelas datas e use “Hoje” para voltar ao período atual.',
      ),
      step(
        'agenda-filters',
        'Consulte a agenda certa',
        'Aplique os filtros e confira quais estão ativos. O responsável pode ser você, toda a organização ou uma pessoa da equipe, inclusive quem foi desativado. Se nada aparecer, revise o período e os filtros.',
      ),
      step(
        'agenda-calendar',
        'Abra o compromisso',
        'Consulte os detalhes de uma reunião, visita ou ligação para conferir responsável, vínculos e situação. A mesma atividade mantém seu estado nas outras visões do CRM.',
      ),
      step(
        'agenda-create',
        'Combine o próximo encontro',
        'Use a criação de compromisso para registrar data, responsável e contexto. O tour não reserva horários nem envia convites.',
      ),
    ],
  },
  {
    id: 'tasks',
    version: 1,
    path: '/tasks',
    title: 'Tarefas e retornos',
    description: 'Organize responsáveis, prazos e a conclusão das próximas ações.',
    steps: [
      step(
        'tasks-filters',
        'Foque nas tarefas relevantes',
        'Selecione o recorte: as suas tarefas, as de toda a organização, as sem responsável ou as de uma pessoa da equipe, inclusive quem foi desativado. Use “Limpar filtros” quando precisar voltar a todas as tarefas disponíveis para você.',
      ),
      step(
        'tasks-list',
        'Confira prazo e responsável',
        'Leia o estado de cada tarefa e abra seus detalhes. Prazo ausente e responsável ausente são lacunas a resolver, não prioridades presumidas.',
      ),
      step(
        'tasks-create',
        'Registre uma próxima ação clara',
        'Crie uma tarefa com ação, prazo, responsável e vínculo ao relacionamento ou oportunidade quando disponível.',
      ),
      step(
        'tasks-status',
        'Mantenha o trabalho atualizado',
        'Use “Concluir” ou “Reabrir” na tarefa. A mudança vale para todas as telas que consultam essa mesma atividade.',
      ),
    ],
  },
  {
    id: 'financeiro',
    version: 1,
    path: '/financeiro',
    title: 'Lançamentos financeiros',
    description: 'Diferencie valores previstos, pendentes e recebidos.',
    steps: [
      step(
        'finance-summary',
        'Leia os totais no contexto',
        'Confira período e situação dos lançamentos. Recebimentos, valores pendentes e oportunidades comerciais medem coisas diferentes.',
      ),
      step(
        'finance-filters',
        'Aplique o recorte desejado',
        'Use período e situação para conferir os lançamentos que compõem os valores exibidos.',
      ),
      step(
        'finance-list',
        'Consulte cada lançamento',
        'Abra o registro para entender valor, vencimento, situação e os vínculos disponíveis. Confira os dados antes de confirmar uma alteração.',
      ),
      step(
        'finance-create',
        'Registre o lançamento',
        'Donos, administradores e colaboradores registram lançamentos em “Novo lançamento”, com valores como 1.500,00. Informe os dados na tela; o tour nunca confirma pagamentos ou recebimentos.',
      ),
    ],
  },
  {
    id: 'automations',
    version: 1,
    path: '/automations',
    title: 'Automações',
    description: 'Entenda gatilhos e configurações antes de ativar uma rotina.',
    steps: [
      step(
        'automations-list',
        'Conheça as rotinas disponíveis',
        'Consulte as automações e seus estados. Uma configuração cadastrada não comprova que uma execução ocorreu: veja em “Execuções” cada tarefa criada ou falha.',
      ),
      step(
        'automations-trigger',
        'Entenda o que inicia a rotina',
        'Leia o evento de entrada e, em “Oportunidade mudou de etapa”, o filtro de funil e etapa. Verifique se o comportamento atende ao processo da sua equipe.',
      ),
      step(
        'automations-create',
        'Configure a automação',
        'Donos e administradores definem a rotina aqui; ela nasce pausada. O guia não ativa automações nem envia mensagens.',
      ),
      step(
        'automations-status',
        'Confira antes de ativar',
        '“Revisar e ativar” mostra o resumo antes de ligar, e “Pausar” interrompe os disparos sem apagar as tarefas criadas. Editar uma automação ativa não a pausa.',
      ),
    ],
  },
  {
    id: 'integrations',
    version: 2,
    path: '/settings/integrations',
    title: 'Importação e integrações',
    description: 'Conheça a troca de contatos por CSV e compromissos por calendário.',
    steps: [
      step(
        'integrations-catalog',
        'Conheça os recursos de troca de dados',
        'Consulte os cartões de contatos por CSV e agenda por arquivo ICS, com reuniões e visitas. Cada cartão explica as operações disponíveis e seus limites.',
      ),
      step(
        'integrations-import',
        'Traga seus contatos de uma planilha',
        'Use “Baixar modelo CSV” ou a sua planilha salva em CSV e escolha o arquivo; logo abaixo do campo está como salvar a planilha do Excel em CSV. A prévia mostra as linhas prontas, as repetidas e as com erro, com o motivo, e o responsável de cada contato; nada é gravado antes de “Importar”.',
      ),
      step(
        'integrations-export',
        'Exporte com responsabilidade',
        'Donos e administradores exportam em “Exportar contatos” e “Exportar reuniões”, que leva as reuniões e as visitas. A planilha sai com ponto e vírgula, pronta para o Excel, e deixa de fora os contatos anonimizados. Ela leva as colunas nao_contatar, base_legal e registro_base_legal e pode ser importada de novo; num CRM com base padrão, a prévia avisa quem a recebe. A troca por arquivo não mantém dados sincronizados.',
      ),
      step(
        'integrations-help',
        'Prepare o arquivo corretamente',
        'Confira as colunas aceitas, os valores de cada uma e o formato dos telefones. O calendário exportado, com reuniões e visitas, representa aquele momento: alterações posteriores exigem nova exportação.',
      ),
    ],
  },
];

export const tourById = new Map(productTours.map((tour) => [tour.id, tour]));
/** Hoje uses the same stable guide whether the application calls its route today or dashboard. */
export function getProductTour(id: string): ProductTourDefinition | undefined {
  return tourById.get(id === 'today' ? 'dashboard' : id);
}
