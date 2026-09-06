import { strict as assert } from "node:assert";
import { handler as integration } from "../fecha-ai-integration/index.ts";
import { handler as management } from "../manage-fecha-ai-connections/index.ts";
import {
  CRM_FIXTURE_CONTENT,
  CRM_FIXTURE_SCOPE,
} from "./crm-contract-fixtures.ts";
import {
  type CrmDeliveryReceipt,
  type CrmValidateResponse,
  renderCrmReviewNote,
  sealCrmReviewEnvelope,
} from "./crm-contract.ts";
import {
  createFechaToken,
  hashFechaToken,
  type ReceiverDependencies,
} from "./fecha-receiver-http.ts";

const token = `fecrm_${"a".repeat(64)}`;
const actor = CRM_FIXTURE_CONTENT.destinationActorId;
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(
    "https://crm.example.test/functions/v1/fecha-ai-integration",
    {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}
function dependencies(
  data: unknown = null,
  error: { message: string; code?: string } | null = null,
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const deps: ReceiverDependencies = {
    allowedOrigins: ["https://crm.example.test"],
    verifyUser: (jwt) =>
      Promise.resolve(jwt === "valid-user-jwt" ? actor : null),
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({ data, error });
    },
  };
  return { deps, calls };
}
function connection() {
  return {
    id: CRM_FIXTURE_SCOPE.connectionId,
    name: "Conexão de teste",
    sourceOrganizationId: CRM_FIXTURE_SCOPE.sourceOrganizationId,
    destinationOrganizationId: CRM_FIXTURE_SCOPE.destinationOrganizationId,
    allowedActorIds: [actor],
    expiresAt: "2026-10-01T12:00:00.000Z",
    createdAt: "2026-09-06T12:00:00.000Z",
    createdBy: actor,
    revokedAt: null,
  };
}

Deno.test("receiver authenticates opaque token before RPC, hashes it, and rejects browser origin/invalid transport", async () => {
  const { deps, calls } = dependencies();
  for (
    const headers of [{ authorization: "" }, {
      authorization: "Bearer valid-user-jwt",
    }, { authorization: `Bearer fecrm_${"A".repeat(64)}` }]
  ) {
    assert.equal(
      (await integration(
        request({
          operation: "describe",
          connectionId: CRM_FIXTURE_SCOPE.connectionId,
        }, headers),
        deps,
      )).status,
      401,
    );
  }
  assert.equal(
    (await integration(
      request({
        operation: "describe",
        connectionId: CRM_FIXTURE_SCOPE.connectionId,
      }, { origin: "https://crm.example.test" }),
      deps,
    )).status,
    403,
  );
  assert.equal(calls.length, 0);
  assert.equal(
    (await integration(
      new Request("https://crm.example.test", { method: "GET" }),
      deps,
    )).status,
    405,
  );
});

Deno.test("receiver deliver hashes credential and renders exact preview, returns only validated persisted receipt", async () => {
  const envelope = await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
  const receipt: CrmDeliveryReceipt = {
    schemaVersion: 1,
    status: "persisted",
    source: "fecha-ai",
    destination: "crm-empreende-ia",
    ...CRM_FIXTURE_SCOPE,
    callId: envelope.callId,
    sourceReviewRevision: envelope.reviewRevision,
    deliveryId: "60000000-0000-4000-8000-000000000001",
    noteId: "70000000-0000-4000-8000-000000000001",
    taskId: "80000000-0000-4000-8000-000000000001",
    taskDisposition: "created",
    operation: "create_note",
    idempotencyKey: envelope.idempotencyKey,
    payloadHash: envelope.payloadHash,
    destinationRevision: 1,
    persistedAt: "2026-09-06T15:01:00.000Z",
  };
  const { deps, calls } = dependencies(receipt);
  const response = await integration(
    request({ operation: "deliver", envelope }),
    deps,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), receipt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "fecha_ai_integration");
  assert.equal(calls[0].args.p_token_hash, await hashFechaToken(token));
  assert.equal(JSON.stringify(calls).includes(token), false);
  assert.equal(calls[0].args.p_note_title, renderCrmReviewNote(envelope).title);
  assert.equal(calls[0].args.p_note_body, renderCrmReviewNote(envelope).body);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("access-control-allow-origin"), false);
  const partial = dependencies({
    ...receipt,
    taskId: null,
    taskDisposition: "none",
  });
  assert.notEqual(
    (await integration(
      request({ operation: "deliver", envelope }),
      partial.deps,
    )).status,
    200,
  );
});

