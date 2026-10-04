import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AcceptedDeliverableLine,
  type AcceptPlan,
  type AcceptPlanQuery,
  type AcceptQuote,
  addDays,
  addMonths,
  businessDate,
  type CalendarDate,
  type CountedQuoteItem,
  type DepartmentCode,
  defaultInstallmentMilestones,
  firstOfMonth,
  mergeDeliverableLines,
  type QuoteDetail,
  quoteDisplayNumber,
  RETAINER_LIMITS,
} from '@vertex-hub/contracts';
import { type Database, quotes, type Transaction } from '@vertex-hub/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, lockAccessChanges, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { GeneratedFiles } from '../files/index.js';
import { type ConversionResult, LeadPipeline } from '../leads/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { EngagementFactory } from '../projects/index.js';
import { TemplateDirectory, TemplateRunner, type TemplateSummary } from '../templates/index.js';
import { QuoteAcceptedHooks } from './quote-accepted-hooks.js';
import {
  actorOf,
  assertTakesQuotes,
  canRead,
  clientRecipient,
  covers,
  coversEngagements,
  type Recipient,
} from './quote-access.js';
import { QuotePdfService } from './quote-pdf.service.js';
import { QuoteRecipients } from './quote-recipients.js';
import {
  identity,
  NO_DRAFT_PDF,
  type QuoteChildren,
  type QuoteRow,
  quoteChildren,
  totalsOf,
} from './quote-records.js';
import { QuotesService } from './quotes.service.js';

/** A3: without templates, the project runs 30 days. */
const DEFAULT_PROJECT_DAYS = 30;

/** F07's stage matching: trimmed and case-insensitive. */
const nameKey = (name: string) => name.trim().toLocaleLowerCase('ar');

/** A project template the one-off section brings, with the highest rounds of what brings it. */
interface SectionTemplate {
  id: string;
  revisionLimit: number;
}

/** What the plan and the acceptance derive from the quote's lines. */
interface Derived {
  oneOff: {
    departments: DepartmentCode[];
    /** Distinct, in line order (A2). */
    templates: SectionTemplate[];
  } | null;
  monthly: {
    departments: DepartmentCode[];
    lines: AcceptedDeliverableLine[];
    /** Candidate monthly templates: packages' first, then services' (A5). */
    templateIds: string[];
  } | null;
}

