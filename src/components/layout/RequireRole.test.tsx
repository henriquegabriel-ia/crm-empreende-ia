import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireRole } from './RequireRole';
import { EDITOR_ROLES, MANAGER_ROLES, roleGroupList } from '@/lib/roles';

const permissions = vi.hoisted(() => ({
  state: { loading: false, refreshing: false, error: null as unknown, roles: [] as string[] },
  refresh: vi.fn(),
}));
vi.mock('@/hooks/useCrmPermissions', () => ({
  useCrmPermissions: () => ({ ...permissions.state, refresh: permissions.refresh }),
}));
vi.mock('@/components/shell/PageScaffold', () => ({
  PageScaffold: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

function setup(roles = MANAGER_ROLES) {
  render(
    <MemoryRouter initialEntries={['/gestao']}>
      <Routes>
        <Route
          path="/gestao"
          element={
            <RequireRole roles={roles} title="Gestão" purpose="A Gestão serve para aprovar pedidos.">
              <p>Conteúdo da gestão</p>
            </RequireRole>
          }
        />
        <Route path="/dashboard" element={<p>Tela Hoje</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  permissions.state = { loading: false, refreshing: false, error: null, roles: [] };
  permissions.refresh.mockReset();
});

describe('RequireRole', () => {
  it.each(['owner', 'admin'])('mostra a tela para %s', (role) => {
    permissions.state.roles = [role];
    setup();
    expect(screen.getByText('Conteúdo da gestão')).toBeInTheDocument();
  });

  it.each([
    ['viewer', 'Somente leitura'],
    ['member', 'Colaborador'],
  ])('explica a %s por que a tela não é para o seu papel, sem montar o conteúdo', (role, label) => {
    permissions.state.roles = [role];
    setup();
    expect(screen.queryByText('Conteúdo da gestão')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Gestão' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Esta tela é para donos e administradores' })).toBeInTheDocument();
    expect(
      screen.getByText(
        `A Gestão serve para aprovar pedidos. Seu papel nesta organização: ${label}. Se precisar deste acesso, fale com um dono ou administrador; a Equipe mostra quem são.`,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Ir para Hoje' }));
    expect(screen.getByText('Tela Hoje')).toBeInTheDocument();
  });

  it('libera colaboradores quando a rota aceita quem edita', () => {
    permissions.state.roles = ['member'];
    setup(EDITOR_ROLES);
    expect(screen.getByText('Conteúdo da gestão')).toBeInTheDocument();
  });

  it('sem papel lido, explica em vez de liberar', () => {
    setup();
    expect(screen.getByText(/Seu papel nesta organização: sem papel definido\./)).toBeInTheDocument();
    expect(screen.queryByText('Conteúdo da gestão')).not.toBeInTheDocument();
  });

  it('enquanto verifica, não mostra nem a tela nem a explicação', () => {
    permissions.state = { loading: true, refreshing: true, error: null, roles: ['owner'] };
    setup();
    expect(screen.getByText('Verificando seu acesso…')).toBeInTheDocument();
    expect(screen.queryByText('Conteúdo da gestão')).not.toBeInTheDocument();
  });

  it('com falha na leitura do papel, oferece tentar de novo', () => {
    permissions.state = { loading: false, refreshing: false, error: new Error('network'), roles: [] };
    setup();
    expect(screen.getByRole('heading', { name: 'Não foi possível verificar seu acesso' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(permissions.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByText('Conteúdo da gestão')).not.toBeInTheDocument();
  });

  it('durante a nova tentativa, mostra que está verificando e não aceita outro clique', () => {
    permissions.state = { loading: false, refreshing: true, error: new Error('network'), roles: [] };
    setup();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Verificando…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(permissions.refresh).not.toHaveBeenCalled();
  });
});

describe('roleGroupList', () => {
  it('lista os grupos em pt-BR, na ordem dos papéis', () => {
    expect(roleGroupList(MANAGER_ROLES)).toBe('donos e administradores');
    expect(roleGroupList(['member', 'owner', 'admin'])).toBe('donos, administradores e colaboradores');
    expect(roleGroupList(['owner'])).toBe('donos');
  });
});
