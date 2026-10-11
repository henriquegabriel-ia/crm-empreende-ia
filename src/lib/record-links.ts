// Vínculos que impedem ou acompanham uma exclusão, descritos em português para o diálogo de confirmação
// e para a explicação do bloqueio (item 0.7 do roteiro).

/** "1 atividade", "2 atividades". */
export function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "a", "a e b", "a, b e c". */
export function joinPt(items: string[]) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/** Junta só as contagens maiores que zero: [[2, 'atividade', 'atividades'], [0, ...]] → "2 atividades". */
export function linkSummary(entries: [count: number, singular: string, plural: string][]) {
  return joinPt(
    entries.filter(([count]) => count > 0).map(([count, singular, plural]) => countLabel(count, singular, plural)),
  );
}

export interface DealLinkCounts {
  activities: number;
  payments: number;
  automation_logs: number;
}

export function dealLinkTotal(counts: DealLinkCounts) {
  return counts.activities + counts.payments + counts.automation_logs;
}

/** "3 atividades, 1 recebimento e 5 registros de automação", na mesma ordem da mensagem de delete_deal. */
export function dealLinkSummary(counts: DealLinkCounts) {
  return linkSummary([
    [counts.activities, 'atividade', 'atividades'],
    [counts.payments, 'recebimento', 'recebimentos'],
    [counts.automation_logs, 'registro de automação', 'registros de automação'],
  ]);
}

/**
 * Contagens de delete_deal: o objeto que a RPC devolve depois de excluir, ou o texto JSON de `details` quando
 * ela recusa a exclusão sem confirmação. Devolve null para qualquer outro formato.
 */
export function readDealLinkCounts(value: unknown): DealLinkCounts | null {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = ['activities', 'payments', 'automation_logs'] as const;
  if (!keys.every((key) => Number.isInteger(record[key]) && Number(record[key]) >= 0)) return null;
  return {
    activities: Number(record.activities),
    payments: Number(record.payments),
    automation_logs: Number(record.automation_logs),
  };
}

const LINKED_TABLE_LABELS: Record<string, string> = {
  activities: 'atividades',
  automation_logs: 'registros de automação',
  automations: 'automações',
  companies: 'empresas',
  contacts: 'contatos',
  deals: 'oportunidades',
  deal_stage_history: 'movimentações de etapa',
  payments: 'recebimentos',
  pipeline_stages: 'etapas',
};

/**
 * Tabela que ainda referencia o registro numa falha 23503 de exclusão, em português ("recebimentos").
 * O PostgreSQL informa em `details` ("... is still referenced from table "payments".") e no fim de `message`
 * ("... violates foreign key constraint "..." on table "payments""). Devolve null quando não há essa informação.
 */
export function blockingTableLabel(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const { code, details, message } = error as { code?: unknown; details?: unknown; message?: unknown };
  if (String(code ?? '') !== '23503') return null;
  const fromDetails =
    typeof details === 'string' ? /still referenced from table "([^"]+)"/.exec(details)?.[1] : undefined;
  const fromMessage =
    typeof message === 'string' && /^update or delete on table/.test(message)
      ? /on table "([^"]+)"$/.exec(message)?.[1]
      : undefined;
  const table = fromDetails ?? fromMessage;
  return table ? (LINKED_TABLE_LABELS[table] ?? null) : null;
}
