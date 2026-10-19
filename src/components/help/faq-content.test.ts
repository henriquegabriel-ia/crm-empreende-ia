import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CRM_ROLE_LABELS } from '@/lib/roles';
import { quotedLabels, showsLabel } from '@/test/ui-labels';
import { BASE_CREDIT_TEXT } from '@/lib/brand';
import { FAQ_CATEGORIES, normalizeHelpText, searchFaq, visibleFaqCategories } from './faq-content';

const allItems = FAQ_CATEGORIES.flatMap((category) => category.items.map((item) => ({ ...item, category })));
const allAnswers = allItems.map((item) => item.a);
const answer = (question: string) => {
  const item = allItems.find((entry) => entry.q === question);
  if (!item) throw new Error(`Pergunta ausente na Ajuda: ${question}`);
  return item.a;
};
const categoryOf = (question: string) => allItems.find((entry) => entry.q === question)?.category.id;
const questionsFound = (query: string) => searchFaq(query).flatMap((category) => category.items.map((item) => item.q));
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

describe('Ajuda: organização das respostas', () => {
  it('cada categoria tem identificador próprio e pelo menos duas perguntas, sem pergunta repetida', () => {
    const ids = FAQ_CATEGORIES.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of FAQ_CATEGORIES) expect(category.items.length, category.title).toBeGreaterThanOrEqual(2);
    const questions = allItems.map((item) => item.q);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it('as perguntas terminam com interrogação e as respostas são curtas', () => {
    for (const item of allItems) {
      expect(item.q, item.q).toMatch(/\?$/);
      expect(words(item.a), item.q).toBeLessThanOrEqual(130);
    }
  });

  // Revisão do item 1.6: "…pelo seu e-mail: avise na hora quem administra: donos…" truncava a leitura. Um dois-pontos por
  // frase (o de um endereço, "https://", e o de um horário, "8:30", não contam).
  it('nenhuma frase das respostas tem dois-pontos duas vezes', () => {
    for (const item of allItems)
      for (const sentence of item.a.split(/(?<=[.!?])\s+/))
        expect(sentence.match(/:(?!\/\/|\d)/g)?.length ?? 0, `${item.q}: ${sentence}`).toBeLessThanOrEqual(1);
  });

  it('cada assunto fica na categoria certa', () => {
    expect(categoryOf('Como uma pessoa nova entra na equipe?')).toBe('acesso');
    expect(categoryOf('Como copio, renovo ou cancelo um convite?')).toBe('acesso');
    expect(categoryOf('Como desativo quem saiu da equipe e passo a carteira?')).toBe('acesso');
    expect(categoryOf('Como reativo uma pessoa desativada?')).toBe('acesso');
    expect(categoryOf('Apareceu “Seu acesso foi encerrado”. E agora?')).toBe('acesso');
    expect(categoryOf('Como mudo as preferências dos tours?')).toBe('primeiros-passos');
    expect(categoryOf('Como troco o nome e o logo do CRM?')).toBe('primeiros-passos');
    expect(categoryOf(`O que significa “${BASE_CREDIT_TEXT}”?`)).toBe('primeiros-passos');
    expect(categoryOf('Que e-mails o CRM envia?')).toBe('acesso');
    expect(categoryOf('Esqueci minha senha. O que faço?')).toBe('acesso');
    expect(categoryOf('O que cada papel pode fazer?')).toBe('primeiros-passos');
    expect(categoryOf('Como importo contatos de uma planilha?')).toBe('planilhas');
    expect(categoryOf('Como exporto contatos, reuniões ou relatórios?')).toBe('planilhas');
    for (const question of [
      'Que colunas a planilha de contatos aceita?',
      'Como salvo a planilha do Excel em CSV?',
      'Por que algumas linhas ficaram fora da importação?',
      'A importação de contatos parou no meio. O que faço?',
      'A importação de contatos parou com um código de erro. O que faço?',
    ])
      expect(categoryOf(question), question).toBe('planilhas');
    expect(categoryOf('O que é o número ao lado de “Hoje” no menu?')).toBe('rotina');
    expect(categoryOf('Como digito valores em reais?')).toBe('pipeline');
    expect(categoryOf('Como crio um funil ou mudo as etapas?')).toBe('pipeline');
    expect(categoryOf('Em que período uma venda ganha aparece nos “Relatórios”?')).toBe('financeiro');
    expect(categoryOf('O que acontece se a internet cair?')).toBe('conexao');
    expect(categoryOf('O que acontece se um colega alterar o mesmo registro que eu?')).toBe('conexao');
    for (const question of [
      'Como mando um WhatsApp pelo CRM?',
      'Como abro um e-mail no Gmail ou no Outlook?',
      'Como registro uma ligação?',
      'O CRM envia as mensagens sozinho?',
      'Abri o WhatsApp e não registrei. E agora?',
      'Como uso variáveis nos modelos?',
      'O que significa “Não contatar”?',
      'Como concluo uma atividade e já agendo a próxima?',
      'Como informo ou corrijo o resultado de uma ligação?',
    ])
      expect(categoryOf(question), question).toBe('canais');
    for (const question of [
      'O CRM cuida da LGPD da empresa?',
      'O que é a “Base legal” de um contato?',
      'Como registro que um contato deu consentimento?',
      'Uma pessoa pediu os dados dela. Como atendo?',
      'Uma pessoa pediu para apagar os dados dela. Como faço?',
      'Qual a diferença entre “Não contatar”, “Anonimizar contato” e “Excluir cadastro”?',
      'Por que o CRM não deixa agendar uma ligação para um contato “Não contatar”?',
      'Onde vejo quem exportou ou anonimizou dados?',
      'A anonimização apaga os dados das cópias de segurança e dos arquivos exportados?',
      'Como apago os dados de uma empresa?',
      'Por que um texto de outro contato terminou com reticências depois de uma anonimização?',
    ])
      expect(categoryOf(question), question).toBe('privacidade');
    // A categoria dos canais fica depois de "Contatos e empresas"; a de privacidade (item 1.10), depois dos canais, e
    // "Planilhas" vem em seguida.
    const ids = FAQ_CATEGORIES.map((category) => category.id);
    expect(ids.indexOf('canais')).toBe(ids.indexOf('contatos') + 1);
    expect(ids.indexOf('privacidade')).toBe(ids.indexOf('canais') + 1);
    expect(ids.indexOf('planilhas')).toBe(ids.indexOf('privacidade') + 1);
  });
});

/**
 * A tela de que as respostas falam, para cada nome que citam entre aspas curvas: o nome precisa aparecer inteiro nela,
 * como texto de botão, aba, campo, título ou mensagem, e não só no meio de uma frase (src/test/ui-labels.ts). Assim, um
 * botão renomeado ou removido reprova a resposta que ainda o cita, mesmo que a palavra continue em outra tela, e um
 * nome novo na Ajuda precisa entrar aqui. Os e-mails do Auth gerados valem pelo texto. Os tours e o guia, que também
 * citam botões, nunca contam.
 */
const SCREENS: Record<string, string[]> = {
  'src/lib/roles.ts': ['Dono', 'Administrador', 'Colaborador', 'Somente leitura'],
  // O crédito da base, no rodapé das telas de entrada e da Ajuda (item 1.6).
  'src/lib/brand.ts': ['Feito com Empreende.IA'],
  'src/components/shell/AppRail.tsx': [
    'Contatos',
    'Empresas',
    'Agenda',
    'Atividades',
    'Tarefas',
    'Templates',
    'Sair da conta',
  ],
  'src/components/layout/MobileBottomNav.tsx': ['Mais', 'Sair da conta'],
  'src/components/shell/TopbarActions.tsx': ['Ações rápidas', 'Configurar CRM', 'Abrir Copiloto'],
  'src/components/onboarding/CrmSetupChecklist.tsx': ['Configuração do CRM', 'Configurar CRM', 'Verificar novamente'],
  'src/components/tours/ProductTourProvider.tsx': [
    'Tour desta tela',
    'Continuar tour',
    'Recomeçar tour',
    'Abrir tela',
    'Como você prefere conhecer o CRM?',
    'Mostrar convites discretos nas telas novas',
    'Abrir novos tours automaticamente quando a tela estiver pronta',
  ],
  'src/pages/Login.tsx': ['Entrar', 'Cadastrar', 'Esqueceu a senha?', 'Link por e-mail', 'Usar outro e-mail'],
  'src/components/workspace/WorkspaceSetup.tsx': [
    'Enviar link para o meu e-mail',
    'Enviar de novo',
    'Crie sua senha',
    'Aceitar convite da equipe',
  ],
  'src/components/workspace/ReceivedInvite.tsx': ['Recebi um convite'],
  'src/components/workspace/EmailLinkGate.tsx': ['Continuar', 'Ir para a tela de entrada'],
  'src/components/workspace/EmailCodeForm.tsx': ['Código do e-mail', 'Entrar com o código'],
  'src/pages/ResetPassword.tsx': ['Nova senha', 'Salvar nova senha'],
  'supabase/templates/confirmation.html': ['Confirme seu e-mail'],
  'supabase/templates/magic_link.html': ['Seu link de acesso'],
  'supabase/templates/recovery.html': ['Redefina sua senha', 'Redefinir senha'],
  'supabase/templates/password_changed_notification.html': ['Sua senha foi criada ou alterada'],
  'supabase/templates/invite.html': ['Ative sua conta'],
  'supabase/templates/email_change.html': ['Confirme a troca de e-mail'],
  'supabase/templates/email_changed_notification.html': ['Seu e-mail de acesso mudou'],
  'src/pages/Team.tsx': [
    'Equipe',
    'Criar convite',
    'Copiar link',
    'Copiar',
    'Gerar novo link',
    'Revogar',
    'Alterar papel',
    'Criado por',
    'Desativar',
    'Pessoas desativadas',
    'Reativar',
    'Passar carteira',
  ],
  'src/components/team/MemberDeactivateDialog.tsx': [
    'Quem recebe a carteira',
    'Passar também os contatos e as empresas',
    'Confirmar desativação',
  ],
  'src/components/team/MemberReactivateDialog.tsx': ['Confirmar reativação'],
  'src/components/workspace/AccessEnded.tsx': ['Seu acesso foi encerrado', 'Verificar de novo', 'Sair da conta'],
  'src/lib/team-members.ts': ['(desativado)'],
  'src/pages/SecuritySettings.tsx': ['Segurança', 'Encerrar todas as sessões', 'Histórico de alterações'],
  // Item 1.10: a privacidade (LGPD) da empresa controladora.
  'src/components/privacy/ContactPrivacySection.tsx': [
    'Privacidade',
    'Exportar dados deste contato',
    'Anonimizar contato',
  ],
  'src/components/privacy/LegalBasisFields.tsx': ['Base legal', 'Como a pessoa consentiu'],
  'src/components/privacy/PrivacyActionsTable.tsx': ['Exportações e anonimizações'],
  'src/components/privacy/AnonymizedBanner.tsx': ['Contato anonimizado'],
  'src/lib/privacy.ts': ['Consentimento', 'Não informada'],
  'src/pages/Settings.tsx': [
    'Configurações',
    'Organização',
    'Funis',
    'Novo funil',
    'Renomear funil',
    'Adicionar etapa',
    'Editar',
    'Probabilidade de ganho (%)',
    'Fila de atenção',
    'Dias sem atualização',
    'Carregar versão atual',
    'Base legal padrão dos contatos novos',
    // Item 1.16: a aba do catálogo.
    'Catálogo',
  ],
  // Item 1.16: o catálogo, a importação dele e os itens da oportunidade.
  'src/components/catalog/CatalogSettings.tsx': ['Novo item', 'Importar planilha', 'Baixar modelo'],
  'src/components/catalog/CatalogImportDialog.tsx': ['Baixar itens não importados', 'Parar', 'Continuar importação'],
  'src/components/pipeline/DealItemsEditor.tsx': [
    'Produto ou serviço',
    'Item avulso',
    'Adicionar item',
    'Desconto',
    'Sem desconto',
    'Em %',
    'Em R$',
    'Total único',
    'Mensalidade',
    'Meses do contrato',
    'Valor do contrato',
  ],
  'src/components/pipeline/DealItemsSection.tsx': ['Editar itens', 'Salvar itens'],
  'src/components/layout/RequireRole.tsx': ['Ir para Hoje'],
  'src/pages/Dashboard.tsx': [
    'Hoje',
    'Para hoje',
    'Vencidas',
    'Próximos passos do dia',
    'Fila de atenção',
    'Abrir ficha e resolver',
    'Ver contatos sem próxima ação',
    'Ver na Equipe',
    'Minha rotina',
    'Toda a organização',
    // Revisão do item 1.14: com quem foi desativado, "Ver atividades" abre "Todas".
    'Ver atividades',
  ],
  'src/components/commercial/DirectoryPage.tsx': [
    'Visões salvas',
    'Salvar visão atual',
    'Limpar filtros',
    'Tentar novamente',
    // Item 1.14: a coluna "Origem" de Contatos entra pelo seletor de colunas.
    'Colunas',
  ],
  // Item 1.14: a origem do contato em lista fixa ("Outra" abre o texto livre) e o filtro de origem de Contatos.
  'src/components/commercial/LeadSourceField.tsx': ['Outra'],
  'src/lib/lead-source.ts': ['Outras origens', 'Sem origem'],
  // Item 1.14: os recortes de responsável de Atividades e Tarefas e da Agenda, com as pessoas da equipe.
  'src/components/workday/ActivityPage.tsx': [
    'Minhas atividades',
    // Revisão do item 1.14: o histórico de quem foi desativado, que passou as pendentes a quem recebeu a carteira.
    'Pendentes',
    'Todas',
    'Concluídas / notas',
    'Ver o histórico',
  ],
  'src/pages/Agenda.tsx': ['Minha agenda'],
  'src/components/commercial/Relationship360.tsx': [
    'Próxima ação',
    'Último contato',
    'Excluir cadastro',
    'Editar cadastro',
  ],
  // A importação de planilha do item 1.11: o diálogo "Revisar importação", a divisão e o botão com a contagem.
  'src/components/contact-import/ContactImportDialog.tsx': [
    'Baixar contatos não importados',
    'Continuar importação',
    'Importar também as linhas com telefone repetido',
    // Revisão do item 1.11, achado 10: a origem padrão e "Parar" passaram a ter resposta na Ajuda.
    'Origem dos contatos sem origem na planilha (opcional)',
    'Parar',
  ],
  'src/components/contact-import/OwnerChoiceFields.tsx': ['Distribuir igualmente entre'],
  'src/components/contact-import/text.ts': ['Importar'],
  // Canais do item 1.9: a barra, os diálogos de mensagem e de registro, as pendências e a marca "Não contatar".
  'src/components/channels/ChannelBar.tsx': ['WhatsApp', 'E-mail', 'Ligar', 'Copiar número', 'Registrar ligação'],
  'src/components/channels/ComposeDialog.tsx': ['Abrir no WhatsApp', 'Abrir e-mail'],
  'src/lib/channels.ts': ['Abrir no Gmail', 'Abrir no Outlook web', 'Abrir no aplicativo de e-mail'],
  'src/components/channels/PendingInteractionsDock.tsx': ['Para registrar', 'Registrar', 'Agora não'],
  'src/lib/contact-model.ts': ['Atendeu', 'Não atendeu', 'Caixa postal'],
  'src/components/channels/DoNotContactPanel.tsx': [
    'Não contatar',
    'Marcar como não contatar',
    'Permitir contato de novo',
  ],
  'src/components/workday/useActivityActions.ts': ['Agendar a próxima'],
  'src/components/operations/TemplateForm.tsx': ['Inserir variável'],
  // Cargo, origem e observações no cadastro do contato (revisão do item 1.11).
  'src/components/commercial/RecordEditor.tsx': ['Responsável', 'Cargo', 'Origem', 'Observações'],
  'src/pages/Integrations.tsx': ['Integrações', 'Baixar modelo CSV', 'Exportar contatos', 'Exportar reuniões'],
  // Item 1.14: os ganhos por responsável, pela data de fechamento.
  'src/pages/Reports.tsx': [
    'Relatórios',
    'Ganhos por responsável',
    // Item 1.16: a mensalidade ganha e o menu da exportação.
    'Mensalidades ganhas',
    'Oportunidades',
    'Itens das oportunidades',
    // Item 1.15 (achado 4 da revisão do 1.16): o botão do menu, pelo nome acessível, igual no celular.
    'Exportar CSV',
  ],
  'src/pages/Pipeline.tsx': ['Pipeline', 'Nova oportunidade', 'Previsão ponderada'],
  'src/components/pipeline/DealBoard.tsx': [
    'Mover ou alterar situação',
    'Marcar como ganha',
    'Marcar como perdida',
    'Reabrir',
  ],
  'src/components/pipeline/DealDetail.tsx': ['Próximas ações', 'Histórico de movimentações', 'Combinar ação', 'Editar'],
  'src/components/pipeline/DealForm.tsx': [
    'Responsável',
    // Item 1.16.
    'Adicionar itens',
    'Da etapa',
    'Probabilidade (%)',
    'Fechada em',
    'Previsão de fechamento',
  ],
  'src/components/pipeline/DealDeleteDialog.tsx': ['Desvincular e excluir'],
  'src/components/foundation/MoneyPreview.tsx': ['Prévia', 'Formato não reconhecido'],
  'src/components/workday/ActivityDetail.tsx': [
    'Editar / reagendar',
    'Concluir',
    'Concluir e agendar a próxima',
    'Reabrir',
  ],
  'src/components/workday/ActivityDialog.tsx': ['Responsável', 'Resultado', 'Sem resultado', 'Já aconteceu'],
  'src/components/workday/WorkdayState.tsx': ['Tentar novamente'],
  'src/pages/Financeiro.tsx': ['Financeiro', 'Novo lançamento', 'Vencido'],
  'src/lib/operation-logic.ts': ['Pendente', 'Recebido', 'Cancelado', 'Oportunidade mudou de etapa'],
  'src/components/operations/PaymentForm.tsx': ['Recebido em'],
  'src/pages/Automations.tsx': ['Automações', 'Revisar e ativar', 'Pausar', 'Execuções'],
  'src/pages/Templates.tsx': ['Modelos', 'Copiar texto'],
  'src/components/crm/AICopilot.tsx': ['Registrado', 'Revisar atividade sugerida'],
  'src/lib/offline.ts': ['Sem conexão'],
};

describe('Ajuda: nomes da interface citados nas respostas', () => {
  const cited = [...new Set(allItems.flatMap((item) => quotedLabels(`${item.q} ${item.a}`)))];
  const declared = Object.entries(SCREENS).flatMap(([file, labels]) => labels.map((label) => ({ file, label })));

  it('cita botões, abas, campos, telas e e-mails pelo nome', () => {
    expect(cited.length).toBeGreaterThan(60);
  });

  it('cada nome citado tem a tela de que a resposta fala, e a lista não guarda nome que a Ajuda não cita', () => {
    for (const label of cited)
      expect(
        declared.some((entry) => entry.label === label),
        `“${label}”: declare em SCREENS a tela que o mostra`,
      ).toBe(true);
    for (const { file, label } of declared) expect(cited, `${file}: “${label}” não é mais citado`).toContain(label);
  });

  it.each(declared.map(({ file, label }) => [label, file]))('“%s” aparece inteiro em %s', (label, file) => {
    expect(showsLabel(file, label), `“${label}” sumiu de ${file} ou ficou só no meio de uma frase`).toBe(true);
  });

  it('não usa aspas retas no lugar das curvas para nomes da interface, nem na pergunta', () => {
    for (const item of allItems) expect(`${item.q} ${item.a}`, item.q).not.toMatch(/"/);
  });
});

describe('Ajuda: o que não existe mais', () => {
  it.each([
    [/espaço de trabalho/i, 'a empresa substituiu o espaço de trabalho no item 1.1'],
    [/organização ativa|trocar de organização/i, 'a instância tem uma empresa só'],
    [
      /sincroniza(ção|r) (automática|com o servidor)|quando a conexão voltar, (as alterações|o CRM) (são|é) enviad/i,
      '0.9',
    ],
    [/Habilitar recurso/i, 'Integrações deixou de ter ativação no item 0.5'],
    [/Criadas de/, 'o filtro dos Relatórios virou "Período de" no item 0.6'],
    [/Dashboard/, 'a tela inicial se chama Hoje'],
    [
      /pode ser a mesma do cadastro|acessos abertos .* são encerrados|se cadastra com o e-mail convidado, confirma/,
      'reforço do 1.1',
    ],
    [/exige um administrador|Somente administradores|só administradores/i, 'donos também administram'],
  ])('nenhuma resposta usa %s (%s)', (pattern) => {
    for (const item of allItems) expect(`${item.q} ${item.a}`, item.q).not.toMatch(pattern);
  });
});

// Respostas de acesso contra o comportamento do item 1.1 e dos reforços de 12 e 13/10/2026 (docs/arquitetura/1.1.md,
// seções 16.12, 16.13 e 16.21): a conta nasce pelo link do e-mail, cria a senha no CRM, e o link só vale depois de
// "Continuar".
describe('Ajuda: acesso e convites', () => {
  it('"Gerar novo link" aparece só para o convite expirado', () => {
    for (const text of allAnswers.filter((entry) => entry.includes('Gerar novo link'))) {
      for (const sentence of text.split(/(?<=[.;])\s/).filter((part) => part.includes('Gerar novo link'))) {
        expect(sentence).toMatch(/expirou|expirado/);
        expect(sentence).not.toMatch(/revogado|trocado/);
      }
    }
  });

  it('primeiro acesso cria a empresa, e depois a entrada é só por convite', () => {
    expect(answer('Como começo a usar o CRM?')).toContain(
      'Quem faz o primeiro acesso de um CRM novo cria a empresa e fica com o papel de Dono',
    );
    expect(answer('Como uma pessoa nova entra na equipe?')).toMatch(/^Só por convite\./);
  });

  it('quem administra copia, renova e revoga os convites, e o de dono fica com os donos', () => {
    const text = answer('Como copio, renovo ou cancelo um convite?');
    expect(text).toContain('donos e administradores veem os convites ainda não aceitos');
    expect(text).toContain('os convites de dono, só os donos veem');
    expect(text).toContain('No convite válido, “Copiar” copia o link de novo');
    expect(text).toContain('“Gerar novo link” cria outro, e o anterior deixa de valer');
    expect(text).toContain('o convite de dono, só um dono renova');
    expect(text).toContain('“Revogar” cancela o convite');
    // create_invitation recusa o segundo convite válido para o mesmo e-mail.
    expect(text).toContain('o CRM não cria outro para o mesmo e-mail');
  });

  // Item 1.2 (docs/arquitetura/1.2.md, seção 11.1): a desativação substituiu o "Somente leitura" como saída da equipe.
  it('desativar quem saiu: quem pode, o destinatário obrigatório, a caixa de contatos e os convites revogados', () => {
    const text = answer('Como desativo quem saiu da equipe e passo a carteira?');
    expect(text).toContain('donos e administradores usam “Desativar”');
    expect(text).toContain('o de um dono, só outro dono desativa, e ninguém desativa o próprio acesso');
    expect(text).toContain('pede “Quem recebe a carteira”, que precisa ser dono, administrador ou colaborador ativo');
    expect(text).toContain('As oportunidades em aberto e as atividades pendentes passam sempre');
    expect(text).toContain('se “Passar também os contatos e as empresas” ficar marcado');
    expect(text).toContain('perde o acesso na hora, mesmo com o CRM aberto');
    expect(text).toContain('os convites pendentes que ela criou são revogados');
    expect(text).toContain('com a marca “(desativado)”');
    for (const item of allItems)
      expect(`${item.q} ${item.a}`, item.q).not.toMatch(/ainda não (remove|desativa)|continua entrando e consultando/);
  });

  it('reativar, passar a carteira, a marca e a tela de acesso encerrado', () => {
    const reactivate = answer('Como reativo uma pessoa desativada?');
    expect(reactivate).toContain('donos e administradores usam “Reativar”');
    expect(reactivate).toContain('Reativar um dono, ou dar o papel de Dono, só um dono faz');
    expect(reactivate).toContain('A carteira que passou para outra pessoa continua com ela');
    const kept = answer('Ficaram contatos com uma pessoa desativada. Como passo para outra?');
    expect(kept).toContain('Donos e administradores usam “Passar carteira”');
    // Revisão do item 1.2: o cartão da Equipe diz quando os contatos e as empresas ficaram com a pessoa.
    expect(kept).toContain('o cartão da pessoa desativada avisa quando os contatos e as empresas ficaram com ela');
    // Revisão do item 1.2 (rodada 2): muitos contatos de uma pessoa desativada viram um item por pessoa na fila.
    expect(kept).toContain('com mais de 10 contatos da mesma pessoa, eles aparecem num item só, e “Ver na Equipe”');
    const grouped = answer('Por que a fila mostra muitos contatos num item só?');
    expect(grouped).toContain('mais de 10 contatos ativos de uma mesma pessoa desativada viram um item');
    expect(grouped).toContain('donos e administradores usam “Passar carteira”');
    const mark = answer('Por que um nome aparece com “(desativado)”?');
    expect(mark).toContain('não aparece para ser escolhida como “Responsável”');
    expect(mark).toContain('para reabrir uma oportunidade ou uma atividade dela, troque antes o responsável');
    const ended = answer('Apareceu “Seu acesso foi encerrado”. E agora?');
    expect(ended).toContain('use “Verificar de novo” (se o acesso continuar encerrado, a tela avisa)');
    expect(ended).toContain('use “Sair da conta”');
    // O responsável desativado entra na regra de sem responsável, e a recusa do banco tem caminho na Ajuda.
    expect(answer('O que significa a fila de atenção?')).toContain('ou com o responsável desativado');
    expect(answer('Por que não consigo criar ou editar um registro?')).toContain(
      'Se o CRM disser que o responsável foi desativado, escolha outra pessoa em “Responsável”',
    );
    const roles = answer('O que cada papel pode fazer?');
    expect(roles).toContain('desativar ou reativar donos');
    expect(roles).toContain('desativa e reativa pessoas (sem tornar ninguém dono nem mexer em donos)');
  });

  it('convites: quem criou, a revogação automática e o convite de dono que o administrador não vê', () => {
    const text = answer('Como copio, renovo ou cancelo um convite?');
    expect(text).toContain('quem criou cada um (“Criado por”)');
    expect(text).toContain('Os convites pendentes de quem foi desativado');
    expect(text).toContain('são revogados sozinhos');
    // Achado 6 da revisão da Ajuda: o administrador não vê o convite de dono, então não consegue copiar nem revogar.
    expect(text).toContain('se o aviso falar de um convite de dono, que só os donos veem, peça isso a um dono');
    const owner = answer('Quem administra o CRM perdeu o acesso de dono. Como recuperar?');
    expect(owner).toContain('foi desativada por engano');
    expect(owner).toContain('“Reativar”');
    expect(owner).toContain('inclusive desativada');
    expect(owner).toContain('use “Desativar” na conta que não deveria estar na empresa');
  });

  it('a entrada de uma pessoa nova segue o fluxo pelo link do e-mail', () => {
    const text = answer('Como uma pessoa nova entra na equipe?');
    expect(text).toContain('só um dono convida outro dono');
    expect(text).toContain('na aba “Cadastrar”');
    expect(text).toContain('abre o link de confirmação');
    expect(text).toContain('crie a senha e aceite o convite');
    expect(text).toContain('o CRM não manda o convite por e-mail');
    const existing = answer('Já tenho conta ou não abri o link do convite. Como aceito?');
    expect(existing).toContain('entra pela aba “Entrar”');
    expect(existing).toContain('“Enviar link para o meu e-mail”');
    expect(existing).toContain('cola o link ou só o código do convite');
    for (const entry of [text, existing]) expect(entry).not.toContain('link inteiro');
  });

  it('o cadastro recusado separa o convite expirado do revogado', () => {
    const text = answer('Recebi um convite e o cadastro foi recusado. E agora?');
    expect(text).toContain('Se o convite expirou, peça a quem administra que use “Gerar novo link”');
    // O administrador nem vê o convite de dono (RLS do item 1.1), e a Equipe só mostra o botão a donos.
    expect(text).toContain('se o convite era de dono, só um dono o renova');
    expect(text).toContain('Se foi revogado, peça que criem outro em “Criar convite”');
    // O cadastro pelo link não diz se o e-mail já tem conta.
    expect(text).not.toMatch(/já tem conta/);
  });

  it('a recuperação do dono começa pela senha esquecida e cobre o primeiro acesso tomado e o convite de dono', () => {
    const text = answer('Quem administra o CRM perdeu o acesso de dono. Como recuperar?');
    expect(text).toMatch(/^Se só esqueceu a senha, use “Esqueceu a senha\?”/);
    expect(text).toContain('administradores não alteram o papel de donos');
    expect(text).toContain('outra pessoa ficou com o papel de Dono no primeiro acesso');
    expect(text).toContain('cria um convite de dono');
    expect(text).toContain('docs/RECUPERAR-ACESSO-DONO.md');
  });

  it('quem entrou pelo link sem criar a senha sabe como entrar de novo', () => {
    const text = answer('Entrei pelo link do e-mail e não criei uma senha. Como entro de novo?');
    expect(text).toContain('crie a senha');
    // Sem organização, a sessão da recuperação também conta como aberta pelo link, e o aceite pediria a senha de novo:
    // o caminho é o Link por e-mail, e o Esqueceu a senha? fica para quem já está na equipe.
    expect(text).toMatch(/^Se ainda falta aceitar o convite ou criar a empresa, use “Link por e-mail”/);
    expect(text).toContain('você a criaria duas vezes');
    expect(text).toContain('Se você já está na equipe e esqueceu a senha, use “Esqueceu a senha?”');
    expect(text).not.toMatch(/Esqueceu a senha\?” para criar/);
  });

  it('a senha esquecida passa pelo e-mail de redefinição e pelo “Continuar”', () => {
    const text = answer('Esqueci minha senha. O que faço?');
    expect(text).toContain('“Esqueceu a senha?”');
    expect(text).toContain('“Redefina sua senha”');
    expect(text).toContain('“Continuar”');
    expect(text).toContain('“Salvar nova senha”');
  });

  it('o link que não chegou: corrigir o e-mail ou pedir de novo, como as telas oferecem', () => {
    const text = answer('O link do e-mail não chegou. O que faço?');
    expect(text).toContain('“Usar outro e-mail”');
    expect(text).toContain('“Enviar de novo”');
    expect(text).toContain('só o link e o código do e-mail mais recente funcionam');
  });

  it('o link gasto aponta o toque em Continuar e, sem ele, os modelos de e-mail do CRM (revisão de 13/10/2026)', () => {
    const text = answer('O link do e-mail diz que expirou ou já foi usado. O que faço?');
    expect(text).toContain('use “Continuar”');
    expect(text).toContain('os filtros de segurança do e-mail, que abrem os links antes de você, não o gastem');
    expect(text).toContain('os modelos de e-mail do CRM podem não estar aplicados no Supabase');
  });

  // Item 1.3: os modelos agora vão com a configuração do Auth (npm run config:push ou o painel); os e-mails em inglês
  // querem dizer que essa configuração não foi aplicada, e o CRM recusa abrir dentro de outra página.
  it('e-mails em inglês apontam a configuração de e-mails, e o CRM não abre dentro de outro site', () => {
    expect(answer('Que e-mails o CRM envia?')).toContain(
      'Se os e-mails chegarem em inglês, avise quem administra: a configuração de e-mails do CRM não foi aplicada no Supabase.',
    );
    expect(categoryOf('Posso abrir o CRM dentro de outro site ou sistema?')).toBe('conexao');
    const frame = answer('Posso abrir o CRM dentro de outro site ou sistema?');
    expect(frame).toMatch(/^Não\. Por segurança, o CRM se recusa a abrir dentro de outra página/);
    expect(frame).toContain('Abra o CRM direto pelo endereço dele, numa aba do navegador.');
    expect(questionsFound('iframe')).toContain('Posso abrir o CRM dentro de outro site ou sistema?');
    expect(questionsFound('intranet')).toContain('Posso abrir o CRM dentro de outro site ou sistema?');
  });

  it('o e-mail aberto em outro aparelho: o código no aviso de link enviado', () => {
    const text = answer('Pedi o link no computador, mas abri o e-mail no celular. E agora?');
    expect(text).toContain('digite o código em “Código do e-mail” e use “Entrar com o código”');
    expect(text).toContain('usar um gasta o outro');
  });

  it('os e-mails do Auth: o que chega, quando e o que fazer, com os assuntos dos modelos do CRM', () => {
    const text = answer('Que e-mails o CRM envia?');
    const notices = answer('Recebi um aviso de senha ou de e-mail alterado. O que faço?');
    const subjects = JSON.parse(readFileSync('supabase/templates/subjects.json', 'utf8')) as Record<string, string>;
    const subject = (id: string) => `“${subjects[id].split(' · ')[0]}”`;
    // Os e-mails de acesso, nas telas do CRM.
    for (const id of ['confirmation', 'magic_link', 'recovery', 'invite']) expect(text, id).toContain(subject(id));
    // Os avisos: a troca de e-mail não tem tela no CRM, mas sai quando o e-mail de uma conta da empresa é trocado pela
    // API ou pelo painel, inclusive por um intruso com sessão aberta (supabase/templates/README.md). Só o código de
    // verificação (reauthentication) não sai: o CRM não pede reautenticação.
    for (const id of ['password_changed_notification', 'email_change', 'email_changed_notification'])
      expect(notices, id).toContain(subject(id));
    // Revisão do item 1.2: “Seu e-mail de acesso mudou” chega ao endereço antigo depois da troca, quando ele já não
    // entra nem recebe a redefinição; o caminho é avisar quem administra, que corta o acesso com “Desativar”. Achado 7
    // da revisão do 1.2 (item 1.6): com “Confirme a troca de e-mail”, a troca não aconteceu e a conta ainda tem o
    // e-mail da pessoa, então “Desativar” não vale para esse aviso (o convite para o mesmo e-mail seria recusado).
    const confirm = notices.slice(
      notices.indexOf('Se não foi você e chegou “Confirme a troca de e-mail”'),
      notices.indexOf('Se chegou “Seu e-mail de acesso mudou”'),
    );
    expect(confirm).toContain(
      'a troca ainda não aconteceu: não abra o link, redefina a senha pelo “Esqueceu a senha?”',
    );
    expect(confirm).not.toContain('Desativar');
    const changed = notices.slice(notices.indexOf('Se chegou “Seu e-mail de acesso mudou”'));
    expect(changed).toContain('a troca já aconteceu e a conta não entra mais pelo seu e-mail');
    expect(changed).not.toContain('Esqueceu a senha');
    // Revisão do item 1.6: frase própria (antes, dois dois-pontos seguidos), com o motivo de desativar.
    expect(changed).toContain(
      'pelo seu e-mail. Avise imediatamente um dono ou administrador, que corta o acesso dessa conta com “Desativar”, em “Equipe”, e convida seu e-mail de novo.',
    );
    expect(notices.indexOf('“Desativar”')).toBeGreaterThan(notices.indexOf('Se chegou “Seu e-mail de acesso mudou”'));
    expect(notices).toContain('avise quem administra');
    // Achado 11: quem já tem conta e usa a aba Cadastrar do convite recebe o link de acesso.
    expect(text).toContain(
      '“Seu link de acesso” chega depois de “Link por e-mail”, de “Enviar link para o meu e-mail” ou de “Cadastrar” com um e-mail que já tem conta',
    );
    // Quem administra pode mandar o link do convite por e-mail; o que não acontece é o CRM enviá-lo.
    expect(text).toContain('que quem administra manda a você (o CRM não o envia)');
    expect(text).not.toContain('nunca vem por e-mail');
    expect(text).toContain('chegarem em inglês');
    const link = answer('O que faço com o link do e-mail?');
    expect(link).toContain('“Continuar”');
    expect(link).toContain('“Crie sua senha”');
  });

  it('qualquer papel encerra as sessões, sem a promessa de tirar os outros aparelhos na hora', () => {
    const text = answer('Como saio da conta ou encerro o acesso em outros aparelhos?');
    expect(text).toContain('“Encerrar todas as sessões”');
    expect(text).toContain('Qualquer papel pode fazer isso');
    // signOut('global') impede as renovações; o acesso já emitido vale até expirar (1 hora no padrão do Supabase).
    expect(text).toContain('este aparelho sai na hora, e nos outros o acesso termina em até 1 hora');
    expect(text).toContain('troque também a senha pelo “Esqueceu a senha?”');
  });
});

// O roteiro (docs/ROADMAP-FINALIZACAO.md, itens 0.5 a 0.9) mudou comportamentos que a Ajuda precisa explicar.
describe('Ajuda: mudanças da F0', () => {
  it('0.5: valores no padrão brasileiro, telefone +55 e planilhas por papel', () => {
    expect(answer('Como digito valores em reais?')).toMatch(/1\.500,00.*12\.5 é R\$ 12,50/);
    expect(answer('Como os telefones são gravados e buscados?')).toContain('+5511999990000');
    expect(answer('Como importo contatos de uma planilha?')).toContain(
      'Donos, administradores e colaboradores importam',
    );
    const exported = answer('Como exporto contatos, reuniões ou relatórios?');
    expect(exported).toContain('donos e administradores usam “Exportar contatos”');
    expect(exported).toContain('pode ser reimportada sem perder o +55');
  });

  it('0.6: probabilidade que acompanha a etapa, fechamento e reabertura', () => {
    const probability = answer('De onde vem a probabilidade de uma oportunidade?');
    expect(probability).toContain('ao mudar de etapa, a probabilidade acompanha');
    expect(probability).toContain('ao reabrir, volta a valer a da etapa');
    const period = answer('Em que período uma venda ganha aparece nos “Relatórios”?');
    expect(period).toContain('data de fechamento');
    expect(period).toContain('Ao reabrir, a data de fechamento sai');
  });

  it('0.7: exclusões com vínculos e automações editadas sem pausar, com o detalhe técnico para gestores', () => {
    expect(answer('O que acontece ao excluir uma oportunidade com atividades ou recebimentos?')).toMatch(
      /^Só donos e administradores excluem/,
    );
    const edited = answer('Ao editar uma automação ativa, ela é pausada?');
    expect(edited).toContain('continua ativa');
    expect(edited).toContain('Em “Oportunidade mudou de etapa”, escolha o funil e a etapa de entrada');
    const removed = answer('Posso excluir uma automação ou uma tarefa criada por ela?');
    expect(removed).toContain('o histórico de execuções fica guardado com o nome dela');
    expect(removed).toContain('para donos e administradores, o detalhe técnico');
    expect(answer('Por que não consigo excluir um contato ou uma empresa?')).toContain(
      '“Excluir cadastro”, que fica desabilitado enquanto o cadastro tiver vínculos',
    );
  });

  it('0.8 e 0.9: colegas no mesmo registro, internet caindo e link aberto antes de entrar', () => {
    const colleague = answer('O que acontece se um colega alterar o mesmo registro que eu?');
    expect(colleague).toContain('a sua gravação não apaga a dele');
    expect(colleague).toContain('buscam as novidades quando você volta para a aba do CRM');
    // 0.9: as telas restritas por papel explicam o motivo e oferecem a saída.
    const restricted = answer('Por que “Integrações” diz que a tela não é para o meu papel?');
    expect(restricted).toContain('a tela explica o motivo e oferece “Ir para Hoje”');
    expect(restricted).toContain('quem são os donos e administradores');
    expect(answer('O que acontece se a internet cair?')).toContain('O CRM não guarda alterações para enviar depois');
    expect(answer('Abri um link do CRM antes de entrar na conta. Perco o endereço?')).toContain(
      'o CRM abre o mesmo endereço',
    );
  });
});

describe('Ajuda: respostas que não se contradizem', () => {
  it('o CRM envia só e-mails de acesso e nunca mensagens aos contatos', () => {
    expect(answer('Que e-mails o CRM envia?')).toMatch(/^Só e-mails de acesso à conta\./);
    for (const item of allItems.filter((entry) => /não envia (e-mails|mensagens)/.test(entry.a)))
      expect(item.a, item.q).toMatch(/não envia (e-mails nem mensagens de WhatsApp|mensagens) aos seus contatos/);
  });

  // Item 1.9: o CRM abre o aplicativo da pessoa com o texto, e quem envia é ela; nenhuma resposta promete o envio.
  it('nenhuma resposta diz que o CRM envia mensagens, fora da negação', () => {
    for (const item of allItems)
      for (const sentence of item.a.split(/(?<=[.!?])\s+/))
        if (/\bo CRM envia\b|\benviamos\b|\bo CRM manda\b/i.test(sentence))
          expect(sentence, item.q).toMatch(/\bnão\b|Só e-mails de acesso/);
    expect(answer('O CRM envia as mensagens sozinho?')).toMatch(/^Não\. O CRM abre o seu WhatsApp/);
    expect(answer('O CRM envia as mensagens sozinho?')).toContain('quem envia é você');
    expect(answer('Os contatos e a agenda são sincronizados automaticamente?')).toContain(
      'os botões “WhatsApp” e “E-mail” abrem o seu aplicativo com o texto, e quem envia é você',
    );
  });

  it('“Não contatar” diz quem marca e quem tira, e o que fica desabilitado', () => {
    const text = answer('O que significa “Não contatar”?');
    expect(text).toContain('Donos, administradores e colaboradores usam “Marcar como não contatar”');
    expect(text).toContain('só donos e administradores usam “Permitir contato de novo”');
    expect(text).toContain('“WhatsApp”, “E-mail”, “Ligar” e “Registrar ligação” ficam desabilitados');
    // A marca da empresa não alcança os contatos dela (desenho 1.9, seção 6.5).
    expect(text).toContain('A marca da empresa vale para o telefone da empresa, e não para os contatos dela');
    // Revisão do item 1.9 (rodada 2): o contato marcado sai da regra de contatos sem próxima ação da fila de atenção.
    expect(text).toContain('A fila de atenção não cobra próxima ação do contato marcado, como no encerrado');
    expect(answer('O que significa a fila de atenção?')).toContain(
      'contatos e oportunidades sem próxima ação (menos os contatos encerrados ou marcados “Não contatar”)',
    );
    const grouped = answer('Por que a fila mostra muitos contatos num item só?');
    expect(grouped).toContain('os encerrados e os marcados “Não contatar” não entram na contagem');
    expect(grouped).toContain(
      'inclusive os encerrados, os marcados “Não contatar” e os cadastrados nas últimas 24 horas',
    );
    expect(answer('O que cada papel pode fazer?')).toContain(
      'não permite o contato de novo com quem foi marcado “Não contatar”',
    );
  });

  it('os canais: quem abre, quem registra, o número fixo, o Outlook web e as pendências da aba', () => {
    const whatsapp = answer('Como mando um WhatsApp pelo CRM?');
    expect(whatsapp).toContain('Número fixo mostra um aviso');
    expect(whatsapp).toContain('Todos os papéis abrem o WhatsApp; registrar a conversa fica com donos');
    expect(answer('Como abro um e-mail no Gmail ou no Outlook?')).toContain(
      '“Abrir no Outlook web” serve para contas Microsoft 365 de trabalho ou escola',
    );
    const call = answer('Como registro uma ligação?');
    expect(call).toContain('(“Atendeu”, “Não atendeu” ou “Caixa postal”)');
    expect(call).toContain('o CRM oferece concluir essa mesma atividade, em vez de criar outra');
    const pending = answer('Abri o WhatsApp e não registrei. E agora?');
    expect(pending).toContain('A lista vale só para esta aba do navegador e some depois de 12 horas');
    expect(pending).toContain('Quem tem “Somente leitura” abre os canais, mas não registra');
    expect(answer('Como concluo uma atividade e já agendo a próxima?')).toContain(
      'Depois de um “Concluir” simples, o aviso oferece “Agendar a próxima”',
    );
    expect(answer('Como uso variáveis nos modelos?')).toContain(
      'só abre a mensagem depois que você completar ou apagar',
    );
    const phones = answer('Como os telefones são gravados e buscados?');
    expect(phones).toContain('As telas mostram o número como (11) 99999-0000');
    // O número não reconhecido desabilita os canais (channelPhone nulo), e não "pode não funcionar".
    expect(phones).toContain('o WhatsApp e a ligação ficam desabilitados até você corrigir o número');
    expect(phones).not.toMatch(/podem não funcionar/);
    // Revisão do item 1.9 (rodada 2): a busca geral não acha o formato das telas nem o telefone das empresas.
    expect(phones).toContain('Na busca geral (Ctrl+K), digite só os dígitos com o DDD, como 11999990000');
    expect(phones).toContain('ela não procura o telefone das empresas, então use a busca de “Empresas”');
    expect(phones).not.toContain('compara o texto gravado');
    // O resultado da ligação: o "Concluir" de um clique não pede, "Editar / reagendar" corrige e "Reabrir" apaga.
    const outcome = answer('Como informo ou corrijo o resultado de uma ligação?');
    expect(outcome).toContain('o “Concluir” de um clique não pede');
    expect(outcome).toContain('use “Editar / reagendar”: o campo “Resultado”');
    expect(outcome).toContain('“Reabrir” a ligação apaga o resultado');
    expect(answer('Como exporto contatos, reuniões ou relatórios?')).toContain('as reuniões e as visitas pendentes');
  });

  it('“organização” é só a empresa dona do CRM, e não um cliente de Empresas', () => {
    expect(answer('Qual é a diferença entre contato, empresa e oportunidade?')).not.toMatch(/organização/);
  });

  it('a próxima ação é qualquer atividade pendente com prazo que não seja nota, como em useCrmOnboarding', () => {
    for (const question of ['Terminar um tour conclui a configuração?', 'Como registro a próxima ação?']) {
      expect(answer(question), question).toContain('tarefa, ligação, WhatsApp, e-mail, reunião ou visita');
      expect(answer(question), question).not.toMatch(/com prazo e responsável/);
    }
  });
});

// Item 1.10 (docs/arquitetura/1.10.md, seção 11.1): a LGPD da empresa controladora, sem prometer o que o CRM não faz.
describe('Ajuda: privacidade e LGPD (item 1.10)', () => {
  it('exportar e anonimizar são de donos e administradores; registrar a base legal, de quem edita', () => {
    expect(answer('Uma pessoa pediu os dados dela. Como atendo?')).toContain(
      'donos e administradores usam “Exportar dados deste contato”',
    );
    expect(answer('Uma pessoa pediu para apagar os dados dela. Como faço?')).toMatch(
      /^Donos e administradores usam “Anonimizar contato”/,
    );
    expect(answer('Como registro que um contato deu consentimento?')).toContain(
      'Donos, administradores e colaboradores registram a base legal',
    );
    expect(answer('O que é a “Base legal” de um contato?')).toContain(
      'que donos e administradores escolhem em “Configurações”, na aba “Organização”',
    );
    const roles = answer('O que cada papel pode fazer?');
    expect(roles).toContain('a base legal padrão, exporta dados, anonimiza contatos');
    expect(roles).toContain('registra a base legal');
  });

  it('a exportação diz que leva as atividades e os recebimentos com outros contatos das oportunidades, sem os dados deles', () => {
    const text = answer('Uma pessoa pediu os dados dela. Como atendo?');
    expect(text).toContain(
      'Vão também as atividades e os recebimentos das oportunidades da pessoa ligados a outros contatos',
    );
    // Só o que está no cadastro dos outros contatos é trocado; um telefone antigo continua no texto.
    expect(text).toContain('com o nome, o e-mail e o telefone gravados no cadastro deles trocados por [anonimizado]');
    expect(text).toContain('Revise antes de enviar');
    expect(text).toContain('dados de terceiros que o CRM não reconhece, como apelidos e telefones antigos');
  });

  it('anonimizar não tem volta, diz o que sai e o que fica, e o que a troca de termos não reconhece', () => {
    const text = answer('Uma pessoa pediu para apagar os dados dela. Como faço?');
    expect(text).toContain('Não dá para desfazer');
    expect(text).toContain('Valores, situações e datas ficam, e os relatórios mantêm os números');
    expect(text).toContain(
      'Apelidos, um telefone que não está no cadastro e outros dados digitados nos títulos não são reconhecidos',
    );
    expect(text).toContain('troca o nome, o e-mail e o telefone por [anonimizado]');
  });

  it('a diferença cita as três ações, e o padrão da empresa nunca é consentimento', () => {
    const text = answer('Qual a diferença entre “Não contatar”, “Anonimizar contato” e “Excluir cadastro”?');
    for (const action of ['“Não contatar”', '“Anonimizar contato”', '“Excluir cadastro”'])
      expect(text).toContain(action);
    expect(text).toContain('Depois de anonimizar, o CRM não reconhece a pessoa se ela for cadastrada de novo');
    expect(answer('O que é a “Base legal” de um contato?')).toContain('Contatos antigos começam como “Não informada”');
  });

  it('nenhuma resposta promete apagar cópias de segurança ou arquivos já exportados', () => {
    const text = answer('A anonimização apaga os dados das cópias de segurança e dos arquivos exportados?');
    expect(text).toMatch(/^Não\./);
    for (const item of allItems)
      for (const sentence of item.a.split(/(?<=[.!?])\s+/))
        if (/cópias? de segurança|backup/i.test(sentence) && /apaga/i.test(sentence))
          expect(sentence, item.q).toMatch(/\bnão\b|^Não/i);
  });

  it('"Não contatar" diz que o CRM recusa agendar ação de contato, e "Já aconteceu" registra o que passou', () => {
    expect(answer('O que significa “Não contatar”?')).toContain('o CRM recusa agendar ação de contato');
    expect(answer('O que significa “Não contatar”?')).not.toMatch(/vale só para os botões/);
    const refusal = answer('Por que o CRM não deixa agendar uma ligação para um contato “Não contatar”?');
    expect(refusal).toContain('Tarefas internas continuam');
    expect(refusal).toContain('crie a atividade com “Já aconteceu”');
    expect(refusal).toContain('Na empresa marcada, a recusa vale para ligação e WhatsApp sem contato');
    expect(refusal).toContain('Ações agendadas antes da marca continuam na agenda');
    expect(answer('Como registro a próxima ação?')).toContain(
      'Para um contato marcado “Não contatar”, a próxima ação só pode ser uma tarefa',
    );
  });

  it('as respostas antigas foram corrigidas: a planilha de contatos, a exclusão, o guia e as recusas', () => {
    expect(answer('Como exporto contatos, reuniões ou relatórios?')).toContain(
      'mais nao_contatar, base_legal e registro_base_legal. Ela deixa de fora os contatos anonimizados',
    );
    expect(answer('Por que não consigo excluir um contato ou uma empresa?')).toContain(
      'donos e administradores usam “Anonimizar contato”',
    );
    expect(answer('Como começo a usar o CRM?')).toContain('à base legal dos contatos');
    expect(answer('Por que não consigo criar ou editar um registro?')).toContain(
      'Se disser que o contato foi anonimizado, cadastre um novo contato',
    );
    expect(answer('Onde vejo o histórico de alterações?')).toContain('“Exportações e anonimizações”');
  });

  // Item 1.11: a importação lê nao_contatar, base_legal e registro_base_legal, e nenhuma resposta diz o contrário.
  it('a importação lê nao_contatar e base_legal, e nenhuma resposta diz que ela ignora as colunas', () => {
    for (const item of allItems) {
      expect(item.a, item.q).not.toMatch(/importação (ainda )?(não lê|ignora)/);
      expect(item.a, item.q).not.toContain('use de novo “Marcar como não contatar”');
    }
    expect(answer('O que significa “Não contatar”?')).toContain(
      'A importação de planilha marca os contatos novos pela coluna nao_contatar; nos já cadastrados, a prévia avisa para marcar na ficha',
    );
    expect(answer('O que é a “Base legal” de um contato?')).toContain(
      'inclusive os importados sem base legal na planilha (sem a coluna base_legal, com ela vazia ou com “Não informada”)',
    );
    expect(answer('Como exporto contatos, reuniões ou relatórios?')).toContain(
      'pode ser reimportada sem perder o +55 dos telefones, a marca “Não contatar” nem o consentimento',
    );
  });

  // Achados 8, 10 e 11 da revisão do item 1.10, corrigidos no 1.11.
  it('o consentimento: a data do carimbo vem do servidor, e a data do aceite vai no texto', () => {
    const consent = answer('Como registro que um contato deu consentimento?');
    expect(consent).not.toContain('data digitada');
    expect(consent).toContain('pela hora do servidor');
    expect(consent).toContain('escreva no texto quando e por onde a pessoa consentiu');
    expect(consent).toContain('a coluna base_legal com Consentimento precisa da coluna registro_base_legal');
  });

  it('a anonimização tira só o vínculo com a empresa e explica o corte perto do limite de 500 caracteres', () => {
    // Revisão do item 1.11: a frase da empresa fica na resposta da anonimização, e não na das reticências.
    expect(answer('Uma pessoa pediu para apagar os dados dela. Como faço?')).toContain(
      'o vínculo com a empresa, que continua cadastrada',
    );
    const cut = answer('Por que um texto de outro contato terminou com reticências depois de uma anonimização?');
    expect(cut).toContain('ou no motivo do “Não contatar” de uma empresa');
    expect(cut).toContain('Esses campos guardam até 500 caracteres');
    expect(cut).toContain(
      'o fim do texto é cortado e marcado com reticências, sem deixar um [anonimizado] pela metade',
    );
    expect(cut).not.toContain('A empresa continua cadastrada');
    expect(questionsFound('reticências')).toContain(
      'Por que um texto de outro contato terminou com reticências depois de uma anonimização?',
    );
  });

  // Revisão do item 1.10: "Excluir cadastro" não faz a troca de termos nos outros registros nem fica registrado, então
  // o pedido de exclusão é sempre atendido por "Anonimizar contato", com ou sem vínculos.
  it('o pedido de exclusão é sempre “Anonimizar contato”, e excluir o cadastro não basta', () => {
    const erase = answer('Uma pessoa pediu para apagar os dados dela. Como faço?');
    expect(erase).toContain('também quando o contato não tem vínculos');
    expect(erase).toContain('“Excluir cadastro” não atende o pedido sozinho');
    expect(erase).not.toContain('também resolve');
    expect(answer('Qual a diferença entre “Não contatar”, “Anonimizar contato” e “Excluir cadastro”?')).toContain(
      '“Excluir cadastro” remove só o cadastro sem vínculos, sem mexer nos outros registros que citam a pessoa',
    );
    expect(answer('Por que não consigo excluir um contato ou uma empresa?')).toContain(
      'Se a pessoa pediu a exclusão dos dados dela, com ou sem vínculos, donos e administradores usam “Anonimizar contato”',
    );
  });

  // Revisão do item 1.10: a equipe da empresa cliente não vê o repositório de quem implantou o CRM.
  it('os modelos de documentos são pedidos a quem implantou o CRM', () => {
    expect(answer('O CRM cuida da LGPD da empresa?')).toContain(
      'Peça a quem implantou o CRM os modelos de aviso de privacidade e de termo, que precisam de revisão jurídica',
    );
    for (const item of allItems) expect(item.a, item.q).not.toContain('documentação da implantação');
  });
});

// Achados 10 e 11 da revisão do item 1.9: as pendências, o botão do canal em Hoje e "Inserir variável" em cada campo.
describe('Ajuda: canais depois da revisão do item 1.9', () => {
  it('as pendências: o mesmo lugar não cria outra linha, outro lugar cria, e ficam as 10 mais recentes', () => {
    const text = answer('Abri o WhatsApp e não registrei. E agora?');
    expect(text).toContain('Abrir de novo o mesmo canal do mesmo lugar não cria outra linha');
    expect(text).toContain('aberto de outra ficha, de uma oportunidade ou de uma atividade, ele entra em outra linha');
    expect(text).toContain('Ficam as 10 aberturas mais recentes');
    expect(text).not.toContain('Abrir o mesmo contato de novo não cria outra linha');
  });

  it('em Hoje, o botão do canal só aparece com o dado, e cada campo do modelo tem o seu “Inserir variável”', () => {
    expect(answer('Como mando um WhatsApp pelo CRM?')).toContain(
      'em “Hoje”, o botão do canal só aparece na atividade cujo contato tem o número',
    );
    expect(answer('Como uso variáveis nos modelos?')).toContain(
      'use “Inserir variável”, ao lado do assunto ou do texto, para pôr nesse campo',
    );
  });
});

// Item 1.6 (docs/arquitetura/1.6.md, seção 11.1): a marca vem da implantação, e o crédito só aparece onde a tela o mostra.
describe('Ajuda: marca do CRM e crédito da base', () => {
  it('a marca é trocada por quem publicou o CRM, e o nome da organização é outro, de donos e administradores', () => {
    const text = answer('Como troco o nome e o logo do CRM?');
    expect(text).toContain('vêm da configuração da implantação, feita por quem publicou o CRM');
    expect(text).toContain('Nenhuma tela do CRM troca a marca: peça a essa pessoa');
    // Revisão do item 1.6: quem publicou costuma ser o próprio dono, e a resposta diz onde está o guia.
    expect(text).toContain('Se foi você quem publicou, siga o guia Trocar a marca do CRM, em docs/MARCA.md');
    expect(text).toContain('O nome da organização, em “Configurações”, na aba “Organização”, é outro');
    expect(text).toContain('donos e administradores mudam esse nome ali, e ele não troca o nome nem o logo da entrada');
    // Nenhuma promessa de tela ou botão para trocar a marca.
    expect(text).not.toMatch(/(use|clique|toque|abra) “[^”]+” para (trocar|mudar) (a marca|o logo)/i);
    // A marca do programa só aparece na pergunta do crédito, que só existe onde o crédito aparece.
    for (const item of allItems.filter((entry) => !entry.onlyWithBaseCredit))
      expect(`${item.q} ${item.a}`, item.q).not.toMatch(/Empreende/);
  });

  it('o crédito: o que é, onde aparece e quem pode remover, só com o crédito na tela', () => {
    const question = `O que significa “${BASE_CREDIT_TEXT}”?`;
    const text = answer(question);
    expect(question).toBe('O que significa “Feito com Empreende.IA”?');
    expect(text).toContain('Ele aparece na tela de entrada e no rodapé desta Ajuda');
    // Revisão do item 1.6: os e-mails seguem só o brand.json, e VITE_SHOW_BASE_CREDIT pode ligar o crédito só no app (a
    // pergunta aparece, e os e-mails saem sem ele). A resposta não promete o crédito nos e-mails.
    expect(text).toContain('e pode aparecer também no rodapé dos e-mails de acesso');
    expect(text).not.toMatch(/(aparece|está) [^.]*nos e-mails de acesso/);
    expect(text).toContain('quando o CRM usa a marca de outra empresa');
    expect(text).toContain('Quem publicou o CRM pode remover o crédito nos casos que a licença da base permite');
    expect(text).not.toMatch(/Empreende/);
    const questions = (baseCredit: boolean) =>
      visibleFaqCategories(baseCredit).flatMap((category) => category.items.map((item) => item.q));
    expect(questions(true)).toContain(question);
    expect(questions(false)).not.toContain(question);
    expect(questions(false)).toHaveLength(allItems.length - 1);
    // Com a marca do programa (a dos testes), o crédito nunca aparece, nem a pergunta.
    expect(visibleFaqCategories().flatMap((category) => category.items.map((item) => item.q))).not.toContain(question);
  });
});

describe('Ajuda: quem pode fazer o quê', () => {
  it('a pergunta dos papéis usa os nomes da Equipe', () => {
    const text = answer('O que cada papel pode fazer?');
    for (const label of Object.values(CRM_ROLE_LABELS)) expect(text).toContain(`“${label}”`);
  });

  it.each([
    ['Por que não consigo excluir um contato ou uma empresa?', 'Só donos e administradores'],
    ['Como copio, renovo ou cancelo um convite?', 'donos e administradores veem os convites'],
    ['Como desativo quem saiu da equipe e passo a carteira?', 'donos e administradores usam “Desativar”'],
    ['Como reativo uma pessoa desativada?', 'donos e administradores usam “Reativar”'],
    ['Como movo uma oportunidade pelo teclado?', 'Donos, administradores e colaboradores movem'],
    ['Como registro a próxima ação?', 'Donos, administradores e colaboradores registram'],
    ['De onde vem a probabilidade de uma oportunidade?', 'a das etapas, só donos e administradores'],
    ['Ao editar uma automação ativa, ela é pausada?', 'Só donos e administradores editam e pausam'],
    ['Como digito valores em reais?', 'donos, administradores e colaboradores criam e editam'],
    ['O que devo conferir antes de ativar uma automação?', 'Só donos e administradores'],
    ['Como registro um recebimento?', 'Excluir é só para donos e administradores'],
    ['Quem pode concluir, editar ou excluir uma atividade?', 'Excluir é só para donos e administradores'],
    ['Para que servem os “Modelos”?', 'excluir é só para donos e administradores'],
    ['Onde vejo o histórico de alterações?', 'donos e administradores veem'],
    ['Como crio um funil ou mudo as etapas?', 'donos e administradores criam um funil'],
  ])('%s diz quem pode', (question, expected) => {
    expect(answer(question)).toContain(expected);
  });
});

describe('Ajuda: busca', () => {
  it('ignora acentos, maiúsculas, hífens e pontuação', () => {
    expect(normalizeHelpText('Não chegou o E-mail?')).toBe('nao chegou o email');
    expect(normalizeHelpText('“Configurações”, aba Funis')).toBe('configuracoes aba funis');
  });

  it('sem pesquisa, mostra todas as categorias', () => {
    expect(searchFaq('   ')).toBe(FAQ_CATEGORIES);
  });

  it.each([
    ['email', 'Que e-mails o CRM envia?'],
    ['o link nao chegou', 'O link do e-mail não chegou. O que faço?'],
    ['esqueci a senha', 'Esqueci minha senha. O que faço?'],
    ['como faço para importar uma planilha', 'Como importo contatos de uma planilha?'],
    ['excel', 'Como importo contatos de uma planilha?'],
    ['apagar contato', 'Por que não consigo excluir um contato ou uma empresa?'],
    ['convidar', 'Como uma pessoa nova entra na equipe?'],
    ['permissão', 'O que cada papel pode fazer?'],
    ['offline', 'O que acontece se a internet cair?'],
    ['whatsapp', 'Para que servem os “Modelos”?'],
    ['codigo', 'Pedi o link no computador, mas abri o e-mail no celular. E agora?'],
    ['continuar', 'O que faço com o link do e-mail?'],
    ['1.500,00', 'Como digito valores em reais?'],
    ['probabilidade', 'De onde vem a probabilidade de uma oportunidade?'],
    ['sair', 'Como saio da conta ou encerro o acesso em outros aparelhos?'],
    ['inteligência artificial', 'O Copiloto usa inteligência artificial?'],
    ['revogar', 'Como copio, renovo ou cancelo um convite?'],
    ['cancelar convite', 'Como copio, renovo ou cancelo um convite?'],
    ['validade do convite', 'Como copio, renovo ou cancelo um convite?'],
    ['remover usuário', 'Como desativo quem saiu da equipe e passo a carteira?'],
    ['remover membro', 'Como desativo quem saiu da equipe e passo a carteira?'],
    ['excluir usuário', 'Como desativo quem saiu da equipe e passo a carteira?'],
    ['desativar', 'Como desativo quem saiu da equipe e passo a carteira?'],
    ['tirar acesso', 'Como desativo quem saiu da equipe e passo a carteira?'],
    ['funcionário saiu', 'Como desativo quem saiu da equipe e passo a carteira?'],
    ['demitir', 'Como desativo quem saiu da equipe e passo a carteira?'],
    ['carteira', 'Como desativo quem saiu da equipe e passo a carteira?'],
    ['transferir carteira', 'Como desativo quem saiu da equipe e passo a carteira?'],
    ['trocar responsável', 'Como desativo quem saiu da equipe e passo a carteira?'],
    ['trocar responsável', 'Como acompanho uma negociação?'],
    ['reativar', 'Como reativo uma pessoa desativada?'],
    ['passar carteira', 'Ficaram contatos com uma pessoa desativada. Como passo para outra?'],
    ['desativado', 'Por que um nome aparece com “(desativado)”?'],
    ['acesso encerrado', 'Apareceu “Seu acesso foi encerrado”. E agora?'],
    ['equipe', 'Como desativo quem saiu da equipe e passo a carteira?'],
    ['mudar nome da empresa', 'A empresa criada no primeiro acesso aparece em “Empresas”?'],
    ['trocar nome da empresa', 'A empresa criada no primeiro acesso aparece em “Empresas”?'],
    ['alterar nome empresa', 'A empresa criada no primeiro acesso aparece em “Empresas”?'],
    ['preferências dos tours', 'Como mudo as preferências dos tours?'],
    ['convites discretos', 'Como mudo as preferências dos tours?'],
    ['trocar senha', 'Como troco minha senha ou meu e-mail?'],
    ['trocar e-mail', 'Como troco minha senha ou meu e-mail?'],
    ['mudar email da conta', 'Como troco minha senha ou meu e-mail?'],
    ['email alterado', 'Recebi um aviso de senha ou de e-mail alterado. O que faço?'],
    ['troca de e-mail', 'Recebi um aviso de senha ou de e-mail alterado. O que faço?'],
    ['novo usuário', 'Como uma pessoa nova entra na equipe?'],
    ['trocar papel', 'O que cada papel pode fazer?'],
    ['importar empresas', 'Como importo contatos de uma planilha?'],
    ['importar oportunidades', 'Como importo contatos de uma planilha?'],
    ['computador compartilhado', 'Como saio da conta ou encerro o acesso em outros aparelhos?'],
    ['convites pendentes de quem saiu', 'Como desativo quem saiu da equipe e passo a carteira?'],
    ['quem criou o convite', 'Como copio, renovo ou cancelo um convite?'],
    ['criar funil', 'Como crio um funil ou mudo as etapas?'],
    ['funis', 'Como crio um funil ou mudo as etapas?'],
    ['adicionar etapa', 'Como crio um funil ou mudo as etapas?'],
    ['excluir etapa', 'Como crio um funil ou mudo as etapas?'],
    ['mudar etapa', 'Como movo uma oportunidade pelo teclado?'],
    ['papéis', 'O que cada papel pode fazer?'],
    ['import', 'Como importo contatos de uma planilha?'],
    // Item 1.6: a marca do CRM e o crédito da base.
    ['logo', 'Como troco o nome e o logo do CRM?'],
    ['trocar marca', 'Como troco o nome e o logo do CRM?'],
    ['favicon', 'Como troco o nome e o logo do CRM?'],
    ['nome do crm', 'Como troco o nome e o logo do CRM?'],
    ['logo', 'A empresa criada no primeiro acesso aparece em “Empresas”?'],
    ['credito', `O que significa “${BASE_CREDIT_TEXT}”?`],
    ['feito com', `O que significa “${BASE_CREDIT_TEXT}”?`],
    // Item 1.9: canais nível 1.
    ['whatsapp', 'Como mando um WhatsApp pelo CRM?'],
    ['zap', 'Como mando um WhatsApp pelo CRM?'],
    ['ligação', 'Como registro uma ligação?'],
    ['telefonar', 'Como registro uma ligação?'],
    ['gmail', 'Como abro um e-mail no Gmail ou no Outlook?'],
    ['outlook', 'Como abro um e-mail no Gmail ou no Outlook?'],
    ['variável', 'Como uso variáveis nos modelos?'],
    ['não contatar', 'O que significa “Não contatar”?'],
    ['lgpd', 'O que significa “Não contatar”?'],
    ['opt-out', 'O que significa “Não contatar”?'],
    ['para registrar', 'Abri o WhatsApp e não registrei. E agora?'],
    ['concluir e agendar', 'Como concluo uma atividade e já agendo a próxima?'],
    // Item 1.10: privacidade e LGPD.
    ['lgpd', 'O CRM cuida da LGPD da empresa?'],
    ['privacidade', 'O CRM cuida da LGPD da empresa?'],
    ['consentimento', 'Como registro que um contato deu consentimento?'],
    ['anonimizar', 'Uma pessoa pediu para apagar os dados dela. Como faço?'],
    ['apagar meus dados', 'Uma pessoa pediu para apagar os dados dela. Como faço?'],
    ['titular', 'Uma pessoa pediu os dados dela. Como atendo?'],
    ['base legal', 'O que é a “Base legal” de um contato?'],
    ['portabilidade', 'Uma pessoa pediu os dados dela. Como atendo?'],
    ['já aconteceu', 'Por que o CRM não deixa agendar uma ligação para um contato “Não contatar”?'],
    ['backup', 'A anonimização apaga os dados das cópias de segurança e dos arquivos exportados?'],
  ])('"%s" encontra "%s"', (query, question) => {
    expect(questionsFound(query)).toContain(question);
  });

  // Uma palavra pedaço de outra trazia respostas sem relação: "ia" casava "dia" e "inicia", "nova" casava
  // "novamente", e a resposta do Copiloto ficava perdida entre 40.
  it.each(['IA', 'tem IA', 'usa IA', 'o CRM tem IA?', 'inteligência artificial'])(
    '"%s" traz a resposta do Copiloto entre poucas',
    (query) => {
      const found = questionsFound(query);
      expect(found).toContain('O Copiloto usa inteligência artificial?');
      expect(found.length).toBeLessThanOrEqual(3);
    },
  );

  it('compara palavras inteiras, no singular ou no plural', () => {
    const funnel = questionsFound('criar funil');
    expect(funnel[0]).toBe('Como crio um funil ou mudo as etapas?');
    expect(funnel).not.toContain('Ao editar uma automação ativa, ela é pausada?');
    expect(questionsFound('nova etapa')).toContain('Como crio um funil ou mudo as etapas?');
    expect(questionsFound('nova etapa')).not.toContain('Sair da configuração apaga o que já salvei?');
    expect(questionsFound('valor em real ')).toContain('Como digito valores em reais?');
  });

  it('só a última palavra, que pode estar sendo digitada, vale pelo começo', () => {
    expect(questionsFound('nova')).toContain('Sair da configuração apaga o que já salvei?');
    expect(questionsFound('nova ')).not.toContain('Sair da configuração apaga o que já salvei?');
    expect(questionsFound('import planilha')).toEqual([]);
    expect(questionsFound('importar planil')).toContain('Como importo contatos de uma planilha?');
  });

  it('com várias palavras, todas precisam aparecer', () => {
    expect(questionsFound('senha')).toContain('Esqueci minha senha. O que faço?');
    expect(questionsFound('senha planilha')).toEqual([]);
  });

  it('o título da categoria também conta', () => {
    const financeiro = FAQ_CATEGORIES.find((category) => category.id === 'financeiro')!;
    expect(searchFaq('financeiro e relatorios')).toEqual([financeiro]);
  });
});

// Achados de baixa severidade da revisão da Ajuda (docs/arquitetura/1.2.md, seção 12).
describe('Ajuda: escrita que a busca e a trava de rótulos alcançam', () => {
  // Achado 1: a busca tira o hífen ("mudá-lo" vira "mudalo"), e "mudar" deixa de achar a resposta.
  it('nenhuma resposta usa ênclise com hífen (-lo, -la, -los, -las)', () => {
    for (const item of allItems) expect(`${item.q} ${item.a}`, item.q).not.toMatch(/\p{L}-(?:lo|la|los|las)\b/u);
  });

  // Achado 2: tela citada sem aspas curvas escapa da trava de rótulos (SCREENS). Os nomes do menu, com maiúscula e
  // fora do começo da frase, vão entre aspas curvas.
  const menu = new Set(
    ['src/components/shell/AppRail.tsx', 'src/components/layout/MobileBottomNav.tsx'].flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/title: '([^']+)'/g)].map((match) => match[1]),
    ),
  );
  /** Nomes do menu fora das aspas curvas, com maiúscula, fora do começo da frase e sem ser nome de produto. */
  const unquotedScreens = (text: string) => {
    const outside = text.replace(/“[^”]*”/g, (quoted) => ' '.repeat(quoted.length));
    return [...menu].filter((name) =>
      [...outside.matchAll(new RegExp(`(?<!\\p{L})${name}(?!\\p{L})`, 'gu'))].some((match) => {
        const before = outside.slice(0, match.index).trimEnd();
        return before !== '' && !/[.!?:]$/.test(before) && !before.endsWith('Google');
      }),
    );
  };

  it('a trava das telas sem aspas reconhece os textos antigos e aceita os atuais', () => {
    expect(menu.size).toBeGreaterThan(10);
    expect(unquotedScreens('Em Contatos e Empresas, ajuste a busca.')).toEqual(['Contatos', 'Empresas']);
    expect(unquotedScreens('Ver contatos abre Contatos com esse filtro.')).toEqual(['Contatos']);
    expect(unquotedScreens('Hoje, Agenda, Atividades e Tarefas mostram os mesmos registros.')).toEqual([
      'Agenda',
      'Atividades',
      'Tarefas',
    ]);
    expect(unquotedScreens('Em “Contatos” e “Empresas”, ajuste a busca. Hoje abre primeiro.')).toEqual([]);
    expect(unquotedScreens('Exporte para o Google Agenda.')).toEqual([]);
  });

  it('cita as telas do menu entre aspas curvas', () => {
    const unquoted = allItems.flatMap((item) =>
      [item.q, item.a].flatMap((text) => unquotedScreens(text).map((name) => `${item.q}: ${name}`)),
    );
    expect(unquoted).toEqual([]);
  });

  // Achado 8: "banco" pode ser lido como o banco do dinheiro num CRM com Financeiro.
  it('a Ajuda não fala em "banco" (os tours têm a mesma trava em tour-state.test.ts)', () => {
    for (const item of allItems) expect(`${item.q} ${item.a}`, item.q).not.toMatch(/\bbanco\b/i);
  });

  // Achado 12: quem lê a resposta precisa saber se o seu papel faz aquilo.
  it('toda resposta que ensina um botão ou campo de edição diz quem pode', () => {
    const editing = [
      'Editar',
      'Editar / reagendar',
      'Combinar ação',
      'Nova oportunidade',
      'Novo lançamento',
      'Mover ou alterar situação',
      'Marcar como ganha',
      'Reabrir',
      'Concluir',
      'Pausar',
      'Revisar e ativar',
      'Criar convite',
      'Alterar papel',
      'Desativar',
      'Reativar',
      'Passar carteira',
      'Excluir cadastro',
      'Desvincular e excluir',
      'Novo funil',
      'Adicionar etapa',
      'Confirmar importação',
      'Exportar contatos',
      'Prévia',
      'Probabilidade (%)',
      'Fechada em',
      'Responsável',
    ];
    const roles = /\b(?:donos?|administrador(?:es)?|colaborador(?:es)?|qualquer papel)\b|“Somente leitura”|“Dono”/i;
    const silent = allItems.filter(
      (item) => quotedLabels(item.a).some((label) => editing.includes(label)) && !roles.test(item.a),
    );
    expect(silent.map((item) => item.q)).toEqual([]);
  });
});

