import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamMember } from '@/lib/team-members';
import { MemberDeactivateDialog } from './MemberDeactivateDialog';

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn() }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { rpc: mock.rpc } }));
vi.mock('sonner', () => ({ toast: { success: mock.toast } }));

const person = (id: string, name: string, role: TeamMember['role'], active = true): TeamMember => ({
  id,
  name,
  email: `${id}@example.test`,
  role,
  active,
  deactivatedAt: active ? null : '2026-10-13T15:00:00.000Z',
});
const fulano = person('fulano', 'Fulano', 'member');
const members = [
  person('ana', 'Ana', 'owner'),
  fulano,
  person('bruno', 'Bruno', 'member'),
  person('carla', 'Carla', 'admin'),
  person('leitora', 'Leitora', 'viewer'),
  person('saiu', 'Saiu', 'member', false),
];
const counts = (overrides: Record<string, number> = {}) => ({
  deals: 3,
  activities: 5,
  contacts: 12,
  companies: 2,
  invitations: 1,
  ...overrides,
});
let portfolio = counts();
let reply: { data: unknown; error: unknown } = { data: [counts()], error: null };

function setup(mode: 'deactivate' | 'transfer' = 'deactivate', member = fulano) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemberDeactivateDialog orgId="org-a" member={member} mode={mode} members={members} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose, invalidate };
}
const dialog = () => screen.getByRole('dialog');
const confirmButton = (name = 'Confirmar desativação') => within(dialog()).getByRole('button', { name });
const recipient = () => within(dialog()).getByLabelText('Quem recebe a carteira *');

beforeEach(() => {
  portfolio = counts();
  reply = { data: [counts()], error: null };
  mock.toast.mockReset();
  mock.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === 'member_portfolio') return { data: [portfolio], error: null };
    return reply;
  });
});

