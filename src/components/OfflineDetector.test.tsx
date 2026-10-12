import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineDetector } from './OfflineDetector';

let online = true;
beforeEach(() => {
  online = true;
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online);
});
afterEach(() => vi.restoreAllMocks());

function goOffline() {
  online = false;
  act(() => void window.dispatchEvent(new Event('offline')));
}

describe('OfflineDetector', () => {
  it('avisa sem prometer sincronização e some quando a conexão volta', () => {
    render(<OfflineDetector />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    goOffline();
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Sem conexão. As alterações não serão salvas até a conexão voltar.');
    expect(banner.textContent).not.toMatch(/sincroniz|quando reconectar/i);
    online = true;
    act(() => void window.dispatchEvent(new Event('online')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('já abre com o aviso quando o navegador começa sem conexão', () => {
    online = false;
    render(<OfflineDetector />);
    expect(screen.getByRole('alert')).toHaveTextContent('As alterações não serão salvas');
  });
});
