import { useQuery } from '@tanstack/react-query';
import {
  businessDate,
  type CreateTask,
  type CreateTaskInput,
  type DepartmentCode,
  OPEN_TASK_STATUSES,
  REQUEST_SCOPES,
  type RequestScope,
  TASK_LIMITS,
  TASK_PRIORITIES,
  type TaskDependency,
  type TaskDetail,
  type TaskPriority,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Button,
  Callout,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  MultiCombobox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { LinkIcon, PlusIcon, ReceiptTextIcon, XIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  Controller,
  type FieldPath,
  type UseFormReturn,
  useFieldArray,
  useWatch,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api/client';
import { useMe } from '../../lib/auth';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { focusAfterRemoval } from '../../lib/focus-after-removal';
import { formatMonth, formatNumber } from '../../lib/format';
import { useDebouncedValue } from '../../lib/use-search-text';
import { ClientStatusBadge } from '../clients/client-badges';
import { clientListQuery, clientQuery } from '../clients/clients.queries';
import { departmentListQuery } from '../departments/departments.queries';
import { projectListQuery, projectQuery } from '../projects/projects.queries';
import { lineName } from '../retainers/retainer-badges';
import { retainerListQuery } from '../retainers/retainers.queries';
import { userListQuery } from '../users/users.queries';
import { canAssignIn, memberOf } from './task-access';
import { taskListQuery } from './tasks.queries';

export type TaskFormMethods = UseFormReturn<CreateTaskInput, unknown, CreateTask>;

type TaskField = FieldPath<CreateTaskInput>;

/** The field a refusal concerns; anything else shows above the buttons. */
const FIELD_OF_CODE: Record<string, TaskField> = {
  INVALID_ASSIGNEE: 'assigneeId',
  INVALID_DATES: 'dueDate',
  UNKNOWN_CONTACT: 'requestedByContactId',
  INVALID_DEPENDENCY: 'dependsOn',
  DEPENDENCY_CYCLE: 'dependsOn',
  CLIENT_ARCHIVED: 'clientId',
  CLIENT_ENDED: 'clientId',
  NO_ENGAGEMENT: 'projectId',
  INVALID_LINK: 'projectId',
  PROJECT_CLOSED: 'projectId',
  PROJECT_ARCHIVED: 'projectId',
  RETAINER_ARCHIVED: 'projectId',
  CYCLE_CLOSED: 'projectId',
  MILESTONE_DONE: 'milestoneId',
  EXTRA_WORK_BILLED: 'requestScope',
};

/**
 * Puts a failed save on the field it concerns and returns the form-level message for anything
 * else (null when a field took it).
 */
export function taskFormFailure(form: TaskFormMethods, t: TFunction, error: unknown) {
  const field = error instanceof ApiError ? FIELD_OF_CODE[error.code ?? ''] : undefined;
  if (field) {
    // The shared text of `INVALID_DATES` speaks of a start date, which tasks do not have.
    const message = field === 'dueDate' ? t('tasks.form.errors.duePast') : errorMessage(t, error);
    form.setError(field, { type: SCREEN_ERROR, message }, { shouldFocus: true });
    return null;
  }
  return errorMessage(t, error);
}

/** Rule 12 before the round trip: a new task is not due in the past. */
export function checkDueDate(form: TaskFormMethods, t: TFunction, dueDate: string) {
  if (dueDate >= businessDate()) return true;
  form.setError(
    'dueDate',
    { type: SCREEN_ERROR, message: t('tasks.form.errors.duePast') },
    { shouldFocus: true },
  );
  return false;
}

const Optional = () => {
  const { t } = useTranslation();
  return <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>;
};

export function TitleField({ form }: { form: TaskFormMethods }) {
  const { t } = useTranslation();
  const error = form.formState.errors.title;
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('tasks.form.title')}</FieldLabel>
      <Input
        autoComplete="off"
        placeholder={t('tasks.form.titlePlaceholder')}
        {...form.register('title')}
      />
      <FieldError match={!!error}>{t('tasks.form.errors.title')}</FieldError>
    </Field>
  );
}

