import { z } from "zod";

/** Portable v1 wire contract. Validation and hashing do not authorize a delivery. */
export const CRM_CONTRACT_VERSION = 1 as const;
export const CRM_MAX_ENVELOPE_BYTES = 64 * 1024;
const Id = z.string().uuid().refine(
  (id) => id === id.toLowerCase(),
  "Use UUID em minúsculas.",
);
const Revision = z.number().int().positive().max(2_147_483_647);
const Timestamp = z.string().datetime({ offset: true });
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = (max: number) =>
  z.string().min(1).max(max).refine(
    (value) => value === value.trim(),
    "Use texto preenchido, sem espaços externos.",
  );
const ScopeShape = {
  connectionId: Id,
  sourceOrganizationId: Id,
  destinationOrganizationId: Id,
};
export const CrmScopeSchema = z.object(ScopeShape).strict();
export type CrmScope = z.infer<typeof CrmScopeSchema>;
const IdentityShape = { ...ScopeShape, callId: Id, reviewRevision: Revision };
export const CrmDeliveryIdentitySchema = z.object(IdentityShape).strict();
export type CrmDeliveryIdentity = z.infer<typeof CrmDeliveryIdentitySchema>;

/** Destination organization is bound to the connection, and still covered by the payload hash. */
export function crmIdempotencyKey(identity: CrmDeliveryIdentity): string {
  const value = CrmDeliveryIdentitySchema.parse(identity);
  return identityKey(value);
}
function identityKey(value: CrmDeliveryIdentity): string {
  return `fecha-ai:v1:${value.connectionId}:${value.sourceOrganizationId}:${value.callId}:review:${value.reviewRevision}`;
}

export const CrmTargetSchema = z.object({
  contactId: Id.nullable(),
  companyId: Id.nullable(),
  dealId: Id.nullable(),
}).strict()
  .refine(
    (value) =>
      value.contactId !== null || value.companyId !== null ||
      value.dealId !== null,
    "Selecione ao menos um vínculo no CRM.",
  );
export type CrmTarget = z.infer<typeof CrmTargetSchema>;
export const CrmCommercialResultSchema = z.enum([
  "won",
  "lost",
  "next_meeting",
  "awaiting_decision",
  "no_fit",
]);
export const CrmPaymentStatusSchema = z.enum([
  "unverified",
  "pending",
  "confirmed",
  "not_applicable",
]);
export const CrmNextStepSchema = z.object({
  description: text(2_000),
  assigneeId: Id,
  dueAt: Timestamp,
}).strict();
export type CrmNextStep = z.infer<typeof CrmNextStepSchema>;

