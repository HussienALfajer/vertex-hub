import { useQuery } from '@tanstack/react-query';
import { businessDate, type PostDetail } from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import { type ComponentProps, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { movePreviewQuery, useMovePost } from './content.queries';

/*
 * F08B screen 5, rules B6–B9: a post moved to another day, keeping its time. When it has open
 * linked tasks, "Shift the linked tasks' due dates" is offered, ticked when any would be due
 * after the new date, with each task's current and new due date.
 */

type FinalFocus = ComponentProps<typeof DialogContent>['finalFocus'];

export function MovePostDialog({
  post,
  open,
  onClose,
  finalFocus,
  initialDate,
}: {
  post: PostDetail;
  open: boolean;
  onClose: () => void;
  finalFocus?: FinalFocus;
  /** The day a post was dropped on (PR 4's calendar); the dialog asks for one otherwise. */
  initialDate?: string;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-xl" finalFocus={finalFocus}>
        {open && <MoveForm post={post} initialDate={initialDate} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function MoveForm({
  post,
  initialDate,
  onClose,
}: {
  post: PostDetail;
  initialDate?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const today = businessDate();
  const move = useMovePost(post.id);
  const [date, setDate] = useState(initialDate ?? '');
  const [shift, setShift] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [dateError, setDateError] = useState(false);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today && date !== post.publishDate;
  const preview = useQuery({ ...movePreviewQuery(post.id, date), enabled: valid });
  const tasks = preview.data?.tasks ?? [];
  // Rule B7: ticked when a task would fall due after the new date, until the user decides.
  const shifting = shift ?? preview.data?.suggestShift ?? false;

  async function submit() {
    setFailure(null);
    if (!valid) {
      setDateError(true);
      return;
    }
    try {
      const moved = await move.mutateAsync({
        publishDate: date,
        shiftTasks: tasks.length > 0 && shifting,
      });
      toast.add({
        title:
          moved.shiftedTaskIds.length > 0
            ? t('content.moveDate.doneShifted', { n: formatNumber(moved.shiftedTaskIds.length) })
            : t('content.moveDate.done'),
        type: 'success',
      });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.knownCode === 'INVALID_DATES') {
        setDateError(true);
        return;
      }
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('content.moveDate.title', { title: post.title })}</DialogTitle>
        <DialogDescription>
          {t('content.moveDate.body', { date: formatCalendarDate(post.publishDate) })}
        </DialogDescription>
      </DialogHeader>
      <Field invalid={dateError}>
        <FieldLabel htmlFor={id}>{t('content.moveDate.newDate')}</FieldLabel>
        <Input
          id={id}
          type="date"
          dir="ltr"
          min={today}
          required
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            setDateError(false);
            setShift(null);
          }}
        />
        <FieldError match={dateError}>{t('content.moveDate.dateError')}</FieldError>
      </Field>
      {valid &&
        (preview.isPending ? (
          <Skeleton className="h-20" />
        ) : preview.isError ? (
          <LoadError message={t('content.moveDate.loadError')} onRetry={() => preview.refetch()} />
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('content.moveDate.noTasks')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <label
              htmlFor={`${id}-shift`}
              className="flex cursor-pointer items-start gap-3 text-sm font-medium"
            >
              <Checkbox
                id={`${id}-shift`}
                checked={shifting}
                onCheckedChange={(checked) => setShift(checked)}
              />
              <span className="flex flex-col gap-0.5">
                {t('content.moveDate.shift')}
                <span className="font-normal text-muted-foreground">
                  {t('content.moveDate.shiftHint')}
                </span>
              </span>
            </label>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('content.moveDate.tasksCaption')}</caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('content.moveDate.task')}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('content.moveDate.due')}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('content.moveDate.newDue')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="border-b border-border last:border-0">
                    <td className={task.parentId ? 'py-2 ps-4' : 'py-2'}>{task.title}</td>
                    <td className="py-2 tabular-nums">{formatCalendarDate(task.dueDate)}</td>
                    <td className="py-2 tabular-nums">
                      {shifting ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {formatCalendarDate(task.newDueDate)}
                          {task.clamped && (
                            <Badge tone="warning">{t('content.moveDate.clamped')}</Badge>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {t('content.moveDate.unchanged')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={move.isPending || (valid && !preview.data)}>
          {t('content.actions.move')}
        </Button>
      </DialogFooter>
    </form>
  );
}
