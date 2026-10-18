import { useId, useRef, useState } from 'react';
import { Ban, ChevronDown, Copy, Mail, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Textarea } from '@/components/ds/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ds/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ds/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ds/select';
import { ConfirmDialog } from '@/components/foundation/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import {
  APP_LINK_PROPS,
  EMAIL_TARGET_LABELS,
  EXTERNAL_LINK_PROPS,
  INTERNATIONAL_NOTICE,
  LANDLINE_WHATSAPP_NOTICE,
  emailLink,
  whatsappLink,
  type ChannelPhone,
  type EmailTarget,
} from '@/lib/channels';
import type { InteractionTarget } from '@/lib/interactions';
import { messageContext, pendingVariables, renderTemplate, type MessageSources } from '@/lib/message-templates';
import { copyText, openChannelLink } from './clipboard';
import { useInteractionPrompt } from './interaction-context';
import { useMessageTemplates, useOrganizationName } from './useMessageTemplates';

interface Props {
  channel: 'whatsapp' | 'email';
  recipientName: string;
  phone?: ChannelPhone | null;
  email?: string | null;
  /** A marca "Não contatar" atual: chegando com o diálogo aberto, fecha as ações de abrir. */
  doNotContact: boolean;
  /** Dados da tela para as variáveis; o nome de quem usa e o da organização vêm daqui. */
  sources: Omit<MessageSources, 'myName' | 'organizationName'>;
  target: InteractionTarget;
  onClose: () => void;
}

const EMAIL_TARGETS: EmailTarget[] = ['gmail', 'outlook', 'mailto'];

/**
 * "Mensagem por WhatsApp" e "Mensagem por e-mail" (item 1.9; docs/arquitetura/1.9.md, seção 6.2): escolha de modelo,
 * texto revisável e as ações de abrir, que são links (<a>) montados por src/lib/channels.ts. Uma variável sem dado ou
 * desconhecida bloqueia a abertura até a pessoa completar ou apagar; "Copiar texto" continua. Ao abrir, o diálogo
 * fecha e a pendência "Para registrar" nasce. O texto nunca vai para o armazenamento do CRM.
 */
