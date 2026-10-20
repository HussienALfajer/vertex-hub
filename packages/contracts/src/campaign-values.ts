import { z } from 'zod';

/*
 * The statuses of an ad campaign (spec F12). Kept apart from `campaigns.ts`, which imports
 * `tasks.ts`: notification snapshots name them, and `tasks.ts` imports the notifications.
 */

export const AD_CAMPAIGN_STATUSES = [
  'planned',
  'active',
  'paused',
  'completed',
  'cancelled',
] as const;

export const adCampaignStatusSchema = z.enum(AD_CAMPAIGN_STATUSES).meta({ id: 'AdCampaignStatus' });

export type AdCampaignStatus = z.infer<typeof adCampaignStatusSchema>;
