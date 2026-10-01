import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  type MedicalReview,
  type MedicalReviewInput,
  medicalReviewSchema,
  type ReviewVersion,
  type TaskClientTextInput,
  type TaskDetail,
  type TaskReview,
  taskClientTextInputSchema,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
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
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { PencilIcon, PlusIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { errorMessage, SCREEN_ERROR } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { TaskSection } from './task-parts';
import { useMedicalReview, useSetClientText } from './tasks.queries';

/*
 * The review loop on the task page (spec F09, screen 5): the text for the client, the medical
 * review, and the history of reviews and client responses.
 */

/**
 * The pass whose content is with the medical reviewer or the client now (rule 2): the internal
 * pass that started the medical stage, or the one that sent the task. Null in every other status,
 * where newer work is expected.
 */
export function reviewSnapshot(
  task: TaskDetail,
): { review: TaskReview; at: 'medical' | 'client' } | null {
  if (task.status === 'internal_review' && task.reviewStage === 'medical') {
    const pass = [...task.reviewHistory].reverse().find((review) => review.outcome === 'passed');
    return pass ? { review: pass, at: 'medical' } : null;
  }
  if (task.status === 'awaiting_client' && task.clearedReview) {
    return { review: task.clearedReview, at: 'client' };
  }
  return null;
}

/** The versions and text a pass approved, or the client answered. */
function SnapshotContent({
  versions,
  clientText,
}: {
  versions: ReviewVersion[];
  clientText?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      {versions.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {versions.map((version) => (
            <li key={version.id}>
              <Badge tone="outline" dir="auto">
                {t('tasks.reviews.version', { name: version.name, number: version.number })}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {clientText && (
        <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2">
          <span className="text-xs text-muted-foreground">{t('tasks.reviews.text')}</span>
          <p className="whitespace-pre-line" dir="auto">
            {clientText}
          </p>
        </div>
      )}
    </>
  );
}

/**
 * What the client reads and approves with the files (rule 7). A change after the pass is not
 * sent until the next one, so the section says so and shows what was approved.
 */
export function ClientTextSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const canEdit = task.permissions.canEditClientText && !task.readOnly;
  const snapshot = reviewSnapshot(task);
  const reviewed = snapshot?.review.clientText ?? null;
  const changed = snapshot !== null && (reviewed ?? '') !== (task.clientText ?? '');
  return (
    <TaskSection
      title={t('tasks.clientText.title')}
      action={
        canEdit && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {task.clientText ? <PencilIcon /> : <PlusIcon />}
            {task.clientText ? t('tasks.clientText.edit') : t('tasks.clientText.add')}
          </Button>
        )
      }
    >
      {task.clientText ? (
        <p className="max-w-prose text-base whitespace-pre-line" dir="auto">
          {task.clientText}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {canEdit ? t('tasks.clientText.hint') : t('tasks.clientText.empty')}
        </p>
      )}
      {changed && (
        <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warning">{t('tasks.clientText.changedAfterReview')}</Badge>
            <span className="text-muted-foreground">{t('tasks.clientText.changedHint')}</span>
          </div>
          {reviewed ? (
            <p className="rounded-md bg-muted px-3 py-2 whitespace-pre-line" dir="auto">
              {reviewed}
            </p>
          ) : (
            <p className="text-muted-foreground">{t('tasks.clientText.empty')}</p>
          )}
        </div>
      )}
      {editing && <ClientTextDialog task={task} onClose={() => setEditing(false)} />}
    </TaskSection>
  );
}

function ClientTextDialog({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const save = useSetClientText(task.id);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<TaskClientTextInput>({
    resolver: standardSchemaResolver(taskClientTextInputSchema),
    defaultValues: { clientText: task.clientText ?? '' },
  });
  const textError = form.formState.errors.clientText;
  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await save.mutateAsync(values);
      toast.add({ title: t('tasks.clientText.saved'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('tasks.clientText.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('tasks.clientText.hint')}</DialogDescription>
          </DialogHeader>
          <Field invalid={!!textError}>
            <FieldLabel htmlFor={id}>{t('tasks.clientText.label')}</FieldLabel>
            <Textarea
              id={id}
              rows={10}
              dir="auto"
              placeholder={t('tasks.clientText.placeholder')}
              {...form.register('clientText')}
            />
            <FieldError match={!!textError}>{t('tasks.clientText.errors.text')}</FieldError>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type MedicalDecision = MedicalReview['decision'];

/**
 * The medical reviewer approves exactly what internal review approved, or returns the task with
 * notes (rules 4 and 5). The dialog shows that snapshot: versions added later are not part of it.
 */
export function MedicalReviewDialog({
  task,
  decision,
  onClose,
}: {
  task: TaskDetail;
  decision: MedicalDecision;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const review = useMedicalReview(task.id);
  const [failure, setFailure] = useState<string | null>(null);
  const returning = decision === 'return';
  const snapshot = reviewSnapshot(task)?.review;
  const form = useForm<MedicalReviewInput, unknown, MedicalReview>({
    resolver: standardSchemaResolver(medicalReviewSchema),
    defaultValues: { decision, note: '' },
  });
  const noteError = form.formState.errors.note;
  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (returning && !values.note) {
      form.setError('note', { type: SCREEN_ERROR, message: t('tasks.medical.errors.notes') });
      return;
    }
    try {
      await review.mutateAsync({ decision, note: values.note || undefined });
      toast.add({
        title: returning ? t('tasks.medical.returned') : t('tasks.medical.approved'),
        type: 'success',
      });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {t(returning ? 'tasks.medical.returnTitle' : 'tasks.medical.approveTitle', {
                title: task.title,
              })}
            </DialogTitle>
            <DialogDescription>
              {t(returning ? 'tasks.medical.returnBody' : 'tasks.medical.approveBody')}
            </DialogDescription>
          </DialogHeader>
          {!returning && snapshot && (
            <div className="flex flex-col gap-2 text-sm">
              <span className="font-medium">{t('tasks.medical.snapshot')}</span>
              <SnapshotContent versions={snapshot.versions} clientText={snapshot.clientText} />
            </div>
          )}
          <Field invalid={!!noteError}>
            <FieldLabel htmlFor={id}>
              {returning ? t('tasks.medical.notes') : t('tasks.medical.note')}
            </FieldLabel>
            <Textarea
              id={id}
              rows={3}
              placeholder={returning ? t('tasks.medical.notesPlaceholder') : undefined}
              {...form.register('note')}
            />
            <FieldError match={!!noteError}>{t('tasks.medical.errors.notes')}</FieldError>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {returning ? t('tasks.medical.return') : t('tasks.medical.approve')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Every pass and return, newest first: who reviewed, at which stage, and what a pass approved. */
export function ReviewHistorySection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  if (task.reviewHistory.length === 0) return null;
  const history = [...task.reviewHistory].reverse();
  return (
    <TaskSection title={t('tasks.reviews.title')}>
      <ol className="flex flex-col gap-3">
        {history.map((review) => {
          const passed = review.outcome === 'passed';
          return (
            <li
              key={review.id}
              className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={review.stage === 'medical' ? 'info' : 'gold'}>
                  {t(`tasks.reviews.stages.${review.stage}`)}
                </Badge>
                <Badge tone={passed ? 'success' : 'danger'}>
                  {t(`tasks.reviews.outcomes.${review.outcome}`)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t('tasks.reviews.by', {
                    name: review.reviewer?.name ?? t('tasks.reviews.system'),
                    date: formatDateTime(review.createdAt),
                  })}
                </span>
              </div>
              {review.note && <p className="whitespace-pre-line">{review.note}</p>}
              {passed &&
                (review.versions.length > 0 || review.clientText ? (
                  <SnapshotContent versions={review.versions} clientText={review.clientText} />
                ) : (
                  <p className="text-xs text-muted-foreground">{t('tasks.reviews.noContent')}</p>
                ))}
            </li>
          );
        })}
      </ol>
    </TaskSection>
  );
}

/** The client's answers, newest first, from an approval link or recorded by hand (rule 16). */
export function ClientResponsesSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  if (task.clientResponses.length === 0) return null;
  const responses = [...task.clientResponses].reverse();
  return (
    <TaskSection title={t('tasks.responses.title')}>
      <ol className="flex flex-col gap-3">
        {responses.map((response) => (
          <li
            key={response.id}
            className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={response.decision === 'approved' ? 'success' : 'warning'}>
                {t(`tasks.responses.decisions.${response.decision}`)}
              </Badge>
              <Badge tone="outline">{t(`tasks.responses.channels.${response.channel}`)}</Badge>
              <span className="text-xs text-muted-foreground">
                {t('tasks.responses.by', {
                  name: response.contact.name,
                  date: formatDateTime(response.createdAt),
                })}
              </span>
            </div>
            {response.note && <p className="whitespace-pre-line">{response.note}</p>}
            <SnapshotContent versions={response.versions} />
            {response.recordedBy && (
              <p className="text-xs text-muted-foreground">
                {t('tasks.responses.recordedBy', { name: response.recordedBy.name })}
              </p>
            )}
          </li>
        ))}
      </ol>
    </TaskSection>
  );
}
