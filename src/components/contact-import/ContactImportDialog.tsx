import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ds/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ds/dialog';
import { exportFileName } from '@/lib/brand';
import {
  analyzeContactImportInChunks,
  CONTACT_IMPORT_LIMITS,
  contactImportIssues,
  contactImportIssuesCsv,
  IMPORT_MESSAGES,
  planContactImport,
  type ContactImportAnalysis,
  type ContactImportIssue,
  type ContactImportOptions,
  type ContactImportPlan,
  type OwnerMode,
} from '@/lib/contact-import';
import { downloadText } from '@/lib/csv';
import { cn } from '@/lib/utils';
import { loadImportContext } from './data';
import { ImportIssues } from './ImportIssues';
import { ImportProgress } from './ImportProgress';
import { ImportSummary } from './ImportSummary';
import { LeadSourceField } from '@/components/commercial/LeadSourceField';
import { OwnerChoiceFields } from './OwnerChoiceFields';
import { encodingNotice, formatCount, importButtonLabel, plural } from './text';
import {
  contactsLabel,
  pendingRows,
  useContactImportWriter,
  writtenSentence,
  type ContactImportOutcome,
} from './useContactImportWriter';

interface Props {
  analysis: ContactImportAnalysis;
  orgId: string;
  meId: string;
  onClose: () => void;
}

type Phase = 'preview' | 'writing' | 'result';

/** Botões do rodapé: no celular, o rótulo longo quebra a linha em vez de alargar o diálogo (revisão do item 1.11). */
const FOOTER_BUTTON = 'eia-touch-target h-auto whitespace-normal';

/**
 * "Revisar importação" (item 1.11; docs/arquitetura/1.11.md, seção 6): o mesmo diálogo da importação de "Integrações"
 * (desde o 0.5), em três estados. A prévia mostra as contagens, as colunas, os avisos, as escolhas (responsável, origem
 * padrão e telefone repetido) e as listas, e nada é gravado antes de "Importar"; mudar uma escolha recalcula só o plano.
 * A gravação mostra o progresso, não deixa a janela fechar, mantém a tela no "Voltar" do navegador e do celular e avisa
 * ao sair da página; "Parar" termina o lote em andamento. O resultado diz quantos entraram e oferece a planilha dos não
 * importados e "Continuar importação"; fechar com contatos por gravar pede confirmação.
 */
