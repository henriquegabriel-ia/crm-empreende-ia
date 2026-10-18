import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ds/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ds/select';
import {
  COMPANY_DEFAULT_CHOICE,
  LEGAL_BASES,
  LEGAL_BASIS_LABELS,
  LEGAL_BASIS_NOTE_MAX,
  legalBasisOf,
  type LegalBasisChoice,
} from '@/lib/privacy';
import type { PersonLike } from '@/lib/team-members';
import { authorStamp } from './stamp';

interface Props {
  /** O contato em edição, com a base gravada e o carimbo; ausente na criação. */
  contact?: {
    legal_basis?: string | null;
    legal_basis_at?: string | null;
    legal_basis_by?: string | null;
  };
  choice: LegalBasisChoice;
  note: string;
  onChoiceChange: (choice: LegalBasisChoice) => void;
  onNoteChange: (note: string) => void;
  /**
   * Na criação, o rótulo da primeira opção ("Padrão da empresa: Legítimo interesse", de `companyDefaultLabel`); sem a
   * leitura do padrão, "Padrão da empresa".
   */
  companyDefaultLabel?: string;
  members: readonly PersonLike[];
  /** Erro do registro antes do pedido (consentimento sem registro, texto longo), ligado ao campo. */
  error?: string | null;
  disabled?: boolean;
}

/**
 * "Privacidade" no cadastro do contato (item 1.10; docs/arquitetura/1.10.md, seção 5.1): a base legal e o registro dela.
 * Na criação, a primeira opção é o padrão da empresa, e nada é enviado se ela ficar (o banco preenche); "Não informada"
 * fica de fora, porque, na inserção, o banco a troca pelo padrão. Na edição, as seis bases e, abaixo, o carimbo que o
 * banco gravou. O consentimento pede o registro de como a pessoa aceitou, conferido antes do pedido e pelo CHECK
 * contacts_legal_basis_consent_note.
 */
export function LegalBasisFields({
  contact,
  choice,
  note,
  onChoiceChange,
  onNoteChange,
  companyDefaultLabel,
  members,
  error,
  disabled = false,
}: Props) {
  const hintId = useId();
  const errorId = useId();
  const creating = !contact;
  const options = creating ? LEGAL_BASES.filter((basis) => basis !== 'not_informed') : LEGAL_BASES;
  const consent = choice === 'consent';
  // O carimbo só diz algo quando há base registrada: "Não informada" é a ausência de registro.
  const stamp =
    contact && legalBasisOf(contact) !== 'not_informed'
      ? authorStamp('Registrada', contact.legal_basis_at, contact.legal_basis_by, members)
      : null;
  return (
    <fieldset className="space-y-3 rounded-lg border p-3" disabled={disabled}>
      <legend className="px-1 text-xs font-semibold">Privacidade</legend>
      <div className="space-y-1.5">
        <Label htmlFor="record-legal-basis">Base legal</Label>
        <Select value={choice} onValueChange={(value) => onChoiceChange(value as LegalBasisChoice)}>
          <SelectTrigger id="record-legal-basis" className="eia-touch-target">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {creating && (
              <SelectItem value={COMPANY_DEFAULT_CHOICE}>{companyDefaultLabel ?? 'Padrão da empresa'}</SelectItem>
            )}
            {options.map((basis) => (
              <SelectItem key={basis} value={basis}>
                {LEGAL_BASIS_LABELS[basis]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="record-legal-basis-note">
          {consent ? 'Como a pessoa consentiu *' : 'Registro da base legal (opcional)'}
        </Label>
        <Textarea
          id="record-legal-basis-note"
          rows={2}
          maxLength={LEGAL_BASIS_NOTE_MAX}
          value={note}
          aria-required={consent || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          onChange={(event) => onNoteChange(event.target.value)}
        />
        {error && (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <p id={hintId} className="text-xs text-muted-foreground">
          Ex.: marcou a caixa do formulário do site em 10/10/2026. Não escreva dados sensíveis, como saúde ou religião.
        </p>
      </div>
      {stamp && <p className="text-xs text-muted-foreground">{stamp}</p>}
    </fieldset>
  );
}
