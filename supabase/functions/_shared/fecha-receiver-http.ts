import { createClient } from "npm:@supabase/supabase-js@2.95.3";

export class ReceiverError extends Error {
  constructor(
    public status: number,
    public code: string,
    message = "Não foi possível concluir esta operação.",
  ) {
    super(message);
  }
}
export interface ReceiverDependencies {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<
    { data: unknown; error: { message: string; code?: string } | null }
  >;
  verifyUser(jwt: string): Promise<string | null>;
  allowedOrigins: string[];
}
/** Exact CRM origins allowed to call the management function (no wildcard). */
export function allowedOriginsFromEnv(): string[] {
  return (Deno.env.get("CRM_ALLOWED_ORIGINS") ?? "").split(",").map((
    origin,
  ) => origin.trim()).filter(Boolean);
}
export function receiverDependencies(): ReceiverDependencies {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new ReceiverError(503, "receiver_unconfigured");
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    rpc: async (name, args) => await admin.rpc(name, args),
    verifyUser: async (jwt) => {
      const { data, error } = await admin.auth.getUser(jwt);
      return error ? null : data.user?.id ?? null;
    },
    allowedOrigins: allowedOriginsFromEnv(),
  };
}
export function receiverHeaders(origin: string | null = null) {
  const headers = new Headers({
    "content-type": "application/json;charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "vary": "Origin",
  });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set(
      "access-control-allow-headers",
      "authorization,apikey,content-type,x-client-info",
    );
    headers.set("access-control-allow-methods", "POST,OPTIONS");
  }
  return headers;
}
export async function receiverJson(
  request: Request,
  maxBytes = 70 * 1024,
): Promise<unknown> {
  if (
    !request.headers.get("content-type")?.toLowerCase().startsWith(
      "application/json",
    )
  ) throw new ReceiverError(415, "json_required");
  if (Number(request.headers.get("content-length") ?? "0") > maxBytes) {
    throw new ReceiverError(413, "payload_too_large");
  }
  if (!request.body) throw new ReceiverError(400, "invalid_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ReceiverError(413, "payload_too_large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(merged));
  } catch {
    throw new ReceiverError(400, "invalid_json");
  }
}
export async function hashFechaToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function createFechaToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `fecrm_${
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  }`;
}
export function tokenFromRequest(request: Request): string {
  const match = /^Bearer (fecrm_[a-f0-9]{64})$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match || !/^fecrm_[a-f0-9]{64}$/.test(match[1])) {
    throw new ReceiverError(401, "invalid_connection_token");
  }
  return match[1];
}
const statuses: Record<string, number> = {
  invalid_connection_token: 401,
  forbidden: 403,
  scope_mismatch: 403,
  actor_not_allowed: 403,
  connection_has_no_actors: 403,
  connection_not_found: 404,
  target_not_found: 404,
  target_anonymized: 409,
  receipt_not_found: 404,
  idempotency_conflict: 409,
  previous_delivery_requires_append: 409,
  previous_receipt_conflict: 409,
  stale_review: 409,
  target_change_requires_resolution: 409,
  target_relationship_conflict: 409,
  previous_task_missing: 409,
  connection_inactive: 409,
  invalid_actors: 422,
  invalid_expiry: 422,
  invalid_token_hash: 422,
  invalid_payload: 422,
  invalid_payload_hash: 422,
  invalid_idempotency_key: 422,
  target_required: 422,
  invalid_previous_receipt: 422,
  invalid_next_step: 422,
  invalid_lookup: 422,
  invalid_operation: 400,
  invalid_rendered_note: 422,
  // Reads (B20): the read off on this connection, the limit of reads per connection and a malformed read.
  read_not_allowed: 403,
  read_rate_limited: 429,
  invalid_read: 422,
  invalid_read_scopes: 422,
};
export async function receiverRpc(
  deps: ReceiverDependencies,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await deps.rpc(name, args);
  if (result.error) {
    const code = result.error.message;
    if (Object.hasOwn(statuses, code)) {
      throw new ReceiverError(statuses[code], code);
    }
    if (
      result.error.code === "22P02" || result.error.code === "22007" ||
      result.error.code === "23514"
    ) throw new ReceiverError(422, "invalid_payload");
    // A business rule of the CRM refused the write (RAISE EXCEPTION, P0001): a trigger of the base, such as the
    // anonymized contact or the deactivated assignee, or a company rule in a private.custom_* hook. Retrying the same
    // request cannot succeed; the message stays in the CRM.
    if (result.error.code === "P0001") {
      throw new ReceiverError(409, "destination_rule_rejected");
    }
    throw new ReceiverError(503, "receiver_unavailable");
  }
  if (result.data === null) {
    throw new ReceiverError(503, "receiver_unavailable");
  }
  return result.data;
}
export function receiverFailure(error: unknown, headers: Headers): Response {
  const fault = error instanceof ReceiverError
    ? error
    : new ReceiverError(500, "receiver_error");
  return new Response(
    JSON.stringify({ error: fault.message, code: fault.code }),
    { status: fault.status, headers },
  );
}