Deno.test("receiver validate uses same envelope without rendered-write args and exposes exact scoped choices", async () => {
  const envelope = await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
  const validated: CrmValidateResponse = {
    schemaVersion: 1,
    status: "validated",
    ...CRM_FIXTURE_SCOPE,
    callId: envelope.callId,
    reviewRevision: envelope.reviewRevision,
    payloadHash: envelope.payloadHash,
    validatedAt: "2026-09-06T15:01:00.000Z",
    actor: {
      id: actor,
      organizationId: envelope.destinationOrganizationId,
      label: "Gestora",
    },
    target: {
      contact: {
        id: envelope.target.contactId!,
        kind: "contact",
        organizationId: envelope.destinationOrganizationId,
        label: "João",
      },
      company: null,
      deal: null,
    },
    assignee: {
      id: envelope.nextStep!.assigneeId,
      kind: "assignee",
      organizationId: envelope.destinationOrganizationId,
      label: "Responsável",
    },
  };
  const { deps, calls } = dependencies(validated);
  const response = await integration(
    request({ operation: "validate", envelope }),
    deps,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), validated);
  assert.equal(Object.hasOwn(calls[0].args, "p_note_body"), false);
});

Deno.test("receiver rejects malformed, tampered, oversized and unknown payloads before a database call", async () => {
  const envelope = await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
  const { deps, calls } = dependencies();
  for (
    const body of [{
      operation: "deliver",
      envelope: { ...envelope, transcript: "secret" },
    }, {
      operation: "deliver",
      envelope: {
        ...envelope,
        reviewNote: { ...envelope.reviewNote, summary: "tampered" },
      },
    }, {
      operation: "deliver",
      envelope,
      webhookUrl: "https://arbitrary.example.test",
    }, {
      operation: "lookup",
      ...CRM_FIXTURE_SCOPE,
      kind: "contact",
      query: "",
      cursor: null,
      limit: 100,
    }]
  ) assert.equal((await integration(request(body), deps)).status, 422);
  assert.equal(
    (await integration(request({ extra: "x".repeat(71 * 1024) }), deps)).status,
    413,
  );
  assert.equal(calls.length, 0);
});

Deno.test("receiver database authorization/conflict failures preserve documented status without leaking SQL or token", async () => {
  const envelope = await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
  for (
    const [message, status] of [
      ["invalid_connection_token", 401],
      ["scope_mismatch", 403],
      ["actor_not_allowed", 403],
      ["target_not_found", 404],
      ["receipt_not_found", 404],
      ["idempotency_conflict", 409],
      ["previous_task_missing", 409],
      ["invalid_next_step", 422],
    ] as const
  ) {
    const { deps } = dependencies(null, { message });
    const response = await integration(
      request({ operation: "deliver", envelope }),
      deps,
    );
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, message);
  }
  const bad = dependencies(null, {
    message: `SQL unexpectedly included ${token}`,
  });
  const result = await integration(
    request({ operation: "deliver", envelope }),
    bad.deps,
  );
  assert.equal(result.status, 503);
  assert.equal((await result.text()).includes(token), false);
});

Deno.test("receiver only accepts described/looked-up data for the requested scope", async () => {
  const body = {
    operation: "lookup",
    ...CRM_FIXTURE_SCOPE,
    kind: "contact",
    query: "",
    cursor: null,
    limit: 25,
  };
  const foreign = dependencies({
    schemaVersion: 1,
    ...CRM_FIXTURE_SCOPE,
    destinationOrganizationId: CRM_FIXTURE_SCOPE.sourceOrganizationId,
    kind: "contact",
    choices: [],
    nextCursor: null,
  });
  assert.equal((await integration(request(body), foreign.deps)).status, 502);
});

