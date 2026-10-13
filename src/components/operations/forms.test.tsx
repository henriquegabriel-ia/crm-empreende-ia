import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaymentForm } from './PaymentForm';
import { AutomationForm } from './AutomationForm';
import { TemplateForm } from './TemplateForm';
import type { Automation } from '@/lib/operation-logic';
vi.mock('./data', () => ({ errorMessage: (error: Error) => error.message }));
const references = { contacts: [], companies: [], deals: [], people: [], pipelines: [], stages: [] };
const scopes = {
  pipelines: [{ id: 'pipeline-1', name: 'Comercial' }],
  stages: [
    { id: 'stage-1', name: 'Entrada', pipeline_id: 'pipeline-1' },
    { id: 'stage-2', name: 'Proposta', pipeline_id: 'pipeline-1' },
    { id: 'stage-other', name: 'Implantação', pipeline_id: 'pipeline-2' },
  ],
};
const activeAutomation: Automation = {
  id: 'automation-1',
  org_id: 'org-1',
  name: 'Proposta enviada',
  trigger_type: 'deal_moved',
  is_active: true,
  task_title: 'Enviar proposta',
  due_days: 2,
  pipeline_id: 'pipeline-1',
  stage_id: 'stage-2',
  created_by: 'owner-1',
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-01T10:00:00.000Z',
};

