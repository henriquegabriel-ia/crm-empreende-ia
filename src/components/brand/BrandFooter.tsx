import { BASE_CREDIT_TEXT, BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * Rodapé das telas de entrada (Login, ResetPassword e EmailLinkGate): o nome da marca da instância e, quando a marca é
 * de outra empresa e o crédito está ligado, "Feito com Empreende.IA" (D3; showBaseCredit e VITE_SHOW_BASE_CREDIT).
 */
export function BrandFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('mt-8 text-center text-xs text-muted-foreground', className)}>
      <p className="break-words">{BRAND.productName}</p>
      {BRAND.baseCredit && <p className="mt-1">{BASE_CREDIT_TEXT}</p>}
    </footer>
  );
}
