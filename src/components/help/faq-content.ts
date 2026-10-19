/**
 * Perguntas da Central de ajuda. As regras de escrita estão em src/components/help/README.md:
 * - respostas curtas, em pt-BR simples, que dizem quem pode fazer o quê com os papéis da Equipe (Dono, Administrador,
 *   Colaborador e Somente leitura, de src/lib/roles.ts) e não prometem o que o CRM não faz;
 * - nome de botão, aba, campo, tela, mensagem ou e-mail da interface entre aspas curvas (“Criar convite”): o teste
 *   confere cada um, inteiro, na tela de que a resposta fala (`SCREENS`, em faq-content.test.ts) ou no e-mail do Auth
 *   gerado, e a Central os destaca;
 * - `terms` guarda palavras que as pessoas digitam na busca e que não cabem na resposta, inclusive outras formas de uma
 *   palavra dela ("excluir" para "exclui"), porque a busca compara palavras inteiras; não aparece na tela;
 * - a marca da instância nunca é escrita aqui: o crédito vem de BASE_CREDIT_TEXT (src/lib/brand.ts).
 */
import { BASE_CREDIT_TEXT, BRAND } from '@/lib/brand';

export interface FaqItem {
  q: string;
  a: string;
  /** Sinônimos para a busca, separados por espaço. */
  terms?: string;
  /** Só aparece quando a tela mostra o crédito "Feito com Empreende.IA" (item 1.6: BRAND.baseCredit). */
  onlyWithBaseCredit?: boolean;
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
        a: 'Quem faz o primeiro acesso de um CRM novo cria a empresa e fica com o papel de Dono. A empresa já começa com o funil Comercial, quatro etapas e as regras da fila de atenção. Depois, abra “Configurar CRM”, nesta Ajuda ou em “Ações rápidas” (o botão + do topo): o guia leva ao perfil, aos funis, à base legal dos contatos, aos contatos, às oportunidades e às tarefas e confere o progresso nos registros que já existem. A equipe entra por convite, em “Equipe”. Você pode usar as outras telas sem terminar o guia.',
        terms: 'comecar inicio primeiro acesso configuracao inicial onboarding guia checklist',
      },
      {
        q: 'O que cada papel pode fazer?',
        a: '“Dono” faz tudo, inclusive convidar outros donos, mudar o papel deles e desativar ou reativar donos. “Administrador” convida pessoas, muda papéis, desativa e reativa pessoas (sem tornar ninguém dono nem mexer em donos), configura a organização, os funis, o catálogo, a fila de atenção, as automações e a base legal padrão, exporta dados, anonimiza contatos e exclui registros. “Colaborador” cria e edita contatos, empresas, oportunidades, atividades, lançamentos e modelos, registra a base legal e importa contatos, com a marca “Não contatar” e a base legal da planilha, mas não exclui registros, não muda configurações e não permite o contato de novo com quem foi marcado “Não contatar”. “Somente leitura” consulta e não altera nada. Todos ajustam o próprio perfil e as preferências; o papel de cada pessoa aparece em “Equipe”.',
        terms:
          'permissao permissoes acesso cargo funcao membro dono administrador colaborador leitura papel trocar mudar alterar desativar reativar anonimizar exportar lgpd',
      },
      // Item 1.16: o catálogo de produtos e serviços, em Configurações.
      {
        q: 'Como cadastro o catálogo de produtos e serviços?',
        a: 'Em “Configurações”, na aba “Catálogo”, donos e administradores usam “Novo item” com o nome, o código (opcional e único), o tipo (produto ou serviço), a unidade, o preço e a cobrança, única ou mensal. Em cada item, os botões ao lado editam, arquivam, reativam e excluem. Excluir só vale para o item nunca usado numa oportunidade; o usado é arquivado, sai das escolhas dos itens novos e continua nas oportunidades que já o têm. Mudar o preço no catálogo não muda oportunidades já registradas. Colaboradores e “Somente leitura” consultam o catálogo. Ele é opcional: sem itens, a oportunidade continua com o valor digitado.',
        terms:
          'catalogo produto produtos servico servicos item itens preco tabela cadastrar arquivar reativar excluir codigo sku mensal',
      },
      // Item 1.15: os dados de demonstração das instâncias de aula e do beta (gravados pelo editor SQL do painel).
      {
        q: 'O que são os dados de demonstração?',
        a: 'Um CRM de aula ou do beta pode ter dados fictícios, gravados por quem publicou o CRM: empresas, contatos, oportunidades, atividades, recebimentos, automações e modelos. Os e-mails terminam em example.test, e os celulares, no formato (11) 90000-0001, não são de ninguém: não envie mensagens a eles. Há um contato anonimizado, um “Não contatar” e atividades vencidas e do dia. Eles nunca entram num CRM que já tem dados. Cada registro fictício pode ser editado ou excluído na tela por quem pode. Apagar toda a demonstração de uma vez é com quem publicou o CRM: saem também as atividades e os recebimentos registrados nos fictícios, e o resto do que a equipe criou fica. Se algo da equipe estiver ligado a um fictício, a remoção para e diz o que ajustar.',
        terms: 'demonstracao demo exemplo ficticio ficticios teste aula beta seed apagar remover limpar dados falsos',
      },
      {
        q: 'A empresa criada no primeiro acesso aparece em “Empresas”?',
        a: 'Não. A empresa criada no primeiro acesso é a dona deste CRM: nas outras telas ela aparece como organização, e o nome dela fica em “Configurações”, na aba “Organização”, onde donos e administradores podem mudar o nome. “Empresas”, no menu, reúne as empresas com que você se relaciona, como clientes e parceiros.',
        terms: 'nome da empresa organizacao renomear mudar trocar alterar editar logo marca',
      },
      // Item 1.6: a marca é configuração da implantação (public/brand/brand.json), e não uma tela do CRM.
      {
        q: 'Como troco o nome e o logo do CRM?',
        a: 'O nome, o logo e o ícone da tela de entrada, do menu e da aba do navegador, o slogan e a marca dos e-mails de acesso vêm da configuração da implantação, feita por quem publicou o CRM. Nenhuma tela do CRM troca a marca: peça a essa pessoa, que troca os arquivos da marca e publica o CRM de novo. Se foi você quem publicou, siga o guia Trocar a marca do CRM, em docs/MARCA.md no repositório do CRM. Os nomes dos arquivos exportados acompanham a marca. O nome da organização, em “Configurações”, na aba “Organização”, é outro: donos e administradores mudam esse nome ali, e ele não troca o nome nem o logo da entrada.',
        terms:
          'marca logo logotipo icone favicon nome titulo aba slogan identidade personalizar trocar mudar alterar imagem',
      },
      // Item 1.13: os ganchos private.custom_* e o db-drift-check são de quem publica; nenhuma tela muda as regras.
      {
        q: 'Dá para personalizar este CRM sem perder as atualizações?',
        a: 'Dá. O CRM tem pontos próprios para as regras da empresa e uma conferência que mostra, antes de cada atualização, o que foi mudado à mão na instalação. Quem publicou segue o guia Personalizar sem quebrar a atualização, em docs/PROTECAO-ATUALIZACAO.md no repositório do CRM. Nenhuma tela do CRM cria ou muda essas regras: peça a quem publicou.',
        terms:
          'personalizar personalizacao customizar customizacao atualizacao atualizar versao nova regra propria campo novo modificar alterar',
      },
      {
        q: `O que significa “${BASE_CREDIT_TEXT}”?`,
        a: 'É o crédito da base em que este CRM foi construído. Ele aparece na tela de entrada e no rodapé desta Ajuda quando o CRM usa a marca de outra empresa, e pode aparecer também no rodapé dos e-mails de acesso. Quem publicou o CRM pode remover o crédito nos casos que a licença da base permite, como a revenda com marca própria.',
        terms: 'credito rodape empreende base licenca feito',
        onlyWithBaseCredit: true,
      },
      {
        q: 'Sair da configuração apaga o que já salvei?',
        a: 'Não. Esc ou o X pausam só o guia “Configurar CRM”, e o que você salvou nas telas continua no CRM. Ao reabrir o guia, você volta à etapa em que parou e pode usar “Verificar novamente”.',
      },
      {
        q: 'Terminar um tour conclui a configuração?',
        a: 'Não. Os tours só explicam a tela. O checklist “Configuração do CRM” marca uma etapa quando o registro existe de verdade: a da próxima ação, por exemplo, pede uma atividade pendente e com prazo, como tarefa, ligação, WhatsApp, e-mail, reunião ou visita (notas não contam).',
      },
      {
        q: 'Como mudo as preferências dos tours?',
        a: 'Nesta Ajuda, em “Como você prefere conhecer o CRM?”, marque ou desmarque “Mostrar convites discretos nas telas novas” e “Abrir novos tours automaticamente quando a tela estiver pronta”. A orientação automática vem desativada. As preferências e o progresso dos tours ficam neste navegador, separados por conta e organização. Qualquer papel pode mudar as próprias preferências.',
        terms:
          'preferencia preferencias tour tours convite convites discretos automatico automatica desligar ligar orientacao',
      },
      {
        q: 'Como funcionam os tours e a busca?',
        a: 'No topo de cada tela com tour, “Tour desta tela” abre o roteiro, que só mostra o que o seu papel pode usar. Esc pausa, “Continuar tour” retoma do passo salvo e “Recomeçar tour” volta ao início. Ctrl+K (⌘K no Mac) abre a busca, que encontra contatos, empresas, oportunidades e atividades pelo nome e abre as principais telas. Com uma janela aberta, o atalho não abre a busca: feche a janela antes. Nesta Ajuda, “Abrir tela” leva às telas com tour.',
        terms: 'atalho atalhos teclado pesquisar procurar busca global',
      },
      {
        q: 'O tour ou a Ajuda alteram meus registros?',
        a: 'Não. Eles explicam o CRM e abrem telas. Criar, editar e confirmar acontecem só pelos botões da própria tela, e avançar num tour nunca salva nada.',
      },
    ],
  },
  {
    id: 'acesso',
    title: 'Entrada, equipe, convites e senha',
    items: [
      {
        q: 'Como uma pessoa nova entra na equipe?',
        a: 'Só por convite. Em “Equipe”, um dono ou administrador informa o e-mail e o papel e usa “Criar convite” (só um dono convida outro dono). O CRM gera um link válido por 7 dias, que você copia em “Copiar link” e envia à pessoa: o CRM não manda o convite por e-mail. Ela abre o link, informa o nome e o e-mail convidado na aba “Cadastrar” e abre o link de confirmação que chega nesse e-mail; o CRM pede, então, que ela crie a senha e aceite o convite.',
        terms: 'convidar convite colega cadastro criar conta nova novo pessoa adicionar usuario membro',
      },
      {
        q: 'Já tenho conta ou não abri o link do convite. Como aceito?',
        a: 'Quem já tem conta abre o link do convite e entra pela aba “Entrar”; se o CRM pedir que confirme o e-mail, use “Enviar link para o meu e-mail” e abra o link que chegar. Quem chegou à tela de entrada, ou já entrou na conta, sem passar pelo link usa “Recebi um convite” e cola o link ou só o código do convite. Depois, use “Aceitar convite da equipe”.',
        terms: 'aceitar convite conta existente codigo do convite colar link',
      },
      {
        q: 'Recebi um convite e o cadastro foi recusado. E agora?',
        a: 'Neste CRM, só o e-mail convidado cria conta, e só enquanto o convite é válido. Confira se digitou exatamente o e-mail que recebeu o convite. Se o convite expirou, peça a quem administra que use “Gerar novo link” nele, em “Equipe”; se o convite era de dono, só um dono o renova. Se foi revogado, peça que criem outro em “Criar convite”. Nos dois casos, use o link novo: o anterior deixa de valer. Se a mensagem disser que o CRM ainda não consegue enviar e-mails, o convite está certo: avise quem administra, porque falta configurar o envio de e-mails do Supabase.',
        terms: 'erro cadastro negado convite invalido expirado',
      },
      {
        q: 'Como copio, renovo ou cancelo um convite?',
        a: 'Em “Equipe”, donos e administradores veem os convites ainda não aceitos e quem criou cada um (“Criado por”); os convites de dono, só os donos veem. No convite válido, “Copiar” copia o link de novo. No convite expirado, “Gerar novo link” cria outro, e o anterior deixa de valer; o convite de dono, só um dono renova. “Revogar” cancela o convite. Enquanto houver um convite válido para um e-mail, o CRM não cria outro para o mesmo e-mail: copie o link ou revogue o convite antes (se o aviso falar de um convite de dono, que só os donos veem, peça isso a um dono). Os convites pendentes de quem foi desativado, ou perdeu o papel que permitia criar o convite, são revogados sozinhos.',
        terms: 'cancelar revogar desfazer apagar excluir validade vencido renovar reenviar copiar pendente autor criou',
      },
      {
        q: 'Como desativo quem saiu da equipe e passo a carteira?',
        a: 'Em “Equipe”, donos e administradores usam “Desativar” no cartão da pessoa; o de um dono, só outro dono desativa, e ninguém desativa o próprio acesso. A confirmação mostra quantas oportunidades em aberto, atividades pendentes, contatos e empresas estão com a pessoa e pede “Quem recebe a carteira”, que precisa ser dono, administrador ou colaborador ativo. As oportunidades em aberto e as atividades pendentes passam sempre; os contatos e as empresas, se “Passar também os contatos e as empresas” ficar marcado. Em “Confirmar desativação”, a pessoa perde o acesso na hora, mesmo com o CRM aberto, e os convites pendentes que ela criou são revogados. Oportunidades ganhas e perdidas, atividades concluídas e o histórico continuam no nome dela, com a marca “(desativado)”.',
        terms:
          'remover desativar bloquear demitir demissao saiu sair tirar acesso excluir apagar pessoa membro usuario funcionario vendedor carteira transferir passar reatribuir trocar responsavel ex convite convites pendentes',
      },
      {
        q: 'Como reativo uma pessoa desativada?',
        a: 'Em “Equipe”, em “Pessoas desativadas”, donos e administradores usam “Reativar”, escolhem o papel e confirmam em “Confirmar reativação”. Reativar um dono, ou dar o papel de Dono, só um dono faz. A pessoa volta a entrar com a mesma conta. A carteira que passou para outra pessoa continua com ela: troque o “Responsável” dos registros que devem voltar.',
        terms: 'reativar voltar devolver acesso readmitir recontratar',
      },
      {
        q: 'Ficaram contatos com uma pessoa desativada. Como passo para outra?',
        a: 'Em “Equipe”, o cartão da pessoa desativada avisa quando os contatos e as empresas ficaram com ela. Donos e administradores usam “Passar carteira”: a confirmação mostra o que ainda está com ela e pede “Quem recebe a carteira”. Também dá para trocar o “Responsável” de cada registro ao editar o registro. Enquanto isso, em “Hoje”, com “Toda a organização” ou com a própria pessoa escolhida no seletor, a fila de atenção mostra esses contatos na regra de sem responsável; com mais de 10 contatos da mesma pessoa, eles aparecem num item só, e “Ver na Equipe” abre a “Equipe”.',
        terms: 'carteira transferir passar empresas contatos reatribuir trocar responsavel desativado',
      },
      {
        q: 'Por que um nome aparece com “(desativado)”?',
        a: 'É alguém que saiu da equipe. O nome continua nas oportunidades, atividades e históricos que ficaram com a pessoa, mas ela não entra mais no CRM e não aparece para ser escolhida como “Responsável”. Nos filtros de responsável, como os de “Hoje”, “Atividades”, “Agenda” e “Relatórios”, ela aparece por último, com a marca, para você ver o que ficou com ela. Um registro que já estava com ela pode ser editado; para reabrir uma oportunidade ou uma atividade dela, troque antes o responsável. Donos, administradores e colaboradores trocam o responsável ao editar o registro.',
        terms: 'desativado nome marca ex membro responsavel',
      },
      {
        q: 'Apareceu “Seu acesso foi encerrado”. E agora?',
        a: 'Um dono ou administrador desativou o seu acesso a este CRM. Os registros continuam com a empresa, mas você não consegue mais consultar nem alterar nada. Se acha que é um engano, fale com quem administra o CRM; depois da reativação, use “Verificar de novo” (se o acesso continuar encerrado, a tela avisa). Para deixar a tela, use “Sair da conta”.',
        terms: 'acesso encerrado bloqueado desativado sem acesso',
      },
      {
        q: 'Que e-mails o CRM envia?',
        a: 'Só e-mails de acesso à conta. “Confirme seu e-mail” chega depois de “Cadastrar” ou do primeiro “Link por e-mail”. “Seu link de acesso” chega depois de “Link por e-mail”, de “Enviar link para o meu e-mail” ou de “Cadastrar” com um e-mail que já tem conta. Os dois trazem um botão e um código. “Redefina sua senha” chega depois de “Esqueceu a senha?”. “Ative sua conta” só chega se quem administra criou sua conta pelo painel do Supabase; depois de ativar, abra o link do convite da equipe, que quem administra manda a você (o CRM não o envia). Os avisos de senha e de e-mail alterados têm resposta própria. Se os e-mails chegarem em inglês, avise quem administra: a configuração de e-mails do CRM não foi aplicada no Supabase.',
        terms: 'email mensagem caixa de entrada confirmacao assunto notificacao',
      },
      {
        q: 'Recebi um aviso de senha ou de e-mail alterado. O que faço?',
        a: '“Sua senha foi criada ou alterada” chega depois de criar ou trocar a senha: se não foi você, redefina a senha pelo “Esqueceu a senha?” e avise quem administra. “Confirme a troca de e-mail” e “Seu e-mail de acesso mudou” só chegam quando alguém pede a troca do e-mail de acesso (o CRM não tem essa tela). Se não foi você e chegou “Confirme a troca de e-mail”, a troca ainda não aconteceu: não abra o link, redefina a senha pelo “Esqueceu a senha?” e avise quem administra. Se chegou “Seu e-mail de acesso mudou”, a troca já aconteceu e a conta não entra mais pelo seu e-mail. Avise imediatamente um dono ou administrador, que corta o acesso dessa conta com “Desativar”, em “Equipe”, e convida seu e-mail de novo.',
        terms: 'aviso seguranca troca email trocado mudou alterado invadida roubada suspeita notificacao desativar',
      },
      {
        q: 'Como troco minha senha ou meu e-mail?',
        a: 'Com a conta aberta, não há tela para trocar a senha: use “Sair da conta” e, na entrada, “Esqueceu a senha?”. O e-mail de acesso não muda pelo CRM: peça a quem administra um convite para o novo endereço. A conta nova começa sem a carteira da antiga, que donos e administradores passam com “Desativar” na conta antiga.',
        terms: 'trocar alterar mudar senha email endereco conta nova perfil',
      },
      {
        q: 'O que faço com o link do e-mail?',
        a: 'Use o botão do e-mail. O CRM abre e mostra “Continuar”: o link só é usado quando você aperta esse botão, para que os filtros de segurança do e-mail, que abrem os links antes de você, não o gastem. Depois, o cadastro pede “Crie sua senha”, e a redefinição pede a “Nova senha”. Se o endereço chegar cortado, a tela avisa e oferece “Ir para a tela de entrada”, onde você pede outro link.',
        terms: 'continuar botao abrir link confirmar',
      },
      {
        q: 'O link do e-mail não chegou. O que faço?',
        a: 'Espere alguns minutos e confira a caixa de spam. Se o endereço estava errado, use “Usar outro e-mail” no aviso de link enviado, corrija o e-mail e envie de novo. No aviso que aparece depois de “Enviar link para o meu e-mail”, use “Enviar de novo”. O CRM só aceita outro pedido para o mesmo endereço depois de alguns instantes, e só o link e o código do e-mail mais recente funcionam. Se a mensagem disser que o CRM ainda não consegue enviar e-mails, avise quem administra: falta configurar o envio de e-mails do Supabase.',
        terms: 'nao recebi spam lixo eletronico reenviar',
      },
      {
        q: 'O link do e-mail diz que expirou ou já foi usado. O que faço?',
        a: 'Cada link vale uma vez e por pouco tempo (o e-mail diz quanto). Peça outro em “Link por e-mail”, ou em “Esqueceu a senha?” se era para redefinir a senha, e use o e-mail mais recente. Ao abrir o link, use “Continuar”: o CRM só usa o link nesse momento, para que os filtros de segurança do e-mail, que abrem os links antes de você, não o gastem. Se todo link novo já chega gasto, avise quem administra: os modelos de e-mail do CRM podem não estar aplicados no Supabase.',
        terms: 'invalido vencido expirado usado',
      },
      {
        q: 'Pedi o link no computador, mas abri o e-mail no celular. E agora?',
        a: 'O e-mail de cadastro e o de link de acesso trazem também um código. No computador, no aviso de link enviado, digite o código em “Código do e-mail” e use “Entrar com o código”: a sessão abre ali. Se preferir abrir o link no celular, a sessão abre no celular, e a senha que você criar lá vale também no computador. O link e o código valem uma vez: usar um gasta o outro.',
        terms: 'codigo numeros outro aparelho token',
      },
      {
        q: 'Entrei pelo link do e-mail e não criei uma senha. Como entro de novo?',
        a: 'Se ainda falta aceitar o convite ou criar a empresa, use “Link por e-mail”, na tela de entrada: a senha é criada no próprio aceite, ou na criação da empresa, e pelo “Esqueceu a senha?” você a criaria duas vezes. Para o convite, abra antes o link do convite e peça o link de acesso ali, em “Link por e-mail”: ele volta ao aceite, e o CRM pede que você crie a senha. Se você já está na equipe e esqueceu a senha, use “Esqueceu a senha?” ou entre por “Link por e-mail”.',
        terms: 'sem senha criar senha',
      },
      {
        q: 'Esqueci minha senha. O que faço?',
        a: 'Na tela de entrada, digite o e-mail na aba “Entrar” e use “Esqueceu a senha?”. Abra o e-mail “Redefina sua senha”, use “Redefinir senha” e, no CRM, “Continuar”; depois, digite a “Nova senha”, com pelo menos 6 caracteres, e use “Salvar nova senha”. Sem senha, você também entra por “Link por e-mail”.',
        terms: 'esqueci trocar senha mudar senha recuperar login entrar',
      },
      {
        q: 'Quem administra o CRM perdeu o acesso de dono. Como recuperar?',
        a: 'Se só esqueceu a senha, use “Esqueceu a senha?” na tela de entrada. Se a conta perdeu o papel de Dono ou foi desativada por engano, outro dono resolve em “Equipe”, com “Alterar papel” ou “Reativar” (administradores não alteram o papel de donos nem os reativam). Sem outro dono, ou se outra pessoa ficou com o papel de Dono no primeiro acesso, quem administra o projeto Supabase do CRM segue o guia docs/RECUPERAR-ACESSO-DONO.md: pelo editor SQL do painel, que dá acesso total aos dados, ele devolve o papel a uma conta da empresa, inclusive desativada, coloca como dona uma conta ainda sem empresa ou, sem conta, cria um convite de dono. Depois, use “Desativar” na conta que não deveria estar na empresa.',
        terms: 'dono perdido recuperar acesso bloqueado desativado reativar intruso',
      },
      {
        q: 'Abri um link do CRM antes de entrar na conta. Perco o endereço?',
        a: 'Não. Depois de entrar, o CRM abre o mesmo endereço, como uma oportunidade específica. Isso vale também para o link de acesso enviado por e-mail e para o aceite de convite. Endereços de outros sites são ignorados, e a entrada segue para “Hoje”. Depois de usar “Sair da conta”, a próxima entrada abre “Hoje”, e não a última tela de quem saiu.',
        terms: 'link direto endereco url login redirecionar',
      },
      {
        q: 'Como saio da conta ou encerro o acesso em outros aparelhos?',
        a: '“Sair da conta” fica no menu da sua conta, nas suas iniciais, embaixo na barra lateral (no celular, em “Mais”). Para sair de todos os aparelhos, abra “Segurança” e use “Encerrar todas as sessões”: este aparelho sai na hora, e nos outros o acesso termina em até 1 hora. O que já foi salvo continua no CRM. Qualquer papel pode fazer isso. Se suspeitar que outra pessoa usa a sua conta, troque também a senha pelo “Esqueceu a senha?” da tela de entrada e avise quem administra.',
        terms: 'sair logout deslogar sessao sessoes computador compartilhado invadida suspeita roubada',
      },
    ],
  },
  {
    id: 'contatos',
    title: 'Contatos e empresas',
    items: [
      {
        q: 'Qual é a diferença entre contato, empresa e oportunidade?',
        a: 'Contato é uma pessoa; empresa é o cliente, fornecedor ou parceiro com que você se relaciona; oportunidade é uma negociação específica. Use os vínculos da ficha para manter esse contexto sem criar cadastros duplicados.',
      },
      {
        q: 'Onde encontro o histórico de um relacionamento?',
        a: 'Abra a ficha do contato ou da empresa pela lista ou pela busca (Ctrl+K). Ela reúne as atividades, as oportunidades, o “Último contato” e a “Próxima ação”, que é a atividade pendente com o menor prazo entre os vínculos. O histórico mostra o resultado de cada ligação e se filtra por tipo, como ligações, WhatsApp, e-mails, reuniões, visitas e notas. Notas ficam no histórico, mas não contam como próxima ação.',
        terms: 'ficha 360 timeline historico ultimo contato filtro tipo',
      },
      {
        q: 'Por que não consigo excluir um contato ou uma empresa?',
        a: 'Só donos e administradores veem “Excluir cadastro”, que fica desabilitado enquanto o cadastro tiver vínculos. Logo abaixo, a ficha diz o que impede: contatos da empresa, oportunidades, atividades ou recebimentos do “Financeiro”. Para manter o histórico, preserve o cadastro; para excluir o cadastro, resolva antes esses vínculos. Se a pessoa pediu a exclusão dos dados dela, com ou sem vínculos, donos e administradores usam “Anonimizar contato”, que apaga os dados pessoais, tira o nome dos outros registros e mantém o histórico sem nomes.',
        terms: 'apagar deletar remover exclusao',
      },
      {
        q: 'Como reutilizo filtros da minha rotina?',
        a: 'Em “Contatos” e “Empresas”, ajuste a busca, os filtros, a ordem e as colunas, abra “Visões salvas” e use “Salvar visão atual”. A visão fica neste navegador, só para a sua conta nesta organização; para apagar a visão, use a lixeira ao lado do nome. “Limpar filtros” volta à lista completa.',
        terms: 'filtro filtros visao salva carteira colunas',
      },
      {
        q: 'Como os telefones são gravados e buscados?',
        a: 'Telefones do Brasil com DDD são gravados no padrão +55, como +5511999990000, na importação por planilha e no cadastro manual, que mostra como o número será salvo enquanto você digita. As telas mostram o número como (11) 99999-0000. Um número que o CRM não reconhece fica como foi digitado, e o WhatsApp e a ligação ficam desabilitados até você corrigir o número; o de outro país funciona quando começa com + e o código do país. Em “Contatos” e “Empresas”, a busca acha o número digitado como (11) 99999 ou só pelos dígitos. Na busca geral (Ctrl+K), digite só os dígitos com o DDD, como 11999990000; ela não procura o telefone das empresas, então use a busca de “Empresas”.',
        terms: 'telefone celular whatsapp numero ddd +55 fixo formato',
      },
      // Revisão do item 1.11: cargo, origem e observações chegam pela importação e se corrigem no cadastro.
      {
        q: 'Onde corrijo o cargo, a origem ou as observações de um contato?',
        a: 'Na ficha do contato, use “Editar cadastro”. Os campos “Cargo”, “Origem” e “Observações” ficam ali, com o nome, o e-mail, o telefone, a empresa e o responsável, e aparecem na ficha quando preenchidos. A origem é escolhida numa lista, com “Outra” para escrever uma origem que não está nela. Eles também chegam pela importação de planilha, nas colunas cargo, origem e observacoes. Use o mesmo caminho quando a pessoa pedir a correção dos dados dela. Donos, administradores e colaboradores editam contatos.',
        terms: 'cargo funcao origem observacao observacoes anotacao corrigir correcao editar alterar mudar importado',
      },
      // Item 1.14: a origem do lead em lista fixa, com o valor livre antigo preservado.
      {
        q: 'Quais origens um contato pode ter e como filtro por origem?',
        a: 'Em “Editar cadastro”, a “Origem” é uma lista: WhatsApp, Telefone, E-mail, Site e Indicação. Para outra, como uma feira ou o Instagram, escolha “Outra” e escreva. Uma origem fora da lista, escrita antes ou vinda de uma planilha, continua como está e abre em “Outra”. Já um nome da lista escrito sem acento, em minúsculas ou como zap aparece com o nome da lista e é gravado assim ao salvar o cadastro e na importação. Em “Contatos”, o filtro de origem mostra cada uma, “Outras origens”, com as que estão fora da lista, e “Sem origem”, e “Colunas” acrescenta a coluna “Origem”. Donos, administradores e colaboradores editam a origem.',
        terms:
          'origem origens lead leads canal fonte indicacao indicado site whatsapp telefone email outra outras filtrar filtro coluna instagram feira',
      },
    ],
  },
  // Item 1.9: canais nível 1. O CRM abre o aplicativo da pessoa e oferece registrar a conversa; nunca envia nada.
  {
    id: 'canais',
    title: 'WhatsApp, e-mail e telefone',
    items: [
      {
        q: 'Como mando um WhatsApp pelo CRM?',
        a: 'Na ficha do contato ou da empresa, na oportunidade ou numa atividade de “Hoje”, use “WhatsApp”. Escolha um modelo, se quiser, revise o texto e use “Abrir no WhatsApp”: o CRM abre o WhatsApp do seu celular ou computador com o número e o texto, e quem envia é você. Número fixo mostra um aviso, porque só funciona se o número usar o WhatsApp Business. Sem telefone, ou com um número sem DDD, o botão fica desabilitado e diz o que corrigir; em “Hoje”, o botão do canal só aparece na atividade cujo contato tem o número. Todos os papéis abrem o WhatsApp; registrar a conversa fica com donos, administradores e colaboradores.',
        terms: 'whatsapp zap zapzap mensagem conversar wa.me celular enviar mandar',
      },
      {
        q: 'Como abro um e-mail no Gmail ou no Outlook?',
        a: 'Use “E-mail” na ficha do contato, na oportunidade ou numa atividade. Revise o assunto e o texto e escolha uma opção em “Abrir e-mail”. “Abrir no Gmail” e “Abrir no Outlook web” abrem a composição no navegador, e “Abrir no aplicativo de e-mail” usa o programa padrão do aparelho. O e-mail sai da sua conta. “Abrir no Outlook web” serve para contas Microsoft 365 de trabalho ou escola; com Outlook.com ou Hotmail, e no celular, prefira o aplicativo de e-mail. Um texto longo demais para o link é copiado, e o CRM abre o e-mail sem ele, para você colar. Todos os papéis abrem o e-mail.',
        terms: 'email gmail outlook hotmail mailto escrever enviar mandar correio',
      },
      {
        q: 'Como registro uma ligação?',
        a: 'Em “Ligar”, na ficha, na oportunidade ou numa ligação de “Hoje”, escolha “Ligar” para chamar pelo celular ou pelo programa de chamadas do computador, “Copiar número” para discar em outro aparelho, ou “Registrar ligação”. O registro pede o resultado (“Atendeu”, “Não atendeu” ou “Caixa postal”), a oportunidade, uma anotação e, se você quiser, a próxima ação. Se havia uma ligação pendente para esse contato até o fim do dia, o CRM oferece concluir essa mesma atividade, em vez de criar outra. Donos, administradores e colaboradores registram ligações.',
        terms: 'ligacao ligar telefonar telefone chamada discar atendeu resultado caixa postal',
      },
      {
        q: 'O CRM envia as mensagens sozinho?',
        a: 'Não. O CRM abre o seu WhatsApp, o seu e-mail ou o discador com o contato e o texto, e quem envia é você, pela sua conta. Por isso ele não sabe se a mensagem saiu e, quando você volta, pergunta se quer registrar a conversa, sem obrigar. O texto não fica guardado no CRM. O número, o e-mail e o texto vão para o WhatsApp, o Google ou a Microsoft só para abrir a mensagem, como se você os digitasse lá. Em computador compartilhado, lembre que o navegador guarda o histórico dos links abertos.',
        terms: 'enviar automatico disparo privacidade lgpd envio automatica',
      },
      {
        q: 'Abri o WhatsApp e não registrei. E agora?',
        a: 'Cada contato aberto por “WhatsApp”, “E-mail”, “Ligar” ou “Copiar número” fica em “Para registrar”, no rodapé da tela e na própria ficha, até você usar “Registrar” ou “Agora não”. Abrir de novo o mesmo canal do mesmo lugar não cria outra linha; aberto de outra ficha, de uma oportunidade ou de uma atividade, ele entra em outra linha. Ficam as 10 aberturas mais recentes. A lista vale só para esta aba do navegador e some depois de 12 horas ou ao fechar a aba. Se ela sumiu, use “Registrar ligação” ou crie uma atividade do tipo certo com “Já aconteceu”. Quem tem “Somente leitura” abre os canais, mas não registra.',
        terms: 'pendente pendencia registrar esqueci sumiu lembrete conversa',
      },
      {
        q: 'Como uso variáveis nos modelos?',
        a: 'Em “Modelos”, ao criar ou editar, use “Inserir variável”, ao lado do assunto ou do texto, para pôr nesse campo o primeiro nome ou o nome do contato, a empresa, a oportunidade, o responsável, o seu nome ou o nome da organização, como {{primeiro_nome}}. Ao usar o modelo por “WhatsApp” ou “E-mail”, o CRM troca cada variável pelo dado do cadastro. Se faltar um dado, como a empresa de um contato sem empresa, o CRM avisa e só abre a mensagem depois que você completar ou apagar a variável. Donos, administradores e colaboradores criam e editam modelos.',
        terms: 'variavel variaveis personalizar nome automatico template modelo campo',
      },
      {
        q: 'O que significa “Não contatar”?',
        a: 'É a marca de um contato ou de uma empresa que não quer mais ser procurado, como quem pediu para parar. Com ela, “WhatsApp”, “E-mail”, “Ligar” e “Registrar ligação” ficam desabilitados, o CRM recusa agendar ação de contato, e a ficha mostra quem marcou, quando e o motivo. Donos, administradores e colaboradores usam “Marcar como não contatar”; só donos e administradores usam “Permitir contato de novo”. A marca da empresa vale para o telefone da empresa, e não para os contatos dela, então marque também cada contato. A importação de planilha marca os contatos novos pela coluna nao_contatar; nos já cadastrados, a prévia avisa para marcar na ficha. A fila de atenção não cobra próxima ação do contato marcado, como no encerrado. Avise a equipe sobre a marca.',
        terms: 'nao contatar bloquear parar descadastrar opt-out optout lgpd pediu para parar remover contato',
      },
      {
        q: 'Como informo ou corrijo o resultado de uma ligação?',
        a: '“Registrar ligação” e “Concluir e agendar a próxima” pedem o resultado, mas o “Concluir” de um clique não pede. Para informar ou corrigir depois, abra a ligação concluída e use “Editar / reagendar”: o campo “Resultado” tem “Atendeu”, “Não atendeu”, “Caixa postal” e “Sem resultado”. “Reabrir” a ligação apaga o resultado, porque ele só vale para a ligação concluída; ao concluir de novo, informe o resultado outra vez. Donos, administradores e colaboradores informam e corrigem o resultado.',
        terms: 'resultado atendeu atendida caixa postal corrigir ligacao reabrir apagou sumiu',
      },
      {
        q: 'Como concluo uma atividade e já agendo a próxima?',
        a: 'Abra a atividade, ou a “Próxima ação” da ficha, e use “Concluir e agendar a próxima”. Informe o resultado, se for ligação, uma anotação e a nova ação, com tipo, prazo e responsável, ligada ao mesmo contato, empresa e oportunidade. As duas gravações acontecem juntas, e, se um colega mudou a atividade antes, nada é gravado e o CRM mostra a versão atual. Depois de um “Concluir” simples, o aviso oferece “Agendar a próxima”. Donos, administradores e colaboradores concluem e agendam.',
        terms: 'concluir agendar proximo passo retorno follow-up finalizar',
      },
    ],
  },
  // Item 1.10: a LGPD da empresa controladora (base legal, "Não contatar" no servidor, exportação e anonimização).
  {
    id: 'privacidade',
    title: 'Privacidade e LGPD',
    items: [
      {
        q: 'O CRM cuida da LGPD da empresa?',
        a: 'O CRM ajuda, mas quem responde pelos dados é a empresa que usa o CRM, a controladora. Ele guarda a base legal de cada contato, a marca “Não contatar” e o registro de quem exportou ou anonimizou dados, e oferece “Exportar dados deste contato” e “Anonimizar contato”, para donos e administradores atenderem os pedidos das pessoas. O aviso de privacidade, o prazo de guarda dos dados e o contrato com quem implantou o CRM são da empresa. Peça a quem implantou o CRM os modelos de aviso de privacidade e de termo, que precisam de revisão jurídica.',
        terms:
          'lgpd privacidade dados pessoais controladora operador titular protecao lei encarregado dpo aviso politica',
      },
      {
        q: 'O que é a “Base legal” de um contato?',
        a: 'É o motivo pelo qual a empresa pode tratar os dados da pessoa: consentimento, contrato ou pedido da pessoa, legítimo interesse, obrigação legal ou exercício de direitos. Contatos novos recebem a “Base legal padrão dos contatos novos”, que donos e administradores escolhem em “Configurações”, na aba “Organização”, inclusive os importados sem base legal na planilha (sem a coluna base_legal, com ela vazia ou com “Não informada”) e os que chegam por integração. Contatos antigos começam como “Não informada”. Donos, administradores e colaboradores mudam a base em “Editar cadastro”, e o CRM grava quem mudou e quando. Na dúvida sobre qual usar, consulte quem cuida do jurídico da empresa.',
        terms: 'base legal fundamento tratamento legitimo interesse contrato padrao consentimento',
      },
      {
        q: 'Como registro que um contato deu consentimento?',
        a: 'Em “Editar cadastro”, escolha “Consentimento” em “Base legal” e descreva em “Como a pessoa consentiu” quando e por onde ela aceitou, por exemplo, marcou a caixa do formulário do site em 10/10/2026. O CRM guarda à parte quem fez o registro e quando, pela hora do servidor; escreva no texto quando e por onde a pessoa consentiu. Na importação, a coluna base_legal com Consentimento precisa da coluna registro_base_legal. Se a pessoa retirar o consentimento, troque a base e use “Marcar como não contatar”. Donos, administradores e colaboradores registram a base legal.',
        terms: 'consentimento aceite autorizacao opt-in optin prova registrar revogar retirar',
      },
      {
        q: 'Uma pessoa pediu os dados dela. Como atendo?',
        a: 'Na ficha do contato, donos e administradores usam “Exportar dados deste contato”. O CRM gera um .zip com um texto explicativo, os dados em JSON e planilhas do cadastro, das atividades, das oportunidades, dos itens delas e dos recebimentos, e registra quem exportou e quando. Vão também as atividades e os recebimentos das oportunidades da pessoa ligados a outros contatos, com o nome, o e-mail e o telefone gravados no cadastro deles trocados por [anonimizado]. Os nomes da equipe não vão no arquivo. Revise antes de enviar: anotações internas podem ter segredo comercial ou dados de terceiros que o CRM não reconhece, como apelidos e telefones antigos. Confirme a identidade de quem pediu, envie por canal seguro e apague o arquivo. A LGPD prevê resposta completa em até 15 dias.',
        terms: 'acesso titular portabilidade exportar baixar meus dados copia pedido zip json direito',
      },
      {
        q: 'Uma pessoa pediu para apagar os dados dela. Como faço?',
        a: 'Donos e administradores usam “Anonimizar contato” na ficha, também quando o contato não tem vínculos. O CRM apaga os dados pessoais e o vínculo com a empresa, que continua cadastrada, tira o título e as anotações das atividades com a pessoa, exclui as ações pendentes com ela e troca o nome, o e-mail e o telefone por [anonimizado] nos títulos de oportunidades, itens, recebimentos e outros registros. Valores, situações e datas ficam, e os relatórios mantêm os números. Não dá para desfazer. Apelidos, um telefone que não está no cadastro e outros dados digitados nos títulos não são reconhecidos, então revise os títulos antes. “Excluir cadastro” não atende o pedido sozinho, porque remove só o cadastro, não tira o nome de outros registros e não entra em “Exportações e anonimizações”.',
        terms: 'apagar excluir eliminar meus dados anonimizar anonimizacao esquecimento titular remover deletar',
      },
      {
        q: 'Por que um texto de outro contato terminou com reticências depois de uma anonimização?',
        a: 'Quando a pessoa anonimizada é citada no motivo do “Não contatar” ou no registro da base legal de outro contato, ou no motivo do “Não contatar” de uma empresa, o CRM troca o nome, o e-mail e o telefone por [anonimizado]. Esses campos guardam até 500 caracteres, e a troca pode passar do limite. Nesse caso, o fim do texto é cortado e marcado com reticências, sem deixar um [anonimizado] pela metade. Donos, administradores e colaboradores completam o registro da base legal em “Editar cadastro”.',
        terms: 'reticencias cortado cortou texto incompleto limite caracteres anonimizado motivo registro',
      },
      {
        q: 'Qual a diferença entre “Não contatar”, “Anonimizar contato” e “Excluir cadastro”?',
        a: '“Não contatar” mantém o cadastro e impede procurar a pessoa pelo CRM, para quem pediu para não receber contato. “Anonimizar contato” apaga os dados pessoais, tira o nome, o e-mail e o telefone dos outros registros e mantém o histórico comercial sem nomes, para quem pediu a exclusão dos dados, com ou sem vínculos. “Excluir cadastro” remove só o cadastro sem vínculos, sem mexer nos outros registros que citam a pessoa. Depois de anonimizar, o CRM não reconhece a pessoa se ela for cadastrada de novo. Para respeitar só um pedido de não receber contato, prefira “Não contatar”. Donos, administradores e colaboradores marcam “Não contatar”; anonimizar e excluir ficam com donos e administradores.',
        terms: 'diferenca anonimizar excluir apagar nao contatar bloquear opt-out',
      },
      {
        q: 'Por que o CRM não deixa agendar uma ligação para um contato “Não contatar”?',
        a: 'Com a marca, o CRM recusa criar ou reabrir ligação, WhatsApp, e-mail, reunião ou visita pendente para o contato, também pela próxima ação e por integrações. Tarefas internas continuam. Para registrar o que já aconteceu, como uma ligação recebida, crie a atividade com “Já aconteceu”. Na empresa marcada, a recusa vale para ligação e WhatsApp sem contato. Ações agendadas antes da marca continuam na agenda até você concluir ou trocar por tarefa. Donos, administradores e colaboradores criam atividades.',
        terms: 'recusa recusado bloqueado agendar ligacao nao deixa ja aconteceu registrar recebida reuniao visita',
      },
      {
        q: 'Onde vejo quem exportou ou anonimizou dados?',
        a: 'Em “Segurança”, donos e administradores veem “Exportações e anonimizações”, com a data, a ação, o contato e quem fez. Na ficha do contato, a seção “Privacidade” mostra o último registro. O registro guarda o identificador do contato, e não o nome, então um contato anonimizado aparece como “Contato anonimizado”.',
        terms: 'registro auditoria historico quem exportou anonimizou log',
      },
      {
        q: 'O CRM faz cópia de segurança dos dados?',
        a: 'Não sozinho. As cópias ficam com quem administra o projeto do Supabase do CRM: o plano pago do Supabase faz cópias diárias, e quem publicou o CRM pode ligar uma cópia agendada e cifrada. Restaurar uma cópia volta o CRM inteiro à data dela, e não um registro só. O que foi feito depois dela se perde, e todos entram de novo. Se um registro foi excluído por engano, avise quem administra o CRM o quanto antes: as cópias ficam guardadas só por alguns dias, e quem administra pode abrir uma cópia num projeto à parte e cadastrar o registro de novo, à mão. Para saber se a cópia está ligada e por quanto tempo ela é guardada, pergunte a quem publicou o CRM.',
        terms:
          'backup backups copia copias seguranca restaurar restauracao recuperar apagado apaguei excluido perdido perdi sem querer',
      },
      {
        q: 'A anonimização apaga os dados das cópias de segurança e dos arquivos exportados?',
        a: 'Não. O CRM apaga os dados no sistema em uso. Cópias de segurança guardam o estado anterior até expirarem, arquivos exportados ficam no computador de quem exportou, e mensagens trocadas pelo WhatsApp ou pelo e-mail ficam nesses aplicativos. Apague os arquivos que não precisa mais. Guarde fora do CRM a lista dos pedidos atendidos, com a data, para refazer a anonimização se uma cópia antiga for restaurada.',
        terms: 'backup copia seguranca restaurar arquivo exportado planilha whatsapp email',
      },
      {
        q: 'Como apago os dados de uma empresa?',
        a: 'A anonimização vale para contatos, que são pessoas. Se a empresa for a própria pessoa, como um MEI com o nome dela, use “Editar cadastro” na empresa para trocar o nome e apagar o telefone, ou “Excluir cadastro”, se ela não tiver vínculos, e anonimize os contatos dela. Donos, administradores e colaboradores editam empresas; excluir e anonimizar ficam com donos e administradores.',
        terms: 'empresa mei pessoa juridica apagar anonimizar excluir',
      },
    ],
  },
  {
    id: 'planilhas',
    title: 'Planilhas, exportação e integrações',
    items: [
      {
        q: 'Como importo contatos de uma planilha?',
        a: 'Em “Integrações”, use “Baixar modelo CSV”, preencha e escolha o arquivo, com até 5.000 contatos e 5 MB, ou use a sua planilha salva em CSV. Só o nome é obrigatório. A prévia conta as linhas prontas, as repetidas e as com erro, com o motivo de cada uma, e nada é gravado antes de “Importar”. Ali você escolhe o responsável pelos contatos sem a coluna responsavel ou com a célula vazia: você, outra pessoa ou “Distribuir igualmente entre” pessoas ativas da equipe. “Origem dos contatos sem origem na planilha (opcional)” completa a origem que faltar. A coluna empresa liga o contato a uma empresa cadastrada ou cria a empresa só com o nome; as oportunidades são cadastradas nas telas. A gravação acontece em partes. Donos, administradores e colaboradores importam.',
        terms:
          'importar importacao planilha excel csv subir lista carregar vendedor vendedores distribuir dividir responsavel leads',
      },
      {
        q: 'Que colunas a planilha de contatos aceita?',
        a: 'As do modelo: nome, sobrenome, email, telefone, empresa, cargo, origem, responsavel, relacionamento, observacoes, nao_contatar, base_legal e registro_base_legal. O CRM também reconhece nomes comuns, como Nome completo, E-mail, Celular, WhatsApp e Vendedor, sem diferença de acento ou maiúscula. Duas colunas para a mesma informação, como Telefone e Celular, não são aceitas, então deixe uma. Em responsavel, use o nome ou o e-mail de uma pessoa ativa da equipe. Na coluna nao_contatar, escreva sim para marcar o contato novo. Em base_legal, vazia ou “Não informada” vale a base padrão da empresa, e a prévia avisa quantos contatos a recebem; Consentimento precisa do registro de como a pessoa consentiu. A empresa é ligada a uma cadastrada com o mesmo nome ou criada. As demais colunas são ignoradas, e a prévia as lista.',
        terms: 'coluna colunas cabecalho campos modelo sinonimo nome celular whatsapp empresa cargo origem obrigatoria',
      },
      {
        q: 'Como salvo a planilha do Excel em CSV?',
        a: 'O CRM lê arquivos CSV, e não .xlsx. No Excel, use Arquivo > Salvar como (no Microsoft 365 com o salvamento automático ligado, Arquivo > Salvar uma Cópia) e escolha CSV UTF-8 (delimitado por vírgulas). No Excel do Windows, CSV (separado por vírgulas) também funciona, e o CRM lê os acentos dele; no Mac, use só o CSV UTF-8, porque o outro formato pode trocar os acentos. Quando a prévia disser que o arquivo está no formato CSV comum do Excel, confira os acentos dos nomes. No Google Planilhas, use Arquivo > Fazer download > Valores separados por vírgula (.csv). Se um telefone aparecer como 5,51E+12, formate a coluna como Texto, digite o número de novo e salve.',
        terms:
          'xlsx xls ods excel mac macintosh google planilhas salvar converter formato acentos acento trocado codificacao notacao cientifica',
      },
      {
        q: 'Por que algumas linhas ficaram fora da importação?',
        a: 'Repetidas têm o e-mail ou o telefone de um contato já cadastrado ou de uma linha anterior da planilha; o CRM não junta nem atualiza o contato existente. Linhas com erro têm o motivo na prévia, como falta de nome, e-mail inválido ou responsável desativado. Use “Baixar contatos não importados”, corrija as linhas nesse arquivo e importe-o de novo: as repetidas continuam fora, e as corrigidas entram. Se o telefone repetido for de uma empresa ou de uma família, marque “Importar também as linhas com telefone repetido”. Uma repetida que pede “Não contatar” avisa quando o contato cadastrado não tem a marca, para você marcar na ficha.',
        terms: 'repetido repetidos duplicado duplicados erro erros ignorado ignoradas fora faltou rejeitado linha',
      },
      {
        q: 'A importação de contatos parou no meio. O que faço?',
        a: '“Parar” termina a parte em andamento e mostra quantos contatos já foram gravados. Depois, use “Continuar importação” na mesma janela: o CRM grava só os contatos que faltam, sem duplicar. Fechar a janela com contatos por gravar pede confirmação. Se a janela foi fechada, escolha o arquivo de novo, e os contatos já gravados com e-mail ou telefone aparecem como repetidos, mas os sem e-mail e sem telefone entrariam de novo. As empresas novas criadas antes da parada continuam cadastradas. Se um responsável foi desativado no meio, a prévia volta com o que falta, para você conferir antes de continuar.',
        terms: 'parou interrompida caiu conexao continuar retomar metade travou',
      },
      // Revisão do item 1.11, achado 9: a recusa do banco com código não é repetível, e a orientação é uma só.
      {
        q: 'A importação de contatos parou com um código de erro. O que faço?',
        a: 'Quando a mensagem diz que a gravação de um lote foi recusada e cita um código, tentar de novo daria a mesma recusa, e a janela não oferece “Continuar importação”. Use “Baixar contatos não importados”: o arquivo traz só as linhas que faltam, com o motivo de cada uma. Confira essas linhas, corrija o que estiver fora do padrão e importe esse arquivo, sem duplicar os contatos que já entraram. Se a recusa continuar, informe o código a quem administra o CRM.',
        terms: 'codigo erro recusou recusa banco lote parou falhou',
      },
      // Revisão do item 1.13: a recusa de um gancho de validação na importação vale para o lote inteiro, e a análise do
      // navegador não conhece a regra; continuar sem corrigir repete a recusa.
      {
        q: 'A importação de contatos parou com uma regra da empresa. O que faço?',
        a: 'Uma regra própria da sua empresa, acrescentada por quem publicou o CRM, recusou uma linha da planilha. O CRM grava os contatos em partes, e a linha recusada impede a gravação da parte inteira em andamento, sem dizer qual linha foi; as partes anteriores continuam gravadas. Se a janela avisa que nada mudou nos contatos que faltam, “Continuar importação” sem corrigir dá a mesma recusa. Use “Baixar contatos não importados”: o arquivo traz só os contatos que faltam. Corrija nele o que a mensagem pede, em todas as linhas, e importe esse arquivo. Não escolha a planilha inteira de novo: os já gravados sem e-mail e sem telefone entrariam de novo, duplicados. Se a regra parecer errada, fale com quem publicou o CRM.',
        terms: 'importacao importar planilha regra regras empresa recusa recusou mensagem parou validacao',
      },
      {
        q: 'Como exporto contatos, reuniões ou relatórios?',
        a: 'Em “Integrações”, donos e administradores usam “Exportar contatos”, uma planilha com ponto e vírgula, pronta para o Excel, com as colunas do modelo de importação nome, sobrenome, email e telefone, mais nao_contatar, base_legal e registro_base_legal. Ela deixa de fora os contatos anonimizados e pode ser reimportada sem perder o +55 dos telefones, a marca “Não contatar” nem o consentimento; num CRM com base padrão, quem está com “Não informada” recebe o padrão, e a prévia avisa. “Exportar reuniões” gera um arquivo de calendário com as reuniões e as visitas pendentes. Os dados de uma pessoa, para atender um pedido dela, saem por “Exportar dados deste contato”, na ficha. Em “Relatórios”, qualquer papel baixa em CSV as oportunidades do recorte e os itens delas.',
        terms: 'exportar exportacao baixar download planilha excel csv ics calendario base legal nao contatar',
      },
      // Item 1.16: a importação do catálogo, sobre o leitor de planilhas do 1.11.
      {
        q: 'Como importo o catálogo por planilha?',
        a: 'Em “Configurações”, na aba “Catálogo”, donos e administradores usam “Baixar modelo” e depois “Importar planilha”, com um CSV de até 5.000 linhas. Nome e preço são obrigatórios; código, tipo, unidade e cobrança são opcionais, e cabeçalhos como produto, serviço, SKU, valor e recorrência também valem. A prévia separa as linhas prontas, as repetidas e as com erro, com o número da linha do Excel e o motivo, e nada é gravado antes de importar. Repetida é a linha com o código de um item do catálogo, mesmo arquivado, ou de outra linha da planilha; sem código, com o mesmo nome. A importação não muda nem reativa os itens que já existem. Use “Baixar itens não importados” para corrigir e importar de novo.',
        terms: 'importar importacao catalogo produto servico planilha csv excel modelo repetido sku preco',
      },
      // Item 1.15 (achado 2 da revisão do 1.16): "Parar" e "Continuar importação" também valem para o catálogo.
      {
        q: 'A importação do catálogo parou. O que faço?',
        a: '“Parar” termina a parte em andamento e mostra quantos itens já foram gravados. Depois, use “Continuar importação” na mesma janela: o CRM grava só os itens que faltam, sem duplicar. Quando a recusa não se resolve tentando de novo, como a falta de permissão, a janela não oferece “Continuar importação”: use “Baixar itens não importados”, corrija o que a mensagem apontar e importe esse arquivo. Se a janela foi fechada, escolha o mesmo arquivo de novo: os itens já gravados aparecem como repetidos, pelo código ou, sem código, pelo nome, e ficam de fora.',
        terms: 'parou interrompida caiu conexao continuar retomar metade travou catalogo produto servico importacao',
      },
      {
        q: 'Os contatos e a agenda são sincronizados automaticamente?',
        a: 'Não. A troca de dados é sempre manual: importação e exportação de contatos por planilha e exportação de reuniões e visitas por arquivo de calendário, para o Google Agenda, o Outlook ou o Calendário da Apple. Gere uma nova exportação depois de alterar a agenda. O CRM também não envia e-mails nem mensagens de WhatsApp aos seus contatos: os botões “WhatsApp” e “E-mail” abrem o seu aplicativo com o texto, e quem envia é você.',
        terms: 'sincronizar sincronizacao google outlook integracao whatsapp enviar mensagem',
      },
      {
        q: 'Por que “Integrações” diz que a tela não é para o meu papel?',
        a: '“Integrações” importa contatos de planilhas, o que exige permissão de edição, e exporta contatos e reuniões, o que fica com donos e administradores. Com “Somente leitura”, a tela explica o motivo e oferece “Ir para Hoje”. “Equipe”, “Configurações”, “Automações” e “Segurança” continuam abertas para consulta: a “Equipe” mostra quem são os donos e administradores, a quem pedir outro acesso.',
        terms: 'sem permissao acesso negado bloqueado',
      },
    ],
  },
  {
    id: 'pipeline',
    title: 'Pipeline e oportunidades',
    items: [
      {
        q: 'Como acompanho uma negociação?',
        a: 'Em “Pipeline”, escolha o funil no topo e use “Nova oportunidade”: informe a etapa, o valor (ou os itens), o responsável e o contato. Abra o cartão para ver os detalhes, as “Próximas ações” e o “Histórico de movimentações”, e use “Combinar ação” para registrar o próximo passo. Para trocar o “Responsável”, use “Editar”. Donos, administradores e colaboradores criam e editam; quem tem “Somente leitura” consulta.',
        terms: 'negocio venda oportunidade kanban funil trocar responsavel dono vendedor',
      },
      {
        q: 'Como digito valores em reais?',
        a: 'Do jeito brasileiro: 1.500,00, 1.500 ou 1500,50. Um único ponto com uma ou duas casas também vale como centavos: 12.5 é R$ 12,50. Enquanto você digita, o campo mostra a “Prévia” do valor que será salvo; se aparecer “Formato não reconhecido”, revise o número. Vale para oportunidades e lançamentos do “Financeiro”, que donos, administradores e colaboradores criam e editam (quem tem “Somente leitura” só consulta), e também para o preço e o desconto em R$ dos itens e do catálogo. A quantidade de um item aceita até três casas, como 1,5.',
        terms: 'valor dinheiro moeda real virgula ponto centavos decimal',
      },
      // Item 1.16: itens da oportunidade, o cálculo e o desconto.
      {
        q: 'Como adiciono produtos e serviços a uma oportunidade?',
        a: 'Em “Nova oportunidade” ou em “Editar”, use “Adicionar itens”; no painel da oportunidade, “Adicionar itens” ou “Editar itens”. Em cada item, escolha em “Produto ou serviço” um item do catálogo, pela busca do nome ou do código, ou “Item avulso”. O nome, a unidade, o preço e a cobrança do catálogo vêm preenchidos e podem ser negociados. Use “Adicionar item” para outro e a lixeira para remover. No painel, “Salvar itens” grava. Donos, administradores e colaboradores editam os itens; quem tem “Somente leitura” vê os itens e os totais.',
        terms: 'item itens produto produtos servico servicos catalogo adicionar avulso quantidade linha proposta',
      },
      {
        q: 'Como o valor da oportunidade é calculado pelos itens?',
        a: 'O total de cada linha é a quantidade × o preço unitário, arredondado em centavos, menos o desconto. O “Total único” soma as linhas de cobrança única, e a “Mensalidade”, as mensais. O “Valor do contrato” é o total único mais a mensalidade × os “Meses do contrato”, de 1 a 120, que são obrigatórios quando há item mensal. Com itens, esse é o valor da oportunidade, calculado pelo CRM e sem edição direta. Sem itens, o valor é o digitado, como antes; ao remover todos os itens, o último valor calculado fica e volta a ser editável.',
        terms:
          'calculo calcular total soma valor contrato mensalidade mensal recorrente meses unico arredondamento centavos',
      },
      {
        q: 'Como funciona o desconto por item?',
        a: 'Em cada item, “Desconto” tem “Sem desconto”, “Em %” e “Em R$”. Em %, vale de 0,01 a 100, com até duas casas, e é calculado sobre o total da linha antes do desconto, arredondado em centavos. Em R$, vale até o total da linha. O resumo do item mostra a conta, como 2 × R$ 500,00 − 10% = R$ 900,00. O CRM não tem desconto no total da oportunidade: aplique-o nos itens.',
        terms: 'desconto abatimento porcentagem percentual reais negociar preco reduzir',
      },
      {
        q: 'Como movo uma oportunidade pelo teclado?',
        a: 'Use o menu “Mover ou alterar situação” do cartão (o botão de três pontos) para escolher a etapa, “Marcar como ganha”, “Marcar como perdida” ou “Reabrir”. O cartão muda de coluna na hora, o foco continua nele, e só ele fica travado até a gravação terminar; os outros seguem livres. Ao marcar como perdida, o CRM pede o motivo da perda. Se a gravação falhar, o cartão volta à etapa anterior e a mensagem aparece. Donos, administradores e colaboradores movem; quem tem “Somente leitura” vê o menu desabilitado e só consulta.',
        terms: 'mover mudar trocar arrastar etapa ganhar perder ganha perdida reabrir',
      },
      {
        q: 'Como crio um funil ou mudo as etapas?',
        a: 'Em “Configurações”, na aba “Funis”, donos e administradores criam um funil em “Novo funil” e mudam o nome dele em “Renomear funil”. Nas etapas, “Adicionar etapa” cria uma nova, e “Editar”, ao lado de cada uma, muda o nome, a “Probabilidade de ganho (%)” e a ordem de exibição. A empresa já começa com o funil Comercial e quatro etapas. O CRM ainda não exclui funis nem etapas. Os outros papéis consultam os funis nessa aba, e no “Pipeline” qualquer papel escolhe no topo o funil que quer ver.',
        terms:
          'criar nova novo funil etapa adicionar configurar mudar ordem pipeline kanban coluna excluir apagar remover',
      },
      {
        q: 'Renomear uma etapa muda as oportunidades de coluna?',
        a: 'Não. As oportunidades ficam ligadas à etapa, e não ao texto do nome. A edição de funis e etapas fica em “Configurações”, na aba “Funis”, e é feita por donos e administradores.',
        terms: 'etapa funil renomear ordem',
      },
      {
        q: 'O valor das oportunidades é dinheiro recebido?',
        a: 'Não. O valor da oportunidade é o da negociação (com itens, o valor do contrato), e a “Previsão ponderada” é uma estimativa. O dinheiro recebido fica nos lançamentos do “Financeiro”, com as situações “Pendente”, “Recebido” e “Cancelado”.',
        terms: 'receita faturamento recebimento',
      },
      {
        q: 'De onde vem a probabilidade de uma oportunidade?',
        a: 'Por padrão, da etapa em que ela está: ao mudar de etapa, a probabilidade acompanha, e o formulário mostra “Da etapa”. Para fixar outro valor, preencha “Probabilidade (%)” em “Editar”; apague o campo para voltar a usar a da etapa. Ganha conta como 100% e perdida como 0%; ao reabrir, volta a valer a da etapa. A “Previsão ponderada” soma valor (com itens, o do contrato) × probabilidade das oportunidades em aberto, por isso alterar a probabilidade de uma etapa em “Configurações” muda na hora a previsão das oportunidades que a acompanham. Donos, administradores e colaboradores editam a da oportunidade; a das etapas, só donos e administradores.',
        terms: 'porcentagem chance previsao forecast',
      },
      {
        q: 'O que acontece ao excluir uma oportunidade com atividades ou recebimentos?',
        a: 'Só donos e administradores excluem. Antes de confirmar, eles veem quantas atividades, recebimentos e registros de automação estão vinculados. Em “Desvincular e excluir”, a oportunidade, os itens dela e o histórico de movimentações de etapa saem; atividades e recebimentos continuam no CRM, sem o vínculo, e os registros de automação ficam no histórico. Para encerrar uma negociação preservando tudo, marque-a como perdida.',
        terms: 'apagar deletar remover exclusao',
      },
    ],
  },
  {
    id: 'rotina',
    title: 'Hoje, agenda e tarefas',
    items: [
      {
        q: 'O que significa a fila de atenção?',
        a: 'Em “Hoje”, a “Fila de atenção” lista o que precisa de atenção no recorte escolhido, como a sua rotina ou a de uma pessoa da equipe, e diz o motivo de cada item. As quatro regras são: atividades vencidas; atividades, contatos ou oportunidades sem responsável, ou com o responsável desativado; contatos e oportunidades sem próxima ação (menos os contatos encerrados ou marcados “Não contatar”); e oportunidades paradas. Donos e administradores ligam ou desligam cada regra e mudam a prioridade e os “Dias sem atualização” em “Configurações”, na aba “Fila de atenção”. Use “Abrir ficha e resolver” para tratar o item.',
        terms: 'pendencia pendencias alerta prioridade regras parada atrasada',
      },
      {
        q: 'Por que a fila mostra muitos contatos num item só?',
        a: 'Com mais de 10 contatos sem próxima ação, como depois de uma importação, a fila os reúne num item para não esconder o restante. “Ver contatos sem próxima ação” abre “Contatos” com esse filtro. Contatos cadastrados há menos de 1 dia, os encerrados e os marcados “Não contatar” não entram na contagem, e só contam os do recorte escolhido, como “Minha rotina” ou uma pessoa da equipe. O filtro de “Contatos” lista os de toda a equipe, inclusive os encerrados, os marcados “Não contatar” e os cadastrados nas últimas 24 horas, e pode mostrar mais que o número do item. Da mesma forma, mais de 10 contatos ativos de uma mesma pessoa desativada viram um item; “Ver na Equipe” abre a “Equipe”, onde donos e administradores usam “Passar carteira”.',
        terms: 'agrupado agrupados agrupa juntos desativado',
      },
      // Item 1.12: os lembretes no menu, com a regra de "Minha rotina".
      {
        q: 'O que é o número ao lado de “Hoje” no menu?',
        a: 'São as suas pendências com prazo até o fim do dia: as vencidas e as que vencem até a meia-noite, as mesmas de “Próximos passos do dia” em “Minha rotina”. No menu expandido do computador, o número com o triângulo conta as vencidas, e o com o relógio, as que ainda vencem hoje; no menu recolhido e no celular, aparece o total, num selo preenchido quando alguma venceu. Contam tarefas, ligações, WhatsApp, e-mails, reuniões e visitas, inclusive uma ação agendada antes de o contato ser marcado “Não contatar”. Notas, atividades sem prazo e as de colegas não contam, nem quando “Hoje” mostra outra pessoa. O número muda ao concluir ou reagendar, quando um prazo passa e ao voltar para a aba. O CRM não envia lembretes por e-mail nem notificações.',
        terms:
          'lembrete lembretes numero contador badge selo menu vencida vencidas atrasada atrasadas prazo aviso alerta notificacao',
      },
      // Revisão do item 1.12: o relógio do menu conta só as que ainda vencem hoje, e "Para hoje" também as já vencidas.
      {
        q: 'Por que o número do menu é diferente de “Para hoje”?',
        a: 'O número com o relógio, no menu expandido do computador, conta só as atividades que ainda vencem hoje, de agora até a meia-noite. Em “Hoje”, “Para hoje” conta todas as de hoje, inclusive as que já venceram, e “Vencidas” conta as de hoje e as de dias anteriores. Por isso, uma atividade de hoje já vencida aparece nos dois indicadores da tela e, no menu, só no número com o triângulo. O total do menu é sempre o número de atividades de “Próximos passos do dia” em “Minha rotina”. Com “Toda a organização” ou outra pessoa escolhida em “Hoje”, os indicadores da tela são desse recorte, e o número do menu continua sendo o seu.',
        terms: 'lembrete lembretes numero contador badge menu relogio diferente bate indicador vencidas',
      },
      // Revisão do item 1.12: a leitura que falhou sem nenhuma anterior mostra um "?" neutro no lugar do número.
      {
        q: 'O que quer dizer o ponto de interrogação ao lado de “Hoje” no menu?',
        a: 'O CRM não conseguiu conferir os seus lembretes, por exemplo, por falta de conexão. Não quer dizer que você está sem pendências. O CRM tenta de novo ao voltar para a aba e quando uma atividade é gravada, e o número volta assim que a leitura dá certo. Abrir “Hoje”, ou usar “Tentar novamente” nele, também confere de novo os lembretes. Em “Hoje”, você vê as suas atividades ou o aviso de que a rotina não carregou.',
        terms: 'interrogacao lembrete lembretes numero sumiu erro falha conexao internet menu',
      },
      // Item 1.14: o recorte de uma pessoa da equipe em Hoje, Atividades, Tarefas e Agenda.
      {
        q: 'Como vejo a rotina de outra pessoa da equipe?',
        a: 'Em “Hoje”, “Atividades”, “Tarefas” e “Agenda”, o seletor do responsável lista, abaixo de “Minha rotina” (ou “Minhas atividades” e “Minha agenda”) e “Toda a organização”, as pessoas da equipe. Quem foi desativado aparece por último, com “(desativado)”. Em “Hoje”, os indicadores, os próximos passos e a fila de atenção passam a ser da pessoa escolhida, e a tela diz de quem é a rotina. O número ao lado de “Hoje”, no menu, continua contando só as suas atividades. Uma atividade criada com uma pessoa escolhida começa com ela no “Responsável” (com você, se ela foi desativada). Todos os papéis, inclusive “Somente leitura”, veem a rotina da equipe, como já viam “Toda a organização”; donos, administradores e colaboradores também editam as atividades dos colegas.',
        terms:
          'vendedor vendedora vendedores pessoa colega colegas equipe filtro filtrar responsavel carteira rotina gestor gestora gerente acompanhar desativado outra',
      },
      // Revisão do item 1.14: quem foi desativado passou as pendentes a quem recebeu a carteira (D9), e "Pendentes" fica
      // vazia; o histórico e os contatos que ficaram estão em outro lugar.
      {
        q: 'Escolhi uma pessoa desativada e “Atividades” ficou vazia. Por quê?',
        a: 'Ao desativar alguém, as atividades pendentes e as oportunidades em aberto dessa pessoa passam para quem recebe a carteira. Por isso, com ela escolhida, “Atividades” e “Tarefas” em “Pendentes” costumam ficar vazias. Use “Ver o histórico”, ou escolha “Todas” ou “Concluídas / notas”, para ver o que ela registrou. Em “Hoje”, “Ver atividades” já abre “Todas”, e a fila de atenção mostra os contatos que ficaram com ela, quando quem desativou não os passou junto. Para passar esses contatos a outra pessoa, donos e administradores usam “Passar carteira”, em “Equipe”.',
        terms: 'desativado desativada saiu vazia vazio historico pendentes concluidas carteira vendedor',
      },
      {
        q: 'Por que a mesma atividade aparece em mais de uma tela?',
        a: '“Hoje”, “Agenda”, “Atividades”, “Tarefas” e a ficha do relacionamento são visões dos mesmos registros. Concluir, reabrir ou reagendar uma atividade muda esse registro em todas as visões; não é uma nova atividade.',
      },
      {
        q: 'Como registro a próxima ação?',
        a: 'Crie uma atividade com prazo (tarefa, ligação, WhatsApp, e-mail, reunião ou visita), de preferência com responsável, e vincule ao contato, à empresa ou à oportunidade. Só uma atividade pendente com prazo conta como próxima ação: notas e atividades sem prazo não contam. O registro de uma conversa e “Concluir e agendar a próxima” já oferecem a próxima ação, e, na oportunidade, “Combinar ação” cria a ação vinculada, com o tipo que você escolher. Para um contato marcado “Não contatar”, a próxima ação só pode ser uma tarefa, e o que já aconteceu entra com “Já aconteceu”. Donos, administradores e colaboradores registram ações; quem tem “Somente leitura” só consulta.',
        terms: 'proximo passo tarefa retorno follow-up compromisso',
      },
      {
        q: 'Quem pode concluir, editar ou excluir uma atividade?',
        a: 'Donos, administradores e colaboradores criam, usam “Editar / reagendar”, “Concluir”, “Concluir e agendar a próxima” e “Reabrir”, inclusive nas atividades de colegas. Excluir é só para donos e administradores e não tem volta: a atividade sai da rotina e dos históricos vinculados. Quem tem “Somente leitura” consulta.',
        terms: 'apagar deletar concluir finalizar tarefa',
      },
    ],
  },
  {
    id: 'financeiro',
    title: 'Financeiro e relatórios',
    items: [
      {
        q: 'Como registro um recebimento?',
        a: 'Em “Financeiro”, use “Novo lançamento” com descrição, valor, vencimento e situação, e vincule a oportunidade, o contato ou a empresa. Ao marcar “Recebido”, informe “Recebido em”. “Vencido” aparece sozinho no lançamento pendente com vencimento antes de hoje. Donos, administradores e colaboradores registram e editam; para tirar um lançamento das contas sem apagar o lançamento, mude a situação para “Cancelado”. Excluir é só para donos e administradores.',
        terms: 'pagamento parcela cobranca lancamento financeiro receber vencimento',
      },
      {
        q: 'Em que período uma venda ganha aparece nos “Relatórios”?',
        a: 'No período da data de fechamento: uma oportunidade criada em agosto e ganha em outubro conta em outubro. A data é registrada ao marcar como ganha ou perdida e pode ser corrigida em “Fechada em”, ao editar, entre a criação e hoje; ela é diferente da “Previsão de fechamento”. Ao reabrir, a data de fechamento sai, e a oportunidade volta a entrar pela data de criação, como todas as em aberto. Donos, administradores e colaboradores corrigem essa data.',
        terms: 'relatorio periodo data fechamento mes vendas',
      },
      // Item 1.16: qual valor conta nos números e a planilha dos itens.
      {
        q: 'Qual valor os relatórios e a previsão usam?',
        a: 'O valor de cada oportunidade: o digitado ou, com itens, o valor do contrato, que é o total único mais a mensalidade × os meses. Ele entra nos totais do “Pipeline”, na “Previsão ponderada”, nos números dos “Relatórios” e em “Ganhos por responsável”. Quando alguma ganha do período tem mensalidade, “Mensalidades ganhas” mostra quanto entra por mês; o ganho já inclui essa mensalidade multiplicada pelos meses de cada contrato. Nada disso é dinheiro recebido, que fica no “Financeiro”.',
        terms: 'valor contrato previsao relatorio mensalidade recorrencia mrr receita total unico forecast',
      },
      {
        q: 'Como exporto os itens das oportunidades?',
        a: 'Em “Relatórios”, abra “Exportar CSV” (no celular, o botão mostra só CSV) e escolha “Itens das oportunidades”: uma planilha com uma linha por item das oportunidades do recorte, com o funil, a etapa, o responsável, o item, o código, o tipo, a quantidade, o preço, o desconto, a cobrança, o total da linha e os meses do contrato. “Oportunidades” baixa a planilha de sempre, com o total único, a mensalidade e os meses ao lado do valor. Sem itens no recorte, a opção dos itens fica desabilitada. Todos os papéis exportam.',
        terms: 'exportar baixar planilha csv excel itens produtos servicos relatorio',
      },
      // Item 1.14: os ganhos por responsável nos Relatórios, pela data de fechamento.
      {
        q: 'Como vejo quanto cada pessoa ganhou no período?',
        a: 'Em “Relatórios”, o painel “Ganhos por responsável” soma, por pessoa, as oportunidades ganhas no período pela data de fechamento, como os outros números da tela, e respeita o funil e o responsável escolhidos nos filtros. Quem está ativo vem primeiro, do maior valor ganho para o menor; quem saiu da equipe vem depois, com “(desativado)”. Perdidas e em aberto não contam. O valor é o das oportunidades (com itens, o valor do contrato, e a linha mostra a mensalidade por mês, que entra no valor multiplicada pelos meses), e não o dinheiro recebido, que fica em “Financeiro”. Todos os papéis consultam os “Relatórios”.',
        terms:
          'vendas vendeu vendedor vendedora vendedores ganho ganhos ganhas ranking resultado responsavel pessoa equipe',
      },
    ],
  },
  {
    id: 'automacoes',
    title: 'Automações e modelos',
    items: [
      {
        q: 'O que devo conferir antes de ativar uma automação?',
        a: 'Toda automação nova nasce pausada. Em “Revisar e ativar”, confira o gatilho, o filtro de funil e etapa, o título da tarefa, o prazo e o responsável, que é o mesmo da oportunidade. A ativação vale só para eventos novos, em toda a organização. Só donos e administradores criam, editam, ativam, pausam e excluem automações; os outros papéis consultam as regras e as execuções. O tour nunca ativa uma automação.',
        terms: 'automacao regra gatilho ativar',
      },
      {
        q: 'Ao editar uma automação ativa, ela é pausada?',
        a: 'Não. A edição vale para os próximos eventos assim que é salva, e a automação continua ativa; só uma automação nova nasce pausada. Para interromper os disparos, use “Pausar”. Em “Oportunidade mudou de etapa”, escolha o funil e a etapa de entrada: a tarefa só é criada quando a oportunidade entra nela. Se esse funil ou essa etapa deixarem de existir, uma automação ativa é pausada. Só donos e administradores editam e pausam automações.',
        terms: 'editar alterar pausar filtro etapa',
      },
      {
        q: 'Posso excluir uma automação ou uma tarefa criada por ela?',
        a: 'Sim, donos e administradores podem. As tarefas que a automação já criou continuam na rotina, e o histórico de execuções fica guardado com o nome dela, mas deixa de aparecer em “Automações”; para manter o histórico visível, use “Pausar”. Em “Execuções”, uma falha mostra a mensagem para todos e, para donos e administradores, o detalhe técnico.',
        terms: 'apagar deletar remover exclusao falha erro execucao',
      },
      {
        q: 'Para que servem os “Modelos”?',
        a: 'Em “Modelos” (no menu, “Templates”), a equipe guarda textos prontos para e-mails e mensagens, com variáveis como o nome do contato. Use o modelo pelos botões “WhatsApp” e “E-mail” das fichas, que preenchem as variáveis e abrem o seu aplicativo, ou use “Copiar texto” e cole onde quiser. O CRM não envia mensagens aos seus contatos: quem envia é você. Donos, administradores e colaboradores criam e editam; excluir é só para donos e administradores.',
        terms: 'template templates texto pronto mensagem whatsapp email variavel',
      },
    ],
  },
  {
    id: 'copiloto',
    title: 'Copiloto',
    items: [
      {
        q: 'Como confiro uma sugestão do Copiloto?',
        a: 'Abra o Copiloto pelo botão “Abrir Copiloto”, no topo. Cada resposta mostra o que está “Registrado” e um link para o registro: confira lá antes de agir. “Revisar atividade sugerida” abre o formulário preenchido, e nada é salvo sem a sua confirmação.',
        terms: 'sugestao assistente prioridades',
      },
      {
        q: 'O Copiloto usa inteligência artificial?',
        a: 'Não nesta versão. Ele aplica regras fixas aos registros do CRM, como prazos vencidos e oportunidades paradas, e mostra de onde veio cada informação. Nenhum dado é enviado a um serviço de IA externo.',
        terms: 'ia chatgpt gpt robo assistente',
      },
    ],
  },
  {
    id: 'conexao',
    title: 'Conexão, erros e colegas',
    items: [
      {
        q: 'O que acontece se um colega alterar o mesmo registro que eu?',
        a: 'Se o colega salvou antes, a sua gravação não apaga a dele: a tela avisa que o registro mudou ou não está mais disponível e mantém o que você preencheu. Copie suas alterações, reabra o registro para ver a versão atual e salve de novo; nas regras da fila de atenção, use “Carregar versão atual”. Vale para contatos, empresas, oportunidades (com os itens), atividades, lançamentos, modelos, automações, funis, etapas, regras da fila e itens do catálogo. Mover de etapa não tem essa conferência: vale a última movimentação, que fica no histórico. “Hoje”, “Agenda”, “Atividades”, “Tarefas”, “Contatos”, “Empresas” e o “Pipeline” buscam as novidades quando você volta para a aba do CRM; enquanto você fica na aba, a tela mostra a última leitura.',
        terms: 'conflito simultaneo ao mesmo tempo sobrescrever desatualizado atualizar',
      },
      // Item 1.3: a CSP do vercel.json (frame-ancestors 'none') e o X-Frame-Options recusam abrir o CRM num quadro.
      {
        q: 'Posso abrir o CRM dentro de outro site ou sistema?',
        a: 'Não. Por segurança, o CRM se recusa a abrir dentro de outra página, como um quadro (iframe) de um site ou de outro sistema, para ninguém disfarçar a tela de entrada e capturar o que você digita. Abra o CRM direto pelo endereço dele, numa aba do navegador. Para levar alguém a uma tela, copie o endereço da aba: os links internos do CRM funcionam depois da entrada.',
        terms: 'iframe incorporar embutir quadro outro site intranet portal embed janela dentro',
      },
      {
        q: 'O que acontece se a internet cair?',
        a: 'Aparece o aviso “Sem conexão” no topo da tela. O CRM não guarda alterações para enviar depois: enquanto o aviso estiver aberto, salvar falha na hora com uma mensagem, e o que estava preenchido continua na tela. Quando a conexão voltar, o aviso some; salve de novo.',
        terms: 'offline internet wifi sem rede',
      },
      {
        q: 'O que faço quando uma lista não carrega?',
        a: 'Confira a conexão e use “Tentar novamente”. Uma falha de consulta é diferente de uma lista vazia; não conclua que os dados foram apagados. Se o erro continuar, informe a tela e a ação a quem administra o CRM.',
        terms: 'erro falha carregando lento sumiu',
      },
      {
        q: 'Por que não consigo criar ou editar um registro?',
        a: 'As ações dependem do seu papel: com “Somente leitura”, você consulta, mas não cria nem edita, e excluir é só para donos e administradores. A tela mostra o motivo quando falta permissão. Se o CRM disser que o responsável foi desativado, escolha outra pessoa em “Responsável”. Se disser que o contato foi anonimizado, cadastre um novo contato para um novo relacionamento com a pessoa. Para pedir outro acesso, veja em “Equipe” quem são os donos e administradores.',
        terms: 'permissao bloqueado desabilitado sem acesso',
      },
      // Item 1.13: a recusa de uma regra própria da empresa (gancho private.custom_*) chega à tela como está.
      {
        q: 'Apareceu uma mensagem que não reconheço ao salvar. O que é?',
        a: 'Pode ser uma regra própria da sua empresa, acrescentada por quem publicou o CRM, como um campo exigido para ganhar uma oportunidade. O CRM mostra a mensagem dessa regra e não grava a alteração. Nos formulários, o que você preencheu continua na tela; no “Pipeline”, a oportunidade volta para a etapa em que estava. Corrija o que a mensagem pede e salve de novo. Na importação de planilha, a regra recusa a parte inteira que estava sendo gravada. Se a regra parecer errada, fale com quem publicou o CRM.',
        terms:
          'regra regras empresa mensagem estranha desconhecida salvar recusado recusa nao salva validacao bloqueio erro',
      },
      {
        q: 'Onde vejo o histórico de alterações?',
        a: 'Em “Segurança”, donos e administradores veem o “Histórico de alterações”: quando, a ação, o tipo de registro e os campos alterados, sem o conteúdo. Essa tela não mostra quem fez cada alteração. As mudanças de etapa de cada oportunidade ficam no “Histórico de movimentações” dela, com quem fez. As exportações e as anonimizações de contatos ficam em “Exportações e anonimizações”, na mesma tela, com quem fez.',
        terms: 'auditoria log quem alterou registro de alteracoes',
      },
    ],
  },
];

