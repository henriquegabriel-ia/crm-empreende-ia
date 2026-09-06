import {
  assertCrmReceiptMatchesEnvelope,
  assertCrmValidationMatchesEnvelope,
  CrmDeliveryReceiptSchema,
  CrmDescribeResponseSchema,
  CrmIntegrationRequestSchema,
  CrmLookupResponseSchema,
  parseCrmReviewEnvelope,
  renderCrmReviewNote,
} from "../_shared/crm-contract.ts";
import {
  hashFechaToken,
  type ReceiverDependencies,
  receiverDependencies,
  ReceiverError,
  receiverFailure,
  receiverHeaders,
  receiverJson,
  receiverRpc,
  tokenFromRequest,
} from "../_shared/fecha-receiver-http.ts";

export async function handler(
  request: Request,
  supplied?: ReceiverDependencies,
): Promise<Response> {
  const headers = receiverHeaders();
  try {
    // This credential is server-only. The receiver does not expose CORS to a browser.
    if (request.headers.has("origin")) {
      throw new ReceiverError(403, "server_transport_required");
    }
    if (request.method !== "POST") {
      throw new ReceiverError(405, "method_not_allowed");
    }
    const token = tokenFromRequest(request);
    const parsed = CrmIntegrationRequestSchema.safeParse(
      await receiverJson(request),
    );
    if (!parsed.success) throw new ReceiverError(422, "invalid_request");
    const body = parsed.data;
    const deps = supplied ?? receiverDependencies();
    const args: Record<string, unknown> = {
      p_token_hash: await hashFechaToken(token),
      p_request: body,
    };
    if (body.operation === "validate" || body.operation === "deliver") {
      try {
        body.envelope = await parseCrmReviewEnvelope(body.envelope);
      } catch {
        throw new ReceiverError(422, "invalid_payload_hash");
      }
      const note = renderCrmReviewNote(body.envelope);
      if (body.operation === "deliver") {
        args.p_note_title = note.title;
        args.p_note_body = note.body;
      }
    }
    const result = await receiverRpc(deps, "fecha_ai_integration", args);
    let response: unknown;
    if (body.operation === "describe") {
      const described = CrmDescribeResponseSchema.parse(result);
      if (described.connectionId !== body.connectionId) {
        throw new ReceiverError(502, "invalid_receiver_response");
      }
      response = described;
    } else if (body.operation === "lookup") {
      const lookedUp = CrmLookupResponseSchema.parse(result);
      if (
        lookedUp.connectionId !== body.connectionId ||
        lookedUp.sourceOrganizationId !== body.sourceOrganizationId ||
        lookedUp.destinationOrganizationId !== body.destinationOrganizationId ||
        lookedUp.kind !== body.kind
      ) throw new ReceiverError(502, "invalid_receiver_response");
      response = lookedUp;
    } else if (body.operation === "validate") {
      response = assertCrmValidationMatchesEnvelope(result, body.envelope);
    } else if (body.operation === "deliver") {
      response = assertCrmReceiptMatchesEnvelope(result, body.envelope);
    } else {
      const receipt = CrmDeliveryReceiptSchema.parse(result);
      if (
        receipt.connectionId !== body.connectionId ||
        receipt.sourceOrganizationId !== body.sourceOrganizationId ||
        receipt.destinationOrganizationId !== body.destinationOrganizationId ||
        receipt.callId !== body.callId ||
        receipt.sourceReviewRevision !== body.reviewRevision ||
        receipt.idempotencyKey !== body.idempotencyKey ||
        receipt.payloadHash !== body.payloadHash
      ) throw new ReceiverError(502, "invalid_receiver_response");
      response = receipt;
    }
    return new Response(JSON.stringify(response), { status: 200, headers });
  } catch (error) {
    return receiverFailure(error, headers);
  }
}
if (import.meta.main) Deno.serve((request) => handler(request));
