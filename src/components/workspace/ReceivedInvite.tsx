import { useId, useState } from 'react';
import { ChevronDown, Ticket } from 'lucide-react';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Label } from '@/components/ui/label';
import { parseInviteLink } from '@/lib/invite-link';
import { cn } from '@/lib/utils';

// Nome citado no e-mail "Invite user" do Auth (scripts/lib/auth-emails.mjs, conferido no teste).
const LABEL = 'Recebi um convite';

interface ReceivedInviteProps {
  /** Recebe o ID do convite lido do link colado. */
  onInvite: (invitationId: string) => void;
  /** Aberto ou fechado por quem usa o componente; sem `open`, o próprio componente guarda o estado. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * "Recebi um convite": para quem recebeu o link do convite e chegou à tela de entrada (ou já entrou) por outro caminho.
 * Aceita o link inteiro ou só o ID; o mesmo componente aparece na entrada e na conta sem organização.
 */
export function ReceivedInvite({ onInvite, open, onOpenChange, defaultOpen = false, className }: ReceivedInviteProps) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const id = useId();
  const expanded = open ?? ownOpen;
  const toggle = () => {
    if (open === undefined) setOwnOpen(!expanded);
    onOpenChange?.(!expanded);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = parseInviteLink(link);
    if ('message' in result) {
      setError(result.message);
      return;
    }
    setError('');
    onInvite(result.id);
  };
  return (
    <section className={cn('rounded-xl border border-border p-4', className)}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`${id}-panel`}
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 rounded-lg text-left text-sm font-medium text-foreground transition-colors hover:text-primary"
      >
        <span className="flex items-center gap-2">
          <Ticket className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          {LABEL}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform', expanded && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <form id={`${id}-panel`} onSubmit={submit} noValidate className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Cole o link que quem administra o CRM enviou a você. Ele termina com{' '}
            <span className="whitespace-nowrap">“?invite=”</span> e um código.
          </p>
          <div className="space-y-2">
            <Label htmlFor={`${id}-link`}>Link do convite</Label>
            <Input
              id={`${id}-link`}
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://…/?invite=…"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
            />
          </div>
          {error && (
            <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" variant="outline" className="w-full">
            Abrir convite
          </Button>
        </form>
      )}
    </section>
  );
}
