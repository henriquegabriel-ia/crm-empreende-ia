import { useRef, useState } from 'react';
import { Braces } from 'lucide-react';
import { Button } from '@/components/ds/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ds/dropdown-menu';
import { Input } from '@/components/ds/input';
import { Textarea } from '@/components/ds/textarea';
import { Label } from '@/components/ui/label';
import { SidePanel } from '@/components/foundation/SidePanel';
import { ConfirmDialog } from '@/components/foundation/ConfirmDialog';
import type { Template } from '@/lib/operation-logic';
import { MESSAGE_VARIABLES, templateVariables } from '@/lib/message-templates';
import { errorMessage } from './data';
export type TemplateDraft = { name: string; subject: string; body: string };
type VariableField = 'subject' | 'body';

/**
 * "Inserir variável" junto de um campo (achado 11 da revisão do item 1.9): cada botão insere no próprio campo, e o nome
 * acessível diz qual ("Inserir variável no assunto", "Inserir variável no texto"), começando pelo texto visível.
 */
function VariableMenu({
  where,
  disabled,
  onInsert,
  onCloseAutoFocus,
}: {
  where: string;
  disabled: boolean;
  onInsert: (key: string) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled} aria-label={`Inserir variável ${where}`}>
          <Braces aria-hidden />
          Inserir variável
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={onCloseAutoFocus}>
        {MESSAGE_VARIABLES.map((variable) => (
          <DropdownMenuItem key={variable.key} onSelect={() => onInsert(variable.key)}>
            <span className="flex flex-col">
              <span>{variable.label}</span>
              <code className="text-xs text-muted-foreground">{`{{${variable.key}}}`}</code>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TemplateForm({
  template,
  onClose,
  onSave,
}: {
  template?: Template;
  onClose: () => void;
  onSave: (draft: TemplateDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TemplateDraft>({
    name: template?.name ?? '',
    subject: template?.subject ?? '',
    body: template?.body ?? '',
  });
  const [initial] = useState(() => JSON.stringify(draft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const change = (key: keyof TemplateDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  // "Inserir variável" (item 1.9) põe a chave na posição do cursor do campo do botão, assunto ou texto: cada campo guarda
  // a própria seleção, mesmo sem o foco (achado 11 da revisão do item 1.9).
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const element = (field: VariableField) => (field === 'subject' ? subjectRef.current : bodyRef.current);
  const unknown = templateVariables(`${draft.subject}\n${draft.body}`).unknown;
  // O cursor depois da variável inserida: o menu devolve o foco ao campo, e não ao botão, quando fecha.
  const caret = useRef<{ field: VariableField; position: number } | null>(null);
  const insertVariable = (field: VariableField, key: string) => {
    const target = element(field);
    const current = draft[field];
    const token = `{{${key}}}`;
    const start = target?.selectionStart ?? current.length;
    const end = target?.selectionEnd ?? current.length;
    change(field, `${current.slice(0, start)}${token}${current.slice(end)}`);
    caret.current = { field, position: start + token.length };
  };
  const focusField = (event: Event) => {
    if (caret.current === null) return;
    event.preventDefault();
    const { field, position } = caret.current;
    caret.current = null;
    const target = element(field);
    target?.focus();
    target?.setSelectionRange(position, position);
  };

  const close = () => {
    if (busy) return;
    if (initial !== JSON.stringify(draft)) setDiscard(true);
    else onClose();
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!draft.name.trim() || !draft.body.trim()) {
      setError('Preencha o nome e o texto do modelo.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SidePanel
        open
        onOpenChange={(open) => !open && close()}
        title={template ? 'Editar modelo' : 'Novo modelo'}
        description="Guarde um rascunho para reutilizar em suas conversas."
        width="lg"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" form="template-form" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar modelo'}
            </Button>
          </>
        }
      >
        <form id="template-form" onSubmit={save} className="space-y-4" noValidate>
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="template-name">Nome do modelo *</Label>
            <Input
              id="template-name"
              value={draft.name}
              onChange={(event) => change('name', event.target.value)}
              maxLength={120}
              disabled={busy}
              autoFocus
              placeholder="Ex.: Retorno após proposta"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="template-subject">Assunto (opcional)</Label>
              <VariableMenu
                where="no assunto"
                disabled={busy}
                onInsert={(key) => insertVariable('subject', key)}
                onCloseAutoFocus={focusField}
              />
            </div>
            <Input
              id="template-subject"
              ref={subjectRef}
              value={draft.subject}
              onChange={(event) => change('subject', event.target.value)}
              maxLength={180}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="template-body">Texto do rascunho *</Label>
              <VariableMenu
                where="no texto"
                disabled={busy}
                onInsert={(key) => insertVariable('body', key)}
                onCloseAutoFocus={focusField}
              />
            </div>
            <Textarea
              id="template-body"
              ref={bodyRef}
              value={draft.body}
              onChange={(event) => change('body', event.target.value)}
              rows={12}
              maxLength={20000}
              disabled={busy}
              placeholder="Escreva o texto que sua equipe poderá revisar e reutilizar."
            />
          </div>
          {unknown.length > 0 && (
            <p role="status" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
              O CRM não reconhece {unknown.map((item) => `{{${item}}}`).join(', ')}. Dá para salvar, mas ao usar o
              modelo a pessoa precisa completar ou apagar antes de abrir a mensagem.
            </p>
          )}
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              Ao usar o modelo pelos botões “WhatsApp” e “E-mail” das fichas, o CRM troca as variáveis pelos dados do
              cadastro e abre o seu aplicativo; quem envia é você. Variáveis do CRM:
            </p>
            <ul className="list-inside list-disc">
              {MESSAGE_VARIABLES.map((variable) => (
                <li key={variable.key}>
                  <code>{`{{${variable.key}}}`}</code>: {variable.label.toLocaleLowerCase('pt-BR')} (ex.:{' '}
                  {variable.example})
                </li>
              ))}
            </ul>
          </div>
        </form>
      </SidePanel>
      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title="Descartar alterações?"
        description="O texto ainda não salvo será descartado."
        confirmLabel="Descartar"
        onConfirm={onClose}
      />
    </>
  );
}
