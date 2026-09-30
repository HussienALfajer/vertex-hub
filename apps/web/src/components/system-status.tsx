import { useQuery } from '@tanstack/react-query';
import { Badge } from '@vertex-hub/ui';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../lib/format';
import { healthQuery } from '../lib/health';

/** The API and database health (`GET /api/health`), for the people who watch the system. */
export function SystemStatus() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useQuery(healthQuery);

  let value: string;
  if (isPending) value = t('status.checking');
  else if (isError) value = t('status.unreachable');
  else value = data.status === 'ok' ? t('status.ok') : t('status.error');
  const tone = isPending ? 'neutral' : !isError && data.status === 'ok' ? 'success' : 'danger';

  return (
    <p
      aria-live="polite"
      className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
    >
      {t('status.label')}
      <Badge tone={tone}>{value}</Badge>
      {data && (
        <span className="tabular-nums">
          {t('status.checkedAt', { time: formatDateTime(data.timestamp) })}
        </span>
      )}
    </p>
  );
}
