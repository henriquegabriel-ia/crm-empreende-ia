import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import InvitationStatus from './InvitationStatus';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock('@/components/shell/PageScaffold', () => ({
  PageScaffold: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

function Destination() {
  const location = useLocation();
  return (
    <p>
      destino {location.pathname}
      {location.search}
    </p>
  );
}

function setup(next: string) {
  render(
    <MemoryRouter initialEntries={[`/invite?invite=convite-1&next=${encodeURIComponent(next)}`]}>
      <Routes>
        <Route path="/invite" element={<InvitationStatus />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('InvitationStatus', () => {
  it('"Continuar no meu CRM" segue para o destino guardado', () => {
    setup('/pipeline?deal=deal-7');
    const link = screen.getByRole('link', { name: 'Continuar no meu CRM' });
    expect(link).toHaveAttribute('href', '/pipeline?deal=deal-7');
    fireEvent.click(link);
    expect(screen.getByText('destino /pipeline?deal=deal-7')).toBeInTheDocument();
  });

  it.each(['//example.test/roubo', '/.//example.test', '/..//example.test', '/%2e//example.test'])(
    'com o destino %s, que aponta para outro site, segue para Hoje',
    (next) => {
      setup(next);
      const link = screen.getByRole('link', { name: 'Continuar no meu CRM' });
      expect(link).toHaveAttribute('href', '/dashboard');
      fireEvent.click(link);
      expect(screen.getByText('destino /dashboard')).toBeInTheDocument();
    },
  );
});
