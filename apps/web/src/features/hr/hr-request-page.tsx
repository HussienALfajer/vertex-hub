import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  createHrOpinionSchema,
  HR_REQUEST_LIMITS,
  type HrRequestDetail,
  type OverlappingWork,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Skeleton,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowRightIcon,
  BanIcon,
  BriefcaseBusinessIcon,
  CameraIcon,
  CheckIcon,
  ListTodoIcon,
  MessageSquareIcon,
  PaperclipIcon,
  UsersRoundIcon,
  XIcon,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { isMissing, LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatNumber, formatTime, formatWeekdayDate } from '../../lib/format';
import { oneOfParam } from '../../lib/search-params';
import { OwnerDocumentsTab } from '../files/owner-documents-tab';
import { hrRequestQuery, useAddHrOpinion } from './hr.queries';
import { CancelRequestDialog, DecisionDialog } from './leave-dialogs';
import { RequestStatusBadge, useRequestDays, useRequestTitle, useRequestWhen } from './leave-parts';

const REQUEST_ORIGINS = ['mine', 'approvals', 'file'] as const;

export interface HrRequestSearch {
  /** Where the back link returns; unset means My attendance. */
  from?: (typeof REQUEST_ORIGINS)[number];
}

export function parseHrRequestSearch(search: Record<string, unknown>): HrRequestSearch {
  return { from: oneOfParam(REQUEST_ORIGINS, search.from) };
}

/**
 * A request (spec screen "Approvals"): its days, the split, notice, the certificate, the opinions
 * and, for `hr.approve` on a leave, the employee's work in the period (rule B14), with the
 * actions the caller may take. The employee reaches their own here too.
 */
export function HrRequestPage({ id, search }: { id: string; search: HrRequestSearch }) {
  const { t } = useTranslation();
  const request = useQuery(hrRequestQuery(id));
  const from = search.from ?? 'mine';
  return (
    <>
      <div>
        <BackLink from={from} userId={request.data?.user.id} />
      </div>
      {request.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-28" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        </div>
      ) : request.isError ? (
        <LoadError
          message={
            isMissing(request.error) ? t('hr.requests.notFound') : t('hr.requests.loadError')
          }
          onRetry={() => request.refetch()}
          error={request.error}
        />
      ) : (
        <Request request={request.data} />
      )}
    </>
  );
}

