import { useId, useState } from 'react';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ds/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MoneyPreview } from '@/components/foundation/MoneyPreview';
import { DEAL_ITEM_BILLING_LABELS, PRODUCT_KIND_LABELS } from '@/lib/deal-logic';
import type { CatalogProduct, DealItemBilling } from '@/lib/deal-types';
import { formatBRLInput, MAX_BRL_VALUE, parseBRL } from '@/lib/money';
import { PRODUCT_LIMITS, type ProductFields } from './data';

/** Sugestões de unidade (a pessoa pode escrever outra). */
const UNIT_SUGGESTIONS = ['un', 'hora', 'dia', 'mês', 'kg', 'm²', 'pacote'] as const;

interface ProductDraft {
  name: string;
  code: string;
  kind: CatalogProduct['kind'];
  unit: string;
  price: string;
  billing: DealItemBilling;
}

type ProductErrors = Partial<Record<keyof ProductDraft, string>>;

const draftOf = (product?: CatalogProduct | null): ProductDraft => ({
  name: product?.name ?? '',
  code: product?.code ?? '',
  kind: product?.kind ?? 'product',
  unit: product?.unit ?? '',
  price: product ? formatBRLInput(Number(product.price)) : '',
  billing: product?.billing ?? 'one_time',
});

const singleLine = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Os campos para gravar, ou os erros, com os limites do banco (CHECK de products). */
function productFieldsOf(draft: ProductDraft): { fields: ProductFields | null; errors: ProductErrors } {
  const errors: ProductErrors = {};
  const name = singleLine(draft.name);
  const code = singleLine(draft.code);
  const unit = singleLine(draft.unit);
  if (!name) errors.name = 'Informe o nome do item.';
  else if (name.length > PRODUCT_LIMITS.name) errors.name = `O nome passa de ${PRODUCT_LIMITS.name} caracteres.`;
  if (code.length > PRODUCT_LIMITS.code) errors.code = `O código passa de ${PRODUCT_LIMITS.code} caracteres.`;
  if (unit.length > PRODUCT_LIMITS.unit) errors.unit = `A unidade passa de ${PRODUCT_LIMITS.unit} caracteres.`;
  const price = parseBRL(draft.price);
  if (price === null || price > MAX_BRL_VALUE)
    errors.price = 'Informe um preço positivo ou zero, como 1.500,00, com até duas casas decimais.';
  if (Object.keys(errors).length) return { fields: null, errors };
  return {
    fields: { name, code: code || null, kind: draft.kind, unit: unit || null, price: price!, billing: draft.billing },
    errors,
  };
}

interface ProductDialogProps {
  /** O item em edição; nulo = novo item. */
  product: CatalogProduct | null;
  onClose: () => void;
  /** Grava; uma falha lança a mensagem em pt-BR (o preenchimento continua no diálogo). */
  onSave: (fields: ProductFields) => Promise<void>;
}

/**
 * "Novo item" e "Editar item" do catálogo (item 1.16; docs/arquitetura/1.16.md, seção 7.1): nome, código, tipo,
 * unidade (com sugestões), preço (com a prévia do padrão brasileiro, D7) e cobrança, com os limites do banco. Uma falha
 * (código repetido, conflito de versão, papel) aparece no diálogo, com o preenchimento preservado.
 */