// Item 1.11: a importação de planilha, com prévia, responsáveis e gravação em lotes.
describe('Ajuda: importação de planilha (item 1.11)', () => {
  it('a resposta de importar cita os 5.000 contatos, a prévia, “Importar” e “Distribuir igualmente entre”', () => {
    const text = answer('Como importo contatos de uma planilha?');
    expect(text).toContain('com até 5.000 contatos e 5 MB');
    expect(text).toContain('A prévia conta as linhas prontas, as repetidas e as com erro, com o motivo de cada uma');
    expect(text).toContain('nada é gravado antes de “Importar”');
    expect(text).toContain('“Distribuir igualmente entre” pessoas ativas da equipe');
    expect(text).not.toMatch(/500 contatos|2 MB|first_name/);
  });

  it('as colunas: o nome é a única obrigatória, os sinônimos e as colunas da privacidade', () => {
    const text = answer('Que colunas a planilha de contatos aceita?');
    expect(text).toContain(
      'nome, sobrenome, email, telefone, empresa, cargo, origem, responsavel, relacionamento, observacoes, nao_contatar, base_legal e registro_base_legal',
    );
    expect(text).toContain('Nome completo, E-mail, Celular, WhatsApp e Vendedor');
    expect(text).toContain('Duas colunas para a mesma informação, como Telefone e Celular, não são aceitas');
    expect(text).toContain('use o nome ou o e-mail de uma pessoa ativa da equipe');
    expect(answer('Como importo contatos de uma planilha?')).toContain('Só o nome é obrigatório');
  });

  it('nenhuma resposta promete ler XLSX, e a do Excel explica como salvar em CSV', () => {
    for (const item of allItems)
      for (const sentence of item.a.split(/(?<=[.!?])\s+/))
        if (/xlsx/i.test(sentence)) expect(sentence, item.q).toMatch(/\bnão\b/);
    const excel = answer('Como salvo a planilha do Excel em CSV?');
    // Revisão do item 1.11: o CSV UTF-8 primeiro, e só ele no Mac, cujo CSV comum pode trocar os acentos.
    expect(excel).toContain(
      'escolha CSV UTF-8 (delimitado por vírgulas). No Excel do Windows, CSV (separado por vírgulas)',
    );
    expect(excel).toContain('no Mac, use só o CSV UTF-8');
    // Revisão do item 1.11: o Microsoft 365 com o salvamento automático (achado 13) e a frase dos acentos (achado 11).
    expect(excel).toContain('no Microsoft 365 com o salvamento automático ligado, Arquivo > Salvar uma Cópia');
    expect(excel).toContain('também funciona, e o CRM lê os acentos dele');
    expect(excel).not.toContain('com ponto e vírgula e acentos');
    expect(excel).toContain('confira os acentos dos nomes');
    expect(excel).toContain('Arquivo > Fazer download > Valores separados por vírgula (.csv)');
    expect(excel).toContain('5,51E+12');
  });

  it('as linhas que ficaram de fora, a planilha para corrigir e a importação parada', () => {
    const left = answer('Por que algumas linhas ficaram fora da importação?');
    expect(left).toContain('o CRM não junta nem atualiza o contato existente');
    expect(left).toContain('Use “Baixar contatos não importados”');
    expect(left).toContain('marque “Importar também as linhas com telefone repetido”');
    expect(left).toContain('Uma repetida que pede “Não contatar” avisa quando o contato cadastrado não tem a marca');
    const stopped = answer('A importação de contatos parou no meio. O que faço?');
    // Revisão do item 1.11, achado 10: "Parar" também tem resposta.
    expect(stopped).toMatch(/^“Parar” termina a parte em andamento e mostra quantos contatos já foram gravados\./);
    expect(stopped).toContain('use “Continuar importação” na mesma janela');
    expect(stopped).toContain('Fechar a janela com contatos por gravar pede confirmação');
    expect(stopped).toContain('os sem e-mail e sem telefone entrariam de novo');
    expect(stopped).toContain('As empresas novas criadas antes da parada continuam cadastradas');
  });

  // Revisão do item 1.11: os campos que a importação traz se corrigem no cadastro, também no pedido do titular.
  it('cargo, origem e observações se corrigem em “Editar cadastro”, e "Não contatar" de repetida vai na ficha', () => {
    const fix = answer('Onde corrijo o cargo, a origem ou as observações de um contato?');
    expect(fix).toContain('use “Editar cadastro”. Os campos “Cargo”, “Origem” e “Observações” ficam ali');
    expect(fix).toContain('quando a pessoa pedir a correção dos dados dela');
    expect(questionsFound('cargo')).toContain('Onde corrijo o cargo, a origem ou as observações de um contato?');
    // Revisão do item 1.11, achado 11: "sim" é o valor a escrever, e não uma afirmação.
    expect(answer('Que colunas a planilha de contatos aceita?')).toContain(
      'Na coluna nao_contatar, escreva sim para marcar o contato novo',
    );
    expect(answer('Como importo contatos de uma planilha?')).toContain(
      'sem a coluna responsavel ou com a célula vazia',
    );
  });

  it('o papel de colaborador importa com a marca e a base legal', () => {
    expect(answer('O que cada papel pode fazer?')).toContain(
      'importa contatos, com a marca “Não contatar” e a base legal da planilha',
    );
  });

  it.each([
    ['importar', 'Como importo contatos de uma planilha?'],
    ['planilha', 'Que colunas a planilha de contatos aceita?'],
    ['excel', 'Como salvo a planilha do Excel em CSV?'],
    ['xlsx', 'Como salvo a planilha do Excel em CSV?'],
    ['csv', 'Como importo contatos de uma planilha?'],
    ['vendedor', 'Como importo contatos de uma planilha?'],
    ['distribuir', 'Como importo contatos de uma planilha?'],
    ['repetido', 'Por que algumas linhas ficaram fora da importação?'],
    ['duplicado', 'Por que algumas linhas ficaram fora da importação?'],
  ])('a busca por “%s” acha “%s”', (query, question) => {
    expect(questionsFound(query)).toContain(question);
  });
});