Deno.test("management verifies current Auth user and expected organization before service-only mutation", async () => {
  const body = {
    operation: "list",
    organizationId: CRM_FIXTURE_SCOPE.destinationOrganizationId,
  };
  const { deps, calls } = dependencies({ connections: [connection()] });
  assert.equal((await management(request(body), deps)).status, 401);
  assert.equal(calls.length, 0);
  const response = await management(
    request(body, {
      authorization: "Bearer valid-user-jwt",
      origin: "https://crm.example.test",
    }),
    deps,
  );
  assert.equal(response.status, 200);
  assert.equal(calls[0].args.p_actor_id, actor);
  assert.deepEqual(calls[0].args.p_request, body);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://crm.example.test",
  );
  const forbidden = dependencies(null, { message: "forbidden" });
  assert.equal(
    (await management(
      request(body, { authorization: "Bearer valid-user-jwt" }),
      forbidden.deps,
    )).status,
    403,
  );
  const wrong = dependencies({
    connections: [{
      ...connection(),
      destinationOrganizationId: CRM_FIXTURE_SCOPE.sourceOrganizationId,
    }],
  });
  assert.equal(
    (await management(
      request(body, { authorization: "Bearer valid-user-jwt" }),
      wrong.deps,
    )).status,
    502,
  );
});

Deno.test("management generates 256-bit token once; database receives only its hash and list never includes secrets", async () => {
  const body = {
    operation: "create",
    organizationId: CRM_FIXTURE_SCOPE.destinationOrganizationId,
    sourceOrganizationId: CRM_FIXTURE_SCOPE.sourceOrganizationId,
    name: "Conexão de teste",
    allowedActorIds: [actor],
    expiresAt: "2026-10-01T12:00:00.000Z",
  };
  const { deps, calls } = dependencies({ connection: connection() });
  const response = await management(
    request(body, { authorization: "Bearer valid-user-jwt" }),
    deps,
  );
  const created = await response.json();
  assert.equal(response.status, 201);
  assert.match(created.token, /^fecrm_[a-f0-9]{64}$/);
  assert.equal(calls[0].args.p_token_hash, await hashFechaToken(created.token));
  assert.equal(JSON.stringify(calls).includes(created.token), false);
  const list = dependencies({ connections: [connection()] });
  const listed = await management(
    request({ operation: "list", organizationId: body.organizationId }, {
      authorization: "Bearer valid-user-jwt",
    }),
    list.deps,
  );
  assert.equal((await listed.text()).includes(created.token), false);
  assert.equal(list.calls[0].args.p_token_hash, null);
  assert.equal(new Set(Array.from({ length: 20 }, createFechaToken)).size, 20);
});

Deno.test("management rejects credentials in payload, unapproved origins, duplicate actors and missing organization guard", async () => {
  const { deps, calls } = dependencies();
  const headers = { authorization: "Bearer valid-user-jwt" };
  assert.equal(
    (await management(request({ operation: "list" }, headers), deps)).status,
    422,
  );
  assert.equal(
    (await management(
      request({
        operation: "list",
        organizationId: CRM_FIXTURE_SCOPE.destinationOrganizationId,
        token: "unexpected",
      }, headers),
      deps,
    )).status,
    422,
  );
  assert.equal(
    (await management(
      request({
        operation: "set_actors",
        organizationId: CRM_FIXTURE_SCOPE.destinationOrganizationId,
        connectionId: CRM_FIXTURE_SCOPE.connectionId,
        allowedActorIds: [actor, actor],
      }, headers),
      deps,
    )).status,
    422,
  );
  assert.equal(
    (await management(
      request({
        operation: "list",
        organizationId: CRM_FIXTURE_SCOPE.destinationOrganizationId,
      }, { ...headers, origin: "https://attacker.example.test" }),
      deps,
    )).status,
    403,
  );
  assert.equal(calls.length, 0);
});
