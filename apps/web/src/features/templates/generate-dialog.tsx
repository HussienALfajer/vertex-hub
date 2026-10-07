import { useQuery } from '@tanstack/react-query';
import {
  businessDate,
  type DepartmentCode,
  type ProjectDetail,
  type RetainerTemplate,
  type TemplateDetail,
  type TemplateRunInput,
  type TemplateRunPlanResponse,
  type TemplateRunWarning,
} from '@vertex-hub/contracts';
import {
  Avatar,
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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { CalendarIcon, LinkIcon, MilestoneIcon, TriangleAlertIcon, UsersIcon } from 'lucide-react';
import { type ComponentProps, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatList, formatNumber } from '../../lib/format';
import { useDepartmentNames } from '../projects/project-badges';
import { DeliverableIcon, lineName } from '../retainers/retainer-badges';
import { useDepartmentMembers } from '../tasks/task-form';
import {
  templateListQuery,
  templatePreviewQuery,
  templateQuery,
  useRunTemplate,
} from './templates.queries';

/** Where the tasks go: a project (any project template), or a retainer's open cycle (its linked one). */
export type GenerateTarget =
  | { type: 'project'; project: ProjectDetail }
  | {
      type: 'cycle';
      cycleId: string;
      templateId: string;
      lines: RetainerTemplate['lines'];
    };

/**
 * Spec screen 3: pick the template (projects), the start date (projects) and the assignee per
 * department, see the plan from `POST …/preview`, then generate it in one run.
 */
export function GenerateTasksDialog({
  target,
  initialTemplateId,
  open,
  onClose,
  finalFocus,
}: {
  target: GenerateTarget;
  /** Projects: the template to start with (from the new project form). */
  initialTemplateId?: string;
  open: boolean;
  onClose: () => void;
  /** Where the focus goes when it closes; needed when no button opened it (after creating). */
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus'];
}) {
  const { t } = useTranslation();
  // The form stays while the dialog fades out, and starts afresh at the next opening.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenChangeComplete={(next) => !next && setMounted(false)}
    >
      <DialogContent
        closeLabel={t('common.close')}
        className="sm:max-w-3xl"
        finalFocus={finalFocus}
      >
        {mounted && (
          <GenerateForm target={target} initialTemplateId={initialTemplateId} onDone={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Rule 6: the later of the project's start date and today. */
function defaultStart(project: ProjectDetail) {
  const today = businessDate();
  return project.startDate > today ? project.startDate : today;
}

function GenerateForm({
  target,
  initialTemplateId,
  onDone,
}: {
  target: GenerateTarget;
  initialTemplateId: string | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const ids = { template: useId(), start: useId() };
  const [templateId, setTemplateId] = useState(
    target.type === 'cycle' ? target.templateId : (initialTemplateId ?? ''),
  );
  const [startDate, setStartDate] = useState(
    target.type === 'project' ? defaultStart(target.project) : '',
  );
  /** The departments the applier changed; the others keep the template's default. */
  const [chosen, setChosen] = useState<Partial<Record<DepartmentCode, string | null>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const templates = useQuery({
    ...templateListQuery({ kind: 'project', pageSize: 100 }),
    enabled: target.type === 'project',
  });
  const template = useQuery({ ...templateQuery(templateId), enabled: !!templateId });
  const run = useRunTemplate(templateId);

  const today = businessDate();
  const pastStart = target.type === 'project' && !!startDate && startDate < today;
  const departments = template.data ? departmentsOf(template.data) : [];
  const assignees = departments.map((department) => ({
    department,
    userId:
      department in chosen
        ? (chosen[department] ?? null)
        : (template.data?.assignees.find((a) => a.department === department)?.user.id ?? null),
  }));
  const input: TemplateRunInput =
    target.type === 'project'
      ? { projectId: target.project.id, startDate, assignees }
      : { retainerCycleId: target.cycleId, assignees };
  const ready = !!template.data && (target.type === 'cycle' || (!!startDate && !pastStart));
  // Once generating, the plan stays as shown: re-planning a generated cycle answers ALREADY_GENERATED.
  const preview = useQuery({
    ...templatePreviewQuery(templateId, input),
    enabled: ready && !run.isPending && !run.isSuccess,
  });
  const plan = ready ? preview.data : undefined;
  const dateRefused = preview.error instanceof ApiError && preview.error.code === 'INVALID_DATES';

  function chooseTemplate(next: string) {
    setTemplateId(next);
    setChosen({});
    setFailure(null);
  }

  async function generate() {
    setFailure(null);
    try {
      const result = await run.mutateAsync(input);
      toast.add({
        title: t('templates.generate.done', {
          count: result.taskCount,
          n: formatNumber(result.taskCount),
        }),
        type: 'success',
      });
      onDone();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  const templateItems = (templates.data?.items ?? []).map((item) => ({
    value: item.id,
    label: item.name,
  }));

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>
          {target.type === 'project'
            ? t('templates.generate.projectTitle', { name: target.project.name })
            : t('templates.generate.cycleTitle')}
        </DialogTitle>
        <DialogDescription>
          {target.type === 'project'
            ? t('templates.generate.projectHint')
            : t('templates.generate.cycleHint')}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-5 sm:grid-cols-2">
        {target.type === 'project' ? (
          <Field>
            <FieldLabel id={ids.template} render={<span />}>
              {t('templates.generate.template')}
            </FieldLabel>
            <Select
              items={templateItems}
              value={templateId || null}
              onValueChange={(value) => value && chooseTemplate(value)}
            >
              <SelectTrigger aria-labelledby={ids.template}>
                <SelectValue placeholder={t('templates.generate.templatePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {templateItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templates.isSuccess && templateItems.length === 0 && (
              <FieldDescription>{t('templates.generate.noTemplates')}</FieldDescription>
            )}
          </Field>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">{t('templates.generate.template')}</p>
            <p className="font-bold">{template.data?.name ?? '…'}</p>
          </div>
        )}
        {target.type === 'project' && (
          <Field invalid={pastStart || dateRefused || !startDate}>
            <FieldLabel htmlFor={ids.start}>{t('templates.generate.startDate')}</FieldLabel>
            <Input
              id={ids.start}
              type="date"
              min={today}
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
            <FieldDescription>{t('templates.generate.startDateHint')}</FieldDescription>
            <FieldError match={pastStart || dateRefused || !startDate}>
              {t('templates.generate.startDateError')}
            </FieldError>
          </Field>
        )}
      </div>

      {template.data && departments.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <UsersIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            {t('templates.generate.assignees')}
          </h3>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {assignees.map(({ department, userId }) => (
              <AssigneeChoice
                key={department}
                department={department}
                userId={userId}
                template={template.data}
                onChange={(next) => setChosen((previous) => ({ ...previous, [department]: next }))}
              />
            ))}
          </ul>
        </section>
      )}

      {!templateId ? null : template.isError ? (
        <FormAlert>{errorMessage(t, template.error)}</FormAlert>
      ) : preview.isError && !dateRefused ? (
        <FormAlert>{errorMessage(t, preview.error)}</FormAlert>
      ) : !plan ? (
        ready || template.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24" />
          </div>
        ) : null
      ) : (
        <PlanView plan={plan} target={target} stale={preview.isPlaceholderData} />
      )}

      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button
          type="button"
          disabled={
            !plan || plan.taskCount === 0 || preview.isFetching || preview.isError || run.isPending
          }
          onClick={generate}
        >
          {run.isPending
            ? t('templates.generate.generating')
            : t('templates.generate.submit', {
                count: plan?.taskCount ?? 0,
                n: formatNumber(plan?.taskCount ?? 0),
              })}
        </Button>
      </DialogFooter>
    </div>
  );
}

/** The departments the template's steps use, in step order. */
function departmentsOf(template: TemplateDetail): DepartmentCode[] {
  return [...new Set(template.steps.map((step) => step.department))];
}

const QUEUE = 'queue';

/** A member of the department, or its queue; the template's default comes first (rule 10). */
function AssigneeChoice({
  department,
  userId,
  template,
  onChange,
}: {
  department: DepartmentCode;
  userId: string | null;
  template: TemplateDetail;
  onChange: (userId: string | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const departmentName = useDepartmentNames();
  const members = useDepartmentMembers(department);
  const fallback = template.assignees.find((a) => a.department === department);
  const options = [
    { value: QUEUE, label: t('templates.departmentQueue'), note: null as string | null },
    ...members.map((member) => ({ value: member.id, label: member.name, note: member.note })),
  ];
  if (fallback && !members.some((member) => member.id === fallback.user.id)) {
    options.push({
      value: fallback.user.id,
      label: fallback.user.name,
      note: t('templates.invalidAssigneeNote'),
    });
  }
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <label htmlFor={id} className="text-sm font-medium sm:w-44 sm:shrink-0">
        {departmentName(department)}
      </label>
      <Select
        items={options.map(({ value, label }) => ({ value, label }))}
        value={userId ?? QUEUE}
        onValueChange={(value) => onChange(!value || value === QUEUE ? null : value)}
      >
        <SelectTrigger id={id} className="min-w-0 flex-1 sm:max-w-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-2">
                {option.value !== QUEUE && <Avatar name={option.label} size="sm" />}
                {option.label}
                {option.note && (
                  <span className="text-sm text-muted-foreground">{option.note}</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </li>
  );
}

type PlannedTask = TemplateRunPlanResponse['tasks'][number];

interface TaskGroup {
  key: string;
  title: string;
  badge?: 'existing' | 'new';
  line?: RetainerTemplate['lines'][number];
  tasks: PlannedTask[];
}

/** Project runs by milestone, in plan order, then tasks without one; cycles: fixed, then per line. */
function groupsOf(
  plan: TemplateRunPlanResponse,
  target: GenerateTarget,
  t: TFunction,
): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  const rest: TaskGroup = { key: 'rest', title: '', tasks: [] };
  for (const task of plan.tasks) {
    let group: TaskGroup | undefined;
    if (task.milestone) {
      const key = task.milestone.existingId ?? `new:${task.milestone.name}`;
      group = groups.get(key) ?? {
        key,
        title: task.milestone.name,
        badge: task.milestone.existingId ? 'existing' : 'new',
        tasks: [],
      };
      groups.set(key, group);
    } else if (task.cycleLineId && target.type === 'cycle') {
      const line = target.lines.find((l) => l.id === task.cycleLineId);
      group = groups.get(task.cycleLineId) ?? {
        key: task.cycleLineId,
        title: line ? lineName(t, line) : '',
        line,
        tasks: [],
      };
      groups.set(task.cycleLineId, group);
    } else {
      group = rest;
    }
    group.tasks.push(task);
  }
  rest.title =
    target.type === 'cycle' ? t('templates.generate.fixedTasks') : t('templates.noStage');
  const all = [...groups.values()];
  if (rest.tasks.length === 0) return all;
  return target.type === 'cycle' ? [rest, ...all] : [...all, rest];
}

function PlanView({
  plan,
  target,
  stale,
}: {
  plan: TemplateRunPlanResponse;
  target: GenerateTarget;
  stale: boolean;
}) {
  const { t } = useTranslation();
  const titles = new Map(plan.tasks.map((task) => [task.key, task.title]));
  const groups = groupsOf(plan, target, t);
  return (
    <section
      aria-label={t('templates.generate.preview')}
      aria-busy={stale}
      className={stale ? 'flex flex-col gap-3 opacity-60' : 'flex flex-col gap-3'}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold">{t('templates.generate.preview')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('templates.generate.summary', {
            count: plan.taskCount,
            n: formatNumber(plan.taskCount),
            start: formatCalendarDate(plan.startDate),
          })}
          {plan.milestonesToCreate.length > 0 &&
            ` · ${t('templates.generate.newMilestones', {
              count: plan.milestonesToCreate.length,
              n: formatNumber(plan.milestonesToCreate.length),
            })}`}
        </p>
      </div>
      {plan.warnings.map((warning) => (
        <Callout
          key={`${warning.type}-${warning.department ?? ''}`}
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={<WarningText warning={warning} />}
        />
      ))}
      {plan.taskCount === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('templates.generate.nothing')}
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="overflow-hidden rounded-lg border border-border">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2">
              {group.line ? (
                <DeliverableIcon kind={group.line.kind} className="size-4 text-muted-foreground" />
              ) : (
                target.type === 'project' && (
                  <MilestoneIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                )
              )}
              <h4 className="text-sm font-bold">{group.title}</h4>
              {group.badge && (
                <Badge tone={group.badge === 'new' ? 'brand' : 'neutral'}>
                  {t(`templates.generate.milestone.${group.badge}`)}
                </Badge>
              )}
              <span className="ms-auto text-xs text-muted-foreground">
                {t('templates.generate.taskCount', {
                  count: group.tasks.length,
                  n: formatNumber(group.tasks.length),
                })}
              </span>
            </div>
            <ol className="flex flex-col divide-y divide-border">
              {group.tasks.map((task) => (
                <PlannedTaskRow key={task.key} task={task} titles={titles} />
              ))}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}

function PlannedTaskRow({ task, titles }: { task: PlannedTask; titles: Map<string, string> }) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const waits = task.dependsOn.map((key) => titles.get(key)).filter(Boolean);
  return (
    <li className="flex flex-col gap-1 px-4 py-2.5">
      <p className="text-sm font-medium">{task.title}</p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{departmentName(task.department)}</span>
        <span className={task.assigneeReplaced ? 'text-status-warning-foreground' : undefined}>
          {task.assignee?.name ?? t('templates.departmentQueue')}
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          <CalendarIcon aria-hidden="true" className="size-3.5" />
          {formatCalendarDate(task.dueDate)}
        </span>
        {waits.length > 0 && (
          <span className="flex items-center gap-1">
            <LinkIcon aria-hidden="true" className="size-3.5" />
            {t('templates.waitsOn', {
              titles: formatList(waits.filter((title): title is string => !!title)),
            })}
          </span>
        )}
      </p>
    </li>
  );
}

function WarningText({ warning }: { warning: TemplateRunWarning }) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const n = formatNumber(warning.count);
  switch (warning.type) {
    case 'assignee_replaced':
      return t('templates.generate.warnings.assignee_replaced', {
        count: warning.count,
        n,
        department: warning.department ? departmentName(warning.department) : '',
      });
    default:
      return t(`templates.generate.warnings.${warning.type}`, { count: warning.count, n });
  }
}
