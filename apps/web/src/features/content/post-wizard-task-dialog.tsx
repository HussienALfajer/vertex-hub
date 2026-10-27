import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  type CreateTask,
  createTaskSchema,
  type DepartmentCode,
  keepsBriefFields,
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
  FieldLabel,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import { SendIcon, UserRoundCheckIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { useMe } from '../../lib/auth';
import { SCREEN_ERROR } from '../../lib/errors';
import { memberOf } from '../tasks/task-access';
import {
  AssigneeField,
  checkDueDate,
  DepartmentField,
  DueFields,
  EstimateField,
  RichBriefField,
  type TaskFormMethods,
  TitleField,
  useAssigneeOptions,
} from '../tasks/task-form';
import type { WizardFile, WizardValues } from '../tasks/task-wizard-draft';
import { FilesStep, SubtasksStep, useWizardUploads } from '../tasks/task-wizard-steps';
import type { PostWizardTask } from './post-wizard-draft';

/*
 * F08B rule B1, the Tasks step: a new task of the post with its subtasks, run mode, stages and
 * files, as F06B's wizard takes them, checked here and saved with the post (rule B2).
 */

export interface TaskDefaults {
  title: string;
  department: DepartmentCode;
  dueDate: string;
  clientId: string;
}

export function PostTaskDialog({
  editing,
  defaults,
  accountManagerId,
  onClose,
  onSave,
}: {
  /** The task to edit, `new` for a new one, null when closed. */
  editing: PostWizardTask | 'new' | null;
  defaults: TaskDefaults;
  accountManagerId: string | null;
  onClose: () => void;
  onSave: (task: Omit<PostWizardTask, 'key'>) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-3xl">
        {editing !== null && (
          <TaskForm
            task={editing === 'new' ? null : editing}
            defaults={defaults}
            accountManagerId={accountManagerId}
            onClose={onClose}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function startValues(defaults: TaskDefaults): WizardValues {
  return {
    type: 'work',
    title: defaults.title,
    briefDoc: null,
    briefFields: null,
    estimateMinutes: null,
    department: defaults.department,
    assigneeId: null,
    priority: 'normal',
    dueDate: defaults.dueDate,
    dueTime: null,
    clientId: defaults.clientId,
    // F08 rule 8: the client approves the post, not its tasks.
    needsClientApproval: false,
    dependsOn: [],
    checklist: [],
    criteria: [],
    links: [],
    stages: [],
    subtasks: [],
    questions: [],
  } as WizardValues;
}

function TaskForm({
  task,
  defaults,
  accountManagerId,
  onClose,
  onSave,
}: {
  task: PostWizardTask | null;
  defaults: TaskDefaults;
  accountManagerId: string | null;
  onClose: () => void;
  onSave: (task: Omit<PostWizardTask, 'key'>) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const modeId = useId();
  const [mode, setMode] = useState<PostWizardTask['mode']>(task?.mode ?? 'assign');
  const [files, setFiles] = useState<WizardFile[]>(task?.files ?? []);
  const [failure, setFailure] = useState<string | null>(null);
  const uploads = useWizardUploads(setFiles);
  const form: TaskFormMethods = useForm<WizardValues, unknown, CreateTask>({
    resolver: standardSchemaResolver(createTaskSchema),
    defaultValues: task ? (task.task as WizardValues) : startValues(defaults),
  });
  const department = useWatch({ control: form.control, name: 'department' }) ?? undefined;
  const previous = useRef(department);
  previous.current = department;
  const assignees = useAssigneeOptions(department, accountManagerId);
  const hint = !department
    ? t('tasks.form.assigneeHintDepartment')
    : assignees.anyone
      ? t('tasks.form.assigneeHint')
      : memberOf(me, department)
        ? t('tasks.form.assigneeHintSelf')
        : t('tasks.form.assigneeHintNone');

  const submit = form.handleSubmit(
    (values) => {
      setFailure(null);
      if (files.some((file) => file.failed || file.uploadId === null)) {
        setFailure(t('tasks.wizard.files.notReady'));
        return;
      }
      if (!checkDueDate(form, t, values.dueDate)) return;
      if (mode === 'assign' && !values.assigneeId) {
        form.setError(
          'assigneeId',
          { type: SCREEN_ERROR, message: t('tasks.form.errors.assignee') },
          { shouldFocus: true },
        );
        return;
      }
      onSave({ task: values, mode, files });
      onClose();
    },
    () => setFailure(t('tasks.wizard.invalid')),
  );

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        // The task form sits inside the wizard's form: its submit stays here.
        event.stopPropagation();
        void submit(event);
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {task ? t('content.wizard.tasks.editTitle') : t('content.wizard.tasks.newTitle')}
        </DialogTitle>
        <DialogDescription>{t('content.wizard.tasks.newBody')}</DialogDescription>
      </DialogHeader>
      <FormSection title={t('tasks.form.who')} hint={t('tasks.form.whoHint')}>
        <Field>
          <FieldLabel id={modeId} render={<span />}>
            {t('tasks.form.mode')}
          </FieldLabel>
          <ToggleGroup
            aria-labelledby={modeId}
            value={[mode]}
            onValueChange={(next: PostWizardTask['mode'][]) => {
              if (!next[0]) return;
              setMode(next[0]);
              form.setValue('assigneeId', null);
            }}
          >
            <ToggleGroupItem value="request">
              <SendIcon className="rtl:-scale-x-100" />
              {t('content.wizard.tasks.queue')}
            </ToggleGroupItem>
            <ToggleGroupItem value="assign">
              <UserRoundCheckIcon />
              {t('tasks.form.modes.assign')}
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <DepartmentField
          form={form}
          onChange={(next) => {
            form.setValue('assigneeId', null);
            const from = previous.current;
            if (from && !keepsBriefFields(from, next)) form.setValue('briefFields', null);
          }}
        />
        {mode === 'assign' && <AssigneeField form={form} options={assignees.options} hint={hint} />}
      </FormSection>
      <FormSection title={t('tasks.form.work')} hint={t('tasks.form.workHint')}>
        <TitleField form={form} />
        <RichBriefField form={form} />
        <div className="grid gap-5 sm:grid-cols-2">
          <EstimateField form={form} />
        </div>
        <DueFields form={form} />
      </FormSection>
      <FormSection
        title={t('tasks.wizard.steps.subtasks')}
        hint={t('tasks.wizard.stepHints.subtasks')}
      >
        <SubtasksStep
          form={form}
          files={files}
          setFiles={setFiles}
          accountManagerId={accountManagerId}
        />
      </FormSection>
      <FormSection title={t('tasks.wizard.steps.files')} hint={t('tasks.wizard.stepHints.files')}>
        <FilesStep form={form} files={files} setFiles={setFiles} uploads={uploads} />
      </FormSection>
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit">{t('content.wizard.tasks.keep')}</Button>
      </DialogFooter>
    </form>
  );
}
