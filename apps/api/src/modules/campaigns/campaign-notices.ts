import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type CalendarDate,
  type NotificationResolution,
  OPEN_AD_CAMPAIGN_STATUSES,
} from '@vertex-hub/contracts';
import { adCampaigns, type Database, type Transaction } from '@vertex-hub/db';
import { and, asc, count, eq, inArray, isNull, lt } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { ResponsibilityRegistry, UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { DailyReminders, NotificationCenter, type Resolution } from '../notifications/index.js';

type CampaignRow = typeof adCampaigns.$inferSelect;

/** The campaign as its notices snapshot it. */
const campaignNotice = (campaign: CampaignRow, client: Pick<ClientSummary, 'name'>) => ({
  campaign: { name: campaign.name, client: client.name },
});

/** What closes a campaign's `campaign_end_passed`. */
const endPassedClosed = (
  campaignId: string,
  outcome: NotificationResolution,
  actorId: string,
): Resolution => ({
  subject: { type: 'campaign', id: campaignId },
  types: ['campaign_end_passed'],
  outcome,
  actorId,
});

/**
 * F16 part C: the campaign notices. The owner hears they were given a campaign and the previous
 * owner who holds it now (rule 4); the account manager and the owner hear of status changes and,
 * from the `notifications.daily` job, of an active campaign past its end date, until it is
 * completed, cancelled or its end date moves. Open campaigns are open work of an archived owner
 * (`member_archived_open_work`); they do not block archiving.
 */
@Injectable()
export class CampaignNotices implements OnModuleInit {
  private readonly logger = new Logger(CampaignNotices.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly center: NotificationCenter,
    private readonly reminders: DailyReminders,
    private readonly responsibilities: ResponsibilityRegistry,
  ) {}

  onModuleInit(): void {
    this.reminders.register('campaign-end-passed', (today) => this.remindEndPassed(today));
    this.responsibilities.registerOpenWork(async (tx, userId) => {
      const [row] = await tx
        .select({ value: count() })
        .from(adCampaigns)
        .where(
          and(
            eq(adCampaigns.ownerId, userId),
            inArray(adCampaigns.status, [...OPEN_AD_CAMPAIGN_STATUSES]),
            isNull(adCampaigns.archivedAt),
          ),
        );
      return row?.value ?? 0;
    });
  }

  /** A campaign created with, or changed to, an owner; `previousOwnerId` null when created. */
  async ownerSet(
    tx: Transaction,
    actorId: string,
    campaign: CampaignRow,
    client: ClientSummary,
    previousOwnerId: string | null,
  ): Promise<void> {
    const owner = (await this.users.summaries([campaign.ownerId], tx)).get(campaign.ownerId);
    const base = { actorId, subjectId: campaign.id };
    await this.center.notify(tx, [
      {
        ...base,
        type: 'campaign_assigned',
        recipients: [campaign.ownerId],
        data: campaignNotice(campaign, client),
      },
      {
        ...base,
        type: 'responsibility_moved',
        subjectType: 'campaign',
        recipients: previousOwnerId ? [previousOwnerId] : [],
        data: { role: 'campaign_owner', record: campaign.name, holder: owner?.name ?? '' },
      },
    ]);
  }

  /** The end date moved: the reminder about the old one is done. */
  endMoved(tx: Transaction, campaignId: string, actorId: string): Promise<number> {
    return this.center.resolve(tx, endPassedClosed(campaignId, 'done', actorId));
  }

  /** Completed: the reminder is done; cancelled: it no longer applies. */
  async statusChanged(
    tx: Transaction,
    actorId: string,
    campaign: CampaignRow,
    client: ClientSummary,
  ): Promise<void> {
    const resolutions =
      campaign.status === 'completed' || campaign.status === 'cancelled'
        ? [endPassedClosed(campaign.id, campaign.status === 'completed' ? 'done' : 'void', actorId)]
        : [];
    await this.center.notify(
      tx,
      {
        type: 'campaign_status_changed',
        recipients: [client.accountManagerId, campaign.ownerId],
        actorId,
        subjectId: campaign.id,
        data: { ...campaignNotice(campaign, client), status: campaign.status },
      },
      resolutions,
    );
  }

  /**
   * Part C rule 3: once per campaign and end date, an active campaign whose end date has passed;
   * archived ones are skipped.
   */
  async remindEndPassed(today: CalendarDate): Promise<number> {
    const due = and(
      eq(adCampaigns.status, 'active'),
      isNull(adCampaigns.archivedAt),
      lt(adCampaigns.endsOn, today),
    );
    const candidates = await this.db
      .select({ id: adCampaigns.id })
      .from(adCampaigns)
      .where(due)
      .orderBy(asc(adCampaigns.id));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Campaign end passed reminder ${id}`,
      async ({ id }) => {
        // Read again under the lock, so a campaign completed since the candidates were read is left.
        const recorded = await this.db.transaction(async (tx) => {
          const [campaign] = await tx
            .select()
            .from(adCampaigns)
            .where(and(eq(adCampaigns.id, id), due))
            .for('update');
          if (!campaign?.endsOn) return false;
          const client = await this.clients.summary(campaign.clientId, tx);
          if (!client) return false;
          return this.reminders.remindOnce(
            tx,
            { kind: 'campaign_end_passed', subjectId: campaign.id, occurrence: campaign.endsOn },
            today,
            {
              type: 'campaign_end_passed',
              recipients: [campaign.ownerId, client.accountManagerId],
              actorId: null,
              subjectId: campaign.id,
              data: { ...campaignNotice(campaign, client), endsOn: campaign.endsOn },
            },
          );
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }
}
