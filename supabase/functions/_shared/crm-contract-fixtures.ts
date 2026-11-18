import type {
  CrmContextRequest,
  CrmContextResponse,
  CrmOutcomesRequest,
  CrmOutcomesResponse,
  CrmReviewContent,
} from "./crm-contract.ts";

/** Synthetic, portable conformance vector. Never contains a credential or a real customer. */
export const CRM_FIXTURE_SCOPE = {
  connectionId: "01000000-0000-4000-8000-000000000001",
  sourceOrganizationId: "10000000-0000-4000-8000-000000000001",
  destinationOrganizationId: "10000000-0000-4000-8000-000000000002",
} as const;
export const CRM_FIXTURE_CONTENT: CrmReviewContent = {
  schemaVersion: 1,
  source: "fecha-ai",
  destination: "crm-empreende-ia",
  ...CRM_FIXTURE_SCOPE,
  callId: "30000000-0000-4000-8000-000000000001",
  reviewRevision: 7,
  sourceOwnerId: "20000000-0000-4000-8000-000000000001",
  reviewedBySourceUserId: "20000000-0000-4000-8000-000000000001",
  destinationActorId: "20000000-0000-4000-8000-000000000002",
  reviewedAt: "2026-09-06T15:00:00.000Z",
  operation: "create_note",
  previousReceipt: null,
  target: {
    contactId: "40000000-0000-4000-8000-000000000001",
    companyId: null,
    dealId: null,
  },
  reviewNote: {
    summary: "João decidiu avançar. Pagamento ainda pendente.",
    method: { id: "empreende-ia-commercial", version: "1.0.0" },
    offer: null,
    commercialResult: "won",
    paymentStatus: "pending",
    evidenceReferences: [{
      segmentId: "50000000-0000-4000-8000-000000000001:turn:3",
      revision: 1,
    }],
    objections: {
      reviewText:
        "Achou o investimento alto; a condição aprovada resolveu. Falta a conversa com o sócio.",
      items: [
        { type: "price", status: "resolved" },
        { type: "partner", status: "next_meeting" },
      ],
    },
  },
  nextStep: {
    description: "Conferir os dados de contratação",
    assigneeId: "20000000-0000-4000-8000-000000000003",
    dueAt: "2026-09-07T18:00:00-03:00",
  },
};
export const CRM_FIXTURE_KEY =
  "fecha-ai:v1:01000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000001:review:7";
export const CRM_FIXTURE_HASH =
  "52db181d17221baef53b90554da3e168a1dddb33a997630b7342ca92778d52ec";
/** The same content without reviewNote.objections, as sealed before the field existed: v1 keeps this hash. */
export const CRM_FIXTURE_HASH_WITHOUT_OBJECTIONS =
  "ddfcb493e6cec6d7ed1ba5c5631d4b28c51970bf32b6177ae314d51cf41bbab1";

/**
 * Reads (B20): the CRM test inserts exactly these synthetic records and compares its real answer with the responses
 * below (apart from the connection it creates and readAt), and the Fecha IA tests answer with them. The note carries
 * an e-mail and a phone, and a title carries a phone: the CRM replaces them, so they never appear here.
 */