// Item 1.12: os lembretes no menu, com a regra de "Minha rotina" de Hoje.
describe('Ajuda: lembretes no menu (item 1.12)', () => {
  it('diz o que o número conta, de quem, como aparece e o que não faz', () => {
    const text = answer('O que é o número ao lado de “Hoje” no menu?');
    expect(text).toContain('as vencidas e as que vencem até a meia-noite');
    expect(text).toContain('as mesmas de “Próximos passos do dia” em “Minha rotina”');
    // Revisão do item 1.12: as pílulas são do menu expandido, e o relógio conta só as que ainda vencem hoje.
    expect(text).toContain(
      'No menu expandido do computador, o número com o triângulo conta as vencidas, e o com o relógio, as que ainda vencem hoje',
    );
    expect(text).not.toContain('as do dia');
    expect(text).toContain('no menu recolhido e no celular, aparece o total, num selo preenchido quando alguma venceu');
    expect(text).toContain('O número muda ao concluir ou reagendar, quando um prazo passa e ao voltar para a aba');
    expect(text).toContain('Contam tarefas, ligações, WhatsApp, e-mails, reuniões e visitas');
    expect(text).toContain('inclusive uma ação agendada antes de o contato ser marcado “Não contatar”');
    expect(text).toContain('Notas, atividades sem prazo e as de colegas não contam');
    // Notificações push e e-mail de lembrete são dos itens 3.2b e 3.6: a Ajuda não promete.
    expect(text).toContain('O CRM não envia lembretes por e-mail nem notificações');
    for (const query of ['lembrete', 'vencidas', 'notificação', 'atrasadas'])
      expect(questionsFound(query), query).toContain('O que é o número ao lado de “Hoje” no menu?');
  });

  // Item 1.14: o número do menu é sempre o da conta, também com outra pessoa ou a organização escolhidas em "Hoje".
  it('o número do menu continua sendo o da conta quando “Hoje” mostra outra pessoa', () => {
    expect(answer('O que é o número ao lado de “Hoje” no menu?')).toContain(
      'Notas, atividades sem prazo e as de colegas não contam, nem quando “Hoje” mostra outra pessoa',
    );
    expect(answer('Por que o número do menu é diferente de “Para hoje”?')).toContain(
      'os indicadores da tela são desse recorte, e o número do menu continua sendo o seu',
    );
    expect(answer('Como vejo a rotina de outra pessoa da equipe?')).toContain(
      'O número ao lado de “Hoje”, no menu, continua contando só as suas atividades',
    );
  });

  // Revisão do item 1.12: quem clica no número cai em "Hoje" e vê "Para hoje" com outro valor; a Ajuda diz por quê.
  it('explica a diferença entre o relógio do menu e “Para hoje”', () => {
    const text = answer('Por que o número do menu é diferente de “Para hoje”?');
    expect(text).toContain('conta só as atividades que ainda vencem hoje, de agora até a meia-noite');
    expect(text).toContain('“Para hoje” conta todas as de hoje, inclusive as que já venceram');
    expect(text).toContain('O total do menu é sempre o número de atividades de “Próximos passos do dia”');
    expect(questionsFound('número diferente')).toContain('Por que o número do menu é diferente de “Para hoje”?');
  });

  // Revisão do item 1.12: a falta do número não passa por "nenhuma pendência" quando a leitura falhou.
  it('o ponto de interrogação é a leitura que falhou, e não a falta de pendências', () => {
    const text = answer('O que quer dizer o ponto de interrogação ao lado de “Hoje” no menu?');
    expect(text).toContain('O CRM não conseguiu conferir os seus lembretes');
    expect(text).toContain('Não quer dizer que você está sem pendências');
    expect(text).toContain('tenta de novo ao voltar para a aba e quando uma atividade é gravada');
    // Revisão do item 1.14: Hoje refaz as leituras do menu que falharam (achado 6 da revisão do 1.12).
    expect(text).toContain('Abrir “Hoje”, ou usar “Tentar novamente” nele, também confere de novo os lembretes');
    for (const query of ['interrogação', 'lembrete sumiu', 'número sumiu'])
      expect(questionsFound(query), query).toContain(
        'O que quer dizer o ponto de interrogação ao lado de “Hoje” no menu?',
      );
  });
});

