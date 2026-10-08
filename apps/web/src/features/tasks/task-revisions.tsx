import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  REVISION_DECISIONS,
  type RevisionDecision,
  type RevisionDecisionInput,
  revisionDecisionInputSchema,
  revisionExtraWorkTitle,
  type TaskDetail,
  type TaskRevision,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
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
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import { GavelIcon, MessageSquareWarningIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { errorMessage, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { formatDateTime, formatNumber } from '../../lib/format';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { TaskSection } from './task-parts';
import { useDecideRevision } from './tasks.queries';

const REVISION_TONES = { client: 'warning', internal: 'neutral', medical: 'info' } as const;

/**
 * Every return to revisions (rule 9): internal and medical returns are shown but never counted;
 * client revisions are numbered against the limit, and one over it waits for a decision (rule 10).
 */
export function RevisionsSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const [deciding, setDeciding] = useState<TaskRevision | null>(null);
  // The revision stays while the dialog fades out; its "decide" button leaves with the decision.
  const shownDeciding = useShownWhileClosing(deciding);
  const heading = useRef<HTMLHeadingElement>(null);
  const history = [...task.revisionHistory].reverse();
  const canDecide = task.permissions.canDecideRevision && !task.readOnly;
  return (
    <TaskSection
      title={t('tasks.revisions.title')}
      headingRef={heading}
      count={
        task.client
          ? t('tasks.revisionsCount', {
              used: formatNumber(task.revisions.clientCount),
              limit: formatNumber(task.revisions.limit),
            })
          : undefined
      }
    >
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tasks.revisions.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {history.map((revision) => (
            <li
              key={revision.id}
              className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={REVISION_TONES[revision.source]}>
                  {revision.source === 'client'
                    ? t('tasks.revisions.client', { number: formatNumber(revision.number ?? 0) })
                    : t(`tasks.revisions.${revision.source}`)}
                </Badge>
                {revision.overLimit && (
                  <Badge tone="danger">
                    <MessageSquareWarningIcon aria-hidden="true" />
                    {t('tasks.revisions.overLimit')}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {t('tasks.revisions.by', {
                    name: revision.author?.name ?? revision.contact?.name ?? '',
                    date: formatDateTime(revision.createdAt),
                  })}
                </span>
              </div>
              <p className="whitespace-pre-line">{revision.note}</p>
              {revision.contact && (
                <p className="text-xs text-muted-foreground">
                  {t('tasks.revisions.contact', { name: revision.contact.name })}
                </p>
              )}
              {revision.overLimit && <Decision revision={revision} />}
              {revision.overLimit && revision.decision === null && (
                <Callout
                  tone="danger"
                  icon={<GavelIcon />}
                  title={t('tasks.revisions.pendingTitle')}
                  description={t('tasks.revisions.pendingBody')}
                  action={
                    canDecide && (
                      <Button size="sm" onClick={() => setDeciding(revision)}>
                        {t('tasks.revisions.decide')}
                      </Button>
                    )
                  }
                />
              )}
            </li>
          ))}
        </ol>
      )}
      {canDecide && shownDeciding && (
        <DecisionDialog
          task={task}
          revision={shownDeciding}
          open={deciding !== null}
          onClose={() => setDeciding(null)}
          finalFocus={() => heading.current ?? true}
        />
      )}
    </TaskSection>
  );
}

function Decision({ revision }: { revision: TaskRevision }) {
  const { t } = useTranslation();
  if (!revision.decision) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2 text-xs">
      <span className="font-medium">
        {t(`tasks.revisions.decisions.${revision.decision}`)}
        {revision.decidedBy &&
          revision.decidedAt &&
          ` · ${t('tasks.revisions.by', {
            name: revision.decidedBy.name,
            date: formatDateTime(revision.decidedAt),
          })}`}
      </span>
      {revision.decisionNote && <span>{revision.decisionNote}</span>}
      {revision.extraWork && (
        <span>{t('tasks.revisions.extraWork', { title: revision.extraWork.title })}</span>
      )}
    </div>
  );
}

/**
 * The account manager decides an over-limit revision: done for free (with a reason), or logged
 * as extra work on the project or retainer (rule 10).
 */
function DecisionDialog({
  task,
  revision,
  open,
  onClose,
  finalFocus,
}: {
  task: TaskDetail;
  revision: TaskRevision;
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | true;
}) {
  const { t } = useTranslation();
  const ids = { decision: useId(), note: useId() };
  const decide = useDecideRevision(task.id);
  const [failure, setFailure] = useState<string | null>(null);
  const engagement = task.project ?? task.retainer;
  // Extra work needs a project or retainer to be logged on (rule 10).
  const defaults: RevisionDecisionInput = {
    decision: engagement ? 'extra_work' : 'free',
    note: '',
  };
  const form = useForm<RevisionDecisionInput>({
    resolver: standardSchemaResolver(revisionDecisionInputSchema),
    defaultValues: defaults,
  });
  const decision = useWatch({ control: form.control, name: 'decision' });
  const noteError = form.formState.errors.note;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (values.decision === 'extra_work' && !engagement) {
      form.setError('decision', { type: SCREEN_ERROR, message: t('errors.NO_ENGAGEMENT') });
      return;
    }
    try {
      await decide.mutateAsync({
        revisionId: revision.id,
        decision: values.decision,
        note: values.note || undefined,
      });
      toast.add({ title: t(`tasks.revisions.decided.${values.decision}`), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      // After the exit animation, so the reason does not empty while the dialog fades.
      onOpenChangeComplete={(next) => {
        if (next) return;
        form.reset(defaults);
        setFailure(null);
      }}
    >
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {t('tasks.revisions.decideTitle', { number: formatNumber(revision.number ?? 0) })}
            </DialogTitle>
            <DialogDescription>
              {t('tasks.revisions.decideBody', { limit: formatNumber(task.revisions.limit) })}
            </DialogDescription>
          </DialogHeader>
          <Field invalid={!!form.formState.errors.decision}>
            <FieldLabel id={ids.decision} render={<span />}>
              {t('tasks.revisions.decision')}
            </FieldLabel>
            <Controller
              control={form.control}
              name="decision"
              render={({ field }) => (
                <ToggleGroup
                  aria-labelledby={ids.decision}
                  value={[field.value]}
                  onValueChange={(next: RevisionDecision[]) => {
                    if (next[0]) field.onChange(next[0]);
                  }}
                >
                  {REVISION_DECISIONS.map((value) => (
                    <ToggleGroupItem key={value} value={value}>
                      {t(`tasks.revisions.decisions.${value}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
            />
            <FieldDescription>
              {decision === 'extra_work'
                ? t('tasks.revisions.extraWorkHint', {
                    title: revisionExtraWorkTitle(revision.number ?? 0, task.title),
                  })
                : t('tasks.revisions.freeHint')}
            </FieldDescription>
            <FieldError match={!!form.formState.errors.decision}>
              {fieldError(form.formState.errors.decision, t('errors.NO_ENGAGEMENT'))}
            </FieldError>
          </Field>
          {decision === 'free' && (
            <Field invalid={!!noteError}>
              <FieldLabel htmlFor={ids.note}>{t('tasks.revisions.freeReason')}</FieldLabel>
              <Textarea id={ids.note} rows={2} {...form.register('note')} />
              <FieldError match={!!noteError}>{t('tasks.revisions.errors.freeReason')}</FieldError>
            </Field>
          )}
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('tasks.revisions.decide')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