export function BriefField({ form }: { form: TaskFormMethods }) {
  const { t } = useTranslation();
  const error = form.formState.errors.brief;
  return (
    <Field invalid={!!error}>
      <FieldLabel>
        {t('tasks.form.brief')}
        <Optional />
      </FieldLabel>
      <Textarea
        rows={4}
        placeholder={t('tasks.form.briefPlaceholder')}
        {...form.register('brief')}
      />
      <FieldError match={!!error}>{t('tasks.form.errors.brief')}</FieldError>
    </Field>
  );
}

export function PriorityField({ form }: { form: TaskFormMethods }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field>
      <FieldLabel id={id} render={<span />}>
        {t('tasks.form.priority')}
      </FieldLabel>
      <Controller
        control={form.control}
        name="priority"
        render={({ field }) => (
          <ToggleGroup
            aria-labelledby={id}
            value={[field.value ?? 'normal']}
            onValueChange={(next: TaskPriority[]) => {
              if (next[0]) field.onChange(next[0]);
            }}
          >
            {TASK_PRIORITIES.map((priority) => (
              <ToggleGroupItem key={priority} value={priority}>
                {t(`tasks.priorities.${priority}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      />
    </Field>
  );
}

/** The due date and an optional time after which the task is overdue (rule 12). */
export function DueFields({ form, allowPast }: { form: TaskFormMethods; allowPast?: boolean }) {
  const { t } = useTranslation();
  const dateError = form.formState.errors.dueDate;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field invalid={!!dateError}>
        <FieldLabel>{t('tasks.form.dueDate')}</FieldLabel>
        <Input
          type="date"
          dir="ltr"
          min={allowPast ? undefined : businessDate()}
          {...form.register('dueDate')}
        />
        <FieldError match={!!dateError} role={errorRole(dateError)}>
          {fieldError(dateError, t('tasks.form.errors.dueDate'))}
        </FieldError>
      </Field>
      <Field>
        <FieldLabel>
          {t('tasks.form.dueTime')}
          <Optional />
        </FieldLabel>
        <Controller
          control={form.control}
          name="dueTime"
          render={({ field }) => (
            <Input
              type="time"
              dir="ltr"
              value={field.value ?? ''}
              onChange={(event) => field.onChange(event.target.value || null)}
              onBlur={field.onBlur}
              ref={field.ref}
            />
          )}
        />
        <FieldDescription>{t('tasks.form.dueTimeHint')}</FieldDescription>
      </Field>
    </div>
  );
}

/** Department names and ids by code, from the API (names are editable, F01). */
export function useDepartments() {
  const departments = useQuery(departmentListQuery);
  return departments.data?.items ?? [];
}

export function DepartmentField({
  form,
  onChange,
}: {
  form: TaskFormMethods;
  onChange?: (department: DepartmentCode) => void;
}) {
  const { t } = useTranslation();
  const departments = useDepartments();
  const error = form.formState.errors.department;
  const items = departments.map(({ code, name }) => ({ value: code, label: name }));
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('tasks.form.department')}</FieldLabel>
      <Controller
        control={form.control}
        name="department"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value ?? null}
            onValueChange={(value) => {
              if (!value) return;
              field.onChange(value);
              onChange?.(value as DepartmentCode);
            }}
          >
            <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
              <SelectValue placeholder={t('tasks.form.departmentPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldError match={!!error}>{t('tasks.form.errors.department')}</FieldError>
    </Field>
  );
}

export interface AssigneeOption {
  id: string;
  name: string;
  note: string | null;
}

/** The members of a department (invited ones only for user managers, so they are left out). */
export function useDepartmentMembers(
  department: DepartmentCode | undefined,
  enabled = true,
): AssigneeOption[] {
  const departmentId = useDepartments().find(({ code }) => code === department)?.id;
  const members = useQuery({
    ...userListQuery({ departmentId, pageSize: 100 }),
    enabled: !!departmentId && enabled,
  });
  return (members.data?.items ?? []).map((user) => ({
    id: user.id,
    name: user.name,
    note: user.title,
  }));
}

/**
 * Who the user may assign in the department (rule 6): every member with assign scope for it,
 * else themselves when they belong to it.
 */
export function useAssigneeOptions(
  department: DepartmentCode | undefined,
  clientAccountManagerId: string | null,
): { options: AssigneeOption[]; anyone: boolean } {
  const me = useMe();
  const anyone = !!department && canAssignIn(me, department, clientAccountManagerId);
  const members = useDepartmentMembers(department, anyone);
  if (!department) return { options: [], anyone: false };
  if (anyone) return { options: members, anyone };
  return {
    options: memberOf(me, department) ? [{ id: me.user.id, name: me.user.name, note: null }] : [],
    anyone,
  };
}

export function AssigneeField({
  form,
  options,
  hint,
}: {
  form: TaskFormMethods;
  options: AssigneeOption[];
  hint: string;
}) {
  const { t } = useTranslation();
  const error = form.formState.errors.assigneeId;
  const items = options.map((option) => ({ value: option.id, label: option.name }));
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('tasks.form.assignee')}</FieldLabel>
      <Controller
        control={form.control}
        name="assigneeId"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value ?? null}
            onValueChange={(value) => field.onChange(value ?? null)}
            disabled={options.length === 0}
          >
            <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
              <SelectValue placeholder={t('tasks.form.assigneePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  <span className="flex items-center gap-2">
                    <Avatar name={option.name} size="sm" />
                    {option.name}
                    {option.note && (
                      <span className="text-sm text-muted-foreground">{option.note}</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldDescription>{hint}</FieldDescription>
      <FieldError match={!!error} role={errorRole(error)}>{fieldError(error, t('tasks.form.errors.assignee'))}</FieldError>
    </Field>
  );
}

/** A client a task can link to, with its account manager for the scope checks. */
export interface ClientOption {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'ended';
  accountManagerId: string;
}

/** Active and paused clients (rule 7), plus the task's current client when it has ended. */
export function useClientOptions(current?: ClientOption | null): ClientOption[] {
  const clients = useQuery(clientListQuery({ status: ['active', 'paused'], pageSize: 100 }));
  const options: ClientOption[] = (clients.data?.items ?? []).map((client) => ({
    id: client.id,
    name: client.tradeName,
    status: client.status as ClientOption['status'],
    accountManagerId: client.accountManager.id,
  }));
  if (current && !options.some((option) => option.id === current.id)) options.push(current);
  return options;
}

const INTERNAL = 'internal';

/**
 * The client, or none for an internal agency task. Changing it drops the links that belonged to
 * the previous client, and a new client turns client approval on (rule 8).
 */
export function ClientField({ form, clients }: { form: TaskFormMethods; clients: ClientOption[] }) {
  const { t } = useTranslation();
  const error = form.formState.errors.clientId;
  const items = [
    { value: INTERNAL, label: t('tasks.form.internal') },
    ...clients.map((client) => ({ value: client.id, label: client.name })),
  ];
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('tasks.form.client')}</FieldLabel>
      <Controller
        control={form.control}
        name="clientId"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value ?? INTERNAL}
            onValueChange={(value) => {
              const next = !value || value === INTERNAL ? null : value;
              if (next === (field.value ?? null)) return;
              field.onChange(next);
              for (const name of [
                'projectId',
                'milestoneId',
                'retainerCycleId',
                'cycleLineId',
              ] as const)
                form.setValue(name, null, { shouldDirty: true });
              form.setValue('requestedByContactId', undefined, { shouldDirty: true });
              form.setValue('needsClientApproval', next !== null, { shouldDirty: true });
              form.setValue('dependsOn', []);
            }}
          >
            <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INTERNAL}>
                <span className="text-muted-foreground">{t('tasks.form.internal')}</span>
              </SelectItem>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  <span className="flex items-center gap-2">
                    <Avatar name={client.name} shape="square" size="sm" />
                    {client.name}
                    {client.status !== 'active' && <ClientStatusBadge status={client.status} />}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldDescription>{t('tasks.form.clientHint')}</FieldDescription>
      <FieldError match={!!error} role={errorRole(error)}>{fieldError(error, t('tasks.form.errors.client'))}</FieldError>
    </Field>
  );
}

/** What the task links to now, kept as an option when it is no longer open (rule 7). */
export interface CurrentEngagement {
  project: { id: string; name: string } | null;
  milestone: { id: string; name: string } | null;
  retainer: { id: string; name: string } | null;
  cycle: { id: string; periodStart: string } | null;
  cycleLine: TaskDetail['cycleLine'];
}

/**
 * A project and optionally one of its pending milestones, or a retainer's open cycle and
 * optionally one of its lines (rule 7).
 */
export function EngagementFields({
  form,
  current,
}: {
  form: TaskFormMethods;
  current?: CurrentEngagement;
}) {
  const { t } = useTranslation();
  const [clientId, projectId, cycleId] = useWatch({
    control: form.control,
    name: ['clientId', 'projectId', 'retainerCycleId'],
  });
  // No placeholder: another client's projects must never be offered while these load.
  const projects = useQuery({
    ...projectListQuery({ clientId: clientId ?? undefined, pageSize: 100 }),
    enabled: !!clientId,
    placeholderData: undefined,
  });
  const retainers = useQuery({
    ...retainerListQuery({ clientId: clientId ?? undefined, pageSize: 100 }),
    enabled: !!clientId,
    placeholderData: undefined,
  });
  const project = useQuery({ ...projectQuery(projectId ?? ''), enabled: !!projectId });
  if (!clientId) return null;

  const engagementItems = [
    { value: 'none', label: t('tasks.form.noEngagement') },
    ...(projects.data?.items ?? []).map((item) => ({
      value: `project:${item.id}`,
      label: item.name,
    })),
    ...(retainers.data?.items ?? []).flatMap((item) =>
      item.currentCycle
        ? [
            {
              value: `cycle:${item.currentCycle.id}`,
              label: t('tasks.form.retainerCycle', {
                retainer: item.name,
                month: formatMonth(item.currentCycle.periodStart),
              }),
            },
          ]
        : [],
    ),
  ];
  if (
    current?.project &&
    !engagementItems.some((item) => item.value === `project:${current.project?.id}`)
  )
    engagementItems.push({ value: `project:${current.project.id}`, label: current.project.name });
  if (
    current?.retainer &&
    current.cycle &&
    !engagementItems.some((item) => item.value === `cycle:${current.cycle?.id}`)
  )
    engagementItems.push({
      value: `cycle:${current.cycle.id}`,
      label: t('tasks.form.retainerCycle', {
        retainer: current.retainer.name,
        month: formatMonth(current.cycle.periodStart),
      }),
    });
  const value = projectId ? `project:${projectId}` : cycleId ? `cycle:${cycleId}` : 'none';

  const milestoneItems = [
    { value: 'none', label: t('tasks.form.noMilestone') },
    ...(project.data?.milestones ?? [])
      .filter((milestone) => milestone.status === 'pending')
      .map((milestone) => ({ value: milestone.id, label: milestone.name })),
  ];
  if (
    current?.milestone &&
    projectId === current.project?.id &&
    !milestoneItems.some((item) => item.value === current.milestone?.id)
  )
    milestoneItems.push({ value: current.milestone.id, label: current.milestone.name });

  const cycle = (retainers.data?.items ?? [])
    .map((item) => item.currentCycle)
    .find((item) => item?.id === cycleId);
  const lineItems = [
    { value: 'none', label: t('tasks.form.noLine') },
    ...(cycle?.lines ?? []).map((line) => ({ value: line.id, label: lineName(t, line) })),
  ];
  if (
    current?.cycleLine &&
    cycleId === current.cycle?.id &&
    !lineItems.some((item) => item.value === current.cycleLine?.id)
  )
    lineItems.push({ value: current.cycleLine.id, label: lineName(t, current.cycleLine) });

  const error =
    form.formState.errors.projectId ?? form.formState.errors.retainerCycleId ?? undefined;
  const milestoneError = form.formState.errors.milestoneId;

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field invalid={!!error}>
        <FieldLabel>
          {t('tasks.form.engagement')}
          <Optional />
        </FieldLabel>
        {/* One select for two fields; refusals on either go to `projectId`, which holds the focus. */}
        <Controller
          control={form.control}
          name="projectId"
          render={({ field }) => (
            <Select
              items={engagementItems}
              value={value}
              onValueChange={(next) => {
                const [kind, id] = (next ?? 'none').split(':');
                field.onChange(kind === 'project' ? (id ?? null) : null);
                form.setValue('retainerCycleId', kind === 'cycle' ? (id ?? null) : null, {
                  shouldDirty: true,
                });
                form.setValue('milestoneId', null, { shouldDirty: true });
                form.setValue('cycleLineId', null, { shouldDirty: true });
                form.clearErrors(['projectId', 'retainerCycleId']);
              }}
            >
              <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {engagementItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <FieldDescription>{t('tasks.form.engagementHint')}</FieldDescription>
        <FieldError match={!!error} role={errorRole(error)}>
          {fieldError(error, t('tasks.form.errors.engagement'))}
        </FieldError>
      </Field>
      {projectId && (
        <Field invalid={!!milestoneError}>
          <FieldLabel>
            {t('tasks.form.milestone')}
            <Optional />
          </FieldLabel>
          <Controller
            control={form.control}
            name="milestoneId"
            render={({ field }) => (
              <Select
                items={milestoneItems}
                value={field.value ?? 'none'}
                onValueChange={(next) => field.onChange(!next || next === 'none' ? null : next)}
              >
                <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {milestoneItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError match={!!milestoneError} role={errorRole(milestoneError)}>
            {fieldError(milestoneError, t('tasks.form.errors.engagement'))}
          </FieldError>
        </Field>
      )}
      {cycleId && (
        <Field>
          <FieldLabel>
            {t('tasks.form.line')}
            <Optional />
          </FieldLabel>
          <Controller
            control={form.control}
            name="cycleLineId"
            render={({ field }) => (
              <Select
                items={lineItems}
                value={field.value ?? 'none'}
                onValueChange={(next) => field.onChange(!next || next === 'none' ? null : next)}
              >
                <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {lineItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>{t('tasks.form.lineHint')}</FieldDescription>
        </Field>
      )}
    </div>
  );
}

/** Client approval and the revision limit; a task without a client needs neither (rule 8). */
export function ApprovalFields({ form }: { form: TaskFormMethods }) {
  const { t } = useTranslation();
  const ids = { approval: useId(), limit: useId() };
  const clientId = useWatch({ control: form.control, name: 'clientId' });
  const limitError = form.formState.errors.revisionLimit;
  if (!clientId) return null;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field>
        {/* The switch stays beside its own label, away from the next column's field. */}
        <label htmlFor={ids.approval} className="flex items-center gap-3">
          <span className="text-sm font-medium">{t('tasks.form.needsClientApproval')}</span>
          <Controller
            control={form.control}
            name="needsClientApproval"
            render={({ field }) => (
              <Switch
                id={ids.approval}
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </label>
        <FieldDescription>{t('tasks.form.needsClientApprovalHint')}</FieldDescription>
      </Field>
      <Field invalid={!!limitError}>
        <FieldLabel htmlFor={ids.limit}>{t('tasks.form.revisionLimit')}</FieldLabel>
        <Input
          id={ids.limit}
          type="number"
          inputMode="numeric"
          min={0}
          max={TASK_LIMITS.revisionLimit}
          className="w-28"
          {...form.register('revisionLimit', { valueAsNumber: true })}
        />
        <FieldDescription>{t('tasks.form.revisionLimitHint')}</FieldDescription>
        <FieldError match={!!limitError}>
          {t('tasks.form.errors.revisionLimit', { max: formatNumber(TASK_LIMITS.revisionLimit) })}
        </FieldError>
      </Field>
    </div>
  );
}

/**
 * Who at the client asked, when, and whether the agreement covers it. Out of scope logs an extra
 * work item on the project or retainer (rule 11).
 */
export function ClientRequestFields({
  form,
  scopeLocked,
}: {
  form: TaskFormMethods;
  scopeLocked?: boolean;
}) {
  const { t } = useTranslation();
  const ids = { contact: useId(), scope: useId() };
  const [clientId, scope] = useWatch({ control: form.control, name: ['clientId', 'requestScope'] });
  const client = useQuery({ ...clientQuery(clientId ?? ''), enabled: !!clientId });
  const contacts = client.data?.contacts ?? [];
  const contactItems = [
    { value: 'none', label: t('tasks.form.noContact') },
    ...contacts.map((contact) => ({ value: contact.id, label: contact.name })),
  ];
  const errors = form.formState.errors;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.requestedByContactId}>
          <FieldLabel id={ids.contact} render={<span />}>
            {t('tasks.form.requestedBy')}
            <Optional />
          </FieldLabel>
          <Controller
            control={form.control}
            name="requestedByContactId"
            render={({ field }) => (
              <Select
                items={contactItems}
                value={field.value ?? 'none'}
                onValueChange={(next) => field.onChange(!next || next === 'none' ? null : next)}
              >
                <SelectTrigger aria-labelledby={ids.contact} onBlur={field.onBlur} ref={field.ref}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contactItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError match={!!errors.requestedByContactId} role={errorRole(errors.requestedByContactId)}>
            {fieldError(errors.requestedByContactId, t('errors.UNKNOWN_CONTACT'))}
          </FieldError>
        </Field>
        <Field invalid={!!errors.requestedOn}>
          <FieldLabel>{t('tasks.form.requestedOn')}</FieldLabel>
          <Input type="date" dir="ltr" max={businessDate()} {...form.register('requestedOn')} />
          <FieldError match={!!errors.requestedOn}>{t('tasks.form.errors.requestedOn')}</FieldError>
        </Field>
      </div>
      <Field invalid={!!errors.requestScope}>
        <FieldLabel id={ids.scope} render={<span />}>
          {t('tasks.form.requestScope')}
        </FieldLabel>
        <Controller
          control={form.control}
          name="requestScope"
          render={({ field }) => (
            <ToggleGroup
              aria-labelledby={ids.scope}
              value={[field.value ?? 'in_scope']}
              disabled={scopeLocked}
              onValueChange={(next: RequestScope[]) => {
                if (next[0]) field.onChange(next[0]);
              }}
            >
              {REQUEST_SCOPES.map((value) => (
                <ToggleGroupItem key={value} value={value}>
                  {t(`tasks.requestScopes.${value}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        />
        <FieldError match={!!errors.requestScope} role={errorRole(errors.requestScope)}>
          {fieldError(errors.requestScope, t('errors.EXTRA_WORK_BILLED'))}
        </FieldError>
      </Field>
      {scope === 'out_of_scope' && (
        <Callout
          icon={<ReceiptTextIcon />}
          title={t('tasks.form.outOfScopeTitle')}
          description={t('tasks.form.outOfScopeBody')}
        />
      )}
    </div>
  );
}

/** A task that can be waited on: same client, or both internal (rule 4). */
export interface DependencyOption {
  id: string;
  title: string;
  status: TaskDependency['status'];
}

/**
 * Open tasks of the client (or internal ones) a task may wait on, searched on the server by the
 * typed title, so any of them can be found however many there are. Options of another client
 * are never shown while the new ones load.
 */
export function useDependencyOptions(clientId: string | null, excludeId?: string) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search);
  const tasks = useQuery({
    ...taskListQuery({
      ...(clientId ? { clientId } : { internal: 'true' }),
      // Only unfinished work can hold a task up (rule 3).
      status: [...OPEN_TASK_STATUSES],
      ...(debounced && { search: debounced }),
      pageSize: 50,
    }),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2]?.clientId === (clientId ?? undefined) ? previous : undefined,
  });
  const options = (tasks.data?.items ?? [])
    .filter((task) => task.id !== excludeId)
    .map(({ id, title, status }) => ({ id, title, status }));
  return { options, onSearch: setSearch };
}

export function DependenciesPicker({
  id,
  options,
  onSearch,
  value,
  onChange,
  invalid,
}: {
  id?: string;
  options: DependencyOption[];
  onSearch?: (text: string) => void;
  value: DependencyOption[];
  onChange: (next: DependencyOption[]) => void;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <MultiCombobox
      id={id}
      items={options}
      onSearch={onSearch}
      value={value}
      onValueChange={(next) => onChange(next.slice(0, TASK_LIMITS.dependencies))}
      itemToLabel={(item) => item.title}
      itemToKey={(item) => item.id}
      placeholder={t('tasks.form.dependenciesPlaceholder')}
      emptyLabel={t('common.noMatches')}
      removeLabel={(label) => t('common.remove', { label })}
      invalid={invalid}
    />
  );
}

export function DependenciesField({ form }: { form: TaskFormMethods }) {
  const { t } = useTranslation();
  const id = useId();
  const clientId = useWatch({ control: form.control, name: 'clientId' });
  const { options, onSearch } = useDependencyOptions(clientId ?? null);
  const error = form.formState.errors.dependsOn;
  return (
    <Field invalid={!!error}>
      <FieldLabel htmlFor={id}>
        {t('tasks.form.dependencies')}
        <Optional />
      </FieldLabel>
      <Controller
        control={form.control}
        name="dependsOn"
        render={({ field }) => (
          <DependenciesPicker
            id={id}
            options={options}
            onSearch={onSearch}
            value={(field.value ?? []).flatMap(
              (taskId) => options.find((option) => option.id === taskId) ?? [],
            )}
            onChange={(next) => field.onChange(next.map((option) => option.id))}
            invalid={!!error}
          />
        )}
      />
      <FieldDescription>{t('tasks.form.dependenciesHint')}</FieldDescription>
      <FieldError match={!!error} role={errorRole(error)}>
        {fieldError(error as never, t('errors.INVALID_DEPENDENCY'))}
      </FieldError>
    </Field>
  );
}

/** Checklist items to start with: typed one by one, removable, at most `TASK_LIMITS.checklist`. */
export function ChecklistField({ form }: { form: TaskFormMethods }) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <Controller
      control={form.control}
      name="checklist"
      render={({ field }) => {
        const items = field.value ?? [];
        const full = items.length >= TASK_LIMITS.checklist;
        const add = () => {
          const text = draft.trim();
          if (!text || full) return;
          field.onChange([...items, text.slice(0, 200)]);
          setDraft('');
          // "Add" turns off with the empty field: the focus goes back to typing the next one.
          input.current?.focus();
        };
        /** The next row's remove button takes the focus, the previous one's, or the field. */
        const remove = (index: number) => {
          flushSync(() => field.onChange(items.filter((_, other) => other !== index)));
          focusAfterRemoval(list.current, index, input.current);
        };
        return (
          <Field>
            <FieldLabel htmlFor={id}>
              {t('tasks.form.checklist')}
              <Optional />
            </FieldLabel>
            {items.length > 0 && (
              <ol ref={list} className="flex flex-col gap-1.5">
                {items.map((item, index) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: items are plain strings that may repeat
                    key={index}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    <span className="text-muted-foreground tabular-nums">
                      {formatNumber(index + 1)}.
                    </span>
                    <span className="flex-1">{item}</span>
                    <IconButton
                      data-focus="remove"
                      label={t('common.remove', { label: item })}
                      onClick={() => remove(index)}
                    >
                      <XIcon />
                    </IconButton>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex items-center gap-2">
              <Input
                ref={input}
                id={id}
                value={draft}
                maxLength={200}
                disabled={full}
                placeholder={t('tasks.form.checklistPlaceholder')}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    add();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={add}
                disabled={full || !draft.trim()}
              >
                <PlusIcon />
                {t('tasks.form.addItem')}
              </Button>
            </div>
          </Field>
        );
      }}
    />
  );
}

/** External links (a Drive folder, a brief), at most `TASK_LIMITS.links`. */
export function LinksField({ form }: { form: TaskFormMethods }) {
  const { t } = useTranslation();
  const links = useFieldArray({ control: form.control, name: 'links' });
  const errors = form.formState.errors.links;
  const list = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  /** The next row's remove button takes the focus, the previous one's, or "add". */
  function remove(index: number) {
    flushSync(() => links.remove(index));
    focusAfterRemoval(list.current, index, addButton.current);
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">
        {t('tasks.form.links')}
        <Optional />
      </p>
      <div ref={list} className="contents">
      {links.fields.map((link, index) => (
        <div key={link.id} className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-start">
          <Field invalid={!!errors?.[index]?.url}>
            <FieldLabel className="sr-only">{t('tasks.links.url')}</FieldLabel>
            <Input
              type="url"
              dir="ltr"
              placeholder="https://"
              {...form.register(`links.${index}.url`)}
            />
            <FieldError match={!!errors?.[index]?.url}>{t('tasks.links.errors.url')}</FieldError>
          </Field>
          <Field>
            <FieldLabel className="sr-only">{t('tasks.links.label')}</FieldLabel>
            <Input
              placeholder={t('tasks.links.labelPlaceholder')}
              {...form.register(`links.${index}.label`)}
            />
          </Field>
          <IconButton
            data-focus="remove"
            size="icon"
            label={t('tasks.links.removeAt', { position: formatNumber(index + 1) })}
            onClick={() => remove(index)}
          >
            <XIcon />
          </IconButton>
        </div>
      ))}
      </div>
      <Button
        ref={addButton}
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={links.fields.length >= TASK_LIMITS.links}
        onClick={() => links.append({ url: '', label: '' })}
      >
        <LinkIcon />
        {t('tasks.links.add')}
      </Button>
    </div>
  );
}
