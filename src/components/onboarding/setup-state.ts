export type SetupStepId = 'identity' | 'pipeline' | 'privacy' | 'contact' | 'opportunity' | 'activity';
export type SetupStatus = 'done' | 'pending' | 'error';
export interface SetupStep {
  id: SetupStepId;
  title: string;
  description: string;
  path: string;
  action: string;
  admin?: boolean;
  /** Etapa de donos e administradores: o que o guia diz a quem não pode configurá-la. */
  adminNotice?: string;
}
export interface SetupEvidence {
  identity: SetupStatus;
  pipeline: SetupStatus;
  privacy: SetupStatus;
  contact: SetupStatus;
  opportunity: SetupStatus;
  activity: SetupStatus;
}

export const SETUP_STEPS: SetupStep[] = [
  {
    id: 'identity',
    title: 'Identifique sua organização e seu perfil',
    description:
      'Confira o nome da organização e o nome que identifica você na equipe. Donos e administradores convidam a equipe em “Equipe”.',
    path: '/settings?tab=organization',
    action: 'Abrir dados da organização',
  },
  {
    id: 'pipeline',
    title: 'Prepare seu processo comercial',
    // A empresa nasce com o funil Comercial, quatro etapas e as regras da fila (private.provision_organization).
    description:
      'A empresa já começa com o funil Comercial e quatro etapas. Em “Configurações”, na aba “Funis”, ajuste nomes, ordem e probabilidades ao caminho real de uma negociação.',
    path: '/settings?tab=pipelines',
    action: 'Configurar funis',
    admin: true,
    adminNotice:
      'Funis e etapas são configurados por donos e administradores. Você pode continuar pelas demais etapas.',
  },
  {
    id: 'privacy',
    title: 'Defina a base legal dos contatos',
    // Item 1.10: antes do primeiro contato, porque o padrão vale para os contatos que vierem depois. Verificada quando o
    // padrão da empresa deixa de ser "Não informada" (useCrmOnboarding).
    description:
      'Em “Configurações”, na aba “Organização”, escolha a base legal padrão dos contatos novos, como legítimo interesse ou contrato. Confira a escolha com quem cuida do jurídico da empresa. Peça a quem implantou o CRM os modelos de aviso de privacidade e de termo, que precisam de revisão jurídica.',
    path: '/settings?tab=organization',
    action: 'Escolher a base legal',
    admin: true,
    adminNotice:
      'A base legal padrão é escolhida por donos e administradores. Você pode continuar pelas demais etapas.',
  },
  {
    id: 'contact',
    title: 'Cadastre seu primeiro contato',
    description:
      'Registre uma pessoa com quem sua equipe se relaciona, ou importe uma planilha em “Integrações”, e confira os dados antes de salvar.',
    path: '/contacts',
    action: 'Abrir contatos',
  },
  {
    id: 'opportunity',
    title: 'Registre uma oportunidade',
    description: 'Associe uma negociação ao seu funil para acompanhar responsável, valor e etapa.',
    path: '/pipeline',
    action: 'Abrir oportunidades',
  },
  {
    id: 'activity',
    title: 'Combine uma próxima ação',
    // O mesmo critério da próxima ação (useCrmOnboarding): pendente, com prazo e que não seja nota, de qualquer tipo
    // (tarefa, ligação, WhatsApp, e-mail, reunião ou visita, desde o item 1.9). O responsável é recomendado, mas não
    // conta para a etapa.
    description:
      'Registre uma atividade pendente, com prazo: tarefa, ligação, WhatsApp, e-mail, reunião ou visita. Notas e atividades sem prazo não contam como próxima ação. Defina também o responsável, para ninguém perder o retorno.',
    path: '/tasks',
    action: 'Abrir tarefas',
  },
];

export function emptySetupEvidence(): SetupEvidence {
  return {
    identity: 'pending',
    pipeline: 'pending',
    privacy: 'pending',
    contact: 'pending',
    opportunity: 'pending',
    activity: 'pending',
  };
}

export function setupGuideKey(orgId: string, userId: string): string {
  return `empreende-crm:setup-guide:v1:${encodeURIComponent(orgId)}:${encodeURIComponent(userId)}`;
}

/** Only guide position is local; completion always comes from current CRM records. */
export function parseGuideStep(value: string | null): SetupStepId | null {
  if (!value) return null;
  try {
    const item = JSON.parse(value);
    return item?.version === 1 && SETUP_STEPS.some((step) => step.id === item.stepId) ? item.stepId : null;
  } catch {
    return null;
  }
}

export function nextSetupStep(evidence: SetupEvidence): SetupStepId {
  return SETUP_STEPS.find((step) => evidence[step.id] !== 'done')?.id ?? SETUP_STEPS[0].id;
}
