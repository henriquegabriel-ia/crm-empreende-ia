import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pipelineDb } from '@/components/pipeline/data';
import { invalidateCrmTables } from '@/lib/crm-cache';
import { isMovedDeal, optimisticDealMove } from '@/lib/deal-logic';
import type { Deal, DealStatus } from '@/lib/deal-types';

function sameRow(a: Deal, b: Deal) {
  return (Object.keys(b) as (keyof Deal)[]).every((key) => a[key] === b[key]);
}

/** Chave das oportunidades do Pipeline no cache do React Query. */
export const dealsQueryKey = (orgId: string) => ['crm', orgId, 'deals'] as const;

export interface DealMove {
  deal: Deal;
  stageId: string;
  status: DealStatus;
  /** Motivo da perda; só vale quando `status` é 'lost'. */
  lostReason?: string | null;
}

/**
 * Movimentações do kanban (item 0.10 do roteiro):
 * - trava por oportunidade (`Set<dealId>`), e não do quadro inteiro: enquanto uma oportunidade é movida, as outras
 *   continuam livres, e a mesma não aceita um segundo movimento até a resposta;
 * - atualização otimista: a etapa (e a situação) mudam na hora no cache das oportunidades;
 * - reconciliação: move_deal devolve a linha gravada pelo banco (probabilidade, fechamento, entrada na etapa e
 *   versão), que substitui a otimista; numa falha, a oportunidade volta ao que era, sem tocar nas outras;
 * - a trava sai assim que o banco responde: as consultas afetadas (histórico, próximas ações criadas por
 *   automação, snapshot) recarregam em segundo plano, sem segurar o card;
 * - a lista de oportunidades é relida quando a resposta não basta (falha, que pode ser uma gravação feita com a
 *   resposta perdida; resposta inesperada; ou leitura iniciada durante a gravação), mas só quando nenhuma outra
 *   movimentação está em andamento: antes disso, a releitura traria a etapa antiga do card ainda não confirmado.
 */
export function useDealMoves(orgId: string) {
  const cache = useQueryClient();
  const pending = useRef(new Set<string>());
  const [moving, setMoving] = useState<ReadonlySet<string>>(() => new Set());
  const reloadDeals = useRef(false);
  const publish = () => setMoving(new Set(pending.current));
  const move = useCallback(
    async ({ deal, stageId, status, lostReason = null }: DealMove): Promise<Deal | null> => {
      if (pending.current.has(deal.id)) return null;
      pending.current.add(deal.id);
      publish();
      const key = dealsQueryKey(orgId);
      const replace = (update: (current: Deal) => Deal) =>
        cache.setQueryData<Deal[]>(key, (rows) => rows?.map((row) => (row.id === deal.id ? update(row) : row)));
      try {
        // Uma leitura das oportunidades em andamento traria a etapa antiga por cima da otimista.
        await cache.cancelQueries({ queryKey: key });
        const before = cache.getQueryData<Deal[]>(key)?.find((row) => row.id === deal.id) ?? deal;
        const reason = status === 'lost' ? (lostReason ?? '').trim() : null;
        const optimistic = optimisticDealMove(before, stageId, status, reason);
        replace(() => optimistic);
        let data: unknown;
        try {
          const result = await pipelineDb.rpc('move_deal', {
            p_deal_id: deal.id,
            p_stage_id: stageId,
            p_status: status,
            p_lost_reason: reason,
          });
          if (result.error) throw result.error;
          data = result.data;
        } catch (error) {
          // Volta só se ninguém trocou a linha nesse meio-tempo (um recarregamento já traria a versão do banco). O
          // cache copia as linhas (structural sharing), então a comparação é por conteúdo, e não por referência.
          replace((current) => (sameRow(current, optimistic) ? before : current));
          // A gravação pode ter sido feita e só a resposta se perdido: o que lê oportunidades é relido, e o quadro (e a
          // versão usada pela guarda de concorrência) volta a refletir o banco.
          reloadDeals.current = true;
          void invalidateCrmTables(cache, ['deals'], { keep: ['deals'] });
          throw error;
        }
        const saved = isMovedDeal(data, deal.id) ? data : null;
        if (saved) replace(() => saved);
        // Resposta inesperada ou leitura iniciada durante a gravação: a lista é lida de novo.
        if (!saved || cache.isFetching({ queryKey: key }) > 0) reloadDeals.current = true;
        void invalidateCrmTables(cache, ['deals'], { keep: ['deals'] });
        return saved ?? optimistic;
      } finally {
        pending.current.delete(deal.id);
        publish();
        if (!pending.current.size && reloadDeals.current) {
          reloadDeals.current = false;
          void cache.invalidateQueries({ queryKey: key });
        }
      }
    },
    [cache, orgId],
  );
  return { moving, move };
}
