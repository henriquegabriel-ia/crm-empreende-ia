import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider, type Query } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Company, Contact, RelationshipActivity, RelationshipData } from '@/lib/contact-model';
import { InteractionPromptContext } from '@/components/channels/interaction-context';

const mocks = vi.hoisted(() => ({ from: vi.fn(), success: vi.fn(), canWrite: true, canManage: false }));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({
  useCrmPermissions: () => ({ canWrite: mocks.canWrite, canManage: mocks.canManage }),
}));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: mocks.from } }));
vi.mock('sonner', () => ({ toast: { success: mocks.success } }));

import { Relationship360 } from './Relationship360';

const contact = {
  id: 'contact-1',
  org_id: 'org-1',
  first_name: 'Mariana',
  last_name: 'Alves',
  email: null,
  phone: null,
  company_id: null,
  owner_id: null,
  status: 'lead',
  job_title: null,
  source: null,
  notes: null,
  created_at: '2026-10-01T10:00:00.000000+00:00',
  updated_at: '2026-10-01T10:00:00.000000+00:00',
} as Contact;
function activity(fields: Partial<RelationshipActivity> = {}): RelationshipActivity {
  return {
    id: 'activity-1',
    org_id: 'org-1',
    title: 'Retorno da proposta',
    body: null,
    type: 'task',
    user_id: null,
    contact_id: 'contact-1',
    company_id: null,
    deal_id: null,
    due_date: '2099-01-01T12:00:00.000000+00:00',
    end_date: null,
    completed_at: null,
    outcome: null,
    created_by: null,
    created_at: '2026-10-01T10:00:00.000000+00:00',
    updated_at: '2026-10-01T10:00:00.123456+00:00',
    ...fields,
  };
}
/** Atualização condicional como no PostgreSQL: só grava quando todos os filtros batem. */
function database(row: RelationshipActivity) {
  const state = { row: { ...row }, filters: [] as [string, unknown][] };
  mocks.from.mockImplementation(() => {
    let patch: Partial<RelationshipActivity> = {};
    const chain = {
      update: (fields: Partial<RelationshipActivity>) => {
        patch = fields;
        state.filters = [];
        return chain;
      },
      eq: (column: string, value: unknown) => {
        state.filters.push([column, value]);
        return chain;
      },
      select: () => chain,
      single: async () => ({ data: { id: state.row.id }, error: null }),
      maybeSingle: async () => {
        if (!state.filters.every(([column, value]) => state.row[column as keyof RelationshipActivity] === value))
          return { data: null, error: null };
        Object.assign(state.row, patch, { updated_at: '2026-10-01T10:05:00.000001+00:00' });
        return { data: { id: state.row.id }, error: null };
      },
    };
    return chain;
  });
  return state;
}
function mount(shown: RelationshipActivity, members: RelationshipData['members'] = [], record = contact) {
  const data: RelationshipData = { contacts: [record], companies: [], deals: [], activities: [shown], members };
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(cache, 'invalidateQueries');
  function Providers({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={cache}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  render(<Relationship360 kind="contacts" record={record} data={data} onClose={vi.fn()} onEdit={vi.fn()} />, {
    wrapper: Providers,
  });
  return { invalidate };
}
const timelineItem = () => screen.getByRole('heading', { name: 'Retorno da proposta' }).closest('li')!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canWrite = true;
  mocks.canManage = false;
});
afterEach(cleanup);

describe('ficha 360: responsável desativado (item 1.2)', () => {
  it('marca "(desativado)" no responsável do cadastro, na próxima ação e na linha do tempo', () => {
    const shown = activity({ user_id: 'saiu' });
    database(shown);
    mount(shown, [{ id: 'saiu', name: 'Fulano', email: 'fulano@example.test', active: false }], {
      ...contact,
      owner_id: 'saiu',
    });
    expect(screen.getAllByText(/Fulano \(desativado\)/).length).toBeGreaterThanOrEqual(2);
    expect(within(timelineItem()).getByText(/Fulano \(desativado\)/)).toBeInTheDocument();
  });
});

