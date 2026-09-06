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
    id: "primeiros-passos",
    title: "Primeiros passos",
    items: [
      { q: "Como começo a usar a plataforma?", a: "Logo após o cadastro, o assistente de onboarding guia você por alguns passos: dados da clínica, criação do pipeline de atendimento, IA, e-mail (Resend), WhatsApp (Evolution API) e finalização. Você pode pular passos opcionais e voltar a eles em Configurações > Onboarding." },
      { q: "Como convido outras pessoas para a equipe?", a: "Vá em Equipe > Membros, informe o e-mail e o papel (Admin, Diretor, Gerente ou Profissional) e clique em Convidar. A pessoa recebe um magic link por e-mail." },
      { q: "Posso resetar o onboarding?", a: "Sim. Em Configurações > Onboarding clique em Resetar para revisar ou refazer os passos." },
    ],
  },
  {
    id: "pacientes",
    title: "Pacientes",
    items: [
      { q: "Como cadastro um paciente?", a: "Em Pacientes, clique em Novo Paciente, preencha as informações básicas (nome, contato, data de nascimento, convênio) e salve. Em seguida você pode anexar documentos e abrir o prontuário." },
      { q: "Como anexo documentos ao paciente?", a: "Abra o paciente, vá até a aba Documentos e arraste e solte os arquivos ou clique para fazer upload. Exames, laudos e termos ficam vinculados ao prontuário." },
      { q: "Quem pode editar pacientes?", a: "Admins, Diretores e Gerentes de Equipe. Profissionais conseguem visualizar e atualizar dados clínicos dos pacientes que atendem." },
    ],
  },
  {
    id: "contatos",
    title: "Contatos & Convênios",
    items: [
      { q: "Qual a diferença entre Lead, Contato e Paciente?", a: "Lead é uma pessoa interessada que ainda não virou paciente. Contato é qualquer pessoa registrada (responsável, indicação, parceiro). Paciente é o contato que possui prontuário e histórico de atendimentos." },
      { q: "Como importo contatos em massa?", a: "Use o botão Importar na página de Contatos. Aceitamos CSV com colunas mapeáveis." },
      { q: "Posso ter pacientes sem convênio?", a: "Sim. O convênio é opcional — pacientes particulares ficam marcados como Particular." },
    ],
  },
  {
    id: "pipeline",
    title: "Atendimentos & Pipeline",
    items: [
      { q: "Como personalizo as etapas do pipeline?", a: "Em Pipeline, clique no menu de configurações e edite, reordene ou crie novas etapas (ex.: Primeiro contato, Avaliação agendada, Em tratamento, Alta). Cada etapa pode ter sua própria probabilidade de conversão." },
      { q: "Como qualifico um lead?", a: "Abra o card do lead e registre informações como queixa principal, urgência, convênio e disponibilidade. O score de prioridade é atualizado automaticamente." },
      { q: "Como registro uma desistência?", a: "Mude o status para Perdido e selecione o motivo (preço, distância, escolheu outra clínica, etc.). Os motivos são personalizáveis em Configurações." },
    ],
  },
  {
    id: "atividades",
    title: "Atividades, Consultas e Tarefas",
    items: [
      { q: "Qual a diferença entre Atividades e Consultas?", a: "Consultas ficam na Agenda — com horário, profissional, sala e status (agendada, confirmada, atendida, não compareceu, cancelada). Atividades são tarefas internas (retorno, ligação, follow-up, envio de exame) vinculadas ao paciente." },
      { q: "Como agendo uma consulta?", a: "Em Agenda, clique no horário desejado, escolha paciente, profissional, tipo de consulta e duração. O paciente recebe lembrete por e-mail e WhatsApp se as automações estiverem ativas." },
      { q: "Posso ver tudo da minha equipe?", a: "Depende do seu papel: Gerentes veem a equipe; Diretores veem a diretoria; Profissionais veem apenas os próprios pacientes e atendimentos." },
    ],
  },
  {
    id: "email",
    title: "E-mail & Templates",
    items: [
      { q: "Como conecto meu e-mail?", a: "Em Configurações > Integrações, configure o Resend com sua API key para envio de lembretes e emails de automação." },
      { q: "Posso criar templates?", a: "Sim. Em Templates você cria modelos reutilizáveis com variáveis dinâmicas como {{paciente.nome}}." },
    ],
  },
  {
    id: "automacoes",
    title: "Automações",
    items: [
      { q: "O que são automações?", a: "Regras que disparam ações quando algo acontece, ex.: enviar lembrete de WhatsApp 24h antes da consulta, criar tarefa quando uma consulta é marcada." },
      { q: "Como crio uma automação?", a: "Em Automações, clique em Nova, defina o gatilho, as condições e as ações." },
    ],
  },
  {
    id: "relatorios",
    title: "Relatórios & Metas",
    items: [
      { q: "Onde acompanho o desempenho?", a: "Em Relatórios você vê funil de atendimentos, taxa de conversão, taxa de no-show, receita prevista e produtividade por profissional. Em Metas você define alvos de receita, novos pacientes e atendimentos por pessoa ou equipe." },
    ],
  },
  {
    id: "equipe",
    title: "Equipe, Diretorias e Permissões",
    items: [
      { q: "Quais são os papéis disponíveis?", a: "Dono e Administrador veem tudo na organização. Diretor vê tudo da(s) sua(s) diretoria(s). Gerente de Equipe vê tudo da(s) sua(s) equipe(s). Profissional vê apenas os próprios pacientes e atendimentos." },
      { q: "Como funciona a hierarquia?", a: "Diretoria agrupa Equipes; Equipes agrupam Profissionais. Em Equipe > Diretorias você cria a diretoria, vincula equipes e define quem é Diretor." },
      { q: "Como mudo o papel de alguém?", a: "Em Equipe > Membros, selecione o novo papel no dropdown ao lado da pessoa." },
      { q: "Como distribuo leads automaticamente entre os profissionais?", a: "Em Configurações > Distribuição (visível só para Dono/Admin) você cria regras de Round Robin. Para cada regra escolhe a origem (webhook, manual, todas), a estratégia (Round Robin sequencial ou Ponderado por peso), quem participa do rodízio e um fallback caso ninguém esteja disponível. Use o botão Simular 10 leads para ver como ficaria a distribuição antes de ativar. As regras são aplicadas automaticamente sempre que um lead novo entrar sem responsável definido." },
    ],
  },
  {
    id: "seguranca",
    title: "Segurança",
    items: [
      { q: "Como ativar 2FA?", a: "Em Configurações > Segurança você ativa a autenticação de dois fatores via TOTP (Google Authenticator, 1Password, etc.)." },
      { q: "Esqueci minha senha, e agora?", a: "Na tela de login clique em Esqueci minha senha e siga o link enviado por e-mail." },
      { q: "Como verifico se as permissões da hierarquia estão corretas?", a: "Admins têm uma página de diagnóstico em Configurações > aba Permissões. Lá você seleciona qualquer usuário e vê exatamente: o papel, o escopo (org/diretoria/equipe/próprio), as diretorias e equipes que ele participa, a lista de profissionais que ele enxerga e a contagem de pacientes, atendimentos e atividades visíveis. Checklist manual: crie um atendimento como Profissional X, depois logue como gerente da mesma equipe (deve ver), gerente de outra equipe (não deve ver), diretor da mesma diretoria (deve ver), diretor de outra diretoria (não deve ver)." },
    ],
  },
  {
    id: "atalhos",
    title: "Atalhos",
    items: [
      { q: "Quais atalhos existem?", a: "⌘K abre a busca global; G + D vai para Dashboard; G + P para Pacientes; G + A para Agenda; N cria um novo registro na página atual." },
    ],
  },
];
