import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  emailKey,
  IMPORT_MESSAGES,
  inBatches,
  type CompanyPayload,
  type ContactImportPlan,
  type ContactPayload,
  type ExistingImportContact,
} from '@/lib/contact-import';
import { relationshipError } from '@/lib/contact-model';
import { invalidateCrmTables } from '@/lib/crm-cache';
import { isOfflineRequestError } from '@/lib/offline';
import {
  CHANNELS_MIGRATION_MISSING,
  channelsMigrationMissing,
  PRIVACY_MIGRATION_MISSING,
  privacyMigrationMissing,
} from '@/lib/rpc-errors';
import { loadExistingContacts, writeCompanyBatch, writeContactBatch } from './data';

/**
 * Gravação da importação em lotes (item 1.11; docs/arquitetura/1.11.md, seções 4.4 e 6.3): primeiro as empresas novas,
 * depois os contatos, até 500 por pedido e um pedido por vez, com o plano congelado ao confirmar (os mesmos ids do
 * começo ao fim). "Parar" termina o lote em andamento; "Continuar importação" reenvia só o que falta, e um id que não
 * volta na resposta já estava gravado (uma resposta perdida não duplica nada).
 *
 * Corridas: um e-mail cadastrado no meio por outra pessoa ou outra aba (23505 no índice único) faz reler os contatos,
 * tira as linhas que colidem (repetidas, com "Já existe um contato com este e-mail.") e reenvia o lote uma vez; uma
 * recusa de gatilho (P0001, como o responsável desativado no meio) ou um vínculo que sumiu (23503: a empresa excluída
 * por um colega depois da prévia, ou o perfil do responsável removido) para e volta à prévia do que falta, relida.
 */

export interface ContactImportProgress {
  /** Ids dos contatos gravados, nesta e nas tentativas anteriores. */
  written: Set<string>;
  /** Ids das empresas novas já gravadas. */
  companies: Set<string>;
  /** Linhas recusadas pelo índice do e-mail durante a gravação, com o motivo. */
  late: Map<string, string>;
}

export const emptyProgress = (): ContactImportProgress => ({
  written: new Set(),
  companies: new Set(),
  late: new Map(),
});

export type ContactImportOutcome =
  { kind: 'done' } | { kind: 'stopped' } | { kind: 'failed'; message: string } | { kind: 'refused'; message: string };

export interface ContactImportWriterDeps {
  writeCompanies: (batch: readonly CompanyPayload[]) => Promise<string[]>;
  writeContacts: (batch: readonly ContactPayload[]) => Promise<string[]>;
  readExistingContacts: () => Promise<ExistingImportContact[]>;
}

export interface RunControls {
  shouldStop: () => boolean;
  /** Depois de cada lote: a fase e o progresso. */
  onProgress: (phase: 'companies' | 'contacts', progress: ContactImportProgress) => void;
}

export const ROLE_REFUSED_MESSAGE =
  'Seu papel não permite mais importar contatos. Peça a um dono ou administrador para revisar seu acesso.';

/** A recusa por um vínculo que sumiu (23503), que volta à prévia como o P0001. */
export const MISSING_LINK_MESSAGE =
  'Uma empresa ou uma pessoa da equipe citada na importação foi excluída depois da prévia.';

/**
 * Códigos de falha passageira do banco ou do PostgREST (conexão, tempo esgotado, conflito de transação, falta de
 * recursos): "Continuar importação" pode resolver. Os demais códigos são recusas que se repetiriam iguais.
 */
const TRANSIENT_CODE = /^(08|40|53|57|PGRST00[0-3]$)/;

const codeOf = (error: unknown) =>
  error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
const messageOf = (error: unknown) =>
  error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';

/** "1 contato" ou "1.500 contatos". */
export const contactsLabel = (count: number) =>
  `${count.toLocaleString('pt-BR')} ${count === 1 ? 'contato' : 'contatos'}`;

/**
 * A mensagem de uma falha que para a gravação (fora o P0001 e o 23503, que voltam à prévia). Só a falha de rede ou
 * passageira promete que "Continuar importação" resolve; uma recusa do banco com outro código diz o código e o caminho
 * da planilha de não importados (revisão do item 1.11).
 */
export function writeFailureMessage(error: unknown, written: number) {
  const code = codeOf(error);
  if (code === '42501') return ROLE_REFUSED_MESSAGE;
  if (privacyMigrationMissing(error)) return PRIVACY_MIGRATION_MISSING;
  if (channelsMigrationMissing(error)) return CHANNELS_MIGRATION_MISSING;
  if (code === '23505' || code === '23514') return relationshipError(error);
  const done = written === 1 ? '1 contato já foi gravado.' : `${contactsLabel(written)} já foram gravados.`;
  const offline = isOfflineRequestError(error);
  if (code && !offline && !TRANSIENT_CODE.test(code))
    return `O banco recusou a gravação de um lote (código ${code}). ${done} Baixe os contatos não importados, confira as linhas e importe esse arquivo. Se a recusa continuar, informe o código a quem administra o CRM.`;
  return `A gravação de um lote não foi confirmada.${offline ? ' Sem conexão com a internet.' : ''} ${done} “Continuar importação” tenta de novo os que faltam, sem duplicar.`;
}

/** As linhas prontas que ainda faltam gravar (sem as gravadas e sem as recusadas pelo e-mail no meio). */
export const pendingRows = (plan: ContactImportPlan, progress: ContactImportProgress) =>
  plan.ready.filter((row) => !progress.written.has(row.row.id) && !progress.late.has(row.row.id));