/** A1–A12: the accept dialog's plan and the acceptance that runs the engagement part of A01. */
@Injectable()
export class QuoteAcceptService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly quotes: QuotesService,
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
    private readonly templates: TemplateDirectory,
    private readonly runner: TemplateRunner,
    private readonly engagements: EngagementFactory,
    private readonly files: GeneratedFiles,
    private readonly notifications: NotificationCenter,
    private readonly pdf: QuotePdfService,
    private readonly acceptedHooks: QuoteAcceptedHooks,
    private readonly recipients: QuoteRecipients,
    private readonly leadPipeline: LeadPipeline,
  ) {}

  /**
   * A2–A6: the dialog's defaults for its current choices, with step 0 for a lead quote (F03 rule
   * 11). Nothing is written.
   */
  async plan(actor: CurrentUserInfo, id: string, query: AcceptPlanQuery): Promise<AcceptPlan> {
    const [quote] = await this.db.select().from(quotes).where(eq(quotes.id, id));
    const recipient = quote ? await this.recipients.of(quote) : null;
    if (!quote || !recipient || !canRead(actor, recipient, quote)) throw new NotFoundException();
    assertMayAccept(actor, recipient, quote);
    assertTakesQuotes(recipient);
    // The client the engagements go to: the quote's, or the one step 0 links (none when new).
    const conversion =
      recipient.kind === 'lead'
        ? await this.leadPipeline.conversionPlan(recipient.id, query.clientId)
        : null;
    // Linking an existing client needs `projects.manage` over it, as the acceptance does.
    const linked = conversion?.existingClient;
    if (linked && !coversEngagements(actor, { accountManagerId: linked.accountManager.id })) {
      throw new ForbiddenException();
    }
    const engagementClient = conversion
      ? conversion.existingClient && {
          id: conversion.existingClient.id,
          accountManagerId: conversion.existingClient.accountManager.id,
        }
      : { id: recipient.id, accountManagerId: recipient.accountManagerId };
    const projectManagerId = conversion
      ? (engagementClient?.accountManagerId ?? conversion.client.accountManagerId)
      : recipient.accountManagerId;
    const children = await this.children(this.db, quote);
    const derived = derive(children);
    const today = businessDate();
    const summaries = await this.templates.summaries([
      ...(derived.oneOff?.templates.map((template) => template.id) ?? []),
      ...(derived.monthly?.templateIds ?? []),
    ]);
    const live = (templateId: string, kind: TemplateSummary['kind']) => {
      const template = summaries.get(templateId);
      return !!template && !template.archived && template.kind === kind;
    };

    let project: AcceptPlan['project'] = null;
    if (derived.oneOff) {
      const offered = derived.oneOff.templates.filter((t) => live(t.id, 'project'));
      const chosen = query.chooseTemplates
        ? offered.filter((t) => query.templateIds.includes(t.id))
        : offered;
      const startDate = query.projectStartDate ?? today;
      const { milestones, dueDate } = await this.projectPlan(
        chosen.map((t) => t.id),
        startDate,
        children,
      );
      const amounts = totalsOf(quote, children).installmentAmountsMinor;
      const mapping = defaultInstallmentMilestones(children.installments.length, milestones.length);
      const manager = projectManagerId
        ? (await this.users.summaries([projectManagerId])).get(projectManagerId)
        : undefined;
      project = {
        name: quote.title,
        projectManager: projectManagerId
          ? { id: projectManagerId, name: manager?.name ?? '' }
          : null,
        departments: derived.oneOff.departments,
        startDate,
        dueDate,
        templates: offered.map((t) => ({
          id: t.id,
          name: summaries.get(t.id)?.name ?? '',
          selected: chosen.includes(t),
          revisionLimit: t.revisionLimit,
        })),
        milestones,
        installments: children.installments.map((installment, index) => ({
          name: installment.name,
          percent: installment.percent,
          amountMinor: amounts[index] ?? 0,
          milestone: mapping[index] ?? 0,
        })),
      };
    }

    let retainer: AcceptPlan['retainer'] = null;
    if (derived.monthly) {
      const startDate = query.retainerStartDate ?? today;
      const templateId = derived.monthly.templateIds.find((t) => live(t, 'retainer_cycle'));
      const template = templateId ? summaries.get(templateId) : undefined;
      // F03 rule 11: renewing is offered only for a client that exists.
      const renewable = engagementClient
        ? await this.engagements.renewable(engagementClient.id)
        : [];
      retainer = {
        name: quote.title,
        departments: derived.monthly.departments,
        startDate,
        renewalDate: quote.monthlyTermMonths ? addMonths(startDate, quote.monthlyTermMonths) : null,
        template: template ? { id: template.id, name: template.name } : null,
        currency: quote.currency,
        monthlyFeeMinor: totalsOf(quote, children).monthly.netMinor,
        lines: derived.monthly.lines,
        renewable: renewable
          .filter((candidate) => candidate.currency === quote.currency)
          .map(({ id: retainerId, name, status }) => ({ id: retainerId, name, status })),
      };
    }

    return {
      sentOn: sentOn(quote),
      project,
      retainer,
      archivedTemplates: [...summaries.values()]
        .filter((template) => template.archived)
        .map((template) => ({ id: template.id, name: template.name })),
      conversion,
    };
  }

  /**
   * A1–A12 in one transaction: for a lead quote first the conversion (F03 rule 11, step 0), then
   * the response, the project with its milestones and template runs, the new or renewed
   * retainer, the proof, the quote `accepted`, a newer draft archived, the audit entries and the
   * notices. Any refusal rolls everything back.
   */
  async accept(actor: CurrentUserInfo, id: string, input: AcceptQuote): Promise<QuoteDetail> {
    const { detail, preview, discarded } = await this.db.transaction(async (tx) => {
      // Template runs assign users, who must stay active (F01 change); taken before row locks.
      await lockAccessChanges(tx);
      // Edge case 5: the row lock makes a second accept wait, then see `accepted`.
      const locked = await this.quotes.lockForChange(tx, actor, id);
      assertMayAccept(actor, locked.recipient, locked.quote);
      assertTakesQuotes(locked.recipient);
      const today = businessDate();
      if (input.respondedOn > today || input.respondedOn < sentOn(locked.quote)) {
        throw new CodedException(400, 'INVALID_DATES', 'From the sent day to today');
      }
      const converted = await this.convert(tx, actor, locked.recipient, input);
      // The conversion gave the quote its client.
      const [quote] = converted
        ? await tx.select().from(quotes).where(eq(quotes.id, id))
        : [locked.quote];
      const client = quote?.clientId ? await this.clients.summary(quote.clientId, tx) : null;
      if (!quote || !client) throw new Error('The quote has no client');
      // Without a contact, the one the conversion added answered (F03 rule 11).
      const contactId = input.contactId ?? converted?.contactId ?? null;
      if (
        input.contactId &&
        !(await this.clients.isActiveContact(client.id, input.contactId, tx))
      ) {
        throw new CodedException(400, 'UNKNOWN_CONTACT', 'Not a contact of the client');
      }
      const children = await this.children(tx, quote);
      const derived = derive(children);
      if (!derived.oneOff !== !input.project) {
        throw new BadRequestException('A project is given exactly when there are one-off lines');
      }
      if (!derived.monthly !== !input.retainer) {
        throw new BadRequestException('A retainer is given exactly when there are monthly lines');
      }
      const totals = totalsOf(quote, children);
      const departments = new Set<DepartmentCode>();

      let project: { id: string; name: string; firstInstallmentMilestoneId: string | null } | null =
        null;
      if (derived.oneOff && input.project) {
        const choice = input.project;
        const brought = new Map(derived.oneOff.templates.map((t) => [t.id, t.revisionLimit]));
        if (choice.templateIds.some((templateId) => !brought.has(templateId))) {
          throw new BadRequestException("A template is not one of the section's");
        }
        const summaries = await this.templates.summaries(choice.templateIds, tx);
        if (choice.templateIds.some((templateId) => summaries.get(templateId)?.archived)) {
          throw new CodedException(409, 'TEMPLATE_ARCHIVED', 'The template is archived');
        }
        const { milestones } = await this.projectPlan(
          choice.templateIds,
          choice.startDate,
          children,
          tx,
        );
        const mapping = choice.installmentMilestones;
        if (
          mapping.length !== children.installments.length ||
          mapping.some((index) => index >= milestones.length)
        ) {
          throw new CodedException(
            400,
            'INVALID_INSTALLMENTS',
            'Each installment needs one of the milestones',
          );
        }
        const created = await this.engagements.createProject(tx, actor, {
          clientId: client.id,
          name: choice.name,
          projectManagerId: choice.projectManagerId,
          departments: choice.departments,
          startDate: choice.startDate,
          dueDate: choice.dueDate,
          currency: quote.currency,
          status: 'planned',
          // A3: a milestone's installment is the sum of the installments attached to it.
          milestones: milestones.map((milestone, index) => {
            const attached = mapping.flatMap((target, i) =>
              target === index ? [totals.installmentAmountsMinor[i] ?? 0] : [],
            );
            return {
              name: milestone.name,
              dueDate: milestone.dueDate,
              installmentMinor:
                attached.length > 0 ? attached.reduce((sum, amount) => sum + amount, 0) : null,
            };
          }),
        });
        // A4: each template once, in order, its stages landing on the milestones by name.
        for (const templateId of choice.templateIds) {
          await this.runner.applyToProject(
            tx,
            actor,
            templateId,
            created.id,
            brought.get(templateId) ?? 0,
          );
        }
        project = {
          id: created.id,
          name: choice.name,
          firstInstallmentMilestoneId:
            mapping[0] === undefined ? null : (created.milestoneIds[mapping[0]] ?? null),
        };
        for (const code of choice.departments) departments.add(code);
      }

      let retainer: { id: string; name: string } | null = null;
      if (derived.monthly && input.retainer) {
        const lines = derived.monthly.lines;
        if (
          lines.length > RETAINER_LIMITS.deliverables ||
          lines.some((line) => line.monthlyQuantity > 999)
        ) {
          throw new CodedException(
            409,
            'LIMIT_REACHED',
            'A retainer holds at most 20 lines of at most 999 a month',
          );
        }
        const choice = input.retainer;
        if (choice.mode === 'new') {
          const retainerId = await this.engagements.createRetainer(tx, actor, {
            clientId: client.id,
            name: choice.name,
            departments: choice.departments,
            startDate: choice.startDate,
            renewalDate: choice.renewalDate,
            currency: quote.currency,
            monthlyFeeMinor: totals.monthly.netMinor,
            deliverables: lines,
          });
          // A8: linked before the first cycle opens, so F07 generates the month's tasks.
          if (choice.templateId) {
            await this.runner.linkRetainerTemplate(tx, actor, retainerId, choice.templateId);
          }
          await this.engagements.startRetainer(tx, actor, retainerId, choice.startDate);
          retainer = { id: retainerId, name: choice.name };
          for (const code of choice.departments) departments.add(code);
        } else {
          const renewed = await this.engagements.renewRetainer(tx, actor, choice.retainerId, {
            clientId: client.id,
            currency: quote.currency,
            deliverables: lines,
            monthlyFeeMinor: totals.monthly.netMinor,
            ...(quote.monthlyTermMonths && {
              renewalDate: addMonths(firstOfMonth(today), 1 + quote.monthlyTermMonths),
            }),
          });
          if (choice.templateId) {
            await this.runner.linkRetainerTemplate(tx, actor, choice.retainerId, choice.templateId);
          }
          retainer = { id: choice.retainerId, name: renewed.name };
          for (const code of renewed.departments) departments.add(code);
        }
      }

      const proof = input.proofUploadId
        ? await this.files.attachUpload(tx, actor, {
            ownerType: 'quote',
            ownerId: quote.id,
            clientId: client.id,
            uploadId: input.proofUploadId,
          })
        : null;
      const [updated] = await tx
        .update(quotes)
        .set({
          status: 'accepted',
          respondedOn: input.respondedOn,
          responseContactId: contactId,
          responseNote: input.note,
          respondedById: actor.id,
          projectId: project?.id ?? null,
          retainerId: retainer?.id ?? null,
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, quote.id))
        .returning();
      if (!updated) throw new Error('The quote was not accepted');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'quote.accepted',
        entityType: 'quote',
        entityId: quote.id,
        before: { ...identity(quote), status: quote.status },
        after: {
          ...identity(quote),
          status: 'accepted',
          respondedOn: input.respondedOn,
          contactId,
          ...(input.note ? { note: input.note } : {}),
          ...(project && { projectId: project.id, project: project.name }),
          ...(retainer && { retainerId: retainer.id, retainer: retainer.name }),
          ...(proof && { proofFile: proof.name }),
        },
      });
      const discarded = await this.archiveNewerDrafts(tx, actor, quote);
      // F13 rule 2: the deposit is drafted inside the acceptance.
      await this.acceptedHooks.run(tx, {
        quoteId: quote.id,
        project: project && {
          id: project.id,
          firstInstallmentMilestoneId: project.firstInstallmentMilestoneId,
        },
        actor: actorOf(actor),
      });

      // A11: the account manager and the departments' managers, never the actor.
      const managers = await this.users.departmentManagers([...departments], tx);
      await this.notifications.notify(tx, {
        type: 'quote_accepted',
        data: {
          quote: {
            displayNumber: quoteDisplayNumber(quote),
            title: quote.title,
            client: client.name,
          },
          project: project?.name ?? null,
          retainer: retainer?.name ?? null,
        },
        recipients: [client.accountManagerId, ...[...managers.values()].flat()],
        actorId: actor.id,
        subjectId: quote.id,
      });
      return {
        detail: await this.quotes.toDetail(actor, updated, clientRecipient(client), tx),
        preview: proof?.preview ?? false,
        discarded,
      };
    });
    if (preview) await this.files.queuePreviews();
    for (const key of discarded) await this.pdf.discardPreview(key);
    return detail;
  }

  /**
   * F03 rule 11, step 0: a lead quote converts its lead first, with the quote permissions (and
   * `projects.manage` over a linked client); a client quote takes no conversion (400).
   */
  private async convert(
    tx: Transaction,
    actor: CurrentUserInfo,
    recipient: Recipient,
    input: AcceptQuote,
  ): Promise<ConversionResult | null> {
    if (recipient.kind === 'client') {
      if (input.conversion) throw new BadRequestException('Only a lead quote converts its lead');
      return null;
    }
    if (!input.conversion) {
      throw new BadRequestException('A lead quote is accepted with its conversion (step 0)');
    }
    if (input.conversion.mode === 'existing') {
      const linked = await this.clients.summary(input.conversion.clientId, tx);
      if (linked && !coversEngagements(actor, linked)) throw new ForbiddenException();
    }
    return this.leadPipeline.convert(tx, actor, recipient.id, input.conversion);
  }

  /**
   * A3: the milestones of the selected templates' stages in order, de-duplicated by name and due
   * on their latest task; without stages, one per installment. The due date defaults to the
   * plans' latest task, or the start + 30 days. Templates run from the later of the start and
   * today (F07 rule 6), as `applyToProject` will.
   */
  private async projectPlan(
    templateIds: string[],
    startDate: CalendarDate,
    children: QuoteChildren,
    tx?: Transaction,
  ): Promise<{ milestones: { name: string; dueDate: CalendarDate | null }[]; dueDate: string }> {
    const today = businessDate();
    const runStart = startDate > today ? startDate : today;
    const plans = await this.runner.planNewProject(templateIds, runStart, tx);
    const milestones = new Map<string, { name: string; dueDate: CalendarDate | null }>();
    let lastDue: CalendarDate | null = null;
    for (const templateId of templateIds) {
      const plan = plans.get(templateId);
      if (!plan) continue;
      for (const stage of plan.milestones) {
        const known = milestones.get(nameKey(stage.name));
        if (!known) milestones.set(nameKey(stage.name), { ...stage });
        else if (known.dueDate && stage.dueDate > known.dueDate) known.dueDate = stage.dueDate;
      }
      if (plan.lastDue && (!lastDue || plan.lastDue > lastDue)) lastDue = plan.lastDue;
    }
    const list =
      milestones.size > 0
        ? [...milestones.values()]
        : children.installments.map((installment) => ({ name: installment.name, dueDate: null }));
    return { milestones: list, dueDate: lastDue ?? addDays(startDate, DEFAULT_PROJECT_DAYS) };
  }

  /** A10: a newer draft of the accepted version is discarded; returns their preview objects. */
  private async archiveNewerDrafts(
    tx: Transaction,
    actor: CurrentUserInfo,
    quote: QuoteRow,
  ): Promise<string[]> {
    const drafts = await tx
      .select()
      .from(quotes)
      .where(
        and(
          eq(quotes.year, quote.year),
          eq(quotes.number, quote.number),
          gt(quotes.version, quote.version),
          eq(quotes.status, 'draft'),
          isNull(quotes.archivedAt),
        ),
      )
      .for('update');
    for (const draft of drafts) {
      await tx
        .update(quotes)
        .set({ archivedAt: new Date(), ...NO_DRAFT_PDF })
        .where(eq(quotes.id, draft.id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'quote.archived',
        entityType: 'quote',
        entityId: draft.id,
        before: { ...identity(draft), archived: false },
        after: { ...identity(draft), archived: true, byQuoteId: quote.id },
      });
    }
    return drafts.flatMap((draft) => (draft.draftPdfObjectKey ? [draft.draftPdfObjectKey] : []));
  }

  private async children(
    executor: Database | Transaction,
    quote: QuoteRow,
  ): Promise<QuoteChildren> {
    return (
      (await quoteChildren(executor, [quote.id])).get(quote.id) ?? { lines: [], installments: [] }
    );
  }
}

