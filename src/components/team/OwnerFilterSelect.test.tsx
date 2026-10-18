import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerFilterSelect } from './OwnerFilterSelect';

// Item 1.14: o seletor de responsável das telas de rotina, com os recortes da tela e o grupo "Pessoas".
const scopes = [
  { value: 'mine', label: 'Minha rotina' },
  { value: 'all', label: 'Toda a organização' },
] as const;
const people = [
  { id: 'bia', name: 'Bia Souza', email: 'bia@example.test', active: true },
  { id: 'fulano', name: 'Fulano Vendedor', email: 'fulano@example.test', active: false },
];

describe('OwnerFilterSelect', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('lista os recortes e, no grupo "Pessoas", as ativas e as desativadas marcadas', () => {
    const onValueChange = vi.fn();
    render(
      <OwnerFilterSelect
        value="mine"
        onValueChange={onValueChange}
        scopes={scopes}
        people={people}
        ariaLabel="Recorte da rotina"
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Recorte da rotina' });
    expect(trigger).toHaveTextContent('Minha rotina');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const listbox = screen.getByRole('listbox');
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Minha rotina', 'Toda a organização', 'Bia Souza', 'Fulano Vendedor (desativado)']);
    expect(within(listbox).getByRole('group')).toHaveTextContent(/^Pessoas/);
    fireEvent.click(screen.getByRole('option', { name: 'Fulano Vendedor (desativado)' }));
    expect(onValueChange).toHaveBeenCalledWith('fulano');
  });

  it('mostra a pessoa escolhida com a marca e, sem pessoas, não mostra o grupo', () => {
    const { unmount } = render(
      <OwnerFilterSelect value="fulano" onValueChange={vi.fn()} scopes={scopes} people={people} ariaLabel="Recorte" />,
    );
    expect(screen.getByRole('combobox', { name: 'Recorte' })).toHaveTextContent('Fulano Vendedor (desativado)');
    unmount();
    render(<OwnerFilterSelect value="all" onValueChange={vi.fn()} scopes={scopes} people={[]} ariaLabel="Recorte" />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Recorte' }), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Minha rotina',
      'Toda a organização',
    ]);
    expect(screen.queryByRole('group')).toBeNull();
  });
});
