import {
  APPROVAL_WITHDRAWN_REASONS,
  type AuditEntityType,
  BRAND_FILE_KINDS,
  CLIENT_DECISIONS,
  CLIENT_PLATFORMS,
  CLIENT_STATUSES,
  CREW_ROLES,
  CYCLE_STATUSES,
  DELIVERABLE_KINDS,
  DEPARTMENT_CODES,
  type DepartmentCode,
  EXTRA_WORK_BILLING,
  FILE_FINAL_SOURCES,
  FILE_VERSION_KINDS,
  MILESTONE_STATUSES,
  NOTE_CHANNELS,
  PLATFORM_ACCESS_STATES,
  PROJECT_STATUSES,
  REQUEST_SCOPES,
  RESPONSE_CHANNELS,
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
  USER_STATUSES,
} from '@vertex-hub/contracts';
import { Badge, ColorSwatch } from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatFileSize, formatMonth, formatNumber } from '../../lib/format';
import { formatAmount } from '../../lib/money';
import { useDepartmentNames } from '../projects/project-badges';
import { lineName } from '../retainers/retainer-badges';

type Item = Record<string, unknown>;

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
  'rawFilesSite',
]);

/** Fields that hold an instant. */
const DATE_TIME_FIELDS = new Set(['occurredAt', 'expiresAt', 'startsAt', 'endsAt']);

/** Money fields hold minor units (ADR 0006); the currency is a field of its own. */
const isMoneyField = (field: string) => field.endsWith('Minor');

/** Why a healthcare flag change moved a task between the medical stage and the client (F09). */
const HEALTHCARE_REASONS = ['healthcare_on', 'healthcare_off'] as const;

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
    const task = entityType === 'task' ? find(TASK_STATUSES) : undefined;
    if (task) return t(`tasks.statuses.${task}`);
    const shoot = entityType === 'shoot' ? find(SHOOT_STATUSES) : undefined;
    if (shoot) return t(`calendar.shootStatuses.${shoot}`);
    const user = find(USER_STATUSES);
    if (user) return t(`users.statuses.${user}`);
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
  if (entityType === 'task' || entityType === 'approval_request') {
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
  if (field === 'platform') {
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
  if (field === 'kind' && entityType === 'retainer_cycle') {
    const kind = find(DELIVERABLE_KINDS);
    if (kind) return t(`retainers.kinds.${kind}`);
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
  userName,
}: {
  entityType: AuditEntityType;
  field: string;
  value: unknown;
  /** Names the users a list refers to by id (a shoot's crew). */
  userName?: (id: string) => string | undefined;
}) {
  const { t } = useTranslation();
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;

  if (value === null || value === undefined || value === '') return none;
  if (Array.isArray(value)) {
    if (value.length === 0) return none;
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((item) => (
          <ListItem
            key={typeof item === 'string' ? item : JSON.stringify(item)}
            entityType={entityType}
            field={field}
            item={item}
            userName={userName}
          />
        ))}
      </span>
    );
  }
  if (isItem(value) && text(value, 'name')) return <span>{text(value, 'name')}</span>;
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
  if (isMoneyField(field) && typeof value === 'number') {
    return (
      <span dir="ltr" className="tabular-nums">
        {formatAmount(value)}
      </span>
    );
  }
  if (field === 'month' && typeof value === 'string') {
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
  userName,
}: {
  entityType: AuditEntityType;
  field: string;
  item: unknown;
  userName?: (id: string) => string | undefined;
}) {
  const { t } = useTranslation();
  if (field === 'departments' && DEPARTMENT_CODES.some((code) => code === item)) {
    return <DepartmentItem code={item as DepartmentCode} />;
  }
  if (!isItem(item)) {
    return <Badge tone="outline">{enumLabel(t, entityType, field, item) ?? String(item)}</Badge>;
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
  // A shoot's crew member (F11): a team member by id or a freelancer by name, with the role.
  const role = CREW_ROLES.find((known) => known === item.role);
  if (role) {
    const userId = text(item, 'userId');
    const who = text(item, 'name') ?? (userId ? userName?.(userId) : undefined);
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
      {text(item, 'name') ?? text(item, 'label') ?? text(item, 'url')}
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
