import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { APPROVAL_LIMITS, type ReadyClient, type ReadyTask } from '@vertex-hub/contracts';
import { Button, Callout, Checkbox, EmptyState, Skeleton } from '@vertex-hub/ui';
import { LinkIcon, SendToBackIcon, ShieldAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatNumber } from '../../lib/format';
import { HealthcareBadge } from '../clients/client-badges';
import { formatDue, TaskOverdueBadge } from '../tasks/task-badges';
import { approvalReadyQuery } from './approvals.queries';
import { RequestDialog, SnapshotSummary } from './request-dialog';

/** What a new request holds: kept while its dialog is open, whatever the list reloads to. */
interface Draft {
  client: ReadyClient;
  tasks: ReadyTask[];
}

/**
 * Tasks ready to send (spec F09, screen 1, rule 8), by client: pick tasks of one client and
 * create its approval link. A client with no final-approval contact cannot be sent anything
 * (F02 rule 9).
 */
export function ReadyTab() {
  const { t } = useTranslation();
  const ready = useQuery(approvalReadyQuery());
  const [draft, setDraft] = useState<Draft | null>(null);
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
        <div className="flex flex-col gap-4">
          {ready.data.clients.map((entry) => (
            <ReadyClientCard key={entry.client.id} entry={entry} onCreate={setDraft} />
          ))}
        </div>
      )}
      {draft && (
        <RequestDialog client={draft.client} tasks={draft.tasks} onClose={() => setDraft(null)} />
      )}
    </>
  );
}

function ReadyClientCard({
  entry,
  onCreate,
}: {
  entry: ReadyClient;
  onCreate: (draft: Draft) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  // A task sent or moved meanwhile leaves the list, and the selection with it.
  const chosen = entry.tasks.filter((task) => selected.includes(task.id));
  const full = chosen.length >= APPROVAL_LIMITS.items;
  const canSend = entry.contacts.length > 0;
  const toggle = (taskId: string, checked: boolean) =>
    setSelected((previous) =>
      checked ? [...previous, taskId] : previous.filter((id) => id !== taskId),
    );
  return (
    <section
      aria-label={entry.client.name}
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
            {entry.tasks.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected(
                    chosen.length > 0
                      ? []
                      : entry.tasks.slice(0, APPROVAL_LIMITS.items).map((task) => task.id),
                  )
                }
              >
                {chosen.length > 0 ? t('approvals.ready.clear') : t('approvals.ready.selectAll')}
              </Button>
            )}
            <Button
              size="sm"
              disabled={chosen.length === 0}
              onClick={() => onCreate({ client: entry, tasks: chosen })}
            >
              <LinkIcon />
              {chosen.length > 0
                ? t('approvals.ready.createFor', { n: formatNumber(chosen.length) })
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
        {entry.tasks.map((task) => {
          const checked = selected.includes(task.id);
          return (
            <li key={task.id} className="flex items-center gap-3 px-4 py-3">
              {canSend && (
                <Checkbox
                  checked={checked}
                  disabled={!checked && full}
                  onCheckedChange={(next) => toggle(task.id, next)}
                  aria-label={t('approvals.ready.select', { title: task.title })}
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: task.id }}
                  className="w-fit font-medium hover:underline"
                >
                  {task.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  <SnapshotSummary snapshot={task.snapshot} />
                </span>
              </div>
              <span className="flex items-center gap-2 text-sm tabular-nums">
                {formatDue(task)}
                {task.overdue && <TaskOverdueBadge />}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
