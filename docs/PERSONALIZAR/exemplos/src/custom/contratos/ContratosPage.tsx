// Exemplo de docs/PERSONALIZAR/TELA.md: a tela "Contratos", uma tela nova de quem personaliza, em src/custom/. Usa os
// componentes e os padrões da base (PageScaffold, EmptyState, LoadingState, diálogo do design system, DESIGN.md), o
// papel da conta (useCrmPermissions) só para esconder o que ela não faz, e mostra a recusa do banco pelo errorMessage
// da base (a mensagem de um gancho, P0001, como está; a falta de permissão, 42501, com a mensagem de papel).
import { useId, useState } from 'react';
import { AlertCircle, FileSignature, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { PageScaffold } from '@/components/shell/PageScaffold';
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
import { EmptyState } from '@/components/foundation/EmptyState';
import { LoadingState } from '@/components/foundation/LoadingState';
import { Panel, PanelBody } from '@/components/foundation/Panel';
import { StatusChip } from '@/components/foundation/StatusChip';
import { errorMessage } from '@/components/pipeline/data';
import type { NovoContrato, OportunidadeOpcao } from './data';
import { useContratos } from './useContratos';

/** "2026-11-01" vira "01/11/2026"; sem data, "sem data". */
const dataBr = (value: string | null) => (value ? value.split('-').reverse().join('/') : 'sem data');

interface NovoContratoDialogProps {
  oportunidades: OportunidadeOpcao[];
  /** A lista de oportunidades ainda carregando ou com falha: o seletor fica desabilitado, com o motivo. */
  oportunidadesState: 'loading' | 'error' | 'ready';
  /** Busca as oportunidades de novo, depois de uma falha. */
  onRetry: () => void;
  onClose: () => void;
  /** Grava; uma falha lança o erro do banco, e o preenchimento continua no diálogo. */
  onSave: (contrato: NovoContrato) => Promise<void>;
}

function NovoContratoDialog({
  oportunidades,
  oportunidadesState,
  onRetry,
  onClose,
  onSave,
}: NovoContratoDialogProps) {
  const id = useId();
  const [dealId, setDealId] = useState('');
  const [numero, setNumero] = useState('');
  const [assinadoEm, setAssinadoEm] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  // Sem oportunidade para escolher, o diálogo diz o que fazer antes, em vez de só recusar ao salvar.
  const semOportunidade = oportunidadesState === 'ready' && oportunidades.length === 0;
  const blocked = oportunidadesState !== 'ready' || semOportunidade;
  const hintId = `${id}-deal-hint`;
  const hint =
    oportunidadesState === 'error'
      ? 'Não foi possível carregar as oportunidades. Use “Tentar novamente”.'
      : semOportunidade
        ? 'Crie uma oportunidade no “Pipeline” antes de registrar o contrato.'
        : '';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!dealId || !numero.trim()) {
      setFailure('Escolha a oportunidade e informe o número do contrato.');
      return;
    }
    setBusy(true);
    setFailure('');
    try {
      await onSave({ deal_id: dealId, numero: numero.trim(), assinado_em: assinadoEm || null });
      onClose();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo contrato</DialogTitle>
          <DialogDescription>O contrato fica ligado à oportunidade escolhida, da sua empresa.</DialogDescription>
        </DialogHeader>
        <form id={`${id}-form`} onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-deal`}>Oportunidade *</Label>
            <select
              id={`${id}-deal`}
              className="h-11 w-full rounded-xl border border-input bg-background px-3"
              value={dealId}
              disabled={busy || blocked}
              aria-describedby={hint ? hintId : undefined}
              onChange={(event) => setDealId(event.target.value)}
            >
              <option value="">
                {oportunidadesState === 'loading' ? 'Carregando oportunidades…' : 'Escolha a oportunidade'}
              </option>
              {oportunidades.map((oportunidade) => (
                <option key={oportunidade.id} value={oportunidade.id}>
                  {oportunidade.title}
                </option>
              ))}
            </select>
            {hint && (
              <div className="flex flex-wrap items-center gap-2">
                <p id={hintId} className="text-sm text-muted-foreground">
                  {hint}
                </p>
                {oportunidadesState === 'error' && (
                  <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={busy}>
                    Tentar novamente
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${id}-numero`}>Número *</Label>
              <Input
                id={`${id}-numero`}
                value={numero}
                maxLength={60}
                disabled={busy}
                placeholder="Ex.: C-2026-014"
                onChange={(event) => setNumero(event.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${id}-assinado`}>Assinado em</Label>
              <Input
                id={`${id}-assinado`}
                type="date"
                value={assinadoEm}
                disabled={busy}
                onChange={(event) => setAssinadoEm(event.target.value)}
              />
            </div>
          </div>
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={busy || blocked}>
            {busy ? 'Salvando…' : 'Salvar contrato'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A tela "Contratos": a lista da empresa e, para quem edita, "Novo contrato". */
export default function ContratosPage() {
  const { canWrite, loading: permissionsLoading } = useCrmPermissions();
  const { contratos, oportunidades, criar } = useContratos();
  const [creating, setCreating] = useState(false);
  const titles = new Map((oportunidades.data ?? []).map((oportunidade) => [oportunidade.id, oportunidade.title]));
  const list = contratos.data ?? [];
  return (
    <PageScaffold
      title="Contratos"
      meta={<StatusChip>{list.length} contratos</StatusChip>}
      actions={
        canWrite && (
          <Button size="sm" onClick={() => setCreating(true)} disabled={contratos.isPending}>
            <Plus className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Novo contrato</span>
            <span className="sr-only sm:hidden">Novo contrato</span>
          </Button>
        )
      }
    >
      {contratos.isPending || permissionsLoading ? (
        <LoadingState label="Carregando contratos…" />
      ) : contratos.isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Não foi possível carregar os contratos"
          description={errorMessage(contratos.error)}
          action={<Button onClick={() => void contratos.refetch()}>Tentar novamente</Button>}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="Nenhum contrato registrado"
          description={
            canWrite
              ? 'Quando uma oportunidade virar contrato, use “Novo contrato” para registrar o número e a data de assinatura.'
              : 'Os contratos registrados pela equipe aparecem aqui.'
          }
        />
      ) : (
        <div className="space-y-4">
          {!canWrite && (
            <p className="text-sm text-muted-foreground">
              Você pode consultar. Donos, administradores e colaboradores registram contratos.
            </p>
          )}
          <Panel>
            <PanelBody>
              <ul data-tour="custom-contratos-list" className="divide-y divide-border">
                {list.map((contrato) => (
                  <li key={contrato.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                    <span className="font-semibold">{contrato.numero}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {titles.get(contrato.deal_id) ?? 'Oportunidade indisponível'}
                    </span>
                    <span className="text-sm tabular-nums">{dataBr(contrato.assinado_em)}</span>
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>
        </div>
      )}
      {creating && (
        <NovoContratoDialog
          oportunidades={oportunidades.data ?? []}
          oportunidadesState={oportunidades.isPending ? 'loading' : oportunidades.isError ? 'error' : 'ready'}
          onRetry={() => void oportunidades.refetch()}
          onClose={() => setCreating(false)}
          onSave={async (contrato) => {
            await criar.mutateAsync(contrato);
            toast.success('Contrato registrado.');
          }}
        />
      )}
    </PageScaffold>
  );
}
