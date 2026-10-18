import { EyeOff } from 'lucide-react';
import type { Contact } from '@/lib/contact-model';
import type { PersonLike } from '@/lib/team-members';
import { authorStamp } from './stamp';

/**
 * A faixa do contato anonimizado na ficha 360 (item 1.10; docs/arquitetura/1.10.md, seção 5.5): quem anonimizou,
 * quando e o que aconteceu, no tom neutro (não é alerta nem erro). Substitui a faixa "Não contatar", que o banco mantém
 * ligada, e explica por que a ficha não tem canais, edição nem ações novas.
 */
export function AnonymizedBanner({
  contact,
  members,
}: {
  contact: Pick<Contact, 'anonymized_at' | 'anonymized_by'>;
  members: readonly PersonLike[];
}) {
  const stamp = authorStamp('Anonimizado', contact.anonymized_at, contact.anonymized_by, members);
  return (
    <section
      aria-label="Contato anonimizado"
      className="space-y-1 rounded-xl border border-border bg-muted/40 p-4 text-sm"
      data-anonymized
    >
      <h3 className="flex items-center gap-2 font-semibold">
        <EyeOff aria-hidden className="h-4 w-4" />
        Contato anonimizado
      </h3>
      <p className="text-muted-foreground">
        {stamp ? `${stamp} ` : ''}Os dados pessoais foram apagados; o histórico comercial ficou sem nomes e anotações. O
        CRM não vincula novos registros a este cadastro: para um novo relacionamento com a pessoa, cadastre um novo
        contato.
      </p>
    </section>
  );
}