/**
 * Grava o plano congelado. Volta quando termina, para ("Parar"), falha (a tela oferece "Continuar importação") ou o
 * banco recusa com P0001 (a tela volta à prévia do que falta). O progresso é atualizado no lugar.
 */
export async function runContactImport(
  plan: ContactImportPlan,
  progress: ContactImportProgress,
  deps: ContactImportWriterDeps,
  controls: RunControls,
): Promise<ContactImportOutcome> {
  const stop = (error: unknown): ContactImportOutcome => {
    const code = codeOf(error);
    if (code === 'P0001' && messageOf(error).trim()) return { kind: 'refused', message: messageOf(error).trim() };
    if (code === '23503') return { kind: 'refused', message: MISSING_LINK_MESSAGE };
    return { kind: 'failed', message: writeFailureMessage(error, progress.written.size) };
  };
  for (const batch of inBatches(plan.companies.filter((company) => !progress.companies.has(company.id)))) {
    // "Parar" também entre os lotes de empresas (até 10 numa planilha de 5.000 linhas com empresas novas).
    if (controls.shouldStop()) return { kind: 'stopped' };
    try {
      await deps.writeCompanies(batch);
    } catch (error) {
      return stop(error);
    }
    // Os ids que não voltaram já estavam gravados (o conflito ignorado é só o do id gerado nesta importação).
    for (const company of batch) progress.companies.add(company.id);
    controls.onProgress('companies', progress);
  }
  for (const batch of inBatches(pendingRows(plan, progress))) {
    if (controls.shouldStop()) return { kind: 'stopped' };
    let retried = false;
    for (;;) {
      const payloads = batch.filter((row) => !progress.late.has(row.row.id)).map((row) => row.payload!);
      if (!payloads.length) break;
      try {
        await deps.writeContacts(payloads);
        for (const payload of payloads) progress.written.add(payload.id);
        break;
      } catch (error) {
        if (codeOf(error) !== '23505' || retried) return stop(error);
        retried = true;
        // Um e-mail cadastrado no meio: relê os contatos e tira as linhas que colidem com outro cadastro; as que já
        // estão gravadas (de uma resposta perdida) contam como gravadas.
        let existing;
        try {
          existing = await deps.readExistingContacts();
        } catch (readError) {
          return stop(readError);
        }
        const ids = new Set(existing.map((contact) => contact.id));
        const emails = new Map(existing.map((contact) => [emailKey(contact.email), contact.id]));
        for (const row of pendingRows(plan, progress)) {
          if (ids.has(row.row.id)) progress.written.add(row.row.id);
          else if (row.row.emailKey && emails.has(row.row.emailKey))
            progress.late.set(row.row.id, IMPORT_MESSAGES.existingEmail);
        }
      }
    }
    controls.onProgress('contacts', progress);
  }
  return { kind: 'done' };
}

export interface WriterState {
  running: boolean;
  phase: 'companies' | 'contacts' | null;
  /** Contatos gravados, com as tentativas anteriores. */
  written: number;
  companies: number;
  late: number;
  stopRequested: boolean;
}

/**
 * O estado da gravação para a tela. O cache é invalidado uma vez, no fim (ou ao parar), e não a cada lote, para o
 * snapshot não recarregar 10 vezes durante a importação.
 */
export function useContactImportWriter(deps?: Partial<ContactImportWriterDeps> & { orgId: string }) {
  const cache = useQueryClient();
  const progress = useRef<ContactImportProgress>(emptyProgress());
  const stopRef = useRef(false);
  const [state, setState] = useState<WriterState>({
    running: false,
    phase: null,
    written: 0,
    companies: 0,
    late: 0,
    stopRequested: false,
  });
  const orgId = deps?.orgId ?? '';
  const writeCompanies = deps?.writeCompanies ?? writeCompanyBatch;
  const writeContacts = deps?.writeContacts ?? writeContactBatch;
  const readExisting = deps?.readExistingContacts;

  const snapshot = useCallback(
    (phase: WriterState['phase'], running: boolean) =>
      setState({
        running,
        phase,
        written: progress.current.written.size,
        companies: progress.current.companies.size,
        late: progress.current.late.size,
        stopRequested: stopRef.current,
      }),
    [],
  );

  const run = useCallback(
    async (plan: ContactImportPlan): Promise<ContactImportOutcome> => {
      stopRef.current = false;
      snapshot(
        plan.companies.some((company) => !progress.current.companies.has(company.id)) ? 'companies' : 'contacts',
        true,
      );
      try {
        return await runContactImport(
          plan,
          progress.current,
          {
            writeCompanies,
            writeContacts,
            readExistingContacts: readExisting ?? (() => loadExistingContacts(orgId)),
          },
          {
            shouldStop: () => stopRef.current,
            onProgress: (phase) => snapshot(phase === 'companies' ? 'companies' : 'contacts', true),
          },
        );
      } finally {
        snapshot(null, false);
        await invalidateCrmTables(cache, ['contacts', 'companies']);
      }
    },
    [cache, orgId, readExisting, snapshot, writeCompanies, writeContacts],
  );

  const stop = useCallback(() => {
    stopRef.current = true;
    setState((current) => ({ ...current, stopRequested: true }));
  }, []);

  return { state, progress: progress.current, run, stop };
}
