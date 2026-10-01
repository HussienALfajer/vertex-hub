import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ApprovalItemKind, PostDetail, TaskDetail } from '@vertex-hub/contracts';
import { Button, Callout } from '@vertex-hub/ui';
import { ArrowLeftIcon, LinkIcon, ShieldAlertIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatDateTime } from '../../lib/format';
import { TaskSection } from '../tasks/task-parts';
import { RequestStateBadge } from './approval-parts';
import { approvalReadyQuery, approvalRequestQuery } from './approvals.queries';
import type { RequestDraft } from './ready-tab';
import { RequestDialog } from './request-dialog';

/**
 * The Client approval panel of the task page (spec F09, screen 5): the link the task waits in,
 * or, for a task ready to send, the way to create one. An expired link does not block a new one
 * (rule 8), so both can show.
 */
export function ClientApprovalSection({ task }: { task: TaskDetail }) {
  const canSend = task.permissions.canSendForApproval && !task.readOnly;
  return (
    <ApprovalPanel
      kind="task"
      itemId={task.id}
      clientId={task.client?.id ?? null}
      pending={task.pendingApproval}
      canSend={canSend}
    />
  );
}

/** The same panel on the post page (spec F08, screen 4; rules 20–21). */
export function PostApprovalSection({ post }: { post: PostDetail }) {
  const canSend = post.permissions.canSendForApproval && !post.readOnly;
  return (
    <ApprovalPanel
      kind="post"
      itemId={post.id}
      clientId={post.client.id}
      pending={post.pendingApproval}
      canSend={canSend}
    />
  );
}

function ApprovalPanel({
  kind,
  itemId,
  clientId,
  pending,
  canSend,
}: {
  kind: ApprovalItemKind;
  itemId: string;
  clientId: string | null;
  pending: TaskDetail['pendingApproval'];
  canSend: boolean;
}) {
  const { t } = useTranslation();
  // Kept while the dialog is open: the item stops being ready once its link exists.
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const sends = canSend && clientId !== null;
  if (!pending && !sends && !draft) return null;
  return (
    <TaskSection title={t('tasks.approval.title')}>
      {pending && <PendingLink kind={kind} pending={pending} />}
      {sends && clientId && (
        <SendAction
          kind={kind}
          itemId={itemId}
          clientId={clientId}
          resend={pending !== null}
          onCreate={setDraft}
        />
      )}
      {draft && (
        <RequestDialog
          client={draft.client}
          tasks={draft.tasks}
          posts={draft.posts}
          onClose={() => setDraft(null)}
        />
      )}
    </TaskSection>
  );
}

function PendingLink({
  kind,
  pending,
}: {
  kind: ApprovalItemKind;
  pending: NonNullable<TaskDetail['pendingApproval']>;
}) {
  const { t } = useTranslation();
  // Everyone who reads tasks reads requests; the contact arrives with the request.
  const request = useQuery(approvalRequestQuery(pending.requestId));
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <RequestStateBadge state={pending.state} />
        <span className="text-muted-foreground">
          {kind === 'task' ? t('tasks.approval.sent') : t('content.approval.sent')}
        </span>
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

/**
 * "Create approval link" for this task or post, with the client's final-approval contacts
 * (rule 9).
 */
function SendAction({
  kind,
  itemId,
  clientId,
  resend,
  onCreate,
}: {
  kind: ApprovalItemKind;
  itemId: string;
  clientId: string;
  resend: boolean;
  onCreate: (draft: RequestDraft) => void;
}) {
  const { t } = useTranslation();
  const ready = useQuery(approvalReadyQuery(clientId));
  if (ready.isError) {
    return <LoadError message={t('tasks.approval.loadError')} onRetry={() => ready.refetch()} />;
  }
  const client = ready.data?.clients.find((entry) => entry.client.id === clientId);
  const tasks = kind === 'task' ? (client?.tasks.filter(({ id }) => id === itemId) ?? []) : [];
  const posts = kind === 'post' ? (client?.posts.filter(({ id }) => id === itemId) ?? []) : [];
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
        {resend
          ? t('tasks.approval.resend')
          : kind === 'task'
            ? t('tasks.approval.ready')
            : t('content.approval.ready')}
      </p>
      <Button
        size="sm"
        disabled={!client || tasks.length + posts.length === 0}
        onClick={() => client && onCreate({ client, tasks, posts })}
      >
        <LinkIcon />
        {t('tasks.approval.create')}
      </Button>
    </div>
  );
}
