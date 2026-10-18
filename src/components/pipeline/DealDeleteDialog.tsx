import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '@/components/foundation/ConfirmDialog';
import { Button } from '@/components/ds/button';
import { errorMessage, loadDealLinks, pipelineDb } from '@/components/pipeline/data';
import type { Deal } from '@/lib/deal-types';
import { hasDealItems } from '@/lib/deal-logic';
import {
  countLabel,
  dealLinkSummary,
  dealLinkTotal,
  linkSummary,
  readDealLinkCounts,
  type DealLinkCounts,
} from '@/lib/record-links';

export interface DealDeleteDialogProps {
  orgId: string;
  deal: Deal;
  onClose: () => void;
  onDeleted: (deal: Deal, counts: DealLinkCounts) => Promise<void> | void;
}

/**
 * Confirmação da exclusão de oportunidade pela RPC delete_deal (item 0.7 do roteiro): mostra antes quantas atividades,
 * recebimentos e registros de automação estão vinculados.
 * - Sem vínculos na contagem, a exclusão vai sem confirmação (p_confirm = false): se algum aparecer até lá, o banco
 *   recusa, as contagens são atualizadas e a pessoa confirma de novo.
 * - Com vínculos, a confirmação (p_confirm = true) desvincula todos os existentes no momento da exclusão, inclusive os
 *   que surgirem depois das contagens exibidas; delete_deal não compara as contagens (pendência do 0.7 no roteiro).
 */
export function DealDeleteDialog({ orgId, deal, onClose, onDeleted }: DealDeleteDialogProps) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const queryKey = ['crm', orgId, 'deal-links', deal.id];
  const links = useQuery({ queryKey, queryFn: () => loadDealLinks(orgId, deal.id), staleTime: 0 });
  const counts = links.data;
  const total = counts ? dealLinkTotal(counts) : 0;
  const confirm = async () => {
    if (busy || !counts) return;
    setBusy(true);
    setError('');
    try {
      const { data, error: rpcError } = await pipelineDb.rpc('delete_deal', {
        p_deal_id: deal.id,
        p_confirm: total > 0,
      });
      if (rpcError) {
        const current = readDealLinkCounts(rpcError.details);
        if (current) {
          cache.setQueryData(queryKey, current);
          setError(
            'Os vínculos mudaram desde que você abriu esta confirmação. Revise as contagens e confirme de novo.',
          );
          return;
        }
        throw rpcError;
      }
      await onDeleted(deal, readDealLinkCounts(data) ?? counts);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const kept = counts
    ? linkSummary([
        [counts.activities, 'atividade', 'atividades'],
        [counts.payments, 'recebimento', 'recebimentos'],
      ])
    : '';
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title="Excluir oportunidade?"
      confirmLabel={total > 0 ? 'Desvincular e excluir' : 'Excluir oportunidade'}
      loading={busy}
      confirmDisabled={!counts}
      onConfirm={confirm}
      description={
        <span className="space-y-2">
          <span className="block">
            A oportunidade “{deal.title}” será excluída, junto com o histórico de movimentações de etapa.
          </span>
          {/* Item 1.16: os itens saem em cascata com a oportunidade (deal_items, ON DELETE CASCADE). */}
          {hasDealItems(deal) && <span className="block">Os itens da oportunidade são excluídos com ela.</span>}
          {links.isPending ? (
            <span className="block">Conferindo vínculos…</span>
          ) : links.isError ? (
            <span role="alert" className="block text-destructive">
              {errorMessage(links.error)}{' '}
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void links.refetch()}>
                Conferir de novo
              </Button>
            </span>
          ) : counts && total > 0 ? (
            <>
              <span className="block">
                Vínculos: <strong>{dealLinkSummary(counts)}</strong>.
              </span>
              {kept && (
                <span className="block">
                  {kept} {counts.activities + counts.payments === 1 ? 'continua' : 'continuam'} no CRM, sem o vínculo
                  com ela.
                </span>
              )}
              {counts.automation_logs > 0 && (
                <span className="block">
                  {countLabel(counts.automation_logs, 'registro de automação', 'registros de automação')}{' '}
                  {counts.automation_logs === 1 ? 'fica' : 'ficam'} no histórico, sem o vínculo.
                </span>
              )}
            </>
          ) : (
            <span className="block">Ela não tem atividades, recebimentos nem registros de automação vinculados.</span>
          )}
          <span className="block">
            Para encerrar a negociação preservando o histórico comercial, marque-a como perdida.
          </span>
          {error && (
            <span role="alert" className="block text-destructive">
              {error}
            </span>
          )}
        </span>
      }
    />
  );
}
