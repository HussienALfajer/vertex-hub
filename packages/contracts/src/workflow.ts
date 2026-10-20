import { z } from 'zod';

/** Unified work statuses (v1-scope F06), in workflow order. */
export const WORKFLOW_STATUSES = [
  'new',
  'in_progress',
  'internal_review',
  'awaiting_client',
  'revisions',
  'approved',
  'delivered',
] as const;

export const workflowStatusSchema = z.enum(WORKFLOW_STATUSES).meta({ id: 'WorkflowStatus' });

export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

/** A task's statuses: the unified workflow plus `cancelled`. */
export const TASK_STATUSES = [...WORKFLOW_STATUSES, 'cancelled'] as const;

export const taskStatusSchema = z.enum(TASK_STATUSES).meta({ id: 'TaskStatus' });

export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** How an over-limit client revision is decided (F06 rule 12). */
export const REVISION_DECISIONS = ['free', 'extra_work'] as const;

export const revisionDecisionSchema = z.enum(REVISION_DECISIONS).meta({ id: 'RevisionDecision' });

export type RevisionDecision = z.infer<typeof revisionDecisionSchema>;