/**
 * Perguntas que esta instância mostra: a do crédito "Feito com Empreende.IA" só aparece onde o crédito aparece (marca de
 * outra empresa com o crédito ligado). Sem o crédito, a Central não cita a base em lugar nenhum (item 1.6, AC-7).
 */
export function visibleFaqCategories(baseCredit: boolean = BRAND.baseCredit): FaqCategory[] {
  return FAQ_CATEGORIES.map((category) => ({
    ...category,
    items: category.items.filter((item) => baseCredit || !item.onlyWithBaseCredit),
  })).filter((category) => category.items.length > 0);
}

// Palavras que não ajudam a achar uma resposta: "como faço para importar" busca só "importar", e "o CRM tem IA?", só
// "crm" e "ia".
const STOPWORDS = new Set(
  'a o as os um uma uns umas de do da dos das em no na nos nas e ou para pra por com como que qual quais eu meu minha meus minhas faco fazer posso pode se ao aos sobre tem ter tenho ha'.split(
    ' ',
  ),
);

/**
 * Singular aproximado, para a busca tratar o plural e o singular como a mesma palavra: "funis" e "funil", "papéis" e
 * "papel", "reais" e "real", "itens" e "item", "automações" e "automação", "valores" e "valor", "convites" e
 * "convite". Os dois lados passam pela mesma regra, então um singular imperfeito ainda casa.
 */
