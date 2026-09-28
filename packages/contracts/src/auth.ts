import { z } from 'zod';
import { userDepartmentSchema } from './departments.js';
import { grantedPermissionSchema } from './permissions.js';
import { roleSchema } from './roles.js';

/** Minimum length for new passwords (NIST SP 800-63B favours length over composition rules). */
export const MIN_PASSWORD_LENGTH = 12;

/** A new password; Better Auth caps passwords at 128 characters. */
export const newPasswordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(128);

/** Setting a password through an activation or reset link: typed twice. */
export const setPasswordFormSchema = z
  .object({ password: newPasswordSchema, confirm: z.string() })
  .refine((form) => form.password === form.confirm, { path: ['confirm'] });

export type SetPasswordForm = z.infer<typeof setPasswordFormSchema>;

/** Changing one's own password (Better Auth change-password). */
export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((form) => form.newPassword === form.confirm, { path: ['confirm'] });

export type ChangePasswordForm = z.infer<typeof changePasswordFormSchema>;

/** A one-time code from an authenticator app, or a backup code. */
export const totpCodeSchema = z.string().regex(/^\d{6}$/);
export const backupCodeSchema = z.string().trim().min(1).max(64);

/** Sign-in form. Password rules are enforced where passwords are set, not at sign-in. */
export const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type SignIn = z.infer<typeof signInSchema>;

export const meResponseSchema = z
  .object({
    user: z.object({
      id: z.uuid(),
      name: z.string(),
      email: z.email(),
      image: z.string().nullable(),
    }),
    /** Effective roles: assigned and derived (ADR 0014). */
    roles: z.array(roleSchema),
    departments: z.array(userDepartmentSchema),
    permissions: z.array(grantedPermissionSchema),
    twoFactor: z.object({ enabled: z.boolean(), required: z.boolean() }),
  })
  .meta({
    id: 'MeResponse',
    description: 'The signed-in user with their roles, departments and permissions',
  });

export type MeResponse = z.infer<typeof meResponseSchema>;