/** The day the version was sent: the earliest response date (A1). */
const sentOn = (quote: QuoteRow) => businessDate(quote.sentAt ?? new Date());

/**
 * A1: client scope over quotes and projects, on a `sent` version (`QUOTE_EXPIRED` once expired,
 * `INVALID_TRANSITION` otherwise).
 */
function assertMayAccept(actor: CurrentUserInfo, client: Recipient, quote: QuoteRow): void {
  if (!covers(actor, 'quotes.manage', client) || !coversEngagements(actor, client)) {
    throw new ForbiddenException();
  }
  if (!quote.archivedAt && quote.status === 'expired') {
    throw new CodedException(409, 'QUOTE_EXPIRED', 'Extend the quote before accepting it');
  }
  if (quote.archivedAt || quote.status !== 'sent') {
    throw new CodedException(409, 'INVALID_TRANSITION', 'Only a sent quote is accepted');
  }
}

/** What A2, A5 and A6 read from the lines: departments, templates and counted lines. */
function derive(children: QuoteChildren): Derived {
  const oneOff = children.lines.filter((line) => line.section === 'one_off');
  const monthly = children.lines.filter((line) => line.section === 'monthly');
  const departmentsOf = (lines: typeof oneOff) => [
    ...new Set(
      lines.flatMap((line) =>
        line.items.length > 0
          ? line.items.map((item) => item.department)
          : line.department
            ? [line.department]
            : [],
      ),
    ),
  ];

  const templates = new Map<string, SectionTemplate>();
  const bring = (templateId: string | null, rounds: number) => {
    if (!templateId) return;
    const known = templates.get(templateId);
    if (known) known.revisionLimit = Math.max(known.revisionLimit, rounds);
    else templates.set(templateId, { id: templateId, revisionLimit: rounds });
  };
  for (const line of oneOff) {
    if (line.serviceId) bring(line.templateId, line.revisionRounds ?? 0);
    for (const item of line.items) bring(item.templateId, item.revisionRounds);
  }

  const counted: CountedQuoteItem[] = [];
  for (const line of monthly) {
    if (line.serviceId && line.deliverableKind) {
      counted.push({
        kind: line.deliverableKind,
        label: line.deliverableLabel,
        quantity: line.quantity,
        revisionRounds: line.revisionRounds ?? 0,
      });
    }
    for (const item of line.items) {
      if (!item.deliverableKind) continue;
      counted.push({
        kind: item.deliverableKind,
        label: item.deliverableLabel,
        quantity: item.quantity * line.quantity,
        revisionRounds: item.revisionRounds,
      });
    }
  }
  const monthlyTemplates = [
    ...monthly.filter((line) => line.packageId).map((line) => line.templateId),
    ...monthly.filter((line) => line.serviceId).map((line) => line.templateId),
  ].filter((templateId): templateId is string => !!templateId);

  return {
    oneOff:
      oneOff.length > 0
        ? { departments: departmentsOf(oneOff), templates: [...templates.values()] }
        : null,
    monthly:
      monthly.length > 0
        ? {
            departments: departmentsOf(monthly),
            lines: mergeDeliverableLines(counted),
            templateIds: [...new Set(monthlyTemplates)],
          }
        : null,
  };
}
