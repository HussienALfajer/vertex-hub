import { z } from 'zod';
import { newPasswordSchema } from './auth.js';
import { userDepartmentSchema } from './departments.js';
import { pageQuerySchema, pageSchema } from './lists.js';
import { assignableRoleSchema, roleSchema } from './roles.js';
import { optionalText, uniqueTexts } from './text.js';

/** Derived, never stored: archived, else invited until a password is set, else active. */
export const USER_STATUSES = ['invited', 'active', 'archived'] as const;

export const userStatusSchema = z.enum(USER_STATUSES).meta({ id: 'UserStatus' });

export type UserStatus = z.infer<typeof userStatusSchema>;

/**
 * A phone number stored as `+` and 8–15 digits. Spaces, dashes, dots and parentheses are
 * ignored, and a leading `00` means `+`. Blank input is stored as null.
 */
export const phoneSchema = z
  .string()
  .nullable()
  .transform((value) => {
    const compact = (value ?? '').replace(/[\s\-.()]/g, '');
    return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  })
  .pipe(z.union([z.literal('').transform(() => null), z.string().regex(/^\+\d{8,15}$/)]));

export const skillSchema = z.string().trim().min(1).max(40);

/** Skills, stored once per user regardless of case (the first spelling wins). */
export const skillsSchema = uniqueTexts(skillSchema, 20);

const rolesSchema = z.array(assignableRoleSchema).transform((roles) => [...new Set(roles)]);

const userFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().toLowerCase(),
  primaryDepartmentId: z.uuid(),
  secondaryDepartmentIds: z.array(z.uuid()).transform((ids) => [...new Set(ids)]),
  title: optionalText(80),
  phone: phoneSchema,
  skills: skillsSchema,
  /** Assigned roles only; Employee and Department Manager are derived (ADR 0014). */
  roles: rolesSchema,
});

const secondaryIsNotPrimary = (user: {
  primaryDepartmentId?: string;
  secondaryDepartmentIds?: string[];
}) => !user.primaryDepartmentId || !user.secondaryDepartmentIds?.includes(user.primaryDepartmentId);

const secondaryIsNotPrimaryIssue = {
  message: 'A secondary department cannot be the primary one',
  path: ['secondaryDepartmentIds'],
};

export const createUserSchema = userFieldsSchema
  .partial({ secondaryDepartmentIds: true, title: true, phone: true, skills: true, roles: true })
  .refine(secondaryIsNotPrimary, secondaryIsNotPrimaryIssue)
  .meta({ id: 'CreateUser' });

export type CreateUser = z.infer<typeof createUserSchema>;

/** What a create or edit form holds before validation. */
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = userFieldsSchema
  .partial()
  .refine(secondaryIsNotPrimary, secondaryIsNotPrimaryIssue)
  .meta({ id: 'UpdateUser' });

export type UpdateUser = z.infer<typeof updateUserSchema>;

/** What every user edits on their own account (F01 rule 19). */
export const updateOwnProfileSchema = userFieldsSchema
  .pick({ phone: true, skills: true })
  .partial()
  .meta({ id: 'UpdateOwnProfile' });

export type UpdateOwnProfile = z.infer<typeof updateOwnProfileSchema>;

export type UpdateOwnProfileInput = z.input<typeof updateOwnProfileSchema>;

/**
 * A user as the team directory shows them. `status`, `roles` and `twoFactorEnabled` are present
 * only for callers with `users.manage`; so is the email of an archived user.
 */
export const userResponseSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.email().nullable(),
    title: z.string().nullable(),
    phone: z.string().nullable(),
    skills: z.array(z.string()),
    /** Primary first. Empty only for accounts created before F01. */
    departments: z.array(userDepartmentSchema),
    status: userStatusSchema.optional(),
    roles: z.array(assignableRoleSchema).optional(),
    twoFactorEnabled: z.boolean().optional(),
  })
  .meta({ id: 'User' });

export type UserResponse = z.infer<typeof userResponseSchema>;

export const userListQuerySchema = pageQuerySchema.extend({
  /** Matches name or email. */
  search: z.string().trim().min(1).max(100).optional(),
  departmentId: z.uuid().optional(),
  /** Effective role, so `department_manager` finds managers. */
  role: roleSchema.optional(),
  skill: skillSchema.optional(),
  /** Anything but `active` needs `users.manage`. */
  status: userStatusSchema.default('active'),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const userPageSchema = pageSchema(userResponseSchema).meta({
  id: 'UserPage',
  description: 'Users sorted by name',
});

export type UserPage = z.infer<typeof userPageSchema>;

export const skillListResponseSchema = z
  .object({ items: z.array(z.string()) })
  .meta({ id: 'SkillList', description: 'Skills of users who are not archived, sorted' });

export type SkillListResponse = z.infer<typeof skillListResponseSchema>;

/** A one-time link that sets the user's password (F01 rules 13–14). */
export const userLinkSchema = z
  .object({
    url: z.url(),
    expiresAt: z.iso.datetime(),
    /** `activation` for an invited user, `reset` for an active one. */
    kind: z.enum(['activation', 'reset']),
  })
  .meta({ id: 'UserLink' });

export type UserLink = z.infer<typeof userLinkSchema>;

export const userWithLinkResponseSchema = z
  .object({ user: userResponseSchema, link: userLinkSchema })
  .meta({ id: 'UserWithLink' });

export type UserWithLinkResponse = z.infer<typeof userWithLinkResponseSchema>;

export const redeemLinkSchema = z
  .object({ token: z.string().min(1).max(200), password: newPasswordSchema })
  .meta({ id: 'RedeemLink' });

export type RedeemLink = z.infer<typeof redeemLinkSchema>;

/** F14 email rule 13, "forgot password": the address is trimmed and compared case-insensitively. */
export const requestPasswordLinkSchema = z
  .object({ email: z.string().trim().max(254).pipe(z.email()) })
  .meta({ id: 'RequestPasswordLink' });

export type RequestPasswordLink = z.infer<typeof requestPasswordLinkSchema>;
