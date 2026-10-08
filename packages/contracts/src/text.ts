import { z } from 'zod';

/** Runs of whitespace inside a text become one space, as a name is typed or pasted. */
export const singleSpaced = (text: string) => text.replace(/\s+/g, ' ');

/** Optional text: blank input is stored as null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);

/** A list of short texts, kept once regardless of case (the first spelling wins). */
export const uniqueTexts = (item: z.ZodString, max: number) =>
  z
    .array(item)
    .transform((texts) => {
      const seen = new Set<string>();
      return texts.filter((text) => {
        const key = text.toLocaleLowerCase('ar');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })
    .pipe(z.array(z.string()).max(max));

/** A web link: http or https only, as stored for brand files, references and platforms. */
export const httpUrlSchema = z
  .string()
  .trim()
  .pipe(z.url({ protocol: /^https?$/ }).max(2048));
