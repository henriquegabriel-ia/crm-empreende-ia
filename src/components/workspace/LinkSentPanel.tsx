import type { ReactNode, Ref } from 'react';
import { Mail } from 'lucide-react';
import { EmailCodeForm } from '@/components/workspace/EmailCodeForm';

interface LinkSentPanelProps {
  title: string;
  /** Endereço para onde o link foi enviado. */
  email: string;
  /** O link foi pedido de novo: "Enviamos um novo link para <e-mail>.". */
  again?: boolean;
  /** O que fazer com o link, depois de "Enviamos um link para <e-mail>." */
  children?: ReactNode;
  /** Nível do título, para seguir o da tela: h2 logo abaixo de um h1, h3 abaixo de um h2. */
  headingLevel?: 'h2' | 'h3';
  /** Com ele, o título recebe o foco quando a tela o pede (o aviso tomou o lugar do botão que tinha o foco). */
  headingRef?: Ref<HTMLHeadingElement>;
  /** Ação secundária abaixo do aviso, como "Usar outro e-mail" ou "Enviar de novo". */
  action?: ReactNode;
  /**
   * O e-mail enviado traz também o código (confirmação e link de acesso dos modelos do CRM): com o endereço, o aviso
   * oferece digitá-lo, para abrir a sessão neste aparelho.
   */
  codeEmail?: string;
}

/**
 * Aviso de link enviado por e-mail ("Confira seu e-mail"): na entrada (cadastro e "Link por e-mail") e na conta sem
 * organização que precisa provar o e-mail antes do aceite ou da criação da empresa (reforço do item 1.1). O texto fica
 * numa região `status`, anunciada quando o aviso aparece; o campo do código e a ação ficam fora dela.
 */
export function LinkSentPanel({
  title,
  email,
  again = false,
  children,
  headingLevel: Heading = 'h3',
  headingRef,
  action,
  codeEmail,
}: LinkSentPanelProps) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
      <div role="status" className="flex flex-col items-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Mail className="h-5 w-5" aria-hidden="true" />
        </div>
        <Heading
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className="mt-4 text-sm font-semibold text-foreground outline-none"
        >
          {title}
        </Heading>
        {/* O endereço quebra em qualquer ponto (break-all, como os e-mails da Equipe): os dois níveis centralizados
            têm a largura do conteúdo, e break-words não reduz essa largura, então um e-mail longo alargava a tela no
            celular. */}
        <p className="mt-1 text-sm text-muted-foreground">
          Enviamos um {again ? 'novo link' : 'link'} para{' '}
          <strong className="break-all font-medium text-foreground">{email}</strong>. {children}
        </p>
      </div>
      {codeEmail && (
        <div className="mt-6 w-full border-t border-border pt-4">
          <EmailCodeForm email={codeEmail} />
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
