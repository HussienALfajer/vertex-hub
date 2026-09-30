import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  businessDate,
  type CreateTask,
  type CreateTaskInput,
  createTaskSchema,
  DEFAULT_REVISION_LIMIT,
  DEPARTMENT_CODES,
  type DepartmentCode,
} from '@vertex-hub/contracts';
import {
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  PageHeader,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import { ArrowRightIcon, SendIcon, UserRoundCheckIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { useMe } from '../../lib/auth';
import { SCREEN_ERROR } from '../../lib/errors';
import { idParam, oneOfParam } from '../../lib/search-params';
import { hasClientScope, logsClientRequests, memberOf } from './task-access';
import {
  ApprovalFields,
  AssigneeField,
  BriefField,
  ChecklistField,
  ClientField,
  ClientRequestFields,
  checkDueDate,
  DepartmentField,
  DependenciesField,
  DueFields,
  EngagementFields,
  LinksField,
  PriorityField,
  type TaskFormMethods,
  TitleField,
  taskFormFailure,
  useAssigneeOptions,
  useClientOptions,
} from './task-form';
import { useCreateTask } from './tasks.queries';

type Mode = 'request' | 'assign';

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

export function NewTaskPage({ search }: { search: NewTaskSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const create = useCreateTask();
  const clients = useClientOptions();
  const [mode, setMode] = useState<Mode>(search.mode ?? 'assign');
  const [failure, setFailure] = useState<string | null>(null);
  const ownDepartment = me.departments.find((department) => department.isPrimary)?.code;
  const form: TaskFormMethods = useForm<CreateTaskInput, unknown, CreateTask>({
    resolver: standardSchemaResolver(createTaskSchema),
    defaultValues: {
      type: 'work',
      title: '',
      brief: '',
      department: search.department ?? (mode === 'assign' ? ownDepartment : undefined),
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
      links: [],
    },
  });
  const [department, clientId, type] = useWatch({
    control: form.control,
    name: ['department', 'clientId', 'type'],
  });
  const client = clients.find((option) => option.id === clientId);
  const assignees = useAssigneeOptions(department ?? undefined, client?.accountManagerId ?? null);
  const clientScope = !!client && hasClientScope(me, client.accountManagerId);
  const back = search.projectId
    ? ({ to: '/projects/$projectId', params: { projectId: search.projectId } } as const)
    : search.clientId
      ? ({ to: '/clients/$clientId', params: { clientId: search.clientId } } as const)
      : ({ to: '/tasks' } as const);

  // A client request needs a client under the user's client scope; changing the client may end it.
  const clientRequestLost = type === 'client_request' && !clientScope;
  useEffect(() => {
    if (clientRequestLost) setClientRequest(false);
  });

  function switchMode(next: Mode) {
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

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (!checkDueDate(form, t, values.dueDate)) return;
    if (mode === 'assign' && !values.assigneeId) {
      form.setError('assigneeId', {
        type: SCREEN_ERROR,
        message: t('tasks.form.errors.assignee'),
      });
      return;
    }
    try {
      const task = await create.mutateAsync({
        ...values,
        assigneeId: mode === 'assign' ? values.assigneeId : null,
      });
      toast.add({ title: t('tasks.new.created'), type: 'success' });
      await navigate({ to: '/tasks/$taskId', params: { taskId: task.id } });
    } catch (error) {
      setFailure(taskFormFailure(form, t, error));
    }
  });

  const assigneeHint = !department
    ? t('tasks.form.assigneeHintDepartment')
    : assignees.anyone
      ? t('tasks.form.assigneeHint')
      : memberOf(me, department)
        ? t('tasks.form.assigneeHintSelf')
        : t('tasks.form.assigneeHintNone');

  return (
    <>
      <PageHeader
        title={mode === 'request' ? t('tasks.new.requestTitle') : t('tasks.new.title')}
        description={mode === 'request' ? t('tasks.new.requestSubtitle') : t('tasks.new.subtitle')}
        actions={
          <Button variant="ghost" render={<Link {...back} />}>
            <ArrowRightIcon className="ltr:-scale-x-100" />
            {t('tasks.new.back')}
          </Button>
        }
      />
      <form className="flex max-w-4xl flex-col gap-6" onSubmit={submit} noValidate>
        <FormSection title={t('tasks.form.who')} hint={t('tasks.form.whoHint')}>
          <ModeField mode={mode} onChange={switchMode} />
          <DepartmentField
            form={form}
            onChange={() => {
              form.setValue('assigneeId', null);
            }}
          />
          {mode === 'assign' && (
            <AssigneeField form={form} options={assignees.options} hint={assigneeHint} />
          )}
        </FormSection>
        <FormSection title={t('tasks.form.work')} hint={t('tasks.form.workHint')}>
          <TitleField form={form} />
          <BriefField form={form} />
          <PriorityField form={form} />
          <DueFields form={form} />
        </FormSection>
        <FormSection title={t('tasks.form.clientSection')} hint={t('tasks.form.clientSectionHint')}>
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
          <DependenciesField form={form} />
          <ChecklistField form={form} />
          <LinksField form={form} />
        </FormSection>
        {failure && <FormAlert>{failure}</FormAlert>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="outline" render={<Link {...back} />}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? t('tasks.form.creating')
              : mode === 'request'
                ? t('tasks.form.sendRequest')
                : t('tasks.form.create')}
          </Button>
        </div>
      </form>
    </>
  );
}

/** Request from a department (its manager assigns it) or assign someone now. */
function ModeField({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
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
        onValueChange={(next: Mode[]) => {
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
      <label htmlFor={id} className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t('tasks.form.clientRequest')}</span>
        <Switch id={id} checked={on && allowed} disabled={!allowed} onCheckedChange={onChange} />
      </label>
      <FieldDescription>
        {allowed ? t('tasks.form.clientRequestHint') : t('tasks.form.clientRequestNotAllowed')}
      </FieldDescription>
    </Field>
  );
}