export const CRM_FIXTURE_READER = {
  sourceUserId: "20000000-0000-4000-8000-000000000001",
  destinationActorId: "20000000-0000-4000-8000-000000000002",
} as const;
export const CRM_FIXTURE_CONTEXT_REQUEST: CrmContextRequest = {
  operation: "context",
  ...CRM_FIXTURE_SCOPE,
  ...CRM_FIXTURE_READER,
  target: {
    contactId: "40000000-0000-4000-8000-000000000020",
    companyId: "41000000-0000-4000-8000-000000000020",
    dealId: "42000000-0000-4000-8000-000000000020",
  },
};
export const CRM_FIXTURE_CONTEXT_RESPONSE: CrmContextResponse = {
  schemaVersion: 1,
  ...CRM_FIXTURE_SCOPE,
  readAt: "2026-09-06T15:05:00.000Z",
  contact: {
    id: "40000000-0000-4000-8000-000000000020",
    label: "Marina Costa",
    status: "prospect",
    doNotContact: false,
  },
  company: {
    id: "41000000-0000-4000-8000-000000000020",
    label: "Oficina Norte",
  },
  deal: {
    id: "42000000-0000-4000-8000-000000000020",
    label: "Implantação · Oficina Norte",
    status: "open",
    stage: { label: "Proposta", position: 3, count: 4 },
    stageEnteredAt: "2026-09-01T12:00:00.000Z",
    closedAt: null,
    lostReason: null,
  },
  commitments: [
    {
      id: "43000000-0000-4000-8000-000000000021",
      type: "task",
      title: "Ligar para [telefone omitido] depois das 14h",
      dueAt: "2026-09-10T12:00:00.000Z",
      assignee: {
        id: "20000000-0000-4000-8000-000000000002",
        label: "Gestora",
      },
    },
    {
      id: "43000000-0000-4000-8000-000000000022",
      type: "meeting",
      title: "Reunião de fechamento",
      dueAt: "2026-09-12T15:00:00.000Z",
      assignee: {
        id: "20000000-0000-4000-8000-000000000003",
        label: "Pessoa comercial",
      },
    },
    {
      id: "43000000-0000-4000-8000-000000000023",
      type: "task",
      title: "Confirmar a conversa com o sócio",
      dueAt: null,
      assignee: null,
    },
  ],
  recentActivities: [
    {
      id: "43000000-0000-4000-8000-000000000024",
      type: "note",
      title: "Diagnóstico com a Marina",
      occurredAt: "2026-09-04T16:00:00.000Z",
      excerpt:
        "Contou que o time perde 2 h por dia com planilhas. E-mail: [e-mail omitido], celular [telefone omitido].",
    },
    {
      id: "43000000-0000-4000-8000-000000000025",
      type: "call",
      title: "Primeiro contato",
      occurredAt: "2026-09-02T14:00:00.000Z",
      excerpt: null,
    },
    {
      id: "43000000-0000-4000-8000-000000000026",
      type: "note",
      title: "Histórico importado",
      occurredAt: "2026-08-20T10:00:00.000Z",
      excerpt: "x".repeat(500),
    },
  ],
  reviews: [{
    deliveryId: "44000000-0000-4000-8000-000000000020",
    callId: "30000000-0000-4000-8000-000000000030",
    sourceReviewRevision: 3,
    persistedAt: "2026-09-05T18:00:00.000Z",
  }],
};
export const CRM_FIXTURE_OUTCOMES_REQUEST: CrmOutcomesRequest = {
  operation: "outcomes",
  ...CRM_FIXTURE_SCOPE,
  ...CRM_FIXTURE_READER,
  dealIds: [
    "42000000-0000-4000-8000-000000000020",
    "42000000-0000-4000-8000-000000000021",
    "42000000-0000-4000-8000-000000000022",
    "42000000-0000-4000-8000-00000000002f",
  ],
};
export const CRM_FIXTURE_OUTCOMES_RESPONSE: CrmOutcomesResponse = {
  schemaVersion: 1,
  ...CRM_FIXTURE_SCOPE,
  readAt: "2026-09-16T12:00:00.000Z",
  outcomes: [
    {
      dealId: "42000000-0000-4000-8000-000000000020",
      status: "open",
      stage: { label: "Proposta", position: 3, count: 4 },
      closedAt: null,
      firstPaidAt: "2026-09-06T09:00:00.000Z",
    },
    {
      dealId: "42000000-0000-4000-8000-000000000021",
      status: "won",
      stage: { label: "Fechamento", position: 4, count: 4 },
      closedAt: "2026-09-08T12:00:00.000Z",
      firstPaidAt: "2026-09-09T10:00:00.000Z",
    },
    {
      dealId: "42000000-0000-4000-8000-000000000022",
      status: "lost",
      stage: { label: "Diagnóstico", position: 2, count: 4 },
      closedAt: "2026-09-07T12:00:00.000Z",
      firstPaidAt: null,
    },
  ],
  missingDealIds: ["42000000-0000-4000-8000-00000000002f"],
};
