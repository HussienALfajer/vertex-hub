import {
  AD_CAMPAIGN_STATUSES,
  AD_FUNDINGS,
  AD_OBJECTIVES,
  AD_PLATFORMS,
  AD_WALLET_ENTRY_KINDS,
  AMENDMENT_KINDS,
  AMENDMENT_SCOPES,
  AMENDMENT_STATUSES,
  APPROVAL_WITHDRAWN_REASONS,
  type AuditEntityType,
  BRAND_FILE_KINDS,
  CATALOG_BILLINGS,
  CLIENT_DECISIONS,
  CLIENT_PLATFORMS,
  CLIENT_STATUSES,
  CREW_ROLES,
  CYCLE_STATUSES,
  DELIVERABLE_KINDS,
  DEPARTMENT_CODES,
  type DepartmentCode,
  DISCOUNT_APPROVALS,
  EXTRA_WORK_BILLING,
  FILE_FINAL_SOURCES,
  FILE_VERSION_KINDS,
  INVOICE_ORIGINS,
  INVOICE_STATUSES,
  LEAD_LOSS_REASONS,
  LEAD_SOURCES,
  LEAD_STAGES,
  MEETING_STATUSES,
  MILESTONE_STATUSES,
  NOTE_CHANNELS,
  PAYMENT_METHODS,
  PLATFORM_ACCESS_STATES,
  POST_STATUSES,
  POST_TYPES,
  PROJECT_STATUSES,
  QUOTE_REJECTION_REASONS,
  QUOTE_STATUSES,
  REQUEST_SCOPES,
  RESPONSE_CHANNELS,
  RETAINER_CHARGE_KINDS,
  RETAINER_CHARGE_STATUSES,
  RETAINER_STATUSES,
  REVIEW_OUTCOMES,
  REVIEW_STAGES,
  REVISION_DECISIONS,
  REVISION_SOURCES,
  ROLES,
  SHOOT_STATUSES,
  SHOOT_TYPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  TEMPLATE_KINDS,
  TEMPLATE_RUN_TRIGGERS,
  TERM_END_ACTIONS,
  TERM_STATUSES,
  USER_STATUSES,
} from '@vertex-hub/contracts';
import { Badge, ColorSwatch } from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatMonth,
  formatNumber,
} from '../../lib/format';
import { formatAmount, rateText } from '../../lib/money';
import { useDepartmentNames } from '../projects/project-badges';
import { lineName } from '../retainers/retainer-badges';
import { splitMentions } from '../tasks/mentions';

type Item = Record<string, unknown>;

/** Names the log shows instead of the ids an entry records. */
export interface AuditNames {
  user: (id: string) => string | undefined;
  department: (id: string) => string | undefined;
  service: (id: string) => string | undefined;
}

const isItem = (value: unknown): value is Item => typeof value === 'object' && value !== null;

const text = (item: Item, key: string) =>
  typeof item[key] === 'string' ? (item[key] as string) : undefined;

/** Fields whose values are codes, links or numbers: read left to right. */
const LTR_FIELDS = new Set([
  'email',
  'phone',
  'url',
  'contactId',
  'host',
  'mapUrl',
  'onlineUrl',
  'rawFilesSite',
]);

/** Fields that hold an instant. */
const DATE_TIME_FIELDS = new Set([
  'occurredAt',
  'expiresAt',
  'startsAt',
  'endsAt',
  'publishedAt',
  'closedAt',
]);

/** Fields that hold the first day of a month (F05B terms and amendments). */
const MONTH_FIELDS = new Set(['month', 'startMonth', 'endMonth', 'effectiveMonth']);

/** Fields that hold a user's id. */
const USER_ID_FIELDS = new Set([
  'assigneeId',
  'responsibleId',
  'ownerId',
  'organizerId',
  'attendeeIds',
  'mentionedUserIds',
]);

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A user, department or catalog service named from its id, or undefined. */
function namedId(field: string, value: unknown, names: AuditNames): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (USER_ID_FIELDS.has(field)) return names.user(value);
  if (field === 'primaryDepartmentId') return names.department(value);
  if (field === 'serviceId') return names.service(value);
  return undefined;
}

