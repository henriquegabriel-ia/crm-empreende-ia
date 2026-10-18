import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ds/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ds/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ds/tabs';
import { ImportProgress } from '@/components/contact-import/ImportProgress';
import { encodingNotice, formatCount, plural } from '@/components/contact-import/text';
import { exportFileName } from '@/lib/brand';
import { invalidateCrmTables } from '@/lib/crm-cache';
import { downloadText } from '@/lib/csv';
import { DEAL_ITEM_BILLING_LABELS, PRODUCT_KIND_LABELS } from '@/lib/deal-logic';
import { formatBRL } from '@/lib/money';
import { isOfflineRequestError } from '@/lib/offline';
import {
  productCodeKey,
  productImportBatches,
  productImportIssues,
  productImportIssuesCsv,
  PRODUCT_IMPORT_MESSAGES,
  type AnalyzedProductRow,
  type ProductImportAnalysis,
  type ProductSheet,
} from '@/lib/product-import';
import { joinReasons } from '@/lib/sheet-import';
import { cn } from '@/lib/utils';
import { catalogErrorMessage, duplicateCodeOf, insertProductBatch, loadProducts } from './data';

/** Prontas mostradas na prévia; as repetidas e com erro mostram até 50, e o resto vai na planilha. */
const PREVIEW_READY_ROWS = 20;
const PREVIEW_ISSUE_ROWS = 50;
/** Botões do rodapé: no celular, o rótulo longo quebra a linha em vez de alargar o diálogo (como no 1.11). */
const FOOTER_BUTTON = 'eia-touch-target h-auto whitespace-normal';

type Phase = 'preview' | 'writing' | 'result';
type Outcome = { kind: 'done' } | { kind: 'stopped' } | { kind: 'failed'; message: string; retryable: boolean };

interface CatalogImportDialogProps {
  orgId: string;
  sheet: ProductSheet;
  analysis: ProductImportAnalysis;
  onClose: () => void;
}

const itemsLabel = (count: number) => plural(count, 'item', 'itens');

/**
 * "Revisar importação do catálogo" (item 1.16; docs/arquitetura/1.16.md, seção 8.3), no molde do diálogo de contatos do
 * 1.11, em três estados. A prévia mostra as contagens, as colunas reconhecidas e ignoradas e as abas "Prontas",
 * "Repetidas" e "Com erro", e nada é gravado antes de "Importar {n} itens". A gravação vai em lotes de 500 com o id da
 * prévia (uma nova tentativa não duplica), com "Parar"; um código cadastrado por um colega no meio (23505) relê o
 * catálogo e reenvia o lote sem a linha, uma vez; o papel rebaixado (42501) para e diz o motivo. O resultado oferece a
 * planilha dos itens não importados e "Continuar importação".
 */
