import { z } from "zod";
import { CrmActorChoiceSchema, CrmReadScopeSchema } from "./crm-contract.ts";
const Id = z.string().uuid();
const scope = { organizationId: Id };
const ids = z.array(Id).min(1).max(500).refine(
  (values) => new Set(values).size === values.length,
  "Não repita atores.",
);
// Reads the Fecha IA may do on the connection (B20). Empty means none: the connection only receives reviews.
const scopes = (min: number) =>
  z.array(CrmReadScopeSchema).min(min).max(2).refine(
    (values) => new Set(values).size === values.length,
    "Não repita leituras.",
  );
const readScopes = scopes(0);
export const FechaConnectionSummarySchema = z.object({
  id: Id,
  name: z.string().min(1).max(200),
  sourceOrganizationId: Id,
  destinationOrganizationId: Id,
  allowedActorIds: ids,
  expiresAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  createdBy: Id,
  revokedAt: z.string().datetime({ offset: true }).nullable(),
  // Present only with at least one read: a connection without reads keeps the summary of before them.
  readScopes: scopes(1).optional(),
}).strict();
export type FechaConnectionSummary = z.infer<
  typeof FechaConnectionSummarySchema
>;
export const FechaConnectionManagementRequestSchema = z.discriminatedUnion(
  "operation",
  [
    z.object({ operation: z.literal("list"), ...scope }).strict(),
    z.object({ operation: z.literal("actor_options"), ...scope }).strict(),
    z.object({
      operation: z.literal("create"),
      ...scope,
      name: z.string().trim().min(1).max(200),
      sourceOrganizationId: Id,
      allowedActorIds: ids,
      expiresAt: z.string().datetime({ offset: true }),
      readScopes: readScopes.optional(),
    }).strict(),
    z.object({ operation: z.literal("revoke"), ...scope, connectionId: Id })
      .strict(),
    z.object({
      operation: z.literal("set_actors"),
      ...scope,
      connectionId: Id,
      allowedActorIds: ids,
    }).strict(),
    z.object({
      operation: z.literal("set_read_scopes"),
      ...scope,
      connectionId: Id,
      readScopes,
    }).strict(),
  ],
);
export type FechaConnectionManagementRequest = z.infer<
  typeof FechaConnectionManagementRequestSchema
>;
export const FechaConnectionListSchema = z.object({
  connections: z.array(FechaConnectionSummarySchema),
}).strict();
export const FechaConnectionResultSchema = z.object({
  connection: FechaConnectionSummarySchema,
}).strict();
export const FechaActorOptionsSchema = z.object({
  organizationId: Id,
  actors: z.array(CrmActorChoiceSchema),
}).strict().superRefine((value, context) => {
  if (
    value.actors.some((actor) => actor.organizationId !== value.organizationId)
  ) {
    context.addIssue({
      code: "custom",
      path: ["actors"],
      message: "Atores de outra organização.",
    });
  }
});
