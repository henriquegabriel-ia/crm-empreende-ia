import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotFound from './NotFound';

afterEach(() => vi.restoreAllMocks());

describe('NotFound', () => {
  it('leva para Hoje (/dashboard), e não para a tela de entrada', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={['/pagina-inexistente']}>
        <Routes>
          <Route path="/" element={<p>Tela de entrada</p>} />
          <Route path="/dashboard" element={<p>Tela Hoje</p>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dashboard' })).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Ir para Hoje' });
    expect(link).toHaveAttribute('href', '/dashboard');
    fireEvent.click(link);
    expect(screen.getByText('Tela Hoje')).toBeInTheDocument();
  });
});
