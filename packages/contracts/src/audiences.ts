import { z } from 'zod';
import { departmentCodeSchema } from './departments.js';
import { roleSchema } from './roles.js';

/*
 * Audiences (spec F16 part D, ADR 0038): who a message reaches, as a union of sources minus
 * excluded people. Announcements use them first; the board, chat and portal reuse them.
 */

/** Each list of an audience holds at most this many entries. */
export const AUDIENCE_LIST_MAX = 200;

/** The names a preview returns at most (rule D2). */
export const AUDIENCE_PREVIEW_MAX = 500;

const ids = z.array(z.uuid()).max(AUDIENCE_LIST_MAX);

/**
 * Rule D1: everyone, the members of departments, the holders of roles (`department_manager`: the
 * managers of any department), people, and the teams of projects and clients, minus `exclude`.
 * Repeated entries are harmless: the resolver keeps each person once.
 */
export const audienceSchema = z
  .object({
    everyone: z.literal(true).optional(),
    departments: z.array(departmentCodeSchema).max(AUDIENCE_LIST_MAX).optional(),
    roles: z.array(roleSchema).max(AUDIENCE_LIST_MAX).optional(),
    users: ids.optional(),
    projects: ids.optional(),
    clients: ids.optional(),
    exclude: ids.optional(),
  })
  .refine(
    (audience) =>
      audience.everyone === true ||
      [
        audience.departments,
        audience.roles,
        audience.users,
        audience.projects,
        audience.clients,
      ].some((list) => (list?.length ?? 0) > 0),
    { message: 'An audience needs at least one source' },
  )
  .meta({ id: 'Audience' });

export type Audience = z.infer<typeof audienceSchema>;

/** What an audience picker holds before validation. */
export type AudienceInput = z.input<typeof audienceSchema>;

/** A person an audience resolves to, as the picker lists them. */
export const audienceMemberSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    image: z.string().nullable(),
    /** The primary department; null for an account without one. */
    department: departmentCodeSchema.nullable(),
  })
  .meta({ id: 'AudienceMember' });

export type AudienceMember = z.infer<typeof audienceMemberSchema>;

/** Rule D2: the live count and the first names, by name. */
export const audiencePreviewSchema = z
  .object({
    count: z.number().int().min(0),
    users: z.array(audienceMemberSchema).max(AUDIENCE_PREVIEW_MAX),
  })
  .meta({ id: 'AudiencePreview' });

export type AudiencePreview = z.infer<typeof audiencePreviewSchema>;
