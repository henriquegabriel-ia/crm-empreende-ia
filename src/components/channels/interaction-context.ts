import { createContext, useContext } from 'react';
import type { CrmRow } from '@/integrations/supabase/commercial-types';
import { pendingKey, type InteractionTarget, type PendingInteraction } from '@/lib/interactions';

/**
 * A atividade que o registro conclui ou da qual parte a próxima ação: o que o diálogo usa dela. O Pipeline lê só estas
 * colunas nas próximas ações das oportunidades.
 */
export type ActivityRef = Pick<
  CrmRow<'activities'>,
  'id' | 'type' | 'title' | 'updated_at' | 'completed_at' | 'contact_id' | 'company_id' | 'deal_id' | 'user_id'
> & { outcome?: string | null };

/** O que o diálogo do registro faz (docs/arquitetura/1.9.md, seção 6.3). */
export type InteractionMode = 'register' | 'complete' | 'schedule';

export interface InteractionRequest {
  /**
   * register: interação nova (ou a conclusão da atividade pendente sugerida); complete: conclui a atividade por
   * complete_activity; schedule: só a próxima ação, depois de um "Concluir" simples.
   */
  mode: InteractionMode;
  /** A pendência de um canal aberto (ou a de "Registrar ligação"), com os ids gerados para a gravação. */
  pending?: PendingInteraction;
  /** A atividade a concluir (complete) ou já concluída (schedule). */
  activity?: ActivityRef;
  /** "Concluir e agendar a próxima": a próxima ação é obrigatória. */
  requireNext?: boolean;
}

export interface InteractionPromptValue {
  /** Só quem edita recebe pendências e registra (Somente leitura abre os canais e copia). */
  enabled: boolean;
  pending: PendingInteraction[];
  /** Cria ou renova a pendência do alvo; o assunto do e-mail fica só em memória, para o título do registro. */
  track: (target: InteractionTarget, subject?: string) => void;
  /** A pendência do alvo, se existir, ou uma nova, sem guardar (para "Registrar ligação"). */
  pendingFor: (target: InteractionTarget) => PendingInteraction;
  /** "Agora não", ou o registro gravado. */
  dismiss: (key: string) => void;
  /** O assunto do e-mail aberto por esta pendência, se a aba ainda o tem. */
  subjectOf: (key: string) => string | undefined;
  openDialog: (request: InteractionRequest) => void;
}

const newId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.floor(Math.random() * 256) & (15 >> (Number(c) / 4)))).toString(16),
      );
export const newInteractionId = newId;

/** Fora do provedor (testes de componente isolado), os canais abrem, e nada é guardado nem registrado. */
const DISABLED: InteractionPromptValue = {
  enabled: false,
  pending: [],
  track: () => undefined,
  pendingFor: (target) => ({
    key: pendingKey(target),
    id: newId(),
    nextId: newId(),
    channel: target.channel,
    contactId: target.contactId ?? null,
    companyId: target.companyId ?? null,
    dealId: target.dealId ?? null,
    activityId: target.activityId ?? null,
    openedAt: new Date().toISOString(),
  }),
  dismiss: () => undefined,
  subjectOf: () => undefined,
  openDialog: () => undefined,
};

export const InteractionPromptContext = createContext<InteractionPromptValue | null>(null);
export const useInteractionPrompt = () => useContext(InteractionPromptContext) ?? DISABLED;
