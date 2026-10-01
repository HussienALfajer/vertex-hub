import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  type MedicalReview,
  type MedicalReviewInput,
  medicalReviewSchema,
  type PostDetail,
  type PostReview,
  type ReviewVersion,
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
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { errorMessage, SCREEN_ERROR } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { TaskSection } from '../tasks/task-parts';
import { useMedicalReviewPost } from './content.queries';

/*
 * The review loop on the post page (spec F08, screen 4): the medical review, and the history of
 * reviews and client responses with what each pass approved (rule 11).
 */

/**
 * The pass whose content is with the medical reviewer or the client now: the internal pass that
 * started the medical stage, or the one that sent the post. Null in every other status.
 */
export function postSnapshot(
  post: PostDetail,
): { review: PostReview; at: 'medical' | 'client' } | null {
  if (post.status === 'internal_review' && post.reviewStage === 'medical') {
    const pass = [...post.reviewHistory].reverse().find((review) => review.outcome === 'passed');
    return pass ? { review: pass, at: 'medical' } : null;
  }
  if (post.status === 'awaiting_client' && post.clearedReview) {
    return { review: post.clearedReview, at: 'client' };
  }
  return null;
}

/** The media, caption and hashtags a pass approved, or the client answered. */
function SnapshotContent({
  versions,
  caption,
  hashtags,
}: {
  versions: ReviewVersion[];
  caption?: string | null;
  hashtags?: string | null;
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
      {(caption || hashtags) && (
        <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2">
          <span className="text-xs text-muted-foreground">{t('content.reviews.caption')}</span>
          {caption && (
            <p className="whitespace-pre-line" dir="auto">
              {caption}
            </p>
          )}
          {hashtags && (
            <p className="text-muted-foreground" dir="auto">
              {hashtags}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export type MedicalDecision = MedicalReview['decision'];

/**
 * The medical reviewer approves exactly what internal review approved, or returns the post with
 * notes (rule 13). The dialog shows that snapshot.
 */
export function PostMedicalReviewDialog({
  post,
  decision,
  onClose,
}: {
  post: PostDetail;
  decision: MedicalDecision;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const review = useMedicalReviewPost(post.id);
  const [failure, setFailure] = useState<string | null>(null);
  const returning = decision === 'return';
  const snapshot = postSnapshot(post)?.review;
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
        title: returning ? t('content.medical.returned') : t('content.medical.approved'),
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
                title: post.title,
              })}
            </DialogTitle>
            <DialogDescription>
              {t(returning ? 'content.medical.returnBody' : 'content.medical.approveBody')}
            </DialogDescription>
          </DialogHeader>
          {!returning && snapshot && (
            <div className="flex flex-col gap-2 text-sm">
              <span className="font-medium">{t('tasks.medical.snapshot')}</span>
              <SnapshotContent
                versions={snapshot.versions}
                caption={snapshot.caption}
                hashtags={snapshot.hashtags}
              />
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
export function PostReviewHistorySection({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  if (post.reviewHistory.length === 0) return null;
  const history = [...post.reviewHistory].reverse();
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
                  {t(`content.reviews.outcomes.${review.outcome}`)}
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
                (review.versions.length > 0 || review.caption || review.hashtags ? (
                  <SnapshotContent
                    versions={review.versions}
                    caption={review.caption}
                    hashtags={review.hashtags}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">{t('content.reviews.noContent')}</p>
                ))}
            </li>
          );
        })}
      </ol>
    </TaskSection>
  );
}

/** The client's answers, newest first, from an approval link or recorded by hand (rule 24). */
export function PostClientResponsesSection({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  if (post.clientResponses.length === 0) return null;
  const responses = [...post.clientResponses].reverse();
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
