import { useId, useState } from 'react';
import { Input } from '@/components/ds/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ds/select';
import { LEAD_SOURCES, leadSourceChoice, leadSourceFromChoice, type LeadSourceChoice } from '@/lib/lead-source';

interface Props {
  /** Id do seletor, para o rótulo e os testes. */
  id: string;
  label: string;
  /** O texto gravado (ou a gravar): o nome da lista, um texto livre ou vazio. */
  value: string;
  /** Recebe o texto a gravar: o nome da lista ("WhatsApp"), o texto de "Outra" ou vazio. */
  onChange: (value: string) => void;
  maxLength: number;
  className?: string;
}

/**
 * Campo "Origem" do contato (item 1.14): a lista fixa (WhatsApp, Telefone, E-mail, Site e Indicação), "Sem origem" e
 * "Outra", que abre um campo de texto. Um valor gravado fora da lista (de uma planilha ou de antes do item) abre em
 * "Outra", com o texto como está, e só muda se a pessoa mudar. Usado em "Editar cadastro" e na origem padrão da
 * importação de planilha.
 */
export function LeadSourceField({ id, label, value, onChange, maxLength, className }: Props) {
  const otherId = useId();
  // A escolha fica guardada: "Outra" com o texto ainda vazio grava vazio, mas não volta para "Sem origem".
  const [choice, setChoice] = useState<LeadSourceChoice>(() => leadSourceChoice(value).choice);
  const [other, setOther] = useState(() => leadSourceChoice(value).other);
  return (
    <div className={className}>
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Select
          value={choice}
          onValueChange={(next) => {
            const nextChoice = next as LeadSourceChoice;
            setChoice(nextChoice);
            onChange(leadSourceFromChoice(nextChoice, other));
          }}
        >
          <SelectTrigger id={id} className="eia-touch-target">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem origem</SelectItem>
            {LEAD_SOURCES.map((source) => (
              <SelectItem key={source.key} value={source.key}>
                {source.label}
              </SelectItem>
            ))}
            <SelectItem value="other">Outra</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {choice === 'other' && (
        <div className="mt-2 space-y-1.5">
          <Label htmlFor={otherId}>Outra origem</Label>
          <Input
            id={otherId}
            className="eia-touch-target"
            maxLength={maxLength}
            value={other}
            placeholder="Ex.: feira de outubro, Instagram"
            onChange={(event) => {
              setOther(event.target.value);
              // O texto vai como foi digitado; o nome da lista, se a pessoa digitar um deles, entra na gravação.
              onChange(event.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
}
