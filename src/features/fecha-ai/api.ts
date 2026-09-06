import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { CrmActorChoiceSchema } from '../../../supabase/functions/_shared/crm-contract';
import { FechaActorOptionsSchema, FechaConnectionListSchema, FechaConnectionResultSchema, FechaConnectionSummarySchema } from '../../../supabase/functions/_shared/fecha-connection-management';

export const FechaConnectionSchema = FechaConnectionSummarySchema;
export type FechaConnection = z.infer<typeof FechaConnectionSchema>;
export type FechaActor = z.infer<typeof CrmActorChoiceSchema>;
export interface FechaAdminScope { organizationId: string; userId: string }
export interface FechaAdminContext { scope: FechaAdminScope; signal: AbortSignal; isCurrent: () => boolean }
export interface CreateFechaConnection { name: string; sourceOrganizationId: string; allowedActorIds: string[]; expiresAt: string }
const ListSchema = FechaConnectionListSchema;
const ChangedSchema = FechaConnectionResultSchema;
const CreatedSchema = ChangedSchema.extend({ token: z.string().regex(/^fecrm_[a-f0-9]{64}$/) });
const ActorsSchema = FechaActorOptionsSchema;

function guard(context: FechaAdminContext) {
  if (context.signal.aborted || !context.isCurrent()) throw new DOMException('O contexto mudou.', 'AbortError');
  if (!context.scope.organizationId || !context.scope.userId) throw new Error('Entre na organização antes de configurar uma conexão.');
}
async function authenticated(context: FechaAdminContext) {
  guard(context);
  const { data, error } = await supabase.auth.getSession();
  guard(context);
  if (error || data.session?.user.id !== context.scope.userId || !data.session.access_token) throw new Error('Sua sessão mudou. Entre novamente antes de continuar.');
  return data.session;
}
async function invoke<T>(context: FechaAdminContext, body: object, schema: z.ZodType<T>): Promise<T> {
  const session = await authenticated(context);
  const { data, error } = await supabase.functions.invoke('manage-fecha-ai-connections', { body: { ...body, organizationId: context.scope.organizationId }, headers: { Authorization: `Bearer ${session.access_token}` }, signal: context.signal, timeout: 30_000 });
  await authenticated(context);
  if (error) {
    const response = 'context' in error && error.context instanceof Response ? error.context : null;
    const failure: { error?: unknown } | null = response ? await response.clone().json().catch(() => null) : null;
    guard(context);
    throw new Error(typeof failure?.error === 'string' ? failure.error : 'Não foi possível concluir a configuração. Atualize as conexões para consultar o resultado.');
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error('A resposta não pôde ser validada. Atualize as conexões antes de continuar.');
  const scoped = parsed.data as { organizationId?: string; connection?: FechaConnection; connections?: FechaConnection[]; actors?: FechaActor[] };
  if ([scoped.organizationId, scoped.connection?.destinationOrganizationId, ...(scoped.connections ?? []).map((connection) => connection.destinationOrganizationId), ...(scoped.actors ?? []).map((actor) => actor.organizationId)].some((organizationId) => organizationId && organizationId !== context.scope.organizationId)) throw new Error('A resposta pertence a outra organização. Recarregue antes de continuar.');
  guard(context);
  return parsed.data;
}
export const fechaConnectionsApi = {
  list: (context: FechaAdminContext) => invoke(context, { operation: 'list' }, ListSchema),
  actors: (context: FechaAdminContext) => invoke(context, { operation: 'actor_options' }, ActorsSchema),
  create: (context: FechaAdminContext, input: CreateFechaConnection) => invoke(context, { operation: 'create', ...input }, CreatedSchema),
  revoke: (context: FechaAdminContext, connectionId: string) => invoke(context, { operation: 'revoke', connectionId }, ChangedSchema),
  setActors: (context: FechaAdminContext, connectionId: string, allowedActorIds: string[]) => invoke(context, { operation: 'set_actors', connectionId, allowedActorIds }, ChangedSchema),
};
export function fechaAdminError(error: unknown) { return error instanceof Error ? error.message : 'Não foi possível concluir a configuração da conexão.'; }
export function isFechaAdminAbort(error: unknown) { return error instanceof Error && error.name === 'AbortError'; }
