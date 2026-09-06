import { strict as assert } from "node:assert";
import {
  assertCrmReceiptMatchesEnvelope,
  assertCrmValidationMatchesEnvelope,
  canonicalCrmJson,
  type CrmDeliveryReceipt,
  CrmDeliveryReceiptSchema,
  CrmDescribeResponseSchema,
  CrmEvidenceReferenceSchema,
  crmIdempotencyKey,
  CrmIntegrationRequestSchema,
  CrmLookupResponseSchema,
  type CrmReviewEnvelope,
  CrmReviewEnvelopeSchema,
  type CrmValidateResponse,
  parseCrmReviewEnvelope,
  previousCrmReceipt,
  renderCrmReviewNote,
  sealCrmReviewEnvelope,
} from "./crm-contract.ts";
import {
  CRM_FIXTURE_CONTENT,
  CRM_FIXTURE_HASH,
  CRM_FIXTURE_KEY,
  CRM_FIXTURE_SCOPE,
} from "./crm-contract-fixtures.ts";

function receipt(envelope: CrmReviewEnvelope): CrmDeliveryReceipt {
  return {
    schemaVersion: 1,
    status: "persisted",
    source: "fecha-ai",
    destination: "crm-empreende-ia",
    ...CRM_FIXTURE_SCOPE,
    callId: envelope.callId,
    sourceReviewRevision: envelope.reviewRevision,
    deliveryId: "60000000-0000-4000-8000-000000000001",
    idempotencyKey: envelope.idempotencyKey,
    payloadHash: envelope.payloadHash,
    operation: envelope.operation,
    noteId: "70000000-0000-4000-8000-000000000001",
    taskId: envelope.nextStep ? "80000000-0000-4000-8000-000000000001" : null,
    taskDisposition: envelope.nextStep ? "created" : "none",
    destinationRevision: 1,
    persistedAt: "2026-09-06T15:01:00.000Z",
  };
}

Deno.test("CRM canonical JSON has stable object order, preserves arrays/text and rejects non-JSON", () => {
  assert.equal(
    canonicalCrmJson({ b: [2, { "á": "João", a: true }], a: null }),
    '{"a":null,"b":[2,{"a":true,"á":"João"}]}',
  );
  assert.notEqual(canonicalCrmJson([1, 2]), canonicalCrmJson([2, 1]));
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (
    const value of [
      undefined,
      NaN,
      Infinity,
      new Date(),
      1n,
      { a: undefined },
      cyclic,
      Array(2),
    ]
  ) assert.throws(() => canonicalCrmJson(value));
  assert.notEqual(canonicalCrmJson("á"), canonicalCrmJson("a\u0301"));
});

Deno.test("CRM destination note is the deterministic plain-text preview with exact reviewed prose and separate result/payment", async () => {
  const envelope = await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
  const note = renderCrmReviewNote(envelope);
  assert.deepEqual(renderCrmReviewNote(structuredClone(envelope)), note);
  assert.equal(note.title, "Fecha AI · Revisão comercial");
  assert.ok(
    note.body.includes(`Resumo revisado:\n${envelope.reviewNote.summary}`),
  );
  assert.ok(
    note.body.includes(
      "Resultado comercial registrado: Ganho\nPagamento informado na revisão: Pendente",
    ),
  );
  assert.ok(note.body.includes(envelope.nextStep!.description));
  assert.ok(note.body.includes(envelope.nextStep!.dueAt));
  assert.equal(note.body.includes("followUp"), false);
  const literal = "<script>não executar</script>\nNão inventar garantia.";
  const recorded = await sealCrmReviewEnvelope({
    ...CRM_FIXTURE_CONTENT,
    reviewNote: { ...CRM_FIXTURE_CONTENT.reviewNote, summary: literal },
    nextStep: null,
  });
  assert.ok(
    renderCrmReviewNote(recorded).body.includes(`Resumo revisado:\n${literal}`),
  );
  assert.ok(
    renderCrmReviewNote(recorded).body.includes("Nenhuma tarefa solicitada"),
  );
});

