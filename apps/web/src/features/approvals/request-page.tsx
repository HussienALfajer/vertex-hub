import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  APPROVAL_LIMITS,
  type ApprovalItem,
  type ApprovalRequestDetail,
  type IssuedApprovalRequest,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import { ArrowRightIcon, BanIcon, BellRingIcon, RefreshCwIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { isMissing, LoadError } from '../../components/load-error';
import { formatDateTime, formatNumber } from '../../lib/format';
import { PostFacts } from '../content/post-parts';
import { FileThumbnail, VersionBadge } from '../files/file-parts';
import {
  IssuedLink,
  ItemKindBadge,
  ItemStatusBadge,
  RequestStateBadge,
  WhatsAppButton,
} from './approval-parts';
import {
  approvalRequestQuery,
  useReissueApprovalRequest,
  useRevokeApprovalRequest,
} from './approvals.queries';

/**
 * An approval request (spec F09, screen 3): who was asked, the state of the link, and what the
 * client answered on each item. Client scope reissues and revokes the link; everyone else reads.
 */
export function RequestPage({ requestId }: { requestId: string }) {
  const { t } = useTranslation();
  const request = useQuery(approvalRequestQuery(requestId));
  return (
    <>
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link to="/approvals" search={{ tab: 'sent' }} />}
        >
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('approvals.requestPage.back')}
        </Button>
      </div>
      {request.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-44" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : request.isError ? (
        <LoadError
          message={
            isMissing(request.error)
              ? t('approvals.requestPage.notFound')
              : t('approvals.requestPage.loadError')
          }
          onRetry={() => request.refetch()}
          error={request.error}
        />
      ) : (
        <RequestView request={request.data} />
      )}
    </>
  );
}

function RequestView({ request }: { request: ApprovalRequestDetail }) {
  const { t } = useTranslation();
  const decided = request.counts.approved + request.counts.changesRequested;
  return (
    <>
      <section className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t('approvals.requestPage.kicker')}</p>
            <h1 className="text-2xl font-bold">
              <Link
                to="/clients/$clientId"
                params={{ clientId: request.client.id }}
                search={{ tab: 'approvals' }}
                className="hover:underline"
              >
                {request.client.name}
              </Link>
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <RequestStateBadge state={request.state} />
              <Badge tone="outline" className="tabular-nums">
                {t('approvals.sent.decided', {
                  decided: formatNumber(decided),
                  total: formatNumber(request.counts.total),
                })}
              </Badge>
            </div>
          </div>
          <RequestActions request={request} />
        </div>
        <dl className="grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <Fact label={t('approvals.requestPage.contact')}>
            <span className="flex flex-wrap items-center gap-2">
              {request.contact.name}
              {request.contact.archived && (
                <Badge tone="neutral">{t('approvals.requestPage.contactArchived')}</Badge>
              )}
            </span>
          </Fact>
          <Fact label={t('approvals.sent.columns.issued')}>{formatDateTime(request.issuedAt)}</Fact>
          <Fact label={t('approvals.sent.columns.expires')}>
            {formatDateTime(request.expiresAt)}
          </Fact>
          <Fact label={t('approvals.requestPage.reminded')}>
            {request.remindedAt ? formatDateTime(request.remindedAt) : t('common.none')}
          </Fact>
          <Fact label={t('approvals.sent.columns.createdBy')}>{request.createdBy.name}</Fact>
        </dl>
        {request.message && (
          <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-xs text-muted-foreground">
              {t('approvals.requestPage.message')}
            </span>
            <p className="whitespace-pre-line" dir="auto">
              {request.message}
            </p>
          </div>
        )}
      </section>

      {request.state === 'expired' && request.counts.pending > 0 && (
        <Callout
          tone="warning"
          icon={<BellRingIcon />}
          title={t('approvals.requestPage.expiredTitle')}
          description={t('approvals.requestPage.expiredBody')}
        />
      )}

      <ol className="flex flex-col gap-4">
        {request.items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            mixed={request.items.some((other) => other.kind !== item.kind)}
          />
        ))}
      </ol>
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * Reissue shows the new link once (rule 11); revoke withdraws what still waits (rule 12). After
 * the 48-hour notice, a reminder without the link goes to the contact by WhatsApp (rule 24).
 */
