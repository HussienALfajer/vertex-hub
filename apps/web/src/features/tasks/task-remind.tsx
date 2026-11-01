import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  TASK_REMINDER_NOTE_MAX,
  type TaskReminder,
  type TaskReminderInput,
  taskReminderSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { BellRingIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { useRemindTask } from './tasks.queries';

/** The task a reminder is about: its title and assignee name the dialog. */
export interface RemindTarget {
  id: string;
  title: string;
  assignee: { name: string } | null;
}

/**
 * F06C: the "Remind" button, as an icon in a list row or a labelled button on the task page, and
 * the dialog it opens. The caller shows it only where `canRemind` holds; the API checks again.
 */
export function RemindButton({
  task,
  compact,
}: {
  task: RemindTarget;
  /** An icon with a tooltip, for a table row. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const shown = useShownWhileClosing(open ? task : null);
  return (
    <>
      {compact ? (
        <IconButton
          variant="ghost"
          label={t('tasks.remind.action', { name: task.assignee?.name ?? '' })}
          onClick={() => setOpen(true)}
        >
          <BellRingIcon />
        </IconButton>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <BellRingIcon />
          {t('tasks.remind.button')}
        </Button>
      )}
      {shown && <RemindDialog task={shown} open={open} onClose={() => setOpen(false)} />}
    </>
  );
}

function RemindDialog({
  task,
  open,
  onClose,
}: {
  task: RemindTarget;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const noteId = useId();
  const remind = useRemindTask();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<TaskReminderInput, unknown, TaskReminder>({
    resolver: standardSchemaResolver(taskReminderSchema),
    defaultValues: { note: '' },
  });
  const noteError = form.formState.errors.note;
  const name = task.assignee?.name ?? '';

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await remind.mutateAsync({ id: task.id, ...(values.note && { note: values.note }) });
      toast.add({ title: t('tasks.remind.done', { name }), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      // After the exit animation, so the note does not empty while the dialog fades.
      onOpenChangeComplete={(next) => {
        if (next) return;
        form.reset();
        setFailure(null);
      }}
    >
      <DialogContent closeLabel={t('common.close')}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('tasks.remind.title', { name })}</DialogTitle>
            <DialogDescription>
              {t('tasks.remind.body', { title: task.title, name })}
            </DialogDescription>
          </DialogHeader>
          <Field invalid={!!noteError}>
            <FieldLabel htmlFor={noteId}>{t('tasks.remind.note')}</FieldLabel>
            <Textarea
              id={noteId}
              rows={3}
              maxLength={TASK_REMINDER_NOTE_MAX}
              placeholder={t('tasks.remind.notePlaceholder')}
              {...form.register('note')}
            />
            <FieldDescription>
              {t('tasks.remind.noteHint', { max: formatNumber(TASK_REMINDER_NOTE_MAX) })}
            </FieldDescription>
            <FieldError match={!!noteError}>
              {t('tasks.remind.noteTooLong', { max: formatNumber(TASK_REMINDER_NOTE_MAX) })}
            </FieldError>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={remind.isPending}>
              <BellRingIcon />
              {t('tasks.remind.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
