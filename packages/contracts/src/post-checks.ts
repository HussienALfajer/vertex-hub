import { z } from 'zod';
import type { FileType } from './files.js';
import {
  type CaptionGroup,
  captionGroupSchema,
  captionGroupsOf,
  type PostPlatform,
  type PostType,
  platformsOfGroup,
  postPlatformSchema,
} from './post-values.js';

/*
 * The platform limits and the checks of a post (spec F08B rules A3–A4, ADR 0042): one pure
 * function shared by the wizard, the post page and the API. The values come from the platforms'
 * help pages as of 2026-10 and were not checked live: edit them here when a platform changes.
 */

/** Characters of caption, a blank line and hashtags together, counted in code points. */
export const PLATFORM_TEXT_LIMITS: Record<PostPlatform, number> = {
  instagram: 2200,
  // The storage cap: Facebook's own limit is higher.
  facebook: 5000,
  tiktok: 4000,
  x: 280,
  linkedin: 3000,
  youtube: 5000,
  snapchat: 250,
  google_business: 1500,
};

/** X when the client's account publishes long posts (client content settings). */
export const X_LONG_POST_LIMIT = 5000;

/** Instagram refuses more hashtags than this. */
export const INSTAGRAM_HASHTAG_LIMIT = 30;

/** A YouTube title. */
export const YOUTUBE_TITLE_LIMIT = 100;

/** The slides a post's media layout takes (edge case 15): the rest follow in F08 order. */
export const MEDIA_LAYOUT_LIMIT = 40;

/** An aspect ratio as `width:height`. */
type AspectRatio = '9:16' | '4:5' | '1:1' | '1.91:1' | '16:9';

/** What a platform takes for a post type; a missing value is not checked. */
export interface MediaRule {
  maxVideoSeconds?: number;
  ratios?: readonly AspectRatio[];
  maxSlides?: number;
}

const FEED_RATIOS: readonly AspectRatio[] = ['4:5', '1:1', '1.91:1'];

/** Per platform: a rule per post type, or `any` for every type the platform does not name. */
export const PLATFORM_MEDIA_RULES: Record<
  PostPlatform,
  Partial<Record<PostType | 'any', MediaRule>>
> = {
  instagram: {
    reel: { maxVideoSeconds: 180, ratios: ['9:16'] },
    story: { maxVideoSeconds: 60, ratios: ['9:16'] },
    post: { ratios: FEED_RATIOS, maxSlides: 20 },
    carousel: { ratios: FEED_RATIOS, maxSlides: 20 },
  },
  facebook: {
    reel: { maxVideoSeconds: 90, ratios: ['9:16'] },
    post: { maxSlides: 20 },
    carousel: { maxSlides: 20 },
  },
  tiktok: {
    reel: { maxVideoSeconds: 600, ratios: ['9:16'] },
    any: { maxSlides: 35 },
  },
  x: { any: { maxVideoSeconds: 140, maxSlides: 4 } },
  linkedin: { any: { maxVideoSeconds: 600, maxSlides: 20 } },
  youtube: {
    reel: { maxVideoSeconds: 180, ratios: ['9:16'] },
    post: { ratios: ['16:9'] },
  },
  snapchat: { any: { maxVideoSeconds: 60, ratios: ['9:16'] } },
  google_business: { any: { maxVideoSeconds: 30, maxSlides: 1 } },
};

export const mediaRuleOf = (platform: PostPlatform, type: PostType): MediaRule =>
  PLATFORM_MEDIA_RULES[platform][type] ?? PLATFORM_MEDIA_RULES[platform].any ?? {};

/** Code points, as the platforms count them. */
export const textLength = (text: string | null | undefined): number => [...(text ?? '')].length;

/** The text as published: the caption, a blank line, then the hashtags. */
export const publishedText = (caption: string | null, hashtags: string | null): string =>
  [caption, hashtags].filter((part) => !!part).join('\n\n');

