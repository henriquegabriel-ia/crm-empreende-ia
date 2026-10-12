import { useEffect, useState } from 'react';

/**
 * Formulário de criação aberto pela URL (?create=1 no Pipeline e no Financeiro). Abre quando o pedido está na URL e a
 * tela está pronta (`ready`: dados carregados e permissão de edição). Depois de aberto, só fecha quando o pedido sai da
 * URL (fechar, salvar ou Voltar): se uma releitura do papel falhar com o formulário aberto, `canWrite` vira false, mas o
 * preenchimento não se perde. A gravação continua conferida pela tela e pela RLS.
 */
export function useCreateFromUrl(requested: boolean, ready: boolean): boolean {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (ready) setOpened(true);
    else if (!requested) setOpened(false);
  }, [ready, requested]);
  return requested && (ready || opened);
}