describe('recuperação de falha nos formulários de operação', () => {
  it('mantém descrição/valor de pagamento e não fecha quando o servidor falha', async () => {
    const close = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error('Falha ao salvar'));
    render(<PaymentForm references={references} onSave={save} onClose={close} />);
    fireEvent.change(screen.getByLabelText('Descrição *'), { target: { value: 'Parcela inicial' } });
    fireEvent.change(screen.getByLabelText('Valor *'), { target: { value: '1200,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar lançamento' }));
    await screen.findByText('Falha ao salvar');
    expect(screen.getByLabelText('Descrição *')).toHaveValue('Parcela inicial');
    expect(screen.getByLabelText('Valor *')).toHaveValue('1200,50');
    expect(close).not.toHaveBeenCalled();
  });
  it('mostra a prévia do valor no padrão brasileiro e recusa formato ambíguo antes de gravar', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<PaymentForm references={references} onSave={save} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Descrição *'), { target: { value: 'Parcela inicial' } });
    const amount = screen.getByLabelText('Valor *');
    fireEvent.change(amount, { target: { value: '1.200,50' } });
    expect(screen.getByText('Prévia: R$ 1.200,50')).toBeVisible();
    expect(amount).toHaveAccessibleDescription(/^Prévia: R\$\s1\.200,50$/);
    fireEvent.change(amount, { target: { value: '1.2345' } });
    expect(screen.getByText(/Formato não reconhecido/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar lançamento' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/maior que zero, como 1\.500,00/);
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: 'R$ 2.000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar lançamento' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({ description: 'Parcela inicial', amount: 'R$ 2.000' });
  });
  it('não ativa automação ao salvar rascunho e mantém configuração após falha', async () => {
    const close = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error('Falha ao salvar'));
    render(<AutomationForm onSave={save} onClose={close} />);
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Primeiro retorno' } });
    fireEvent.change(screen.getByLabelText('Criar uma tarefa com o título *'), {
      target: { value: 'Retornar ao contato' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await screen.findByText('Falha ao salvar');
    expect(screen.getByLabelText('Nome *')).toHaveValue('Primeiro retorno');
    expect(save).toHaveBeenCalledWith({
      name: 'Primeiro retorno',
      trigger_type: 'deal_created',
      task_title: 'Retornar ao contato',
      due_days: '1',
      pipeline_id: '',
      stage_id: '',
    });
    expect(close).not.toHaveBeenCalled();
  });
  it('edita automação ativa sem pausar e preserva o filtro de funil e etapa', async () => {
    const close = vi.fn();
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AutomationForm automation={activeAutomation} scopes={scopes} onSave={save} onClose={close} />);
    expect(screen.getByText('Automação ativa')).toBeVisible();
    expect(screen.getByText(/a automação continua ativa/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /pausar/i })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Funil' })).toHaveTextContent('Comercial');
    expect(screen.getByRole('combobox', { name: 'Etapa de entrada' })).toHaveTextContent('Proposta');
    expect(screen.getByRole('combobox', { name: 'Funil' })).toHaveAccessibleDescription(
      /a tarefa é criada só quando a oportunidade entra nela/,
    );
    expect(screen.getByRole('combobox', { name: 'Etapa de entrada' })).toHaveAccessibleDescription(
      /uma automação ativa é pausada/,
    );
    fireEvent.change(screen.getByLabelText('Criar uma tarefa com o título *'), {
      target: { value: 'Enviar proposta revisada' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith({
      name: 'Proposta enviada',
      trigger_type: 'deal_moved',
      task_title: 'Enviar proposta revisada',
      due_days: '2',
      pipeline_id: 'pipeline-1',
      stage_id: 'stage-2',
    });
  });
  it('explica por que a etapa fica desabilitada sem funil', () => {
    render(
      <AutomationForm
        automation={{ ...activeAutomation, pipeline_id: null, stage_id: null }}
        scopes={scopes}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const stage = screen.getByRole('combobox', { name: 'Etapa de entrada' });
    expect(stage).toBeDisabled();
    expect(stage).toHaveAccessibleDescription(/^Escolha um funil para filtrar por etapa\./);
  });
  it('recusa etapa que não pertence ao funil antes de gravar', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <AutomationForm
        automation={{ ...activeAutomation, stage_id: 'stage-other' }}
        scopes={scopes}
        onSave={save}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A etapa escolhida não pertence ao funil selecionado.');
    expect(save).not.toHaveBeenCalled();
  });
  it('mostra o filtro de funil e etapa só no gatilho de mudança de etapa', () => {
    render(<AutomationForm scopes={scopes} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('combobox', { name: 'Funil' })).not.toBeInTheDocument();
    expect(screen.getByText('Revisão antes de ativar')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeVisible();
  });
  it('preserva o corpo do modelo após erro de gravação', async () => {
    render(<TemplateForm onSave={vi.fn().mockRejectedValue(new Error('Falha ao salvar'))} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Nome do modelo *'), { target: { value: 'Retorno' } });
    fireEvent.change(screen.getByLabelText('Texto do rascunho *'), {
      target: { value: 'Olá! Vamos combinar o próximo passo?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar modelo' }));
    await screen.findByText('Falha ao salvar');
    expect(screen.getByLabelText('Texto do rascunho *')).toHaveValue('Olá! Vamos combinar o próximo passo?');
  });
});

// Item 1.9: "Inserir variável" põe a chave no cursor do campo usado, e as desconhecidas são avisadas sem impedir salvar.
describe('variáveis no formulário do modelo', () => {
  it('insere a variável no cursor do texto e do assunto, e lista as variáveis do CRM', async () => {
    render(<TemplateForm onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText(/O envio externo ainda não está conectado/)).not.toBeInTheDocument();
    expect(screen.getByText('{{primeiro_nome}}')).toBeInTheDocument();
    const body = screen.getByLabelText('Texto do rascunho *') as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: 'Olá, !' } });
    fireEvent.focus(body);
    body.setSelectionRange(5, 5);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inserir variável' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Primeiro nome do contato/ }));
    expect(body).toHaveValue('Olá, {{primeiro_nome}}!');
    // O foco volta ao campo, com o cursor depois da variável, no quadro seguinte.
    await waitFor(() => expect(body).toHaveFocus());
    expect(body.selectionStart).toBe('Olá, {{primeiro_nome}}'.length);
    const subject = screen.getByLabelText('Assunto (opcional)');
    fireEvent.focus(subject);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inserir variável' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Empresa/ }));
    expect(subject).toHaveValue('{{empresa}}');
  });

  it('avisa a variável desconhecida e salva mesmo assim', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<TemplateForm onSave={save} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Nome do modelo *'), { target: { value: 'Cupom' } });
    fireEvent.change(screen.getByLabelText('Texto do rascunho *'), { target: { value: 'Use o cupom {{cupom}}.' } });
    expect(screen.getByRole('status')).toHaveTextContent('O CRM não reconhece {{cupom}}.');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar modelo' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ name: 'Cupom', subject: '', body: 'Use o cupom {{cupom}}.' }),
    );
  });
});
