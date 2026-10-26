import { z } from 'zod';
import type { DepartmentCode } from './departments.js';
import { currencySchema, minorAmountSchema } from './money.js';
import { postPlatformSchema } from './post-values.js';
import { httpUrlSchema } from './text.js';

/*
 * F06B rules C7 and C8: the brief fields of a department and the estimate of a task. Kept apart
 * from `tasks.ts`, which builds its create and update inputs from them.
 */

/** Rule C8: hours with halves, 0.5–200 hours, stored in minutes. */
export const estimateMinutesSchema = z.number().int().min(30).max(12_000).multipleOf(30);

/** The kinds of brief fields (rule C7); other departments have none. */
export const BRIEF_FIELD_KINDS = [
  'design',
  'photography',
  'development',
  'content',
  'marketing',
] as const;

export type BriefFieldKind = (typeof BRIEF_FIELD_KINDS)[number];

/** The kind of brief fields of each department that has some. */
export const DEPARTMENT_BRIEF_KINDS: Partial<Record<DepartmentCode, BriefFieldKind>> = {
  design: 'design',
  photography: 'photography',
  development: 'development',
  content_management: 'content',
  marketing: 'marketing',
};

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:5', 'other'] as const;

export const DEVELOPMENT_ENVIRONMENTS = ['production', 'staging', 'development'] as const;

const fieldText = (max: number) => z.string().trim().min(1).max(max);

/** Values only, no transforms: the schema is also a response (OpenAPI shows the output). */
const unique = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine((values) => new Set(values).size === values.length, 'Each value once');

/** Every brief field, each optional; a department uses only those of its kind. */
export const taskBriefFieldsSchema = z
  .strictObject({
    // Design
    sizes: z.array(fieldText(40)).max(10).optional(),
    colors: unique(z.string().regex(/^#[0-9a-fA-F]{6}$/), 10).optional(),
    references: z.array(httpUrlSchema).max(10).optional(),
    // Photography (photo and video)
    length: fieldText(100).optional(),
    aspectRatio: z.enum(ASPECT_RATIOS).optional(),
    music: fieldText(200).optional(),
    // Development
    link: httpUrlSchema.optional(),
    environment: z.enum(DEVELOPMENT_ENVIRONMENTS).optional(),
    // Content Management
    platforms: unique(postPlatformSchema, 10).optional(),
    tone: fieldText(200).optional(),
    // Marketing
    goal: fieldText(300).optional(),
    audience: fieldText(300).optional(),
    budget: z.object({ amountMinor: minorAmountSchema, currency: currencySchema }).optional(),
  })
  .meta({ id: 'TaskBriefFields' });

export type TaskBriefFields = z.infer<typeof taskBriefFieldsSchema>;

type BriefFieldKey = keyof TaskBriefFields;

/** The fields of each kind; `length` is shared by photography (≤ 40) and content (≤ 100). */
const KIND_FIELDS = {
  design: ['sizes', 'colors', 'references'],
  photography: ['length', 'aspectRatio', 'music'],
  development: ['link', 'environment'],
  content: ['platforms', 'tone', 'length'],
  marketing: ['goal', 'audience', 'budget'],
} as const satisfies Record<BriefFieldKind, readonly BriefFieldKey[]>;

/** Rule C7: the brief fields schema of each kind, fixed in the contracts (owner, 2026-10-26). */
export const briefFieldsSchemas = {
  design: taskBriefFieldsSchema.pick({ sizes: true, colors: true, references: true }),
  photography: taskBriefFieldsSchema
    .pick({ aspectRatio: true, music: true })
    .extend({ length: fieldText(40).optional() }),
  development: taskBriefFieldsSchema.pick({ link: true, environment: true }),
  content: taskBriefFieldsSchema.pick({ platforms: true, tone: true, length: true }),
  marketing: taskBriefFieldsSchema.pick({ goal: true, audience: true, budget: true }),
} as const;

/**
 * Rule C7: the fields of `department` checked against its kind's schema. Returns the stored
 * value (null when nothing is filled) or the first field that does not belong.
 */
export function departmentBriefFields(
  department: DepartmentCode,
  fields: TaskBriefFields | null | undefined,
): { value: TaskBriefFields | null } | { problem: string } {
  const filled = Object.entries(fields ?? {}).filter(
    ([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0),
  );
  if (filled.length === 0) return { value: null };
  const kind = DEPARTMENT_BRIEF_KINDS[department];
  if (!kind) return { problem: filled[0]?.[0] as string };
  const allowed: readonly string[] = KIND_FIELDS[kind];
  const stray = filled.find(([key]) => !allowed.includes(key));
  if (stray) return { problem: stray[0] };
  const parsed = briefFieldsSchemas[kind].safeParse(Object.fromEntries(filled));
  if (!parsed.success) return { problem: String(parsed.error.issues[0]?.path[0] ?? 'length') };
  return { value: parsed.data };
}

/**
 * Rule C7: a department change keeps the fields only when the new department has the same kind;
 * otherwise they are cleared.
 */
export function keepsBriefFields(from: DepartmentCode, to: DepartmentCode): boolean {
  const kind = DEPARTMENT_BRIEF_KINDS[from];
  return kind !== undefined && kind === DEPARTMENT_BRIEF_KINDS[to];
}
