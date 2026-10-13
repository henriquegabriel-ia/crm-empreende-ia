import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OwnerFilterValue } from './OwnerFilterValue';

const people = [
  { id: 'ana', name: 'Ana Souza', email: 'ana@example.test', active: true },
  { id: 'saiu', name: 'Fulano de Tal com Sobrenome Comprido', email: 'saiu@example.test', active: false },
];

// Achado 6 da revisão do item 1.2: o valor exibido do filtro de responsável mantém a marca "(desativado)".
describe('OwnerFilterValue', () => {
  it('mostra os rótulos fixos e o nome de quem está ativo', () => {
    const text = (value: string) => render(<OwnerFilterValue value={value} people={people} />).container.textContent;
    expect(text('all')).toBe('Todos os responsáveis');
    expect(text('unassigned')).toBe('Sem responsável');
    expect(text('ana')).toBe('Ana Souza');
    // Enquanto a equipe carrega, nada (como o Select sem o item).
    expect(text('outra')).toBe('');
  });

  it('para quem foi desativado, o nome corta e a marca fica fora do corte', () => {
    const { container } = render(<OwnerFilterValue value="saiu" people={people} />);
    const [name, mark] = [...container.querySelectorAll('span > span')];
    expect(name).toHaveTextContent('Fulano de Tal com Sobrenome Comprido');
    expect(name).toHaveClass('truncate');
    expect(mark).toHaveTextContent('(desativado)');
    expect(mark).toHaveClass('shrink-0');
    expect(container.textContent).toBe('Fulano de Tal com Sobrenome Comprido (desativado)');
  });
});
