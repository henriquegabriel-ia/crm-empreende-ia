import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCreateFromUrl } from './useCreateFromUrl';

function setup(requested: boolean, ready: boolean) {
  return renderHook(({ requested, ready }) => useCreateFromUrl(requested, ready), {
    initialProps: { requested, ready },
  });
}

describe('useCreateFromUrl', () => {
  it('só abre com o pedido na URL e a tela pronta', () => {
    expect(setup(true, false).result.current).toBe(false);
    expect(setup(false, true).result.current).toBe(false);
    expect(setup(true, true).result.current).toBe(true);
  });

  it('abre quando a tela fica pronta depois do pedido', () => {
    const hook = setup(true, false);
    hook.rerender({ requested: true, ready: true });
    expect(hook.result.current).toBe(true);
  });

  it('depois de aberto, continua aberto se a permissão deixar de valer (releitura do papel com falha)', () => {
    const hook = setup(true, true);
    hook.rerender({ requested: true, ready: false });
    expect(hook.result.current).toBe(true);
  });

  it('fecha quando o pedido sai da URL e não reabre sozinho sem a tela pronta', () => {
    const hook = setup(true, true);
    hook.rerender({ requested: false, ready: false });
    expect(hook.result.current).toBe(false);
    hook.rerender({ requested: true, ready: false });
    expect(hook.result.current).toBe(false);
    hook.rerender({ requested: true, ready: true });
    expect(hook.result.current).toBe(true);
  });
});