// Revisão do item 1.11: os achados 7 e 9 também mudaram a Ajuda.
describe('Ajuda: correções da revisão do item 1.11', () => {
  it('a busca abre fora das janelas, e a recusa com código tem um caminho só', () => {
    // Revisão do item 1.12: o que acontece com uma janela aberta, numa frase própria.
    const search = answer('Como funcionam os tours e a busca?');
    expect(search).toContain(
      'Ctrl+K (⌘K no Mac) abre a busca, que encontra contatos, empresas, oportunidades e atividades pelo nome',
    );
    expect(search).toContain('Com uma janela aberta, o atalho não abre a busca: feche a janela antes.');
    expect(search).not.toContain('fora das janelas abertas');
    const coded = answer('A importação de contatos parou com um código de erro. O que faço?');
    expect(coded).toContain('a janela não oferece “Continuar importação”');
    expect(coded).toContain('Use “Baixar contatos não importados”');
    expect(coded).toContain('Se a recusa continuar, informe o código a quem administra o CRM');
    const columns = answer('Que colunas a planilha de contatos aceita?');
    // Achado 12: "Não informada", que a exportação escreve, também recebe o padrão da empresa, e a prévia avisa.
    expect(columns).toContain('vazia ou “Não informada” vale a base padrão da empresa, e a prévia avisa');
    expect(answer('Como importo contatos de uma planilha?')).toContain(
      '“Origem dos contatos sem origem na planilha (opcional)”',
    );
  });
});

