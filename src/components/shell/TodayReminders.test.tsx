import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todayNavLabel, type ReminderState } from '@/lib/activity-logic';

const mocks = vi.hoisted(() => ({ reminders: null as ReminderState }));
vi.mock('@/hooks/useActivityReminders', () => ({ useActivityReminders: () => mocks.reminders }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { name: 'Pessoa de Teste', email: 'owner@example.test' }, signOut: vi.fn() }),
}));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ setTheme: vi.fn() }) }));
vi.mock('@/components/help/HelpCenter', () => ({ HelpCenter: () => null }));
import { AppRail } from './AppRail';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { ReminderCornerBadge, ReminderPills } from './TodayReminders';

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
function mount(ui: JSX.Element, path = '/pipeline') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {ui}
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}
const today = () => screen.getByRole('link', { name: /^Hoje/ });

beforeEach(() => {
  mocks.reminders = null;
  try {
    localStorage.removeItem('empreende-crm-rail-expanded');
  } catch {
    /* sem storage */
  }
});
afterEach(cleanup);

describe('lembretes no menu (item 1.12)', () => {
  it('o nome do link "Hoje" leva o rótulo inteiro para o leitor de tela', () => {
    expect(todayNavLabel('Hoje', null)).toBe('Hoje');
    expect(todayNavLabel('Hoje', { overdue: 0, upcoming: 0, total: 0 })).toBe('Hoje');
    expect(todayNavLabel('Hoje', { overdue: 3, upcoming: 2, total: 5 })).toBe(
      'Hoje, 3 atividades vencidas e 2 até o fim do dia',
    );
  });

  it('menu expandido: pílulas de vencidas (com o alerta) e do dia (com o relógio), só visuais', () => {
    mocks.reminders = { overdue: 3, upcoming: 2, total: 5 };
    mount(<AppRail />);
    const link = today();
    expect(link.getAttribute('aria-label')).toBe('Hoje, 3 atividades vencidas e 2 até o fim do dia');
    const pills = link.querySelector('[data-reminders="pills"]')!;
    expect(pills.getAttribute('aria-hidden')).toBe('true');
    const overdue = pills.querySelector('[data-reminder="overdue"]')!;
    const upcoming = pills.querySelector('[data-reminder="upcoming"]')!;
    expect(overdue.textContent).toBe('3');
    expect(upcoming.textContent).toBe('2');
    // Não depende só da cor: cada pílula tem o seu ícone, e só a de vencidas é preenchida no tom de erro.
    expect(overdue.querySelector('svg.lucide-triangle-alert, svg.lucide-alert-triangle')).toBeTruthy();
    expect(upcoming.querySelector('svg.lucide-clock')).toBeTruthy();
    expect(overdue.className).toContain('bg-destructive');
    expect(upcoming.className).toContain('border');
    expect(upcoming.className).not.toContain('bg-destructive');
    // Os outros itens do menu não ganham número.
    expect(screen.getByRole('link', { name: 'Contatos' }).querySelector('[data-reminders]')).toBeNull();
  });

  it('menu expandido sem vencidas mostra só a pílula do dia; sem lembrete, nada', () => {
    mocks.reminders = { overdue: 0, upcoming: 1, total: 1 };
    const { unmount } = mount(<AppRail />);
    expect(today().getAttribute('aria-label')).toBe('Hoje, 1 atividade até o fim do dia');
    expect(today().querySelector('[data-reminder="overdue"]')).toBeNull();
    expect(today().querySelector('[data-reminder="upcoming"]')?.textContent).toBe('1');
    unmount();
    mocks.reminders = { overdue: 0, upcoming: 0, total: 0 };
    mount(<AppRail />);
    expect(today().getAttribute('aria-label')).toBe('Hoje');
    expect(today().querySelector('[data-reminders]')).toBeNull();
  });

  it('menu recolhido: selo no canto do link com o total e a dica com o rótulo', async () => {
    mocks.reminders = { overdue: 1, upcoming: 4, total: 5 };
    mount(<AppRail />);
    fireEvent.click(screen.getByRole('button', { name: 'Recolher menu' }));
    const badge = today().querySelector('[data-reminders="corner"]')!;
    expect(badge.textContent).toBe('5');
    // Revisão do item 1.12: o selo mora no canto do link, acima do ícone (o "99+" não cobre o desenho), e não dentro
    // de um invólucro do ícone.
    expect(badge.parentElement).toBe(today());
    expect(today().className).toContain('relative');
    expect(badge.className).toContain('-right-2');
    expect(badge.getAttribute('data-reminder')).toBe('overdue');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(today().getAttribute('aria-label')).toBe('Hoje, 1 atividade vencida e 4 até o fim do dia');
    fireEvent.focus(today());
    expect(
      (await screen.findAllByText('Hoje, 1 atividade vencida e 4 até o fim do dia')).some((node) => !node.closest('a')),
    ).toBe(true);
  });

  it('o selo preenchido é o das vencidas; só com as do dia, contornado; acima de 99, "99+"', () => {
    const { container, rerender } = render(<ReminderCornerBadge reminders={{ overdue: 0, upcoming: 2, total: 2 }} />);
    const badge = () => container.querySelector('[data-reminders="corner"]')!;
    expect(badge().getAttribute('data-reminder')).toBe('upcoming');
    expect(badge().className).toContain('border-primary');
    expect(badge().className).not.toContain('bg-destructive');
    rerender(<ReminderCornerBadge reminders={{ overdue: 120, upcoming: 3, total: 123 }} />);
    expect(badge().textContent).toBe('99+');
    expect(badge().className).toContain('bg-destructive');
    rerender(<ReminderPills reminders={{ overdue: 150, upcoming: 0, total: 150 }} />);
    expect(container.querySelector('[data-reminder="overdue"]')?.textContent).toBe('99+');
  });

  // Revisão do item 1.12: a leitura que falhou sem nenhuma anterior não passa por "nenhuma pendência".
  it('leitura que falhou: um "?" neutro no lugar do número e o rótulo no nome do link e na dica', async () => {
    expect(todayNavLabel('Hoje', 'unavailable')).toBe('Hoje, não foi possível conferir os lembretes');
    mocks.reminders = 'unavailable';
    const { unmount } = mount(<AppRail />);
    expect(today().getAttribute('aria-label')).toBe('Hoje, não foi possível conferir os lembretes');
    const pill = today().querySelector('[data-reminder="unavailable"]')!;
    expect(pill.textContent).toBe('?');
    expect(pill.closest('[aria-hidden="true"]')).toBeTruthy();
    // Neutro: tracejado, no tom secundário, sem a cor de erro nem a do dia.
    expect(pill.className).toContain('border-dashed');
    expect(pill.className).toContain('text-muted-foreground');
    expect(pill.className).not.toMatch(/destructive|primary/);
    fireEvent.click(screen.getByRole('button', { name: 'Recolher menu' }));
    const corner = today().querySelector('[data-reminders="corner"]')!;
    expect(corner.textContent).toBe('?');
    expect(corner.getAttribute('data-reminder')).toBe('unavailable');
    expect(corner.className).not.toMatch(/destructive|primary/);
    fireEvent.focus(today());
    expect(
      (await screen.findAllByText('Hoje, não foi possível conferir os lembretes')).some((node) => !node.closest('a')),
    ).toBe(true);
    unmount();
    mount(<MobileBottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Navegação principal mobile' });
    const link = within(nav).getByRole('link', { name: 'Hoje, não foi possível conferir os lembretes' });
    expect(link.querySelector('[data-reminder="unavailable"]')?.textContent).toBe('?');
  });

  it('celular: o selo fica em "Hoje" da navegação inferior, que leva a Hoje', () => {
    mocks.reminders = { overdue: 2, upcoming: 0, total: 2 };
    mount(<MobileBottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Navegação principal mobile' });
    const link = within(nav).getByRole('link', { name: 'Hoje, 2 atividades vencidas' });
    expect(link.querySelector('[data-reminders="corner"]')?.textContent).toBe('2');
    expect(within(nav).getByRole('link', { name: 'Contatos' }).querySelector('[data-reminders]')).toBeNull();
    fireEvent.click(link);
    expect(screen.getByTestId('where').textContent).toBe('/dashboard');
  });

  it('o link do menu do desktop leva a Hoje', () => {
    mocks.reminders = { overdue: 2, upcoming: 1, total: 3 };
    mount(<AppRail />);
    fireEvent.click(today());
    expect(screen.getByTestId('where').textContent).toBe('/dashboard');
  });
});
