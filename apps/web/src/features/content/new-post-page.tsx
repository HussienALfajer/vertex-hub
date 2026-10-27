import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  type AssigneeLeave,
  businessDate,
  type CreatePost,
  createPostSchema,
  POST_LIMITS,
  type PostPlatform,
  postChecks,
  postTaskDepartment,
  postTaskDueDate,
  postTaskTitle,
} from '@vertex-hub/contracts';
import {
  Button,
  Callout,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  PageHeader,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  HistoryIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  ZapIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type FieldErrors, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { StepBar } from '../../components/step-bar';
import { ApiError } from '../../lib/api/client';
import { useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatNumber, formatTimeOfDay } from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { dayParam, idParam } from '../../lib/search-params';
import { holidaysQuery } from '../hr/hr.queries';
import { assigneeLeaves, LeaveWarningDialog } from '../tasks/leave-warning';
import { useClientOptions } from '../tasks/task-form';
import { draftContext, uploadAge } from '../tasks/task-wizard-draft';
import { CaptionEditor, useXLongPosts } from './caption-editor';
import { contentIdeasQuery, useCreatePost } from './content.queries';
import {
  ApprovalField,
  ClientField,
  CycleLineField,
  NotesField,
  PlatformsField,
  PublishFields,
  postFormFailure,
  ResponsibleField,
  TitleField,
  TypeField,
} from './post-form';
import { PostPreview } from './post-preview-panel';
import {
  captionsOf,
  checkedMedia,
  clearPostDraft,
  createPostPayload,
  fileTypeOf,
  loadPostDraft,
  notHeld,
  POST_WIZARD_STEPS,
  type PostWizardFile,
  type PostWizardStep,
  type PostWizardTask,
  type PostWizardValues,
  savePostDraft,
  stepOfPart,
} from './post-wizard-draft';
import {
  IdeaPicker,
  LinkTasksField,
  MediaStep,
  NewTasksList,
  OccasionField,
  PillarField,
  PlanningNotes,
  ReviewChecks,
  SuggestedTimes,
  TaskReadiness,
  usePostUploads,
} from './post-wizard-steps';
import { PostTaskDialog } from './post-wizard-task-dialog';

export interface NewPostSearch {
  clientId?: string;
  /** The calendar day clicked (rule B4). */
  date?: string;
  /** The idea the post starts from (rule C12). */
  ideaId?: string;
}

export function parseNewPostSearch(search: Record<string, unknown>): NewPostSearch {
  return {
    clientId: idParam(search.clientId),
    date: dayParam(search.date),
    ideaId: idParam(search.ideaId),
  };
}

/** The browser's local storage, or null where it is blocked (a private window, a policy). */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The step that holds the first invalid field. */
function stepOfErrors(errors: FieldErrors<PostWizardValues>): PostWizardStep {
  const keys = Object.keys(errors);
  if (keys.some((key) => !['captions', 'files', 'tasks', 'linkTaskIds'].includes(key))) {
    return 'basics';
  }
  if (keys.includes('captions')) return 'captions';
  if (keys.includes('files')) return 'media';
  return 'tasks';
}

/**
 * F08B screen 1: the new post wizard, basics → captions → media → tasks → review, with the
 * post's preview per platform beside the steps. The draft stays in this browser until it is
 * saved (rule B1), and the post, its captions, media and tasks are saved in one request (rule B2).
 */
export function NewPostPage({ search }: { search: NewPostSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const create = useCreatePost();
  const clients = useClientOptions();
  const today = businessDate();
  const context = draftContext({ ...search });
  const [restored] = useState(() => {
    const storage = browserStorage();
    return storage ? loadPostDraft(storage, me.user.id, context) : null;
  });
  const fresh = (): PostWizardValues => ({
    clientId: search.clientId ?? '',
    title: '',
    type: 'post',
    platforms: [],
    // A new post is never in the past (`INVALID_DATES`, rule B4).
    publishDate: search.date && search.date > today ? search.date : today,
    publishTime: null,
    captions: [],
    notes: '',
    needsClientApproval: true,
    responsibleId: me.user.id,
    cycleLineId: null,
    pillarId: null,
    occasionId: null,
    ideaId: undefined,
    linkTaskIds: [],
    files: [],
    tasks: [],
  });
  const [step, setStep] = useState<PostWizardStep>(restored?.step ?? 'basics');
  const [files, setFiles] = useState<PostWizardFile[]>(restored?.files ?? []);
  const [tasks, setTasks] = useState<PostWizardTask[]>(restored?.tasks ?? []);
  const [showRestored, setShowRestored] = useState(!!restored);
  const [failure, setFailure] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<PostWizardTask | 'new' | null>(null);
  // F17 rule B17: the leaves the API named, for "Assign anyway".
  const [leaveWarning, setLeaveWarning] = useState<AssigneeLeave[] | null>(null);
  const uploads = usePostUploads(setFiles);
  const form = useForm<PostWizardValues, unknown, CreatePost>({
    resolver: standardSchemaResolver(createPostSchema),
    defaultValues: restored?.values ?? fresh(),
  });
  const values = useWatch({ control: form.control }) as PostWizardValues;
  const platforms = (values.platforms ?? []) as PostPlatform[];
  const client = clients.find((option) => option.id === values.clientId);
  const xLongPosts = useXLongPosts(values.clientId || undefined);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const holidays = useQuery(holidaysQuery(Number((values.publishDate || today).slice(0, 4))));
  const back = search.clientId
    ? ({
        to: '/clients/$clientId',
        params: { clientId: search.clientId },
        search: { tab: 'content' },
      } as const)
    : ({ to: '/content' } as const);

  // The draft follows every change, so a reload brings it back (rule B1).
  useEffect(() => {
    const storage = browserStorage();
    if (!storage) return;
    const timer = setTimeout(
      () => savePostDraft(storage, me.user.id, { context, step, values, files, tasks }),
      300,
    );
    return () => clearTimeout(timer);
  }, [context, step, values, files, tasks, me.user.id]);

  // Opened from an idea (rule C12): its text, client, pillar and occasion fill a new draft once.
  const ideas = useQuery({
    ...contentIdeasQuery({ status: 'open', pageSize: 100 }),
    enabled: !!search.ideaId && !restored,
  });
  const appliedIdea = useRef(false);
  useEffect(() => {
    if (appliedIdea.current || !search.ideaId) return;
    const idea = ideas.data?.items.find((item) => item.id === search.ideaId);
    if (!idea) return;
    appliedIdea.current = true;
    applyIdea({
      id: idea.id,
      text: idea.text,
      clientId: idea.client?.id ?? null,
      pillarId: idea.pillar && !idea.pillar.archived ? idea.pillar.id : null,
      occasionId: idea.occasion && !idea.occasion.archived ? idea.occasion.id : null,
    });
  });

  const captions = captionsOf(platforms, values.captions);
  const checks = postChecks(
    { type: values.type ?? 'post', platforms, captions },
    checkedMedia(files),
    { xLongPosts },
  );

  function applyIdea(idea: {
    id: string;
    text: string;
    clientId: string | null;
    pillarId: string | null;
    occasionId: string | null;
  }) {
    const dirty = { shouldDirty: true } as const;
    form.setValue('ideaId', idea.id, dirty);
    form.setValue('title', idea.text.slice(0, POST_LIMITS.title), dirty);
    if (idea.clientId) form.setValue('clientId', idea.clientId, dirty);
    if (idea.pillarId) form.setValue('pillarId', idea.pillarId, dirty);
    if (idea.occasionId) form.setValue('occasionId', idea.occasionId, dirty);
  }

  function goTo(next: PostWizardStep) {
    setStep(next);
    setFailure(null);
    // The new step's heading takes the focus, so a screen reader starts there.
    requestAnimationFrame(() => stepHeading.current?.focus());
  }

  function startOver() {
    for (const file of files) uploads.remove(file.key);
    const storage = browserStorage();
    if (storage) clearPostDraft(storage, me.user.id);
    form.reset(fresh());
    setFiles([]);
    setTasks([]);
    setShowRestored(false);
    goTo('basics');
  }

  /** Uploads still running, failed or purged keep the post from being saved (F06B rule C3). */
  function filesProblem(): PostWizardStep | null {
    const expired = (file: { uploadedAt: string | null }) =>
      uploadAge(file, new Date()) === 'expired';
    if (files.some((file) => notHeld(file) || expired(file))) return 'media';
    if (tasks.some((task) => task.files.some((file) => notHeld(file) || expired(file)))) {
      return 'tasks';
    }
    return null;
  }

  const submit = (acceptLeave: boolean) =>
    form.handleSubmit(
      async (post) => {
        setFailure(null);
        const fileStep = filesProblem();
        if (fileStep) {
          goTo(fileStep);
          setFailure(t('tasks.wizard.files.notReady'));
          return;
        }
        if (post.linkTaskIds.length + tasks.length > POST_LIMITS.tasks) {
          goTo('tasks');
          setFailure(t('content.wizard.tasks.limit', { max: formatNumber(POST_LIMITS.tasks) }));
          return;
        }
        const payload = createPostPayload(
          { ...post, ...(acceptLeave && { acceptLeave: true }) },
          files,
          tasks,
        );
        try {
          const saved = await create.mutateAsync(payload);
          const storage = browserStorage();
          if (storage) clearPostDraft(storage, me.user.id);
          toast.add({ title: t('content.new.created'), type: 'success' });
          await navigate({ to: '/content/posts/$postId', params: { postId: saved.id } });
        } catch (error) {
          const leaves = assigneeLeaves(error);
          if (leaves) {
            setLeaveWarning(leaves);
            return;
          }
          setFailure(saveFailure(error));
        }
      },
      (errors) => {
        goTo(stepOfErrors(errors));
        setFailure(t('tasks.wizard.invalid'));
      },
    )();

  /** A refusal naming a part (rule B2) opens its step; a field's goes to Basics. */
  function saveFailure(error: unknown): string | null {
    const details =
      error instanceof ApiError
        ? (error.details as { part?: string; index?: number } | undefined)
        : undefined;
    const partStep = stepOfPart(details?.part);
    if (partStep && details?.part) {
      goTo(partStep);
      return t('tasks.wizard.partFailure', {
        part: t(
          `content.wizard.parts.${details.part as 'captions' | 'files' | 'tasks' | 'links'}`,
          {
            n: formatNumber((details.index ?? 0) + 1),
          },
        ),
        reason: errorMessage(t, error),
      });
    }
    const message = postFormFailure(form, t, error);
    if (message === null) goTo('basics');
    return message;
  }

  const index = POST_WIZARD_STEPS.indexOf(step);
  const aging = [...files, ...tasks.flatMap((task) => task.files)].some(
    (file) => uploadAge(file, new Date()) === 'aging',
  );
  const linked = values.linkTaskIds?.length ?? 0;
  const counts = POST_WIZARD_STEPS.map((item) =>
    item === 'media' ? files.length : item === 'tasks' ? linked + tasks.length : 0,
  );
  const preview = (
    <PostPreview
      clientName={client?.name ?? t('content.preview.clientPlaceholder')}
      clientImage={imageSrc(client?.imageId ?? null, 'sm') ?? null}
      type={values.type ?? 'post'}
      platforms={platforms}
      captions={captions}
      media={files.map((file) => ({
        key: file.key,
        src: uploads.previews[file.key] ?? null,
        type: fileTypeOf(file.mimeType),
        slideCaption: file.slideCaption.trim() || null,
      }))}
    />
  );
  const taskDefaults = {
    title: postTaskTitle(values.type ?? 'post', values.title || t('content.wizard.untitled')),
    department: postTaskDepartment(values.type ?? 'post'),
    dueDate: values.publishDate
      ? postTaskDueDate(values.publishDate, today, holidays.data?.items ?? [])
      : today,
    clientId: values.clientId ?? '',
  };

  return (
    <>
      <PageHeader
        title={t('content.wizard.title')}
        description={
          search.clientId && client
            ? t('content.new.forClient', { client: client.name })
            : t('content.wizard.subtitle')
        }
        actions={
          <Button variant="ghost" render={<Link {...back} />}>
            <ArrowRightIcon className="ltr:-scale-x-100" />
            {t('content.wizard.back')}
          </Button>
        }
      />
      {showRestored && (
        <Callout
          icon={<HistoryIcon />}
          title={t('tasks.wizard.restored.title')}
          description={t('tasks.wizard.restored.body')}
          action={
            <Button variant="outline" size="sm" onClick={startOver}>
              <RotateCcwIcon />
              {t('tasks.wizard.startOver')}
            </Button>
          }
        />
      )}
      {aging && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t('tasks.wizard.files.agingTitle')}
          description={t('tasks.wizard.files.agingBody')}
        />
      )}
      <StepBar
        steps={POST_WIZARD_STEPS}
        step={step}
        label={t('content.wizard.stepsLabel')}
        stepName={(item) => t(`content.wizard.steps.${item}`)}
        counts={counts}
        onGoTo={goTo}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <form
          className="flex min-w-0 flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (step === 'review') void submit(false);
          }}
          noValidate
        >
          <div className="flex flex-col gap-1">
            <h2 ref={stepHeading} tabIndex={-1} className="text-lg font-bold outline-none">
              {t('tasks.wizard.stepOf', {
                n: formatNumber(index + 1),
                total: formatNumber(POST_WIZARD_STEPS.length),
                step: t(`content.wizard.steps.${step}`),
              })}
            </h2>
            <p className="text-sm text-muted-foreground">{t(`content.wizard.stepHints.${step}`)}</p>
          </div>
          {step === 'basics' && (
            <>
              <FormSection
                title={t('content.wizard.sections.post')}
                hint={t('content.wizard.sections.postHint')}
              >
                <IdeaPicker form={form} onPick={applyIdea} />
                {!search.clientId && <ClientField form={form} />}
                <TitleField form={form} />
                <TypeField form={form} />
                <PlatformsField form={form} />
              </FormSection>
              <FormSection
                title={t('content.wizard.sections.when')}
                hint={t('content.wizard.sections.whenHint')}
              >
                <PublishFields form={form} />
                <SuggestedTimes form={form} />
              </FormSection>
              <FormSection
                title={t('content.wizard.sections.plan')}
                hint={t('content.wizard.sections.planHint')}
              >
                <PillarField form={form} />
                <OccasionField form={form} />
                <CycleLineField form={form} />
              </FormSection>
              <FormSection
                title={t('content.wizard.sections.team')}
                hint={t('content.wizard.sections.teamHint')}
              >
                <ResponsibleField form={form} />
                <ApprovalField form={form} />
                <NotesField form={form} />
              </FormSection>
            </>
          )}
          {step === 'captions' && (
            <CaptionEditor
              clientId={values.clientId || undefined}
              platforms={platforms}
              captions={values.captions ?? []}
              onChange={(next) =>
                form.setValue('captions', next as PostWizardValues['captions'], {
                  shouldDirty: true,
                })
              }
            />
          )}
          {step === 'media' && (
            <MediaStep files={files} setFiles={setFiles} uploads={uploads} checks={checks} />
          )}
          {step === 'tasks' && (
            <>
              <FormSection
                title={t('content.wizard.tasks.linkTitle')}
                hint={t('content.wizard.tasks.linkHint')}
              >
                <LinkTasksField form={form} room={POST_LIMITS.tasks - linked - tasks.length} />
              </FormSection>
              <FormSection
                title={t('content.wizard.tasks.newSection')}
                hint={t('content.wizard.tasks.newHint')}
              >
                <NewTasksList
                  tasks={tasks}
                  canAdd={!!values.clientId && linked + tasks.length < POST_LIMITS.tasks}
                  onAdd={() => setEditingTask('new')}
                  onEdit={setEditingTask}
                  onRemove={(key) => setTasks((current) => current.filter((t) => t.key !== key))}
                />
              </FormSection>
            </>
          )}
          {step === 'review' && (
            <div className="flex flex-col gap-6">
              <ReviewSummary
                values={values}
                files={files.length}
                tasks={linked + tasks.length}
                onGoTo={goTo}
              />
              <section className="flex flex-col gap-3">
                <h3 className="font-bold">{t('content.checks.title')}</h3>
                <ReviewChecks checks={checks} onGoTo={goTo} />
              </section>
              {values.clientId && values.publishDate && (
                <section className="flex flex-col gap-3">
                  <h3 className="font-bold">{t('content.wizard.planning.title')}</h3>
                  <PlanningNotes
                    clientId={values.clientId}
                    date={values.publishDate}
                    time={values.publishTime ?? null}
                    platforms={platforms}
                    occasionId={values.occasionId ?? null}
                    onGoTo={goTo}
                  />
                </section>
              )}
              {tasks.length > 0 && (
                <section className="flex flex-col gap-3">
                  <h3 className="font-bold">{t('tasks.wizard.review.readiness')}</h3>
                  {tasks.map((item) => (
                    <TaskReadiness key={item.key} item={item} />
                  ))}
                </section>
              )}
            </div>
          )}
          <Collapsible className="lg:hidden">
            <CollapsibleTrigger className="rounded-md border border-border px-3 py-2 text-sm font-medium">
              {t('content.preview.title')}
            </CollapsibleTrigger>
            <CollapsiblePanel className="pt-3">{preview}</CollapsiblePanel>
          </Collapsible>
          {failure && <FormAlert>{failure}</FormAlert>}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            {index > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => goTo(POST_WIZARD_STEPS[index - 1] as PostWizardStep)}
              >
                <ArrowRightIcon className="ltr:-scale-x-100" />
                {t('tasks.wizard.back')}
              </Button>
            )}
            <span className="me-auto" />
            {step === 'basics' && (
              <Button
                type="button"
                variant="outline"
                disabled={form.formState.isSubmitting}
                onClick={() => void submit(false)}
              >
                <ZapIcon />
                {t('tasks.wizard.createNow')}
              </Button>
            )}
            {/* Keys: "Next" must not turn into the submit button in the click that leaves for Review. */}
            {step === 'review' ? (
              <Button key="save" type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? t('common.saving') : t('content.wizard.save')}
              </Button>
            ) : (
              <Button
                key="next"
                type="button"
                onClick={() => goTo(POST_WIZARD_STEPS[index + 1] as PostWizardStep)}
              >
                {t('tasks.wizard.next')}
                <ArrowLeftIcon className="ltr:-scale-x-100" />
              </Button>
            )}
          </div>
        </form>
        <aside
          aria-label={t('content.preview.title')}
          className="hidden flex-col gap-3 rounded-lg border border-border bg-surface p-4 lg:sticky lg:top-4 lg:flex"
        >
          <h2 className="text-sm font-bold">{t('content.preview.title')}</h2>
          {preview}
        </aside>
      </div>
      <PostTaskDialog
        editing={editingTask}
        defaults={taskDefaults}
        accountManagerId={client?.accountManagerId ?? null}
        onClose={() => setEditingTask(null)}
        onSave={(saved) => {
          const key = editingTask && editingTask !== 'new' ? editingTask.key : crypto.randomUUID();
          setTasks((current) =>
            current.some((item) => item.key === key)
              ? current.map((item) => (item.key === key ? { ...saved, key } : item))
              : [...current, { ...saved, key }],
          );
        }}
      />
      <LeaveWarningDialog
        leaves={leaveWarning}
        onClose={() => setLeaveWarning(null)}
        pending={create.isPending}
        onConfirm={async () => {
          setLeaveWarning(null);
          await submit(true);
        }}
      />
    </>
  );
}

