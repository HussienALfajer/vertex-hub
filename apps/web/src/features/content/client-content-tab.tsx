import { useQuery } from '@tanstack/react-query';
import {
  APPROVAL_LIMITS,
  businessDate,
  type ClientDetailResponse,
  firstOfMonth,
  lastOfMonth,
  POST_STATUSES,
} from '@vertex-hub/contracts';
import { Button } from '@vertex-hub/ui';
import { LinkIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { useMe } from '../../lib/auth';
import { formatMonth, formatNumber } from '../../lib/format';
import { approvalReadyQuery } from '../approvals/approvals.queries';
import type { RequestDraft } from '../approvals/ready-tab';
import { RequestDialog } from '../approvals/request-dialog';
import { hasClientScope } from '../tasks/task-access';
import { contentCalendarQuery } from './content.queries';
import { type CalendarState, ContentCalendar } from './content-calendar';
import { NewPostDialog } from './post-form';
import { canEditPostsOf, PostStatusBadge } from './post-parts';

/**
 * The Content tab of the client profile (spec F08, screen 2): the calendar fixed to the client,
 * the month's posts counted by status, "New post" preset to the client, and for client-scope
 * users "Send month for approval" (rule 21).
 */
export function ClientContentTab({ client }: { client: ClientDetailResponse }) {
  const { t } = useTranslation();
  const me = useMe();
  const [state, setState] = useState<CalendarState>({});
  const [creating, setCreating] = useState(false);
  // Rule 2: posts are created for a non-archived client that is active or paused.
  const canCreate =
    client.archivedAt === null &&
    client.status !== 'ended' &&
    canEditPostsOf(me, client.accountManager.id);
  const newPost = canCreate && (
    <Button size="sm" onClick={() => setCreating(true)}>
      <PlusIcon />
      {t('content.actions.new')}
    </Button>
  );
  const date = state.date ?? businessDate();

  return (
    <>
      <TabHeader
        title={t('content.clientTab.title')}
        description={t('content.clientTab.hint')}
        action={newPost}
      />
      <MonthBar client={client} date={date} sends={hasClientScope(me, client.accountManager.id)} />
      <ContentCalendar
        state={state}
        onChange={(next) => setState((previous) => ({ ...previous, ...next }))}
        clientId={client.id}
        emptyAction={newPost}
      />
      {creating && (
        <NewPostDialog
          client={{ id: client.id, name: client.tradeName }}
          defaultDate={state.date}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

/**
 * The calendar month of `date`: its posts per status, whatever the calendar's filters, and
 * "Send month for approval" for client-scope users.
 */
function MonthBar({
  client,
  date,
  sends,
}: {
  client: ClientDetailResponse;
  date: string;
  sends: boolean;
}) {
  const { t } = useTranslation();
  const month = useQuery(
    contentCalendarQuery({ from: firstOfMonth(date), to: lastOfMonth(date), clientId: client.id }),
  );
  const counts = month.data?.counts;
  const counted = POST_STATUSES.filter((status) => (counts?.[status] ?? 0) > 0);
  if (counted.length === 0 && !sends) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-border bg-surface px-4 py-3">
      <span className="text-sm font-medium">
        {t('content.clientTab.monthCounts', { month: formatMonth(date) })}
      </span>
      {counted.length > 0 && (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {counted.map((status) => (
            <li key={status} className="flex items-center gap-1.5 text-sm tabular-nums">
              <PostStatusBadge status={status} />
              {formatNumber(counts?.[status] ?? 0)}
            </li>
          ))}
        </ul>
      )}
      {sends && <SendMonth client={client} date={date} />}
    </div>
  );
}

/**
 * "Send month for approval" (rule 21): the new-request dialog with every ready post of the month
 * selected, in publish order. Past the request limit it takes the first 60 and says so; the rest
 * go in a second link (edge case 10). Disabled with a hint while none is ready or the client has
 * no final-approval contact (F02 rule 9).
 */
function SendMonth({ client, date }: { client: ClientDetailResponse; date: string }) {
  const { t } = useTranslation();
  const ready = useQuery(approvalReadyQuery(client.id, date.slice(0, 7)));
  // Kept while the dialog is open: the posts stop being ready once their link exists.
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const entry = ready.data?.clients.find((candidate) => candidate.client.id === client.id);
  const posts = entry?.posts.slice(0, APPROVAL_LIMITS.items) ?? [];
  const left = (entry?.posts.length ?? 0) - posts.length;
  if (ready.isError) {
    return <LoadError message={t('content.sendMonth.loadError')} onRetry={() => ready.refetch()} />;
  }
  const hint = !client.hasApprovalContact
    ? t('content.sendMonth.noContact')
    : ready.data && posts.length === 0
      ? t('content.sendMonth.noneReady')
      : left > 0
        ? t('content.sendMonth.overLimit', {
            n: formatNumber(posts.length),
            rest: formatNumber(left),
          })
        : null;
  return (
    <div className="ms-auto flex flex-wrap items-center gap-x-3 gap-y-1">
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      <Button
        size="sm"
        variant="outline"
        disabled={!entry || posts.length === 0 || !client.hasApprovalContact}
        onClick={() => entry && setDraft({ client: entry, tasks: [], posts })}
      >
        <LinkIcon />
        {posts.length > 0
          ? t('content.sendMonth.actionFor', { n: formatNumber(posts.length) })
          : t('content.sendMonth.action')}
      </Button>
      {draft && (
        <RequestDialog
          client={draft.client}
          tasks={draft.tasks}
          posts={draft.posts}
          onClose={() => setDraft(null)}
        />
      )}
    </div>
  );
}
