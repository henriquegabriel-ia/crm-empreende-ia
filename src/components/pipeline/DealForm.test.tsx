import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { localDateKey } from '@/lib/dates';
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
          closed_at: null,
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
  it('probabilidade em branco usa a da etapa e um valor digitado vira manual', async () => {
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
    const probability = screen.getByLabelText('Probabilidade (%)');
    expect(probability).toHaveValue(null);
    expect(probability).toHaveAccessibleDescription('Da etapa: 50%');
    fireEvent.change(probability, { target: { value: '30' } });
    expect(probability).toHaveAccessibleDescription('Valor desta oportunidade. Apague para usar a da etapa (50%).');
    fireEvent.change(probability, { target: { value: '' } });
    expect(probability).toHaveAccessibleDescription('Da etapa: 50%');
    fireEvent.change(screen.getByLabelText(/Nome da oportunidade/), { target: { value: 'Contrato anual' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar oportunidade' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ probability: '', closed_at: '' });
    expect(screen.queryByLabelText(/Fechada em/)).toBeNull();
  });
  it('edita a data de fechamento da oportunidade ganha, sem aceitar dia futuro', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const created = new Date(2026, 7, 10, 15).toISOString();
    render(
      <DealForm
        deal={{
          id: 'd',
          org_id: 'org',
          pipeline_id: 'p',
          stage_id: 's',
          title: 'Contrato ganho',
          value: 2400,
          currency: 'BRL',
          contact_id: null,
          company_id: null,
          owner_id: 'owner',
          close_date: null,
          probability: 100,
          status: 'won',
          lost_reason: null,
          closed_at: new Date(2026, 9, 5, 16).toISOString(),
          stage_entered_at: created,
          created_at: created,
          updated_at: created,
        }}
        pipeline={pipeline}
        stages={stages}
        contacts={[]}
        companies={[]}
        people={[{ id: 'owner', full_name: 'Pessoa' }]}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Probabilidade (%)')).toBeDisabled();
    expect(screen.getByLabelText('Probabilidade (%)')).toHaveAccessibleDescription('Definida pela situação: 100%.');
    const closedAt = screen.getByLabelText('Fechada em *');
    expect(closedAt).toHaveAccessibleDescription(
      /Dia real em que a oportunidade foi ganha, que pode diferir da previsão/,
    );
    expect(closedAt).toHaveValue('2026-10-05');
    expect(closedAt).toHaveAttribute('min', '2026-08-10');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    fireEvent.change(closedAt, { target: { value: localDateKey(tomorrow) } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('A data de fechamento não pode estar no futuro.')).toBeVisible();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(closedAt, { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ closed_at: '2026-09-30', probability: '100' });
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
