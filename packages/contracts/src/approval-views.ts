import { z } from 'zod';
import { approvalRequestPageSchema } from './approvals.js';
import { pageSchema } from './lists.js';
import { taskClientResponseSchema, taskSchema } from './tasks.js';

/*
 * The views of the `approvals` module that show tasks (spec F09): the tasks ready to send and a
 * client's approval history. Kept apart from `approvals.ts`, which `tasks.ts` imports.
 */

export const approvalReadyQuerySchema = z.object({ clientId: z.uuid().optional() });

export type ApprovalReadyQuery = z.infer<typeof approvalReadyQuerySchema>;

/** A task ready to send (rule 8), with what its cleared review would send. */
export const readyTaskSchema = taskSchema
  .extend({ snapshot: z.object({ files: z.number().int().min(0), hasText: z.boolean() }) })
  .meta({ id: 'ReadyTask' });

export type ReadyTask = z.infer<typeof readyTaskSchema>;

export const readyClientSchema = z
  .object({
    client: z.object({ id: z.uuid(), name: z.string() }),
    isHealthcare: z.boolean(),
    /** Non-archived contacts with final-approval authority; none means nothing can be sent. */
    contacts: z.array(z.object({ id: z.uuid(), name: z.string(), phone: z.string().nullable() })),
    /** By due date. */
    tasks: z.array(readyTaskSchema),
  })
  .meta({ id: 'ReadyClient' });

export type ReadyClient = z.infer<typeof readyClientSchema>;

export const approvalReadySchema = z
  .object({ clients: z.array(readyClientSchema) })
  .meta({ id: 'ApprovalReady', description: 'Tasks ready to send, grouped by client, by name' });

export type ApprovalReady = z.infer<typeof approvalReadySchema>;

/** A client response with the task it answered, for the client's history. */
export const clientResponseEntrySchema = taskClientResponseSchema
  .extend({ task: z.object({ id: z.uuid(), title: z.string() }) })
  .meta({ id: 'ClientResponseEntry' });

export type ClientResponseEntry = z.infer<typeof clientResponseEntrySchema>;

export const clientResponsePageSchema = pageSchema(clientResponseEntrySchema).meta({
  id: 'ClientResponsePage',
  description: 'Client responses, newest first',
});

export type ClientResponsePage = z.infer<typeof clientResponsePageSchema>;

/** Both lists take the page of the query. */
export const clientApprovalsSchema = z
  .object({ requests: approvalRequestPageSchema, responses: clientResponsePageSchema })
  .meta({ id: 'ClientApprovals' });

export type ClientApprovals = z.infer<typeof clientApprovalsSchema>;
