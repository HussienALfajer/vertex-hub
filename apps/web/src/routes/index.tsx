import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { healthQuery } from '../lib/api';
import { formatDateTime } from '../lib/format';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const { t } = useTranslation();
  return (
    <>
      <h1>{t('home.title')}</h1>
      <p>{t('home.subtitle')}</p>
      <SystemStatus />
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

  return (
    <section className="status" aria-live="polite">
      <p>
        {t('status.label')}: <strong>{value}</strong>
      </p>
      {data && <p>{t('status.checkedAt', { time: formatDateTime(data.timestamp) })}</p>}
    </section>
  );
}
