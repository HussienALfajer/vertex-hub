import { useQuery } from '@tanstack/react-query';
import {
  businessDate,
  type ClientDetailResponse,
  firstOfMonth,
  lastOfMonth,
  POST_STATUSES,
} from '@vertex-hub/contracts';
import { Button } from '@vertex-hub/ui';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TabHeader } from '../../components/tab-header';
import { useMe } from '../../lib/auth';
import { formatMonth, formatNumber } from '../../lib/format';
import { contentCalendarQuery } from './content.queries';
import { type CalendarState, ContentCalendar } from './content-calendar';
import { NewPostDialog } from './post-form';
import { canEditPostsOf, PostStatusBadge } from './post-parts';

/**
 * The Content tab of the client profile (spec F08, screen 2): the calendar fixed to the client,
 * the month's posts counted by status, and "New post" preset to the client.
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
      <MonthCounts clientId={client.id} date={date} />
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

/** The posts of the calendar month of `date` per status, whatever the calendar's filters. */
function MonthCounts({ clientId, date }: { clientId: string; date: string }) {
  const { t } = useTranslation();
  const month = useQuery(
    contentCalendarQuery({ from: firstOfMonth(date), to: lastOfMonth(date), clientId }),
  );
  if (!month.data) return null;
  const counted = POST_STATUSES.filter((status) => (month.data.counts[status] ?? 0) > 0);
  if (counted.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3">
      <span className="text-sm font-medium">
        {t('content.clientTab.monthCounts', { month: formatMonth(date) })}
      </span>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {counted.map((status) => (
          <li key={status} className="flex items-center gap-1.5 text-sm tabular-nums">
            <PostStatusBadge status={status} />
            {formatNumber(month.data.counts[status] ?? 0)}
          </li>
        ))}
      </ul>
    </div>
  );
}