// Item 1.14: gestão mínima e cadastro básico.
describe('Ajuda: gestão mínima e cadastro básico (item 1.14)', () => {
  it('cada pergunta nova fica na categoria do assunto', () => {
    expect(categoryOf('Como vejo a rotina de outra pessoa da equipe?')).toBe('rotina');
    expect(categoryOf('Como vejo quanto cada pessoa ganhou no período?')).toBe('financeiro');
    expect(categoryOf('Quais origens um contato pode ter e como filtro por origem?')).toBe('contatos');
  });

  it('o recorte de uma pessoa: as quatro telas, quem saiu marcado, o número do menu e o que cada papel faz', () => {
    const text = answer('Como vejo a rotina de outra pessoa da equipe?');
    expect(text).toContain('Em “Hoje”, “Atividades”, “Tarefas” e “Agenda”, o seletor do responsável lista');
    expect(text).toContain('Quem foi desativado aparece por último, com “(desativado)”');
    expect(text).toContain('e a tela diz de quem é a rotina');
    expect(text).toContain('Todos os papéis, inclusive “Somente leitura”, veem a rotina da equipe');
    expect(text).toContain('donos, administradores e colaboradores também editam as atividades dos colegas');
    // Revisão do item 1.14: a atividade nova começa com a pessoa escolhida (defaults.user_id), ou com a conta.
    expect(text).toContain(
      'Uma atividade criada com uma pessoa escolhida começa com ela no “Responsável” (com você, se ela foi desativada)',
    );
    expect(text).not.toContain('para você ver o que ficou com essa pessoa');
    for (const query of ['rotina de outra pessoa', 'filtrar por vendedor', 'atividades do colega', 'gerente'])
      expect(questionsFound(query), query).toContain('Como vejo a rotina de outra pessoa da equipe?');
    // Revisão do item 1.14: quem foi desativado passou as pendentes a quem recebeu a carteira (D9); o histórico fica em
    // "Todas" e "Concluídas / notas", e os contatos que ficaram, na fila de atenção de Hoje.
    const left = answer('Escolhi uma pessoa desativada e “Atividades” ficou vazia. Por quê?');
    expect(categoryOf('Escolhi uma pessoa desativada e “Atividades” ficou vazia. Por quê?')).toBe('rotina');
    expect(left).toContain(
      'as atividades pendentes e as oportunidades em aberto dessa pessoa passam para quem recebe a carteira',
    );
    expect(left).toContain('Use “Ver o histórico”, ou escolha “Todas” ou “Concluídas / notas”');
    expect(left).toContain(
      'Em “Hoje”, “Ver atividades” já abre “Todas”, e a fila de atenção mostra os contatos que ficaram',
    );
    for (const query of ['desativado vazia', 'histórico de quem saiu', 'atividades vazias'])
      expect(questionsFound(query), query).toContain(
        'Escolhi uma pessoa desativada e “Atividades” ficou vazia. Por quê?',
      );
    // A fila de atenção também é a do recorte escolhido, inclusive o de uma pessoa (attentionQueue com ownerLabel).
    expect(answer('O que significa a fila de atenção?')).toContain(
      'lista o que precisa de atenção no recorte escolhido, como a sua rotina ou a de uma pessoa da equipe',
    );
    const grouped = answer('Por que a fila mostra muitos contatos num item só?');
    expect(grouped).toContain('e só contam os do recorte escolhido, como “Minha rotina” ou uma pessoa da equipe');
    expect(grouped).not.toContain('considera só os seus');
    // Quem saiu também aparece nos filtros, e a fila de atenção mostra a carteira que ficou com a pessoa escolhida.
    expect(answer('Por que um nome aparece com “(desativado)”?')).toContain(
      'Nos filtros de responsável, como os de “Hoje”, “Atividades”, “Agenda” e “Relatórios”, ela aparece por último',
    );
    expect(answer('Ficaram contatos com uma pessoa desativada. Como passo para outra?')).toContain(
      'com “Toda a organização” ou com a própria pessoa escolhida no seletor',
    );
  });

  it('os ganhos por responsável: data de fechamento, filtros, quem saiu e o que não é dinheiro recebido', () => {
    const text = answer('Como vejo quanto cada pessoa ganhou no período?');
    expect(text).toContain('o painel “Ganhos por responsável” soma, por pessoa, as oportunidades ganhas no período');
    expect(text).toContain('pela data de fechamento');
    expect(text).toContain('respeita o funil e o responsável escolhidos nos filtros');
    expect(text).toContain('quem saiu da equipe vem depois, com “(desativado)”');
    expect(text).toContain('Perdidas e em aberto não contam');
    expect(text).toContain('e não o dinheiro recebido, que fica em “Financeiro”');
    for (const query of ['vendas por vendedor', 'ganhos por responsável', 'ranking'])
      expect(questionsFound(query), query).toContain('Como vejo quanto cada pessoa ganhou no período?');
  });

  it('a origem: a lista, “Outra”, o valor antigo, a importação e o filtro de Contatos', () => {
    const text = answer('Quais origens um contato pode ter e como filtro por origem?');
    expect(text).toContain('a “Origem” é uma lista: WhatsApp, Telefone, E-mail, Site e Indicação');
    expect(text).toContain('escolha “Outra” e escreva');
    // Revisão do item 1.14: só a origem fora da lista abre em "Outra"; um nome da lista escrito de outro jeito aparece e
    // é gravado com o nome da lista (leadSourceChoice e leadSourceLabel).
    expect(text).toContain(
      'Uma origem fora da lista, escrita antes ou vinda de uma planilha, continua como está e abre em “Outra”',
    );
    expect(text).toContain(
      'Já um nome da lista escrito sem acento, em minúsculas ou como zap aparece com o nome da lista e é gravado assim ao salvar o cadastro e na importação',
    );
    expect(text).not.toContain('Uma origem escrita antes da lista');
    expect(text).toContain('“Outras origens”, com as que estão fora da lista, e “Sem origem”');
    expect(text).toContain('Donos, administradores e colaboradores editam a origem');
    expect(answer('Onde corrijo o cargo, a origem ou as observações de um contato?')).toContain(
      'A origem é escolhida numa lista, com “Outra” para escrever uma origem que não está nela',
    );
    for (const query of ['origem do lead', 'filtrar origem', 'indicação', 'instagram'])
      expect(questionsFound(query), query).toContain('Quais origens um contato pode ter e como filtro por origem?');
  });
});

