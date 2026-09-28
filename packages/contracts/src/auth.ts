import { z } from 'zod';
import { departmentCodeSchema } from './departments.js';
import { grantedPermissionSchema } from './permissions.js';
import { roleSchema } from './roles.js';

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
    departments: z.array(
      z.object({
        id: z.uuid(),
        code: departmentCodeSchema,
        name: z.string(),
        isPrimary: z.boolean(),
        isManager: z.boolean(),
      }),
    ),
    permissions: z.array(grantedPermissionSchema),
    twoFactor: z.object({ enabled: z.boolean(), required: z.boolean() }),
  })
  .meta({
    id: 'MeResponse',
    description: 'The signed-in user with their roles, departments and permissions',
  });

export type MeResponse = z.infer<typeof meResponseSchema>;
