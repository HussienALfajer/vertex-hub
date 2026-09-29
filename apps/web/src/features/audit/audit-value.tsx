import {
  type AuditEntityType,
  CLIENT_PLATFORMS,
  CLIENT_STATUSES,
  NOTE_CHANNELS,
  PLATFORM_ACCESS_STATES,
  ROLES,
  USER_STATUSES,
} from '@vertex-hub/contracts';
import { Badge, ColorSwatch } from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../lib/format';

type Item = Record<string, unknown>;

const isItem = (value: unknown): value is Item => typeof value === 'object' && value !== null;

const text = (item: Item, key: string) =>
  typeof item[key] === 'string' ? (item[key] as string) : undefined;

/** Fields whose values are codes, links or numbers: read left to right. */
const LTR_FIELDS = new Set(['email', 'phone', 'url', 'contactId']);

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
    const user = find(USER_STATUSES);
    if (user) return t(`users.statuses.${user}`);
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
}: {
  entityType: AuditEntityType;
  field: string;
  value: unknown;
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
  const label = enumLabel(t, entityType, field, value);
  if (label) return <span>{label}</span>;
  if (field === 'occurredAt' && typeof value === 'string') {
    return <span className="tabular-nums">{formatDateTime(value)}</span>;
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

/** One entry of a list value: a role, a skill, or an item of a client's brand kit. */
function ListItem({
  entityType,
  field,
  item,
}: {
  entityType: AuditEntityType;
  field: string;
  item: unknown;
}) {
  const { t } = useTranslation();
  if (!isItem(item)) {
    return <Badge tone="outline">{enumLabel(t, entityType, field, item) ?? String(item)}</Badge>;
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
