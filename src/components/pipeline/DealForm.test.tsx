import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DealForm } from './DealForm';
vi.mock('./data', () => ({ errorMessage: (error: Error) => error.message }));
const pipeline = { id: 'p', org_id: 'org', name: 'Comercial', currency: 'BRL', is_default: true };
const stages = [
  { id: 's', org_id: 'org', pipeline_id: 'p', name: 'Proposta', order: 0, win_probability: 50, color: null },
];

describe('formulário de oportunidade', () => {
  it('preserva os campos em falha de gravação e permite tentar novamente', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Falha de conexão')).mockResolvedValueOnce(undefined);
    const close = vi.fn();
    render(
      <DealForm
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[]}
        onSave={save}
        onClose={close}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Nome da oportunidade/), { target: { value: 'Contrato anual' } });
    fireEvent.change(screen.getByLabelText(/Valor \(BRL\)/), { target: { value: '1250,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    await screen.findByText('Falha de conexão');
    expect(screen.getByLabelText(/Nome da oportunidade/)).toHaveValue('Contrato anual');
    expect(screen.getByLabelText(/Valor \(BRL\)/)).toHaveValue('1250,50');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('mostra a prévia em reais enquanto digita e grava o texto no padrão brasileiro', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <DealForm
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[]}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    const value = screen.getByLabelText(/Valor \(BRL\)/);
    fireEvent.change(value, { target: { value: '1.500' } });
    expect(screen.getByText('Prévia: R$ 1.500,00')).toBeVisible();
    fireEvent.change(value, { target: { value: '12.5' } });
    expect(screen.getByText('Prévia: R$ 12,50')).toBeVisible();
    fireEvent.change(value, { target: { value: '1.2345' } });
    expect(screen.getByText(/Formato não reconhecido/)).toBeVisible();
    expect(value).toHaveAccessibleDescription(/Formato não reconhecido/);
    fireEvent.change(value, { target: { value: 'R$ 1.500,00' } });
    fireEvent.change(screen.getByLabelText(/Nome da oportunidade/), { target: { value: 'Contrato anual' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ title: 'Contrato anual', value: 'R$ 1.500,00' });
  });
  it('abre a edição com o valor salvo em formato brasileiro', () => {
    render(
      <DealForm
        deal={{
          id: 'd',
          org_id: 'org',
          pipeline_id: 'p',
          stage_id: 's',
          title: 'Contrato',
          value: 2400,
          currency: 'BRL',
          contact_id: null,
          company_id: null,
          owner_id: null,
          close_date: null,
          probability: 50,
          status: 'open',
          lost_reason: null,
          stage_entered_at: '2026-09-01T10:00:00Z',
          created_at: '2026-09-01T10:00:00Z',
          updated_at: '2026-09-01T10:00:00Z',
        }}
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Valor \(BRL\)/)).toHaveValue('2.400,00');
    expect(screen.getByText('Prévia: R$ 2.400,00')).toBeVisible();
  });
  it('não grava um valor inválido e explica o campo que precisa ser corrigido', async () => {
    const save = vi.fn();
    render(
      <DealForm
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[]}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Nome da oportunidade/), { target: { value: 'Contrato anual' } });
    fireEvent.change(screen.getByLabelText(/Valor \(BRL\)/), { target: { value: '-99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    expect(await screen.findByText(/Informe um valor positivo ou zero/)).toBeVisible();
    expect(save).not.toHaveBeenCalled();
  });
});
