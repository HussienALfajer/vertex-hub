import { z } from 'zod';

/**
 * Currencies of V1 (ADR 0006). `SYP` is the new Syrian pound (owner decision, was Q8). Both use
 * 2 decimal places, so amounts are stored in hundredths.
 */
export const CURRENCIES = ['USD', 'SYP'] as const;

export const currencySchema = z.enum(CURRENCIES).meta({ id: 'Currency' });

export type Currency = z.infer<typeof currencySchema>;

/** A non-negative amount in minor units of its record's currency (ADR 0006). */
export const minorAmountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
