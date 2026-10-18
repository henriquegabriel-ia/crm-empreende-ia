import { useId } from 'react';
import { Button } from '@/components/ds/button';
import type { InteractionChannel } from '@/lib/interactions';
import { useInteractionPrompt } from './interaction-context';

const OPENED_LABEL: Record<InteractionChannel, string> = {
  call: 'Ligação aberta',
  whatsapp: 'WhatsApp aberto',
  email: 'E-mail aberto',
};
const time = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/**
 * As pendências de um alvo dentro do painel de onde a pessoa partiu (ficha 360, oportunidade, detalhe da atividade):
 * os painéis são diálogos modais, e a faixa do rodapé fica inerte enquanto estão abertos (item 1.9).
 */
export function PendingInteractionsInline({ keys }: { keys: readonly string[] }) {
  const prompt = useInteractionPrompt();
  const titleId = useId();
  const items = prompt.pending.filter((item) => keys.includes(item.key));
  if (!prompt.enabled || !items.length) return null;
  // O título visível "Para registrar" (achado 10 da revisão do item 1.9): a Ajuda cita a lista por esse nome. Um div, e
  // não uma região: a faixa do rodapé já é a região "Para registrar".
  return (
    <div className="space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3">
      <h3 id={titleId} className="text-xs font-semibold">
        Para registrar
      </h3>
      <ul aria-labelledby={titleId} className="space-y-2">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {OPENED_LABEL[item.channel]} às <time dateTime={item.openedAt}>{time(item.openedAt)}</time>
            </span>
            <span className="flex gap-1">
              <Button
                size="sm"
                className="eia-touch-target"
                onClick={() => prompt.openDialog({ mode: item.activityId ? 'complete' : 'register', pending: item })}
              >
                Registrar
              </Button>
              <Button size="sm" variant="ghost" className="eia-touch-target" onClick={() => prompt.dismiss(item.key)}>
                Agora não
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
