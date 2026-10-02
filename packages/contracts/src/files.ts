import { z } from 'zod';
import { BRAND_FILE_KINDS } from './clients.js';
import { pageQuerySchema, pageSchema, queryBooleanSchema } from './lists.js';
import { httpUrlSchema, optionalText } from './text.js';

/*
 * Files and versions (spec F10, ADR 0019): named items of a task, a client, a project, a
 * retainer, a post (F08) or a quote (F04), each with a chain of immutable versions (an upload or a link).
 */

export const FILE_OWNER_TYPES = ['task', 'client', 'project', 'retainer', 'post', 'quote'] as const;

export const fileOwnerTypeSchema = z.enum(FILE_OWNER_TYPES).meta({ id: 'FileOwnerType' });

export type FileOwnerType = z.infer<typeof fileOwnerTypeSchema>;

export const FILE_ROLES = ['deliverable', 'reference', 'brand', 'document'] as const;

export const fileRoleSchema = z.enum(FILE_ROLES).meta({ id: 'FileRole' });

export type FileRole = z.infer<typeof fileRoleSchema>;

/** Which roles each owner type holds (data table, check constraint). */
export const FILE_ROLES_BY_OWNER: Record<FileOwnerType, readonly FileRole[]> = {
  task: ['deliverable', 'reference'],
  client: ['brand', 'document'],
  project: ['document'],
  retainer: ['document'],
  post: ['deliverable'],
  quote: ['document'],
};

export const brandFileKindSchema = z.enum(BRAND_FILE_KINDS).meta({ id: 'BrandFileKind' });

export type BrandFileKind = z.infer<typeof brandFileKindSchema>;

export const FILE_VERSION_KINDS = ['upload', 'link'] as const;

export const fileVersionKindSchema = z.enum(FILE_VERSION_KINDS).meta({ id: 'FileVersionKind' });

export type FileVersionKind = z.infer<typeof fileVersionKindSchema>;

export const FILE_PREVIEW_STATUSES = ['pending', 'ready', 'none', 'failed'] as const;

export const filePreviewStatusSchema = z
  .enum(FILE_PREVIEW_STATUSES)
  .meta({ id: 'FilePreviewStatus' });

export type FilePreviewStatus = z.infer<typeof filePreviewStatusSchema>;

/** F09 adds `client`. */
export const FILE_FINAL_SOURCES = ['auto', 'manual', 'client'] as const;

export const fileFinalSourceSchema = z.enum(FILE_FINAL_SOURCES).meta({ id: 'FileFinalSource' });

export type FileFinalSource = z.infer<typeof fileFinalSourceSchema>;

/** The library's type filter (rule 13). */
export const FILE_TYPES = ['image', 'video', 'pdf', 'link', 'other'] as const;

export const fileTypeSchema = z.enum(FILE_TYPES).meta({ id: 'FileType' });

export type FileType = z.infer<typeof fileTypeSchema>;

// Limits and rules

/** 250 MB (owner decision). */
export const FILE_MAX_BYTES = 262_144_000;

/** Uploads stop when less than this would stay free on the files disk (rule 1). */
export const FILE_MIN_FREE_BYTES = 5 * 1024 ** 3;

/**
 * Larger images are not previewed (an icon instead): rendering reads the whole image into
 * memory, which stays bounded on the shared server.
 */
export const FILE_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;

/** Unattached uploads are purged after this long. */
export const FILE_UPLOAD_LIFETIME_HOURS = 24;

/** Non-archived items per owner and role, and versions per item (`LIMIT_REACHED`). */
export const FILE_LIMITS = {
  deliverable: 30,
  reference: 30,
  brand: 30,
  document: 100,
  versions: 100,
} as const;

export const FILE_NAME_MAX = 120;
export const FILE_ORIGINAL_NAME_MAX = 255;
export const FILE_NOTE_MAX = 500;
export const FILE_LINK_LABEL_MAX = 120;

/** Executables and scripts are refused by extension (rule 1). */
export const BLOCKED_FILE_EXTENSIONS = [
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'ps1',
  'vbs',
  'sh',
  'jar',
  'apk',
  'dll',
  'app',
  'dmg',
] as const;

/** … and by the type detected from their content. */
export const BLOCKED_MIME_TYPES = [
  'application/x-msdownload',
  'application/x-dosexec',
  'application/x-msi',
  'application/x-ms-installer',
  'application/java-archive',
  'application/vnd.android.package-archive',
  'application/x-apple-diskimage',
  'application/x-elf',
  'application/x-mach-binary',
  'application/x-sh',
  'text/x-shellscript',
] as const;

/** The only types served inline (rule 17); everything else is an attachment. */
export const INLINE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'application/pdf',
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;

/** Uploads the `files.preview` job renders (rule 18). */
export const PREVIEWABLE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
  'image/svg+xml',
] as const;

