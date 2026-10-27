import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  type AssigneeLeave,
  businessDate,
  type CreateTask,
  createTaskSchema,
  DEFAULT_REVISION_LIMIT,
  DEPARTMENT_CODES,
  type DepartmentCode,
  keepsBriefFields,
  type ReadinessWarning,
  type TaskTemplateDraft,
} from '@vertex-hub/contracts';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Callout,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Field,
  FieldDescription,
  FieldLabel,
  PageHeader,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  HistoryIcon,
  LayersIcon,
  RotateCcwIcon,
  SendIcon,
  TriangleAlertIcon,
  UserRoundCheckIcon,
  ZapIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { type FieldErrors, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { StepBar } from '../../components/step-bar';
import { ApiError } from '../../lib/api/client';
import { useMe } from '../../lib/auth';
import { errorMessage, SCREEN_ERROR } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { idParam, oneOfParam } from '../../lib/search-params';
import { useDebouncedValue } from '../../lib/use-search-text';
import { StartFromTemplateDialog } from '../templates/task-template-dialogs';
import { assigneeLeaves, LeaveWarningDialog } from './leave-warning';
import { hasClientScope, logsClientRequests, memberOf } from './task-access';
import { FlowPreview } from './task-flow-preview';
import {
  ApprovalFields,
  AssigneeField,
  BriefFieldsField,
  ChecklistField,
  ClientField,
  ClientRequestFields,
  checkDueDate,
  DepartmentField,
  DependenciesField,
  DueFields,
  EngagementFields,
  EstimateField,
  LinksField,
  PriorityField,
  RichBriefField,
  type TaskFormMethods,
  TitleField,
  taskFormFailure,
  useAssigneeOptions,
  useClientOptions,
} from './task-form';
import {
  clearDraft,
  createPayload,
  draftContext,
  loadDraft,
  readinessInput,
  saveDraft,
  uploadAge,
  valuesFromTemplate,
  WIZARD_STEPS,
  type WizardFile,
  type WizardMode,
  type WizardStep,
  type WizardValues,
} from './task-wizard-draft';
import {
  FilesStep,
  QuestionsStep,
  ReadinessWarnings,
  ReviewStep,
  SubtasksStep,
  stepCount,
  useWizardUploads,
} from './task-wizard-steps';
import { taskReadinessQuery, useCreateTask } from './tasks.queries';

export interface NewTaskSearch {
  /** Unset means assign. */
  mode?: 'request';
  department?: DepartmentCode;
  clientId?: string;
  projectId?: string;
  milestoneId?: string;
  retainerCycleId?: string;
  cycleLineId?: string;
}

/** Presets from a project, milestone, retainer line or client; anything malformed is dropped. */
export function parseNewTaskSearch(search: Record<string, unknown>): NewTaskSearch {
  return {
    mode: search.mode === 'request' ? 'request' : undefined,
    department: oneOfParam(DEPARTMENT_CODES, search.department),
    clientId: idParam(search.clientId),
    projectId: idParam(search.projectId),
    milestoneId: idParam(search.milestoneId),
    retainerCycleId: idParam(search.retainerCycleId),
    cycleLineId: idParam(search.cycleLineId),
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

function startValues(search: NewTaskSearch, department: DepartmentCode | undefined): WizardValues {
  return {
    type: 'work',
    title: '',
    briefDoc: null,
    briefFields: null,
    estimateMinutes: null,
    department,
    assigneeId: null,
    priority: 'normal',
    dueDate: '',
    dueTime: null,
    clientId: search.clientId ?? null,
    projectId: search.projectId ?? null,
    milestoneId: search.milestoneId ?? null,
    retainerCycleId: search.retainerCycleId ?? null,
    cycleLineId: search.cycleLineId ?? null,
    needsClientApproval: !!search.clientId,
    revisionLimit: DEFAULT_REVISION_LIMIT,
    dependsOn: [],
    checklist: [],
    criteria: [],
    links: [],
    stages: [],
    subtasks: [],
    questions: [],
  } as WizardValues;
}

/** The step that holds the first invalid field. */
function stepOfErrors(errors: FieldErrors<WizardValues>): WizardStep {
  const keys = Object.keys(errors);
  if (keys.some((key) => !['subtasks', 'stages', 'runMode', 'questions', 'files'].includes(key)))
    return 'basics';
  if (keys.some((key) => ['subtasks', 'stages', 'runMode'].includes(key))) return 'subtasks';
  if (keys.includes('questions')) return 'questions';
  return 'files';
}

/**
 * F06B screen 1: the new task wizard, basics → subtasks → files → questions → review, with the
 * flow's live preview beside the steps. The draft stays in this browser until it is saved (rule
 * C1) and is saved in one request (rule C2). "Create now" on Basics saves at once, after the
 * readiness check (rule C5).
 */
export function NewTaskPage({ search }: { search: NewTaskSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useCreateTask();
  const clients = useClientOptions();
  const context = draftContext({ ...search });
  const ownDepartment = me.departments.find((department) => department.isPrimary)?.code;
  const [restored] = useState(() => {
    const storage = browserStorage();
    return storage ? loadDraft(storage, me.user.id, context) : null;
  });
  const fresh = () =>
    startValues(
      search,
      search.department ?? (search.mode === 'request' ? undefined : ownDepartment),
    );
  const [mode, setMode] = useState<WizardMode>(restored?.mode ?? search.mode ?? 'assign');
  const [step, setStep] = useState<WizardStep>(restored?.step ?? 'basics');
  const [files, setFiles] = useState<WizardFile[]>(restored?.files ?? []);
  const [showRestored, setShowRestored] = useState(!!restored);
  // Rich text editors start from their value when they mount: a new key fills them again.
  const [round, setRound] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  const [confirmWarnings, setConfirmWarnings] = useState<ReadinessWarning[] | null>(null);
  // F17 rule B17: the leaves the API named, and the request waiting for "Assign anyway".
  const [leaveWarning, setLeaveWarning] = useState<AssigneeLeave[] | null>(null);
  const uploads = useWizardUploads(setFiles);
  const form: TaskFormMethods = useForm<WizardValues, unknown, CreateTask>({
    resolver: standardSchemaResolver(createTaskSchema),
    defaultValues: restored?.values ?? fresh(),
  });
  const values = useWatch({ control: form.control }) as WizardValues;
  const { department, clientId, type } = values;
  const client = clients.find((option) => option.id === clientId);
  const assignees = useAssigneeOptions(department ?? undefined, client?.accountManagerId ?? null);
  const clientScope = !!client && hasClientScope(me, client.accountManagerId);
  const needsClientApproval = clientId ? (values.needsClientApproval ?? true) : false;
  const previousDepartment = useRef(department);
  previousDepartment.current = department;
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const back = search.projectId
    ? ({ to: '/projects/$projectId', params: { projectId: search.projectId } } as const)
    : search.clientId
      ? ({ to: '/clients/$clientId', params: { clientId: search.clientId } } as const)
      : ({ to: '/tasks' } as const);

  // The draft follows every change, so a reload brings it back (rule C1).
  useEffect(() => {
    const storage = browserStorage();
    if (!storage) return;
    const timer = setTimeout(
      () => saveDraft(storage, me.user.id, { context, step, mode, values, files }),
      300,
    );
    return () => clearTimeout(timer);
  }, [context, step, mode, values, files, me.user.id]);

  // Rule C5: the warnings of the draft, shown in the preview and on Review; they never block.
  const readiness = useDebouncedValue(readinessInput(values, files, needsClientApproval), 500);
  const warnings = useQuery(taskReadinessQuery(readiness));
  const currentWarnings = readiness ? warnings.data?.warnings : undefined;

  // A client request needs a client under the user's client scope; changing the client may end it.
  const clientRequestLost = type === 'client_request' && !clientScope;
  useEffect(() => {
    if (clientRequestLost) setClientRequest(false);
  });

  function goTo(next: WizardStep) {
    setStep(next);
    setFailure(null);
    // The new step's heading takes the focus, so a screen reader starts there.
    requestAnimationFrame(() => stepHeading.current?.focus());
  }

  function switchMode(next: WizardMode) {
    setMode(next);
    form.setValue('assigneeId', null);
    form.clearErrors('assigneeId');
  }

  function setClientRequest(on: boolean) {
    form.setValue('type', on ? 'client_request' : 'work');
    form.setValue('requestedOn', on ? businessDate() : undefined);
    form.setValue('requestScope', on ? 'in_scope' : undefined);
    form.setValue('requestedByContactId', on ? null : undefined);
  }

  function applyTemplate(draft: TaskTemplateDraft) {
    form.reset(valuesFromTemplate(form.getValues(), draft), { keepDefaultValues: true });
    // The template's subtasks replace the draft's: their files go on the task.
    setFiles((current) =>
      current.map((file) =>
        file.target.kind === 'subtask' ? { ...file, target: { kind: 'task' } } : file,
      ),
    );
    // Rule D2: without a default the user may set, the task goes to its department's queue.
    setMode(draft.assigneeId ? 'assign' : 'request');
    setRound((current) => current + 1);
    toast.add({ title: t('tasks.wizard.template.applied'), type: 'success' });
  }

  function startOver() {
    for (const file of files) uploads.remove(file.key);
    const storage = browserStorage();
    if (storage) clearDraft(storage, me.user.id);
    form.reset(fresh());
    setFiles([]);
    setMode(search.mode ?? 'assign');
    setShowRestored(false);
    setRound((current) => current + 1);
    goTo('basics');
  }

  /** Uploads still running, failed or purged keep the task from being saved (rule C3). */
  function filesProblem(): WizardStep | null {
    const blocked = files.find(
      (file) => file.failed || file.uploadId === null || uploadAge(file, new Date()) === 'expired',
    );
    if (!blocked) return null;
    return blocked.target.kind === 'question' ? 'questions' : 'files';
  }

  const submit = (acceptLeave: boolean) =>
    form.handleSubmit(
      async (task) => {
        setFailure(null);
        const fileStep = filesProblem();
        if (fileStep) {
          goTo(fileStep);
          setFailure(t('tasks.wizard.files.notReady'));
          return;
        }
        if (!checkDueDate(form, t, task.dueDate)) {
          goTo('basics');
          return;
        }
        if (mode === 'assign' && !task.assigneeId) {
          goTo('basics');
          form.setError(
            'assigneeId',
            { type: SCREEN_ERROR, message: t('tasks.form.errors.assignee') },
            { shouldFocus: true },
          );
          return;
        }
        const payload = createPayload(
          {
            ...task,
            assigneeId: mode === 'assign' ? task.assigneeId : null,
            ...(acceptLeave && { acceptLeave: true }),
          },
          files,
        );
        try {
          const saved = await create.mutateAsync(payload);
          const storage = browserStorage();
          if (storage) clearDraft(storage, me.user.id);
          toast.add({ title: t('tasks.new.created'), type: 'success' });
          await navigate({ to: '/tasks/$taskId', params: { taskId: saved.id } });
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

  /** A refusal naming a part (rule C2) goes to its step; a field's goes to Basics. */
  function saveFailure(error: unknown): string | null {
    const details =
      error instanceof ApiError
        ? (error.details as { part?: string; index?: number } | undefined)
        : undefined;
    if (
      details?.part === 'subtasks' ||
      details?.part === 'files' ||
      details?.part === 'questions'
    ) {
      goTo(details.part);
      return t('tasks.wizard.partFailure', {
        part: t(`tasks.wizard.parts.${details.part}`, {
          n: formatNumber((details.index ?? 0) + 1),
        }),
        reason: errorMessage(t, error),
      });
    }
    const message = taskFormFailure(form, t, error);
    if (message === null) goTo('basics');
    return message;
  }

  /** "Create now": the readiness check first, as a confirmation when it warns (rule C1). */
  async function createNow() {
    setFailure(null);
    const check = readinessInput(form.getValues(), files, needsClientApproval);
    if (!check || !(await form.trigger())) {
      await submit(false);
      return;
    }
    let found: ReadinessWarning[] = [];
    try {
      found = (await queryClient.fetchQuery(taskReadinessQuery(check))).warnings;
    } catch {
      // The check never blocks: without it, the task is saved as F06 did.
    }
    if (found.length > 0) setConfirmWarnings(found);
    else await submit(false);
  }

  const index = WIZARD_STEPS.indexOf(step);
  const assigneeHint = !department
    ? t('tasks.form.assigneeHintDepartment')
    : assignees.anyone
      ? t('tasks.form.assigneeHint')
      : memberOf(me, department)
        ? t('tasks.form.assigneeHintSelf')
        : t('tasks.form.assigneeHintNone');
  const aging = files.some((file) => uploadAge(file, new Date()) === 'aging');
  const preview = <FlowPreview form={form} warnings={currentWarnings} />;

  return (
    <>
      <PageHeader
        title={mode === 'request' ? t('tasks.new.requestTitle') : t('tasks.new.title')}
        description={t('tasks.wizard.subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setChoosingTemplate(true)}>
              <LayersIcon />
              {t('tasks.wizard.template.start')}
            </Button>
            <Button variant="ghost" render={<Link {...back} />}>
              <ArrowRightIcon className="ltr:-scale-x-100" />
              {t('tasks.new.back')}
            </Button>
          </div>
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
        steps={WIZARD_STEPS}
        step={step}
        label={t('tasks.wizard.stepsLabel')}
        stepName={(item) => t(`tasks.wizard.steps.${item}`)}
        counts={WIZARD_STEPS.map((item) => stepCount(item, values, files))}
        onGoTo={goTo}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <form
          className="flex min-w-0 flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (step === 'review') submit(false);
          }}
          noValidate
        >
          <div className="flex flex-col gap-1">
            <h2 ref={stepHeading} tabIndex={-1} className="text-lg font-bold outline-none">
              {t('tasks.wizard.stepOf', {
                n: formatNumber(index + 1),
                total: formatNumber(WIZARD_STEPS.length),
                step: t(`tasks.wizard.steps.${step}`),
              })}
            </h2>
            <p className="text-sm text-muted-foreground">{t(`tasks.wizard.stepHints.${step}`)}</p>
          </div>
          <div key={round} className="contents">
            {step === 'basics' && (
              <>
                <FormSection title={t('tasks.form.who')} hint={t('tasks.form.whoHint')}>
                  <ModeField mode={mode} onChange={switchMode} />
                  <DepartmentField
                    form={form}
                    onChange={(next) => {
                      form.setValue('assigneeId', null);
                      const from = previousDepartment.current;
                      if (from && !keepsBriefFields(from, next)) form.setValue('briefFields', null);
                    }}
                  />
                  {mode === 'assign' && (
                    <AssigneeField form={form} options={assignees.options} hint={assigneeHint} />
                  )}
                </FormSection>
                <FormSection title={t('tasks.form.work')} hint={t('tasks.form.workHint')}>
                  <TitleField form={form} />
                  <RichBriefField form={form} />
                  <BriefFieldsField form={form} />
                  <div className="grid gap-5 sm:grid-cols-2">
                    <EstimateField form={form} />
                  </div>
                  <PriorityField form={form} />
                  <DueFields form={form} />
                </FormSection>
                <FormSection
                  title={t('tasks.form.clientSection')}
                  hint={t('tasks.form.clientSectionHint')}
                >
                  <ClientField form={form} clients={clients} />
                  <EngagementFields form={form} />
                  <ApprovalFields form={form} />
                  {logsClientRequests(me) && clientId && (
                    <ClientRequestSwitch
                      on={type === 'client_request'}
                      allowed={clientScope}
                      onChange={setClientRequest}
                    />
                  )}
                  {type === 'client_request' && clientScope && <ClientRequestFields form={form} />}
                </FormSection>
                <FormSection title={t('tasks.form.plan')} hint={t('tasks.form.planHint')}>
                  <ChecklistField form={form} name="criteria" />
                  <DependenciesField form={form} />
                  <ChecklistField form={form} />
                  <LinksField form={form} />
                </FormSection>
              </>
            )}
            {step === 'subtasks' && (
              <SubtasksStep
                form={form}
                files={files}
                setFiles={setFiles}
                accountManagerId={client?.accountManagerId ?? null}
              />
            )}
            {step === 'files' && (
              <FilesStep form={form} files={files} setFiles={setFiles} uploads={uploads} />
            )}
            {step === 'questions' && (
              <QuestionsStep form={form} files={files} setFiles={setFiles} uploads={uploads} />
            )}
            {step === 'review' && (
              <ReviewStep
                form={form}
                files={files}
                warnings={currentWarnings}
                checking={warnings.isFetching}
                onGoTo={goTo}
              />
            )}
          </div>
          <Collapsible className="lg:hidden">
            <CollapsibleTrigger className="rounded-md border border-border px-3 py-2 text-sm font-medium">
              {t('tasks.wizard.preview.title')}
            </CollapsibleTrigger>
            <CollapsiblePanel className="pt-3">{preview}</CollapsiblePanel>
          </Collapsible>
          {failure && <FormAlert>{failure}</FormAlert>}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            {index > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => goTo(WIZARD_STEPS[index - 1] as WizardStep)}
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
                onClick={createNow}
              >
                <ZapIcon />
                {mode === 'request' ? t('tasks.wizard.sendNow') : t('tasks.wizard.createNow')}
              </Button>
            )}
            {/* Keys: "Next" must not turn into the submit button in the click that leaves for Review. */}
            {step === 'review' ? (
              <Button key="save" type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? t('tasks.form.creating')
                  : mode === 'request'
                    ? t('tasks.form.sendRequest')
                    : t('tasks.form.create')}
              </Button>
            ) : (
              <Button
                key="next"
                type="button"
                onClick={() => goTo(WIZARD_STEPS[index + 1] as WizardStep)}
              >
                {t('tasks.wizard.next')}
                <ArrowLeftIcon className="ltr:-scale-x-100" />
              </Button>
            )}
          </div>
        </form>
        <aside
          aria-label={t('tasks.wizard.preview.title')}
          className="hidden flex-col gap-3 rounded-lg border border-border bg-surface p-4 lg:sticky lg:top-4 lg:flex"
        >
          <h2 className="text-sm font-bold">{t('tasks.wizard.preview.title')}</h2>
          {preview}
        </aside>
      </div>
      <StartFromTemplateDialog
        open={choosingTemplate}
        onClose={() => setChoosingTemplate(false)}
        onApply={applyTemplate}
      />
      <ReadinessConfirmDialog
        warnings={confirmWarnings}
        subtaskTitles={(values.subtasks ?? []).map((subtask) => subtask.title ?? '')}
        onClose={() => setConfirmWarnings(null)}
        onConfirm={async () => {
          const onLeave = confirmWarnings?.some((w) => w.code === 'assignee_on_leave') ?? false;
          setConfirmWarnings(null);
          await submit(onLeave);
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

/** "Create now" with readiness warnings: they never block, the user confirms (rule C5). */
function ReadinessConfirmDialog({
  warnings,
  subtaskTitles,
  onClose,
  onConfirm,
}: {
  warnings: ReadinessWarning[] | null;
  subtaskTitles: string[];
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<ReadinessWarning[]>([]);
  if (warnings && warnings !== shown) setShown(warnings);
  return (
    <AlertDialog open={warnings !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('tasks.wizard.review.confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('tasks.wizard.review.confirmBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <ReadinessWarnings warnings={shown} subtaskTitles={subtaskTitles} />
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            {t('tasks.wizard.review.change')}
          </AlertDialogClose>
          <Button onClick={onConfirm}>{t('tasks.wizard.review.createAnyway')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Request from a department (its manager assigns it) or assign someone now. */
function ModeField({ mode, onChange }: { mode: WizardMode; onChange: (mode: WizardMode) => void }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field>
      <FieldLabel id={id} render={<span />}>
        {t('tasks.form.mode')}
      </FieldLabel>
      <ToggleGroup
        aria-labelledby={id}
        value={[mode]}
        onValueChange={(next: WizardMode[]) => {
          if (next[0]) onChange(next[0]);
        }}
      >
        <ToggleGroupItem value="request">
          <SendIcon className="rtl:-scale-x-100" />
          {t('tasks.form.modes.request')}
        </ToggleGroupItem>
        <ToggleGroupItem value="assign">
          <UserRoundCheckIcon />
          {t('tasks.form.modes.assign')}
        </ToggleGroupItem>
      </ToggleGroup>
      <FieldDescription>
        {mode === 'request' ? t('tasks.form.modes.requestHint') : t('tasks.form.modes.assignHint')}
      </FieldDescription>
    </Field>
  );
}

/** Logging a client request needs client scope (the client's account manager, or scope all). */
function ClientRequestSwitch({
  on,
  allowed,
  onChange,
}: {
  on: boolean;
  allowed: boolean;
  onChange: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field>
      {/* The switch stays beside its own label, not at the far end of the row. */}
      <label htmlFor={id} className="flex items-center gap-3">
        <span className="text-sm font-medium">{t('tasks.form.clientRequest')}</span>
        <Switch id={id} checked={on && allowed} disabled={!allowed} onCheckedChange={onChange} />
      </label>
      <FieldDescription>
        {allowed ? t('tasks.form.clientRequestHint') : t('tasks.form.clientRequestNotAllowed')}
      </FieldDescription>
    </Field>
  );
}
