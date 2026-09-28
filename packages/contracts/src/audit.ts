import { z } from 'zod';
import { pageQuerySchema, pageSchema } from './lists.js';

/** Every audited change, as `<entity>.<verb>`. Features add theirs with their spec. */
export const AUDIT_ACTIONS = [
  'user.created',
  'user.updated',
  'user.roles_changed',
  'user.departments_changed',
  'user.archived',
  'user.restored',
  'user.link_issued',
  'user.password_set',
  'user.password_changed',
  'user.two_factor_enabled',
  'user.two_factor_disabled',
  'user.two_factor_reset',
  'user.profile_updated',
  'department.updated',
  'client.created',
  'client.updated',
  'client.status_changed',
  'client.account_manager_changed',
  'client.healthcare_changed',
  'client.archived',
  'client.restored',
  'client.brand_kit_updated',
  'client_contact.created',
  'client_contact.updated',
  'client_contact.archived',
  'client_platform_account.created',
  'client_platform_account.updated',
  'client_platform_account.archived',
  'client_note.created',
  'client_note.updated',
  'client_note.archived',
] as const;

export const auditActionSchema = z.enum(AUDIT_ACTIONS).meta({ id: 'AuditAction' });

export type AuditAction = z.infer<typeof auditActionSchema>;

export const AUDIT_ENTITY_TYPES = [
  'user',
  'department',
  'client',
  'client_contact',
  'client_platform_account',
  'client_note',
] as const;

export const auditEntityTypeSchema = z.enum(AUDIT_ENTITY_TYPES).meta({ id: 'AuditEntityType' });

export type AuditEntityType = z.infer<typeof auditEntityTypeSchema>;

/** The changed fields of a record, before or after a change. */
const changedFieldsSchema = z.record(z.string(), z.unknown()).nullable();

export const auditEntrySchema = z
  .object({
    id: z.uuid(),
    occurredAt: z.iso.datetime(),
    actorId: z.uuid().nullable(),
    actorName: z.string().nullable(),
    action: auditActionSchema,
    entityType: auditEntityTypeSchema,
    entityId: z.uuid(),
    before: changedFieldsSchema,
    after: changedFieldsSchema,
  })
  .meta({ id: 'AuditEntry', description: 'One audited change; a null actor is the system' });

export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditListQuerySchema = pageQuerySchema.extend({
  entityType: auditEntityTypeSchema.optional(),
  entityId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  action: auditActionSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const auditPageSchema = pageSchema(auditEntrySchema).meta({
  id: 'AuditPage',
  description: 'Audit entries, newest first',
});

export type AuditPage = z.infer<typeof auditPageSchema>;
