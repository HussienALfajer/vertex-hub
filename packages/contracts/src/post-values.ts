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

export const POST_STATUSES = [
  'idea',
  'in_production',
  'internal_review',
  'awaiting_client',
  'approved',
  'scheduled',
  'published',
  'cancelled',
] as const;

export const postStatusSchema = z.enum(POST_STATUSES).meta({ id: 'PostStatus' });

export type PostStatus = z.infer<typeof postStatusSchema>;

/**
 * Caption groups (spec F08B, ADR 0042): a post has one caption per group of its platforms.
 * Facebook and Instagram share one; every other platform is its own group.
 */
export const CAPTION_GROUPS = [
  'facebook_instagram',
  'tiktok',
  'x',
  'linkedin',
  'youtube',
  'snapchat',
  'google_business',
] as const;

export const captionGroupSchema = z.enum(CAPTION_GROUPS).meta({ id: 'CaptionGroup' });

export type CaptionGroup = z.infer<typeof captionGroupSchema>;

export const captionGroupOf = (platform: PostPlatform): CaptionGroup =>
  platform === 'facebook' || platform === 'instagram' ? 'facebook_instagram' : platform;

/** The groups of a post: those of its platforms, in the order of the platforms. */
export const captionGroupsOf = (platforms: readonly PostPlatform[]): CaptionGroup[] => [
  ...new Set(platforms.map(captionGroupOf)),
];

/** The platforms of a post that fall in a group, in the post's order. */
export const platformsOfGroup = (
  platforms: readonly PostPlatform[],
  group: CaptionGroup,
): PostPlatform[] => platforms.filter((platform) => captionGroupOf(platform) === group);

/** One caption group's text (F08B rule A1). */
export const postCaptionSchema = z
  .object({
    group: captionGroupSchema,
    caption: z.string().nullable(),
    hashtags: z.string().nullable(),
    /** YouTube only. */
    title: z.string().nullable(),
  })
  .meta({ id: 'PostCaption' });

export type PostCaption = z.infer<typeof postCaptionSchema>;