function singular(word: string): string {
  if (word.length <= 3) return word;
  if (/(oes|aes|aos)$/.test(word)) return `${word.slice(0, -3)}ao`;
  if (word.endsWith('eis')) return `${word.slice(0, -3)}el`;
  if (word.length > 4 && word.endsWith('ais')) return `${word.slice(0, -3)}al`;
  if (/[^aeiou]is$/.test(word)) return `${word.slice(0, -2)}il`;
  if (word.endsWith('ns')) return `${word.slice(0, -2)}m`;
  if (/[rz]es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Texto para a busca: sem acentos, sem hífen entre letras ("e-mail" = "email") e sem pontuação. */
export function normalizeHelpText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\p{L})[-‐‑](?=\p{L})/gu, '$1')
    .replace(/[^\p{L}\p{N}+]+/gu, ' ')
    .trim();
}

/**
 * Busca da Central de ajuda: cada palavra da pesquisa (menos as de ligação) precisa estar na pergunta, na resposta, nos
 * sinônimos ou no título da categoria, sem diferenciar acentos, maiúsculas e hífens. A palavra conta inteira, no
 * singular ou no plural: "ia" não acha "dia", e "nova" não acha "novamente". Só a última, que a pessoa ainda pode estar
 * digitando, conta também pelo começo de uma palavra ("import" acha "importar"); com um espaço depois, ela também
 * conta inteira.
 */
export function searchFaq(query: string, categories: FaqCategory[] = FAQ_CATEGORIES): FaqCategory[] {
  const normalized = normalizeHelpText(query);
  if (!normalized) return categories;
  const words = normalized.split(' ');
  const meaningful = words.filter((word) => !STOPWORDS.has(word));
  const tokens = (meaningful.length ? meaningful : words).map((token, index, all) => ({
    singular: singular(token),
    prefix: index === all.length - 1 && !/\s$/.test(query) ? token : null,
  }));
  return categories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => {
        const haystack = normalizeHelpText(`${category.title} ${item.q} ${item.a} ${item.terms ?? ''}`).split(' ');
        const singulars = new Set(haystack.map(singular));
        return tokens.every(
          ({ singular: whole, prefix }) =>
            singulars.has(whole) || (prefix !== null && haystack.some((word) => word.startsWith(prefix))),
        );
      }),
    }))
    .filter((category) => category.items.length > 0);
}
