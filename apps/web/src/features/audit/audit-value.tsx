import { ROLES, USER_STATUSES } from '@vertex-hub/contracts';
import { Badge } from '@vertex-hub/ui';
import { useTranslation } from 'react-i18next';

const isNamed = (value: unknown): value is { name: string } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { name?: unknown }).name === 'string';

/** A value from an audit entry's before/after, shown the way the rest of the app shows it. */
export function AuditValue({ field, value }: { field: string; value: unknown }) {
  const { t } = useTranslation();
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;

  if (value === null || value === undefined || value === '') return none;
  if (Array.isArray(value)) {
    if (value.length === 0) return none;
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((item) => {
          const label =
            field === 'roles' && ROLES.includes(item)
              ? t(`roles.${item as (typeof ROLES)[number]}`)
              : isNamed(item)
                ? item.name
                : String(item);
          return (
            <Badge key={label} tone="outline">
              {label}
            </Badge>
          );
        })}
      </span>
    );
  }
  if (isNamed(value)) return <span>{value.name}</span>;
  if (typeof value === 'boolean') {
    return (
      <span>
        {field === 'twoFactorEnabled'
          ? value
            ? t('account.twoFactor.on')
            : t('account.twoFactor.off')
          : value
            ? t('common.yes')
            : t('common.no')}
      </span>
    );
  }
  if (field === 'status') {
    const status = USER_STATUSES.find((known) => known === value);
    if (status) return <span>{t(`users.statuses.${status}`)}</span>;
  }
  if (field === 'kind' && (value === 'activation' || value === 'reset')) {
    return <span>{t(`audit.kinds.${value}`)}</span>;
  }
  const text = String(value);
  return field === 'email' || field === 'phone' ? (
    <span dir="ltr">{text}</span>
  ) : (
    <span>{text}</span>
  );
}
