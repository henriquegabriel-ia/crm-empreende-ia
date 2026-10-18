import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ds/dialog';
import { contactName, type Contact } from '@/lib/contact-model';
import { ANONYMIZE_CONFIRMATION_WORD, isAnonymizeConfirmation } from '@/lib/privacy';
import { anonymizedSummary, removedLines } from './anonymization-text';
import {
  anonymizationVersionChanged,
  anonymizeContact,
  invalidateAfterAnonymization,
  privacyErrorMessage,
  usePrivacySummary,
} from './data';

interface Props {
  contact: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'email' | 'phone'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Anonimizar contato" (item 1.10; docs/arquitetura/1.10.md, seção 5.4): o pedido de exclusão do titular, sem volta. O
 * resumo (`contact_privacy_summary`) mostra o que sai e o que fica, com as contagens, e traz a versão do contato; o
 * botão só se habilita com o resumo carregado e a palavra ANONIMIZAR digitada, e `anonymize_contact` confere a versão.
 * Com o contato mudado desde o resumo, a recusa recarrega o resumo e limpa a palavra (as contagens podem ter mudado).
 */
export function AnonymizeContactDialog({ contact, open, onOpenChange }: Props) {
  const cache = useQueryClient();
  const summary = usePrivacySummary(contact.id, open);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wordId = useId();
  const hintId = useId();
  const errorId = useId();
  const name = contactName(contact);
  const counts = summary.data;
  const ready = !!counts && !summary.isFetching;
  const confirmed = isAnonymizeConfirmation(word);

  function close() {
    if (busy) return;
    setWord('');
    setError('');
    onOpenChange(false);
  }

  async function confirm() {
    if (busy || !counts || !confirmed) return;
    setBusy(true);
    setError('');
    try {
      // As contagens devolvidas podem ser maiores que as do resumo (o que foi ligado à pessoa depois dele também entrou).
      const done = await anonymizeContact(contact.id, counts.version);
      await invalidateAfterAnonymization(cache);
      toast.success('Contato anonimizado', { description: anonymizedSummary(done) });
      setWord('');
      onOpenChange(false);
    } catch (cause) {
      setError(privacyErrorMessage(cause, 'Não foi possível anonimizar o contato. Tente novamente.'));
      if (anonymizationVersionChanged(cause)) {
        setWord('');
        await summary.refetch();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Anonimizar este contato?</DialogTitle>
          <DialogDescription>
            Os dados pessoais de {name} saem do cadastro e dos registros ligados à pessoa; o histórico comercial fica
            sem nomes.
          </DialogDescription>
        </DialogHeader>
        {summary.isPending || (summary.isFetching && !counts) ? (
          <p role="status" className="text-sm text-muted-foreground">
            Conferindo o que será apagado…
          </p>
        ) : summary.isError && !counts ? (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-destructive">
              {privacyErrorMessage(summary.error, 'Não foi possível conferir o que será apagado.')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="eia-touch-target"
              onClick={() => void summary.refetch()}
            >
              Conferir de novo
            </Button>
          </div>
        ) : (
          counts && (
            <div className="space-y-4 text-sm" aria-busy={summary.isFetching || undefined}>
              {summary.isFetching && (
                <p role="status" className="text-muted-foreground">
                  Conferindo o que será apagado…
                </p>
              )}
              <div>
                <h3 className="font-medium">O que sai</h3>
                <ul aria-label="O que sai" className="mt-1 list-disc space-y-1 pl-5">
                  {removedLines(counts).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-medium">O que fica</h3>
                <p className="mt-1 text-muted-foreground">
                  Valores, situações, etapas, datas e responsáveis ficam, e os relatórios mantêm os números. O contato
                  continua na lista como “Contato anonimizado”, marcado “Não contatar”.
                </p>
              </div>
              <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
                {counts.open_deals > 0 && (
                  <p>
                    {counts.open_deals === 1
                      ? '1 oportunidade continua em aberto, sem o contato. Encerre-a antes, se a negociação acabou.'
                      : `${counts.open_deals} oportunidades continuam em aberto, sem o contato. Encerre-as antes, se a negociação acabou.`}
                  </p>
                )}
                {counts.pending_payments > 0 && (
                  <p>
                    {counts.pending_payments === 1
                      ? '1 recebimento pendente continua no Financeiro, sem o contato.'
                      : `${counts.pending_payments} recebimentos pendentes continuam no Financeiro, sem o contato.`}
                  </p>
                )}
                <p>
                  Apelidos, CPF, um telefone que não está no cadastro e outros dados digitados nos títulos não são
                  reconhecidos: revise as oportunidades e os recebimentos antes. Cópias de segurança e arquivos já
                  exportados não são alterados.
                </p>
                <p>
                  Para só parar de procurar a pessoa, use “Marcar como não contatar”: depois de anonimizar, o CRM não
                  reconhece a pessoa se ela for cadastrada de novo.
                </p>
              </div>
            </div>
          )
        )}
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">Esta ação não pode ser desfeita.</p>
          <Label htmlFor={wordId}>Digite {ANONYMIZE_CONFIRMATION_WORD} para confirmar</Label>
          <Input
            id={wordId}
            className="eia-touch-target"
            value={word}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            aria-describedby={hintId}
            onChange={(event) => setWord(event.target.value)}
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            O botão só fica disponível com a palavra digitada e o resumo conferido.
          </p>
        </div>
        {error && (
          <p id={errorId} role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" className="eia-touch-target" disabled={busy} onClick={close}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="eia-touch-target"
            disabled={busy || !ready || !confirmed}
            aria-describedby={error ? `${errorId} ${hintId}` : hintId}
            onClick={() => void confirm()}
          >
            {busy ? 'Anonimizando…' : 'Anonimizar contato'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
