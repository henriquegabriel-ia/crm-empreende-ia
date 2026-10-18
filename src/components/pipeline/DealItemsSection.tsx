import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ListPlus, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ds/button';
import { LoadingState } from '@/components/foundation/LoadingState';
import { useDealItems } from '@/hooks/useDealItems';
import { useProducts } from '@/hooks/useProducts';
import { invalidateCrmTables } from '@/lib/crm-cache';
import {
  computeDealItems,
  DEAL_ITEM_BILLING_LABELS,
  dealItemDiscountLabel,
  dealItemDraft,
  dealItemsPayload,
  formatQuantity,
  hasDealItems,
} from '@/lib/deal-logic';
import type { Deal, DealItemDraft } from '@/lib/deal-types';
import { formatBRL } from '@/lib/money';
import { CATALOG_MIGRATION_MISSING, catalogMigrationMissing } from '@/lib/rpc-errors';
import { saveDealWithItems } from './deal-items-data';
import { errorMessage } from './data';
import { DealItemsEditor } from './DealItemsEditor';
import { firstDealItemErrorId } from './deal-item-fields';

const PREFIX = 'deal-panel-items';

interface DealItemsSectionProps {
  deal: Deal;
  canWrite: boolean;
  /** O painel está ocupado com outra gravação (movimento, ação). */
  busy: boolean;
  /** O editor está aberto: o painel não fecha sem cancelar, e "Editar" fica desabilitado. */
  onEditingChange?: (editing: boolean) => void;
}

/**
 * A seção "Itens" do painel da oportunidade (item 1.16; docs/arquitetura/1.16.md, seção 7.4): sem itens, o aviso de
 * que o valor não vem de itens; com itens, a lista só leitura e os totais. "Editar itens" (ou "Adicionar itens") abre o
 * editor no próprio painel, e "Salvar itens" chama `save_deal` sem os campos, com a versão lida ao abrir (0.8): no
 * conflito, os itens preenchidos continuam e os dados recarregam.
 */
