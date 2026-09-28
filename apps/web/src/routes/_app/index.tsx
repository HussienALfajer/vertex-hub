import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Badge, Card, CardHeader, CardTitle, PageHeader } from '@vertex-hub/ui';
import { useTranslation } from 'react-i18next';
import { healthQuery } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

export const Route = createFileRoute('/_app/')({
  component: HomePage,
});

function HomePage() {
  const { t } = useTranslation();
  const { me } = Route.useRouteContext();
  return (
    <>
      <PageHeader
        title={t('home.title')}
        description={t('home.greeting', { name: me.user.name })}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('home.rolesTitle')}</CardTitle>
          </CardHeader>
          {me.roles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {me.roles.map((role) => (
                <Badge key={role} tone="outline">
                  {t(`roles.${role}`)}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">{t('home.rolesEmpty')}</p>
          )}
        </Card>
        <SystemStatus />
      </div>
    </>
  );
}

function SystemStatus() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useQuery(healthQuery);

  let value: string;
  if (isPending) value = t('status.checking');
  else if (isError) value = t('status.unreachable');
  else value = data.status === 'ok' ? t('status.ok') : t('status.error');
  const tone = isPending ? 'neutral' : !isError && data.status === 'ok' ? 'success' : 'danger';

  return (
    <Card aria-live="polite">
      <CardHeader>
        <CardTitle>{t('status.label')}</CardTitle>
      </CardHeader>
      <div className="flex flex-col items-start gap-2">
        <Badge tone={tone}>{value}</Badge>
        {data && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {t('status.checkedAt', { time: formatDateTime(data.timestamp) })}
          </p>
        )}
      </div>
    </Card>
  );
}
