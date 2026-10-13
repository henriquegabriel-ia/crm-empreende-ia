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
        a: 'Quem faz o primeiro acesso de um CRM novo cria a empresa e fica com o papel de Dono. A empresa já começa com o funil Comercial, quatro etapas e as regras da fila de atenção. Depois, abra “Configurar CRM”, nesta Ajuda ou em “Ações rápidas” (o botão + do topo): o guia leva ao perfil, aos funis, aos contatos, às oportunidades e às tarefas e confere o progresso nos registros que já existem. A equipe entra por convite, em “Equipe”. Você pode usar as outras telas sem terminar o guia.',
        terms: 'comecar inicio primeiro acesso configuracao inicial onboarding guia checklist',
      },
      {
        q: 'O que cada papel pode fazer?',
        a: '“Dono” faz tudo, inclusive convidar outros donos, mudar o papel deles e desativar ou reativar donos. “Administrador” convida pessoas, muda papéis, desativa e reativa pessoas (sem tornar ninguém dono nem mexer em donos), configura a organização, os funis, a fila de atenção e as automações, exporta dados e exclui registros. “Colaborador” cria e edita contatos, empresas, oportunidades, atividades, lançamentos e modelos e importa contatos, mas não exclui registros nem muda configurações. “Somente leitura” consulta e não altera nada. Todos ajustam o próprio perfil e as preferências, e o papel de cada pessoa aparece em “Equipe”.',
        terms:
          'permissao permissoes acesso cargo funcao membro dono administrador colaborador leitura papel trocar mudar alterar desativar reativar',
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
        a: 'Não. Os tours só explicam a tela. O checklist “Configuração do CRM” marca uma etapa quando o registro existe de verdade: a da próxima ação, por exemplo, pede uma atividade pendente e com prazo, como tarefa, ligação, e-mail ou reunião (notas não contam).',
      },
      {
        q: 'Como mudo as preferências dos tours?',
        a: 'Nesta Ajuda, em “Como você prefere conhecer o CRM?”, marque ou desmarque “Mostrar convites discretos nas telas novas” e “Abrir novos tours automaticamente quando a tela estiver pronta”. A orientação automática vem desativada. As preferências e o progresso dos tours ficam neste navegador, separados por conta e organização. Qualquer papel pode mudar as próprias preferências.',
        terms:
          'preferencia preferencias tour tours convite convites discretos automatico automatica desligar ligar orientacao',
      },
      {
        q: 'Como funcionam os tours e a busca?',
        a: 'No topo de cada tela com tour, “Tour desta tela” abre o roteiro, que só mostra o que o seu papel pode usar. Esc pausa, “Continuar tour” retoma do passo salvo e “Recomeçar tour” volta ao início. Ctrl+K (⌘K no Mac) abre a busca, que encontra contatos, empresas, oportunidades e atividades pelo nome e abre as principais telas. Nesta Ajuda, “Abrir tela” leva às telas com tour.',
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
        a: 'Em “Equipe”, o cartão da pessoa desativada avisa quando os contatos e as empresas ficaram com ela. Donos e administradores usam “Passar carteira”: a confirmação mostra o que ainda está com ela e pede “Quem recebe a carteira”. Também dá para trocar o “Responsável” de cada registro ao editar o registro. Enquanto isso, em “Hoje”, com “Toda a organização”, a fila de atenção mostra esses contatos na regra de sem responsável; com mais de 10 contatos da mesma pessoa, eles aparecem num item só, e “Ver na Equipe” abre a “Equipe”.',
        terms: 'carteira transferir passar empresas contatos reatribuir trocar responsavel desativado',
      },
      {
        q: 'Por que um nome aparece com “(desativado)”?',
        a: 'É alguém que saiu da equipe. O nome continua nas oportunidades, atividades e históricos que ficaram com a pessoa, mas ela não entra mais no CRM e não aparece para ser escolhida como “Responsável”. Um registro que já estava com ela pode ser editado; para reabrir uma oportunidade ou uma atividade dela, troque antes o responsável. Donos, administradores e colaboradores trocam o responsável ao editar o registro.',
        terms: 'desativado nome marca ex membro responsavel',
      },
      {
        q: 'Apareceu “Seu acesso foi encerrado”. E agora?',
        a: 'Um dono ou administrador desativou o seu acesso a este CRM. Os registros continuam com a empresa, mas você não consegue mais consultar nem alterar nada. Se acha que é um engano, fale com quem administra o CRM; depois da reativação, use “Verificar de novo” (se o acesso continuar encerrado, a tela avisa). Para deixar a tela, use “Sair da conta”.',
        terms: 'acesso encerrado bloqueado desativado sem acesso',
      },
      {
        q: 'Que e-mails o CRM envia?',
        a: 'Só e-mails de acesso à conta. “Confirme seu e-mail” chega depois de “Cadastrar” ou do primeiro “Link por e-mail”. “Seu link de acesso” chega depois de “Link por e-mail”, de “Enviar link para o meu e-mail” ou de “Cadastrar” com um e-mail que já tem conta. Os dois trazem um botão e um código. “Redefina sua senha” chega depois de “Esqueceu a senha?”. “Ative sua conta” só chega se quem administra criou sua conta pelo painel do Supabase; depois de ativar, abra o link do convite da equipe, que quem administra manda a você (o CRM não o envia). Os avisos de senha e de e-mail alterados têm resposta própria. Se os e-mails chegarem em inglês, avise quem administra: os modelos de e-mail do CRM ainda não foram aplicados.',
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
        a: 'Abra a ficha do contato ou da empresa pela lista ou pela busca (Ctrl+K). Ela reúne as atividades, as oportunidades e a “Próxima ação”: a atividade pendente com o menor prazo entre os vínculos. Notas ficam no histórico, mas não contam como próxima ação.',
        terms: 'ficha 360 timeline historico',
      },
      {
        q: 'Por que não consigo excluir um contato ou uma empresa?',
        a: 'Só donos e administradores veem “Excluir cadastro”, que fica desabilitado enquanto o cadastro tiver vínculos. Logo abaixo, a ficha diz o que impede: contatos da empresa, oportunidades, atividades ou recebimentos do “Financeiro”. Para manter o histórico, preserve o cadastro; para excluir o cadastro, resolva antes esses vínculos.',
        terms: 'apagar deletar remover exclusao',
      },
      {
        q: 'Como reutilizo filtros da minha rotina?',
        a: 'Em “Contatos” e “Empresas”, ajuste a busca, os filtros, a ordem e as colunas, abra “Visões salvas” e use “Salvar visão atual”. A visão fica neste navegador, só para a sua conta nesta organização; para apagar a visão, use a lixeira ao lado do nome. “Limpar filtros” volta à lista completa.',
        terms: 'filtro filtros visao salva carteira colunas',
      },
      {
        q: 'Como os telefones são gravados e buscados?',
        a: 'Na importação por planilha, telefones do Brasil com DDD são gravados no padrão +55, como +5511999990000, e um número que o CRM não reconhece entra como está, sem perder o contato. No cadastro manual, o telefone fica como você digitou. A busca compara o texto gravado: para achar um número importado, digite os dígitos como estão nele, como 11999990000.',
        terms: 'telefone celular whatsapp numero ddd +55',
      },
    ],
  },
  {
    id: 'planilhas',
    title: 'Planilhas, exportação e integrações',
    items: [
      {
        q: 'Como importo contatos de uma planilha?',
        a: 'Em “Integrações”, use “Baixar modelo CSV”, preencha e escolha o arquivo (até 500 contatos e 2 MB). Só a coluna first_name, o nome, é obrigatória. O CRM aceita colunas separadas por ponto e vírgula ou por vírgula e arquivos salvos pelo Excel. A prévia mostra os contatos novos, ignora os e-mails já cadastrados e avisa os telefones que não reconheceu; nada é gravado antes de “Confirmar importação”. Os contatos importados ficam com você como responsável. A planilha traz só contatos: empresas e oportunidades são cadastradas nas telas. Donos, administradores e colaboradores podem importar.',
        terms: 'importar importacao planilha excel csv subir lista carregar',
      },
      {
        q: 'Como exporto contatos, reuniões ou relatórios?',
        a: 'Em “Integrações”, donos e administradores usam “Exportar contatos”, uma planilha com ponto e vírgula, pronta para o Excel, que pode ser reimportada sem perder o +55 dos telefones, e “Exportar reuniões”, um arquivo de calendário com as reuniões pendentes. Em “Relatórios”, qualquer papel baixa em CSV as oportunidades do recorte.',
        terms: 'exportar exportacao baixar download planilha excel csv ics calendario',
      },
      {
        q: 'Os contatos e a agenda são sincronizados automaticamente?',
        a: 'Não. A troca de dados é sempre manual: importação e exportação de contatos por planilha e exportação de reuniões por arquivo de calendário, para o Google Agenda, o Outlook ou o Calendário da Apple. Gere uma nova exportação depois de alterar a agenda. O CRM também não envia e-mails nem mensagens de WhatsApp aos seus contatos: copie o texto de um modelo e envie pelo seu aplicativo.',
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
        a: 'Em “Pipeline”, escolha o funil no topo e use “Nova oportunidade”: informe a etapa, o valor, o responsável e o contato. Abra o cartão para ver os detalhes, as “Próximas ações” e o “Histórico de movimentações”, e use “Combinar ação” para registrar o próximo passo. Para trocar o “Responsável”, use “Editar”. Donos, administradores e colaboradores criam e editam; quem tem “Somente leitura” consulta.',
        terms: 'negocio venda oportunidade kanban funil trocar responsavel dono vendedor',
      },
      {
        q: 'Como digito valores em reais?',
        a: 'Do jeito brasileiro: 1.500,00, 1.500 ou 1500,50. Um único ponto com uma ou duas casas também vale como centavos: 12.5 é R$ 12,50. Enquanto você digita, o campo mostra a “Prévia” do valor que será salvo; se aparecer “Formato não reconhecido”, revise o número. Vale para oportunidades e lançamentos do “Financeiro”, que donos, administradores e colaboradores criam e editam; quem tem “Somente leitura” só consulta.',
        terms: 'valor dinheiro moeda real virgula ponto centavos decimal',
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
        a: 'Não. O valor da oportunidade é o da negociação, e a “Previsão ponderada” é uma estimativa. O dinheiro recebido fica nos lançamentos do “Financeiro”, com as situações “Pendente”, “Recebido” e “Cancelado”.',
        terms: 'receita faturamento recebimento',
      },
      {
        q: 'De onde vem a probabilidade de uma oportunidade?',
        a: 'Por padrão, da etapa em que ela está: ao mudar de etapa, a probabilidade acompanha, e o formulário mostra “Da etapa”. Para fixar outro valor, preencha “Probabilidade (%)” em “Editar”; apague o campo para voltar a usar a da etapa. Ganha conta como 100% e perdida como 0%; ao reabrir, volta a valer a da etapa. A “Previsão ponderada” soma valor × probabilidade das oportunidades em aberto, por isso alterar a probabilidade de uma etapa em “Configurações” muda na hora a previsão das oportunidades que a acompanham. Donos, administradores e colaboradores editam a da oportunidade; a das etapas, só donos e administradores.',
        terms: 'porcentagem chance previsao forecast',
      },
      {
        q: 'O que acontece ao excluir uma oportunidade com atividades ou recebimentos?',
        a: 'Só donos e administradores excluem. Antes de confirmar, eles veem quantas atividades, recebimentos e registros de automação estão vinculados. Em “Desvincular e excluir”, a oportunidade e o histórico de movimentações de etapa saem; atividades e recebimentos continuam no CRM, sem o vínculo, e os registros de automação ficam no histórico. Para encerrar uma negociação preservando tudo, marque-a como perdida.',
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
        a: 'Em “Hoje”, a “Fila de atenção” lista o que precisa de você e diz o motivo de cada item. As quatro regras são: atividades vencidas; atividades, contatos ou oportunidades sem responsável, ou com o responsável desativado; contatos e oportunidades sem próxima ação; e oportunidades paradas. Donos e administradores ligam ou desligam cada regra e mudam a prioridade e os “Dias sem atualização” em “Configurações”, na aba “Fila de atenção”. Use “Abrir ficha e resolver” para tratar o item.',
        terms: 'pendencia pendencias alerta prioridade regras parada atrasada',
      },
      {
        q: 'Por que a fila mostra muitos contatos num item só?',
        a: 'Com mais de 10 contatos sem próxima ação, por exemplo depois de uma importação, a fila os reúne num único item para não esconder as tarefas vencidas e as oportunidades. “Ver contatos sem próxima ação” abre “Contatos” com esse filtro. Contatos cadastrados há menos de 1 dia e os encerrados não entram na contagem, e em “Minha rotina” ela considera só os contatos sob sua responsabilidade. O filtro de “Contatos” lista os de toda a equipe, inclusive os encerrados e os cadastrados nas últimas 24 horas, por isso pode mostrar mais contatos que o número do item. Da mesma forma, mais de 10 contatos ativos de uma mesma pessoa desativada viram um item; “Ver na Equipe” abre a “Equipe”, onde donos e administradores usam “Passar carteira”.',
        terms: 'agrupado agrupados agrupa juntos desativado',
      },
      {
        q: 'Por que a mesma atividade aparece em mais de uma tela?',
        a: '“Hoje”, “Agenda”, “Atividades”, “Tarefas” e a ficha do relacionamento são visões dos mesmos registros. Concluir, reabrir ou reagendar uma atividade muda esse registro em todas as visões; não é uma nova atividade.',
      },
      {
        q: 'Como registro a próxima ação?',
        a: 'Crie uma atividade com prazo (tarefa, ligação, e-mail ou reunião), de preferência com responsável, e vincule ao contato, à empresa ou à oportunidade. Só uma atividade pendente com prazo conta como próxima ação: notas e atividades sem prazo não contam. Na oportunidade, “Combinar ação” já cria a tarefa vinculada. Donos, administradores e colaboradores registram ações; quem tem “Somente leitura” só consulta.',
        terms: 'proximo passo tarefa retorno follow-up compromisso',
      },
      {
        q: 'Quem pode concluir, editar ou excluir uma atividade?',
        a: 'Donos, administradores e colaboradores criam, usam “Editar / reagendar”, “Concluir” e “Reabrir”, inclusive nas atividades de colegas. Excluir é só para donos e administradores e não tem volta: a atividade sai da rotina e dos históricos vinculados. Quem tem “Somente leitura” consulta.',
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
        a: 'Em “Modelos” (no menu, “Templates”), a equipe guarda textos prontos para e-mails e mensagens. Use “Copiar texto” e cole no seu e-mail ou no WhatsApp: o CRM não envia mensagens aos seus contatos. Donos, administradores e colaboradores criam e editam; excluir é só para donos e administradores.',
        terms: 'template templates texto pronto mensagem whatsapp email',
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
        a: 'Se o colega salvou antes, a sua gravação não apaga a dele: a tela avisa que o registro mudou ou não está mais disponível e mantém o que você preencheu. Copie suas alterações, reabra o registro para ver a versão atual e salve de novo; nas regras da fila de atenção, use “Carregar versão atual”. Vale para contatos, empresas, oportunidades, atividades, lançamentos, modelos, automações, funis, etapas e regras da fila. Mover de etapa não tem essa conferência: vale a última movimentação, que fica no histórico. “Hoje”, “Agenda”, “Atividades”, “Tarefas”, “Contatos”, “Empresas” e o “Pipeline” buscam as novidades quando você volta para a aba do CRM; enquanto você fica na aba, a tela mostra a última leitura.',
        terms: 'conflito simultaneo ao mesmo tempo sobrescrever desatualizado atualizar',
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
        a: 'As ações dependem do seu papel: com “Somente leitura”, você consulta, mas não cria nem edita, e excluir é só para donos e administradores. A tela mostra o motivo quando falta permissão. Se o CRM disser que o responsável foi desativado, escolha outra pessoa em “Responsável”. Para pedir outro acesso, veja em “Equipe” quem são os donos e administradores.',
        terms: 'permissao bloqueado desabilitado sem acesso',
      },
      {
        q: 'Onde vejo o histórico de alterações?',
        a: 'Em “Segurança”, donos e administradores veem o “Histórico de alterações”: quando, a ação, o tipo de registro e os campos alterados, sem o conteúdo. Essa tela não mostra quem fez cada alteração. As mudanças de etapa de cada oportunidade ficam no “Histórico de movimentações” dela, com quem fez.',
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
