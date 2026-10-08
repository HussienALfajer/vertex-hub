import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  APPROVAL_LIMITS,
  type ApprovalItemKind,
  type ReadyClient,
  type ReadyPost,
} from '@vertex-hub/contracts';
import {
  Button,
  Callout,
  Checkbox,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@vertex-hub/ui';
import { LinkIcon, SendToBackIcon, ShieldAlertIcon } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatMonth, formatNumber } from '../../lib/format';
import { HealthcareBadge } from '../clients/client-badges';
import { formatDue, TaskOverdueBadge } from '../tasks/task-badges';
import { ItemKindBadge } from './approval-parts';
import { approvalReadyQuery } from './approvals.queries';
import {
  PostSnapshotSummary,
  RequestDialog,
  type RequestDraft,
  SnapshotSummary,
  useRequestDialog,
} from './request-dialog';

/** A month of publishing, `YYYY-MM`. */
const monthOf = (post: ReadyPost) => post.publishDate.slice(0, 7);

/**
 * Tasks and posts ready to send (spec F09, screen 1, rule 8; F08 screen 6, rule 20), by client:
 * pick items of one client and create its approval link. The Month picker keeps the posts
 * published in one month; tasks stay. A client with no final-approval contact cannot be sent
 * anything (F02 rule 9).
 */
export function ReadyTab() {
  const { t } = useTranslation();
  const ready = useQuery(approvalReadyQuery());
  const [month, setMonth] = useState<string | null>(null);
  const cards = useRef<HTMLDivElement>(null);
  // Once sent, the items leave the card and its button turns off: the card's first checkbox.
  const request = useRequestDialog((draft) =>
    firstControl(cards.current?.querySelector(`[data-client="${draft.client.client.id}"]`)),
  );
  const months = [
    ...new Set(ready.data?.clients.flatMap((entry) => entry.posts.map(monthOf)) ?? []),
  ].sort();
  // A month whose posts were all sent leaves the picker, and the filter with it.
  const active = month && months.includes(month) ? month : null;
  const clients = (ready.data?.clients ?? [])
    .map((entry) =>
      active ? { ...entry, posts: entry.posts.filter((post) => monthOf(post) === active) } : entry,
    )
    .filter((entry) => entry.tasks.length > 0 || entry.posts.length > 0);
  return (
    <>
      {ready.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : ready.isError ? (
        <LoadError message={t('approvals.ready.loadError')} onRetry={() => ready.refetch()} />
      ) : ready.data.clients.length === 0 ? (
        <EmptyState
          icon={<SendToBackIcon />}
          title={t('approvals.ready.emptyTitle')}
          description={t('approvals.ready.emptyHint')}
        />
      ) : (
        <div ref={cards} className="flex flex-col gap-4">
          {months.length > 0 && <MonthPicker months={months} value={active} onChange={setMonth} />}
          {clients.length === 0 ? (
            <EmptyState
              icon={<SendToBackIcon />}
              title={t('approvals.ready.emptyMonthTitle')}
              description={t('approvals.ready.emptyMonthHint')}
            />
          ) : (
            clients.map((entry) => (
              <ReadyClientCard key={entry.client.id} entry={entry} onCreate={request.open} />
            ))
          )}
        </div>
      )}
      <RequestDialog {...request.dialog} />
    </>
  );
}

