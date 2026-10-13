import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };
const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  requests: [] as { table: string; op: string; filters: [string, unknown][]; patch?: unknown }[],
  version: 0,
  success: vi.fn(),
  /** Erro que o PostgREST devolve quando o fetch rejeita (sem conexão); nenhuma linha muda. */
  networkError: null as null | { message: string; details: string; hint: string; code: string },
  /** Próxima versão de updated_at, como o now() de cada transação. */
  nextVersion() {
    this.version += 1;
    return `2026-10-11T12:00:${String(this.version).padStart(2, '0')}.000001+00:00`;
  },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1', org_id: 'org-1', name: 'Pessoa', email: 'pessoa@example.test' },
    refreshProfile: vi.fn(),
  }),
}));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => ({ canManage: true }) }));
vi.mock('@/components/shell/PageScaffold', () => ({
  PageScaffold: ({ title, toolbar, children }: { title: ReactNode; toolbar?: ReactNode; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {toolbar}
      {children}
    </main>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: vi.fn() } }));
/**
 * PostgREST em memória: SELECT, INSERT e UPDATE com filtros de igualdade. Como o gatilho touch_updated_at, todo
 * UPDATE renova updated_at; um UPDATE filtrado por uma versão antiga não encontra linha.
 */
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: {
    from(table: string) {
      let op = 'select',
        patch: Record<string, unknown> = {},
        inserted: Record<string, unknown> = {};
      const filters: [string, unknown][] = [];
      const run = () => {
        const rows = (mocks.tables[table] ??= []);
        mocks.requests.push({ table, op, filters: [...filters], patch: op === 'update' ? patch : undefined });
        if (op === 'insert') {
          const row = { id: `${table}-new-${rows.length + 1}`, updated_at: mocks.nextVersion(), ...inserted };
          rows.push(row);
          return [{ ...row }];
        }
        const matched = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
        if (op === 'update') matched.forEach((row) => Object.assign(row, patch, { updated_at: mocks.nextVersion() }));
        return matched.map((row) => ({ ...row }));
      };
      const builder = {
        select: () => builder,
        order: () => builder,
        range: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        update: (fields: Record<string, unknown>) => {
          op = 'update';
          patch = fields;
          return builder;
        },
        insert: (fields: Record<string, unknown>) => {
          op = 'insert';
          inserted = fields;
          return builder;
        },
        single: async () => {
          const rows = run();
          return rows.length === 1
            ? { data: rows[0], error: null }
            : { data: null, error: { code: 'PGRST116', details: `${rows.length} rows` } };
        },
        maybeSingle: async () =>
          mocks.networkError ? { data: null, error: mocks.networkError } : { data: run()[0] ?? null, error: null },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: run(), error: null }).then(resolve, reject),
      };
      return builder;
    },
  },
}));
import Settings from './Settings';
import { OFFLINE_REQUEST_MESSAGE } from '@/lib/offline';

const V1 = '2026-10-11T11:00:00.123456+00:00';
function seed() {
  mocks.version = 0;
  mocks.requests = [];
  mocks.tables = {
    organizations: [{ id: 'org-1', name: 'Organização de Teste' }],
    pipelines: [{ id: 'pipeline-1', org_id: 'org-1', name: 'Comercial', is_default: true, updated_at: V1 }],
    pipeline_stages: [
      {
        id: 'stage-1',
        org_id: 'org-1',
        pipeline_id: 'pipeline-1',
        name: 'Entrada',
        order: 0,
        win_probability: 10,
        updated_at: V1,
      },
    ],
    risk_rules: [
      {
        id: 'rule-1',
        org_id: 'org-1',
        name: 'Atividades vencidas',
        type: 'overdue',
        enabled: true,
        priority: 1,
        threshold_days: 7,
        updated_at: V1,
      },
      {
        id: 'rule-2',
        org_id: 'org-1',
        name: 'Oportunidades paradas',
        type: 'stale_deal',
        enabled: true,
        priority: 3,
        threshold_days: 14,
        updated_at: V1,
      },
    ],
  };
}
const row = (table: string, id: string) => mocks.tables[table].find((item) => item.id === id)!;
/** Outra pessoa salva o registro: os campos mudam e a versão avança, como no banco. */
function colleagueSaves(table: string, id: string, fields: Record<string, unknown>) {
  Object.assign(row(table, id), fields, { updated_at: mocks.nextVersion() });
}
const updates = (table: string) =>
  mocks.requests.filter((request) => request.table === table && request.op === 'update');
