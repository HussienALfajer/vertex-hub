import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReadyClient, ReadyTask, TaskDetail } from '@vertex-hub/contracts';
import { Button, Callout } from '@vertex-hub/ui';
import { ArrowLeftIcon, LinkIcon, ShieldAlertIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatDateTime } from '../../lib/format';
import { TaskSection } from '../tasks/task-parts';
import { RequestStateBadge } from './approval-parts';
import { approvalReadyQuery, approvalRequestQuery } from './approvals.queries';
import { RequestDialog } from './request-dialog';

/**
 * The Client approval panel of the task page (spec F09, screen 5): the link the task waits in,
 * or, for a task ready to send, the way to create one. An expired link does not block a new one
 * (rule 8), so both can show.
 */
export function ClientApprovalSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const pending = task.pendingApproval;
  const canSend = task.permissions.canSendForApproval && !task.readOnly && !!task.client;
  // Kept while the dialog is open: the task stops being ready once its link exists.
  const [draft, setDraft] = useState<{ client: ReadyClient; tasks: ReadyTask[] } | null>(null);
  if (!pending && !canSend && !draft) return null;
  return (
    <TaskSection title={t('tasks.approval.title')}>
      {pending && <PendingLink pending={pending} />}
      {canSend && task.client && (
        <SendAction
          taskId={task.id}
          clientId={task.client.id}
          resend={pending !== null}
          onCreate={setDraft}
        />
      )}
      {draft && (
        <RequestDialog client={draft.client} tasks={draft.tasks} onClose={() => setDraft(null)} />
      )}
    </TaskSection>
  );
}

function PendingLink({ pending }: { pending: NonNullable<TaskDetail['pendingApproval']> }) {
  const { t } = useTranslation();
  // Everyone who reads tasks reads requests; the contact arrives with the request.
  const request = useQuery(approvalRequestQuery(pending.requestId));
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <RequestStateBadge state={pending.state} />
        <span className="text-muted-foreground">{t('tasks.approval.sent')}</span>
      </div>
      <dl className="flex flex-col gap-2">
        {request.data && <Row label={t('tasks.approval.contact')}>{request.data.contact.name}</Row>}
        <Row label={t('tasks.approval.issued')}>{formatDateTime(pending.issuedAt)}</Row>
        <Row label={t('tasks.approval.expires')}>{formatDateTime(pending.expiresAt)}</Row>
      </dl>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        render={
          <Link to="/approvals/requests/$requestId" params={{ requestId: pending.requestId }} />
        }
      >
        {t('tasks.approval.openRequest')}
        <ArrowLeftIcon className="ltr:-scale-x-100" />
      </Button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** "Create approval link" for this task, with the client's final-approval contacts (rule 9). */
function SendAction({
  taskId,
  clientId,
  resend,
  onCreate,
}: {
  taskId: string;
  clientId: string;
  resend: boolean;
  onCreate: (draft: { client: ReadyClient; tasks: ReadyTask[] }) => void;
}) {
  const { t } = useTranslation();
  const ready = useQuery(approvalReadyQuery(clientId));
  if (ready.isError) {
    return <LoadError message={t('tasks.approval.loadError')} onRetry={() => ready.refetch()} />;
  }
  const client = ready.data?.clients.find((entry) => entry.client.id === clientId);
  const readyTask = client?.tasks.find((candidate) => candidate.id === taskId);
  if (client && client.contacts.length === 0) {
    return (
      <Callout
        tone="warning"
        icon={<ShieldAlertIcon />}
        title={t('clients.profile.noApprovalTitle')}
        description={t('clients.profile.noApprovalBody')}
      />
    );
  }
  return (
    <div className="flex flex-col items-start gap-3 text-sm">
      <p className="text-muted-foreground">
        {resend ? t('tasks.approval.resend') : t('tasks.approval.ready')}
      </p>
      <Button
        size="sm"
        disabled={!client || !readyTask}
        onClick={() => client && readyTask && onCreate({ client, tasks: [readyTask] })}
      >
        <LinkIcon />
        {t('tasks.approval.create')}
      </Button>
    </div>
  );
}