function RequestActions({ request }: { request: ApprovalRequestDetail }) {
  const { t } = useTranslation();
  const reissue = useReissueApprovalRequest(request.id);
  const revoke = useRevokeApprovalRequest(request.id);
  const [confirming, setConfirming] = useState<'reissue' | 'revoke' | null>(null);
  const [issued, setIssued] = useState<IssuedApprovalRequest | null>(null);
  const { canReissue, canRevoke } = request.permissions;
  const reminds =
    canReissue &&
    request.state === 'open' &&
    request.counts.pending > 0 &&
    request.remindedAt !== null &&
    request.contactPhone !== null;
  if (!canReissue && !canRevoke) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {reminds && request.contactPhone && (
        <WhatsAppButton
          phone={request.contactPhone}
          text={t('approvals.requestPage.reminderMessage', { name: request.contact.name })}
          label={t('approvals.requestPage.remind')}
        />
      )}
      {canReissue && (
        <Button variant="outline" onClick={() => setConfirming('reissue')}>
          <RefreshCwIcon />
          {t('approvals.requestPage.reissue')}
        </Button>
      )}
      {canRevoke && (
        <Button variant="outline" onClick={() => setConfirming('revoke')}>
          <BanIcon />
          {t('approvals.requestPage.revoke')}
        </Button>
      )}
      <ConfirmDialog
        open={confirming === 'reissue'}
        onClose={() => setConfirming(null)}
        title={t('approvals.requestPage.reissueTitle')}
        body={t('approvals.requestPage.reissueBody', {
          days: formatNumber(APPROVAL_LIMITS.linkDays),
        })}
        action={t('approvals.requestPage.reissue')}
        pending={reissue.isPending}
        onConfirm={async () => setIssued(await reissue.mutateAsync(undefined))}
      />
      <ConfirmDialog
        open={confirming === 'revoke'}
        onClose={() => setConfirming(null)}
        title={t('approvals.requestPage.revokeTitle')}
        body={t('approvals.requestPage.revokeBody')}
        action={t('approvals.requestPage.revoke')}
        destructive
        pending={revoke.isPending}
        onConfirm={async () => {
          await revoke.mutateAsync(undefined);
          toast.add({ title: t('approvals.requestPage.revoked'), type: 'success' });
        }}
      />
      {issued && (
        <Dialog open onOpenChange={(next) => !next && setIssued(null)}>
          <DialogContent closeLabel={t('common.close')}>
            <div className="grid gap-5">
              <DialogHeader>
                <DialogTitle>{t('approvals.requestPage.reissuedTitle')}</DialogTitle>
                <DialogDescription>
                  {t('approvals.request.issuedBody', {
                    contact: issued.contact.name,
                    date: formatDateTime(issued.expiresAt),
                  })}
                </DialogDescription>
              </DialogHeader>
              <IssuedLink
                link={issued.link}
                contactName={issued.contact.name}
                contactPhone={issued.contactPhone}
              />
              <DialogFooter>
                <Button onClick={() => setIssued(null)}>{t('approvals.request.done')}</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * One task or post of the request: the snapshot that was sent, and the client's answer on it. A
 * post shows its type, date, platforms and the start of its caption (F08 screen 6).
 */
function ItemCard({ item, mixed }: { item: ApprovalItem; mixed: boolean }) {
  const { t } = useTranslation();
  const { response, post } = item;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-base font-bold" dir="auto">
            {item.title}
          </h2>
          {item.task && (
            <Link
              to="/tasks/$taskId"
              params={{ taskId: item.task.id }}
              className="w-fit text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              {t('approvals.requestPage.task', { title: item.task.title })}
            </Link>
          )}
          {post && (
            <>
              <Link
                to="/content/posts/$postId"
                params={{ postId: post.id }}
                className="w-fit text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                {t('approvals.requestPage.post', { title: post.title })}
              </Link>
              <PostFacts post={post} />
            </>
          )}
        </div>
        <span className="flex items-center gap-2">
          {mixed && <ItemKindBadge kind={item.kind} />}
          <ItemStatusBadge status={item.status} />
        </span>
      </div>
      {item.versions.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {item.versions.map((version) => (
            <li key={version.id} className="flex w-28 flex-col gap-1.5">
              <FileThumbnail version={version} className="aspect-4/3 w-full" />
              <span className="truncate text-xs" dir="auto" title={version.name}>
                {version.name}
              </span>
              <VersionBadge number={version.number} />
            </li>
          ))}
        </ul>
      )}
      {post?.caption && (
        <p
          className="line-clamp-3 rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-line"
          dir="auto"
        >
          {post.caption}
        </p>
      )}
      {item.text && (
        <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2 text-sm">
          <span className="text-xs text-muted-foreground">{t('tasks.reviews.text')}</span>
          <p className="whitespace-pre-line" dir="auto">
            {item.text}
          </p>
        </div>
      )}
      {response && (
        <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
          <span className="text-xs text-muted-foreground">
            {t('approvals.requestPage.answered', {
              channel: t(`tasks.responses.channels.${response.channel}`),
              date: formatDateTime(response.createdAt),
            })}
          </span>
          {response.note && (
            <p className="whitespace-pre-line" dir="auto">
              {response.note}
            </p>
          )}
        </div>
      )}
      {item.status === 'withdrawn' && item.withdrawnReason && (
        <p className="border-t border-border pt-3 text-sm text-muted-foreground">
          {t(`approvals.withdrawnReasons.${item.withdrawnReason}`)}
          {item.closedAt && ` · ${formatDateTime(item.closedAt)}`}
        </p>
      )}
    </li>
  );
}