export function ContactImportDialog({ analysis: initial, orgId, meId, onClose }: Props) {
  const [analysis, setAnalysis] = useState(initial);
  const [phase, setPhase] = useState<Phase>('preview');
  const [ownerMode, setOwnerMode] = useState<OwnerMode>('me');
  const [otherOwnerId, setOtherOwnerId] = useState<string | null>(null);
  const [distributeIds, setDistributeIds] = useState<string[]>([]);
  const [defaultSource, setDefaultSource] = useState('');
  const [includePhoneDuplicates, setIncludePhoneDuplicates] = useState(false);
  const [frozen, setFrozen] = useState<ContactImportPlan | null>(null);
  const [outcome, setOutcome] = useState<ContactImportOutcome | null>(null);
  const [alert, setAlert] = useState('');
  const [reloading, setReloading] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // Uma recusa do banco já voltou à prévia (revisão do item 1.11, achado 1): o botão vira "Continuar importação de …",
  // como o alerta manda, e fechar pede confirmação, mesmo sem nenhum contato gravado (as empresas novas podem estar).
  const [resumed, setResumed] = useState(false);
  const writer = useContactImportWriter({ orgId, withDoNotContact: initial.columns.doNotContact });
  const titleRef = useRef<HTMLHeadingElement>(null);
  const blockedId = useId();
  const sourceId = useId();
  const phoneOptionId = useId();
  const options: ContactImportOptions = useMemo(
    () => ({ ownerMode, meId, otherOwnerId, distributeIds, defaultSource, includePhoneDuplicates }),
    [ownerMode, meId, otherOwnerId, distributeIds, defaultSource, includePhoneDuplicates],
  );
  const plan = useMemo(() => planContactImport(analysis, options), [analysis, options]);
  const { progress } = writer;
  const resuming = resumed || progress.written.size > 0;

  // A cada estado, o foco vai para o título, e o leitor de tela anuncia a mudança.
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

  // Durante a gravação, o "Voltar" do navegador (e o botão ou o gesto de voltar do celular) não tira a pessoa da tela:
  // uma entrada a mais no histórico, com o mesmo endereço, é reposta a cada volta, com um aviso. Ao sair da gravação, a
  // entrada sai, se ainda for a atual. Uma volta que ainda cai numa entrada de guarda (a que o próprio diálogo pediu,
  // chegando depois de uma nova gravação começar) não tira ninguém da tela e passa sem aviso.
  useEffect(() => {
    if (phase !== 'writing') return;
    const guard = { ...(window.history.state ?? {}), contactImportGuard: true };
    window.history.pushState(guard, '', window.location.href);
    const stay = (event: PopStateEvent) => {
      if (isGuardState(event.state)) return;
      window.history.pushState(guard, '', window.location.href);
      toast.info('A importação continua', { description: 'Espere terminar ou use “Parar”.' });
    };
    window.addEventListener('popstate', stay);
    return () => {
      window.removeEventListener('popstate', stay);
      if (isGuardState(window.history.state)) window.history.back();
    };
  }, [phase]);

  function downloadIssues(source: ContactImportPlan, written: ReadonlySet<string> | null) {
    const issues = contactImportIssues(source, written, written ? progress.late : undefined);
    downloadText(exportFileName('contatos-nao-importados', 'csv'), contactImportIssuesCsv(analysis.sheet, issues));
  }

  function finish(result: Exclude<ContactImportOutcome, { kind: 'refused' }>) {
    setOutcome(result);
    setPhase('result');
    const written = progress.written.size;
    if (result.kind === 'done')
      toast.success(`${contactsLabel(written)} ${written === 1 ? 'importado' : 'importados'}`);
    else
      toast.info('Importação parada', {
        description: `${contactsLabel(written)} ${written === 1 ? 'gravado' : 'gravados'} até aqui.`,
      });
  }

  async function write(target: ContactImportPlan) {
    setPhase('writing');
    setAlert('');
    setConfirmingClose(false);
    const result = await writer.run(target);
    if (result.kind !== 'refused') {
      finish(result);
      return;
    }
    // Recusa de um gatilho (o responsável desativado no meio, por exemplo) ou de um vínculo que sumiu (a empresa
    // excluída por um colega): relê a equipe, os contatos e as empresas e refaz a análise só das linhas que faltam, com
    // os mesmos ids, e volta à prévia.
    setPhase('preview');
    setResumed(true);
    setReloading(true);
    try {
      const context = await loadImportContext(orgId);
      // Os ids que já estão no banco contam como gravados, como no caminho do 23505: a nova tentativa de um lote que
      // entrou sem a resposta chegar também passa pelo gatilho e pode ser recusada (revisão do item 1.11). As empresas
      // novas seguem o banco: a gravada sem a resposta conta, e a excluída por um colega volta a ser criada.
      const storedContacts = new Set(context.existingContacts.map((contact) => contact.id));
      for (const row of analysis.rows) if (storedContacts.has(row.id)) progress.written.add(row.id);
      const storedCompanies = new Set(context.companies.map((company) => company.id));
      for (const id of analysis.newCompanyIds.values()) if (storedCompanies.has(id)) progress.companies.add(id);
      for (const id of [...progress.companies]) if (!storedCompanies.has(id)) progress.companies.delete(id);
      if (!pendingRows(target, progress).length) {
        finish({ kind: 'done' });
        return;
      }
      const remaining = analysis.rows.filter((row) => !progress.written.has(row.id));
      const next = await analyzeContactImportInChunks(analysis.sheet, context, {
        rowIds: new Map(remaining.map((row) => [row.index, row.id])),
        companyIds: analysis.newCompanyIds,
        onlyRows: new Set(remaining.map((row) => row.index)),
      });
      setAnalysis(next);
      setAlert(
        `A importação parou: ${result.message} ${writtenSentence(progress.written.size)} Confira a prévia dos que faltam e use “Continuar importação”.`,
      );
    } catch {
      setOutcome({
        kind: 'failed',
        message: `A importação parou: ${result.message} ${writtenSentence(progress.written.size)} Não foi possível conferir os contatos que faltam. Verifique a conexão e use “Continuar importação”.`,
        retryable: true,
      });
      setPhase('result');
    } finally {
      setReloading(false);
    }
  }

  function confirm() {
    if (plan.blocked || reloading) return;
    setFrozen(plan);
    void write(plan);
  }

  // Contatos que ficariam sem gravar ao fechar: os que faltam de uma importação parada, ou os prontos da prévia depois
  // de uma recusa. Escolher o arquivo de novo depois duplicaria os que não têm e-mail nem telefone.
  const unsaved =
    phase === 'result' && outcome && outcome.kind !== 'done' && frozen
      ? pendingRows(frozen, progress).length
      : phase === 'preview' && resuming
        ? reloading && frozen
          ? pendingRows(frozen, progress).length
          : plan.ready.length
        : 0;

  function close() {
    if (phase === 'writing') return;
    if (unsaved > 0 && !confirmingClose) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  }

  // Uma recusa do banco que se repetiria igual (achado 9 da revisão do 1.11): sem "Continuar importação", e a orientação
  // é uma só, a planilha de não importados, no alerta e na confirmação ao fechar.
  const refusedForGood = phase === 'result' && outcome?.kind === 'failed' && !outcome.retryable;
  const closeWarning = confirmingClose && unsaved > 0 && (
    <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
      {unsaved === 1
        ? '1 contato que falta não será gravado.'
        : `${formatCount(unsaved)} contatos que faltam não serão gravados.`}{' '}
      {refusedForGood
        ? 'Antes de fechar, use “Baixar contatos não importados”: o arquivo traz só os que faltam, para conferir e importar de novo.'
        : '“Continuar importação” grava sem duplicar; escolher o arquivo de novo depois duplica os contatos sem e-mail e sem telefone.'}
    </p>
  );
  const closeLabel = (label: string) => (confirmingClose && unsaved > 0 ? 'Fechar sem gravar' : label);

  const writtenCount = writer.state.running ? writer.state.written : progress.written.size;
  const total = frozen ? progress.written.size + pendingRows(frozen, progress).length : 0;
  const creating =
    phase === 'writing' && writer.state.phase === 'companies' && frozen
      ? frozen.companies.filter((company) => !progress.companies.has(company.id)).length || null
      : null;
  const issueCount = plan.duplicates.length + plan.errors.length;
  const resultIssues = frozen ? contactImportIssues(frozen, progress.written, progress.late) : [];
  // Repetidas pelo e-mail cadastrado no meio da gravação que pediam "Não contatar" (achado 8 da revisão do 1.11).
  const lateDoNotContact = [...progress.late.values()].filter((reason) =>
    reason.includes(IMPORT_MESSAGES.duplicateDoNotContact),
  ).length;
  const encoding = encodingNotice(analysis.sheet.encoding);
  const lines = analysis.rows.length;

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
                Revisar importação
              </DialogTitle>
              <DialogDescription>
                {/* Um nome longo sem espaços quebra em qualquer ponto, sem alargar o diálogo no celular. */}
                <span className="[overflow-wrap:anywhere]">“{analysis.sheet.fileName}”</span>:{' '}
                {plural(lines, 'linha', 'linhas')}.{' '}
                {plural(plan.ready.length, 'pronta para importar', 'prontas para importar')},{' '}
                {plural(plan.duplicates.length, 'repetida', 'repetidas')} e {formatCount(plan.errors.length)} com erro.
                {encoding && ` ${encoding}`}
              </DialogDescription>
            </DialogHeader>
            {alert && (
              <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
                {alert}
              </p>
            )}
            {reloading ? (
              <p role="status" className="text-sm text-muted-foreground">
                Conferindo contatos, empresas e equipe…
              </p>
            ) : (
              <>
                <ImportSummary analysis={analysis} plan={plan} />
                <div className="space-y-4">
                  {plan.needsOwnerChoice && (
                    <OwnerChoiceFields
                      members={analysis.members}
                      mode={ownerMode}
                      otherOwnerId={otherOwnerId}
                      distributeIds={distributeIds}
                      distribution={plan.distribution}
                      onModeChange={setOwnerMode}
                      onOtherOwnerChange={setOtherOwnerId}
                      onDistributeChange={setDistributeIds}
                    />
                  )}
                  {/* A lista de origens do item 1.14, com "Outra" para um texto livre, como em "Editar cadastro". */}
                  <LeadSourceField
                    id={sourceId}
                    label="Origem dos contatos sem origem na planilha (opcional)"
                    value={defaultSource}
                    maxLength={CONTACT_IMPORT_LIMITS.source}
                    onChange={setDefaultSource}
                  />
                  {plan.phoneDuplicateCount > 0 && (
                    <div className="eia-touch-row flex items-center gap-2">
                      <Checkbox
                        id={phoneOptionId}
                        checked={includePhoneDuplicates}
                        onCheckedChange={(checked) => setIncludePhoneDuplicates(checked === true)}
                      />
                      <Label htmlFor={phoneOptionId} className="flex-1 py-2 font-normal leading-snug">
                        Importar também as linhas com telefone repetido ({formatCount(plan.phoneDuplicateCount)})
                      </Label>
                    </div>
                  )}
                </div>
                <ImportIssues plan={plan} members={analysis.members} />
              </>
            )}
            {closeWarning}
            <DialogFooter className="gap-2">
              {issueCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className={FOOTER_BUTTON}
                  disabled={reloading}
                  onClick={() => downloadIssues(plan, null)}
                >
                  Baixar contatos não importados
                </Button>
              )}
              <Button type="button" variant="ghost" className={FOOTER_BUTTON} onClick={close}>
                {closeLabel('Cancelar')}
              </Button>
              <Button
                type="button"
                className={FOOTER_BUTTON}
                disabled={!!plan.blocked || reloading}
                aria-describedby={plan.blocked ? blockedId : undefined}
                onClick={confirm}
              >
                {importButtonLabel(plan.ready.length, resuming)}
              </Button>
            </DialogFooter>
            {plan.blocked && !reloading && (
              <p id={blockedId} className="text-right text-xs text-muted-foreground">
                {plan.blocked}
              </p>
            )}
          </>
        )}
        {phase === 'writing' && (
          <>
            <DialogHeader>
              <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
                Importando contatos
              </DialogTitle>
              <DialogDescription>
                Mantenha esta janela aberta. A gravação acontece em partes de até 500 contatos.
              </DialogDescription>
            </DialogHeader>
            <ImportProgress written={writtenCount} total={total} creatingCompanies={creating} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className={FOOTER_BUTTON}
                disabled={writer.state.stopRequested}
                onClick={writer.stop}
              >
                {writer.state.stopRequested ? 'Parando…' : 'Parar'}
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
                {outcome.kind === 'done'
                  ? resultSummary(progress.written.size, progress.companies.size, resultIssues)
                  : `${formatCount(progress.written.size)} de ${plural(total, 'contato gravado', 'contatos gravados')}.`}
              </DialogDescription>
            </DialogHeader>
            {lateDoNotContact > 0 && (
              <p role="status" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                {lateDoNotContact === 1
                  ? '1 linha repetida pede “Não contatar”, e o contato no CRM não tem a marca: marque na ficha dele (a linha está em “Baixar contatos não importados”).'
                  : `${formatCount(lateDoNotContact)} linhas repetidas pedem “Não contatar”, e os contatos no CRM não têm a marca: marque na ficha de cada um (as linhas estão em “Baixar contatos não importados”).`}
              </p>
            )}
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
            {closeWarning}
            <DialogFooter className="gap-2">
              {resultIssues.length > 0 && frozen && (
                <Button
                  type="button"
                  variant={refusedForGood ? 'default' : 'outline'}
                  className={FOOTER_BUTTON}
                  onClick={() => downloadIssues(frozen, progress.written)}
                >
                  Baixar contatos não importados
                </Button>
              )}
              {outcome.kind === 'done' ? (
                <Button asChild variant="outline" className={FOOTER_BUTTON}>
                  <Link to="/contacts?sort=updated" onClick={onClose}>
                    Abrir Contatos
                  </Link>
                </Button>
              ) : null}
              <Button type="button" variant="ghost" className={FOOTER_BUTTON} onClick={close}>
                {closeLabel('Fechar')}
              </Button>
              {outcome.kind !== 'done' && frozen && !refusedForGood && (
                <Button type="button" className={FOOTER_BUTTON} onClick={() => void write(frozen)}>
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

/** A entrada do histórico que o diálogo acrescenta durante a gravação. */
const isGuardState = (state: unknown) =>
  typeof state === 'object' &&
  state !== null &&
  (state as { contactImportGuard?: unknown }).contactImportGuard === true;

/**
 * "2.441 contatos importados. 12 empresas criadas. 30 repetidas e 9 com erro ficaram de fora." As contagens saem das
 * mesmas linhas da planilha de não importados: a linha recusada pelo e-mail no meio e reanalisada depois de outra
 * recusa conta uma vez (achados 2 e 4 da revisão do 1.11).
 */
function resultSummary(written: number, companies: number, issues: readonly ContactImportIssue[]) {
  const parts = [`${contactsLabel(written)} ${written === 1 ? 'importado' : 'importados'}.`];
  if (companies) parts.push(`${plural(companies, 'empresa criada', 'empresas criadas')}.`);
  const duplicates = issues.filter((issue) => issue.result === 'Repetida').length;
  const errors = issues.filter((issue) => issue.result === 'Com erro').length;
  if (duplicates || errors)
    parts.push(
      `${plural(duplicates, 'repetida', 'repetidas')} e ${formatCount(errors)} com erro ${duplicates + errors === 1 ? 'ficou' : 'ficaram'} de fora.`,
    );
  return parts.join(' ');
}
