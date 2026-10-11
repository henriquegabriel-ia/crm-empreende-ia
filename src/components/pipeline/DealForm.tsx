import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Textarea } from '@/components/ds/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ds/select';
import { Label } from '@/components/ui/label';
import { SidePanel } from '@/components/foundation/SidePanel';
import { ConfirmDialog } from '@/components/foundation/ConfirmDialog';
import { MoneyPreview } from '@/components/foundation/MoneyPreview';
import type { Deal, DealCompany, DealContact, DealDraft, DealPerson, DealPipeline, DealStage } from '@/lib/deal-types';
import {
  DEAL_STATUS_LABELS,
  dealDraft,
  formatDealCurrency,
  formatProbability,
  validateDealDraft,
} from '@/lib/deal-logic';
import { localDateKey } from '@/lib/dates';
import { errorMessage } from './data';

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
  onSave: (draft: DealDraft) => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => dealDraft(deal, pipeline.id, stages[0], pipeline.currency));
  const initial = useRef(JSON.stringify(draft));
  const [errors, setErrors] = useState<Partial<Record<keyof DealDraft, string>>>({});
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const change = <K extends keyof DealDraft>(key: K, value: DealDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };
  const field = (name: keyof DealDraft) => `${id}-${name}`;
  const close = () => {
    if (busy) return;
    if (JSON.stringify(draft) !== initial.current) setConfirmClose(true);
    else onClose();
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const found = validateDealDraft(draft, stages, deal);
    setErrors(found);
    setSaveError('');
    if (Object.keys(found).length) {
      document.getElementById(field(Object.keys(found)[0] as keyof DealDraft))?.focus();
      return;
    }
    setBusy(true);
    try {
      await onSave(draft);
      onClose();
    } catch (error) {
      setSaveError(errorMessage(error));
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
                {people.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.full_name}
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
                {contacts.map((contact) => (
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
