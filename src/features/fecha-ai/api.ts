import { z } from 'zod';
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { CrmActorChoiceSchema } from '../../../supabase/functions/_shared/crm-contract';
import {
  FechaActorOptionsSchema,
  FechaConnectionListSchema,
  FechaConnectionResultSchema,
  FechaConnectionSummarySchema,
} from '../../../supabase/functions/_shared/fecha-connection-management';

export const FechaConnectionSchema = FechaConnectionSummarySchema;
export type FechaConnection = z.infer<typeof FechaConnectionSchema>;
export type FechaActor = z.infer<typeof CrmActorChoiceSchema>;
export interface FechaAdminScope {
  organizationId: string;
  userId: string;
}
export interface FechaAdminContext {
  scope: FechaAdminScope;
  signal: AbortSignal;
  isCurrent: () => boolean;
}
export interface CreateFechaConnection {
  name: string;
  sourceOrganizationId: string;
  allowedActorIds: string[];
  expiresAt: string;
}
const ListSchema = FechaConnectionListSchema;
const ChangedSchema = FechaConnectionResultSchema;
const CreatedSchema = ChangedSchema.extend({ token: z.string().regex(/^fecrm_[a-f0-9]{64}$/) });
const ActorsSchema = FechaActorOptionsSchema;

/**
 * Erro da configuração da conexão, com o texto para a tela. `unavailable`: a função de gerenciamento não está publicada
 * neste CRM (o gateway do Supabase responde 404 sem o código do receptor), o caso de uma empresa que não usa a Fecha IA.
 */
export class FechaAdminError extends Error {
  constructor(
    message: string,
    readonly unavailable = false,
  ) {
    super(message);
    this.name = 'FechaAdminError';
  }
}
export const FECHA_NOT_PUBLISHED =
  'A integração com a Fecha IA não está publicada neste CRM. Se a sua empresa usa a Fecha IA, quem implanta o CRM publica as duas funções do receptor; depois, use “Atualizar conexões”.';
const UNREACHABLE =
  'Não foi possível falar com a Fecha IA neste CRM. Confira a conexão e tente de novo; se continuar, quem implanta o CRM confere se as funções do receptor estão publicadas e se o endereço deste CRM está em CRM_ALLOWED_ORIGINS.';
const UNCERTAIN = 'Não foi possível concluir a configuração. Atualize as conexões para consultar o resultado.';
/** O código do receptor (supabase/functions/_shared/fecha-receiver-http.ts) em português, para quem configura. */
const CODE_MESSAGES: Readonly<Record<string, string>> = {
  authentication_required: 'Sua sessão expirou. Entre novamente antes de continuar.',
  forbidden:
    'Só donos e administradores ativos configuram a conexão, e cada identidade autorizada precisa estar ativa e poder editar (dono, administrador ou colaborador). Atualize as conexões e confira as identidades.',
  scope_mismatch: 'A organização desta tela mudou. Recarregue a página antes de continuar.',
  invalid_request: 'O pedido não pôde ser conferido. Recarregue a página e tente de novo.',
  invalid_actors: 'Escolha de 1 a 500 identidades autorizadas, sem repetir.',
  invalid_expiry: 'A validade precisa ficar entre 1 hora e 90 dias a partir de agora.',
  connection_not_found: 'Esta conexão não existe mais. Atualize as conexões.',
  connection_inactive: 'Esta conexão venceu ou foi revogada e não muda mais. Gere outra conexão.',
  receiver_unconfigured:
    'As funções da Fecha IA estão publicadas sem as chaves do projeto Supabase. Quem implanta o CRM confere os secrets das funções.',
  receiver_unavailable:
    'O banco do CRM não respondeu à configuração da Fecha IA. Confira se a migração do receptor foi aplicada e tente de novo.',
};

/** A falha da chamada à função, como a tela mostra (o texto do código conhecido, nunca a resposta crua). */
async function failureOf(error: unknown): Promise<FechaAdminError> {
  if (error instanceof FunctionsFetchError) return new FechaAdminError(UNREACHABLE);
  const response =
    (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) && error.context instanceof Response
      ? error.context
      : null;
  const body: { code?: unknown } | null = response
    ? await response
        .clone()
        .json()
        .catch(() => null)
    : null;
  const code = typeof body?.code === 'string' ? body.code : '';
  if (code && Object.prototype.hasOwnProperty.call(CODE_MESSAGES, code))
    return new FechaAdminError(CODE_MESSAGES[code]);
  // Sem o código do receptor, um 404 é do gateway: a função não foi publicada.
  if (response?.status === 404) return new FechaAdminError(FECHA_NOT_PUBLISHED, true);
  return new FechaAdminError(UNCERTAIN);
}

function guard(context: FechaAdminContext) {
  if (context.signal.aborted || !context.isCurrent()) throw new DOMException('O contexto mudou.', 'AbortError');
  if (!context.scope.organizationId || !context.scope.userId)
    throw new Error('Entre na organização antes de configurar uma conexão.');
}
async function authenticated(context: FechaAdminContext) {
  guard(context);
  const { data, error } = await supabase.auth.getSession();
  guard(context);
  if (error || data.session?.user.id !== context.scope.userId || !data.session.access_token)
    throw new Error('Sua sessão mudou. Entre novamente antes de continuar.');
  return data.session;
}
async function invoke<T>(context: FechaAdminContext, body: object, schema: z.ZodType<T>): Promise<T> {
  const session = await authenticated(context);
  const { data, error } = await supabase.functions.invoke('manage-fecha-ai-connections', {
    body: { ...body, organizationId: context.scope.organizationId },
    headers: { Authorization: `Bearer ${session.access_token}` },
    signal: context.signal,
    timeout: 30_000,
  });
  await authenticated(context);
  if (error) {
    const failure = await failureOf(error);
    guard(context);
    throw failure;
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error('A resposta não pôde ser validada. Atualize as conexões antes de continuar.');
  const scoped = parsed.data as {
    organizationId?: string;
    connection?: FechaConnection;
    connections?: FechaConnection[];
    actors?: FechaActor[];
  };
  if (
    [
      scoped.organizationId,
      scoped.connection?.destinationOrganizationId,
      ...(scoped.connections ?? []).map((connection) => connection.destinationOrganizationId),
      ...(scoped.actors ?? []).map((actor) => actor.organizationId),
    ].some((organizationId) => organizationId && organizationId !== context.scope.organizationId)
  )
    throw new Error('A resposta pertence a outra organização. Recarregue antes de continuar.');
  guard(context);
  return parsed.data;
}
export const fechaConnectionsApi = {
  list: (context: FechaAdminContext) => invoke(context, { operation: 'list' }, ListSchema),
  actors: (context: FechaAdminContext) => invoke(context, { operation: 'actor_options' }, ActorsSchema),
  create: (context: FechaAdminContext, input: CreateFechaConnection) =>
    invoke(context, { operation: 'create', ...input }, CreatedSchema),
  revoke: (context: FechaAdminContext, connectionId: string) =>
    invoke(context, { operation: 'revoke', connectionId }, ChangedSchema),
  setActors: (context: FechaAdminContext, connectionId: string, allowedActorIds: string[]) =>
    invoke(context, { operation: 'set_actors', connectionId, allowedActorIds }, ChangedSchema),
};
export function fechaAdminError(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a configuração da conexão.';
}
/** A função de gerenciamento não está publicada neste CRM (FECHA_NOT_PUBLISHED). */
export function isFechaUnavailable(error: unknown) {
  return error instanceof FechaAdminError && error.unavailable;
}
export function isFechaAdminAbort(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}
