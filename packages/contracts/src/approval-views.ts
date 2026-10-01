import { z } from 'zod';
import { approvalItemKindSchema, approvalRequestPageSchema } from './approvals.js';
import { postSchema } from './content.js';
import { fileMonthSchema } from './files.js';
import { pageSchema } from './lists.js';
import { taskClientResponseSchema, taskSchema } from './tasks.js';

/*
 * The views of the `approvals` module that show tasks and posts (spec F09, F08): what is ready to
 * send and a client's approval history. Kept apart from `approvals.ts`, which `tasks.ts` imports.
 */

export const approvalReadyQuerySchema = z.object({
  clientId: z.uuid().optional(),
  /** Posts published in this month only, `YYYY-MM`, for "Send month for approval" (F08). */
  month: fileMonthSchema.optional(),
});

export type ApprovalReadyQuery = z.infer<typeof approvalReadyQuerySchema>;

/** A task ready to send (rule 8), with what its cleared review would send. */
export const readyTaskSchema = taskSchema
  .extend({ snapshot: z.object({ files: z.number().int().min(0), hasText: z.boolean() }) })
  .meta({ id: 'ReadyTask' });

export type ReadyTask = z.infer<typeof readyTaskSchema>;

/** A post ready to send (F08 rule 20), with what its cleared review would send. */
export const readyPostSchema = postSchema
  .extend({
    snapshot: z.object({
      files: z.number().int().min(0),
      caption: z.string().nullable(),
      /** The first media version of the snapshot with a preview. */
      thumbnailVersionId: z.uuid().nullable(),
    }),
  })
  .meta({ id: 'ReadyPost' });

export type ReadyPost = z.infer<typeof readyPostSchema>;

export const readyClientSchema = z
  .object({
    client: z.object({ id: z.uuid(), name: z.string() }),
    isHealthcare: z.boolean(),
    /** Non-archived contacts with final-approval authority; none means nothing can be sent. */
    contacts: z.array(z.object({ id: z.uuid(), name: z.string(), phone: z.string().nullable() })),
    /** By due date. */
    tasks: z.array(readyTaskSchema),
    /** In publish order. */
    posts: z.array(readyPostSchema),
  })
  .meta({ id: 'ReadyClient' });

export type ReadyClient = z.infer<typeof readyClientSchema>;

export const approvalReadySchema = z.object({ clients: z.array(readyClientSchema) }).meta({
  id: 'ApprovalReady',
  description: 'Tasks and posts ready to send, grouped by client, by name',
});

export type ApprovalReady = z.infer<typeof approvalReadySchema>;

/** A client response with the task or the post it answered, for the client's history. */
export const clientResponseEntrySchema = taskClientResponseSchema
  .extend({
    kind: approvalItemKindSchema,
    task: z.object({ id: z.uuid(), title: z.string() }).nullable(),
    post: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  })
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
