import { z } from 'zod';
import {
  ackOfCritical,
  announcementBodySchema,
  announcementFieldsSchema,
  labelNeedsLink,
  labelNeedsLinkIssue,
} from './announcements.js';
import { notificationPrioritySchema } from './notifications.js';

/*
 * Announcement templates (spec F16 rule D12): the title, body, priority, acknowledgement and link
 * of an announcement, never its audience. Personal templates belong to their owner; holders of
 * `announcements.manage` `all` keep the shared ones, which everyone reads.
 */

export const ANNOUNCEMENT_TEMPLATE_LIMITS = { nameMin: 3, nameMax: 60 } as const;

const nameSchema = z
  .string()
  .trim()
  .min(ANNOUNCEMENT_TEMPLATE_LIMITS.nameMin)
  .max(ANNOUNCEMENT_TEMPLATE_LIMITS.nameMax);

/** The announcement fields a template keeps, validated as the editor's. */
const templateFieldsSchema = announcementFieldsSchema.pick({
  title: true,
  body: true,
  linkUrl: true,
  linkLabel: true,
  priority: true,
  requiresAck: true,
});

export const createAnnouncementTemplateSchema = templateFieldsSchema
  .partial({ linkUrl: true, linkLabel: true })
  .extend({
    name: nameSchema,
    /** Shared with everyone; needs `announcements.manage` `all`. */
    shared: z.boolean().default(false),
  })
  .refine(labelNeedsLink, labelNeedsLinkIssue)
  .transform(ackOfCritical)
  .meta({ id: 'CreateAnnouncementTemplate' });

export type CreateAnnouncementTemplate = z.infer<typeof createAnnouncementTemplateSchema>;

export type CreateAnnouncementTemplateInput = z.input<typeof createAnnouncementTemplateSchema>;

/** Rename or change a template; a template stays personal or shared. */
export const updateAnnouncementTemplateSchema = templateFieldsSchema
  .extend({ name: nameSchema })
  .partial()
  .refine(labelNeedsLink, labelNeedsLinkIssue)
  .transform(ackOfCritical)
  .meta({ id: 'UpdateAnnouncementTemplate' });

export type UpdateAnnouncementTemplate = z.infer<typeof updateAnnouncementTemplateSchema>;

export type UpdateAnnouncementTemplateInput = z.input<typeof updateAnnouncementTemplateSchema>;

export const announcementTemplateSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    title: z.string(),
    body: announcementBodySchema,
    priority: notificationPrioritySchema,
    requiresAck: z.boolean(),
    linkUrl: z.string().nullable(),
    linkLabel: z.string().nullable(),
    /** Shared with everyone, else the caller's own. */
    shared: z.boolean(),
    /** Whether the caller may rename, change and archive it (the API enforces it). */
    editable: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'AnnouncementTemplate' });

export type AnnouncementTemplate = z.infer<typeof announcementTemplateSchema>;

/** The caller's personal templates, then the shared ones, each by name. */
export const announcementTemplateListSchema = z
  .object({ items: z.array(announcementTemplateSchema) })
  .meta({ id: 'AnnouncementTemplateList' });

export type AnnouncementTemplateList = z.infer<typeof announcementTemplateListSchema>;