function BackLink({ from, userId }: { from: HrRequestSearch['from']; userId?: string }) {
  const { t } = useTranslation();
  const icon = <ArrowRightIcon className="ltr:-scale-x-100" />;
  if (from === 'approvals') {
    return (
      <Button variant="ghost" size="sm" render={<Link to="/hr/approvals" />}>
        {icon}
        {t('hr.requests.back.approvals')}
      </Button>
    );
  }
  if (from === 'file' && userId) {
    return (
      <Button
        variant="ghost"
        size="sm"
        render={<Link to="/hr/people/$userId" params={{ userId }} search={{ tab: 'leave' }} />}
      >
        {icon}
        {t('hr.requests.back.file')}
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      render={<Link to="/me/attendance" search={{ tab: 'requests' }} />}
    >
      {icon}
      {t('hr.requests.back.mine')}
    </Button>
  );
}

function Request({ request }: { request: HrRequestDetail }) {
  const { t } = useTranslation();
  const title = useRequestTitle();
  const when = useRequestWhen();
  const days = useRequestDays();
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const actions = useRef<HTMLDivElement>(null);
  const { canDecide, canCancel, canGiveOpinion } = request.permissions;
  const certificateMissing = request.certificateRequired && request.documents === 0;
  // A sick leave holds its certificate; any request shows documents someone attached.
  const documents = request.leaveType === 'sick' || request.documents > 0;
  const recordedBy = request.createdBy.id !== request.user.id ? request.createdBy : null;

  return (
    <>
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 sm:flex-row sm:items-center">
        <Avatar name={request.user.name} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm text-muted-foreground">{request.user.name}</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{title(request)}</h1>
            <RequestStatusBadge status={request.status} />
            {request.shortNotice && <Badge tone="gold">{t('hr.requests.shortNotice')}</Badge>}
          </div>
          <p className="text-muted-foreground">
            {[when(request), days(request)].filter(Boolean).join(' · ')}
          </p>
        </div>
        {(canDecide || canCancel) && (
          <div ref={actions} className="flex shrink-0 flex-wrap items-center gap-2">
            {canCancel && (
              <Button variant="outline" onClick={() => setCancelling(true)}>
                <BanIcon />
                {t('hr.requests.cancel.action')}
              </Button>
            )}
            {canDecide && (
              <>
                <Button variant="outline" onClick={() => setDeciding('reject')}>
                  <XIcon />
                  {t('hr.requests.decide.reject')}
                </Button>
                <Button onClick={() => setDeciding('approve')}>
                  <CheckIcon />
                  {t('hr.requests.decide.approve')}
                </Button>
              </>
            )}
          </div>
        )}
      </section>

      {certificateMissing && request.status === 'pending' && (
        <Callout
          tone="warning"
          icon={<PaperclipIcon />}
          title={t('hr.requests.certificateMissing')}
          description={t('hr.requests.certificateHint')}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('hr.requests.details')}</CardTitle>
          </CardHeader>
          <dl className="flex flex-col gap-3 text-sm">
            <Detail label={t('hr.requests.fields.when')}>{when(request)}</Detail>
            {request.days !== null && (
              <Detail label={t('hr.requests.fields.days')}>
                {t('hr.requests.days', {
                  count: request.days,
                  days: formatNumber(request.days),
                })}
              </Detail>
            )}
            {(request.unpaidDays ?? 0) > 0 && request.leaveType !== 'unpaid' && (
              <Detail label={t('hr.requests.fields.split')}>
                {t('hr.requests.preview.split', {
                  paid: formatNumber(request.paidDays ?? 0),
                  unpaid: formatNumber(request.unpaidDays ?? 0),
                })}
              </Detail>
            )}
            <Detail label={t('hr.requests.fields.reason')}>
              {request.reason ?? <span className="text-muted-foreground">{t('common.none')}</span>}
            </Detail>
            <Detail label={t('hr.requests.fields.submitted')}>
              {formatDateTime(request.createdAt)}
            </Detail>
            {recordedBy && (
              <Detail label={t('hr.requests.fields.recordedBy')}>{recordedBy.name}</Detail>
            )}
            {request.decidedBy && request.decidedAt && (
              <Detail
                label={
                  request.status === 'cancelled'
                    ? t('hr.requests.fields.cancelledBy')
                    : t('hr.requests.fields.decidedBy')
                }
              >
                {`${request.decidedBy.name} · ${formatDateTime(request.decidedAt)}`}
              </Detail>
            )}
            {request.decisionNote && (
              <Detail label={t('hr.requests.fields.decisionNote')}>{request.decisionNote}</Detail>
            )}
          </dl>
        </Card>
        <Opinions request={request} canGiveOpinion={canGiveOpinion} />
      </div>

      {request.overlappingWork && <OverlappingWorkCard work={request.overlappingWork} />}

      {documents && (
        <div className="flex flex-col gap-4">
          <OwnerDocumentsTab owner={{ type: 'hr_request', id: request.id }} />
        </div>
      )}

      <DecisionDialog
        request={request}
        decision={deciding}
        onClose={() => setDeciding(null)}
        finalFocus={() => actions.current?.querySelector('button') ?? true}
      />
      <CancelRequestDialog
        request={request}
        open={cancelling}
        onClose={() => setCancelling(false)}
        finalFocus={() => actions.current?.querySelector('button') ?? true}
      />
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-end break-words">{children}</dd>
    </div>
  );
}

/** Rule B14: the department managers' and Ops' opinions, and the form for one more. */
function Opinions({
  request,
  canGiveOpinion,
}: {
  request: HrRequestDetail;
  canGiveOpinion: boolean;
}) {
  const { t } = useTranslation();
  const add = useAddHrOpinion();
  const [body, setBody] = useState('');
  const [invalid, setInvalid] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const input = createHrOpinionSchema.safeParse({ requestId: request.id, body });
    if (!input.success) {
      setInvalid(true);
      field.current?.focus();
      return;
    }
    try {
      await add.mutateAsync(input.data);
      setBody('');
      toast.add({ title: t('hr.requests.opinions.added'), type: 'success' });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageSquareIcon className="size-5 text-muted-foreground" />
          {t('hr.requests.opinions.title')}
        </CardTitle>
      </CardHeader>
      {request.opinions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('hr.requests.opinions.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {request.opinions.map((opinion) => (
            <li key={opinion.id} className="flex flex-col gap-1 rounded-md bg-muted p-3 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{opinion.author.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(opinion.createdAt)}
                </span>
              </span>
              <p className="whitespace-pre-line">{opinion.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canGiveOpinion && (
        <form className="mt-4 flex flex-col gap-3" onSubmit={submit} noValidate>
          <Field invalid={invalid}>
            <FieldLabel>{t('hr.requests.opinions.label')}</FieldLabel>
            <Textarea
              ref={field}
              rows={3}
              maxLength={HR_REQUEST_LIMITS.opinion}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                setInvalid(false);
              }}
            />
            <FieldError match={invalid}>{t('hr.requests.opinions.required')}</FieldError>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <Button type="submit" variant="outline" className="self-end" disabled={add.isPending}>
            {add.isPending ? t('common.saving') : t('hr.requests.opinions.add')}
          </Button>
        </form>
      )}
    </Card>
  );
}

const WORK_ICONS = { task: ListTodoIcon, shoot: CameraIcon, meeting: UsersRoundIcon } as const;

/** Rule B14: the employee's open tasks due, shoots and meetings in the leave's period. */
function OverlappingWorkCard({ work }: { work: OverlappingWork[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <BriefcaseBusinessIcon className="size-5 text-muted-foreground" />
          {t('hr.requests.work.title')}
        </CardTitle>
      </CardHeader>
      {work.length === 0 ? (
        <EmptyState icon={<BriefcaseBusinessIcon />} title={t('hr.requests.work.empty')} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {work.map((item) => {
            const Icon = WORK_ICONS[item.kind];
            const link =
              item.kind === 'task'
                ? ({ to: '/tasks/$taskId', params: { taskId: item.id } } as const)
                : item.kind === 'shoot'
                  ? ({ to: '/shoots/$shootId', params: { shootId: item.id } } as const)
                  : ({ to: '/meetings/$meetingId', params: { meetingId: item.id } } as const);
            return (
              <li
                key={`${item.kind}-${item.id}`}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <Icon
                  role="img"
                  aria-label={t(`hr.requests.work.kinds.${item.kind}`)}
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <Link {...link} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {item.title}
                </Link>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {item.startsAt
                    ? `${formatWeekdayDate(item.date)} · ${formatTime(item.startsAt)}`
                    : t('hr.requests.work.due', { date: formatWeekdayDate(item.date) })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
