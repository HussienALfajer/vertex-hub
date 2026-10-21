import type { AssigneeLeave } from '@vertex-hub/contracts';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { ApiError } from '../../lib/api/client';
import { formatCalendarDate, formatPeriod } from '../../lib/format';

/** F17 rule B17: the assignee's leaves on the due date when the API warned about them. */
export function assigneeLeaves(error: unknown): AssigneeLeave[] | null {
  return error instanceof ApiError && error.code === 'ASSIGNEE_ON_LEAVE'
    ? Array.isArray(error.details)
      ? (error.details as AssigneeLeave[])
      : []
    : null;
}

/**
 * F17 rule B17: the assignee is on approved leave on the due date. The warning never blocks:
 * "Assign anyway" sends the change again with `acceptLeave`, which the API audits.
 */
export function LeaveWarningDialog({
  leaves,
  onClose,
  onConfirm,
  pending,
}: {
  leaves: AssigneeLeave[] | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  pending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={leaves !== null}
      onClose={onClose}
      title={t('tasks.leaveWarning.title')}
      body={t('tasks.leaveWarning.body')}
      action={t('tasks.leaveWarning.action')}
      pending={pending}
      onConfirm={onConfirm}
    >
      <ul className="flex flex-col gap-1.5 text-sm">
        {(leaves ?? []).map((leave) => (
          <li
            key={leave.startsOn}
            className="rounded-md border border-border bg-surface px-3 py-2 font-medium"
          >
            {leave.startsOn === leave.endsOn
              ? formatCalendarDate(leave.startsOn)
              : formatPeriod(leave.startsOn, leave.endsOn)}
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}
