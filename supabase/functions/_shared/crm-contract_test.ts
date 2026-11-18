import { strict as assert } from "node:assert";
import {
  assertCrmReceiptMatchesEnvelope,
  assertCrmValidationMatchesEnvelope,
  canonicalCrmJson,
  CRM_MAX_ENVELOPE_BYTES,
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
  CRM_FIXTURE_HASH_WITHOUT_OBJECTIONS,
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
  assert.equal(note.title, "Fecha IA · Revisão comercial");
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

Deno.test("CRM note lists each objection type and status and the reviewed objection text after the summary, or says there is none", async () => {
  const envelope = await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT);
  const objections = CRM_FIXTURE_CONTENT.reviewNote.objections!;
  const body = renderCrmReviewNote(envelope).body;
  assert.ok(
    body.includes(
      `Resumo revisado:\n${envelope.reviewNote.summary}\n\nObjeções registradas na Fecha IA:\nEstá caro · Resolvida\nPreciso falar com sócio · Próxima conversa\n\nObjeções e respostas (revisão do vendedor):\n${objections.reviewText}\n\nResultado comercial registrado: Ganho`,
    ),
  );
  assert.equal(body.includes("Nenhuma objeção"), false);
  const render = async (value: typeof objections) =>
    renderCrmReviewNote(
      await sealCrmReviewEnvelope({
        ...CRM_FIXTURE_CONTENT,
        reviewNote: { ...CRM_FIXTURE_CONTENT.reviewNote, objections: value },
      }),
    ).body;
  assert.ok(
    (await render({ reviewText: null, items: [] })).includes(
      `Resumo revisado:\n${envelope.reviewNote.summary}\n\nNenhuma objeção registrada na Fecha IA.\n\nResultado comercial registrado: Ganho`,
    ),
  );
  const textOnly = await render({
    reviewText: "<script>não executar</script>\nPediu prazo para decidir.",
    items: [],
  });
  assert.ok(
    textOnly.includes(
      "Objeções e respostas (revisão do vendedor):\n<script>não executar</script>\nPediu prazo para decidir.",
    ),
  );
  assert.equal(textOnly.includes("Objeções registradas"), false);
  assert.equal(textOnly.includes("Nenhuma objeção"), false);
  const every = await render({
    reviewText: null,
    items: [
      { type: "thinking", status: "open" },
      { type: "price", status: "resolved" },
      { type: "partner", status: "pending" },
      { type: "timing", status: "next_meeting" },
      { type: "previous_attempt", status: "resolved" },
      { type: "comparison", status: "pending" },
      { type: "other", status: "open" },
      { type: "price", status: "pending" },
    ],
  });
  assert.ok(
    every.includes(
      "Objeções registradas na Fecha IA:\nPreciso pensar · Em aberto\nEstá caro · Resolvida\nPreciso falar com sócio · Pendente\nNão é o momento · Próxima conversa\nJá tentei antes · Resolvida\nVou ver outras opções · Pendente\nOutra objeção · Em aberto\nEstá caro · Pendente\n\nResultado comercial registrado",
    ),
  );
  assert.equal(every.includes("Objeções e respostas"), false);
});

Deno.test("CRM envelope sealed without objections keeps its v1 hash and renders the note it was previewed with", async () => {
  const { objections, ...withoutObjections } = CRM_FIXTURE_CONTENT.reviewNote;
  const legacy = await sealCrmReviewEnvelope({
    ...CRM_FIXTURE_CONTENT,
    reviewNote: withoutObjections,
  });
  assert.equal(legacy.payloadHash, CRM_FIXTURE_HASH_WITHOUT_OBJECTIONS);
  assert.equal(legacy.idempotencyKey, CRM_FIXTURE_KEY);
  assert.equal("objections" in legacy.reviewNote, false);
  assert.deepEqual(await parseCrmReviewEnvelope(legacy), legacy);
  const current = renderCrmReviewNote(
    await sealCrmReviewEnvelope(CRM_FIXTURE_CONTENT),
  );
  const note = renderCrmReviewNote(legacy);
  assert.equal(note.title, current.title);
  assert.equal(
    note.body,
    current.body.replace(
      `\n\nObjeções registradas na Fecha IA:\nEstá caro · Resolvida\nPreciso falar com sócio · Próxima conversa\n\nObjeções e respostas (revisão do vendedor):\n${
        objections!.reviewText
      }`,
      "",
    ),
  );
  assert.equal(note.body.includes("Objeç"), false);
  // Adding the field to a sealed legacy envelope is a hash conflict, never the same delivery.
  await assert.rejects(
    () =>
      parseCrmReviewEnvelope({
        ...legacy,
        reviewNote: { ...legacy.reviewNote, objections },
      }),
    /hash/,
  );
});

