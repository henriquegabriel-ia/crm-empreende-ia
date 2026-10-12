import { useQuery } from '@tanstack/react-query';
import { crmDb } from '@/integrations/supabase/crm-client';
import type { CrmRow } from '@/integrations/supabase/commercial-types';
import { useOrg } from '@/hooks/useOrg';
import { useAuth } from '@/contexts/AuthContext';
import type { RelationshipData } from '@/lib/contact-model';
import { TEAM_DATA_REFRESH } from '@/lib/team-data';
export interface CrmSnapshot extends RelationshipData {
  activities: CrmRow<'activities'>[];
  riskRules: CrmRow<'risk_rules'>[];
  pipelines: CrmRow<'pipelines'>[];
  stages: CrmRow<'pipeline_stages'>[];
}
/**
 * Linhas por página: o limite padrão de linhas por resposta do Supabase (API > Max rows = 1000). Páginas maiores fazem
 * menos idas e voltas ao servidor; uma instância com limite menor continua lida inteira (o passo vira o que o servidor
 * entregar).
 */
const PAGE_SIZE = 1000;
/** Páginas de uma mesma tabela buscadas ao mesmo tempo, depois da primeira. */
const PAGE_CONCURRENCY = 4;
export type CrmPageRequest = (
  from: number,
  to: number,
  /** Verdadeiro só na primeira página: pede o total (count exato) junto com as linhas. */
  withCount: boolean,
) => PromiseLike<{ data: unknown[] | null; error: unknown; count?: number | null }>;
export class IncompleteReadError extends Error {
  constructor() {
    super('Os dados mudaram durante a leitura e a lista veio incompleta. Tente novamente.');
    this.name = 'IncompleteReadError';
  }
}
async function inPool<I, O>(items: readonly I[], limit: number, run: (item: I) => Promise<O>): Promise<O[]> {
  const results = new Array<O>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const position = next++;
        results[position] = await run(items[position]);
      }
    }),
  );
  return results;
}
async function readPagesOnce<T extends { id: string }>(request: CrmPageRequest, pageSize: number, concurrency: number) {
  const page = async (from: number, size: number, withCount = false) => {
    const result = await request(from, from + size - 1, withCount);
    if (result.error) throw result.error;
    return { rows: (result.data ?? []) as T[], count: result.count };
  };
  const first = await page(0, pageSize, true);
  const total = typeof first.count === 'number' ? first.count : null;
  // Primeira página vazia: a lista está vazia, ou incompleta se o total diz que há linhas.
  if (!first.rows.length) return { rows: [] as T[], complete: !total };
  // Uma primeira página menor que a pedida pode ser o limite de linhas do servidor, e não o fim: o tamanho entregue
  // vira o passo. Com o total, só se ainda faltarem linhas; sem ele, a leitura segue até uma página menor que o passo.
  const step =
    first.rows.length < pageSize && (total === null || total > first.rows.length) ? first.rows.length : pageSize;
  // Cada página seguinte começa na última linha da anterior (sobreposição de 1), para conferir a continuidade abaixo.
  const overlap = step > 1 ? 1 : 0;
  const advance = step - overlap;
  const offsets: number[] = [];
  if (total !== null) for (let read = first.rows.length; read < total; read += advance) offsets.push(read - overlap);
  const pages = [first.rows, ...(await inPool(offsets, concurrency, async (from) => (await page(from, step)).rows))];
  // Sem total (servidor sem contagem) ou com linhas criadas durante a leitura, a última página cheia pede a próxima.
  let from = (offsets.length ? offsets[offsets.length - 1] : 0) + advance;
  while (pages[pages.length - 1].length === step) {
    pages.push((await page(from, step)).rows);
    from += advance;
  }
  // Uma linha criada durante a leitura empurra as seguintes para a próxima página: fica a primeira ocorrência.
  const seen = new Set<string>();
  const rows: T[] = [];
  let continuous = true;
  for (const [index, current] of pages.entries()) {
    // Cada página depois da primeira tem de começar numa linha já lida. Se não começa (ou veio vazia), a ordem mudou
    // entre as leituras: com páginas lidas fora de ordem, uma linha criada na faixa de uma página empurra a última
    // dela para a seguinte, já lida, e ela sumiria sem que a contagem percebesse (a linha nova compensa a perdida).
    if (index > 0 && overlap && !(current.length && seen.has(current[0].id))) continuous = false;
    for (const row of current)
      if (!seen.has(row.id)) {
        seen.add(row.id);
        rows.push(row);
      }
  }
  // Menos linhas que o total contado: uma exclusão durante a leitura deslocou as páginas e alguma linha ficou de fora.
  return { rows, complete: continuous && (total === null || rows.length >= total) };
}
/**
 * Lê todas as páginas de uma tabela, sem tratar o limite de linhas do servidor como lista completa (item 0.10 do
 * roteiro). A primeira página (PAGE_SIZE linhas) traz o total (count exato); as demais são buscadas em paralelo, até
 * PAGE_CONCURRENCY por tabela, e juntadas na ordem das páginas, sem repetições por id. Cada página depois da primeira
 * começa na última linha da anterior: se essa linha não estiver lá (as páginas foram lidas fora de ordem e os dados
 * mudaram entre elas), ou se a leitura vier com menos linhas que o total (registros excluídos durante a leitura), ela é
 * refeita uma vez; se falhar de novo, lança IncompleteReadError em vez de mostrar uma lista cortada em silêncio. Sem
 * contagem do servidor, segue página a página até uma menor que o passo.
 */