/** The months the ready posts are published in; none chosen shows every post. */
function MonthPicker({
  months,
  value,
  onChange,
}: {
  months: string[];
  value: string | null;
  onChange: (month: string | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const all = 'all';
  const items = [
    { value: all, label: t('approvals.ready.allMonths') },
    ...months.map((month) => ({ value: month, label: formatMonth(`${month}-01`) })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id={id} className="text-sm font-medium">
        {t('approvals.ready.month')}
      </span>
      <Select
        items={items}
        value={value ?? all}
        onValueChange={(next) => onChange(next && next !== all ? next : null)}
      >
        <SelectTrigger aria-labelledby={id} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const keyOf = (kind: ApprovalItemKind, id: string) => `${kind}:${id}`;

/** A card's first checkbox, else its client link. */
const firstControl = (card: Element | null | undefined) =>
  card?.querySelector<HTMLElement>('[role="checkbox"]:not([data-disabled])') ??
  card?.querySelector<HTMLElement>('a') ??
  null;

function ReadyClientCard({
  entry,
  onCreate,
}: {
  entry: ReadyClient;
  onCreate: (draft: RequestDraft) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  // An item sent, moved or out of the month meanwhile leaves the list, and the selection with it.
  const tasks = entry.tasks.filter((task) => selected.includes(keyOf('task', task.id)));
  const posts = entry.posts.filter((post) => selected.includes(keyOf('post', post.id)));
  const count = tasks.length + posts.length;
  const full = count >= APPROVAL_LIMITS.items;
  const canSend = entry.contacts.length > 0;
  const mixed = entry.tasks.length > 0 && entry.posts.length > 0;
  const toggle = (key: string, checked: boolean) =>
    setSelected((previous) =>
      checked ? [...previous, key] : previous.filter((other) => other !== key),
    );
  const everything = [
    ...entry.tasks.map((task) => keyOf('task', task.id)),
    ...entry.posts.map((post) => keyOf('post', post.id)),
  ];
  const row = (key: string, title: string, body: ReactNode) => {
    const checked = selected.includes(key);
    return (
      <li key={key} className="flex items-center gap-3 px-4 py-3">
        {canSend && (
          <Checkbox
            checked={checked}
            disabled={!checked && full}
            onCheckedChange={(next) => toggle(key, next)}
            aria-label={t('approvals.ready.select', { title })}
          />
        )}
        {body}
      </li>
    );
  };
  return (
    <section
      aria-label={entry.client.name}
      data-client={entry.client.id}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <h2 className="text-base font-bold">
          <Link
            to="/clients/$clientId"
            params={{ clientId: entry.client.id }}
            className="hover:underline"
          >
            {entry.client.name}
          </Link>
        </h2>
        {entry.isHealthcare && <HealthcareBadge />}
        {canSend && (
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {everything.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected(count > 0 ? [] : everything.slice(0, APPROVAL_LIMITS.items))
                }
              >
                {count > 0 ? t('approvals.ready.clear') : t('approvals.ready.selectAll')}
              </Button>
            )}
            <Button
              size="sm"
              disabled={count === 0}
              onClick={() => onCreate({ client: entry, tasks, posts })}
            >
              <LinkIcon />
              {count > 0
                ? t('approvals.ready.createFor', { n: formatNumber(count) })
                : t('approvals.ready.create')}
            </Button>
          </div>
        )}
      </div>
      {!canSend && (
        <div className="p-4">
          <Callout
            tone="warning"
            icon={<ShieldAlertIcon />}
            title={t('clients.profile.noApprovalTitle')}
            description={t('clients.profile.noApprovalBody')}
            action={
              <Button
                variant="outline"
                size="sm"
                render={<Link to="/clients/$clientId" params={{ clientId: entry.client.id }} />}
              >
                {t('approvals.ready.openClient')}
              </Button>
            }
          />
        </div>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {entry.tasks.map((task) =>
          row(
            keyOf('task', task.id),
            task.title,
            <>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  {mixed && <ItemKindBadge kind="task" />}
                  <Link
                    to="/tasks/$taskId"
                    params={{ taskId: task.id }}
                    className="w-fit font-medium hover:underline"
                  >
                    {task.title}
                  </Link>
                </span>
                <span className="text-xs text-muted-foreground">
                  <SnapshotSummary snapshot={task.snapshot} />
                </span>
              </div>
              <span className="flex items-center gap-2 text-sm tabular-nums">
                {formatDue(task)}
                {task.overdue && <TaskOverdueBadge />}
              </span>
            </>,
          ),
        )}
        {entry.posts.map((post) =>
          row(
            keyOf('post', post.id),
            post.title,
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                {mixed && <ItemKindBadge kind="post" />}
                <Link
                  to="/content/posts/$postId"
                  params={{ postId: post.id }}
                  className="w-fit font-medium hover:underline"
                >
                  {post.title}
                </Link>
              </span>
              <PostSnapshotSummary post={post} />
            </div>,
          ),
        )}
      </ul>
    </section>
  );
}
