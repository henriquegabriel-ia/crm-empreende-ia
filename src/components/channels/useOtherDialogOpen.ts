import { useEffect, useState } from 'react';
import { otherDialogOpen } from '@/lib/dialogs';

/**
 * Verdadeiro enquanto um diálogo está aberto (src/lib/dialogs.ts). Os diálogos do Radix nascem e somem como filhos do
 * body (o portal), então observar os filhos do body basta, sem varrer a árvore inteira a cada mudança da tela.
 */
export function useOtherDialogOpen(active = true) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setOpen(otherDialogOpen()));
    };
    setOpen(otherDialogOpen());
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [active]);
  return open;
}
