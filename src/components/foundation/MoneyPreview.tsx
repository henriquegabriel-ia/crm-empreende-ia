import { parseBRL, formatBRL } from '@/lib/money';

interface MoneyPreviewProps {
  id: string;
  /** Texto digitado no campo de valor. */
  value: string;
  format?: (value: number) => string;
}

/** Prévia do valor que será salvo, lido no padrão brasileiro enquanto a pessoa digita. */
export function MoneyPreview({ id, value, format = formatBRL }: MoneyPreviewProps) {
  const parsed = value.trim() ? parseBRL(value) : null;
  return (
    <p id={id} className="min-h-4 text-xs text-muted-foreground">
      {!value.trim()
        ? ''
        : parsed === null
          ? 'Formato não reconhecido. Use, por exemplo, 1.500,00 ou 1500,5.'
          : `Prévia: ${format(parsed)}`}
    </p>
  );
}
