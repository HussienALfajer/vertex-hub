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