// Item 1.16: o catálogo, os itens da oportunidade, qual valor conta onde e a importação do catálogo.
describe('Ajuda: catálogo e itens da oportunidade (item 1.16)', () => {
  it('cada pergunta nova fica na categoria do assunto', () => {
    expect(categoryOf('Como cadastro o catálogo de produtos e serviços?')).toBe('primeiros-passos');
    expect(categoryOf('Como importo o catálogo por planilha?')).toBe('planilhas');
    for (const question of [
      'Como adiciono produtos e serviços a uma oportunidade?',
      'Como o valor da oportunidade é calculado pelos itens?',
      'Como funciona o desconto por item?',
    ])
      expect(categoryOf(question), question).toBe('pipeline');
    expect(categoryOf('Qual valor os relatórios e a previsão usam?')).toBe('financeiro');
    expect(categoryOf('Como exporto os itens das oportunidades?')).toBe('financeiro');
  });

  it('o catálogo é de donos e administradores; os itens, de quem edita oportunidades', () => {
    const catalog = answer('Como cadastro o catálogo de produtos e serviços?');
    expect(catalog).toContain('donos e administradores usam “Novo item”');
    expect(catalog).toContain('Excluir só vale para o item nunca usado');
    expect(catalog).toContain('Colaboradores e “Somente leitura” consultam o catálogo');
    expect(answer('Como adiciono produtos e serviços a uma oportunidade?')).toContain(
      'Donos, administradores e colaboradores editam os itens; quem tem “Somente leitura” vê os itens e os totais',
    );
    expect(answer('O que cada papel pode fazer?')).toContain('os funis, o catálogo, a fila de atenção');
  });

  it('o cálculo, os meses obrigatórios com mensalidade e o valor manual sem itens', () => {
    const value = answer('Como o valor da oportunidade é calculado pelos itens?');
    expect(value).toContain('arredondado em centavos');
    expect(value).toContain('de 1 a 120, que são obrigatórios quando há item mensal');
    expect(value).toContain('Sem itens, o valor é o digitado');
    expect(value).toContain('o último valor calculado fica e volta a ser editável');
    expect(answer('Como funciona o desconto por item?')).toContain('O CRM não tem desconto no total da oportunidade');
  });

  it('qual valor conta onde, sem chamar de dinheiro recebido, e a planilha dos itens', () => {
    const used = answer('Qual valor os relatórios e a previsão usam?');
    expect(used).toContain('com itens, o valor do contrato');
    expect(used).toContain('“Mensalidades ganhas”');
    expect(used).toContain('o ganho já inclui essa mensalidade multiplicada pelos meses de cada contrato');
    expect(answer('Como vejo quanto cada pessoa ganhou no período?')).toContain(
      'a mensalidade por mês, que entra no valor multiplicada pelos meses',
    );
    expect(used).toContain('Nada disso é dinheiro recebido');
    expect(answer('O valor das oportunidades é dinheiro recebido?')).toContain('com itens, o valor do contrato');
    expect(answer('De onde vem a probabilidade de uma oportunidade?')).toContain('valor (com itens, o do contrato)');
    expect(answer('Como exporto os itens das oportunidades?')).toContain('“Itens das oportunidades”');
    expect(answer('O que acontece se um colega alterar o mesmo registro que eu?')).toContain(
      'oportunidades (com os itens), atividades, lançamentos, modelos, automações, funis, etapas, regras da fila e itens do catálogo',
    );
    expect(answer('Como exporto contatos, reuniões ou relatórios?')).toContain('do recorte e os itens delas');
  });

  it('a importação do catálogo não muda os itens existentes, e a privacidade cobre os itens', () => {
    const imported = answer('Como importo o catálogo por planilha?');
    expect(imported).toContain('A importação não muda nem reativa os itens que já existem');
    expect(imported).toContain('“Baixar itens não importados”');
    expect(imported).toContain('ou de outra linha da planilha; sem código, com o mesmo nome');
    expect(answer('Uma pessoa pediu os dados dela. Como atendo?')).toContain('dos itens delas');
    expect(answer('Uma pessoa pediu para apagar os dados dela. Como faço?')).toContain(
      'nos títulos de oportunidades, itens, recebimentos e outros registros',
    );
  });

  it.each([
    ['catalogo', 'Como cadastro o catálogo de produtos e serviços?'],
    ['desconto', 'Como funciona o desconto por item?'],
    ['mensalidade', 'Como o valor da oportunidade é calculado pelos itens?'],
    ['sku', 'Como importo o catálogo por planilha?'],
  ])('a busca por "%s" encontra “%s”', (query, question) => {
    expect(questionsFound(query)).toContain(question);
  });
});