describe('desativar e passar a carteira (item 1.2)', () => {
  it('conta a carteira antes e só confirma com quem recebe, entre os ativos que editam', async () => {
    let release!: () => void;
    mock.rpc.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ data: [portfolio], error: null }))),
    );
    setup();
    expect(screen.getByRole('dialog', { name: 'Desativar Fulano' })).toHaveTextContent(
      'Fulano perde o acesso ao CRM na hora, mesmo que esteja com ele aberto.',
    );
    expect(within(dialog()).getByRole('status')).toHaveTextContent('Contando a carteira…');
    expect(confirmButton()).toBeDisabled();
    release();
    const list = await within(dialog()).findByRole('list', { name: 'Carteira de Fulano' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['3 oportunidades em aberto', '5 atividades pendentes', '12 contatos', '2 empresas']);
    expect(dialog()).toHaveTextContent('1 convite pendente criado por Fulano será revogado.');
    expect(confirmButton()).toBeDisabled();
    expect(
      within(recipient())
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Escolha uma pessoa', 'Ana', 'Bruno', 'Carla']);
    fireEvent.change(recipient(), { target: { value: 'bruno' } });
    expect(confirmButton()).toBeEnabled();
  });

  it('a caixa de contatos e empresas vem marcada; desmarcada, explica o que fica com a pessoa', async () => {
    setup();
    const box = await within(dialog()).findByLabelText(/Passar também os contatos e as empresas/);
    expect(box).toBeChecked();
    expect(within(dialog()).getByText(/\(12 contatos e 2 empresas\)/)).toBeInTheDocument();
    fireEvent.click(box);
    // Achado 5 da revisão do item 1.2: a marca vai no nome do responsável, e não nos contatos.
    expect(dialog()).toHaveTextContent(
      'Os contatos e as empresas continuam com Fulano, que aparece como responsável com “(desativado)”, até alguém trocar o responsável ou usar “Passar carteira”.',
    );
    expect(dialog()).not.toHaveTextContent('“Passar carteira” de novo');
  });

  it('confirma com a caixa e o destinatário, avisa com as contagens devolvidas e atualiza a equipe', async () => {
    reply = { data: [counts({ deals: 3, activities: 6, contacts: 12, companies: 2 })], error: null };
    const { onClose, invalidate } = setup();
    fireEvent.change(await within(dialog()).findByLabelText('Quem recebe a carteira *'), {
      target: { value: 'bruno' },
    });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mock.rpc).toHaveBeenCalledWith('deactivate_member', {
      p_user_id: 'fulano',
      p_transfer_accounts: true,
      p_recipient_id: 'bruno',
    });
    expect(mock.toast).toHaveBeenCalledWith(
      'O acesso de Fulano foi desativado. Bruno recebeu 3 oportunidades em aberto, 6 atividades pendentes, 12 contatos e 2 empresas. 1 convite pendente revogado.',
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['crm'] });
  });

  it('com a caixa desmarcada e só contatos e empresas, desativa sem destinatário', async () => {
    portfolio = counts({ deals: 0, activities: 0, invitations: 0 });
    reply = { data: [counts({ deals: 0, activities: 0, contacts: 0, companies: 0, invitations: 0 })], error: null };
    const { onClose } = setup();
    fireEvent.click(await within(dialog()).findByLabelText(/Passar também os contatos e as empresas/));
    expect(within(dialog()).queryByLabelText('Quem recebe a carteira *')).not.toBeInTheDocument();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mock.rpc).toHaveBeenCalledWith('deactivate_member', { p_user_id: 'fulano', p_transfer_accounts: false });
    expect(mock.toast).toHaveBeenCalledWith('O acesso de Fulano foi desativado.');
  });

  it('sem carteira, explica e confirma sem seletor', async () => {
    portfolio = counts({ deals: 0, activities: 0, contacts: 0, companies: 0, invitations: 0 });
    setup();
    expect(
      await within(dialog()).findByText(
        'Fulano não tem oportunidades em aberto, atividades pendentes, contatos nem empresas.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog()).queryByLabelText('Quem recebe a carteira *')).not.toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });

  it('sem carteira e com convites pendentes, avisa a revogação antes e confirma no aviso de sucesso', async () => {
    portfolio = counts({ deals: 0, activities: 0, contacts: 0, companies: 0, invitations: 2 });
    reply = { data: [counts({ deals: 0, activities: 0, contacts: 0, companies: 0, invitations: 2 })], error: null };
    const { onClose } = setup();
    await within(dialog()).findByText(/não tem oportunidades em aberto/);
    expect(dialog()).toHaveTextContent('2 convites pendentes criados por Fulano serão revogados.');
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mock.toast).toHaveBeenCalledWith('O acesso de Fulano foi desativado. 2 convites pendentes revogados.');
  });

  it('a carteira mudou: a recusa com as contagens novas atualiza o diálogo e pede o destinatário', async () => {
    portfolio = counts({ deals: 0, activities: 0, contacts: 0, companies: 0, invitations: 0 });
    reply = {
      data: null,
      error: {
        code: 'P0001',
        message: 'Fulano tem 1 oportunidade em aberto. Escolha quem recebe a carteira.',
        details: JSON.stringify(counts({ deals: 1, activities: 0, contacts: 0, companies: 0, invitations: 0 })),
      },
    };
    setup();
    // A confirmação só vale depois das contagens: antes disso o botão fica desabilitado.
    await within(dialog()).findByText(/não tem oportunidades em aberto/);
    fireEvent.click(confirmButton());
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'A carteira de Fulano mudou desde que você abriu esta confirmação. Confira as contagens e confirme de novo.',
    );
    expect(within(dialog()).getByRole('list', { name: 'Carteira de Fulano' })).toHaveTextContent(
      '1 oportunidade em aberto',
    );
    expect(recipient()).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it('outras recusas aparecem no alerta ligado ao botão; impasse pede para tentar de novo', async () => {
    reply = {
      data: null,
      error: {
        code: 'P0001',
        message:
          'Quem recebe a carteira precisa estar ativo na equipe e poder editar (dono, administrador ou colaborador).',
      },
    };
    setup();
    fireEvent.change(await within(dialog()).findByLabelText('Quem recebe a carteira *'), {
      target: { value: 'carla' },
    });
    fireEvent.click(confirmButton());
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Quem recebe a carteira precisa estar ativo');
    expect(confirmButton()).toHaveAccessibleDescription(
      'Quem recebe a carteira precisa estar ativo na equipe e poder editar (dono, administrador ou colaborador).',
    );
    reply = { data: null, error: { code: '40P01', message: 'deadlock detected' } };
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(within(dialog()).getByRole('alert')).toHaveTextContent(
        'Outra gravação aconteceu ao mesmo tempo. Tente de novo.',
      ),
    );
    reply = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(within(dialog()).getByRole('alert')).toHaveTextContent(
        'Não foi possível desativar Fulano. Tente novamente.',
      ),
    );
  });

  it('falha ao contar: mensagem e nova tentativa', async () => {
    mock.rpc.mockImplementationOnce(async () => ({ data: null, error: { code: 'PGRST000', message: 'falha' } }));
    setup();
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Não foi possível contar a carteira.');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Tentar novamente' }));
    expect(await within(dialog()).findByRole('list', { name: 'Carteira de Fulano' })).toBeInTheDocument();
  });

  it('"Passar carteira" de quem já foi desativado usa transfer_portfolio, sem a linha dos convites', async () => {
    const saiu = members.find((member) => member.id === 'saiu')!;
    portfolio = counts({ deals: 0, activities: 0, contacts: 4, companies: 0, invitations: 0 });
    reply = { data: [counts({ deals: 0, activities: 0, contacts: 4, companies: 0, invitations: 0 })], error: null };
    const { onClose } = setup('transfer', saiu);
    expect(screen.getByRole('dialog', { name: 'Passar a carteira de Saiu' })).toHaveTextContent(
      'O acesso de Saiu já está desativado. O que ainda está no nome de Saiu passa para a pessoa escolhida.',
    );
    fireEvent.change(await within(dialog()).findByLabelText('Quem recebe a carteira *'), {
      target: { value: 'ana' },
    });
    expect(dialog()).not.toHaveTextContent('será revogado');
    fireEvent.click(confirmButton('Confirmar passagem'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mock.rpc).toHaveBeenCalledWith('transfer_portfolio', {
      p_user_id: 'saiu',
      p_transfer_accounts: true,
      p_recipient_id: 'ana',
    });
    expect(mock.toast).toHaveBeenCalledWith('Ana recebeu 4 contatos.');
  });

  // Achado 5 da revisão do item 1.2: só com contatos e empresas, desmarcar a caixa levava a um beco sem saída.
  it('"Passar carteira" só com contatos e empresas: sem caixa, os dois passam sempre e o destinatário é obrigatório', async () => {
    const saiu = members.find((member) => member.id === 'saiu')!;
    portfolio = counts({ deals: 0, activities: 0, contacts: 4, companies: 1, invitations: 0 });
    reply = { data: [counts({ deals: 0, activities: 0, contacts: 4, companies: 1, invitations: 0 })], error: null };
    const { onClose } = setup('transfer', saiu);
    expect(
      await within(dialog()).findByText('Passam os contatos e as empresas para a pessoa escolhida abaixo.'),
    ).toBeVisible();
    expect(within(dialog()).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(recipient()).toHaveAccessibleDescription(
      'Recebe os contatos e as empresas. Só pessoas ativas que editam (dono, administrador ou colaborador).',
    );
    expect(confirmButton('Confirmar passagem')).toBeDisabled();
    fireEvent.change(recipient(), { target: { value: 'carla' } });
    fireEvent.click(confirmButton('Confirmar passagem'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mock.rpc).toHaveBeenCalledWith('transfer_portfolio', {
      p_user_id: 'saiu',
      p_transfer_accounts: true,
      p_recipient_id: 'carla',
    });
  });

  it('"Passar carteira" com oportunidades e contatos: a caixa desmarcada diz que dá para passar de novo', async () => {
    const saiu = members.find((member) => member.id === 'saiu')!;
    portfolio = counts({ deals: 1, activities: 0, contacts: 4, companies: 0, invitations: 0 });
    setup('transfer', saiu);
    fireEvent.click(await within(dialog()).findByLabelText(/Passar também os contatos e as empresas/));
    expect(dialog()).toHaveTextContent(
      'Os contatos continuam com Saiu, que aparece como responsável com “(desativado)”, até alguém trocar o responsável ou usar “Passar carteira” de novo.',
    );
    expect(recipient()).toBeInTheDocument();
  });

  // Achado 6 da revisão do item 1.6 (corrigido no item 1.9): só com contatos, só com empresas ou com os dois, a frase diz
  // o que passa de fato, sem repetir a contagem, nos dois modos.
  it.each([
    ['só contatos', 3, 0, 'os contatos'],
    ['só empresas', 0, 2, 'as empresas'],
    ['contatos e empresas', 3, 2, 'os contatos e as empresas'],
  ])('"Passar carteira" com %s', async (_label, contacts, companies, phrase) => {
    const saiu = members.find((member) => member.id === 'saiu')!;
    portfolio = counts({ deals: 0, activities: 0, contacts, companies, invitations: 0 });
    setup('transfer', saiu);
    expect(await within(dialog()).findByText(`Passam ${phrase} para a pessoa escolhida abaixo.`)).toBeVisible();
    expect(recipient()).toHaveAccessibleDescription(
      `Recebe ${phrase}. Só pessoas ativas que editam (dono, administrador ou colaborador).`,
    );
    expect(dialog()).not.toHaveTextContent(/Passam também/);
  });

  it.each([
    ['só contatos', 3, 0, 'os contatos', 'Os contatos'],
    ['só empresas', 0, 2, 'as empresas', 'As empresas'],
    ['contatos e empresas', 3, 2, 'os contatos e as empresas', 'Os contatos e as empresas'],
  ])('"Desativar" com %s', async (_label, contacts, companies, phrase, start) => {
    portfolio = counts({ deals: 1, activities: 0, contacts, companies, invitations: 0 });
    setup();
    const box = await within(dialog()).findByLabelText(/Passar também os contatos e as empresas/);
    expect(recipient()).toHaveAccessibleDescription(
      `Recebe as oportunidades em aberto e as atividades pendentes, e também ${phrase}. Só pessoas ativas que editam (dono, administrador ou colaborador).`,
    );
    fireEvent.click(box);
    expect(dialog()).toHaveTextContent(
      `${start} continuam com Fulano, que aparece como responsável com “(desativado)”`,
    );
    expect(recipient()).toHaveAccessibleDescription(
      'Recebe as oportunidades em aberto e as atividades pendentes. Só pessoas ativas que editam (dono, administrador ou colaborador).',
    );
  });

  it('"Passar carteira" sem nada a passar só fecha', async () => {
    portfolio = counts({ deals: 0, activities: 0, contacts: 0, companies: 0, invitations: 0 });
    setup(
      'transfer',
      members.find((member) => member.id === 'saiu')!,
    );
    expect(await within(dialog()).findByText('Saiu não tem mais carteira para passar.')).toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: 'Confirmar passagem' })).not.toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });
});