/** The lower-case extension of a file name, without the dot; null when it has none. */
export function fileExtension(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

export function isBlockedFile(name: string, mimeType: string | null): boolean {
  const extension = fileExtension(name);
  return (
    (extension !== null && (BLOCKED_FILE_EXTENSIONS as readonly string[]).includes(extension)) ||
    (mimeType !== null && (BLOCKED_MIME_TYPES as readonly string[]).includes(mimeType))
  );
}

export function isInlineMimeType(mimeType: string | null): boolean {
  return mimeType !== null && (INLINE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function isPreviewableMimeType(mimeType: string | null): boolean {
  return mimeType !== null && (PREVIEWABLE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** The library type of a version. */
export function fileTypeOf(kind: FileVersionKind, mimeType: string | null): FileType {
  if (kind === 'link') return 'link';
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'other';
}

/** Edge case 15: the name used when a file name has nothing but an extension. */
export const DEFAULT_FILE_NAME = 'File';

/**
 * The default item name (data table): the file name without its extension, or the link's label
 * or host, cut to the name limit.
 */
export function defaultFileItemName(
  source: { originalName: string } | { url: string; label: string | null },
): string {
  let name: string;
  if ('originalName' in source) {
    const dot = source.originalName.lastIndexOf('.');
    name = dot > 0 ? source.originalName.slice(0, dot) : source.originalName;
    if (dot === 0) name = '';
  } else {
    name = source.label ?? new URL(source.url).host;
  }
  return name.trim().slice(0, FILE_NAME_MAX).trim() || DEFAULT_FILE_NAME;
}

// Inputs

export const fileItemNameSchema = z.string().trim().min(1).max(FILE_NAME_MAX);

export const fileUploadSourceSchema = z
  .object({ uploadId: z.uuid() })
  .meta({ id: 'FileUploadSource' });

export const fileLinkSourceSchema = z
  .object({ url: httpUrlSchema, label: optionalText(FILE_LINK_LABEL_MAX).optional() })
  .meta({ id: 'FileLinkSource' });

/** An upload from step 1, or an external link (rule 2). */
export const fileSourceSchema = z
  .union([fileUploadSourceSchema, fileLinkSourceSchema])
  .meta({ id: 'FileSource' });

export type FileSource = z.infer<typeof fileSourceSchema>;

const fileNoteSchema = optionalText(FILE_NOTE_MAX).optional();

export const createFileItemSchema = z
  .object({
    ownerType: fileOwnerTypeSchema,
    ownerId: z.uuid(),
    role: fileRoleSchema,
    /** Defaults to the source's name (data table). */
    name: fileItemNameSchema.optional(),
    /** Brand files only, required there. */
    brandKind: brandFileKindSchema.optional(),
    /** Documents only. */
    confidential: z.boolean().default(false),
    note: fileNoteSchema,
    source: fileSourceSchema,
  })
  .superRefine((input, ctx) => {
    if (!FILE_ROLES_BY_OWNER[input.ownerType].includes(input.role)) {
      ctx.addIssue({ code: 'custom', path: ['role'], message: 'Role not allowed on this owner' });
    }
    if ((input.role === 'brand') !== (input.brandKind !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['brandKind'],
        message: 'Brand kind is required on brand files and only there',
      });
    }
    if (input.confidential && input.role !== 'document') {
      ctx.addIssue({
        code: 'custom',
        path: ['confidential'],
        message: 'Only documents can be confidential',
      });
    }
  })
  .meta({ id: 'CreateFileItem' });

export type CreateFileItem = z.infer<typeof createFileItemSchema>;

export type CreateFileItemInput = z.input<typeof createFileItemSchema>;

/** Brand kind applies to brand files and confidential to documents; the API checks the role. */
export const updateFileItemSchema = z
  .object({
    name: fileItemNameSchema.optional(),
    brandKind: brandFileKindSchema.optional(),
    confidential: z.boolean().optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Nothing to change',
  })
  .meta({ id: 'UpdateFileItem' });

export type UpdateFileItem = z.infer<typeof updateFileItemSchema>;

export const createFileVersionSchema = z
  .object({ note: fileNoteSchema, source: fileSourceSchema })
  .meta({ id: 'CreateFileVersion' });

export type CreateFileVersion = z.infer<typeof createFileVersionSchema>;

export const setFinalSchema = z.object({ final: z.boolean() }).meta({ id: 'SetFileFinal' });

export type SetFinal = z.infer<typeof setFinalSchema>;

// Responses

const personSchema = z.object({ id: z.uuid(), name: z.string() });

export const fileUploadSchema = z
  .object({
    uploadId: z.uuid(),
    name: z.string(),
    sizeBytes: z.number().int().min(1),
    mimeType: z.string(),
  })
  .meta({ id: 'FileUpload', description: 'An upload waiting to be attached' });

export type FileUpload = z.infer<typeof fileUploadSchema>;

export const fileVersionSchema = z
  .object({
    id: z.uuid(),
    number: z.number().int().min(1),
    kind: fileVersionKindSchema,
    type: fileTypeSchema,
    originalName: z.string().nullable(),
    mimeType: z.string().nullable(),
    sizeBytes: z.number().int().min(1).nullable(),
    previewStatus: filePreviewStatusSchema,
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    url: z.string().nullable(),
    linkLabel: z.string().nullable(),
    note: z.string().nullable(),
    uploadedBy: personSchema,
    isFinal: z.boolean(),
    finalSource: fileFinalSourceSchema.nullable(),
    /** Null for automatic finals. */
    finalMarkedBy: personSchema.nullable(),
    finalMarkedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
    canRemove: z.boolean(),
  })
  .meta({ id: 'FileVersion' });

export type FileVersion = z.infer<typeof fileVersionSchema>;

export const fileItemPermissionsSchema = z
  .object({
    canAddVersion: z.boolean(),
    canRename: z.boolean(),
    canRemove: z.boolean(),
    canSetFinal: z.boolean(),
    canSetConfidential: z.boolean(),
    canRestore: z.boolean(),
  })
  .meta({ id: 'FileItemPermissions', description: 'What the caller may do, for the UI' });

export type FileItemPermissions = z.infer<typeof fileItemPermissionsSchema>;

export const fileItemSchema = z
  .object({
    id: z.uuid(),
    ownerType: fileOwnerTypeSchema,
    ownerId: z.uuid(),
    clientId: z.uuid().nullable(),
    role: fileRoleSchema,
    name: z.string(),
    brandKind: brandFileKindSchema.nullable(),
    confidential: z.boolean(),
    createdBy: personSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
    /** Newest first; removed ones only for scope-all holders who asked for them. */
    versions: z.array(fileVersionSchema),
    permissions: fileItemPermissionsSchema,
  })
  .meta({ id: 'FileItem' });

export type FileItem = z.infer<typeof fileItemSchema>;

export const fileOwnerRightsSchema = z
  .object({
    canAddDeliverable: z.boolean(),
    canAddReference: z.boolean(),
    /** Brand files and documents. */
    canManageDocuments: z.boolean(),
    canSetConfidential: z.boolean(),
    canSeeRemoved: z.boolean(),
  })
  .meta({ id: 'FileOwnerRights' });

export type FileOwnerRights = z.infer<typeof fileOwnerRightsSchema>;

export const fileItemListQuerySchema = z.object({
  ownerType: fileOwnerTypeSchema,
  ownerId: z.uuid(),
  role: fileRoleSchema.optional(),
  /** Scope-all holders only; ignored for others. */
  includeArchived: queryBooleanSchema.optional(),
});

export type FileItemListQuery = z.infer<typeof fileItemListQuerySchema>;

export const fileItemListSchema = z
  .object({ items: z.array(fileItemSchema), rights: fileOwnerRightsSchema })
  .meta({ id: 'FileItemList', description: 'Newest first' });

export type FileItemList = z.infer<typeof fileItemListSchema>;

export const fileOwnerSchema = z
  .object({ type: fileOwnerTypeSchema, id: z.uuid(), label: z.string() })
  .meta({ id: 'FileOwner' });

export type FileOwner = z.infer<typeof fileOwnerSchema>;

export const clientDocumentsQuerySchema = pageQuerySchema.extend({ clientId: z.uuid() });

export type ClientDocumentsQuery = z.infer<typeof clientDocumentsQuerySchema>;

export const fileDocumentSchema = fileItemSchema
  .extend({ owner: fileOwnerSchema })
  .meta({ id: 'FileDocument' });

export type FileDocument = z.infer<typeof fileDocumentSchema>;

export const fileItemPageSchema = pageSchema(fileDocumentSchema).meta({
  id: 'FileDocumentPage',
  description: 'Documents of a client, its projects and retainers, newest first',
});

export type FileItemPage = z.infer<typeof fileItemPageSchema>;

export const fileMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const fileLibraryQuerySchema = pageQuerySchema.extend({
  clientId: z.uuid(),
  type: fileTypeSchema.optional(),
  /** The month of the final marker, `YYYY-MM` in business time. */
  month: fileMonthSchema.optional(),
  q: z.string().trim().max(FILE_NAME_MAX).optional(),
});

export type FileLibraryQuery = z.infer<typeof fileLibraryQuerySchema>;

export const fileLibraryEntrySchema = z
  .object({
    itemId: z.uuid(),
    itemName: z.string(),
    task: z.object({ id: z.uuid(), title: z.string() }),
    version: fileVersionSchema,
  })
  .meta({ id: 'FileLibraryEntry' });

export type FileLibraryEntry = z.infer<typeof fileLibraryEntrySchema>;

export const fileLibraryPageSchema = pageSchema(fileLibraryEntrySchema).meta({
  id: 'FileLibraryPage',
  description: 'Final versions, newest marker first',
});

export type FileLibraryPage = z.infer<typeof fileLibraryPageSchema>;

export const fileUsageQuerySchema = z.object({ clientId: z.uuid().optional() });

export type FileUsageQuery = z.infer<typeof fileUsageQuerySchema>;

export const fileUsageSchema = z
  .object({
    /** Null without `clientId`. Removed versions count: they stay on disk. */
    clientBytes: z.number().int().min(0).nullable(),
    totalBytes: z.number().int().min(0),
    freeBytes: z.number().int().min(0),
  })
  .meta({ id: 'FileUsage' });

export type FileUsage = z.infer<typeof fileUsageSchema>;