/** Hashtags in a text: `#` followed by at least one character that is not a space or `#`. */
export const hashtagCount = (text: string): number => text.match(/#[^\s#]+/gu)?.length ?? 0;

/** Settings that change a limit (client content settings, F08B part C). */
export interface PostCheckSettings {
  xLongPosts: boolean;
}

/** The limit of one platform's text. */
export const platformTextLimit = (platform: PostPlatform, settings: PostCheckSettings): number =>
  platform === 'x' && settings.xLongPosts ? X_LONG_POST_LIMIT : PLATFORM_TEXT_LIMITS[platform];

/** A group's limit: the lowest of its chosen platforms, with the platform that sets it. */
export function groupTextLimit(
  platforms: readonly PostPlatform[],
  group: CaptionGroup,
  settings: PostCheckSettings,
): { platform: PostPlatform; limit: number } | null {
  let lowest: { platform: PostPlatform; limit: number } | null = null;
  for (const platform of platformsOfGroup(platforms, group)) {
    const limit = platformTextLimit(platform, settings);
    if (!lowest || limit < lowest.limit) lowest = { platform, limit };
  }
  return lowest;
}

export const POST_CHECK_CODES = [
  // Blocking: refused at the submission for review (rule A3, `CAPTION_TOO_LONG`).
  'caption_too_long',
  'too_many_hashtags',
  'title_too_long',
  // Warnings (rule A4).
  'caption_empty',
  'title_missing',
  'video_missing',
  'video_too_long',
  'aspect_ratio',
  'too_many_slides',
  'mixed_ratios',
  'too_many_media',
] as const;

export const postCheckCodeSchema = z.enum(POST_CHECK_CODES).meta({ id: 'PostCheckCode' });

export type PostCheckCode = z.infer<typeof postCheckCodeSchema>;

const BLOCKING_CHECKS: readonly PostCheckCode[] = [
  'caption_too_long',
  'too_many_hashtags',
  'title_too_long',
];

export const postCheckSchema = z
  .object({
    code: postCheckCodeSchema,
    group: captionGroupSchema.optional(),
    platform: postPlatformSchema.optional(),
    /** The slide, from 0, in layout order. */
    mediaIndex: z.number().int().min(0).optional(),
    /** Characters, hashtags, seconds or slides, by code. */
    limit: z.number().int().min(0).optional(),
    actual: z.number().int().min(0).optional(),
    blocking: z.boolean(),
  })
  .meta({ id: 'PostCheck' });

export type PostCheck = z.infer<typeof postCheckSchema>;

/** One group's text, as the checks read it. */
export interface CheckedCaption {
  group: CaptionGroup;
  caption: string | null;
  hashtags: string | null;
  title: string | null;
}

/** One slide, as the checks read it; unmeasured values are null and not checked. */
export interface CheckedMedium {
  type: FileType;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** Ratios within 2% of each other are the same (rule A4). */
const RATIO_TOLERANCE = 0.02;

const ratioValue = (ratio: AspectRatio): number => {
  const [width, height] = ratio.split(':').map(Number) as [number, number];
  return width / height;
};

const sameRatio = (a: number, b: number) => Math.abs(a - b) / b <= RATIO_TOLERANCE;

const measuredRatio = (medium: CheckedMedium): number | null =>
  medium.width && medium.height ? medium.width / medium.height : null;

/**
 * Rules A3–A4: the limits a post breaks (blocking) and what looks wrong (warnings), for the
 * groups of its platforms and its media in slide order. Captions of other groups are ignored.
 */
export function postChecks(
  draft: {
    type: PostType;
    platforms: readonly PostPlatform[];
    captions: readonly CheckedCaption[];
  },
  media: readonly CheckedMedium[],
  settings: PostCheckSettings,
): PostCheck[] {
  const checks: Omit<PostCheck, 'blocking'>[] = [];
  const captions = new Map(draft.captions.map((caption) => [caption.group, caption]));
  for (const group of captionGroupsOf(draft.platforms)) {
    const caption = captions.get(group);
    const text = publishedText(caption?.caption ?? null, caption?.hashtags ?? null);
    const lowest = groupTextLimit(draft.platforms, group, settings);
    const length = textLength(text);
    if (lowest && length > lowest.limit) {
      checks.push({
        code: 'caption_too_long',
        group,
        platform: lowest.platform,
        limit: lowest.limit,
        actual: length,
      });
    }
    if (group === 'facebook_instagram' && draft.platforms.includes('instagram')) {
      const tags = hashtagCount(text);
      if (tags > INSTAGRAM_HASHTAG_LIMIT) {
        checks.push({
          code: 'too_many_hashtags',
          group,
          platform: 'instagram',
          limit: INSTAGRAM_HASHTAG_LIMIT,
          actual: tags,
        });
      }
    }
    if (group === 'youtube') {
      const title = textLength(caption?.title);
      if (title > YOUTUBE_TITLE_LIMIT) {
        checks.push({
          code: 'title_too_long',
          group,
          platform: 'youtube',
          limit: YOUTUBE_TITLE_LIMIT,
          actual: title,
        });
      }
      if (title === 0) checks.push({ code: 'title_missing', group, platform: 'youtube' });
    }
    if (draft.type !== 'story' && !caption?.caption?.trim()) {
      checks.push({ code: 'caption_empty', group });
    }
  }

  if (
    (draft.type === 'reel' || draft.type === 'story') &&
    !media.some((medium) => medium.type === 'video')
  ) {
    checks.push({ code: 'video_missing' });
  }
  for (const platform of draft.platforms) {
    const rule = mediaRuleOf(platform, draft.type);
    media.forEach((medium, mediaIndex) => {
      if (
        rule.maxVideoSeconds !== undefined &&
        medium.type === 'video' &&
        medium.durationMs !== null &&
        medium.durationMs > rule.maxVideoSeconds * 1000
      ) {
        checks.push({
          code: 'video_too_long',
          platform,
          mediaIndex,
          limit: rule.maxVideoSeconds,
          actual: Math.ceil(medium.durationMs / 1000),
        });
      }
      const ratio = measuredRatio(medium);
      if (
        rule.ratios &&
        ratio !== null &&
        !rule.ratios.some((allowed) => sameRatio(ratio, ratioValue(allowed)))
      ) {
        checks.push({ code: 'aspect_ratio', platform, mediaIndex });
      }
    });
    if (rule.maxSlides !== undefined && media.length > rule.maxSlides) {
      checks.push({
        code: 'too_many_slides',
        platform,
        limit: rule.maxSlides,
        actual: media.length,
      });
    }
  }
  if (draft.type === 'carousel') {
    const ratios = media.flatMap((medium) => measuredRatio(medium) ?? []);
    const first = ratios[0];
    if (first !== undefined && ratios.some((ratio) => !sameRatio(ratio, first))) {
      checks.push({ code: 'mixed_ratios' });
    }
  }
  if (media.length > MEDIA_LAYOUT_LIMIT) {
    checks.push({ code: 'too_many_media', limit: MEDIA_LAYOUT_LIMIT, actual: media.length });
  }
  return checks.map((check) => ({ ...check, blocking: BLOCKING_CHECKS.includes(check.code) }));
}

/** The checks that refuse a submission for review (`CAPTION_TOO_LONG`). */
export const blockingChecks = (checks: readonly PostCheck[]): PostCheck[] =>
  checks.filter((check) => check.blocking);
