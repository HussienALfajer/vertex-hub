import { useQuery } from '@tanstack/react-query';
import type { EmailStatus, EmailSummary } from '@vertex-hub/contracts';
import { Badge, Card, Skeleton } from '@vertex-hub/ui';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatDateTime, formatList } from '../../lib/format';
import { type EmailHistoryTarget, emailHistoryQuery } from './email.queries';

const STATUS_TONES = { queued: 'neutral', sent: 'success', failed: 'danger' } as const;

export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONES[status]}>{t(`email.statuses.${status}`)}</Badge>;
}

/** The names an email went to, then its copies. */
export function EmailRecipients({ email }: { email: Pick<EmailSummary, 'to' | 'cc'> }) {
  const { t } = useTranslation();
  return (
    <>
      {formatList(email.to.map((address) => address.name))}
      {email.cc.length > 0 && (
        <span className="text-muted-foreground">
          {' · '}
          {t('email.cc', { names: formatList(email.cc.map((address) => address.name)) })}
        </span>
      )}
    </>
  );
}

/**
 * F14 email screen 5: a document's emails, newest first, with who sent them, to whom, and their
 * state; a failed one shows its error (rule 23).
 */
export function EmailHistory({ target }: { target: EmailHistoryTarget }) {
  const { t } = useTranslation();
  const history = useQuery(emailHistoryQuery(target));
  return (
    <Card className="gap-3 p-5">
      <h2 className="font-bold">{t('email.history.title')}</h2>
      {history.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : history.isError ? (
        <LoadError message={t('email.history.loadError')} onRetry={() => history.refetch()} />
      ) : history.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('email.history.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {history.data.items.map((email) => (
            <li key={email.id} className="flex flex-col gap-1 py-2.5 text-sm first:pt-0 last:pb-0">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{t(`email.kinds.${email.kind}`)}</span>
                <EmailStatusBadge status={email.status} />
              </span>
              <span>
                <EmailRecipients email={email} />
              </span>
              <span className="text-xs text-muted-foreground">
                {t('email.history.by', {
                  name: email.sender?.name ?? t('email.system'),
                  time: formatDateTime(email.sentAt ?? email.createdAt),
                })}
              </span>
              {email.status === 'failed' && email.error && (
                <span className="text-xs text-destructive-text" dir="auto">
                  {email.error}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