export function ComposeDialog({ channel, recipientName, phone, email, doNotContact, sources, target, onClose }: Props) {
  const { profile } = useAuth();
  const prompt = useInteractionPrompt();
  const templates = useMessageTemplates();
  const organization = useOrganizationName();
  const context = messageContext({ ...sources, myName: profile?.name ?? null, organizationName: organization.data });
  const [templateId, setTemplateId] = useState('none');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  // O texto aplicado pelo último modelo: trocar de modelo depois de editar pede confirmação.
  const [applied, setApplied] = useState({ subject: '', text: '' });
  const [confirmTemplate, setConfirmTemplate] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const variablesId = useId();
  const longId = useId();
  const noticeId = useId();
  const isEmail = channel === 'email';
  const pending = pendingVariables(isEmail ? `${subject}\n${text}` : text, context);
  const draft = { to: email ?? '', subject, body: text };
  const whatsapp = phone ? whatsappLink(phone, text) : null;
  const tooLong = isEmail
    ? EMAIL_TARGETS.some((destination) => !emailLink(destination, draft).full)
    : !!whatsapp && !whatsapp.full;
  const blocked = doNotContact || pending.length > 0;
  const blockedBy =
    [pending.length ? variablesId : null, tooLong ? longId : null].filter(Boolean).join(' ') || undefined;
  // A falha de cópia fica ligada às ações que dependem dela (achado 7 da revisão do item 1.9), enquanto existe.
  const withNotice = (ids?: string) => [ids, notice ? noticeId : null].filter(Boolean).join(' ') || undefined;

  const apply = (id: string) => {
    setTemplateId(id);
    const template = templates.data?.find((item) => item.id === id);
    const next = template
      ? {
          subject: renderTemplate(template.subject ?? '', context).text,
          text: renderTemplate(template.body ?? '', context).text,
        }
      : { subject: '', text: '' };
    setSubject(next.subject);
    setText(next.text);
    setApplied(next);
  };
  const choose = (id: string) => {
    const edited = text !== applied.text || subject !== applied.subject;
    if (edited && (text.trim() || subject.trim())) setConfirmTemplate(id);
    else apply(id);
  };
  const fullText = isEmail && subject.trim() ? `${subject.trim()}\n\n${text}` : text;
  const opened = () => {
    prompt.track(target, isEmail ? subject : undefined);
    onClose();
  };
  const copyAll = async () => {
    if (await copyText(fullText)) {
      toast.success('Texto copiado');
      return true;
    }
    textRef.current?.focus();
    textRef.current?.select();
    setNotice(
      'Não foi possível copiar automaticamente. O texto está selecionado: copie com Ctrl+C (ou toque e segure no celular).',
    );
    return false;
  };
  // Texto longo demais para o link: copia e só então abre o destino sem o texto. Se a cópia falhar, nada abre.
  const copyAndOpen = async (url: string, newTab: boolean) => {
    if (!(await copyAll())) return;
    openChannelLink(url, newTab);
    opened();
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEmail ? 'Mensagem por e-mail' : 'Mensagem por WhatsApp'}</DialogTitle>
            <DialogDescription>
              O CRM abre o seu {isEmail ? 'e-mail' : 'WhatsApp'} com o texto, e quem envia é você. Revise antes de
              abrir.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Para</p>
              <p className="break-words font-medium">
                {recipientName} · {isEmail ? email : phone?.display}
              </p>
            </div>
            {/* Avisos que não bloqueiam, na caixa de alerta com role="status" (DESIGN.md; achado 7 da revisão do 1.9). */}
            {!isEmail && phone?.kind === 'landline' && (
              <p role="status" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                {LANDLINE_WHATSAPP_NOTICE}
              </p>
            )}
            {!isEmail && phone?.kind === 'international' && (
              <p role="status" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                {INTERNATIONAL_NOTICE}
              </p>
            )}
            {doNotContact && (
              <p role="alert" className="flex gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                <Ban aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                Este cadastro foi marcado como “Não contatar”. As ações de abrir foram desligadas.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="compose-template">Modelo</Label>
              <Select value={templateId} onValueChange={choose}>
                <SelectTrigger id="compose-template">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem modelo</SelectItem>
                  {(templates.data ?? []).map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {templates.isError && (
                <p className="text-xs text-muted-foreground">Não foi possível carregar os modelos. Escreva o texto.</p>
              )}
            </div>
            {isEmail && (
              <div className="space-y-1.5">
                <Label htmlFor="compose-subject">Assunto</Label>
                <Input
                  id="compose-subject"
                  value={subject}
                  maxLength={300}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="compose-text">Texto</Label>
              <Textarea
                id="compose-text"
                ref={textRef}
                rows={8}
                maxLength={10000}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setNotice('');
                }}
              />
            </div>
            {pending.length > 0 && (
              <div
                id={variablesId}
                role="status"
                className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
              >
                <p className="font-medium">Complete ou apague antes de abrir:</p>
                <ul className="mt-1 list-inside list-disc">
                  {pending.map((item) => (
                    <li key={item.token}>
                      <code>{item.token}</code> ({item.reason})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tooLong && (
              <p id={longId} className="text-xs text-muted-foreground">
                O texto é longo demais para abrir pelo link. Use “Copiar texto e abrir sem ele” e cole o texto no{' '}
                {isEmail ? 'e-mail' : 'WhatsApp'}.
              </p>
            )}
            {notice && (
              <p id={noticeId} role="alert" className="text-sm text-destructive">
                {notice}
              </p>
            )}
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="ghost"
              className="eia-touch-target"
              aria-describedby={withNotice()}
              onClick={() => void copyAll()}
            >
              <Copy aria-hidden />
              Copiar texto
            </Button>
            {isEmail ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    className="eia-touch-target"
                    disabled={blocked || !email}
                    aria-describedby={withNotice(blockedBy)}
                  >
                    <Mail aria-hidden />
                    {tooLong ? 'Copiar texto e abrir sem ele' : 'Abrir e-mail'}
                    <ChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-w-xs">
                  {EMAIL_TARGETS.map((destination) => {
                    const link = emailLink(destination, draft);
                    const newTab = destination !== 'mailto';
                    return link.full ? (
                      <DropdownMenuItem key={destination} asChild>
                        <a href={link.url} {...(newTab ? EXTERNAL_LINK_PROPS : APP_LINK_PROPS)} onClick={opened}>
                          {EMAIL_TARGET_LABELS[destination]}
                        </a>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem key={destination} onSelect={() => void copyAndOpen(link.url, newTab)}>
                        {EMAIL_TARGET_LABELS[destination]}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Outlook web é para contas Microsoft 365 de trabalho ou escola. Com Outlook.com, Hotmail ou no
                    celular, prefira o aplicativo de e-mail.
                  </DropdownMenuLabel>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : blocked || !whatsapp ? (
              <Button type="button" className="eia-touch-target" disabled aria-describedby={withNotice(blockedBy)}>
                <MessageCircle aria-hidden />
                {tooLong ? 'Copiar texto e abrir sem ele' : 'Abrir no WhatsApp'}
              </Button>
            ) : whatsapp.full ? (
              <Button asChild className="eia-touch-target">
                <a href={whatsapp.url} {...EXTERNAL_LINK_PROPS} aria-describedby={withNotice()} onClick={opened}>
                  <MessageCircle aria-hidden />
                  Abrir no WhatsApp
                </a>
              </Button>
            ) : (
              <Button
                type="button"
                className="eia-touch-target"
                aria-describedby={withNotice(longId)}
                onClick={() => void copyAndOpen(whatsapp.url, true)}
              >
                <MessageCircle aria-hidden />
                Copiar texto e abrir sem ele
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!confirmTemplate}
        onOpenChange={(open) => !open && setConfirmTemplate(null)}
        title="Trocar o texto pelo do modelo?"
        description="O texto que você escreveu será substituído pelo do modelo escolhido."
        confirmLabel="Trocar o texto"
        tone="default"
        onConfirm={() => {
          if (confirmTemplate) apply(confirmTemplate);
          setConfirmTemplate(null);
        }}
      />
    </>
  );
}