export function CatalogImportDialog({ orgId, sheet, analysis, onClose }: CatalogImportDialogProps) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('preview');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [written, setWritten] = useState<Set<string>>(() => new Set());
  const [late, setLate] = useState<Map<string, string>>(() => new Map());
  const [stopRequested, setStopRequested] = useState(false);
  const stop = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const batches = useMemo(() => productImportBatches(analysis), [analysis]);
  const total = analysis.ready;

  useEffect(() => {
    titleRef.current?.focus();
  }, [phase]);

  // Durante a gravação, o navegador avisa ao sair da página.
  useEffect(() => {
    if (phase !== 'writing') return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  async function run() {
    setPhase('writing');
    setOutcome(null);
    stop.current = false;
    setStopRequested(false);
    const done = new Set(written);
    const refused = new Map(late);
    let result: Outcome = { kind: 'done' };
    try {
      for (const batch of batches) {
        const pending = batch.filter((row) => !done.has(row.id) && !refused.has(row.id));
        if (!pending.length) continue;
        if (stop.current) {
          result = { kind: 'stopped' };
          break;
        }
        let rows = pending;
        try {
          await insertProductBatch(orgId, rows);
        } catch (error) {
          if (duplicateCodeOf(error) === null) throw error;
          // Um colega cadastrou o mesmo código durante a gravação: relê o catálogo, separa as linhas que agora são
          // repetidas e reenvia o lote sem elas, uma vez. O segundo 23505 do mesmo lote para a importação.
          const catalog = await loadProducts(orgId);
          const codes = new Map(
            catalog.filter((product) => product.code).map((product) => [productCodeKey(product.code)!, product]),
          );
          const stored = new Set(catalog.map((product) => product.id));
          rows = rows.filter((row) => {
            if (stored.has(row.id)) {
              done.add(row.id);
              return false;
            }
            const key = productCodeKey(row.code);
            const existing = key ? codes.get(key) : undefined;
            if (!existing) return true;
            refused.set(row.id, PRODUCT_IMPORT_MESSAGES.existingCode(existing.code!, !!existing.archived_at));
            return false;
          });
          if (rows.length) await insertProductBatch(orgId, rows);
        }
        // Com ignoreDuplicates, o lote que já tinha entrado (resposta perdida) volta sem os ids, e eles existem.
        for (const row of rows) done.add(row.id);
        setWritten(new Set(done));
        setLate(new Map(refused));
      }
    } catch (error) {
      const message = catalogErrorMessage(error);
      const retryable =
        isOfflineRequestError(error) ||
        duplicateCodeOf(error) !== null ||
        !(error && typeof error === 'object' && 'code' in error && String(error.code));
      result = {
        kind: 'failed',
        message: `A importação parou: ${message} ${
          done.size
            ? `${itemsLabel(done.size)} já ${done.size === 1 ? 'foi gravado' : 'foram gravados'}.`
            : 'Nenhum item foi gravado.'
        }`,
        retryable,
      };
    } finally {
      setWritten(new Set(done));
      setLate(new Map(refused));
      if (done.size) await invalidateCrmTables(queryClient, ['products']);
    }
    setOutcome(result);
    setPhase('result');
    if (result.kind === 'done')
      toast.success(`${itemsLabel(done.size)} ${done.size === 1 ? 'importado' : 'importados'}`);
  }

  const resultIssues = productImportIssues(analysis, phase === 'preview' ? null : written, late);
  const previewIssues = productImportIssues(analysis);
  const pending = total - written.size - [...late.keys()].length;
  const downloadIssues = (issues: typeof resultIssues) =>
    downloadText(exportFileName('catalogo-nao-importados', 'csv'), productImportIssuesCsv(sheet, issues));
  const encoding = encodingNotice(sheet.encoding);
  const readyRows = analysis.rows.filter((row) => row.status === 'ready');
  const duplicateRows = analysis.rows.filter((row) => row.status === 'duplicate');
  const errorRows = analysis.rows.filter((row) => row.status === 'error');
  const close = () => {
    if (phase === 'writing') return;
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className={cn(
          'max-h-[92dvh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-3xl',
          phase === 'writing' && '[&>button:last-child]:hidden',
        )}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (phase === 'writing') event.preventDefault();
        }}
      >
        {phase === 'preview' && (
          <>
            <DialogHeader>
              <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
                Revisar importação do catálogo
              </DialogTitle>
              <DialogDescription>
                <span className="[overflow-wrap:anywhere]">“{sheet.fileName}”</span>:{' '}
                {plural(analysis.rows.length, 'linha', 'linhas')}.{' '}
                {plural(analysis.ready, 'pronta para importar', 'prontas para importar')},{' '}
                {plural(analysis.duplicates, 'repetida', 'repetidas')} e {formatCount(analysis.errors)} com erro.
                {encoding && ` ${encoding}`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p className="break-words">
                Colunas reconhecidas: {sheet.recognized.map(({ header, label }) => `${header} → ${label}`).join(', ')}.
              </p>
              {sheet.ignored.length > 0 && (
                <p className="break-words">Colunas ignoradas: {sheet.ignored.join(', ')}.</p>
              )}
              <p>
                A importação só cria itens novos: os que já existem no catálogo não mudam nem voltam a ficar ativos.
              </p>
            </div>
            <Tabs defaultValue="ready" className="space-y-2">
              <TabsList className="flex h-auto w-full flex-wrap justify-start">
                <TabsTrigger value="ready" className="eia-touch-target whitespace-normal">
                  Prontas ({formatCount(readyRows.length)})
                </TabsTrigger>
                <TabsTrigger value="duplicates" className="eia-touch-target whitespace-normal">
                  Repetidas ({formatCount(duplicateRows.length)})
                </TabsTrigger>
                <TabsTrigger value="errors" className="eia-touch-target whitespace-normal">
                  Com erro ({formatCount(errorRows.length)})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="ready">
                {readyRows.length ? (
                  <>
                    <ul className="divide-y rounded-lg border text-sm">
                      {readyRows.slice(0, PREVIEW_READY_ROWS).map((row) => (
                        <ReadyRow key={row.line} row={row} />
                      ))}
                    </ul>
                    {readyRows.length > PREVIEW_READY_ROWS && (
                      <p className="mt-2 text-xs text-muted-foreground">Prévia das primeiras {PREVIEW_READY_ROWS}.</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{PRODUCT_IMPORT_MESSAGES.noReadyRows}</p>
                )}
              </TabsContent>
              <TabsContent value="duplicates">
                <IssueList rows={duplicateRows} sheet={sheet} empty="Nenhuma linha repetida." />
              </TabsContent>
              <TabsContent value="errors">
                <IssueList rows={errorRows} sheet={sheet} empty="Nenhuma linha com erro." />
              </TabsContent>
            </Tabs>
            <DialogFooter className="gap-2">
              {previewIssues.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className={FOOTER_BUTTON}
                  onClick={() => downloadIssues(previewIssues)}
                >
                  Baixar itens não importados
                </Button>
              )}
              <Button type="button" variant="ghost" className={FOOTER_BUTTON} onClick={close}>
                Cancelar
              </Button>
              <Button type="button" className={FOOTER_BUTTON} disabled={!analysis.ready} onClick={() => void run()}>
                Importar {itemsLabel(analysis.ready)}
              </Button>
            </DialogFooter>
          </>
        )}
        {phase === 'writing' && (
          <>
            <DialogHeader>
              <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
                Importando o catálogo
              </DialogTitle>
              <DialogDescription>
                Mantenha esta janela aberta. A gravação acontece em partes de até 500 itens.
              </DialogDescription>
            </DialogHeader>
            <ImportProgress
              written={written.size}
              total={total}
              label="Importação do catálogo"
              nouns={['item gravado', 'itens gravados']}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className={FOOTER_BUTTON}
                disabled={stopRequested}
                onClick={() => {
                  stop.current = true;
                  setStopRequested(true);
                }}
              >
                {stopRequested ? 'Parando…' : 'Parar'}
              </Button>
            </DialogFooter>
          </>
        )}
        {phase === 'result' && outcome && (
          <>
            <DialogHeader>
              <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
                {outcome.kind === 'done' ? 'Importação concluída' : 'Importação parada'}
              </DialogTitle>
              <DialogDescription>
                {`${itemsLabel(written.size)} ${written.size === 1 ? 'importado' : 'importados'}.`}
                {resultIssues.length > 0 &&
                  ` ${plural(resultIssues.length, 'linha ficou', 'linhas ficaram')} de fora: confira na planilha dos itens não importados.`}
              </DialogDescription>
            </DialogHeader>
            {outcome.kind === 'stopped' && (
              <p className="text-sm">
                Você parou a importação. “Continuar importação” grava os que faltam, sem duplicar.
              </p>
            )}
            {outcome.kind === 'failed' && (
              <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
                {outcome.message}
              </p>
            )}
            <DialogFooter className="gap-2">
              {resultIssues.length > 0 && (
                <Button
                  type="button"
                  variant={outcome.kind === 'failed' && !outcome.retryable ? 'default' : 'outline'}
                  className={FOOTER_BUTTON}
                  onClick={() => downloadIssues(resultIssues)}
                >
                  Baixar itens não importados
                </Button>
              )}
              <Button type="button" variant="ghost" className={FOOTER_BUTTON} onClick={close}>
                Fechar
              </Button>
              {outcome.kind !== 'done' && pending > 0 && (outcome.kind === 'stopped' || outcome.retryable) && (
                <Button type="button" className={FOOTER_BUTTON} onClick={() => void run()}>
                  Continuar importação
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReadyRow({ row }: { row: AnalyzedProductRow }) {
  const item = row.payload!;
  return (
    <li className="space-y-0.5 p-2">
      <p className="[overflow-wrap:anywhere]">
        <span className="text-xs text-muted-foreground">Linha {formatCount(row.line)} · </span>
        <span className="font-medium">{item.name}</span>
        {item.code && <span className="text-muted-foreground"> ({item.code})</span>}
      </p>
      <p className="text-muted-foreground">
        {PRODUCT_KIND_LABELS[item.kind]} · {formatBRL(item.price)}
        {item.billing === 'monthly' ? '/mês' : ''}
        {item.unit ? ` · ${item.unit}` : ''} · Cobrança {DEAL_ITEM_BILLING_LABELS[item.billing].toLowerCase()}
      </p>
    </li>
  );
}

/** Quem é a linha: o nome da planilha; sem ele, "(sem nome)". */
function IssueList({ rows, sheet, empty }: { rows: AnalyzedProductRow[]; sheet: ProductSheet; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const nameIndex = sheet.mapping.name;
  return (
    <>
      <ul className="divide-y rounded-lg border text-sm">
        {rows.slice(0, PREVIEW_ISSUE_ROWS).map((row) => (
          <li key={row.line} className="space-y-0.5 p-2">
            <p className="[overflow-wrap:anywhere]">
              <span className="text-xs text-muted-foreground">Linha {formatCount(row.line)} · </span>
              <span className="font-medium">
                {(nameIndex !== undefined && row.cells[nameIndex]?.trim()) || '(sem nome)'}
              </span>
            </p>
            <p className="break-words text-muted-foreground">{joinReasons(row.reasons)}</p>
          </li>
        ))}
      </ul>
      {rows.length > PREVIEW_ISSUE_ROWS && (
        <p className="mt-2 text-xs text-muted-foreground">
          Mais {formatCount(rows.length - PREVIEW_ISSUE_ROWS)} na planilha dos itens não importados.
        </p>
      )}
    </>
  );
}