/** Money fields hold minor units (ADR 0006); the currency is a field of its own. */
const isMoneyField = (field: string) => field.endsWith('Minor');

/** Why a healthcare flag change moved a task between the medical stage and the client (F09). */
const HEALTHCARE_REASONS = ['healthcare_on', 'healthcare_off'] as const;

/** Why the system changed a record on its own: closed a shoot's task, ended a retainer's terms. */
const SYSTEM_REASONS = [
  'shoot_closed',
  'post_return',
  'task_linked',
  'retainer_ended',
  'end_action_changed',
  'quote_renewal',
] as const;

/** Translates a value from one of the contract's fixed lists, or returns undefined. */
function enumLabel(
  t: TFunction,
  entityType: AuditEntityType,
  field: string,
  value: unknown,
): string | undefined {
  const find = <T extends string>(list: readonly T[]) => list.find((known) => known === value);
  if (field === 'status') {
    const client = entityType === 'client' ? find(CLIENT_STATUSES) : undefined;
    if (client) return t(`clients.statuses.${client}`);
    const project = entityType === 'project' ? find(PROJECT_STATUSES) : undefined;
    if (project) return t(`projects.statuses.${project}`);
    const milestone = entityType === 'project_milestone' ? find(MILESTONE_STATUSES) : undefined;
    if (milestone) return t(`projects.milestones.statuses.${milestone}`);
    const retainer = entityType === 'retainer' ? find(RETAINER_STATUSES) : undefined;
    if (retainer) return t(`retainers.statuses.${retainer}`);
    const cycle = entityType === 'retainer_cycle' ? find(CYCLE_STATUSES) : undefined;
    if (cycle) return t(`retainers.cycleStatuses.${cycle}`);
    const term = entityType === 'retainer_term' ? find(TERM_STATUSES) : undefined;
    if (term) return t(`retainers.terms.statuses.${term}`);
    const charge = entityType === 'retainer_charge' ? find(RETAINER_CHARGE_STATUSES) : undefined;
    if (charge) return t(`retainers.chargeStatuses.${charge}`);
    const amendment = entityType === 'retainer_amendment' ? find(AMENDMENT_STATUSES) : undefined;
    if (amendment) return t(`retainers.amendments.statuses.${amendment}`);
    const task = entityType === 'task' ? find(TASK_STATUSES) : undefined;
    if (task) return t(`tasks.statuses.${task}`);
    const shoot = entityType === 'shoot' ? find(SHOOT_STATUSES) : undefined;
    if (shoot) return t(`calendar.shootStatuses.${shoot}`);
    const meeting = entityType === 'meeting' ? find(MEETING_STATUSES) : undefined;
    if (meeting) return t(`calendar.meetingStatuses.${meeting}`);
    const user = find(USER_STATUSES);
    if (user) return t(`users.statuses.${user}`);
  }
  if (field === 'status' && (entityType === 'invoice' || entityType === 'payment')) {
    const invoice = find(INVOICE_STATUSES);
    if (invoice) return t(`invoices.statuses.${invoice}`);
  }
  if (entityType === 'invoice' && field === 'origin') {
    const origin = find(INVOICE_ORIGINS);
    if (origin) return t(`invoices.origins.${origin}`);
  }
  if (field === 'method') {
    const method = find(PAYMENT_METHODS);
    if (method) return t(`invoices.methods.${method}`);
  }
  if (entityType === 'ad_campaign') {
    const status = field === 'status' ? find(AD_CAMPAIGN_STATUSES) : undefined;
    if (status) return t(`campaigns.statuses.${status}`);
    const platform = field === 'platform' ? find(AD_PLATFORMS) : undefined;
    if (platform) return t(`campaigns.platforms.${platform}`);
    const objective = field === 'objective' ? find(AD_OBJECTIVES) : undefined;
    if (objective) return t(`campaigns.objectives.${objective}`);
    const funding = field === 'funding' ? find(AD_FUNDINGS) : undefined;
    if (funding) return t(`campaigns.funding.${funding}`);
  }
  if (entityType === 'ad_wallet_entry' && field === 'kind') {
    const kind = find(AD_WALLET_ENTRY_KINDS);
    if (kind) return t(`campaigns.ledger.kinds.${kind}`);
  }
  if (entityType === 'lead') {
    const stage = field === 'stage' ? find(LEAD_STAGES) : undefined;
    if (stage) return t(`leads.stages.${stage}`);
    const source = field === 'source' ? find(LEAD_SOURCES) : undefined;
    if (source) return t(`leads.sources.${source}`);
    const lost = field === 'lostReason' ? find(LEAD_LOSS_REASONS) : undefined;
    if (lost) return t(`leads.lossReasons.${lost}`);
    if (field === 'mode' && (value === 'new' || value === 'existing')) {
      return t(`leads.convert.modes.${value}`);
    }
  }
  if (entityType === 'post') {
    const source = field === 'source' ? find(REVISION_SOURCES) : undefined;
    if (source) return t(`tasks.revisionSources.${source}`);
    const status = field === 'status' ? find(POST_STATUSES) : undefined;
    if (status) return t(`content.statuses.${status}`);
    const type = field === 'type' ? find(POST_TYPES) : undefined;
    if (type) return t(`content.types.${type}`);
  }
  if (entityType === 'retainer_amendment' && field === 'kind') {
    const kind = find(AMENDMENT_KINDS);
    if (kind) return t(`audit.amendmentKinds.${kind}`);
  }
  if (entityType === 'template_run' && field === 'trigger') {
    const trigger = find(TEMPLATE_RUN_TRIGGERS);
    if (trigger) return t(`audit.triggers.${trigger}`);
  }
  // Why the system changed a record (tasks, posts, F05B terms and amendments).
  if (field === 'reason' || field === 'cause') {
    const reason = find(SYSTEM_REASONS);
    if (reason) return t(`audit.reasons.${reason}`);
  }
  if (entityType === 'shoot' && field === 'type') {
    const type = find(SHOOT_TYPES);
    if (type) return t(`calendar.shootTypes.${type}`);
  }
  if (entityType === 'task') {
    const priority = field === 'priority' ? find(TASK_PRIORITIES) : undefined;
    if (priority) return t(`tasks.priorities.${priority}`);
    const type = field === 'type' ? find(TASK_TYPES) : undefined;
    if (type) return t(`tasks.types.${type}`);
    const scope = field === 'requestScope' ? find(REQUEST_SCOPES) : undefined;
    if (scope) return t(`tasks.requestScopes.${scope}`);
    const source = field === 'revisionSource' ? find(REVISION_SOURCES) : undefined;
    if (source) return t(`tasks.revisionSources.${source}`);
    const decision = field === 'decision' ? find(REVISION_DECISIONS) : undefined;
    if (decision) return t(`tasks.revisions.decisions.${decision}`);
    // A manual response is recorded on the task; a link response also on its request (F09).
    const channel = field === 'channel' ? find(RESPONSE_CHANNELS) : undefined;
    if (channel) return t(`tasks.responses.channels.${channel}`);
    const reason = field === 'reason' ? find(HEALTHCARE_REASONS) : undefined;
    if (reason) return t(`audit.reasons.${reason}`);
  }
  if (entityType === 'post' || entityType === 'approval_request') {
    const channel = field === 'channel' || field === 'via' ? find(RESPONSE_CHANNELS) : undefined;
    if (channel) return t(`tasks.responses.channels.${channel}`);
  }
  if (entityType === 'task' || entityType === 'approval_request' || entityType === 'post') {
    const stage = field === 'stage' || field === 'reviewStage' ? find(REVIEW_STAGES) : undefined;
    if (stage) return t(`tasks.reviews.stages.${stage}`);
    const outcome = field === 'outcome' ? find(REVIEW_OUTCOMES) : undefined;
    if (outcome) return t(`tasks.reviews.outcomes.${outcome}`);
    const response = field === 'decision' ? find(CLIENT_DECISIONS) : undefined;
    if (response) return t(`tasks.responses.decisions.${response}`);
    if (field === 'via' && value === 'approval_link') return t('audit.via.approval_link');
  }
  if (entityType === 'approval_request' && field === 'reason') {
    const withdrawn = find(APPROVAL_WITHDRAWN_REASONS);
    if (withdrawn) return t(`audit.reasons.${withdrawn}`);
  }
  if (field === 'billingStatus') {
    const billing = find(EXTRA_WORK_BILLING);
    if (billing) return t(`projects.extraWork.billing.${billing}`);
  }
  if (field === 'roles') {
    const role = find(ROLES);
    if (role) return t(`roles.${role}`);
  }
  if (field === 'platform' || field === 'platforms') {
    const platform = find(CLIENT_PLATFORMS);
    if (platform) return t(`clients.platforms.names.${platform}`);
  }
  if (field === 'agencyAccess') {
    const access = find(PLATFORM_ACCESS_STATES);
    if (access) return t(`clients.platforms.access.${access}`);
  }
  if (field === 'channel') {
    const channel = find(NOTE_CHANNELS);
    if (channel) return t(`clients.notes.channels.${channel}`);
  }
  if (field === 'endAction') {
    const action = find(TERM_END_ACTIONS);
    if (action) return t(`retainers.terms.endActions.${action}`);
  }
  if (field === 'scope' && entityType === 'retainer_amendment') {
    const scope = find(AMENDMENT_SCOPES);
    if (scope) return t(`retainers.amendments.scopes.${scope}`);
  }
  if (field === 'kind' && entityType === 'retainer_charge') {
    const kind = find(RETAINER_CHARGE_KINDS);
    if (kind) return t(`retainers.chargeKinds.${kind}`);
  }
  if (field === 'kind' && entityType === 'retainer_cycle') {
    const kind = find(DELIVERABLE_KINDS);
    if (kind) return t(`retainers.kinds.${kind}`);
  }
  if (
    field === 'billing' &&
    (entityType === 'catalog_service' || entityType === 'catalog_package')
  ) {
    const billing = find(CATALOG_BILLINGS);
    if (billing) return t(`catalog.billings.${billing}`);
  }
  if (field === 'deliverableKind' && entityType === 'catalog_service') {
    const kind = find(DELIVERABLE_KINDS);
    if (kind) return t(`retainers.kinds.${kind}`);
  }
  if (entityType === 'quote') {
    const status = field === 'status' ? find(QUOTE_STATUSES) : undefined;
    if (status) return t(`quotes.statuses.${status}`);
    const approval = field === 'discountApproval' ? find(DISCOUNT_APPROVALS) : undefined;
    if (approval) return t(`quotes.approvals.${approval}`);
    const reason = field === 'reason' ? find(QUOTE_REJECTION_REASONS) : undefined;
    if (reason) return t(`quotes.rejectionReasons.${reason}`);
  }
  if (field === 'kind' && entityType === 'template') {
    const kind = find(TEMPLATE_KINDS);
    if (kind) return t(`templates.kinds.${kind}`);
  }
  if (entityType === 'file_item') {
    const kind = field === 'kind' ? find(FILE_VERSION_KINDS) : undefined;
    if (kind) return t(`files.versionKinds.${kind}`);
    const brandKind = field === 'brandKind' ? find(BRAND_FILE_KINDS) : undefined;
    if (brandKind) return t(`clients.brandKit.fileKinds.${brandKind}`);
    const source = field === 'source' ? find(FILE_FINAL_SOURCES) : undefined;
    if (source) return t(`files.finalSources.${source}`);
  }
  if (field === 'kind' && (value === 'activation' || value === 'reset')) {
    return t(`audit.kinds.${value}`);
  }
  return undefined;
}

