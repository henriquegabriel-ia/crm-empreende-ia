import { Progress } from '@/components/ui/progress';
import { formatCount, plural } from './text';

interface Props {
  written: number;
  total: number;
  /** Empresas novas ainda por criar, antes dos contatos. */
  creatingCompanies?: number | null;
  /** Nome da barra para o leitor de tela (item 1.16: a importação do catálogo usa a mesma barra). */
  label?: string;
  /** O que é gravado, no singular e no plural: "contato gravado" e "contatos gravados". */
  nouns?: readonly [string, string];
}

/**
 * Progresso da gravação (item 1.11; docs/arquitetura/1.11.md, seção 6.3): a barra `role="progressbar"` com os valores
 * e o texto numa região viva, atualizado a cada lote. Desde o item 1.16, o rótulo e o nome do que é gravado vêm por
 * parâmetro, e a importação do catálogo usa o mesmo componente.
 */
export function ImportProgress({
  written,
  total,
  creatingCompanies = null,
  label = 'Importação de contatos',
  nouns = ['contato gravado', 'contatos gravados'],
}: Props) {
  return (
    <div className="space-y-2">
      <Progress
        value={Math.min(written, total)}
        max={Math.max(total, 1)}
        aria-label={label}
        aria-valuemin={0}
        className="h-3"
      />
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {creatingCompanies
          ? `Criando ${plural(creatingCompanies, 'empresa', 'empresas')}…`
          : `${formatCount(written)} de ${plural(total, nouns[0], nouns[1])}`}
      </p>
    </div>
  );
}
