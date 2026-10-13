import { useId, useState } from 'react';
import { Mail, MessageCircle, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ds/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ds/dropdown-menu';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import {
  APP_LINK_PROPS,
  CHANNEL_PROBLEMS,
  channelEmail,
  channelPhone,
  telUrl,
  type ChannelPhone,
} from '@/lib/channels';
import { contactName, type ChannelType } from '@/lib/contact-model';
import { pendingKey, type InteractionTarget } from '@/lib/interactions';
import { personName, type PersonLike } from '@/lib/team-members';
import { cn } from '@/lib/utils';
import { ComposeDialog } from './ComposeDialog';
import { copyText } from './clipboard';
import { useInteractionPrompt } from './interaction-context';
import { PendingInteractionsInline } from './PendingInteractionsInline';

/** Contato com o que os canais usam; a marca "Não contatar" ausente (banco sem a migração) conta como falsa. */
export interface ChannelContact {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  company_id?: string | null;
  owner_id?: string | null;
  do_not_contact?: boolean | null;
}
export interface ChannelCompany {
  id: string;
  name: string;
  phone?: string | null;
  owner_id?: string | null;
  do_not_contact?: boolean | null;
}
export interface ChannelBarProps {
  /** O contato do canal: o telefone e o e-mail são os dele. */
  contact?: ChannelContact | null;
  /** A empresa do contexto: a do alvo (sem contato, o telefone é o dela), a da oportunidade ou a do contato. */
  company?: ChannelCompany | null;
  deal?: { id: string; title: string; owner_id?: string | null } | null;
  /** Atividade de origem: pendente e do mesmo canal, o registro conclui essa atividade em vez de criar outra. */
  activity?: { id: string; type: string; completed_at: string | null } | null;
  /** A equipe, para a variável {{responsavel}}. */
  members?: readonly PersonLike[];
  /** Um controle só (o botão do canal numa atividade pendente). */
  only?: ChannelType;
  /** Mostra, abaixo da barra, as pendências deste alvo (dentro de painéis modais). */
  showPending?: boolean;
  className?: string;
  tour?: string;
}

/**
 * Barra de canais (item 1.9; docs/arquitetura/1.9.md, seção 6.1): "WhatsApp", "E-mail" e o menu "Ligar" ("Ligar",
 * "Copiar número" e "Registrar ligação"). O CRM abre o aplicativo da pessoa e nunca envia nada; abrir um canal cria
 * a pendência "Para registrar" para quem edita. Cada controle indisponível fica desabilitado e aponta para a frase que
 * diz o motivo: sem telefone, telefone sem DDD, sem e-mail, e-mail inválido ou "Não contatar".
 */
