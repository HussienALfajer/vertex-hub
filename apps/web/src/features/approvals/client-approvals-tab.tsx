import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ClientDetailResponse, ClientResponseEntry } from '@vertex-hub/contracts';
import { Badge, EmptyState, Pagination, Skeleton } from '@vertex-hub/ui';
import { StampIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { formatDateTime, formatNumber } from '../../lib/format';
import { RequestsTable } from './approval-parts';
import { CLIENT_APPROVALS_PAGE_SIZE, clientApprovalsQuery } from './approvals.queries';

/**
 * The Approvals tab of the client profile (spec F09, screen 7): the client's approval requests
 * and its responses, from a link or recorded by hand, newest first. Both lists take one page.
 */
export function ClientApprovalsTab({ client }: { client: ClientDetailResponse }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const approvals = useQuery(clientApprovalsQuery(client.id, page));
  const total = Math.max(approvals.data?.requests.total ?? 0, approvals.data?.responses.total ?? 0);
  return (
    <>
      <TabHeader
        title={t('approvals.clientTab.title')}
        description={t('approvals.clientTab.hint')}
      />
      {approvals.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : approvals.isError ? (
        <LoadError
          message={t('approvals.clientTab.loadError')}
          onRetry={() => approvals.refetch()}
        />
      ) : total === 0 ? (
        <EmptyState
          icon={<StampIcon />}
          title={t('approvals.clientTab.emptyTitle')}
          description={t('approvals.clientTab.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h3 className="text-base font-bold">{t('approvals.clientTab.requests')}</h3>
            {approvals.data.requests.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('approvals.clientTab.noRequests')}</p>
            ) : (
              <RequestsTable requests={approvals.data.requests.items} showClient={false} />
            )}
          </section>
          <section className="flex flex-col gap-3">
            <h3 className="text-base font-bold">{t('approvals.clientTab.responses')}</h3>
            {approvals.data.responses.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('approvals.clientTab.noResponses')}
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {approvals.data.responses.items.map((response) => (
                  <ResponseRow key={response.id} response={response} />
                ))}
              </ol>
            )}
          </section>
          {total > CLIENT_APPROVALS_PAGE_SIZE && (
            <Pagination
              page={page}
              pageCount={Math.ceil(total / CLIENT_APPROVALS_PAGE_SIZE)}
              onPageChange={setPage}
              summary={t('common.pageSummary', {
                from: formatNumber((page - 1) * CLIENT_APPROVALS_PAGE_SIZE + 1),
                to: formatNumber(Math.min(page * CLIENT_APPROVALS_PAGE_SIZE, total)),
                total: formatNumber(total),
              })}
              previousLabel={t('common.previous')}
              nextLabel={t('common.next')}
            />
          )}
        </div>
      )}
    </>
  );
}

function ResponseRow({ response }: { response: ClientResponseEntry }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {response.task ? (
          <Link
            to="/tasks/$taskId"
            params={{ taskId: response.task.id }}
            className="font-medium hover:underline"
          >
            {response.task.title}
          </Link>
        ) : (
          // A response on a post: its page arrives with the F08 screens.
          <span className="font-medium" dir="auto">
            {response.post?.title}
          </span>
        )}
        <Badge tone={response.decision === 'approved' ? 'success' : 'warning'}>
          {t(`tasks.responses.decisions.${response.decision}`)}
        </Badge>
        <Badge tone="outline">{t(`tasks.responses.channels.${response.channel}`)}</Badge>
      </div>
      <span className="text-xs text-muted-foreground">
        {t('tasks.responses.by', {
          name: response.contact.name,
          date: formatDateTime(response.createdAt),
        })}
      </span>
      {response.note && (
        <p className="whitespace-pre-line" dir="auto">
          {response.note}
        </p>
      )}
      {response.versions.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {response.versions.map((version) => (
            <li key={version.id}>
              <Badge tone="outline" dir="auto">
                {t('tasks.reviews.version', { name: version.name, number: version.number })}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {response.recordedBy && (
        <p className="text-xs text-muted-foreground">
          {t('tasks.responses.recordedBy', { name: response.recordedBy.name })}
        </p>
      )}
    </li>
  );
}