// Segment references are opaque source identifiers, not destination entities or transcript access grants.
export const CrmEvidenceReferenceSchema = z.object({
  segmentId: z.string().regex(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:(?:(?:turn|start):\d+|import:[0-9]{6})$/,
  ).max(200),
  revision: z.number().int().nonnegative().max(2_147_483_647),
  correctionRef: z.object({
    id: z.string().uuid(),
    revision: z.number().int().min(1).max(100),
  }).strict().optional(),
}).strict();
// The type and status of each objection registered in the call, in registration order, and the seller's reviewed
// "Objeções e respostas" text. What the person said, the interpretation and the response stay in the Fecha IA: they
// can quote the conversation word for word.
export const CrmObjectionTypeSchema = z.enum([
  "thinking",
  "price",
  "partner",
  "timing",
  "previous_attempt",
  "comparison",
  "other",
]);
export const CrmObjectionStatusSchema = z.enum([
  "open",
  "resolved",
  "pending",
  "next_meeting",
]);
export const CrmReviewObjectionsSchema = z.object({
  reviewText: text(8_000).nullable(),
  items: z.array(
    z.object({
      type: CrmObjectionTypeSchema,
      status: CrmObjectionStatusSchema,
    }).strict(),
  ).max(100),
}).strict();
export type CrmReviewObjections = z.infer<typeof CrmReviewObjectionsSchema>;
export const CrmReviewNoteSchema = z.object({
  summary: text(8_000),
  method: z.object({
    id: z.literal("empreende-ia-commercial"),
    version: text(64),
  }).strict(),
  offer: z.object({ id: Id, version: text(64) }).strict().nullable(),
  commercialResult: CrmCommercialResultSchema,
  paymentStatus: CrmPaymentStatusSchema,
  evidenceReferences: z.array(CrmEvidenceReferenceSchema).max(100),
  // Optional in v1: an envelope sealed without it keeps its hash and its note, with no objection section.
  objections: CrmReviewObjectionsSchema.optional(),
}).strict().superRefine((note, context) => {
  const refs = note.evidenceReferences.map((ref) =>
    `${ref.segmentId}@${ref.revision}${
      ref.correctionRef
        ? `#${ref.correctionRef.id}@${ref.correctionRef.revision}`
        : ""
    }`
  );
  if (new Set(refs).size !== refs.length) {
    context.addIssue({
      code: "custom",
      path: ["evidenceReferences"],
      message: "Não repita referências de evidência.",
    });
  }
});

export const CrmPreviousReceiptSchema = z.object({
  deliveryId: Id,
  sourceReviewRevision: Revision,
  noteId: Id,
  taskId: Id.nullable(),
  destinationRevision: Revision,
}).strict();
export type CrmPreviousReceipt = z.infer<typeof CrmPreviousReceiptSchema>;
const ContentShape = {
  schemaVersion: z.literal(CRM_CONTRACT_VERSION),
  source: z.literal("fecha-ai"),
  destination: z.literal("crm-empreende-ia"),
  ...IdentityShape,
  sourceOwnerId: Id,
  reviewedBySourceUserId: Id,
  destinationActorId: Id,
  reviewedAt: Timestamp,
  target: CrmTargetSchema,
  reviewNote: CrmReviewNoteSchema,
};
const OperationShape = {
  operation: z.enum(["create_note", "append_note_preserve_task"]),
  previousReceipt: CrmPreviousReceiptSchema.nullable(),
  nextStep: CrmNextStepSchema.nullable(),
};
const OperationInputSchema = z.object({
  ...OperationShape,
  reviewRevision: Revision,
});
function refineOperation(
  value: z.infer<typeof OperationInputSchema>,
  context: z.RefinementCtx,
) {
  if (value.operation === "create_note" && value.previousReceipt !== null) {
    context.addIssue({
      code: "custom",
      path: ["previousReceipt"],
      message: "A primeira entrega não referencia recibo anterior.",
    });
  }
  if (value.operation === "append_note_preserve_task") {
    if (!value.previousReceipt) {
      context.addIssue({
        code: "custom",
        path: ["previousReceipt"],
        message: "A revisão posterior precisa do recibo anterior.",
      });
    } else if (
      value.reviewRevision <= value.previousReceipt.sourceReviewRevision
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewRevision"],
        message: "A revisão posterior deve ser mais recente que a entregue.",
      });
    }
    if (value.nextStep !== null) {
      context.addIssue({
        code: "custom",
        path: ["nextStep"],
        message:
          "A revisão posterior preserva a tarefa anterior e não cria nem altera tarefas.",
      });
    }
  }
}
export const CrmReviewContentSchema = z.object({
  ...ContentShape,
  ...OperationShape,
}).strict().superRefine(refineOperation);
export type CrmReviewContent = z.infer<typeof CrmReviewContentSchema>;
export const CrmReviewEnvelopeSchema = z.object({
  ...ContentShape,
  ...OperationShape,
  idempotencyKey: z.string().min(1).max(200),
  payloadHash: Hash,
}).strict().superRefine((value, context) => {
  refineOperation(value, context);
  const expected = identityKey({
    connectionId: value.connectionId,
    sourceOrganizationId: value.sourceOrganizationId,
    destinationOrganizationId: value.destinationOrganizationId,
    callId: value.callId,
    reviewRevision: value.reviewRevision,
  });
  if (expected !== value.idempotencyKey) {
    context.addIssue({
      code: "custom",
      path: ["idempotencyKey"],
      message: "A chave não corresponde à identidade da revisão.",
    });
  }
});
export type CrmReviewEnvelope = z.infer<typeof CrmReviewEnvelopeSchema>;

/** Exact destination note preview. Plain text only; display it as text, never as trusted HTML. */
export function renderCrmReviewNote(
  input: CrmReviewEnvelope,
): { title: string; body: string } {
  const envelope = CrmReviewEnvelopeSchema.parse(input);
  const resultLabels = {
    won: "Ganho",
    lost: "Perdido",
    next_meeting: "Próxima reunião",
    awaiting_decision: "Aguardando decisão",
    no_fit: "Sem aderência",
  };
  const paymentLabels = {
    unverified: "Não verificado",
    pending: "Pendente",
    confirmed: "Confirmado por verificação registrada na Fecha IA",
    not_applicable: "Não aplicável",
  };
  const objectionTypeLabels = {
    thinking: "Preciso pensar",
    price: "Está caro",
    partner: "Preciso falar com sócio",
    timing: "Não é o momento",
    previous_attempt: "Já tentei antes",
    comparison: "Vou ver outras opções",
    other: "Outra objeção",
  };
  const objectionStatusLabels = {
    open: "Em aberto",
    resolved: "Resolvida",
    pending: "Pendente",
    next_meeting: "Próxima conversa",
  };
  const { reviewNote: note, previousReceipt: previous } = envelope;
  const objections = note.objections;
  const sections = [
    `Conversa Fecha IA: ${envelope.callId}\nRevisão confirmada: ${envelope.reviewRevision}\nRevisada em: ${envelope.reviewedAt}\nRevisor na Fecha IA: ${envelope.reviewedBySourceUserId}`,
    ...(previous
      ? [
        `Revisão posterior à entrega ${previous.deliveryId} (revisão ${previous.sourceReviewRevision}). A nota anterior permanece registrada.`,
      ]
      : []),
    `Resumo revisado:\n${note.summary}`,
    // An envelope without the field (sealed before it existed) renders the note it was previewed with.
    ...(objections?.items.length
      ? [
        `Objeções registradas na Fecha IA:\n${
          objections.items.map((item) =>
            `${objectionTypeLabels[item.type]} · ${
              objectionStatusLabels[item.status]
            }`
          ).join("\n")
        }`,
      ]
      : []),
    ...(objections?.reviewText
      ? [
        `Objeções e respostas (revisão do vendedor):\n${objections.reviewText}`,
      ]
      : []),
    ...(objections && !objections.items.length && !objections.reviewText
      ? ["Nenhuma objeção registrada na Fecha IA."]
      : []),
    `Resultado comercial registrado: ${
      resultLabels[note.commercialResult]
    }\nPagamento informado na revisão: ${
      paymentLabels[note.paymentStatus]
    }\nEste registro não altera o financeiro nem o estado da oportunidade.`,
    `Método Comercial da Empreende IA: ${note.method.id} · versão ${note.method.version}\n${
      note.offer
        ? `Oferta: ${note.offer.id} · versão ${note.offer.version}`
        : "Oferta: não vinculada."
    }`,
    ...(note.evidenceReferences.length
      ? [
        `Referências de evidência na Fecha IA (sem transcrição):\n${
          note.evidenceReferences.map((ref) =>
            `${ref.segmentId} · revisão ${ref.revision}${
              ref.correctionRef
                ? ` · correção humana ${ref.correctionRef.id} v${ref.correctionRef.revision}`
                : ""
            }`
          ).join("\n")
        }`,
      ]
      : []),
    ...(envelope.nextStep
      ? [
        `Tarefa solicitada com esta revisão:\n${envelope.nextStep.description}\nResponsável no CRM: ${envelope.nextStep.assigneeId}\nPrazo: ${envelope.nextStep.dueAt}`,
      ]
      : previous?.taskId
      ? [
        `Tarefa anterior preservada: ${previous.taskId}. Esta revisão não altera sua descrição, atribuição, prazo ou conclusão.`,
      ]
      : ["Nenhuma tarefa solicitada com esta revisão."]),
  ];
  return {
    title: previous
      ? "Fecha IA · Revisão comercial posterior"
      : "Fecha IA · Revisão comercial",
    body: sections.join("\n\n"),
  };
}

/** UTF-16 code-unit object-key ordering; arrays retain order and text is never normalized. */
export function canonicalCrmJson(value: unknown): string {
  const seen = new Set<object>();
  function encode(input: unknown): string {
    if (
      input === null || typeof input === "string" || typeof input === "boolean"
    ) return JSON.stringify(input);
    if (typeof input === "number" && Number.isFinite(input)) {
      return JSON.stringify(input);
    }
    if (typeof input !== "object" || input === null || seen.has(input)) {
      throw new Error("O hash exige JSON finito e sem ciclos.");
    }
    seen.add(input);
    let encoded: string;
    if (Array.isArray(input)) {
      if (Object.keys(input).length !== input.length) {
        throw new Error(
          "O hash não aceita arrays esparsos ou propriedades extras.",
        );
      }
      encoded = `[${input.map(encode).join(",")}]`;
    } else {
      if (
        Object.getPrototypeOf(input) !== Object.prototype &&
        Object.getPrototypeOf(input) !== null
      ) throw new Error("O hash aceita somente objetos JSON simples.");
      if (Reflect.ownKeys(input).length !== Object.keys(input).length) {
        throw new Error("O hash não aceita propriedades ocultas ou símbolos.");
      }
      encoded = `{${
        Object.keys(input).sort().map((key) =>
          `${JSON.stringify(key)}:${
            encode((input as Record<string, unknown>)[key])
          }`
        ).join(",")
      }}`;
    }
    seen.delete(input);
    return encoded;
  }
  return encode(value);
}
async function hashJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalCrmJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function sealCrmReviewEnvelope(
  input: CrmReviewContent,
): Promise<CrmReviewEnvelope> {
  const content = CrmReviewContentSchema.parse(input);
  const idempotencyKey = crmIdempotencyKey({
    connectionId: content.connectionId,
    sourceOrganizationId: content.sourceOrganizationId,
    destinationOrganizationId: content.destinationOrganizationId,
    callId: content.callId,
    reviewRevision: content.reviewRevision,
  });
  const unsigned = { ...content, idempotencyKey };
  const envelope = CrmReviewEnvelopeSchema.parse({
    ...unsigned,
    payloadHash: await hashJson(unsigned),
  });
  if (
    new TextEncoder().encode(canonicalCrmJson(envelope)).byteLength >
      CRM_MAX_ENVELOPE_BYTES
  ) throw new Error("A revisão excede 64 KiB.");
  return envelope;
}
/** Always run this before accepting a signed/hash-bound payload; schema parsing alone cannot verify SHA-256. */
export async function parseCrmReviewEnvelope(
  input: unknown,
): Promise<CrmReviewEnvelope> {
  const envelope = CrmReviewEnvelopeSchema.parse(input);
  if (
    new TextEncoder().encode(canonicalCrmJson(envelope)).byteLength >
      CRM_MAX_ENVELOPE_BYTES
  ) throw new Error("A revisão excede 64 KiB.");
  const { payloadHash, ...unsigned } = envelope;
  if (payloadHash !== await hashJson(unsigned)) {
    throw new Error("O hash da revisão não corresponde ao conteúdo.");
  }
  return envelope;
}

export const CrmDeliveryReceiptSchema = z.object({
  schemaVersion: z.literal(CRM_CONTRACT_VERSION),
  status: z.literal("persisted"),
  source: z.literal("fecha-ai"),
  destination: z.literal("crm-empreende-ia"),
  ...ScopeShape,
  callId: Id,
  sourceReviewRevision: Revision,
  deliveryId: Id,
  idempotencyKey: z.string().min(1).max(200),
  payloadHash: Hash,
  operation: OperationShape.operation,
  noteId: Id,
  taskId: Id.nullable(),
  taskDisposition: z.enum(["none", "created", "preserved"]),
  destinationRevision: Revision,
  persistedAt: Timestamp,
}).strict().superRefine((value, context) => {
  const expected = identityKey({
    connectionId: value.connectionId,
    sourceOrganizationId: value.sourceOrganizationId,
    destinationOrganizationId: value.destinationOrganizationId,
    callId: value.callId,
    reviewRevision: value.sourceReviewRevision,
  });
  if (expected !== value.idempotencyKey) {
    context.addIssue({
      code: "custom",
      path: ["idempotencyKey"],
      message: "O recibo pertence a outra identidade de revisão.",
    });
  }
  if ((value.taskDisposition === "none") !== (value.taskId === null)) {
    context.addIssue({
      code: "custom",
      path: ["taskDisposition"],
      message:
        "O recibo deve identificar a tarefa persistida ou indicar sua ausência.",
    });
  }
  if (
    value.operation === "append_note_preserve_task" &&
    value.taskDisposition === "created"
  ) {
    context.addIssue({
      code: "custom",
      path: ["taskDisposition"],
      message: "A revisão posterior não cria tarefa.",
    });
  }
  if (
    value.operation === "create_note" && value.taskDisposition === "preserved"
  ) {
    context.addIssue({
      code: "custom",
      path: ["taskDisposition"],
      message: "A primeira entrega não preserva uma tarefa anterior.",
    });
  }
});
export type CrmDeliveryReceipt = z.infer<typeof CrmDeliveryReceiptSchema>;
export function assertCrmReceiptMatchesEnvelope(
  input: unknown,
  envelope: CrmReviewEnvelope,
): CrmDeliveryReceipt {
  const receipt = CrmDeliveryReceiptSchema.parse(input);
  CrmReviewEnvelopeSchema.parse(envelope);
  for (
    const key of [
      "connectionId",
      "sourceOrganizationId",
      "destinationOrganizationId",
      "callId",
      "idempotencyKey",
      "payloadHash",
      "operation",
    ] as const
  ) {
    if (receipt[key] !== envelope[key]) {
      throw new Error(`O recibo diverge da revisão em ${key}.`);
    }
  }
  if (receipt.sourceReviewRevision !== envelope.reviewRevision) {
    throw new Error("O recibo confirma outra revisão.");
  }
  const previous = envelope.previousReceipt;
  if (previous) {
    if (
      receipt.taskId !== previous.taskId ||
      receipt.taskDisposition !== (previous.taskId ? "preserved" : "none")
    ) throw new Error("A revisão posterior deve preservar a tarefa anterior.");
    if (
      receipt.noteId === previous.noteId ||
      receipt.deliveryId === previous.deliveryId ||
      receipt.destinationRevision <= previous.destinationRevision
    ) {
      throw new Error(
        "A revisão posterior exige nova nota, novo recibo e revisão crescente.",
      );
    }
  } else if (
    receipt.taskDisposition !== (envelope.nextStep ? "created" : "none")
  ) throw new Error("O recibo não confirma a tarefa solicitada.");
  return receipt;
}
export function previousCrmReceipt(
  receipt: CrmDeliveryReceipt,
): CrmPreviousReceipt {
  const value = CrmDeliveryReceiptSchema.parse(receipt);
  return {
    deliveryId: value.deliveryId,
    sourceReviewRevision: value.sourceReviewRevision,
    noteId: value.noteId,
    taskId: value.taskId,
    destinationRevision: value.destinationRevision,
  };
}

export const CrmLookupKindSchema = z.enum([
  "contact",
  "company",
  "deal",
  "assignee",
]);
export type CrmLookupKind = z.infer<typeof CrmLookupKindSchema>;
export const CrmLookupChoiceSchema = z.object({
  kind: CrmLookupKindSchema,
  id: Id,
  organizationId: Id,
  label: text(400),
}).strict();
export type CrmLookupChoice = z.infer<typeof CrmLookupChoiceSchema>;
export const CrmActorChoiceSchema = z.object({
  id: Id,
  organizationId: Id,
  label: text(400),
}).strict();
export type CrmActorChoice = z.infer<typeof CrmActorChoiceSchema>;
export const CrmDescribeRequestSchema = z.object({
  operation: z.literal("describe"),
  connectionId: Id,
}).strict();
export const CrmDescribeResponseSchema = z.object({
  schemaVersion: z.literal(CRM_CONTRACT_VERSION),
  source: z.literal("fecha-ai"),
  destination: z.literal("crm-empreende-ia"),
  ...ScopeShape,
  connectionName: text(200),
  expiresAt: Timestamp,
  allowedActors: z.array(CrmActorChoiceSchema).min(1).max(500),
  capabilities: z.object({
    reviewedNotes: z.literal(true),
    optionalTask: z.literal(true),
    appendPreservesTask: z.literal(true),
    // Optional in v1 (B20): announced only by a connection whose CRM administrator enabled the read.
    contextRead: z.literal(true).optional(),
    outcomesRead: z.literal(true).optional(),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (
    value.allowedActors.some((actor) =>
      actor.organizationId !== value.destinationOrganizationId
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["allowedActors"],
      message: "Um ator pertence a outra organização.",
    });
  }
  if (
    new Set(value.allowedActors.map((actor) => actor.id)).size !==
      value.allowedActors.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["allowedActors"],
      message: "Não repita atores autorizados.",
    });
  }
});
export type CrmDescribeResponse = z.infer<typeof CrmDescribeResponseSchema>;
export const CrmLookupRequestSchema = z.object({
  operation: z.literal("lookup"),
  ...ScopeShape,
  kind: CrmLookupKindSchema,
  query: z.string().max(120),
  cursor: z.string().min(1).max(1_000).nullable(),
  limit: z.number().int().min(1).max(50),
}).strict();
export type CrmLookupRequest = z.infer<typeof CrmLookupRequestSchema>;
export const CrmLookupResponseSchema = z.object({
  schemaVersion: z.literal(CRM_CONTRACT_VERSION),
  ...ScopeShape,
  kind: CrmLookupKindSchema,
  choices: z.array(CrmLookupChoiceSchema).max(50),
  nextCursor: z.string().min(1).max(1_000).nullable(),
}).strict().superRefine((value, context) => {
  if (
    value.choices.some((choice) =>
      choice.kind !== value.kind ||
      choice.organizationId !== value.destinationOrganizationId
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["choices"],
      message:
        "As opções precisam corresponder ao tipo e à organização consultados.",
    });
  }
  if (
    new Set(value.choices.map((choice) => choice.id)).size !==
      value.choices.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["choices"],
      message: "Não repita opções.",
    });
  }
});
export type CrmLookupResponse = z.infer<typeof CrmLookupResponseSchema>;
export const CrmValidateRequestSchema = z.object({
  operation: z.literal("validate"),
  envelope: CrmReviewEnvelopeSchema,
}).strict();
export const CrmValidateResponseSchema = z.object({
  schemaVersion: z.literal(CRM_CONTRACT_VERSION),
  status: z.literal("validated"),
  ...IdentityShape,
  payloadHash: Hash,
  validatedAt: Timestamp,
  actor: CrmActorChoiceSchema,
  target: z.object({
    contact: CrmLookupChoiceSchema.nullable(),
    company: CrmLookupChoiceSchema.nullable(),
    deal: CrmLookupChoiceSchema.nullable(),
  }).strict(),
  assignee: CrmLookupChoiceSchema.nullable(),
}).strict().superRefine((value, context) => {
  const choices = [
    value.target.contact,
    value.target.company,
    value.target.deal,
    value.assignee,
  ].filter((choice) => choice !== null);
  if (
    value.actor.organizationId !== value.destinationOrganizationId ||
    choices.some((choice) =>
      choice.organizationId !== value.destinationOrganizationId
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["target"],
      message: "Os vínculos validados pertencem a outra organização.",
    });
  }
  for (const kind of ["contact", "company", "deal"] as const) {
    if (value.target[kind] && value.target[kind]?.kind !== kind) {
      context.addIssue({
        code: "custom",
        path: ["target", kind],
        message: "O tipo do vínculo não corresponde ao campo.",
      });
    }
  }
  if (!value.target.contact && !value.target.company && !value.target.deal) {
    context.addIssue({
      code: "custom",
      path: ["target"],
      message: "A validação precisa de ao menos um vínculo.",
    });
  }
  if (value.assignee && value.assignee.kind !== "assignee") {
    context.addIssue({
      code: "custom",
      path: ["assignee"],
      message: "Selecione um responsável válido.",
    });
  }
});
export type CrmValidateResponse = z.infer<typeof CrmValidateResponseSchema>;
export function assertCrmValidationMatchesEnvelope(
  input: unknown,
  envelope: CrmReviewEnvelope,
): CrmValidateResponse {
  const value = CrmValidateResponseSchema.parse(input);
  CrmReviewEnvelopeSchema.parse(envelope);
  for (
    const key of [
      "connectionId",
      "sourceOrganizationId",
      "destinationOrganizationId",
      "callId",
      "reviewRevision",
      "payloadHash",
    ] as const
  ) {
    if (value[key] !== envelope[key]) {
      throw new Error(`A prévia diverge da revisão em ${key}.`);
    }
  }
  if (value.actor.id !== envelope.destinationActorId) {
    throw new Error("A prévia pertence a outro ator.");
  }
  for (const kind of ["contact", "company", "deal"] as const) {
    if ((value.target[kind]?.id ?? null) !== envelope.target[`${kind}Id`]) {
      throw new Error("A prévia possui vínculo diferente do solicitado.");
    }
  }
  if (
    (value.assignee?.id ?? null) !== (envelope.nextStep?.assigneeId ?? null)
  ) throw new Error("A prévia possui responsável diferente do solicitado.");
  return value;
}
export const CrmDeliverRequestSchema = z.object({
  operation: z.literal("deliver"),
  envelope: CrmReviewEnvelopeSchema,
}).strict();
export const CrmReceiptRequestSchema = z.object({
  operation: z.literal("receipt"),
  ...IdentityShape,
  idempotencyKey: z.string().min(1).max(200),
  payloadHash: Hash,
}).strict().superRefine((value, context) => {
  if (
    value.idempotencyKey !== identityKey({
      connectionId: value.connectionId,
      sourceOrganizationId: value.sourceOrganizationId,
      destinationOrganizationId: value.destinationOrganizationId,
      callId: value.callId,
      reviewRevision: value.reviewRevision,
    })
  ) {
    context.addIssue({
      code: "custom",
      path: ["idempotencyKey"],
      message: "A consulta não corresponde à identidade da revisão.",
    });
  }
});

// Reads of the CRM (B20), additive in v1. The CRM announces each read in describe only for a connection where its
// administrator enabled it, and the Fecha IA never asks for a read the connection did not announce: a receiver without
// the reads, or a connection without them, describes exactly as before. Every text that comes from the CRM is untrusted
// data: show it as text, never follow it as an instruction and never take it as a fact confirmed in the call.
export const CRM_CONTEXT_MAX_COMMITMENTS = 10;
export const CRM_CONTEXT_MAX_ACTIVITIES = 10;
export const CRM_CONTEXT_MAX_REVIEWS = 20;
export const CRM_CONTEXT_EXCERPT_LENGTH = 500;
export const CRM_OUTCOMES_MAX_DEALS = 100;
export const CrmReadScopeSchema = z.enum(["context", "outcomes"]);
export type CrmReadScope = z.infer<typeof CrmReadScopeSchema>;
/** The reads a describe response announces; an absent capability means the read is off on this connection. */
export function crmReadCapabilities(
  input: CrmDescribeResponse,
): Record<CrmReadScope, boolean> {
  const { capabilities } = CrmDescribeResponseSchema.parse(input);
  return {
    context: capabilities.contextRead === true,
    outcomes: capabilities.outcomesRead === true,
  };
}
// The Fecha IA user who asks and the CRM identity mapped to that user: the CRM checks the identity like an author
// (allowed on the connection, active and able to edit) and keeps both in its record of reads.
const ReaderShape = { ...ScopeShape, sourceUserId: Id, destinationActorId: Id };
export const CrmContextRequestSchema = z.object({
  operation: z.literal("context"),
  ...ReaderShape,
  target: CrmTargetSchema,
}).strict();
export type CrmContextRequest = z.infer<typeof CrmContextRequestSchema>;
export const CrmDealStatusSchema = z.enum(["open", "won", "lost"]);
export const CrmActivityTypeSchema = z.enum([
  "task",
  "meeting",
  "call",
  "email",
  "note",
  "whatsapp",
  "visit",
]);
// The stage name, its position in the pipeline (from 1) and the number of stages of the pipeline.
const CrmStageSchema = z.object({
  label: text(120),
  position: z.number().int().min(1).max(1_000),
  count: z.number().int().min(1).max(1_000),
}).strict().refine(
  (stage) => stage.position <= stage.count,
  "A fase precisa estar entre as fases do funil.",
);
const uniqueBy = <T>(values: T[], key: (value: T) => string) =>
  new Set(values.map(key)).size === values.length;
export const CrmContextResponseSchema = z.object({
  schemaVersion: z.literal(CRM_CONTRACT_VERSION),
  ...ScopeShape,
  readAt: Timestamp,
  // Without e-mail or phone. A contact anonymized in the CRM is refused, never read.
  contact: z.object({
    id: Id,
    label: text(400),
    status: z.enum(["lead", "prospect", "customer", "churned"]),
    doNotContact: z.boolean(),
  }).strict().nullable(),
  company: z.object({ id: Id, label: text(400) }).strict().nullable(),
  deal: z.object({
    id: Id,
    label: text(400),
    status: CrmDealStatusSchema,
    stage: CrmStageSchema,
    stageEnteredAt: Timestamp,
    closedAt: Timestamp.nullable(),
    lostReason: text(1_000).nullable(),
  }).strict().superRefine((deal, context) => {
    if ((deal.status === "open") !== (deal.closedAt === null)) {
      context.addIssue({
        code: "custom",
        path: ["closedAt"],
        message: "Só a oportunidade ganha ou perdida tem data de fechamento.",
      });
    }
    if (deal.status !== "lost" && deal.lostReason !== null) {
      context.addIssue({
        code: "custom",
        path: ["lostReason"],
        message: "O motivo de perda só acompanha a oportunidade perdida.",
      });
    }
  }).nullable(),
  // Pending actions (everything but notes) of these records, by due date: the commitments in the CRM.
  commitments: z.array(
    z.object({
      id: Id,
      type: CrmActivityTypeSchema.exclude(["note"]),
      title: text(400),
      dueAt: Timestamp.nullable(),
      assignee: z.object({ id: Id, label: text(400) }).strict().nullable(),
    }).strict(),
  ).max(CRM_CONTEXT_MAX_COMMITMENTS),
  // Notes and completed actions, the latest first, with an excerpt of the details. The notes of the Fecha IA
  // reviews are not repeated here: they are the receipts below.
  recentActivities: z.array(
    z.object({
      id: Id,
      type: CrmActivityTypeSchema,
      title: text(400),
      occurredAt: Timestamp,
      excerpt: text(CRM_CONTEXT_EXCERPT_LENGTH).nullable(),
    }).strict(),
  ).max(CRM_CONTEXT_MAX_ACTIVITIES),
  // The reviews this Fecha IA team already delivered to these records, the latest first.
  reviews: z.array(
    z.object({
      deliveryId: Id,
      callId: Id,
      sourceReviewRevision: Revision,
      persistedAt: Timestamp,
    }).strict(),
  ).max(CRM_CONTEXT_MAX_REVIEWS),
}).strict().superRefine((value, context) => {
  if (!value.contact && !value.company && !value.deal) {
    context.addIssue({
      code: "custom",
      path: ["contact"],
      message: "O contexto precisa de ao menos um registro.",
    });
  }
  if (
    !uniqueBy(value.commitments, (item) => item.id) ||
    !uniqueBy(value.recentActivities, (item) => item.id) ||
    !uniqueBy(value.reviews, (item) => item.deliveryId)
  ) {
    context.addIssue({
      code: "custom",
      path: ["commitments"],
      message: "Não repita atividades nem revisões.",
    });
  }
});
export type CrmContextResponse = z.infer<typeof CrmContextResponseSchema>;
export function assertCrmContextMatchesRequest(
  input: unknown,
  request: CrmContextRequest,
): CrmContextResponse {
  const value = CrmContextResponseSchema.parse(input);
  const asked = CrmContextRequestSchema.parse(request);
  if (
    value.connectionId !== asked.connectionId ||
    value.sourceOrganizationId !== asked.sourceOrganizationId ||
    value.destinationOrganizationId !== asked.destinationOrganizationId
  ) throw new Error("O contexto pertence a outra conexão.");
  if (
    (value.contact?.id ?? null) !== asked.target.contactId ||
    (value.company?.id ?? null) !== asked.target.companyId ||
    (value.deal?.id ?? null) !== asked.target.dealId
  ) throw new Error("O contexto não corresponde aos registros pedidos.");
  return value;
}
export const CrmOutcomesRequestSchema = z.object({
  operation: z.literal("outcomes"),
  ...ReaderShape,
  dealIds: z.array(Id).min(1).max(CRM_OUTCOMES_MAX_DEALS).refine(
    (ids) => new Set(ids).size === ids.length,
    "Não repita oportunidades.",
  ),
}).strict();
export type CrmOutcomesRequest = z.infer<typeof CrmOutcomesRequestSchema>;
// Without the deal title, value or lost reason: the status, the stage, when it closed and the first payment received.
export const CrmDealOutcomeSchema = z.object({
  dealId: Id,
  status: CrmDealStatusSchema,
  stage: CrmStageSchema,
  closedAt: Timestamp.nullable(),
  firstPaidAt: Timestamp.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.status === "open") !== (value.closedAt === null)) {
    context.addIssue({
      code: "custom",
      path: ["closedAt"],
      message: "Só a oportunidade ganha ou perdida tem data de fechamento.",
    });
  }
});
export type CrmDealOutcome = z.infer<typeof CrmDealOutcomeSchema>;
export const CrmOutcomesResponseSchema = z.object({
  schemaVersion: z.literal(CRM_CONTRACT_VERSION),
  ...ScopeShape,
  readAt: Timestamp,
  outcomes: z.array(CrmDealOutcomeSchema).max(CRM_OUTCOMES_MAX_DEALS),
  // Asked deals the CRM organization does not have (deleted, or never there).
  missingDealIds: z.array(Id).max(CRM_OUTCOMES_MAX_DEALS),
}).strict().superRefine((value, context) => {
  if (
    !uniqueBy(
      [...value.outcomes.map((item) => item.dealId), ...value.missingDealIds],
      (id) => id,
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["outcomes"],
      message: "Cada oportunidade aparece uma única vez.",
    });
  }
});
export type CrmOutcomesResponse = z.infer<typeof CrmOutcomesResponseSchema>;
export function assertCrmOutcomesMatchRequest(
  input: unknown,
  request: CrmOutcomesRequest,
): CrmOutcomesResponse {
  const value = CrmOutcomesResponseSchema.parse(input);
  const asked = CrmOutcomesRequestSchema.parse(request);
  if (
    value.connectionId !== asked.connectionId ||
    value.sourceOrganizationId !== asked.sourceOrganizationId ||
    value.destinationOrganizationId !== asked.destinationOrganizationId
  ) throw new Error("Os resultados pertencem a outra conexão.");
  const answered = [
    ...value.outcomes.map((item) => item.dealId),
    ...value.missingDealIds,
  ].sort();
  const expected = [...asked.dealIds].sort();
  if (
    answered.length !== expected.length ||
    answered.some((id, index) => id !== expected[index])
  ) throw new Error("Os resultados não correspondem às oportunidades pedidas.");
  return value;
}
export const CrmIntegrationRequestSchema = z.union([
  CrmDescribeRequestSchema,
  CrmLookupRequestSchema,
  CrmValidateRequestSchema,
  CrmDeliverRequestSchema,
  CrmReceiptRequestSchema,
  CrmContextRequestSchema,
  CrmOutcomesRequestSchema,
]);
export type CrmIntegrationRequest = z.infer<typeof CrmIntegrationRequestSchema>;