describe('ficha 360: concluir e reabrir atividades', () => {
  it('conclui pela mesma gravação de useActivityActions, com a versão exibida', async () => {
    const shown = activity();
    const state = database(shown);
    mount(shown);
    fireEvent.click(within(timelineItem()).getByRole('button', { name: 'Concluir' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Atividade concluída'));
    expect(mocks.from).toHaveBeenCalledWith('activities');
    expect(state.filters).toEqual([
      ['org_id', 'org-1'],
      ['id', 'activity-1'],
      ['updated_at', '2026-10-01T10:00:00.123456+00:00'],
    ]);
    expect(state.row.completed_at).not.toBeNull();
  });

  it('atividade concluída por outra pessoa mostra o conflito em vez de desfazer a conclusão', async () => {
    const shown = activity();
    const state = database(shown);
    // Um colega concluiu a atividade depois que a ficha carregou.
    Object.assign(state.row, {
      completed_at: '2026-10-01T10:03:00.000000+00:00',
      updated_at: '2026-10-01T10:03:00.000001+00:00',
    });
    const current = { ...state.row };
    const { invalidate } = mount(shown);
    fireEvent.click(within(timelineItem()).getByRole('button', { name: 'Concluir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta atividade mudou ou não está mais disponível');
    expect(state.row).toEqual(current);
    expect(mocks.success).not.toHaveBeenCalled();
    // Recarrega o snapshot (invalidação por chave) para a próxima abertura mostrar a versão atual; o papel da pessoa fica.
    const reloads = (queryKey: unknown[]) =>
      invalidate.mock.calls.some(([filters]) => filters?.predicate?.({ queryKey } as unknown as Query));
    expect(reloads(['crm', 'org', 'snapshot', 'user'])).toBe(true);
    expect(reloads(['crm', 'org', 'permissions', 'user'])).toBe(false);
  });

  it('reabrir uma atividade alterada por outra pessoa também é recusado', async () => {
    const shown = activity({ completed_at: '2026-10-01T10:01:00.000000+00:00' });
    const state = database(shown);
    Object.assign(state.row, { title: 'Retorno revisado', updated_at: '2026-10-01T10:04:00.000001+00:00' });
    mount(shown);
    fireEvent.click(within(timelineItem()).getByRole('button', { name: 'Reabrir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta atividade mudou');
    expect(state.row.completed_at).toBe('2026-10-01T10:01:00.000000+00:00');
    expect(mocks.success).not.toHaveBeenCalled();
  });
});

// Item 1.9: telefone no formato brasileiro, "Último contato", o resultado na linha do tempo, o filtro por tipo e
// "Concluir e agendar a próxima".
describe('ficha 360: canais (item 1.9)', () => {
  function mountWith(activities: RelationshipActivity[], record: Contact | Company = contact) {
    const kind = 'first_name' in record ? 'contacts' : 'companies';
    const value = {
      enabled: true,
      pending: [],
      track: vi.fn(),
      pendingFor: vi.fn(),
      dismiss: vi.fn(),
      subjectOf: vi.fn(),
      openDialog: vi.fn(),
    };
    const data: RelationshipData = {
      contacts: kind === 'contacts' ? [record as Contact] : [],
      companies: kind === 'companies' ? [record as Company] : [],
      deals: [],
      activities,
      members: [{ id: 'user-1', name: 'Carla Dias', email: 'carla@example.test' }],
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <InteractionPromptContext.Provider value={value}>
            <Relationship360 kind={kind} record={record} data={data} onClose={vi.fn()} onEdit={vi.fn()} />
          </InteractionPromptContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return value;
  }

  it('mostra o telefone formatado, sem o link mailto antigo, e a barra de canais', () => {
    mountWith([], { ...contact, phone: '+5511999990000', email: 'mariana@example.test' });
    expect(screen.getByText('(11) 99999-0000')).toBeInTheDocument();
    expect(screen.queryByText('+5511999990000')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'mariana@example.test' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Canais de Mariana Alves' })).toBeInTheDocument();
  });

  it('"Último contato" é a interação concluída mais recente, com o resultado, a data e quem fez', () => {
    mountWith([
      activity({ id: 'note', type: 'note', title: 'Nota', completed_at: '2026-10-05T12:00:00Z' }),
      activity({
        id: 'call',
        type: 'call',
        title: 'Ligação',
        outcome: 'no_answer',
        user_id: 'user-1',
        completed_at: '2026-10-04T12:00:00Z',
      }),
    ]);
    const last = screen.getByText('Último contato').nextElementSibling!;
    expect(last.textContent).toMatch(/^Ligação · Não atendeu · \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} · Carla Dias$/);
  });

  it('a linha do tempo mostra o resultado da ligação e se filtra por tipo', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    mountWith([
      activity({
        id: 'call',
        type: 'call',
        title: 'Ligação feita',
        outcome: 'voicemail',
        completed_at: '2026-10-04T12:00:00Z',
      }),
      activity({ id: 'visit', type: 'visit', title: 'Visita feita', completed_at: '2026-10-03T12:00:00Z' }),
    ]);
    expect(screen.getByText('Ligação · Concluída · Caixa postal')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Filtrar histórico'), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Todo o histórico',
      'Ações pendentes',
      'Ações concluídas',
      'Ligações',
      'WhatsApp',
      'E-mails',
      'Reuniões',
      'Visitas',
      'Notas',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'Visitas' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Ligação feita' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Visita feita' })).toBeInTheDocument();
  });

  it('a linha do tempo põe a interação na data em que aconteceu, e não na do registro', () => {
    mountWith([
      // Ligação de 02/10 registrada só em 13/10; tarefa pendente cadastrada em 05/10.
      activity({
        id: 'late',
        type: 'call',
        title: 'Ligação de ontem',
        outcome: 'answered',
        due_date: '2026-10-02T15:00:00Z',
        completed_at: '2026-10-02T15:00:00Z',
        created_at: '2026-10-13T09:00:00Z',
      }),
      activity({ id: 'task', title: 'Mandar proposta', created_at: '2026-10-05T09:00:00Z' }),
    ]);
    const history = screen.getByRole('heading', { name: /^Histórico/ }).closest('section')!;
    const titles = within(history)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual(['Mandar proposta', 'Ligação de ontem']);
    const late = within(history).getByRole('heading', { name: 'Ligação de ontem' }).closest('li')!;
    expect(late.querySelector('time')).toHaveAttribute('dateTime', '2026-10-02T15:00:00Z');
    expect(late.querySelector('time')!.textContent).toMatch(/^02\/10\/2026/);
  });

  it('o histórico vazio sugere os canais a quem edita e só informa a quem tem Somente leitura', () => {
    mountWith([]);
    expect(
      screen.getByText(
        'Use “WhatsApp”, “E-mail” ou “Ligar” e registre a conversa, ou crie uma nota ou o próximo passo.',
      ),
    ).toBeInTheDocument();
    cleanup();
    mocks.canWrite = false;
    mountWith([]);
    expect(screen.getByText('Ainda não há atividades neste relacionamento.')).toBeInTheDocument();
    expect(screen.queryByText(/registre a conversa/)).not.toBeInTheDocument();
  });

  it('ficha marcada “Não contatar”: a próxima ação e o histórico vazios não pedem um novo contato', () => {
    const mark = { do_not_contact: true, do_not_contact_at: '2026-10-12T15:00:00Z' };
    mountWith([], { ...contact, ...mark });
    const next = () => screen.getByRole('heading', { name: 'Próxima ação' }).closest('section')!;
    // Item 1.10: o banco recusa a ação de contato, e "Já aconteceu" registra o que passou.
    expect(next()).toHaveTextContent(
      'Sem próxima ação com prazo. Este contato está marcado “Não contatar”: o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele, e a fila de atenção não cobra uma próxima ação. Registre o que acontecer numa nota ou numa atividade com “Já aconteceu”.',
    );
    expect(next()).not.toHaveTextContent('Concluir e agendar a próxima');
    expect(
      screen.getByText('Este contato está marcado “Não contatar”. Use “Registrar nota” para guardar o que acontecer.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/registre a conversa/)).not.toBeInTheDocument();
    cleanup();
    // Na empresa, a marca vale só para o telefone dela.
    const company = {
      id: 'company-1',
      org_id: 'org-1',
      name: 'Padaria Alves',
      phone: '+551130000000',
      industry: null,
      website: null,
      owner_id: null,
      created_at: '2026-10-01T10:00:00.000000+00:00',
      updated_at: '2026-10-01T10:00:00.000000+00:00',
      ...mark,
    } as Company;
    mountWith([], company);
    expect(next()).toHaveTextContent(
      'A empresa está marcada “Não contatar”: o CRM não agenda ligação nem WhatsApp para o telefone dela. Os contatos dela continuam liberados, a menos que tenham a própria marca.',
    );
    expect(
      screen.getByText(
        'A empresa está marcada “Não contatar”: o telefone dela fica desligado. Use “Registrar nota” ou as fichas dos contatos liberados.',
      ),
    ).toBeInTheDocument();
  });

  it('"Concluir e agendar a próxima" abre o registro com a próxima ação obrigatória', () => {
    const shown = activity({ type: 'call' });
    const value = mountWith([shown]);
    const next = screen.getByRole('heading', { name: 'Próxima ação' }).closest('section')!;
    fireEvent.click(within(next).getByRole('button', { name: 'Concluir e agendar a próxima' }));
    expect(value.openDialog).toHaveBeenCalledWith({ mode: 'complete', activity: shown, requireNext: true });
    // Achado 8 da revisão do item 1.9: os três botões da próxima ação têm o alvo de toque do celular.
    for (const name of ['Concluir', 'Concluir e agendar a próxima', 'Reagendar'])
      expect(within(next).getByRole('button', { name }), name).toHaveClass('eia-touch-target');
  });

  // Achado 1 da revisão do item 1.9: a "Próxima ação" de WhatsApp tem o botão do canal, com a atividade de origem.
  it('a "Próxima ação" de WhatsApp com o número mostra o botão "WhatsApp"', () => {
    mountWith([activity({ type: 'whatsapp', title: 'Mandar proposta' })], { ...contact, phone: '+5511999990000' });
    const next = screen.getByRole('heading', { name: 'Próxima ação' }).closest('section')!;
    expect(within(next).getByRole('button', { name: 'WhatsApp' })).toBeEnabled();
    expect(within(next).queryByRole('button', { name: 'Ligar' })).not.toBeInTheDocument();
  });
});

// Item 1.10: a base legal no resumo, a seção "Privacidade" para donos e administradores e o contato anonimizado.
describe('ficha 360: privacidade (item 1.10)', () => {
  const legal = {
    legal_basis: 'consent',
    legal_basis_note: 'Marcou a caixa do site em 10/10/2026.',
    legal_basis_at: '2026-10-12T15:00:00Z',
    legal_basis_by: 'user-1',
    anonymized_at: null,
    anonymized_by: null,
  };
  const members = [{ id: 'user-1', name: 'Carla Dias', email: 'carla@example.test' }];
  function mountPrivacy(record: Contact, activities: RelationshipActivity[] = []) {
    // privacy_actions: o último registro do contato, lido só por donos e administradores.
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    mocks.from.mockReturnValue(chain);
    const data: RelationshipData = { contacts: [record], companies: [], deals: [], activities, members };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Relationship360 kind="contacts" record={record} data={data} onClose={vi.fn()} onEdit={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }
  const summary = () => screen.getByText('Base legal').closest('div')!;

  it('a base legal aparece para todos os papéis, com o registro e o carimbo do banco', () => {
    mocks.canWrite = false;
    mountPrivacy({ ...contact, ...legal } as Contact);
    expect(summary()).toHaveTextContent('Consentimento');
    expect(summary()).toHaveTextContent('Marcou a caixa do site em 10/10/2026.');
    expect(summary()).toHaveTextContent(/Registrada por Carla Dias em \d{2}\/\d{2}\/2026\./);
    expect(summary()).not.toHaveTextContent('Defina em');
  });

  it('"Não informada" vem com a dica para quem edita, e some sem a coluna (banco sem a migração)', () => {
    mountPrivacy({ ...contact, ...legal, legal_basis: 'not_informed', legal_basis_note: null } as Contact);
    expect(summary()).toHaveTextContent('Não informada');
    expect(summary()).toHaveTextContent('Defina em “Editar cadastro”.');
    expect(summary()).not.toHaveTextContent('Registrada');
    cleanup();
    mountPrivacy(contact);
    expect(screen.queryByText('Base legal')).not.toBeInTheDocument();
  });

  it('a seção "Privacidade" é só de donos e administradores', async () => {
    mountPrivacy({ ...contact, ...legal } as Contact);
    expect(screen.queryByRole('heading', { name: 'Privacidade' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exportar dados deste contato' })).not.toBeInTheDocument();
    cleanup();
    mocks.canManage = true;
    mountPrivacy({ ...contact, ...legal } as Contact);
    const section = screen.getByRole('heading', { name: 'Privacidade' }).closest('section')!;
    expect(section).toHaveAttribute('data-tour', '360-privacy');
    expect(within(section).getByRole('button', { name: 'Exportar dados deste contato' })).toBeEnabled();
    expect(within(section).getByRole('button', { name: 'Anonimizar contato' })).toBeEnabled();
    expect(await within(section).findByText('Nenhuma exportação ou anonimização registrada.')).toBeInTheDocument();
    // A seção vem antes de "Excluir cadastro".
    const remove = screen.getByRole('button', { name: 'Excluir cadastro' });
    expect(section.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('num banco sem a migração, a seção explica o que falta e desabilita os botões', () => {
    mocks.canManage = true;
    mountPrivacy(contact);
    const section = screen.getByRole('heading', { name: 'Privacidade' }).closest('section')!;
    expect(within(section).getByRole('button', { name: 'Exportar dados deste contato' })).toBeDisabled();
    expect(within(section).getByRole('button', { name: 'Anonimizar contato' })).toHaveAccessibleDescription(
      'Este CRM ainda não tem a atualização de privacidade (LGPD). Peça a quem administra para aplicar a migração mais recente.',
    );
  });

  it('o contato anonimizado: a faixa, sem canais, sem editar, sem criar ação, sem "Privacidade" e sem reabrir', () => {
    mocks.canManage = true;
    const anonymized = {
      ...contact,
      ...legal,
      first_name: 'Contato anonimizado',
      last_name: null,
      legal_basis_note: null,
      do_not_contact: true,
      do_not_contact_at: '2026-10-13T12:00:00Z',
      anonymized_at: '2026-10-13T12:00:00Z',
      anonymized_by: 'user-1',
    } as Contact;
    mountPrivacy(anonymized, [
      activity({
        id: 'call',
        type: 'call',
        title: 'Ligação (contato anonimizado)',
        completed_at: '2026-10-05T12:00:00Z',
      }),
      activity({ id: 'note', type: 'note', title: 'Nota (contato anonimizado)', completed_at: '2026-10-04T12:00:00Z' }),
    ]);
    const band = screen.getByRole('region', { name: 'Contato anonimizado' });
    expect(band).toHaveTextContent(
      /^Contato anonimizadoAnonimizado por Carla Dias em \d{2}\/\d{2}\/2026\. Os dados pessoais foram apagados/,
    );
    expect(screen.queryByRole('region', { name: 'Não contatar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Canais de/ })).not.toBeInTheDocument();
    for (const name of [
      'Editar cadastro',
      'Criar ação',
      'Registrar nota',
      'Marcar como não contatar',
      'Exportar dados deste contato',
      'Anonimizar contato',
      'Editar',
      'Reabrir',
    ])
      expect(screen.queryByRole('button', { name }), name).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ligação (contato anonimizado)' })).toBeInTheDocument();
    const next = screen.getByRole('heading', { name: 'Próxima ação' }).closest('section')!;
    expect(next).toHaveTextContent('Sem próxima ação. O contato foi anonimizado, e o CRM não agenda ações com ele.');
    // "Excluir cadastro" segue as regras de sempre (aqui, desabilitado pelos vínculos).
    expect(screen.getByRole('button', { name: 'Excluir cadastro' })).toBeDisabled();
  });

  it('na ficha da empresa, a atividade de um contato anonimizado também fica sem "Editar" e sem "Reabrir"', () => {
    const anonymized = {
      ...contact,
      id: 'gone',
      first_name: 'Contato anonimizado',
      anonymized_at: '2026-10-13T12:00:00Z',
    } as Contact;
    const company = {
      id: 'company-1',
      org_id: 'org-1',
      name: 'Padaria Alves',
      phone: null,
      industry: null,
      website: null,
      owner_id: null,
      created_at: '2026-10-01T10:00:00.000000+00:00',
      updated_at: '2026-10-01T10:00:00.000000+00:00',
    } as Company;
    const data: RelationshipData = {
      contacts: [anonymized],
      companies: [company],
      deals: [],
      activities: [
        activity({
          id: 'frozen',
          type: 'call',
          title: 'Ligação (contato anonimizado)',
          contact_id: 'gone',
          company_id: 'company-1',
          completed_at: '2026-10-05T12:00:00Z',
        }),
        activity({ id: 'free', title: 'Tarefa da empresa', contact_id: null, company_id: 'company-1' }),
      ],
      members,
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Relationship360 kind="companies" record={company} data={data} onClose={vi.fn()} onEdit={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const frozen = screen.getByRole('heading', { name: 'Ligação (contato anonimizado)' }).closest('li')!;
    expect(within(frozen).queryByRole('button')).not.toBeInTheDocument();
    const free = screen.getByRole('heading', { name: 'Tarefa da empresa' }).closest('li')!;
    expect(within(free).getByRole('button', { name: 'Editar' })).toBeInTheDocument();
  });

  // Achado 9 da revisão do item 1.10 (corrigido no 1.11): o anonimizado sem atividades não sugere um próximo passo.
  it('o contato anonimizado sem atividades mostra "Sem histórico", e quem edita, o convite de antes', () => {
    mocks.canManage = true;
    mountPrivacy({
      ...contact,
      ...legal,
      first_name: 'Contato anonimizado',
      anonymized_at: '2026-10-13T12:00:00Z',
      anonymized_by: 'user-1',
    } as Contact);
    expect(screen.getByText('Sem histórico')).toBeInTheDocument();
    expect(screen.getByText('Este cadastro foi anonimizado e não recebe novos registros.')).toBeInTheDocument();
    expect(screen.queryByText('O histórico começa aqui')).not.toBeInTheDocument();
    cleanup();
    mountPrivacy({ ...contact, ...legal } as Contact);
    expect(screen.getByText('O histórico começa aqui')).toBeInTheDocument();
    expect(screen.queryByText('Sem histórico')).not.toBeInTheDocument();
  });
});

// Item 1.11: cargo, origem e observações, que chegam pela importação de planilha, aparecem na ficha quando preenchidos
// (a correção é em "Editar cadastro", testada em RecordEditor.test.tsx).
describe('ficha 360: cargo, origem e observações (item 1.11)', () => {
  function mountRecord(record: Contact) {
    const data: RelationshipData = { contacts: [record], companies: [], deals: [], activities: [], members: [] };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Relationship360 kind="contacts" record={record} data={data} onClose={vi.fn()} onEdit={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }
  const filled = {
    ...contact,
    job_title: 'Diretora comercial',
    source: 'Feira de outubro',
    notes: 'Prefere WhatsApp.\nLigar depois das 14h.',
  } as Contact;
  const term = (label: string) => screen.queryByText(label, { selector: 'dt' });

  it('aparecem quando preenchidos, para todos os papéis, com as quebras de linha das observações', () => {
    for (const canWrite of [true, false]) {
      mocks.canWrite = canWrite;
      mountRecord(filled);
      expect(term('Cargo')?.nextElementSibling).toHaveTextContent('Diretora comercial');
      expect(term('Origem')?.nextElementSibling).toHaveTextContent('Feira de outubro');
      const notes = term('Observações')?.nextElementSibling as HTMLElement;
      expect(notes.textContent).toBe('Prefere WhatsApp.\nLigar depois das 14h.');
      expect(notes).toHaveClass('whitespace-pre-line');
      // A ordem: depois de "Relacionamento".
      expect(
        term('Relacionamento')!.compareDocumentPosition(term('Cargo')!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      cleanup();
    }
  });

  it('somem quando vazios e no contato anonimizado', () => {
    mountRecord({ ...contact, job_title: '  ', source: null, notes: '' } as Contact);
    for (const label of ['Cargo', 'Origem', 'Observações']) expect(term(label), label).not.toBeInTheDocument();
    cleanup();
    mountRecord({ ...filled, first_name: 'Contato anonimizado', anonymized_at: '2026-10-13T12:00:00Z' } as Contact);
    for (const label of ['Cargo', 'Origem', 'Observações']) expect(term(label), label).not.toBeInTheDocument();
  });
});