/** A value from an audit entry's before/after, shown the way the rest of the app shows it. */
export function AuditValue({
  entityType,
  field,
  value,
  names,
}: {
  entityType: AuditEntityType;
  field: string;
  value: unknown;
  names: AuditNames;
}) {
  const { t } = useTranslation();
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;

  if (value === null || value === undefined || value === '') return none;
  if (Array.isArray(value)) {
    if (value.length === 0) return none;
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((item, index) => (
          <ListItem
            // biome-ignore lint/suspicious/noArrayIndexKey: an entry's list never reorders, and may repeat a value (a term's monthly amounts)
            key={index}
            entityType={entityType}
            field={field}
            item={item}
            names={names}
          />
        ))}
      </span>
    );
  }
  if (isItem(value) && text(value, 'name')) return <span>{text(value, 'name')}</span>;
  // An approval link's email (F14): its recipients.
  if (field === 'email' && isItem(value) && Array.isArray(value.to)) {
    return (
      <span>
        {value.to
          .filter(isItem)
          .map((to) => text(to, 'name') ?? text(to, 'email'))
          .join('، ')}
      </span>
    );
  }
  if (typeof value === 'boolean') {
    if (field === 'twoFactorEnabled') {
      return <span>{value ? t('account.twoFactor.on') : t('account.twoFactor.off')}</span>;
    }
    return <span>{value ? t('common.yes') : t('common.no')}</span>;
  }
  if (field === 'department' && DEPARTMENT_CODES.some((code) => code === value)) {
    return <DepartmentItem code={value as DepartmentCode} />;
  }
  const label = enumLabel(t, entityType, field, value);
  if (label) return <span>{label}</span>;
  const named = namedId(field, value, names);
  if (named) return <span>{named}</span>;
  // A comment's mentions are `@{id}` tokens (F06): shown by name.
  if (field === 'body' && typeof value === 'string') {
    return (
      <span className="whitespace-pre-line">
        {splitMentions(value)
          .map((part) => ('text' in part ? part.text : `@${names.user(part.mention) ?? '…'}`))
          .join('')}
      </span>
    );
  }
  if (field === 'sypPerUsd' && typeof value === 'string') {
    return (
      <span dir="ltr" className="tabular-nums">
        {rateText(value)}
      </span>
    );
  }
  if (isMoneyField(field) && typeof value === 'number') {
    return (
      <span dir="ltr" className="tabular-nums">
        {formatAmount(value)}
      </span>
    );
  }
  if (MONTH_FIELDS.has(field) && typeof value === 'string') {
    return <span>{formatMonth(value)}</span>;
  }
  if (DATE_TIME_FIELDS.has(field) && typeof value === 'string') {
    return <span className="tabular-nums">{formatDateTime(value)}</span>;
  }
  if (entityType === 'file_item' && typeof value === 'number') {
    if (field === 'number' || field === 'previousFinal') {
      return (
        <span dir="ltr" className="tabular-nums">
          {t('files.versionNumber', { number: value })}
        </span>
      );
    }
    if (field === 'sizeBytes') return <span>{formatFileSize(value)}</span>;
  }
  if (typeof value === 'string' && CALENDAR_DATE.test(value)) {
    return <span>{formatDate(value)}</span>;
  }
  if (typeof value === 'number') {
    return (
      <span dir="ltr" className="tabular-nums">
        {formatNumber(value)}
      </span>
    );
  }
  const shown = String(value);
  return LTR_FIELDS.has(field) ? (
    <span dir="ltr" className="break-all">
      {shown}
    </span>
  ) : (
    <span className="whitespace-pre-line">{shown}</span>
  );
}