export async function readCrmPages<T extends { id: string }>(
  request: CrmPageRequest,
  { pageSize = PAGE_SIZE, concurrency = PAGE_CONCURRENCY } = {},
): Promise<T[]> {
  for (let attempt = 1; ; attempt++) {
    const { rows, complete } = await readPagesOnce<T>(request, pageSize, concurrency);
    if (complete) return rows;
    if (attempt >= 2) throw new IncompleteReadError();
  }
}
const exactCount = (withCount: boolean) => (withCount ? ({ count: 'exact' } as const) : undefined);
export function useCrmSnapshot() {
  const { orgId } = useOrg();
  const { user, loading } = useAuth();
  return useQuery<CrmSnapshot>({
    queryKey: ['crm', orgId, 'snapshot', user?.id],
    enabled: !!orgId && !!user && !loading,
    queryFn: async () => {
      if (!orgId) throw new Error('Organização indisponível.');
      const [contacts, companies, deals, activities, members, riskRules, pipelines, stages] = await Promise.all([
        readCrmPages<CrmSnapshot['contacts'][number]>((from, to, count) =>
          crmDb.from('contacts').select('*', exactCount(count)).eq('org_id', orgId).order('id').range(from, to),
        ),
        readCrmPages<CrmSnapshot['companies'][number]>((from, to, count) =>
          crmDb.from('companies').select('*', exactCount(count)).eq('org_id', orgId).order('id').range(from, to),
        ),
        readCrmPages<CrmSnapshot['deals'][number]>((from, to, count) =>
          crmDb.from('deals').select('*', exactCount(count)).eq('org_id', orgId).order('id').range(from, to),
        ),
        readCrmPages<CrmSnapshot['activities'][number]>((from, to, count) =>
          crmDb.from('activities').select('*', exactCount(count)).eq('org_id', orgId).order('id').range(from, to),
        ),
        readCrmPages<CrmSnapshot['members'][number]>((from, to, count) =>
          crmDb
            .from('profiles')
            .select('id,name,email', exactCount(count))
            .eq('org_id', orgId)
            .order('id')
            .range(from, to),
        ),
        readCrmPages<CrmSnapshot['riskRules'][number]>((from, to, count) =>
          crmDb.from('risk_rules').select('*', exactCount(count)).eq('org_id', orgId).order('id').range(from, to),
        ),
        readCrmPages<CrmSnapshot['pipelines'][number]>((from, to, count) =>
          crmDb.from('pipelines').select('*', exactCount(count)).eq('org_id', orgId).order('id').range(from, to),
        ),
        readCrmPages<CrmSnapshot['stages'][number]>((from, to, count) =>
          crmDb.from('pipeline_stages').select('*', exactCount(count)).eq('org_id', orgId).order('id').range(from, to),
        ),
      ]);
      return { contacts, companies, deals, activities, members, riskRules, pipelines, stages };
    },
    ...TEAM_DATA_REFRESH,
  });
}
