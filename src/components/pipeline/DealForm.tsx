import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ListPlus } from 'lucide-react';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Textarea } from '@/components/ds/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ds/select';
import { Label } from '@/components/ui/label';
import { SidePanel } from '@/components/foundation/SidePanel';
import { ConfirmDialog } from '@/components/foundation/ConfirmDialog';
import { MoneyPreview } from '@/components/foundation/MoneyPreview';
import type {
  Deal,
  DealCompany,
  DealContact,
  DealDraft,
  DealItemDraft,
  DealPerson,
  DealPipeline,
  DealStage,
} from '@/lib/deal-types';
import {
  computeDealItems,
  DEAL_STATUS_LABELS,
  dealDraft,
  dealItemDraft,
  dealItemsChanged,
  dealItemsPayload,
  dealValueBreakdown,
  formatDealCurrency,
  formatProbability,
  hasDealItems,
  validateDealDraft,
  type DealItemPayload,
} from '@/lib/deal-logic';
import { useProducts } from '@/hooks/useProducts';
import { useDealItems } from '@/hooks/useDealItems';
import { CATALOG_MIGRATION_MISSING, catalogMigrationMissing } from '@/lib/rpc-errors';
import { DealItemsEditor } from './DealItemsEditor';
import { firstDealItemErrorId } from './deal-item-fields';
import { localDateKey } from '@/lib/dates';
import { assignableMembers, memberLabel } from '@/lib/team-members';
import { errorMessage } from './data';
import { linkableContacts } from '@/lib/privacy';

/**
 * O que o formulário manda sobre os itens (item 1.16; docs/arquitetura/1.16.md, seção 7.3). Com os itens mexidos, a
 * gravação vai por `save_deal` (campos e itens na mesma transação); sem, pelo caminho de sempre, e uma oportunidade que
 * já tem itens não manda o valor (o banco recusaria mudá-lo por fora dos itens).
 */
export interface DealItemsSubmission {
  /** A lista completa para `save_deal` quando os itens foram mexidos ([] remove todos); nulo = caminho de sempre. */
  items: DealItemPayload[] | null;
  /** Meses do contrato (com item mensal); nulo sem item mensal. */
  contractMonths: number | null;
  /** Id da oportunidade nova, gerado ao abrir o formulário: a nova tentativa depois de uma resposta perdida usa o mesmo. */
  newDealId: string;
  /** A oportunidade já tinha itens gravados. */
  hadItems: boolean;
}

