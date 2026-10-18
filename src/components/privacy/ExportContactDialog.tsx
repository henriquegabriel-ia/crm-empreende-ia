import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ds/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ds/dialog';
import { contactName, type Contact } from '@/lib/contact-model';
import { downloadContactExport, invalidateAfterExport, privacyErrorMessage } from './data';

interface Props {
  contact: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'email' | 'phone'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Exportar dados deste contato" (item 1.10; docs/arquitetura/1.10.md, seção 5.3): o pedido de acesso do titular. A
 * confirmação diz o que vai no arquivo e o cuidado antes de enviar; `export_contact_data` lê os dados e registra a
 * exportação na mesma transação, e o navegador monta o .zip com o nome da marca, sem o nome da pessoa. Só donos e
 * administradores chegam aqui (a seção "Privacidade" da ficha), e o banco recusa os demais.
 */
export function ExportContactDialog({ contact, open, onOpenChange }: Props) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorId = useId();
  const name = contactName(contact);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await downloadContactExport(contact.id);
      await invalidateAfterExport(cache);
      toast.success('Dados exportados. Revise o arquivo antes de enviar.');
      onOpenChange(false);
    } catch (cause) {
      setError(privacyErrorMessage(cause, 'Não foi possível exportar os dados. Tente novamente.'));
      // A leitura pode ter sido registrada antes da falha (a RPC grava na mesma transação): a ficha confere de novo.
      await invalidateAfterExport(cache);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setError('');
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Exportar os dados de {name}?</DialogTitle>
          <DialogDescription>
            O CRM gera um arquivo .zip com o cadastro, as atividades, as oportunidades e os recebimentos da pessoa,
            inclusive os das oportunidades dela, e registra que você exportou. Nos registros ligados a outros contatos,
            o nome, o e-mail e o telefone gravados no cadastro deles viram [anonimizado]. Os nomes da equipe não vão no
            arquivo.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
          Antes de enviar, revise: anotações internas podem ter segredo comercial ou dados de outras pessoas que o CRM
          não reconhece, como apelidos ou um telefone que não está no cadastro. Confirme a identidade de quem pediu,
          envie por um canal seguro e apague o arquivo do seu computador depois.
        </p>
        {error && (
          <p id={errorId} role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            className="eia-touch-target"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="eia-touch-target"
            disabled={busy}
            aria-describedby={error ? errorId : undefined}
            onClick={() => void confirm()}
          >
            {busy ? 'Exportando…' : 'Exportar dados'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
