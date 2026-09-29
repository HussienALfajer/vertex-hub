import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { Link } from '@tanstack/react-router';
import {
  type CreateTaskLink,
  createTaskChecklistItemSchema,
  createTaskLinkSchema,
  TASK_LIMITS,
  type TaskDependency,
  type TaskDetail,
} from '@vertex-hub/contracts';
import {
  Button,
  Checkbox,
  cn,
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
  Input,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  HourglassIcon,
  PencilIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { errorMessage } from '../../lib/errors';
import { formatLink, formatLinkHost, formatNumber } from '../../lib/format';
import { useDepartmentNames } from '../projects/project-badges';
import { TaskStatusBadge } from './task-badges';
import { DependenciesPicker, type DependencyOption, useDependencyOptions } from './task-form';
import {
  useAddChecklistItem,
  useAddTaskLink,
  useArchiveChecklistItem,
  useArchiveTaskLink,
  useReorderChecklist,
  useSetTaskDependencies,
  useUpdateChecklistItem,
} from './tasks.queries';

/** A titled block of the task page, with its action at the inline end. */
export function TaskSection({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex min-h-8 items-center gap-2">
        <h2 className="text-base font-bold">{title}</h2>
        {count && <span className="text-sm text-muted-foreground tabular-nums">{count}</span>}
        {action && <div className="ms-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Whether the caller may tick items and add links: `tasks.work` or manage scope (rule 15). */
export const canWorkOn = (task: TaskDetail) =>
  !task.readOnly && (task.permissions.canWork || task.permissions.canReview);

// Dependencies

/** What the task waits on (rule 3) and what waits on it; archived and cancelled ones are struck. */
export function DependenciesSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  // Manage scope only: the creator of an open request may edit it but not its dependencies.
  const canEdit = task.permissions.canReview && !task.readOnly;
  return (
    <TaskSection
      title={t('tasks.dependencies.title')}
      action={
        canEdit && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <PencilIcon />
            {t('common.edit')}
          </Button>
        )
      }
    >
      <DependencyList
        label={t('tasks.dependencies.waitingOn')}
        items={task.dependencies}
        empty={t('tasks.dependencies.none')}
      />
      {task.dependents.length > 0 && (
        <DependencyList label={t('tasks.dependencies.blocks')} items={task.dependents} />
      )}
      {editing && <DependenciesDialog task={task} onClose={() => setEditing(false)} />}
    </TaskSection>
  );
}

function DependencyList({
  label,
  items,
  empty,
}: {
  label: string;
  items: TaskDependency[];
  empty?: string;
}) {
  const departmentName = useDepartmentNames();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => {
            const gone = item.archived || item.status === 'cancelled';
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                {item.finished ? (
                  <CircleCheckIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                ) : (
                  <HourglassIcon
                    aria-hidden="true"
                    className={cn('size-4', gone ? 'text-muted-foreground' : 'text-warning-text')}
                  />
                )}
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: item.id }}
                  className={cn(
                    'min-w-0 flex-1 truncate hover:underline',
                    gone && 'text-muted-foreground line-through',
                  )}
                >
                  {item.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {departmentName(item.department)}
                </span>
                <TaskStatusBadge status={item.status} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DependenciesDialog({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const save = useSetTaskDependencies(task.id);
  const options = useDependencyOptions(task.client?.id ?? null, task.id);
  const [value, setValue] = useState<DependencyOption[]>(
    task.dependencies.map(({ id, title, status }) => ({ id, title, status })),
  );
  const [failure, setFailure] = useState<string | null>(null);

  async function submit() {
    setFailure(null);
    try {
      await save.mutateAsync({ dependsOn: value.map((item) => item.id) });
      toast.add({ title: t('tasks.dependencies.saved'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <div className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t('tasks.dependencies.editTitle')}</DialogTitle>
            <DialogDescription>
              {t('tasks.dependencies.editBody', {
                max: formatNumber(TASK_LIMITS.dependencies),
              })}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={id}>{t('tasks.dependencies.waitingOn')}</FieldLabel>
            <DependenciesPicker id={id} options={options} value={value} onChange={setValue} />
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button disabled={save.isPending} onClick={submit}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Checklist

/** Subtasks ticked by the assignee or a manager; they never hold up a move (rule 15). */
export function ChecklistSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const items = task.checklistItems;
  const editable = canWorkOn(task);
  const update = useUpdateChecklistItem(task.id);
  const reorder = useReorderChecklist(task.id);
  const remove = useArchiveChecklistItem(task.id);
  const done = items.filter((item) => item.done).length;

  async function attempt(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  function move(index: number, by: -1 | 1) {
    const ids = items.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved as string);
    return attempt(() => reorder.mutateAsync(ids));
  }

  return (
    <TaskSection
      title={t('tasks.checklist.title')}
      count={
        items.length > 0
          ? t('tasks.checklistCount', {
              done: formatNumber(done),
              total: formatNumber(items.length),
            })
          : undefined
      }
    >
      {items.length === 0 && !editable && (
        <p className="text-sm text-muted-foreground">{t('tasks.checklist.empty')}</p>
      )}
      {items.length > 0 && (
        <ul className="flex flex-col gap-1">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
            >
              <label
                htmlFor={`checklist-${item.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 text-sm"
              >
                <Checkbox
                  id={`checklist-${item.id}`}
                  checked={item.done}
                  disabled={!editable || update.isPending}
                  onCheckedChange={(checked) =>
                    attempt(() => update.mutateAsync({ itemId: item.id, done: checked }))
                  }
                />
                <span className={cn('min-w-0', item.done && 'text-muted-foreground line-through')}>
                  {item.text}
                </span>
              </label>
              {editable && (
                <span className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('tasks.checklist.moveUp', { text: item.text })}
                    disabled={index === 0 || reorder.isPending}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('tasks.checklist.moveDown', { text: item.text })}
                    disabled={index === items.length - 1 || reorder.isPending}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('common.remove', { label: item.text })}
                    disabled={remove.isPending}
                    onClick={() => attempt(() => remove.mutateAsync(item.id))}
                  >
                    <XIcon />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && items.length < TASK_LIMITS.checklist && <AddChecklistItem task={task} />}
    </TaskSection>
  );
}

function AddChecklistItem({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const add = useAddChecklistItem(task.id);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<{ text: string }>({
    resolver: standardSchemaResolver(createTaskChecklistItemSchema),
    defaultValues: { text: '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await add.mutateAsync(values);
      form.reset();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });
  return (
    <form className="flex flex-col gap-2" onSubmit={submit} noValidate>
      <div className="flex items-center gap-2">
        <Input
          aria-label={t('tasks.checklist.add')}
          placeholder={t('tasks.form.checklistPlaceholder')}
          maxLength={200}
          {...form.register('text')}
        />
        <Button type="submit" variant="outline" disabled={form.formState.isSubmitting}>
          <PlusIcon />
          {t('tasks.form.addItem')}
        </Button>
      </div>
      {failure && <FormAlert>{failure}</FormAlert>}
    </form>
  );
}

// Links

/** External links (attachments before F10): the label, or the site when it has none. */
export function LinksSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const editable = canWorkOn(task);
  const remove = useArchiveTaskLink(task.id);
  const [adding, setAdding] = useState(false);
  return (
    <TaskSection
      title={t('tasks.links.title')}
      action={
        editable &&
        task.links.length < TASK_LIMITS.links && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon />
            {t('tasks.links.add')}
          </Button>
        )
      }
    >
      {task.links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tasks.links.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {task.links.map((link) => (
            <li
              key={link.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <ExternalLinkIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex min-w-0 flex-1 flex-col hover:underline"
              >
                <span className="truncate font-medium">
                  {link.label ?? formatLinkHost(link.url)}
                </span>
                <span className="sr-only">{t('common.openInNewTab')}</span>
                <span dir="ltr" className="truncate text-start text-xs text-muted-foreground">
                  {formatLink(link.url)}
                </span>
              </a>
              {editable && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.remove', { label: link.label ?? formatLinkHost(link.url) })}
                  disabled={remove.isPending}
                  onClick={async () => {
                    try {
                      await remove.mutateAsync(link.id);
                    } catch (error) {
                      toast.add({ title: errorMessage(t, error), type: 'error' });
                    }
                  }}
                >
                  <XIcon />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && <AddLinkDialog task={task} onClose={() => setAdding(false)} />}
    </TaskSection>
  );
}

function AddLinkDialog({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const ids = { url: useId(), label: useId() };
  const add = useAddTaskLink(task.id);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CreateTaskLink>({
    resolver: standardSchemaResolver(createTaskLinkSchema),
    defaultValues: { url: '', label: '' },
  });
  const urlError = form.formState.errors.url;
  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await add.mutateAsync(values);
      toast.add({ title: t('tasks.links.added'), type: 'success' });
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
            <DialogTitle>{t('tasks.links.addTitle')}</DialogTitle>
            <DialogDescription>{t('tasks.links.addBody')}</DialogDescription>
          </DialogHeader>
          <Field invalid={!!urlError}>
            <FieldLabel htmlFor={ids.url}>{t('tasks.links.url')}</FieldLabel>
            <Input
              id={ids.url}
              type="url"
              dir="ltr"
              placeholder="https://"
              {...form.register('url')}
            />
            <FieldError match={!!urlError}>{t('tasks.links.errors.url')}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.label}>{t('tasks.links.label')}</FieldLabel>
            <Input
              id={ids.label}
              placeholder={t('tasks.links.labelPlaceholder')}
              {...form.register('label')}
            />
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('tasks.links.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
