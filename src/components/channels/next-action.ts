import { localDateTime } from '@/lib/contact-model';
import { interactionTitle } from '@/lib/interactions';

/** O rascunho da próxima ação no diálogo do registro (item 1.9). */
export interface NextActionDraft {
  schedule: boolean;
  type: string;
  title: string;
  /** A pessoa mudou o título: trocar o tipo não o reescreve mais. */
  titleEdited: boolean;
  /** datetime-local, no horário deste dispositivo. */
  due: string;
  end: string;
  userId: string;
}

const OTHER_TITLES: Record<string, string> = {
  task: 'Retorno para',
  meeting: 'Reunião com',
  visit: 'Visita a',
};

/** "Ligação para Ana Souza", "WhatsApp para Ana Souza", "Reunião com Ana Souza", "Retorno para Ana Souza"… */
export function nextActionTitle(type: string, name: string) {
  if (type === 'call' || type === 'whatsapp' || type === 'email') return interactionTitle(type, name);
  return `${OTHER_TITLES[type] ?? 'Retorno para'} ${name.trim() || 'contato'}`.slice(0, 200);
}

/** Daqui a `days` dias, às 9h, no formato do campo datetime-local. */
export function shortcutDue(days: number, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 9, 0, 0, 0);
  return localDateTime(date.toISOString());
}

export function initialNextAction({
  schedule,
  type,
  name,
  userId,
}: {
  schedule: boolean;
  type: string;
  name: string;
  userId: string;
}): NextActionDraft {
  const nextType = type && type !== 'note' ? type : 'task';
  const due = shortcutDue(1);
  return {
    schedule,
    type: nextType,
    title: nextActionTitle(nextType, name),
    titleEdited: false,
    due,
    end: localDateTime(new Date(new Date(due).getTime() + 3_600_000).toISOString()),
    userId,
  };
}

const parse = (value: string) => (value ? new Date(value).getTime() : NaN);

/** O que falta na próxima ação, ou null. */
export function nextActionProblem(draft: NextActionDraft): string | null {
  if (!draft.title.trim()) return 'Informe o que precisa acontecer na próxima ação.';
  if (!Number.isFinite(parse(draft.due))) return 'Informe o prazo da próxima ação.';
  if (!draft.userId) return 'Escolha o responsável pela próxima ação.';
  if ((draft.type === 'meeting' || draft.type === 'visit') && !(parse(draft.end) > parse(draft.due)))
    return 'Informe um término posterior ao início da próxima ação.';
  return null;
}

/** Os campos da próxima ação que vão ao banco: prazo e término em ISO; término só em reunião e visita. */
export function nextActionFields(draft: NextActionDraft) {
  const appointment = draft.type === 'meeting' || draft.type === 'visit';
  return {
    type: draft.type,
    title: draft.title.trim(),
    due_date: new Date(draft.due).toISOString(),
    end_date: appointment ? new Date(draft.end).toISOString() : null,
    user_id: draft.userId,
  };
}

/** Os campos da próxima ação no formato do banco, como "Combinar ação" os entrega ao Pipeline. */
export type NextActionRow = ReturnType<typeof nextActionFields>;

/** "amanhã às 09:00", "hoje às 15:30" ou "16/10 às 09:00", para o aviso de sucesso. */
export function dueSummary(iso: string, now = new Date()) {
  const date = new Date(iso);
  const day = (offset: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset).toDateString() === date.toDateString();
  const hour = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
  if (day(0)) return `hoje às ${hour}`;
  if (day(1)) return `amanhã às ${hour}`;
  return `${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date)} às ${hour}`;
}
