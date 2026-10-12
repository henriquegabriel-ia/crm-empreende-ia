import { createElement, type PropsWithChildren } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HiddenScreenContext, SCREEN_READY_MARK, useScreenReady } from './useScreenReady';

describe('marca de tela pronta', () => {
  afterEach(() => vi.restoreAllMocks());
  it('marca screen-ready uma vez, quando os dados terminam de renderizar, com o nome da tela', () => {
    const mark = vi.spyOn(performance, 'mark').mockImplementation(() => undefined as unknown as PerformanceMark);
    const { rerender } = renderHook(({ ready }) => useScreenReady('contacts', ready), {
      initialProps: { ready: false },
    });
    expect(mark).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith(SCREEN_READY_MARK, { detail: { screen: 'contacts' } });
    // Recarregamento em segundo plano não marca de novo.
    rerender({ ready: false });
    rerender({ ready: true });
    expect(mark).toHaveBeenCalledTimes(1);
    expect(SCREEN_READY_MARK).toBe('screen-ready');
  });
  it('a montagem escondida da navegação interna (RouteTransition) não marca; a tela visível, sim', () => {
    const mark = vi.spyOn(performance, 'mark').mockImplementation(() => undefined as unknown as PerformanceMark);
    const hidden = ({ children }: PropsWithChildren) =>
      createElement(HiddenScreenContext.Provider, { value: true }, children);
    renderHook(() => useScreenReady('dashboard', true), { wrapper: hidden });
    expect(mark).not.toHaveBeenCalled();
    // Ao trocar de rota, a tela é montada de novo, visível, já com os dados.
    renderHook(() => useScreenReady('dashboard', true));
    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith(SCREEN_READY_MARK, { detail: { screen: 'dashboard' } });
  });
  it('uma falha da API de desempenho não derruba a tela', () => {
    vi.spyOn(performance, 'mark').mockImplementation(() => {
      throw new TypeError('sem suporte');
    });
    expect(() => renderHook(() => useScreenReady('dashboard', true))).not.toThrow();
  });
});
