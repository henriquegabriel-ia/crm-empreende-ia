import { Progress } from '@/components/ui/progress';
import { formatCount, plural } from './text';

interface Props {
  written: number;
  total: number;
  /** Empresas novas ainda por criar, antes dos contatos. */
  creatingCompanies: number | null;
}

/**
 * Progresso da gravação (item 1.11; docs/arquitetura/1.11.md, seção 6.3): a barra `role="progressbar"` com os valores
 * e o texto numa região viva, atualizado a cada lote.
 */
export function ImportProgress({ written, total, creatingCompanies }: Props) {
  return (
    <div className="space-y-2">
      <Progress
        value={Math.min(written, total)}
        max={Math.max(total, 1)}
        aria-label="Importação de contatos"
        aria-valuemin={0}
        className="h-3"
      />
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {creatingCompanies
          ? `Criando ${plural(creatingCompanies, 'empresa', 'empresas')}…`
          : `${formatCount(written)} de ${plural(total, 'contato gravado', 'contatos gravados')}`}
      </p>
    </div>
  );
}
