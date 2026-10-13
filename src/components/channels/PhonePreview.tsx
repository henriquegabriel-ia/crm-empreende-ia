import { formatPhoneBR, phoneToStore } from '@/lib/phone';

/**
 * Prévia do telefone que o cadastro vai gravar (item 1.9), no molde de `MoneyPreview`: o número brasileiro reconhecido
 * vai em E.164 e aparece formatado; o de outro país e o não reconhecido ficam como digitados, com a dica de cada um.
 */
export function PhonePreview({ id, value }: { id: string; value: string }) {
  const { value: stored, kind } = phoneToStore(value);
  const text =
    kind === 'mobile'
      ? `Será salvo como ${formatPhoneBR(stored)}, celular.`
      : kind === 'landline'
        ? `Será salvo como ${formatPhoneBR(stored)}, fixo. O WhatsApp só abre com fixo que usa o WhatsApp Business.`
        : kind === 'international'
          ? 'Número de outro país: será salvo como digitado, com o “+” e o código do país.'
          : kind === 'invalid'
            ? 'Número não reconhecido: confira o DDD. Ele será salvo como digitado, e o WhatsApp e a ligação ficam desabilitados até você corrigir o número.'
            : '';
  return (
    <p id={id} className="min-h-4 text-xs text-muted-foreground">
      {text}
    </p>
  );
}