export function DealItemsSection({ deal, canWrite, busy, onEditingChange }: DealItemsSectionProps) {
  const queryClient = useQueryClient();
  const withItems = hasDealItems(deal);
  const saved = useDealItems(deal.id, { enabled: withItems, version: deal.updated_at });
  const [editing, setEditing] = useState<{ version: string } | null>(null);
  const [drafts, setDrafts] = useState<DealItemDraft[]>([]);
  const [months, setMonths] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const products = useProducts({ enabled: !!editing });
  const computation = useMemo(
    () => computeDealItems(drafts, months, { products: products.products, saved: saved.items }),
    [drafts, months, products.products, saved.items],
  );
  const setEditor = (value: { version: string } | null) => {
    setEditing(value);
    onEditingChange?.(!!value);
  };
  const open = () => {
    const loaded = saved.items.map((item) => dealItemDraft(item));
    setDrafts(loaded.length ? loaded : [dealItemDraft()]);
    setMonths(deal.contract_months ? String(deal.contract_months) : '');
    setShowErrors(false);
    setError('');
    setEditor({ version: deal.updated_at });
  };
  const cancel = () => {
    setEditor(null);
    setError('');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || saving) return;
    if (drafts.length && !computation.valid) {
      setShowErrors(true);
      const target = firstDealItemErrorId(PREFIX, drafts, computation);
      if (target) document.getElementById(target)?.focus();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveDealWithItems({
        dealId: deal.id,
        version: editing.version,
        items: drafts.length ? dealItemsPayload(drafts) : [],
        contractMonths: computation.hasMonthly ? computation.months : null,
      });
      await invalidateCrmTables(queryClient, ['deals', 'deal_items']);
      setEditor(null);
      toast.success('Itens salvos.');
    } catch (cause) {
      setError(catalogMigrationMissing(cause) ? CATALOG_MIGRATION_MISSING : errorMessage(cause));
      // No conflito, os dados atuais recarregam; o editor continua com o preenchimento da pessoa.
      void invalidateCrmTables(queryClient, ['deals', 'deal_items']);
    } finally {
      setSaving(false);
    }
  };
  const lines = [...saved.items].sort((a, b) => a.position - b.position);
  return (
    <section aria-label="Itens" className="space-y-3" data-deal-items>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Itens</h3>
        {canWrite && !editing && (withItems ? saved.isSuccess : true) && (
          <Button size="sm" variant="outline" className="eia-touch-target" onClick={open} disabled={busy}>
            {withItems ? (
              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden />
            ) : (
              <ListPlus className="mr-1 h-3.5 w-3.5" aria-hidden />
            )}
            {withItems ? 'Editar itens' : 'Adicionar itens'}
          </Button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} noValidate className="space-y-3 rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
          <DealItemsEditor
            idPrefix={PREFIX}
            drafts={drafts}
            months={months}
            computation={computation}
            products={products.products}
            productsLoading={products.isPending}
            catalogMissing={products.missing}
            showErrors={showErrors}
            disabled={saving}
            onChange={(next, nextMonths) => {
              setDrafts(next);
              setMonths(nextMonths);
            }}
          />
          {!drafts.length && withItems && (
            <p className="text-xs text-muted-foreground">
              Sem itens, o valor da oportunidade continua o último calculado e volta a ser editável em “Editar”.
            </p>
          )}
          {error && (
            <p id={`${PREFIX}-error`} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" className="eia-touch-target" disabled={saving} onClick={cancel}>
              Cancelar
            </Button>
            {!products.missing && (
              <Button
                type="submit"
                className="eia-touch-target"
                disabled={saving}
                aria-describedby={error ? `${PREFIX}-error` : undefined}
              >
                {saving ? 'Salvando…' : 'Salvar itens'}
              </Button>
            )}
          </div>
        </form>
      ) : !withItems ? (
        <p className="text-sm text-muted-foreground">
          {/* Vale para o valor digitado, o último calculado (todos os itens removidos) e o das integrações. */}
          Nenhum item. O valor desta oportunidade não é calculado por itens
          {canWrite ? ' e pode ser mudado em “Editar”.' : '.'}
        </p>
      ) : saved.isPending ? (
        <LoadingState label="Carregando itens…" />
      ) : saved.isError ? (
        <div role="alert" className="text-sm text-destructive">
          <p>{saved.missing ? CATALOG_MIGRATION_MISSING : 'Não foi possível carregar os itens.'}</p>
          {!saved.missing && (
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void saved.refetch()}>
              Tentar novamente
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Itens da oportunidade">
            {lines.map((item) => {
              const discount = dealItemDiscountLabel(item);
              return (
                <li key={item.id} className="space-y-0.5 p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{item.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatBRL(Number(item.line_total))}
                      {item.billing === 'monthly' ? '/mês' : ''}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {formatQuantity(Number(item.quantity))}
                    {item.unit ? ` ${item.unit}` : ''} × {formatBRL(Number(item.unit_price))}
                    {discount ? ` · desconto de ${discount}` : ''} · Cobrança{' '}
                    {DEAL_ITEM_BILLING_LABELS[item.billing].toLowerCase()}
                  </p>
                </li>
              );
            })}
          </ul>
          <dl className="grid grid-cols-1 gap-2 rounded-lg bg-muted/30 p-3 text-sm min-[360px]:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Total único</dt>
              <dd className="font-medium tabular-nums">{formatBRL(Number(deal.one_time_value ?? 0))}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Mensalidade</dt>
              <dd className="font-medium tabular-nums">
                {formatBRL(Number(deal.monthly_value ?? 0))}/mês
                {deal.contract_months
                  ? ` × ${deal.contract_months} ${deal.contract_months === 1 ? 'mês' : 'meses'}`
                  : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Valor do contrato</dt>
              <dd className="font-semibold tabular-nums">{formatBRL(Number(deal.value))}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
