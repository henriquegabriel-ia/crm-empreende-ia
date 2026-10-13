/** Copia para a área de transferência; falso quando ela não existe ou recusa (página sem foco, permissão negada). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Abre um link de canal depois de uma ação assíncrona (copiar o texto antes de abrir sem ele), com os mesmos
 * atributos dos links da tela: um <a> criado e clicado ainda dentro da ativação do clique da pessoa.
 */
export function openChannelLink(url: string, newTab: boolean) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener noreferrer';
  anchor.referrerPolicy = 'no-referrer';
  if (newTab) anchor.target = '_blank';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