export function ProductDialog({ product, onClose, onSave }: ProductDialogProps) {
  const id = useId();
  const [draft, setDraft] = useState(() => draftOf(product));
  const [errors, setErrors] = useState<ProductErrors>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const field = (name: keyof ProductDraft) => `${id}-${name}`;
  const change = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };
  const describedBy = (name: keyof ProductDraft, extra?: string) =>
    [errors[name] && `${field(name)}-error`, extra].filter(Boolean).join(' ') || undefined;
  const error = (name: keyof ProductDraft) =>
    errors[name] ? (
      <p id={`${field(name)}-error`} role="alert" className="text-xs text-destructive">
        {errors[name]}
      </p>
    ) : null;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const { fields, errors: found } = productFieldsOf(draft);
    setErrors(found);
    setFailure('');
    if (!fields) {
      document.getElementById(field(Object.keys(found)[0] as keyof ProductDraft))?.focus();
      return;
    }
    setBusy(true);
    try {
      await onSave(fields);
      onClose();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product ? 'Editar item do catálogo' : 'Novo item do catálogo'}</DialogTitle>
          <DialogDescription>
            O nome, a unidade, o preço e a cobrança são copiados para a oportunidade quando o item é escolhido, e lá
            podem ser negociados. Mudar o catálogo não muda oportunidades já registradas.
          </DialogDescription>
        </DialogHeader>
        <form id={`${id}-form`} onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={field('name')}>Nome *</Label>
            <Input
              id={field('name')}
              value={draft.name}
              maxLength={PRODUCT_LIMITS.name}
              autoFocus
              onChange={(event) => change('name', event.target.value)}
              aria-invalid={!!errors.name}
              aria-describedby={describedBy('name')}
              disabled={busy}
              placeholder="Ex.: Gestão de tráfego"
            />
            {error('name')}
          </div>
          <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={field('code')}>Código</Label>
              <Input
                id={field('code')}
                value={draft.code}
                maxLength={PRODUCT_LIMITS.code}
                onChange={(event) => change('code', event.target.value)}
                aria-invalid={!!errors.code}
                aria-describedby={describedBy('code', `${field('code')}-hint`)}
                disabled={busy}
                placeholder="Ex.: GT-01"
              />
              <p id={`${field('code')}-hint`} className="text-xs text-muted-foreground">
                Opcional e único no catálogo.
              </p>
              {error('code')}
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={field('unit')}>Unidade</Label>
              <Input
                id={field('unit')}
                value={draft.unit}
                list={`${field('unit')}-options`}
                maxLength={PRODUCT_LIMITS.unit}
                onChange={(event) => change('unit', event.target.value)}
                aria-invalid={!!errors.unit}
                aria-describedby={describedBy('unit')}
                disabled={busy}
                placeholder="Ex.: un, hora, mês"
              />
              <datalist id={`${field('unit')}-options`}>
                {UNIT_SUGGESTIONS.map((unit) => (
                  <option key={unit} value={unit} />
                ))}
              </datalist>
              {error('unit')}
            </div>
          </div>
          <fieldset className="space-y-1" disabled={busy}>
            <legend className="text-sm font-medium">Tipo</legend>
            <RadioGroup
              value={draft.kind}
              onValueChange={(value) => change('kind', value as CatalogProduct['kind'])}
              className="flex flex-wrap gap-x-6 gap-y-0"
            >
              {Object.entries(PRODUCT_KIND_LABELS).map(([value, label]) => (
                <div key={value} className="eia-touch-row flex items-center gap-2">
                  <RadioGroupItem id={`${field('kind')}-${value}`} value={value} />
                  <Label htmlFor={`${field('kind')}-${value}`} className="py-2 font-normal">
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor={field('price')}>Preço (R$) *</Label>
            <Input
              id={field('price')}
              inputMode="decimal"
              value={draft.price}
              onChange={(event) => change('price', event.target.value)}
              aria-invalid={!!errors.price}
              aria-describedby={describedBy('price', `${field('price')}-preview`)}
              disabled={busy}
              placeholder="Ex.: 1.500,00"
            />
            <MoneyPreview id={`${field('price')}-preview`} value={draft.price} />
            {error('price')}
          </div>
          <fieldset className="space-y-1" disabled={busy}>
            <legend className="text-sm font-medium">Cobrança</legend>
            <RadioGroup
              value={draft.billing}
              onValueChange={(value) => change('billing', value as DealItemBilling)}
              className="flex flex-wrap gap-x-6 gap-y-0"
            >
              {Object.entries(DEAL_ITEM_BILLING_LABELS).map(([value, label]) => (
                <div key={value} className="eia-touch-row flex items-center gap-2">
                  <RadioGroupItem id={`${field('billing')}-${value}`} value={value} />
                  <Label htmlFor={`${field('billing')}-${value}`} className="py-2 font-normal">
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          {failure && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {failure}
            </p>
          )}
        </form>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" className="eia-touch-target" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={`${id}-form`} className="eia-touch-target" disabled={busy}>
            {busy ? 'Salvando…' : product ? 'Salvar item' : 'Criar item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