// Item 1.15: os dados de demonstração e os achados 2 e 4 da revisão do 1.16 (a importação do catálogo parada e o nome do
// botão da exportação).
describe('Ajuda: dados de demonstração e achados do item 1.16 (item 1.15)', () => {
  it('explica os dados de demonstração sem prometer o que a tela não faz', () => {
    expect(categoryOf('O que são os dados de demonstração?')).toBe('primeiros-passos');
    const demo = answer('O que são os dados de demonstração?');
    expect(demo).toContain('gravados por quem publicou o CRM');
    expect(demo).toContain('example.test');
    expect(demo).toContain('(11) 90000-0001');
    expect(demo).toContain('não envie mensagens a eles');
    expect(demo).toContain('nunca entram num CRM que já tem dados');
    expect(demo).toContain('Cada registro fictício pode ser editado ou excluído na tela');
    expect(demo).toContain('Apagar toda a demonstração de uma vez é com quem publicou o CRM');
    expect(demo).not.toContain('só quem publicou o CRM os apaga');
    expect(demo).toContain('saem também as atividades e os recebimentos registrados nos fictícios');
    expect(demo).toContain('Se algo da equipe estiver ligado a um fictício, a remoção para');
    expect(demo).not.toContain('Os registros criados pela equipe ficam');
    expect(demo).not.toMatch(/seed|SQL|supabase/i);
    for (const query of ['demonstração', 'dados fictícios', 'apagar demonstração', 'aula'])
      expect(questionsFound(query), query).toContain('O que são os dados de demonstração?');
  });

  it('a importação do catálogo parada tem resposta própria, e as de contatos dizem que são de contatos', () => {
    expect(categoryOf('A importação do catálogo parou. O que faço?')).toBe('planilhas');
    const stopped = answer('A importação do catálogo parou. O que faço?');
    expect(stopped).toContain('“Parar” termina a parte em andamento e mostra quantos itens já foram gravados');
    expect(stopped).toContain('“Continuar importação”');
    expect(stopped).toContain('“Baixar itens não importados”');
    expect(stopped).toContain('pelo código ou, sem código, pelo nome');
    expect(stopped).not.toMatch(/contato/);
    expect(questionsFound('parou')).toEqual(
      expect.arrayContaining([
        'A importação de contatos parou no meio. O que faço?',
        'A importação de contatos parou com um código de erro. O que faço?',
        'A importação do catálogo parou. O que faço?',
      ]),
    );
    expect(questionsFound('continuar catálogo')).toContain('A importação do catálogo parou. O que faço?');
  });

  it('a exportação dos itens cita o botão pelo nome da tela', () => {
    const exported = answer('Como exporto os itens das oportunidades?');
    expect(exported).toContain('abra “Exportar CSV” (no celular, o botão mostra só CSV)');
    expect(exported).not.toContain('botão CSV');
  });
});

