import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/hooks/useOrg';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import {
  cleanPending,
  pendingKey,
  pendingStorageKey,
  readPending,
  upsertPending,
  writePending,
  type InteractionChannel,
  type InteractionTarget,
  type PendingInteraction,
} from '@/lib/interactions';
import {
  InteractionPromptContext,
  newInteractionId,
  type InteractionPromptValue,
  type InteractionRequest,
} from './interaction-context';
import { InteractionDialog } from './InteractionDialog';
import { PendingInteractionsDock } from './PendingInteractionsDock';

const sessionStore = () => window.sessionStorage;
/** Uma pendência aberta há menos que isto é anunciada quando a pessoa volta para a aba. */
const ANNOUNCE_WITHIN_MS = 2 * 60 * 1000;
const OPENED_LABEL: Record<InteractionChannel, string> = {
  call: 'Ligação aberta',
  whatsapp: 'WhatsApp aberto',
  email: 'E-mail aberto',
};
const time = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/**
 * Pendências "Para registrar" (item 1.9; docs/arquitetura/1.9.md, seção 6.3), montadas no AppLayout: guarda as
 * pendências da aba (sessionStorage, por organização e pessoa), mostra a faixa no rodapé quando nenhum diálogo está
 * aberto e o diálogo do registro. Só quem edita recebe pendências; Somente leitura abre os canais e copia.
 */
export function InteractionPromptProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const { canWrite } = useCrmPermissions();
  const enabled = canWrite && !!orgId && !!user;
  const storageKey = orgId && user ? pendingStorageKey(orgId, user.id) : null;
  const [pending, setPending] = useState<PendingInteraction[]>([]);
  const [request, setRequest] = useState<InteractionRequest | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // O assunto do e-mail fica só em memória (nunca no armazenamento), para o título do registro.
  const subjects = useRef(new Map<string, string>());

  // Lista da aba, relida ao trocar de organização ou de pessoa; sem permissão de edição, nada é guardado.
  useEffect(() => {
    setPending(enabled && storageKey ? readPending(sessionStore, storageKey, Date.now()) : []);
    setRequest(null);
  }, [enabled, storageKey]);

  const update = useCallback(
    (change: (items: PendingInteraction[]) => PendingInteraction[]) => {
      if (!storageKey) return;
      setPending((current) => {
        const next = change(cleanPending(current, Date.now()));
        writePending(sessionStore, storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  // Ao voltar para a aba (o celular volta do WhatsApp assim), a lista é relida e a pendência recente é anunciada,
  // sem tirar o foco de onde a pessoa está.
  useEffect(() => {
    if (!enabled || !storageKey) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const items = readPending(sessionStore, storageKey, Date.now());
      setPending(items);
      const recent = items.find((item) => Date.now() - Date.parse(item.openedAt) < ANNOUNCE_WITHIN_MS);
      setAnnouncement(
        recent
          ? `${OPENED_LABEL[recent.channel]} às ${time(recent.openedAt)}. Quando terminar, use “Registrar” em “Para registrar”.`
          : '',
      );
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, storageKey]);

  const value = useMemo<InteractionPromptValue>(
    () => ({
      enabled,
      pending,
      track: (target: InteractionTarget, subject?: string) => {
        if (!enabled) return;
        const key = pendingKey(target);
        if (subject?.trim()) subjects.current.set(key, subject.trim());
        update((items) => upsertPending(items, target, new Date(), newInteractionId));
      },
      pendingFor: (target: InteractionTarget) =>
        pending.find((item) => item.key === pendingKey(target)) ??
        upsertPending([], target, new Date(), newInteractionId)[0],
      dismiss: (key: string) => {
        subjects.current.delete(key);
        update((items) => items.filter((item) => item.key !== key));
      },
      subjectOf: (key: string) => subjects.current.get(key),
      openDialog: (next: InteractionRequest) => {
        if (enabled) setRequest(next);
      },
    }),
    [enabled, pending, update],
  );

  return (
    <InteractionPromptContext.Provider value={value}>
      {children}
      {enabled && pending.length > 0 && <PendingInteractionsDock />}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {request && <InteractionDialog key={requestKey(request)} request={request} onClose={() => setRequest(null)} />}
    </InteractionPromptContext.Provider>
  );
}

const requestKey = (request: InteractionRequest) =>
  `${request.mode}:${request.pending?.key ?? ''}:${request.activity?.id ?? ''}`;