export function DealForm({
  deal,
  pipeline,
  stages,
  contacts,
  companies,
  people,
  onClose,
  onSave,
}: {
  deal?: Deal;
  pipeline: DealPipeline;
  stages: DealStage[];
  contacts: DealContact[];
  companies: DealCompany[];
  people: DealPerson[];
  onClose: () => void;
  onSave: (draft: DealDraft, items: DealItemsSubmission) => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => dealDraft(deal, pipeline.id, stages[0], pipeline.currency));
  const initial = useRef(JSON.stringify(draft));
  // Item 1.16: o id da oportunidade nova nasce ao abrir o formulário e fica o mesmo nas novas tentativas.
  const newDealId = useRef(crypto.randomUUID());
  const hadItems = hasDealItems(deal);
  const savedItems = useDealItems(deal?.id, { enabled: hadItems, version: deal?.updated_at });
  const [drafts, setDrafts] = useState<DealItemDraft[]>([]);
  const [months, setMonths] = useState('');
  const [itemsOpen, setItemsOpen] = useState(false);
  const [itemsReady, setItemsReady] = useState(!hadItems);
  const [showItemErrors, setShowItemErrors] = useState(false);
  const initialItems = useRef(JSON.stringify({ drafts: [], months: '' }));
  const products = useProducts({ enabled: hadItems || itemsOpen });
  // Os itens gravados viram rascunhos uma vez, quando a leitura chega; depois, o editor é da pessoa.
  useEffect(() => {
    if (itemsReady || !savedItems.data) return;
    const loaded = savedItems.data.map((item) => dealItemDraft(item));
    const loadedMonths = deal?.contract_months ? String(deal.contract_months) : '';
    setDrafts(loaded);
    setMonths(loadedMonths);
    initialItems.current = JSON.stringify({ drafts: loaded, months: loadedMonths });
    setItemsReady(true);
    setItemsOpen(loaded.length > 0);
  }, [itemsReady, savedItems.data, deal?.contract_months]);
  // Banco sem a migração do catálogo (AC-14): o editor dá lugar à mensagem, sem rascunho, e a gravação segue pelo
  // caminho de sempre, com o valor digitado.
  useEffect(() => {
    if (products.missing) setDrafts([]);
  }, [products.missing]);
  const computation = useMemo(
    () => computeDealItems(drafts, months, { products: products.products, saved: savedItems.items }),
    [drafts, months, products.products, savedItems.items],
  );
  const hasDrafts = drafts.length > 0;
  // Enquanto os itens gravados não chegam, o valor é o do contrato, só leitura: os itens não foram mexidos.
  const valueLocked = hasDrafts || (hadItems && !itemsReady);
  const [errors, setErrors] = useState<Partial<Record<keyof DealDraft, string>>>({});
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // Quem foi desativado (item 1.2) não é oferecido; o responsável atual desativado aparece marcado, para ser trocado.
  const owners = assignableMembers(people, deal?.owner_id);
  const change = <K extends keyof DealDraft>(key: K, value: DealDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };
  const field = (name: keyof DealDraft) => `${id}-${name}`;
  const itemsDirty = JSON.stringify({ drafts, months }) !== initialItems.current;
  const close = () => {
    if (busy) return;
    if (JSON.stringify(draft) !== initial.current || itemsDirty) setConfirmClose(true);
    else onClose();
  };
  const changeItems = (next: DealItemDraft[], nextMonths: string) => {
    setDrafts(next);
    setMonths(nextMonths);
  };
  const openItems = () => {
    setItemsOpen(true);
    if (!drafts.length) setDrafts([dealItemDraft()]);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const found = validateDealDraft(draft, stages, deal, undefined, { hasItems: valueLocked });
    setErrors(found);
    setSaveError('');
    // C6: com os itens mexidos (ou criação com itens), a gravação vai por save_deal; sem, pelo caminho de sempre.
    const changed = deal
      ? itemsReady && dealItemsChanged(savedItems.items, deal.contract_months, drafts, months)
      : hasDrafts;
    const itemsInvalid = changed && hasDrafts && !computation.valid;
    if (itemsInvalid) setShowItemErrors(true);
    if (Object.keys(found).length) {
      document.getElementById(field(Object.keys(found)[0] as keyof DealDraft))?.focus();
      return;
    }
    if (itemsInvalid) {
      const target = firstDealItemErrorId(`${id}-items`, drafts, computation);
      if (target) document.getElementById(target)?.focus();
      return;
    }
    setBusy(true);
    try {
      await onSave(draft, {
        items: changed ? (hasDrafts ? dealItemsPayload(drafts) : []) : null,
        contractMonths: changed && computation.hasMonthly ? computation.months : null,
        newDealId: newDealId.current,
        hadItems,
      });
      onClose();
    } catch (error) {
      setSaveError(catalogMigrationMissing(error) ? CATALOG_MIGRATION_MISSING : errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const errorFor = (name: keyof DealDraft) =>
    errors[name] ? (
      <p id={`${field(name)}-error`} className="text-xs text-destructive" role="alert">
        {errors[name]}
      </p>
    ) : null;
  const inputProps = (name: keyof DealDraft) => ({
    id: field(name),
    'aria-invalid': !!errors[name],
    'aria-describedby': errors[name] ? `${field(name)}-error` : undefined,
  });
  const describedBy = (name: keyof DealDraft) =>
    [errors[name] && `${field(name)}-error`, `${field(name)}-hint`].filter(Boolean).join(' ');
  const stageProbability = formatProbability(
    Number(stages.find((stage) => stage.id === draft.stage_id)?.win_probability ?? 0),
  );
  const closed = !!deal && deal.status !== 'open';
  return (
    <>
      <SidePanel
        open
        onOpenChange={(open) => !open && close()}
        title={deal ? 'Editar oportunidade' : 'Nova oportunidade'}
        description={pipeline.name}
        kicker="Pipeline comercial"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" form={`${id}-form`} disabled={busy}>
              {busy ? 'Salvando…' : deal ? 'Salvar alterações' : 'Criar oportunidade'}
            </Button>
          </>
        }
      >
        <form id={`${id}-form`} onSubmit={save} className="space-y-5" noValidate>
          {saveError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {saveError}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor={field('title')}>Nome da oportunidade *</Label>
            <Input
              {...inputProps('title')}
              value={draft.title}
              maxLength={180}
              onChange={(event) => change('title', event.target.value)}
              placeholder="Ex.: Proposta de serviços — Empresa"
              autoFocus
              disabled={busy}
            />
            {errorFor('title')}
          </div>
          {!deal && (
            <div className="space-y-2">
              <Label htmlFor={field('stage_id')}>Etapa inicial *</Label>
              <Select value={draft.stage_id} onValueChange={(value) => change('stage_id', value)} disabled={busy}>
                <SelectTrigger {...inputProps('stage_id')}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errorFor('stage_id')}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {valueLocked ? (
              // Só leitura: o grupo leva o nome e a explicação (um parágrafo não pode ter nome acessível).
              <div
                className="space-y-2"
                role="group"
                aria-labelledby={`${field('value')}-label`}
                aria-describedby={`${field('value')}-hint`}
              >
                <p className="text-sm font-medium" id={`${field('value')}-label`}>
                  Valor do contrato ({pipeline.currency})
                </p>
                <p
                  className="flex min-h-11 items-center rounded-xl border border-border bg-muted/30 px-3 text-sm font-semibold tabular-nums"
                  data-contract-value
                >
                  {formatDealCurrency(
                    hasDrafts && !computation.contractError ? computation.contractCents / 100 : (deal?.value ?? 0),
                    draft.currency,
                  )}
                </p>
                <p id={`${field('value')}-hint`} className="text-xs text-muted-foreground">
                  {hasDrafts
                    ? 'Calculado pelos itens abaixo: o total único mais a mensalidade × os meses do contrato.'
                    : (deal && dealValueBreakdown(deal)) || 'Calculado pelos itens da oportunidade.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor={field('value')}>Valor ({pipeline.currency}) *</Label>
                <Input
                  {...inputProps('value')}
                  aria-describedby={[errors.value && `${field('value')}-error`, `${field('value')}-preview`]
                    .filter(Boolean)
                    .join(' ')}
                  inputMode="decimal"
                  value={draft.value}
                  onChange={(event) => change('value', event.target.value)}
                  placeholder="Ex.: 1.500,00"
                  disabled={busy}
                />
                <MoneyPreview
                  id={`${field('value')}-preview`}
                  value={draft.value}
                  format={(value) => formatDealCurrency(value, draft.currency)}
                />
                {errorFor('value')}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor={field('probability')}>Probabilidade (%)</Label>
              <Input
                {...inputProps('probability')}
                aria-describedby={describedBy('probability')}
                type="number"
                min="0"
                max="100"
                step="1"
                value={draft.probability}
                placeholder={stageProbability}
                onChange={(event) => change('probability', event.target.value)}
                disabled={busy || draft.status !== 'open'}
              />
              <p id={`${field('probability')}-hint`} className="text-xs text-muted-foreground">
                {draft.status !== 'open'
                  ? `Definida pela situação: ${draft.status === 'won' ? '100%' : '0%'}.`
                  : draft.probability.trim()
                    ? `Valor desta oportunidade. Apague para usar a da etapa (${stageProbability}).`
                    : `Da etapa: ${stageProbability}`}
              </p>
              {errorFor('probability')}
            </div>
          </div>
          <section aria-label="Itens da oportunidade" className="space-y-2">
            {itemsOpen || hasDrafts ? (
              <>
                <h3 className="text-sm font-semibold">Itens</h3>
                <DealItemsEditor
                  idPrefix={`${id}-items`}
                  drafts={drafts}
                  months={months}
                  computation={computation}
                  products={products.products}
                  productsLoading={products.isPending}
                  catalogMissing={products.missing}
                  showErrors={showItemErrors}
                  disabled={busy}
                  onChange={changeItems}
                />
              </>
            ) : hadItems && !itemsReady ? (
              <>
                <h3 className="text-sm font-semibold">Itens</h3>
                {savedItems.isError ? (
                  <div role="alert" className="space-y-2 text-sm text-destructive">
                    <p>
                      {savedItems.missing
                        ? CATALOG_MIGRATION_MISSING
                        : 'Não foi possível carregar os itens. Os outros campos podem ser salvos sem mexer neles.'}
                    </p>
                    {!savedItems.missing && (
                      <Button type="button" size="sm" variant="outline" onClick={() => void savedItems.refetch()}>
                        Tentar novamente
                      </Button>
                    )}
                  </div>
                ) : (
                  <p role="status" className="text-sm text-muted-foreground">
                    Carregando itens…
                  </p>
                )}
              </>
            ) : (
              <div className="space-y-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="eia-touch-target"
                  onClick={openItems}
                  disabled={busy}
                >
                  <ListPlus className="mr-1.5 h-4 w-4" aria-hidden />
                  Adicionar itens
                </Button>
                <p className="text-xs text-muted-foreground">
                  Opcional: monte o valor com produtos e serviços do catálogo ou com itens avulsos.
                </p>
              </div>
            )}
          </section>
          <div className="space-y-2">
            <Label htmlFor={field('owner_id')}>Responsável{draft.status === 'won' ? ' *' : ''}</Label>
            <Select
              value={draft.owner_id || 'none'}
              onValueChange={(value) => change('owner_id', value === 'none' ? '' : value)}
              disabled={busy}
            >
              <SelectTrigger {...inputProps('owner_id')}>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem responsável</SelectItem>
                {owners.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {memberLabel(person)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errorFor('owner_id')}
          </div>
          <div className="space-y-2">
            <Label htmlFor={field('contact_id')}>Contato</Label>
            <Select
              value={draft.contact_id || 'none'}
              onValueChange={(value) => {
                change('contact_id', value === 'none' ? '' : value);
                const contact = contacts.find((item) => item.id === value);
                if (contact?.company_id && !draft.company_id) change('company_id', contact.company_id);
              }}
              disabled={busy}
            >
              <SelectTrigger id={field('contact_id')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem contato vinculado</SelectItem>
                {/* O contato anonimizado (item 1.10) não recebe vínculo novo; numa edição, o atual continua. */}
                {linkableContacts(contacts, deal?.contact_id).map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    {contact.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={field('company_id')}>Empresa</Label>
            <Select
              value={draft.company_id || 'none'}
              onValueChange={(value) => change('company_id', value === 'none' ? '' : value)}
              disabled={busy}
            >
              <SelectTrigger id={field('company_id')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem empresa vinculada</SelectItem>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={field('close_date')}>Previsão de fechamento</Label>
            <Input
              {...inputProps('close_date')}
              type="date"
              value={draft.close_date}
              onChange={(event) => change('close_date', event.target.value)}
              disabled={busy}
            />
            {errorFor('close_date')}
          </div>
          {closed && (
            <div className="space-y-2">
              <Label htmlFor={field('closed_at')}>Fechada em *</Label>
              <Input
                {...inputProps('closed_at')}
                aria-describedby={describedBy('closed_at')}
                type="date"
                value={draft.closed_at}
                min={localDateKey(new Date(deal.created_at))}
                max={localDateKey()}
                onChange={(event) => change('closed_at', event.target.value)}
                disabled={busy}
              />
              <p id={`${field('closed_at')}-hint`} className="text-xs text-muted-foreground">
                Dia real em que a oportunidade foi {deal.status === 'won' ? 'ganha' : 'perdida'}, que pode diferir da
                previsão acima. Os Relatórios contam o resultado por esta data.
              </p>
              {errorFor('closed_at')}
            </div>
          )}
          {!deal && (
            <div className="space-y-2">
              <Label htmlFor={field('status')}>Situação</Label>
              <Select
                value={draft.status}
                onValueChange={(value) => {
                  change('status', value as DealDraft['status']);
                  change('probability', value === 'won' ? '100' : value === 'lost' ? '0' : '');
                }}
                disabled={busy}
              >
                <SelectTrigger
                  id={field('status')}
                  aria-describedby={draft.status !== 'open' ? `${field('status')}-hint` : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DEAL_STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {draft.status !== 'open' && (
                <p id={`${field('status')}-hint`} className="text-xs text-muted-foreground">
                  Será registrada como {draft.status === 'won' ? 'ganha' : 'perdida'} hoje. A data de fechamento não
                  pode ser anterior ao cadastro, então {draft.status === 'won' ? 'uma venda' : 'uma perda'} de dias
                  anteriores entra nos Relatórios hoje.
                </p>
              )}
            </div>
          )}
          {draft.status === 'lost' && (
            <div className="space-y-2">
              <Label htmlFor={field('lost_reason')}>Motivo da perda *</Label>
              <Textarea
                {...inputProps('lost_reason')}
                value={draft.lost_reason}
                onChange={(event) => change('lost_reason', event.target.value)}
                maxLength={2000}
                disabled={busy}
                placeholder="O que impediu o fechamento?"
              />
              {errorFor('lost_reason')}
            </div>
          )}
          {deal && (
            <p className="text-xs text-muted-foreground">
              Para mover de etapa, ganhar, perder ou reabrir, use o menu da oportunidade. Cada movimentação fica
              registrada no histórico.
            </p>
          )}
        </form>
      </SidePanel>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Descartar alterações?"
        description="Os campos ainda não salvos serão descartados."
        confirmLabel="Descartar"
        onConfirm={onClose}
      />
    </>
  );
}