Deno.test("CRM conformance vector seals identically across object order and retry; identity includes connection/source/call/review", async () => {
  const envelope = await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
  const reordered = Object.fromEntries(Object.entries(envelope).reverse());
  assert.deepEqual(await parseCrmReviewEnvelope(reordered), envelope);
  assert.equal(envelope.idempotencyKey, CRM_FIXTURE_KEY);
  assert.equal(envelope.payloadHash, CRM_FIXTURE_HASH);
  assert.deepEqual(
    await sealCrmReviewEnvelope(structuredClone(CRM_FIXTURE_CONTENT)),
    envelope,
  );
  const identity = {
    ...CRM_FIXTURE_SCOPE,
    callId: envelope.callId,
    reviewRevision: envelope.reviewRevision,
  };
  for (
    const key of ["connectionId", "sourceOrganizationId", "callId"] as const
  ) {
    assert.notEqual(
      crmIdempotencyKey({
        ...identity,
        [key]: "90000000-0000-4000-8000-000000000001",
      }),
      envelope.idempotencyKey,
    );
  }
  assert.notEqual(
    crmIdempotencyKey({ ...identity, reviewRevision: 8 }),
    envelope.idempotencyKey,
  );
  // Rebinding a connection cannot silently produce another key: its changed destination is a hash conflict.
  const changedDestination = await sealCrmReviewEnvelope({
    ...CRM_FIXTURE_CONTENT,
    destinationOrganizationId: "90000000-0000-4000-8000-000000000001",
  });
  assert.equal(changedDestination.idempotencyKey, envelope.idempotencyKey);
  assert.notEqual(changedDestination.payloadHash, envelope.payloadHash);
  assert.equal(
    JSON.stringify(CRM_FIXTURE_CONTENT).includes("payloadHash"),
    false,
  );
});

Deno.test("CRM rejects tampered hash, unknown fields, invalid identities/targets, unreviewed result and invented task defaults", async () => {
  const envelope = await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
  const changed = {
    ...envelope,
    reviewNote: { ...envelope.reviewNote, summary: "Texto diferente" },
  };
  await assert.rejects(() => parseCrmReviewEnvelope(changed), /hash/);
  for (
    const patch of [
      { transcript: "não enviar" },
      { followUpDraft: "não enviar" },
      { source: "other" },
      { destination: "other" },
      { connectionId: "not-a-uuid" },
      { sourceOwnerId: "not-a-uuid" },
      { reviewedBySourceUserId: "" },
      { idempotencyKey: `${envelope.idempotencyKey}:retry` },
      { reviewRevision: 0 },
      { target: { contactId: null, companyId: null, dealId: null } },
      { nextStep: { description: "Reunião", dueAt: envelope.nextStep?.dueAt } },
      {
        nextStep: {
          description: "Reunião",
          assigneeId: envelope.destinationActorId,
          dueAt: null,
        },
      },
      { reviewNote: { ...envelope.reviewNote, summary: " " } },
      {
        reviewNote: { ...envelope.reviewNote, commercialResult: "unresolved" },
      },
      { reviewNote: { ...envelope.reviewNote, paymentStatus: "paid" } },
      { reviewNote: { ...envelope.reviewNote, price: 999 } },
      {
        reviewNote: {
          ...envelope.reviewNote,
          evidenceReferences: [
            ...envelope.reviewNote.evidenceReferences,
            ...envelope.reviewNote.evidenceReferences,
          ],
        },
      },
    ]
  ) {
    assert.equal(
      CrmReviewEnvelopeSchema.safeParse({ ...envelope, ...patch }).success,
      false,
      JSON.stringify(patch),
    );
  }
  const noteOnly = await sealCrmReviewEnvelope({
    ...CRM_FIXTURE_CONTENT,
    nextStep: null,
  });
  assert.equal(noteOnly.reviewNote.commercialResult, "won");
  assert.equal(noteOnly.reviewNote.paymentStatus, "pending");
  assert.equal(noteOnly.nextStep, null);
  assert.notEqual(noteOnly.payloadHash, envelope.payloadHash);
});

