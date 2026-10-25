import { z } from 'zod';

/*
 * Profile images (spec F01C, ADR 0040): one current image per user, client, project or retainer,
 * cropped square in the browser and served by id to signed-in users.
 */

export const IMAGE_SUBJECT_TYPES = ['user', 'client', 'project', 'retainer'] as const;

export const imageSubjectTypeSchema = z.enum(IMAGE_SUBJECT_TYPES).meta({ id: 'ImageSubjectType' });

export type ImageSubjectType = z.infer<typeof imageSubjectTypeSchema>;

/** Where the square came from: an upload, or a crop of a client's logo brand file (rule 6). */
export const IMAGE_SOURCES = ['upload', 'brand_file'] as const;

export const imageSourceSchema = z.enum(IMAGE_SOURCES).meta({ id: 'ImageSource' });

export type ImageSource = z.infer<typeof imageSourceSchema>;

/** `pending` until the `files.preview` job renders the renditions (rule 10). */
export const IMAGE_STATUSES = ['pending', 'ready', 'failed'] as const;

export const imageStatusSchema = z.enum(IMAGE_STATUSES).meta({ id: 'ImageStatus' });

export type ImageStatus = z.infer<typeof imageStatusSchema>;

/** The rendition sides in pixels: `sm` below the `lg` avatar, `md` for `lg` and `xl` (rule 12). */
export const IMAGE_SIZES = { sm: 128, md: 320 } as const;

export type ImageSize = keyof typeof IMAGE_SIZES;

export const imageSizeSchema = z.enum(['sm', 'md']).meta({ id: 'ImageSize' });

/** Rule 2: the largest accepted upload, 10 MB. */
export const IMAGE_MAX_BYTES = 10_485_760;

/** Rule 2: the smallest accepted side, when the header gives the size. */
export const IMAGE_MIN_SIDE = 128;

/** The side of the square the browser uploads, unless the crop itself is smaller (rule 2). */
export const IMAGE_UPLOAD_SIDE = 1024;

/** The accepted types, detected from the content (rule 2). */
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** Render attempts before an image is `failed` (rule 10). */
export const IMAGE_MAX_ATTEMPTS = 3;

/**
 * Rules 1 and 6: an upload from `POST /api/files/uploads`; `brandVersionId` (clients only) names
 * the logo brand file version the crop was cut from.
 */
export const setImageSchema = z
  .object({
    source: z.object({ uploadId: z.uuid(), brandVersionId: z.uuid().optional() }),
  })
  .meta({ id: 'SetImage' });

export type SetImage = z.infer<typeof setImageSchema>;

export const imageSchema = z
  .object({ id: z.uuid(), status: imageStatusSchema })
  .meta({ id: 'Image', description: 'The record’s new current image' });

export type Image = z.infer<typeof imageSchema>;

/** The route serving an image's rendition (rule 11). */
export function imagePath(id: string, size: ImageSize): string {
  return `/api/images/${id}/${size}`;
}

/** A record shown with an avatar elsewhere: its name and current image, null for the initial. */
const imageRefSchema = z.object({ id: z.uuid(), name: z.string(), imageId: z.uuid().nullable() });

/** A user as other records show them, with their photo: the one person reference (F01C). */
export const personSchema = imageRefSchema.meta({ id: 'PersonRef' });

export type PersonRef = z.infer<typeof personSchema>;

/** A client as other records show them, with its logo. */
export const clientRefSchema = imageRefSchema.meta({ id: 'ClientRef' });

export type ClientRef = z.infer<typeof clientRefSchema>;

/**
 * A project or retainer as other records show them, with its effective image: its own, else its
 * client's logo (rule 3).
 */
export const engagementRefSchema = imageRefSchema.meta({ id: 'EngagementRef' });

export type EngagementRef = z.infer<typeof engagementRefSchema>;
