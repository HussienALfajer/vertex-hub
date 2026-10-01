import { z } from 'zod';
import type { ClientPlatform } from './clients.js';

/*
 * The fixed value lists of a post (spec F08). Kept apart from `content.ts`, which imports
 * `approvals.ts`: approval items show the type and the platforms of a post snapshot.
 */

export const POST_TYPES = ['post', 'reel', 'story', 'carousel'] as const;

export const postTypeSchema = z.enum(POST_TYPES).meta({ id: 'PostType' });

export type PostType = z.infer<typeof postTypeSchema>;

/** The platforms a post is published on: the client platforms without `website` and `other`. */
export const POST_PLATFORMS = [
  'instagram',
  'facebook',
  'tiktok',
  'x',
  'linkedin',
  'youtube',
  'snapchat',
  'google_business',
] as const satisfies readonly ClientPlatform[];

export const postPlatformSchema = z.enum(POST_PLATFORMS).meta({ id: 'PostPlatform' });

export type PostPlatform = z.infer<typeof postPlatformSchema>;
