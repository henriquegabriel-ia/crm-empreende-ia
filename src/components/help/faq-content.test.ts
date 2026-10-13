import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CRM_ROLE_LABELS } from '@/lib/roles';
import { quotedLabels, showsLabel } from '@/test/ui-labels';
import { FAQ_CATEGORIES, normalizeHelpText, searchFaq } from './faq-content';

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

  it('cada assunto fica na categoria certa', () => {
    expect(categoryOf('Como uma pessoa nova entra na equipe?')).toBe('acesso');
    expect(categoryOf('Como copio, renovo ou cancelo um convite?')).toBe('acesso');
    expect(categoryOf('Como desativo quem saiu da equipe e passo a carteira?')).toBe('acesso');
    expect(categoryOf('Como reativo uma pessoa desativada?')).toBe('acesso');
    expect(categoryOf('Apareceu “Seu acesso foi encerrado”. E agora?')).toBe('acesso');
    expect(categoryOf('Como mudo as preferências dos tours?')).toBe('primeiros-passos');
    expect(categoryOf('Que e-mails o CRM envia?')).toBe('acesso');
    expect(categoryOf('Esqueci minha senha. O que faço?')).toBe('acesso');
    expect(categoryOf('O que cada papel pode fazer?')).toBe('primeiros-passos');
    expect(categoryOf('Como importo contatos de uma planilha?')).toBe('planilhas');
    expect(categoryOf('Como exporto contatos, reuniões ou relatórios?')).toBe('planilhas');
    expect(categoryOf('Como digito valores em reais?')).toBe('pipeline');
    expect(categoryOf('Como crio um funil ou mudo as etapas?')).toBe('pipeline');
    expect(categoryOf('Em que período uma venda ganha aparece nos “Relatórios”?')).toBe('financeiro');
    expect(categoryOf('O que acontece se a internet cair?')).toBe('conexao');
    expect(categoryOf('O que acontece se um colega alterar o mesmo registro que eu?')).toBe('conexao');
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
  ],
  'src/components/layout/RequireRole.tsx': ['Ir para Hoje'],
  'src/pages/Dashboard.tsx': [
    'Hoje',
    'Fila de atenção',
    'Abrir ficha e resolver',
    'Ver contatos sem próxima ação',
    'Ver na Equipe',
    'Minha rotina',
    'Toda a organização',
  ],
  'src/components/commercial/DirectoryPage.tsx': [
    'Visões salvas',
    'Salvar visão atual',
    'Limpar filtros',
    'Tentar novamente',
  ],
  'src/components/commercial/Relationship360.tsx': ['Próxima ação', 'Excluir cadastro'],
  'src/components/commercial/RecordEditor.tsx': ['Responsável'],
  'src/pages/Integrations.tsx': [
    'Integrações',
    'Baixar modelo CSV',
    'Confirmar importação',
    'Exportar contatos',
    'Exportar reuniões',
  ],
  'src/pages/Reports.tsx': ['Relatórios'],
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
    'Da etapa',
    'Probabilidade (%)',
    'Fechada em',
    'Previsão de fechamento',
  ],
  'src/components/pipeline/DealDeleteDialog.tsx': ['Desvincular e excluir'],
  'src/components/foundation/MoneyPreview.tsx': ['Prévia', 'Formato não reconhecido'],
  'src/components/workday/ActivityDetail.tsx': ['Editar / reagendar', 'Concluir', 'Reabrir'],
  'src/components/workday/ActivityDialog.tsx': ['Responsável'],
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
    // entra nem recebe a redefinição; o caminho é avisar quem administra, que corta o acesso com “Desativar”.
    expect(notices).toContain('com “Confirme a troca de e-mail”, não abra o link e redefina a senha');
    const changed = notices.slice(notices.indexOf('com “Seu e-mail de acesso mudou”'));
    expect(changed).toContain('a troca já aconteceu, e a conta não entra mais pelo seu e-mail');
    expect(changed).not.toContain('Esqueceu a senha');
    expect(changed).toContain('donos e administradores usam “Desativar” na conta, em “Equipe”');
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
      'Donos, administradores e colaboradores podem importar',
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

  it('“organização” é só a empresa dona do CRM, e não um cliente de Empresas', () => {
    expect(answer('Qual é a diferença entre contato, empresa e oportunidade?')).not.toMatch(/organização/);
  });

  it('a próxima ação é qualquer atividade pendente com prazo que não seja nota, como em useCrmOnboarding', () => {
    for (const question of ['Terminar um tour conclui a configuração?', 'Como registro a próxima ação?']) {
      expect(answer(question), question).toContain('tarefa, ligação, e-mail ou reunião');
      expect(answer(question), question).not.toMatch(/com prazo e responsável/);
    }
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