function ReviewSummary({
  values,
  files,
  tasks,
  onGoTo,
}: {
  values: PostWizardValues;
  files: number;
  tasks: number;
  onGoTo: (step: PostWizardStep) => void;
}) {
  const { t } = useTranslation();
  const filled = captionsOf((values.platforms ?? []) as PostPlatform[], values.captions).filter(
    (caption) => caption.caption?.trim(),
  ).length;
  const rows: { step: PostWizardStep; label: string; value: string }[] = [
    {
      step: 'basics',
      label: t('content.wizard.steps.basics'),
      value: [
        values.title || t('content.wizard.untitled'),
        values.type ? t(`content.types.${values.type}`) : null,
        values.publishDate ? formatCalendarDate(values.publishDate) : null,
        values.publishTime ? formatTimeOfDay(values.publishTime) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    },
    {
      step: 'captions',
      label: t('content.wizard.steps.captions'),
      value: t('content.wizard.review.captions', {
        n: formatNumber(filled),
        total: formatNumber(captionsOf((values.platforms ?? []) as PostPlatform[], []).length),
      }),
    },
    {
      step: 'media',
      label: t('content.wizard.steps.media'),
      value: files === 0 ? t('tasks.wizard.review.none') : formatNumber(files),
    },
    {
      step: 'tasks',
      label: t('content.wizard.steps.tasks'),
      value: tasks === 0 ? t('tasks.wizard.review.none') : formatNumber(tasks),
    },
  ];
  return (
    <dl className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {rows.map((row) => (
        <div key={row.step} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <dt className="w-28 text-sm text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 flex-1 text-sm font-medium">{row.value}</dd>
          <Button type="button" variant="ghost" size="sm" onClick={() => onGoTo(row.step)}>
            {t('tasks.wizard.review.edit')}
          </Button>
        </div>
      ))}
    </dl>
  );
}
