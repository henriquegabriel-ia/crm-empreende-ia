import type { CrmReviewContent } from "./crm-contract.ts";

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
  "ddfcb493e6cec6d7ed1ba5c5631d4b28c51970bf32b6177ae314d51cf41bbab1";
