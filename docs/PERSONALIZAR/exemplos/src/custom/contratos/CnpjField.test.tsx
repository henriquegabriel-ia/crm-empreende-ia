// Exemplo de docs/PERSONALIZAR/CAMPO.md: o teste do campo "CNPJ" e das regras dele, iguais ao check da migração.
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CnpjField } from './CnpjField';
import { cnpjDigits, cnpjToSave, formatCnpj } from './cnpj';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <CnpjField value={value} onChange={setValue} />;
}
afterEach(cleanup);

describe('CNPJ (exemplo de docs/PERSONALIZAR)', () => {
  it('grava só os 14 dígitos, nulo quando vazio, e recusa outro tamanho como o check do banco', () => {
    expect(cnpjDigits('12.345.678/0001-90')).toBe('12345678000190');
    expect(cnpjToSave('12.345.678/0001-90')).toEqual({ value: '12345678000190', problem: null });
    expect(cnpjToSave('  ')).toEqual({ value: null, problem: null });
    expect(cnpjToSave('1234').problem).toBe('O CNPJ tem 14 dígitos. Confira o número.');
    expect(cnpjToSave('123456780001901').problem).not.toBeNull();
    expect(formatCnpj('12345678000190')).toBe('12.345.678/0001-90');
    expect(formatCnpj(null)).toBe('');
  });

  it('formata ao sair do campo e só então mostra o problema', () => {
    render(<Harness />);
    const input = screen.getByLabelText('CNPJ');
    fireEvent.change(input, { target: { value: '1234' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.blur(input);
    expect(screen.getByRole('alert')).toHaveTextContent('O CNPJ tem 14 dígitos.');
    fireEvent.change(input, { target: { value: '12345678000190' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('12.345.678/0001-90');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