/** One entry of a list value: a role, a skill, a department, or an item of a client's brand kit. */
function ListItem({
  entityType,
  field,
  item,
  names,
}: {
  entityType: AuditEntityType;
  field: string;
  item: unknown;
  names: AuditNames;
}) {
  const { t } = useTranslation();
  if (field === 'departments' && DEPARTMENT_CODES.some((code) => code === item)) {
    return <DepartmentItem code={item as DepartmentCode} />;
  }
  if (typeof item === 'number') {
    // A term's monthly amounts (F05B) are minor units.
    return (
      <Badge tone="outline" dir="ltr" className="tabular-nums">
        {field === 'schedule' ? formatAmount(item) : formatNumber(item)}
      </Badge>
    );
  }
  if (!isItem(item)) {
    return (
      <Badge tone="outline">
        {namedId(field, item, names) ?? enumLabel(t, entityType, field, item) ?? String(item)}
      </Badge>
    );
  }
  // An invoice line's service (F15): the service's name, or unclassified.
  if ('serviceId' in item && 'lineId' in item) {
    const serviceId = text(item, 'serviceId');
    return (
      <Badge tone="outline" dir="auto">
        {(serviceId && names.service(serviceId)) ?? t('reports.revenue.unclassified')}
      </Badge>
    );
  }
  // A month of an amendment's schedule or effects (F05B): the month and its amounts.
  const month = text(item, 'month');
  if (month && (typeof item.amountMinor === 'number' || typeof item.afterMinor === 'number')) {
    const amounts =
      typeof item.amountMinor === 'number'
        ? formatAmount(item.amountMinor)
        : `${typeof item.beforeMinor === 'number' ? formatAmount(item.beforeMinor) : '—'} → ${formatAmount(item.afterMinor as number)}`;
    return (
      <Badge tone="outline">
        {formatMonth(month)}:{' '}
        <span dir="ltr" className="tabular-nums">
          {amounts}
        </span>
      </Badge>
    );
  }
  const line = deliverableLine(item);
  if (line) {
    return (
      <Badge tone="outline">
        {lineName(t, line)}
        <span className="tabular-nums" dir="ltr">
          {line.count}
        </span>
      </Badge>
    );
  }
  // A package's service (F04): its name and quantity.
  const serviceName = text(item, 'serviceId') ? text(item, 'name') : undefined;
  if (serviceName && typeof item.quantity === 'number') {
    return (
      <Badge tone="outline" dir="auto">
        {t('catalog.packages.item', { n: formatNumber(item.quantity), name: serviceName })}
      </Badge>
    );
  }
  // A shoot's crew member (F11): a team member by id or a freelancer by name, with the role.
  const role = CREW_ROLES.find((known) => known === item.role);
  if (role) {
    const userId = text(item, 'userId');
    const who = text(item, 'name') ?? (userId ? names.user(userId) : undefined);
    return (
      <Badge tone="outline" dir="auto">
        {[who, t(`calendar.crewRoles.${role}`), item.isLead === true && t('calendar.form.lead')]
          .filter(Boolean)
          .join(' · ')}
      </Badge>
    );
  }
  // A conflict accepted on save (F11 rule 5): who is booked elsewhere, and where.
  const conflictUser = isItem(item.user) ? text(item.user, 'name') : undefined;
  const conflictTitle = text(item, 'title');
  if (conflictUser && conflictTitle && (item.kind === 'shoot' || item.kind === 'meeting')) {
    return (
      <Badge tone="outline" dir="auto">
        {t(`calendar.conflicts.${item.kind}`, { name: conflictUser, title: conflictTitle })}
      </Badge>
    );
  }
  // A version of a review snapshot or of a client response (F09): its file and number.
  const name = text(item, 'name');
  if (name && typeof item.number === 'number') {
    return (
      <Badge tone="outline" dir="auto">
        {t('audit.versionOf', { name, number: item.number })}
      </Badge>
    );
  }
  const hex = text(item, 'hex');
  if (hex) {
    return (
      <Badge tone="outline">
        <ColorSwatch color={hex} className="size-3.5" />
        <span dir="ltr">{hex}</span>
        {text(item, 'name')}
      </Badge>
    );
  }
  return (
    <Badge tone="outline" dir="auto">
      {text(item, 'name') ?? text(item, 'title') ?? text(item, 'label') ?? text(item, 'url')}
    </Badge>
  );
}

/**
 * A retainer's or cycle's line in an entry (`deliverables`, `lines`): its kind and label, with
 * its monthly quantity, its committed quantity, or delivered of committed at close.
 */
function deliverableLine(item: Item) {
  const kind = DELIVERABLE_KINDS.find((known) => known === item.kind);
  if (!kind) return undefined;
  const number = (key: string) => (typeof item[key] === 'number' ? (item[key] as number) : null);
  const committed = number('committed') ?? number('monthlyQuantity');
  const delivered = number('delivered');
  const count =
    committed === null
      ? ''
      : delivered === null
        ? formatNumber(committed)
        : `${formatNumber(delivered)}/${formatNumber(committed)}`;
  return { kind, label: text(item, 'label') ?? null, count };
}

/** A department code, shown by the department's current name (names are editable, F01). */
function DepartmentItem({ code }: { code: DepartmentCode }) {
  const departmentName = useDepartmentNames();
  return <Badge tone="outline">{departmentName(code) || code}</Badge>;
}