export function ChannelBar({
  contact,
  company,
  deal,
  activity,
  members = [],
  only,
  showPending = false,
  className,
  tour,
}: ChannelBarProps) {
  const { canWrite } = useCrmPermissions();
  const prompt = useInteractionPrompt();
  const [compose, setCompose] = useState<'whatsapp' | 'email' | null>(null);
  const ids = { dnc: useId(), phone: useId(), email: useId() };
  if (!contact && !company) return null;
  const rawPhone = contact ? contact.phone : company?.phone;
  const phone = channelPhone(rawPhone);
  const email = contact ? channelEmail(contact.email) : null;
  const marked = !!(contact ? contact.do_not_contact : company?.do_not_contact);
  const name = contact
    ? contactName({
        first_name: contact.first_name ?? '',
        last_name: contact.last_name ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
      })
    : company!.name;
  const phoneProblem = phone ? null : rawPhone?.trim() ? CHANNEL_PROBLEMS.invalidPhone : CHANNEL_PROBLEMS.noPhone;
  const emailProblem = !contact
    ? CHANNEL_PROBLEMS.companyEmail
    : email
      ? null
      : contact.email?.trim()
        ? CHANNEL_PROBLEMS.invalidEmail
        : CHANNEL_PROBLEMS.noEmail;
  const markText = contact
    ? 'Este contato está marcado como “Não contatar”.'
    : 'Esta empresa está marcada como “Não contatar”.';
  const targetFor = (channel: ChannelType): InteractionTarget => ({
    channel,
    contactId: contact?.id ?? null,
    companyId: company?.id ?? contact?.company_id ?? null,
    dealId: deal?.id ?? null,
    // A atividade é a origem só se estiver pendente e for do mesmo canal.
    activityId: activity && !activity.completed_at && activity.type === channel ? activity.id : null,
  });
  const describedBy = (problem: string | null, id: string) =>
    [marked ? ids.dnc : null, problem ? id : null].filter(Boolean).join(' ') || undefined;
  const ownerId = deal?.owner_id ?? contact?.owner_id ?? company?.owner_id ?? null;
  const owner = ownerId ? members.find((member) => member.id === ownerId) : undefined;
  const shows = (channel: ChannelType) => !only || only === channel;

  const copyNumber = async (value: ChannelPhone) => {
    prompt.track(targetFor('call'));
    if (await copyText(value.e164)) toast.success(`Número copiado: ${value.display}`);
    else toast.message(`Não foi possível copiar. Número: ${value.e164}`, { duration: 15_000 });
  };

  return (
    <div className={cn('space-y-2', className)} data-tour={tour}>
      {/* Um controle só (o botão do canal de uma atividade) dispensa o grupo. */}
      <div
        role={only ? undefined : 'group'}
        aria-label={only ? undefined : `Canais de ${name}`}
        className="flex flex-wrap gap-2"
      >
        {shows('whatsapp') && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="eia-touch-target"
            disabled={marked || !phone}
            aria-describedby={describedBy(phoneProblem, ids.phone)}
            onClick={() => setCompose('whatsapp')}
          >
            <MessageCircle aria-hidden />
            WhatsApp
          </Button>
        )}
        {shows('email') && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="eia-touch-target"
            disabled={marked || !email}
            aria-describedby={describedBy(emailProblem, ids.email)}
            onClick={() => setCompose('email')}
          >
            <Mail aria-hidden />
            E-mail
          </Button>
        )}
        {shows('call') && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="eia-touch-target"
                disabled={marked || !phone}
                aria-describedby={describedBy(phoneProblem, ids.phone)}
              >
                <Phone aria-hidden />
                Ligar
              </Button>
            </DropdownMenuTrigger>
            {phone && (
              <DropdownMenuContent align="start">
                <DropdownMenuItem asChild>
                  <a href={telUrl(phone)} {...APP_LINK_PROPS} onClick={() => prompt.track(targetFor('call'))}>
                    Ligar
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copyNumber(phone)}>Copiar número</DropdownMenuItem>
                {canWrite && (
                  <DropdownMenuItem
                    onSelect={() =>
                      prompt.openDialog({
                        mode: targetFor('call').activityId ? 'complete' : 'register',
                        pending: prompt.pendingFor(targetFor('call')),
                      })
                    }
                  >
                    Registrar ligação
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        )}
      </div>
      {(marked || (phoneProblem && (shows('whatsapp') || shows('call'))) || (emailProblem && shows('email'))) && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {marked && <p id={ids.dnc}>{markText}</p>}
          {phoneProblem && (shows('whatsapp') || shows('call')) && <p id={ids.phone}>{phoneProblem}</p>}
          {emailProblem && shows('email') && <p id={ids.email}>{emailProblem}</p>}
        </div>
      )}
      {showPending && (
        <PendingInteractionsInline
          keys={(['call', 'whatsapp', 'email'] as const).filter(shows).map((channel) => pendingKey(targetFor(channel)))}
        />
      )}
      {compose && (
        <ComposeDialog
          channel={compose}
          recipientName={name}
          phone={phone}
          email={email}
          doNotContact={marked}
          sources={{
            contact,
            companyName: company?.name ?? null,
            dealTitle: deal?.title ?? null,
            ownerName: owner ? personName(owner) : null,
          }}
          target={targetFor(compose)}
          onClose={() => setCompose(null)}
        />
      )}
    </div>
  );
}
