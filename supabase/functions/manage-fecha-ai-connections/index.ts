import {
  FechaActorOptionsSchema,
  FechaConnectionListSchema,
  FechaConnectionManagementRequestSchema,
  FechaConnectionResultSchema,
} from "../_shared/fecha-connection-management.ts";
import {
  createFechaToken,
  hashFechaToken,
  type ReceiverDependencies,
  receiverDependencies,
  ReceiverError,
  receiverFailure,
  receiverHeaders,
  receiverJson,
  receiverRpc,
} from "../_shared/fecha-receiver-http.ts";

export async function handler(
  request: Request,
  supplied?: ReceiverDependencies,
): Promise<Response> {
  let headers = receiverHeaders();
  try {
    const deps = supplied ?? receiverDependencies();
    const origin = request.headers.get("origin");
    if (origin && !deps.allowedOrigins.includes(origin)) {
      throw new ReceiverError(403, "origin_not_allowed");
    }
    headers = receiverHeaders(origin);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      throw new ReceiverError(405, "method_not_allowed");
    }
    const jwt = /^Bearer (\S+)$/i.exec(
      request.headers.get("authorization") ?? "",
    )?.[1];
    if (!jwt) throw new ReceiverError(401, "authentication_required");
    const actorId = await deps.verifyUser(jwt);
    if (!actorId) throw new ReceiverError(401, "authentication_required");
    const parsed = FechaConnectionManagementRequestSchema.safeParse(
      await receiverJson(request, 32 * 1024),
    );
    if (!parsed.success) throw new ReceiverError(422, "invalid_request");
    const body = parsed.data;
    const token = body.operation === "create" ? createFechaToken() : null;
    const result = await receiverRpc(deps, "manage_fecha_ai_connections", {
      p_actor_id: actorId,
      p_request: body,
      p_token_hash: token ? await hashFechaToken(token) : null,
    });
    let response: unknown;
    if (body.operation === "list") {
      const list = FechaConnectionListSchema.parse(result);
      if (
        list.connections.some((connection) =>
          connection.destinationOrganizationId !== body.organizationId
        )
      ) throw new ReceiverError(502, "invalid_receiver_response");
      response = list;
    } else if (body.operation === "actor_options") {
      const options = FechaActorOptionsSchema.parse(result);
      if (options.organizationId !== body.organizationId) {
        throw new ReceiverError(502, "invalid_receiver_response");
      }
      response = options;
    } else {
      const saved = FechaConnectionResultSchema.parse(result);
      if (
        saved.connection.destinationOrganizationId !== body.organizationId ||
        (body.operation !== "create" &&
          saved.connection.id !== body.connectionId)
      ) throw new ReceiverError(502, "invalid_receiver_response");
      response = token ? { ...saved, token } : saved;
    }
    return new Response(JSON.stringify(response), {
      status: body.operation === "create" ? 201 : 200,
      headers,
    });
  } catch (error) {
    return receiverFailure(error, headers);
  }
}
if (import.meta.main) Deno.serve((request) => handler(request));