Deno.test("CRM append is explicit, advances review, appends a note and preserves the exact previous task", async () => {
  const initial = await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
  const prior = receipt(initial);
  const append = await sealCrmReviewEnvelope({
    ...CRM_FIXTURE_CONTENT,
    reviewRevision: 9,
    reviewedAt: "2026-09-07T15:00:00.000Z",
    operation: "append_note_preserve_task",
    previousReceipt: previousCrmReceipt(prior),
    nextStep: null,
  });
  assert.notEqual(append.idempotencyKey, initial.idempotencyKey);
  const received: CrmDeliveryReceipt = {
    ...receipt(append),
    deliveryId: "60000000-0000-4000-8000-000000000002",
    noteId: "70000000-0000-4000-8000-000000000002",
    taskId: prior.taskId,
    taskDisposition: "preserved",
    destinationRevision: 2,
  };
  assert.deepEqual(assertCrmReceiptMatchesEnvelope(received, append), received);
  for (
    const patch of [{ nextStep: initial.nextStep }, { previousReceipt: null }, {
      reviewRevision: 7,
    }, { operation: "create_note" }]
  ) {
    assert.equal(
      CrmReviewEnvelopeSchema.safeParse({ ...append, ...patch }).success,
      false,
    );
  }
  for (
    const patch of [
      { taskId: "80000000-0000-4000-8000-000000000002" },
      { taskId: null, taskDisposition: "none" },
      { noteId: prior.noteId },
      { deliveryId: prior.deliveryId },
      { destinationRevision: 1 },
    ]
  ) {
    assert.throws(() =>
      assertCrmReceiptMatchesEnvelope({ ...received, ...patch }, append)
    );
  }
  const oldWithoutTask = {
    ...prior,
    taskId: null,
    taskDisposition: "none" as const,
  };
  const appendWithoutTask = await sealCrmReviewEnvelope({
    ...CRM_FIXTURE_CONTENT,
    reviewRevision: 9,
    operation: "append_note_preserve_task",
    previousReceipt: previousCrmReceipt(oldWithoutTask),
    nextStep: null,
  });
  assert.equal(
    assertCrmReceiptMatchesEnvelope({
      ...received,
      taskId: null,
      taskDisposition: "none",
      payloadHash: appendWithoutTask.payloadHash,
    }, appendWithoutTask).taskId,
    null,
  );
});

Deno.test("CRM receipt proves persisted identity and requested task, never only queued or partial success", async () => {
  const envelope = await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
  const persisted = receipt(envelope);
  assert.deepEqual(
    assertCrmReceiptMatchesEnvelope(persisted, envelope),
    persisted,
  );
  assert.equal(
    CrmDeliveryReceiptSchema.safeParse({ ...persisted, status: "queued" })
      .success,
    false,
  );
  for (
    const patch of [
      { connectionId: "90000000-0000-4000-8000-000000000001" },
      { payloadHash: "a".repeat(64) },
      { sourceReviewRevision: 8 },
      { taskId: null, taskDisposition: "none" },
      { taskId: null },
      { noteId: null },
    ]
  ) {
    assert.throws(() =>
      assertCrmReceiptMatchesEnvelope({ ...persisted, ...patch }, envelope)
    );
  }
});

Deno.test("CRM lookup and describe expose only scoped typed choices and explicitly allowed actors", () => {
  const choice = {
    kind: "contact",
    id: CRM_FIXTURE_CONTENT.target.contactId,
    organizationId: CRM_FIXTURE_SCOPE.destinationOrganizationId,
    label: "João · empresa exemplo",
  };
  const response = {
    schemaVersion: 1,
    ...CRM_FIXTURE_SCOPE,
    kind: "contact",
    choices: [choice],
    nextCursor: null,
  };
  assert.equal(CrmLookupResponseSchema.safeParse(response).success, true);
  for (
    const patch of [{ kind: "deal" }, {
      organizationId: CRM_FIXTURE_SCOPE.sourceOrganizationId,
    }, { id: "John" }]
  ) {
    assert.equal(
      CrmLookupResponseSchema.safeParse({
        ...response,
        choices: [{ ...choice, ...patch }],
      }).success,
      false,
    );
  }
  assert.equal(
    CrmLookupResponseSchema.safeParse({
      ...response,
      choices: [choice, choice],
    }).success,
    false,
  );
  const describe = {
    schemaVersion: 1,
    source: "fecha-ai",
    destination: "crm-empreende-ia",
    ...CRM_FIXTURE_SCOPE,
    connectionName: "Conexão de teste",
    expiresAt: "2026-09-30T00:00:00.000Z",
    allowedActors: [{
      id: CRM_FIXTURE_CONTENT.destinationActorId,
      organizationId: CRM_FIXTURE_SCOPE.destinationOrganizationId,
      label: "Vendedora de teste",
    }],
    capabilities: {
      reviewedNotes: true,
      optionalTask: true,
      appendPreservesTask: true,
    },
  };
  assert.equal(CrmDescribeResponseSchema.safeParse(describe).success, true);
  assert.equal(
    CrmDescribeResponseSchema.safeParse({ ...describe, allowedActors: [] })
      .success,
    false,
  );
  assert.equal(
    CrmDescribeResponseSchema.safeParse({
      ...describe,
      allowedActors: [{
        ...describe.allowedActors[0],
        organizationId: CRM_FIXTURE_SCOPE.sourceOrganizationId,
      }],
    }).success,
    false,
  );
});

