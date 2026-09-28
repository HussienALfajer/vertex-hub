import { z } from 'zod';
import { permissionSchema } from './permissions.js';
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
    roles: z.array(roleSchema),
    permissions: z.array(permissionSchema),
  })
  .meta({ id: 'MeResponse', description: 'The signed-in user with their roles and permissions' });

export type MeResponse = z.infer<typeof meResponseSchema>;