function mount(tab: string) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter
        initialEntries={[`/settings?tab=${tab}`]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function ruleForm(name: string) {
  return (await screen.findByRole('heading', { name })).closest('form')!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.networkError = null;
  seed();
});
afterEach(cleanup);

describe('Configurações: concorrência em funis e etapas', () => {
  it('etapa alterada por outra pessoa mostra o conflito, preserva o preenchimento e não sobrescreve', async () => {
    mount('pipelines');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Entrada' }));
    let dialog = screen.getByRole('dialog', { name: 'Configurar etapa' });
    fireEvent.change(within(dialog).getByLabelText('Nome'), { target: { value: 'Minha etapa' } });
    colleagueSaves('pipeline_stages', 'stage-1', { name: 'Etapa do colega', win_probability: 30 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Esta etapa mudou ou não está mais disponível. Seu preenchimento foi preservado',
    );
    expect(updates('pipeline_stages')[0].filters).toContainEqual(['updated_at', V1]);
    expect(row('pipeline_stages', 'stage-1')).toMatchObject({ name: 'Etapa do colega', win_probability: 30 });
    expect(within(dialog).getByLabelText('Nome')).toHaveValue('Minha etapa');
    expect(mocks.success).not.toHaveBeenCalled();
    // Reabrir carrega a versão atual, que pode ser salva.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Etapa do colega' }));
    dialog = screen.getByRole('dialog', { name: 'Configurar etapa' });
    expect(within(dialog).getByLabelText('Nome')).toHaveValue('Etapa do colega');
    fireEvent.change(within(dialog).getByLabelText('Nome'), { target: { value: 'Minha etapa' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.success).toHaveBeenCalledWith('Etapa salva');
    expect(row('pipeline_stages', 'stage-1')).toMatchObject({ name: 'Minha etapa', win_probability: 30 });
  });

  it('sem conexão, a gravação mostra que nada foi salvo e preserva o preenchimento', async () => {
    mount('pipelines');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Entrada' }));
    const dialog = screen.getByRole('dialog', { name: 'Configurar etapa' });
    fireEvent.change(within(dialog).getByLabelText('Nome'), { target: { value: 'Etapa sem conexão' } });
    mocks.networkError = {
      message: `OfflineRequestError: ${OFFLINE_REQUEST_MESSAGE}`,
      details: '',
      hint: '',
      code: '',
    };
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      `${OFFLINE_REQUEST_MESSAGE} Seu preenchimento foi preservado.`,
    );
    expect(within(dialog).getByLabelText('Nome')).toHaveValue('Etapa sem conexão');
    expect(row('pipeline_stages', 'stage-1').name).toBe('Entrada');
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('funil renomeado por outra pessoa mostra o conflito em vez de sobrescrever', async () => {
    mount('pipelines');
    fireEvent.click(await screen.findByRole('button', { name: 'Renomear funil' }));
    const dialog = screen.getByRole('dialog', { name: 'Configurar funil' });
    fireEvent.change(within(dialog).getByLabelText('Nome'), { target: { value: 'Meu funil' } });
    colleagueSaves('pipelines', 'pipeline-1', { name: 'Funil do colega' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Este funil mudou ou não está mais disponível. Seu preenchimento foi preservado',
    );
    expect(updates('pipelines')[0].filters).toEqual([
      ['id', 'pipeline-1'],
      ['org_id', 'org-1'],
      ['updated_at', V1],
    ]);
    expect(row('pipelines', 'pipeline-1').name).toBe('Funil do colega');
    expect(within(dialog).getByLabelText('Nome')).toHaveValue('Meu funil');
  });

  it('etapa nova é criada sem guarda de versão e fecha o diálogo', async () => {
    mount('pipelines');
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar etapa' }));
    const dialog = screen.getByRole('dialog', { name: 'Configurar etapa' });
    fireEvent.change(within(dialog).getByLabelText('Nome'), { target: { value: 'Proposta' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.tables.pipeline_stages.map((stage) => stage.name)).toEqual(['Entrada', 'Proposta']);
    expect(mocks.success).toHaveBeenCalledWith('Etapa salva');
  });
});

describe('Configurações: concorrência nas regras da fila de atenção', () => {
  it('regra alterada por outra pessoa mostra o conflito e permite carregar a versão atual', async () => {
    mount('attention');
    const form = await ruleForm('Atividades vencidas');
    fireEvent.change(within(form).getByLabelText('Prioridade'), { target: { value: '2' } });
    colleagueSaves('risk_rules', 'rule-1', { priority: 3, enabled: false });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar regra' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta regra mudou ou não está mais disponível');
    expect(updates('risk_rules')[0].filters).toContainEqual(['updated_at', V1]);
    expect(row('risk_rules', 'rule-1')).toMatchObject({ priority: 3, enabled: false });
    // A escolha da pessoa continua no formulário até ela decidir carregar a versão atual.
    expect(within(form).getByLabelText('Prioridade')).toHaveValue('2');
    const notice = await within(form).findByRole('status');
    expect(notice).toHaveTextContent('Outra pessoa alterou esta regra');
    fireEvent.click(within(notice).getByRole('button', { name: 'Carregar versão atual' }));
    expect(within(form).getByLabelText('Prioridade')).toHaveValue('3');
    expect(within(form).getByRole('checkbox', { name: 'Regra ativa' })).not.toBeChecked();
    expect(within(form).queryByRole('status')).not.toBeInTheDocument();
    // Agora a gravação parte da versão atual e é aceita.
    fireEvent.change(within(form).getByLabelText('Prioridade'), { target: { value: '2' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar regra' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Regra atualizada'));
    expect(row('risk_rules', 'rule-1')).toMatchObject({ priority: 2, enabled: false });
  });

  it('salvar a mesma regra duas vezes seguidas usa a versão nova, sem falso conflito', async () => {
    mount('attention');
    const form = await ruleForm('Atividades vencidas');
    fireEvent.change(within(form).getByLabelText('Prioridade'), { target: { value: '2' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar regra' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Salvar regra' })).toBeEnabled());
    const saved = row('risk_rules', 'rule-1').updated_at;
    fireEvent.change(within(form).getByLabelText('Prioridade'), { target: { value: '3' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar regra' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(2));
    expect(updates('risk_rules')[1].filters).toContainEqual(['updated_at', saved]);
    expect(row('risk_rules', 'rule-1').priority).toBe(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('regra sem mudanças locais acompanha a versão recarregada', async () => {
    mount('attention');
    const stale = await ruleForm('Oportunidades paradas');
    const overdue = await ruleForm('Atividades vencidas');
    colleagueSaves('risk_rules', 'rule-2', { threshold_days: 30 });
    // Salvar outra regra recarrega a lista com a versão do colega.
    fireEvent.change(within(overdue).getByLabelText('Prioridade'), { target: { value: '2' } });
    fireEvent.click(within(overdue).getByRole('button', { name: 'Salvar regra' }));
    await waitFor(() => expect(within(stale).getByLabelText('Dias sem atualização')).toHaveValue(30));
    expect(within(stale).queryByRole('status')).not.toBeInTheDocument();
    fireEvent.change(within(stale).getByLabelText('Prioridade'), { target: { value: '1' } });
    fireEvent.click(within(stale).getByRole('button', { name: 'Salvar regra' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(2));
    expect(row('risk_rules', 'rule-2')).toMatchObject({ priority: 1, threshold_days: 30 });
  });
});

// Item 1.6: o nome da organização identifica a empresa nos dados; a marca (entrada, aba e e-mails) é da implantação.
describe('Configurações: nome da organização e marca do CRM', () => {
  it('a dica abaixo do nome explica que a marca não muda aqui', async () => {
    mount('organization');
    const field = await screen.findByRole('textbox', { name: 'Nome da organização' });
    expect(field).toHaveAccessibleDescription(
      'O nome e o logo da tela de entrada, da aba do navegador e dos e-mails de acesso vêm da configuração da implantação, feita por quem publicou o CRM, e não mudam aqui.',
    );
    // Revisão do item 1.6: a dica fica junto do campo (space-y-2), como a da probabilidade da etapa, e não solta no
    // espaçamento do formulário.
    const hint = document.getElementById(field.getAttribute('aria-describedby')!)!;
    expect(hint.parentElement).toHaveClass('space-y-2');
    expect(hint.parentElement).toContainElement(field);
  });
});