Deno.test("CRM note of the largest envelope the contract seals fits the 64 KiB the preview shows and the receiver stores", async () => {
  const largest = (fraction: string) => ({
    ...CRM_FIXTURE_CONTENT,
    reviewRevision: 2_147_483_647,
    reviewedAt: `2026-09-06T15:00:00.${fraction}Z`,
    reviewNote: {
      ...CRM_FIXTURE_CONTENT.reviewNote,
      summary: "s".repeat(8_000),
      method: {
        id: "empreende-ia-commercial" as const,
        version: "v".repeat(64),
      },
      offer: {
        id: "80000000-0000-4000-8000-000000000001",
        version: "o".repeat(64),
      },
      evidenceReferences: Array.from({ length: 100 }, (_, index) => ({
        segmentId: `50000000-0000-4000-8000-000000000001:turn:${
          "1".repeat(155)
        }${String(index).padStart(3, "0")}`,
        revision: 2_147_483_647,
        correctionRef: {
          id: "90000000-0000-4000-8000-000000000001",
          revision: 100,
        },
      })),
      objections: {
        reviewText: "r".repeat(8_000),
        items: Array(100).fill({ type: "partner", status: "next_meeting" }),
      },
    },
    nextStep: {
      ...CRM_FIXTURE_CONTENT.nextStep!,
      description: "d".repeat(2_000),
    },
  });
  const bytes = (value: unknown) =>
    new TextEncoder().encode(canonicalCrmJson(value)).byteLength;
  // Every field at its limit, then the timestamp fraction fills the envelope up to the last byte.
  const fill = CRM_MAX_ENVELOPE_BYTES -
    bytes(await sealCrmReviewEnvelope(largest("1")));
  const envelope = await sealCrmReviewEnvelope(
    largest("1".repeat(1 + fill)),
  );
  assert.equal(bytes(envelope), CRM_MAX_ENVELOPE_BYTES);
  await assert.rejects(
    () => sealCrmReviewEnvelope(largest("1".repeat(2 + fill))),
    /64 KiB/,
  );
  const note = renderCrmReviewNote(envelope);
  assert.ok(note.body.length <= CRM_MAX_ENVELOPE_BYTES, `${note.body.length}`);
  assert.ok(note.title.length <= 200);
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
      ...[
        null,
        { items: [] },
        { reviewText: null },
        { reviewText: "", items: [] },
        { reviewText: " Texto com espaço externo", items: [] },
        { reviewText: "x".repeat(8_001), items: [] },
        { reviewText: null, items: [], declaredText: "não enviar" },
        ...[
          { type: "price", status: "resolved", declaredText: "Está caro" },
          { type: "price", status: "resolved", response: "não enviar" },
          { type: "price", status: "resolved", interpretation: "não enviar" },
          { type: "budget", status: "resolved" },
          { type: "price", status: "won" },
          { type: "price" },
        ].map((item) => ({ reviewText: null, items: [item] })),
        {
          reviewText: null,
          items: Array(101).fill({ type: "price", status: "open" }),
        },
      ].map((objections) => ({
        reviewNote: { ...envelope.reviewNote, objections },
      })),
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

Deno.test("CRM binds human correction references to hash and rendered note without including transcript text", async () => {
  const correctionRef = {
    id: "90000000-0000-4000-8000-000000000001",
    revision: 2,
  };
  const reference = {
    segmentId: "90000000-0000-4000-8000-000000000002:import:000001",
    revision: 1,
    correctionRef,
  };
  assert.deepEqual(CrmEvidenceReferenceSchema.parse(reference), reference);
  const content = {
    ...CRM_FIXTURE_CONTENT,
    reviewNote: {
      ...CRM_FIXTURE_CONTENT.reviewNote,
      evidenceReferences: [reference],
    },
  };
  const envelope = await sealCrmReviewEnvelope(content);
  assert.notEqual(envelope.payloadHash, CRM_FIXTURE_HASH);
  assert.match(
    renderCrmReviewNote(envelope).body,
    /correção humana 90000000-0000-4000-8000-000000000001 v2/,
  );
  assert.equal(
    CrmEvidenceReferenceSchema.safeParse({
      ...reference,
      correctionRef: { ...correctionRef, revision: 101 },
    }).success,
    false,
  );
  assert.equal(
    CrmReviewEnvelopeSchema.safeParse({
      ...envelope,
      reviewNote: {
        ...envelope.reviewNote,
        evidenceReferences: [reference, reference],
      },
    }).success,
    false,
  );
});
