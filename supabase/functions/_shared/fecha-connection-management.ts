import { z } from "zod";
import { CrmActorChoiceSchema } from "./crm-contract.ts";
const Id = z.string().uuid();
const scope = { organizationId: Id };
const ids = z.array(Id).min(1).max(500).refine(
  (values) => new Set(values).size === values.length,
  "Não repita atores.",
);
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
    }).strict(),
    z.object({ operation: z.literal("revoke"), ...scope, connectionId: Id })
      .strict(),
    z.object({
      operation: z.literal("set_actors"),
      ...scope,
      connectionId: Id,
      allowedActorIds: ids,
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
