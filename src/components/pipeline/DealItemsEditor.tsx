import { useId, useState } from 'react';
import { Check, ChevronsUpDown, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ds/popover';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { MoneyPreview } from '@/components/foundation/MoneyPreview';
import { textKey } from '@/lib/contact-import';
import { MAX_DEAL_ITEMS } from '@/lib/deal-item-math';
import {
  DEAL_ITEM_BILLING_LABELS,
  dealItemDraft,
  dealItemLineSummary,
  type DealItemField,
  type DealItemsComputation,
} from '@/lib/deal-logic';
import type { CatalogProduct, DealItemDraft } from '@/lib/deal-types';
import { formatBRL, formatBRLInput } from '@/lib/money';
import { CATALOG_MIGRATION_MISSING } from '@/lib/rpc-errors';
import { cn } from '@/lib/utils';
import { dealItemFieldId, dealItemMonthsId } from './deal-item-fields';

const selectClass =
  'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50';

export interface DealItemsEditorProps {
  /** Prefixo dos ids dos campos (o formulário e o painel usam prefixos diferentes). */
  idPrefix: string;
  drafts: DealItemDraft[];
  /** "Meses do contrato" como a pessoa digitou. */
  months: string;
  /** `computeDealItems(drafts, months, …)`, calculado por quem usa o editor (que precisa saber se pode salvar). */
  computation: DealItemsComputation;
  /** O catálogo lido (ativos e arquivados): o seletor oferece só os ativos aos itens novos. */
  products: readonly CatalogProduct[];
  /** O catálogo ainda está sendo lido. */
  productsLoading?: boolean;
  /** Banco sem a migração do catálogo: o editor dá lugar à mensagem. */
  catalogMissing?: boolean;
  /** Mostra os erros por campo (depois da primeira tentativa de salvar). */
  showErrors: boolean;
  disabled?: boolean;
  onChange: (drafts: DealItemDraft[], months: string) => void;
}

/**
 * Editor de itens da oportunidade (item 1.16; docs/arquitetura/1.16.md, seção 7.2), o mesmo no formulário e no painel:
 * um cartão por item (cabe em 320 px), com a escolha do catálogo por busca (nome ou código, sem acento) ou item avulso,
 * quantidade e unidade, preço unitário (D7), desconto em % ou R$, cobrança e o total da linha ao vivo; abaixo, o bloco
 * de totais (total único, mensalidade, meses do contrato quando há item mensal e valor do contrato). As contas são de
 * `computeDealItems` (centavos inteiros, as mesmas do banco), e os erros usam as palavras da RPC `save_deal`.
 */
export function DealItemsEditor({
  idPrefix,
  drafts,
  months,
  computation,
  products,
  productsLoading = false,
  catalogMissing = false,
  showErrors,
  disabled = false,
  onChange,
}: DealItemsEditorProps) {
  const totalsId = useId();
  if (catalogMissing)
    return (
      <p role="status" className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        {CATALOG_MIGRATION_MISSING}
      </p>
    );
  const update = (id: string, changes: Partial<DealItemDraft>) =>
    onChange(
      drafts.map((draft) => (draft.id === id ? { ...draft, ...changes } : draft)),
      months,
    );
  const add = () => {
    if (drafts.length >= MAX_DEAL_ITEMS) return;
    const draft = dealItemDraft();
    onChange([...drafts, draft], months);
    // O foco vai ao seletor do item novo, depois de o cartão aparecer.
    requestAnimationFrame(() => document.getElementById(dealItemFieldId(idPrefix, draft.id, 'product_id'))?.focus());
  };
  const remove = (id: string) => {
    const next = drafts.filter((draft) => draft.id !== id);
    // Sem item mensal, os meses somem e vão vazios (seção 5.4).
    onChange(next, next.some((draft) => draft.billing === 'monthly') ? months : '');
  };
  const money = (cents: number) => formatBRL(cents / 100);
  const monthsId = dealItemMonthsId(idPrefix);
  const monthsProblem = showErrors ? (computation.monthsError ?? computation.contractError) : null;
  return (
    <div className="space-y-3" data-deal-items-editor>
      {drafts.length > 0 && (
        <ul className="space-y-3" aria-label="Itens da oportunidade">
          {drafts.map((draft, index) => (
            <DealItemCard
              key={draft.id}
              idPrefix={idPrefix}
              index={index}
              draft={draft}
              line={computation.lines[index] ?? null}
              errors={showErrors ? (computation.errors[draft.id] ?? {}) : {}}
              products={products}
              productsLoading={productsLoading}
              disabled={disabled}
              onChange={(changes) => update(draft.id, changes)}
              onRemove={() => remove(draft.id)}
            />
          ))}
        </ul>
      )}
      <div className="space-y-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="eia-touch-target"
          disabled={disabled || drafts.length >= MAX_DEAL_ITEMS}
          onClick={add}
        >
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Adicionar item
        </Button>
        {(drafts.length >= MAX_DEAL_ITEMS || computation.listError) && (
          <p className="text-xs text-muted-foreground">Uma oportunidade tem no máximo 100 itens.</p>
        )}
      </div>
      {drafts.length > 0 && (
        <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-3" aria-labelledby={totalsId}>
          <h4 id={totalsId} className="text-sm font-semibold">
            Totais dos itens
          </h4>
          <dl className="grid grid-cols-1 gap-2 text-sm min-[360px]:grid-cols-2" aria-live="polite">
            <div>
              <dt className="text-xs text-muted-foreground">Total único</dt>
              <dd className="font-medium tabular-nums">{money(computation.oneTimeCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Mensalidade</dt>
              <dd className="font-medium tabular-nums">{money(computation.monthlyCents)}/mês</dd>
            </div>
            <div className="min-[360px]:col-span-2">
              <dt className="text-xs text-muted-foreground">Valor do contrato</dt>
              <dd className="text-base font-semibold tabular-nums">
                {computation.contractError ? '—' : money(computation.contractCents)}
              </dd>
            </div>
          </dl>
          {computation.hasMonthly && (
            <div className="space-y-1.5">
              <Label htmlFor={monthsId}>Meses do contrato *</Label>
              <Input
                id={monthsId}
                inputMode="numeric"
                className="max-w-[10rem]"
                value={months}
                onChange={(event) => onChange(drafts, event.target.value)}
                aria-invalid={!!monthsProblem}
                aria-describedby={[monthsProblem && `${monthsId}-error`, `${monthsId}-hint`].filter(Boolean).join(' ')}
                disabled={disabled}
              />
              <p id={`${monthsId}-hint`} className="text-xs text-muted-foreground">
                Por quantos meses a mensalidade foi negociada, de 1 a 120. O valor do contrato é o total único mais a
                mensalidade × os meses.
              </p>
              {monthsProblem && (
                <p id={`${monthsId}-error`} role="alert" className="text-xs text-destructive">
                  {monthsProblem}
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">O valor da oportunidade passa a ser calculado pelos itens.</p>
        </section>
      )}
    </div>
  );
}

interface DealItemCardProps {
  idPrefix: string;
  index: number;
  draft: DealItemDraft;
  line: DealItemsComputation['lines'][number];
  errors: Partial<Record<DealItemField, string>>;
  products: readonly CatalogProduct[];
  productsLoading: boolean;
  disabled: boolean;
  onChange: (changes: Partial<DealItemDraft>) => void;
  onRemove: () => void;
}

function DealItemCard({
  idPrefix,
  index,
  draft,
  line,
  errors,
  products,
  productsLoading,
  disabled,
  onChange,
  onRemove,
}: DealItemCardProps) {
  const id = (field: DealItemField) => dealItemFieldId(idPrefix, draft.id, field);
  const props = (field: DealItemField, extra: (string | false | undefined)[] = []) => ({
    id: id(field),
    'aria-invalid': !!errors[field],
    'aria-describedby':
      [errors[field] && `${id(field)}-error`, ...extra].filter((value): value is string => !!value).join(' ') ||
      undefined,
    disabled,
  });
  const error = (field: DealItemField) =>
    errors[field] ? (
      <p id={`${id(field)}-error`} role="alert" className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null;
  const summary = dealItemLineSummary(draft, line);
  const label = draft.name.trim() || `Item ${index + 1}`;
  return (
    <li className="min-w-0 space-y-3 rounded-xl border border-border p-3" data-deal-item>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 pt-2 text-sm font-semibold [overflow-wrap:anywhere]">Item {index + 1}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="eia-touch-target shrink-0 text-destructive"
          aria-label={`Remover item ${label}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('product_id')}>Produto ou serviço</Label>
        <ProductPicker
          {...props('product_id')}
          draft={draft}
          products={products}
          loading={productsLoading}
          onPick={(product) =>
            onChange(
              product
                ? {
                    product_id: product.id,
                    name: product.name,
                    unit: product.unit ?? '',
                    unit_price: formatBRLInput(Number(product.price)),
                    billing: product.billing,
                  }
                : { product_id: null },
            )
          }
        />
        {error('product_id')}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('name')}>Nome do item *</Label>
        <Input
          {...props('name')}
          value={draft.name}
          maxLength={160}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="Ex.: Consultoria mensal"
        />
        {error('name')}
      </div>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={id('quantity')}>Quantidade *</Label>
          <Input
            {...props('quantity')}
            inputMode="decimal"
            value={draft.quantity}
            onChange={(event) => onChange({ quantity: event.target.value })}
            placeholder="Ex.: 1 ou 1,5"
          />
          {error('quantity')}
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={id('unit')}>Unidade</Label>
          <Input
            {...props('unit')}
            value={draft.unit}
            maxLength={20}
            onChange={(event) => onChange({ unit: event.target.value })}
            placeholder="Ex.: un, hora, mês"
          />
          {error('unit')}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('unit_price')}>Preço unitário (R$) *</Label>
        <Input
          {...props('unit_price', [`${id('unit_price')}-preview`])}
          inputMode="decimal"
          value={draft.unit_price}
          onChange={(event) => onChange({ unit_price: event.target.value })}
          placeholder="Ex.: 1.500,00"
        />
        <MoneyPreview id={`${id('unit_price')}-preview`} value={draft.unit_price} />
        {error('unit_price')}
      </div>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${id('discount_value')}-type`}>Desconto</Label>
          <select
            id={`${id('discount_value')}-type`}
            className={selectClass}
            value={draft.discount_type}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                discount_type: event.target.value as DealItemDraft['discount_type'],
                ...(event.target.value === 'none' ? { discount_value: '' } : {}),
              })
            }
          >
            <option value="none">Sem desconto</option>
            <option value="percent">Em %</option>
            <option value="amount">Em R$</option>
          </select>
        </div>
        {draft.discount_type !== 'none' && (
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={id('discount_value')}>
              {draft.discount_type === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'}
            </Label>
            <Input
              {...props('discount_value')}
              inputMode="decimal"
              value={draft.discount_value}
              onChange={(event) => onChange({ discount_value: event.target.value })}
              placeholder={draft.discount_type === 'percent' ? 'Ex.: 10' : 'Ex.: 50,00'}
            />
            {error('discount_value')}
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('billing')}>Cobrança</Label>
        <select
          {...props('billing')}
          className={selectClass}
          value={draft.billing}
          onChange={(event) => onChange({ billing: event.target.value as DealItemDraft['billing'] })}
        >
          {Object.entries(DEAL_ITEM_BILLING_LABELS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        {error('billing')}
      </div>
      <p className="text-sm [overflow-wrap:anywhere]" data-deal-item-total>
        <span className="text-muted-foreground">Total da linha: </span>
        <span className="font-medium tabular-nums">
          {summary
            ? `${summary}${draft.billing === 'monthly' ? ' por mês' : ''}`
            : 'Preencha a quantidade e o preço para calcular.'}
        </span>
      </p>
    </li>
  );
}

interface ProductPickerProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby'?: string;
  disabled: boolean;
  draft: DealItemDraft;
  products: readonly CatalogProduct[];
  loading: boolean;
  onPick: (product: CatalogProduct | null) => void;
}

/**
 * A escolha do item: o catálogo ativo por busca (nome ou código, sem acento nem maiúscula) e "Item avulso" no fim. O
 * item que já usa um produto arquivado mostra "(arquivado)"; o arquivado não é oferecido de novo.
 */
function ProductPicker({ draft, products, loading, onPick, ...trigger }: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = draft.product_id ? products.find((product) => product.id === draft.product_id) : undefined;
  const key = textKey(search);
  const options = products.filter(
    (product) =>
      !product.archived_at &&
      (!key || textKey(product.name).includes(key) || (!!product.code && textKey(product.code).includes(key))),
  );
  const currentLabel = draft.product_id
    ? current
      ? `${current.name}${current.code ? ` (${current.code})` : ''}${current.archived_at ? ' (arquivado)' : ''}`
      : loading
        ? 'Carregando catálogo…'
        : 'Item do catálogo indisponível'
    : 'Item avulso';
  const pick = (product: CatalogProduct | null) => {
    onPick(product);
    setOpen(false);
    setSearch('');
  };
  const activeCount = products.filter((product) => !product.archived_at).length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          {...trigger}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="eia-touch-target h-auto min-h-11 w-full justify-between whitespace-normal text-left font-normal"
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{currentLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
        {/* O rótulo do cmdk (um <label> só para leitor de tela) dá o nome da busca. */}
        <Command shouldFilter={false} label="Buscar no catálogo por nome ou código">
          <CommandInput value={search} onValueChange={setSearch} placeholder="Buscar por nome ou código" />
          <CommandList className="max-h-64">
            {/* O "Item avulso" está sempre na lista: o aviso de lista vazia do cmdk nunca apareceria. */}
            {!options.length && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {loading
                  ? 'Carregando catálogo…'
                  : activeCount
                    ? 'Nenhum item encontrado.'
                    : 'Nenhum item no catálogo.'}
              </p>
            )}
            {options.length > 0 && (
              <CommandGroup heading="Catálogo">
                {options.map((product) => (
                  <CommandItem
                    key={product.id}
                    value={product.id}
                    onSelect={() => pick(product)}
                    className="eia-touch-target items-start"
                  >
                    <Check
                      className={cn('mr-2 mt-0.5 h-4 w-4 shrink-0', product.id === draft.product_id ? '' : 'invisible')}
                      aria-hidden
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="block">
                        {product.name}
                        {product.code ? ` (${product.code})` : ''}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatBRL(Number(product.price))}
                        {product.billing === 'monthly' ? '/mês' : ''}
                        {product.unit ? ` · ${product.unit}` : ''}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {/* “Sem catálogo” só quando a empresa não tem item ativo; numa busca sem resultado, o avulso fica sem título. */}
            <CommandGroup heading={!loading && !activeCount ? 'Sem catálogo' : undefined}>
              <CommandItem value="__avulso__" onSelect={() => pick(null)} className="eia-touch-target">
                <Check className={cn('mr-2 h-4 w-4 shrink-0', draft.product_id ? 'invisible' : '')} aria-hidden />
                Item avulso
              </CommandItem>
            </CommandGroup>
          </CommandList>
          {!loading && !activeCount && (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Donos e administradores cadastram produtos e serviços em “Configurações”, na aba “Catálogo”.
            </p>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