Deno.test("CRM validation labels are bound to the exact payload, target and actor without claiming delivery", async () => {
  const envelope = await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
  const preview: CrmValidateResponse = {
    schemaVersion: 1,
    status: "validated",
    ...CRM_FIXTURE_SCOPE,
    callId: envelope.callId,
    reviewRevision: envelope.reviewRevision,
    payloadHash: envelope.payloadHash,
    validatedAt: "2026-09-06T15:01:00.000Z",
    actor: {
      id: envelope.destinationActorId,
      organizationId: envelope.destinationOrganizationId,
      label: "Vendedora",
    },
    target: {
      contact: {
        kind: "contact",
        id: envelope.target.contactId!,
        organizationId: envelope.destinationOrganizationId,
        label: "João",
      },
      company: null,
      deal: null,
    },
    assignee: {
      kind: "assignee",
      id: envelope.nextStep!.assigneeId,
      organizationId: envelope.destinationOrganizationId,
      label: "Responsável",
    },
  };
  assert.deepEqual(
    assertCrmValidationMatchesEnvelope(preview, envelope),
    preview,
  );
  assert.throws(() =>
    assertCrmValidationMatchesEnvelope({
      ...preview,
      payloadHash: "b".repeat(64),
    }, envelope)
  );
  assert.throws(() =>
    assertCrmValidationMatchesEnvelope({
      ...preview,
      actor: { ...preview.actor, id: envelope.sourceOwnerId },
    }, envelope)
  );
  assert.throws(() =>
    assertCrmValidationMatchesEnvelope({ ...preview, assignee: null }, envelope)
  );
  assert.throws(() =>
    assertCrmValidationMatchesEnvelope({
      ...preview,
      target: {
        ...preview.target,
        contact: { ...preview.target.contact, id: envelope.sourceOwnerId },
      },
    }, envelope)
  );
  assert.equal(CrmDeliveryReceiptSchema.safeParse(preview).success, false);
});

Deno.test("CRM transport has five explicit operations, bounded lookup and no browser webhook/token fields", async () => {
  const envelope = await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
  const requests = [
    { operation: "describe", connectionId: envelope.connectionId },
    {
      operation: "lookup",
      ...CRM_FIXTURE_SCOPE,
      kind: "contact",
      query: "João",
      cursor: null,
      limit: 25,
    },
    { operation: "validate", envelope },
    { operation: "deliver", envelope },
    {
      operation: "receipt",
      ...CRM_FIXTURE_SCOPE,
      callId: envelope.callId,
      reviewRevision: envelope.reviewRevision,
      idempotencyKey: envelope.idempotencyKey,
      payloadHash: envelope.payloadHash,
    },
  ];
  for (const request of requests) {
    assert.equal(CrmIntegrationRequestSchema.safeParse(request).success, true);
    assert.equal(
      CrmIntegrationRequestSchema.safeParse({
        ...request,
        webhookUrl: "https://example.invalid",
      }).success,
      false,
    );
    assert.equal(
      CrmIntegrationRequestSchema.safeParse({ ...request, token: "a secret" })
        .success,
      false,
    );
  }
  assert.equal(
    CrmIntegrationRequestSchema.safeParse({ ...requests[1], limit: 51 })
      .success,
    false,
  );
  assert.equal(
    CrmIntegrationRequestSchema.safeParse({
      ...requests[1],
      query: "x".repeat(121),
    }).success,
    false,
  );
});

Deno.test("CRM references support immutable imports without granting transcript access", async () => {
  const segmentId = "44444444-4444-4444-8444-444444444444:import:000001";
  assert.equal(
    CrmEvidenceReferenceSchema.safeParse({ segmentId, revision: 1 }).success,
    true,
  );
  assert.equal(
    CrmEvidenceReferenceSchema.safeParse({
      segmentId: segmentId.replace("000001", "1"),
      revision: 1,
    }).success,
    false,
  );
  const content = {
    ...CRM_FIXTURE_CONTENT,
    reviewNote: {
      ...CRM_FIXTURE_CONTENT.reviewNote,
      evidenceReferences: [{ segmentId, revision: 1 }],
    },
  };
  const envelope = await sealCrmReviewEnvelope(content);
  assert.deepEqual(await parseCrmReviewEnvelope(envelope), envelope);
});
