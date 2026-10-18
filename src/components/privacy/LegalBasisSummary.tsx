import type { Contact } from '@/lib/contact-model';
import { legalBasisLabel, legalBasisOf } from '@/lib/privacy';
import type { PersonLike } from '@/lib/team-members';
import { authorStamp } from './stamp';

/**
 * "Base legal" no resumo da ficha 360 do contato (item 1.10; docs/arquitetura/1.10.md, seção 5.1), para todos os
 * papéis: o rótulo e, quando houver, o registro e o carimbo do banco. "Não informada" vem com a dica para quem edita.
 * Fica dentro da lista de definições do resumo (`dl`).
 */
export function LegalBasisSummary({
  contact,
  members,
  canWrite,
}: {
  contact: Pick<Contact, 'legal_basis' | 'legal_basis_note' | 'legal_basis_at' | 'legal_basis_by'>;
  members: readonly PersonLike[];
  canWrite: boolean;
}) {
  const basis = legalBasisOf(contact);
  const stamp =
    basis !== 'not_informed'
      ? authorStamp('Registrada', contact.legal_basis_at, contact.legal_basis_by, members)
      : null;
  return (
    <div className="sm:col-span-2">
      <dt className="text-xs text-muted-foreground">Base legal</dt>
      <dd className="mt-1 space-y-1">
        <span className="block">{legalBasisLabel(basis)}</span>
        {contact.legal_basis_note && (
          <span className="block whitespace-pre-wrap break-words text-muted-foreground">
            {contact.legal_basis_note}
          </span>
        )}
        {stamp && <span className="block text-xs text-muted-foreground">{stamp}</span>}
        {basis === 'not_informed' && canWrite && (
          <span className="block text-xs text-muted-foreground">Defina em “Editar cadastro”.</span>
        )}
      </dd>
    </div>
  );
}