// Item 1.13 (docs/arquitetura/1.13.md, seção 10): a recusa de uma regra própria da empresa ao salvar e quem personaliza
// o CRM, sem prometer tela para criar ou mudar essas regras.
describe('Ajuda: regras próprias da empresa e personalização (item 1.13)', () => {
  const RULE = 'Apareceu uma mensagem que não reconheço ao salvar. O que é?';
  const CUSTOMIZE = 'Dá para personalizar este CRM sem perder as atualizações?';
  const IMPORT_RULE = 'A importação de contatos parou com uma regra da empresa. O que faço?';

  it('a mensagem de uma regra da empresa: não grava, o preenchimento fica e quem procurar', () => {
    const text = answer(RULE);
    expect(text).toContain('Pode ser uma regra própria da sua empresa, acrescentada por quem publicou o CRM');
    expect(text).toContain('O CRM mostra a mensagem dessa regra e não grava a alteração.');
    expect(text).toContain('Nos formulários, o que você preencheu continua na tela');
    expect(text).toContain('no “Pipeline”, a oportunidade volta para a etapa em que estava');
    expect(text).toContain('Se a regra parecer errada, fale com quem publicou o CRM.');
    expect(text).toContain('Na importação de planilha, a regra recusa a parte inteira que estava sendo gravada.');
  });

  // Revisão do item 1.13: na importação, a regra recusa o lote inteiro, sem dizer a linha, e continuar sem corrigir
  // repete a recusa.
  it('a regra da empresa na importação: o lote inteiro, sem a linha, e o que fazer', () => {
    const text = answer(IMPORT_RULE);
    expect(text).toContain(
      'a linha recusada impede a gravação da parte inteira em andamento, sem dizer qual linha foi',
    );
    expect(text).toContain('as partes anteriores continuam gravadas');
    expect(text).toContain('“Continuar importação” sem corrigir dá a mesma recusa');
    // Revisão do item 1.13 (rodada 2): a mesma orientação da janela (a planilha dos que faltam), e o aviso de que a
    // planilha inteira de novo duplica os contatos sem e-mail e sem telefone.
    expect(text).toContain('Use “Baixar contatos não importados”: o arquivo traz só os contatos que faltam.');
    expect(text).toContain('Corrija nele o que a mensagem pede, em todas as linhas, e importe esse arquivo.');
    expect(text).toContain('os já gravados sem e-mail e sem telefone entrariam de novo, duplicados');
    expect(text).not.toContain('feche a janela e escolha o arquivo de novo');
    expect(questionsFound('importação regra')).toContain(IMPORT_RULE);
  });

  it('a personalização é de quem publicou, pelo guia, e nenhuma tela muda as regras', () => {
    const text = answer(CUSTOMIZE);
    expect(text).toContain('uma conferência que mostra, antes de cada atualização');
    expect(text).not.toContain('conferidor');
    expect(text).toContain(
      'Quem publicou segue o guia Personalizar sem quebrar a atualização, em docs/PROTECAO-ATUALIZACAO.md',
    );
    expect(text).toContain('Nenhuma tela do CRM cria ou muda essas regras');
    // O guia citado existe e tem esse título.
    expect(readFileSync('docs/PROTECAO-ATUALIZACAO.md', 'utf8')).toMatch(/^# Personalizar sem quebrar a atualização/);
  });

  it('a busca acha as duas por "regra" e "atualização"', () => {
    expect(questionsFound('regra')).toContain(RULE);
    expect(questionsFound('atualização')).toContain(CUSTOMIZE);
    expect(questionsFound('mensagem ao salvar')).toContain(RULE);
    expect(questionsFound('personalizar')).toContain(CUSTOMIZE);
  });
});
