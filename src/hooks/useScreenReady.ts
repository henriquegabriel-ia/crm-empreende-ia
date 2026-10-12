import { createContext, useContext, useEffect, useRef } from 'react';

/** Nome da marca de User Timing que o benchmark (`npm run test:perf`) mede. */
export const SCREEN_READY_MARK = 'screen-ready';
export type ScreenName = 'dashboard' | 'contacts' | 'companies';

/**
 * Verdadeiro dentro da próxima tela que o `RouteTransition` monta escondida (`display: none`), na navegação dentro do
 * app, só para buscar os dados antes de trocar de rota. Essa montagem não marca `screen-ready`: a tela ainda não
 * aparece, e a marca sairia antes do tempo.
 */
export const HiddenScreenContext = createContext(false);

/**
 * Marca `performance.mark('screen-ready', { detail: { screen } })` na primeira vez que a tela termina de renderizar
 * os dados (item 0.10 do roteiro), depois do commit do React. Só uma vez por montagem visível: os recarregamentos em
 * segundo plano não marcam de novo. Abrindo a URL direto (o que o `test:perf` mede), sai uma marca; na navegação
 * dentro do app, a montagem escondida do `RouteTransition` não marca, e a marca sai quando a tela aparece, já com os
 * dados buscados. Uma falha da API de User Timing nunca derruba a tela.
 */
export function useScreenReady(screen: ScreenName, ready: boolean) {
  const hidden = useContext(HiddenScreenContext);
  const marked = useRef(false);
  useEffect(() => {
    if (!ready || hidden || marked.current) return;
    marked.current = true;
    try {
      performance.mark(SCREEN_READY_MARK, { detail: { screen } });
    } catch {
      // Navegador sem User Timing nível 3: a medição fica sem a marca, e a tela segue normal.
    }
  }, [ready, hidden, screen]);
}
