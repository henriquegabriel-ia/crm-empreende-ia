import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DealBoard } from './DealBoard';
import type { Deal, DealStage } from '@/lib/deal-types';
const deal: Deal = {
  id: 'deal',
  org_id: 'org',
  pipeline_id: 'p',
  stage_id: 'stage-a',
  title: 'Proposta anual',
  value: 2500,
  currency: 'BRL',
  contact_id: null,
  company_id: null,
  owner_id: 'owner',
  close_date: null,
  probability: 20,
  status: 'open',
  lost_reason: null,
  closed_at: null,
  stage_entered_at: '2026-09-01',
  created_at: '2026-09-01',
  updated_at: '2026-09-01',
};
const stages: DealStage[] = [
  {
    id: 'stage-a',
    org_id: 'org',
    pipeline_id: 'p',
    name: 'Etapa renomeada',
    order: 0,
    color: null,
    win_probability: 20,
  },
  { id: 'stage-b', org_id: 'org', pipeline_id: 'p', name: 'Proposta', order: 1, color: null, win_probability: 50 },
];

describe('quadro comercial acessível', () => {
  it('agrupa por ID mesmo após renomear etapa e abre o registro correto', () => {
    const open = vi.fn();
    render(
      <MemoryRouter>
        <DealBoard
          deals={[deal]}
          stages={stages}
          people={[{ id: 'owner', full_name: 'Pessoa responsável' }]}
          nextActions={new Map()}
          currency="BRL"
          canWrite
          onOpen={open}
          onMove={vi.fn()}
        />
      </MemoryRouter>,
    );
    const column = screen.getByRole('region', { name: 'Etapa Etapa renomeada' });
    expect(within(column).getByText('Pessoa responsável')).toBeVisible();
    fireEvent.click(within(column).getByRole('button', { name: deal.title }));
    expect(open).toHaveBeenCalledWith(deal);
    expect(
      within(screen.getByRole('region', { name: 'Etapa Proposta' })).queryByText(deal.title),
    ).not.toBeInTheDocument();
  });
  it('mostra o responsável ativo pelo nome e o que não está na equipe como indisponível', () => {
    render(
      <MemoryRouter>
        <DealBoard
          deals={[deal, { ...deal, id: 'lost', title: 'Perdida', owner_id: 'gone' }]}
          stages={stages}
          people={[
            { id: 'owner', full_name: 'Pessoa responsável', active: true },
            { id: 'saiu', full_name: 'Fulano', active: false },
          ]}
          nextActions={new Map()}
          currency="BRL"
          canWrite
          onOpen={vi.fn()}
          onMove={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Pessoa responsável')).toBeVisible();
    expect(screen.getByText('Responsável indisponível')).toBeVisible();
  });
  it('marca "(desativado)" no responsável que saiu da equipe (item 1.2)', () => {
    render(
      <MemoryRouter>
        <DealBoard
          deals={[{ ...deal, status: 'won', owner_id: 'saiu' }]}
          stages={stages}
          people={[{ id: 'saiu', full_name: 'Fulano', active: false }]}
          nextActions={new Map()}
          currency="BRL"
          canWrite
          onOpen={vi.fn()}
          onMove={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Fulano (desativado)')).toBeVisible();
  });
  it('oferece leitura sem disponibilizar arraste ou movimentação a quem não pode escrever', () => {
    render(
      <MemoryRouter>
        <DealBoard
          deals={[deal]}
          stages={stages}
          people={[]}
          nextActions={new Map()}
          currency="BRL"
          canWrite={false}
          onOpen={vi.fn()}
          onMove={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /Arrastar Proposta/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mover ou alterar situação/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: deal.title })).toBeEnabled();
  });
  it('trava só a oportunidade em movimentação: as outras seguem livres para mover e arrastar', () => {
    const other: Deal = { ...deal, id: 'other', title: 'Contrato de suporte' };
    const move = vi.fn();
    const board = (movingIds: ReadonlySet<string>) => (
      <MemoryRouter>
        <DealBoard
          deals={[deal, other]}
          stages={stages}
          people={[]}
          nextActions={new Map()}
          currency="BRL"
          canWrite
          movingIds={movingIds}
          onOpen={vi.fn()}
          onMove={move}
        />
      </MemoryRouter>
    );
    const { rerender } = render(board(new Set()));
    // O aviso para leitor de tela fica sempre montado, vazio, e só o texto muda: assim a mudança é anunciada. (A outra
    // região com role="status" é a do dnd-kit, que anuncia o arraste.)
    const [status] = screen.getAllByRole('status').filter((node) => !node.id.startsWith('DndLiveRegion'));
    expect(status).toBeEmptyDOMElement();
    rerender(board(new Set([deal.id])));
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent(`Salvando a movimentação de ${deal.title}`);
    expect(screen.getByRole('button', { name: `Mover ou alterar situação de ${deal.title}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Mover ou alterar situação de ${deal.title}` })).toHaveAttribute(
      'title',
      'Salvando, aguarde a confirmação.',
    );
    expect(screen.getByRole('button', { name: new RegExp(`^Arrastar ${deal.title}`) })).toBeDisabled();
    expect(screen.getByRole('article', { name: deal.title })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: `Mover ou alterar situação de ${other.title}` })).toBeEnabled();
    expect(screen.getByRole('button', { name: new RegExp(`^Arrastar ${other.title}`) })).toBeEnabled();
    expect(screen.getByRole('article', { name: other.title })).not.toHaveAttribute('aria-busy');
    // A ficha da oportunidade travada continua abrindo.
    expect(screen.getByRole('button', { name: deal.title })).toBeEnabled();
    rerender(board(new Set([deal.id, other.id])));
    expect(status).toHaveTextContent('Salvando a movimentação de 2 oportunidades');
    rerender(board(new Set()));
    expect(status).toBeEmptyDOMElement();
  });
  it('mover pelo menu devolve o foco ao cartão na coluna de destino, em vez de deixá-lo cair no body', async () => {
    let finish!: () => void;
    function Board() {
      const [deals, setDeals] = useState([deal]);
      const [moving, setMoving] = useState<ReadonlySet<string>>(new Set());
      return (
        <MemoryRouter>
          <DealBoard
            deals={deals}
            stages={stages}
            people={[]}
            nextActions={new Map()}
            currency="BRL"
            canWrite
            movingIds={moving}
            onOpen={vi.fn()}
            onMove={(moved, stageId) => {
              // Como o Pipeline: trava o card e, logo depois, a atualização otimista o leva para a outra coluna.
              setMoving(new Set([moved.id]));
              void Promise.resolve().then(() => setDeals([{ ...moved, stage_id: stageId }]));
              finish = () => setMoving(new Set());
            }}
          />
        </MemoryRouter>
      );
    }
    render(<Board />);
    const trigger = screen.getByRole('button', { name: `Mover ou alterar situação de ${deal.title}` });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Proposta' }));
    });
    const destination = screen.getByRole('region', { name: 'Etapa Proposta' });
    expect(within(destination).getByRole('article', { name: deal.title })).toHaveAttribute('aria-busy', 'true');
    expect(document.activeElement).toBe(within(destination).getByRole('button', { name: deal.title }));
    act(() => finish());
    expect(document.activeElement).toBe(within(destination).getByRole('button', { name: deal.title }));
    expect(
      within(destination).getByRole('button', { name: `Mover ou alterar situação de ${deal.title}` }),
    ).toBeEnabled();
  });
});
