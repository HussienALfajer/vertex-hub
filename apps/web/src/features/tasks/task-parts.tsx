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
  IconButton,
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
import { type ReactNode, type Ref, type RefObject, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { errorMessage } from '../../lib/errors';
import { formatLink, formatLinkHost, formatNumber } from '../../lib/format';
import { useFocusAfterChange } from '../../lib/use-focus-after-change';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
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
  headingRef,
  children,
}: {
  title: string;
  count?: string;
  action?: ReactNode;
  /** Makes the heading focusable from script: the fallback when an action removes its button. */
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex min-h-8 items-center gap-2">
        <h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-base font-bold">
          {title}
        </h2>
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
  const editButton = useRef<HTMLButtonElement>(null);
  // Manage scope only: the creator of an open request may edit it but not its dependencies.
  const canEdit = task.permissions.canReview && !task.readOnly;
  return (
    <TaskSection
      title={t('tasks.dependencies.title')}
      action={
        canEdit && (
          <Button ref={editButton} variant="ghost" size="sm" onClick={() => setEditing(true)}>
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
      {canEdit && (
        <DependenciesDialog
          task={task}
          open={editing}
          onClose={() => setEditing(false)}
          finalFocus={() => editButton.current ?? true}
        />
      )}
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
                    className={cn(
                      'size-4',
                      gone ? 'text-muted-foreground' : 'text-status-warning-foreground',
                    )}
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

const dependencyOptions = (task: TaskDetail): DependencyOption[] =>
  task.dependencies.map(({ id, title, status }) => ({ id, title, status }));

/** Kept mounted, so it fades out and gives the focus back; it starts from the saved list. */
function DependenciesDialog({
  task,
  open,
  onClose,
  finalFocus,
}: {
  task: TaskDetail;
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | true;
}) {
  const { t } = useTranslation();
  const id = useId();
  const save = useSetTaskDependencies(task.id);
  const { options, onSearch } = useDependencyOptions(task.client?.id ?? null, task.id);
  const [value, setValue] = useState<DependencyOption[]>(() => dependencyOptions(task));
  const [failure, setFailure] = useState<string | null>(null);

  async function submit() {
    setFailure(null);
    const next = value.map((item) => item.id);
    const saved = task.dependencies.map((item) => item.id);
    // Nothing changed: nothing to send.
    if (next.length === saved.length && next.every((taskId) => saved.includes(taskId))) {
      onClose();
      return;
    }
    try {
      await save.mutateAsync({ dependsOn: next });
      toast.add({ title: t('tasks.dependencies.saved'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      // After the exit animation, so the list does not change while the dialog fades.
      onOpenChangeComplete={(next) => {
        if (next) return;
        setValue(dependencyOptions(task));
        setFailure(null);
      }}
    >
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
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
            <DependenciesPicker
              id={id}
              options={options}
              onSearch={onSearch}
              value={value}
              onChange={setValue}
            />
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

/** Where the focus goes after a confirmed removal: the next row's button, the previous, or `fallback`. */
function removalTarget(
  list: HTMLElement | null,
  removed: { id: string; index: number } | null,
  fallback: HTMLElement | null,
): HTMLElement | true {
  const buttons = [...(list?.querySelectorAll<HTMLElement>('[data-focus="remove"]') ?? [])];
  // Cancelled: the row is still there.
  const same = buttons.find((button) => button.dataset.id === removed?.id);
  if (same) return same;
  const index = Math.min(removed?.index ?? 0, buttons.length - 1);
  return buttons[index] ?? fallback ?? true;
}

/** Subtasks ticked by the assignee or a manager; they never hold up a move (rule 15). */
export function ChecklistSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const items = task.checklistItems;
  const editable = canWorkOn(task);
  const update = useUpdateChecklistItem(task.id);
  const reorder = useReorderChecklist(task.id);
  const remove = useArchiveChecklistItem(task.id);
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<{ id: string; text: string; index: number } | null>(
    null,
  );
  // The text stays while the confirmation fades out.
  const shownRemoving = useShownWhileClosing(removing);
  const done = items.filter((item) => item.done).length;
  // The add field leaves at the limit: the focus goes to the heading instead of the page body.
  useFocusAfterChange(items.length, () => addInput.current ?? heading.current);

  async function attempt(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  /**
   * The moved row keeps the focus on the button that moved it; at the top or the bottom that
   * button turns off, so the other direction's takes the focus.
   */
  async function move(index: number, by: -1 | 1) {
    if (reorder.isPending) return;
    const ids = items.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved as string);
    await attempt(() => reorder.mutateAsync(ids));
    const to = index + by;
    if (to === 0 || to === items.length - 1) {
      list.current
        ?.querySelector<HTMLElement>(`[data-row="${moved}"] [data-focus="${by < 0 ? 'down' : 'up'}"]`)
        ?.focus();
    }
  }

  return (
    <TaskSection
      title={t('tasks.checklist.title')}
      headingRef={heading}
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
        <ul ref={list} className="flex flex-col gap-1">
          {items.map((item, index) => (
            <li
              key={item.id}
              data-row={item.id}
              className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
            >
              <label
                htmlFor={`checklist-${item.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 text-sm"
              >
                {/* Not turned off while saving: a disabled box drops the focus to the page. */}
                <Checkbox
                  id={`checklist-${item.id}`}
                  checked={item.done}
                  disabled={!editable}
                  onCheckedChange={(checked) => {
                    if (update.isPending) return;
                    void attempt(() => update.mutateAsync({ itemId: item.id, done: checked }));
                  }}
                />
                <span className={cn('min-w-0', item.done && 'text-muted-foreground line-through')}>
                  {item.text}
                </span>
              </label>
              {editable && (
                <span className="flex shrink-0 items-center">
                  <IconButton
                    data-focus="up"
                    label={t('tasks.checklist.moveUp', { text: item.text })}
                    disabled={index === 0}
                    focusableWhenDisabled
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon />
                  </IconButton>
                  <IconButton
                    data-focus="down"
                    label={t('tasks.checklist.moveDown', { text: item.text })}
                    disabled={index === items.length - 1}
                    focusableWhenDisabled
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon />
                  </IconButton>
                  <IconButton
                    data-focus="remove"
                    data-id={item.id}
                    label={t('common.remove', { label: item.text })}
                    onClick={() => setRemoving({ id: item.id, text: item.text, index })}
                  >
                    <XIcon />
                  </IconButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && items.length < TASK_LIMITS.checklist && (
        <AddChecklistItem task={task} inputRef={addInput} />
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('tasks.checklist.removeTitle')}
        body={t('tasks.checklist.removeBody', { text: shownRemoving?.text ?? '' })}
        action={t('tasks.checklist.removeAction')}
        destructive
        pending={remove.isPending}
        finalFocus={() =>
          removalTarget(list.current, shownRemoving, addInput.current ?? heading.current)
        }
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing.id);
          toast.add({ title: t('tasks.checklist.removed'), type: 'success' });
        }}
      />
    </TaskSection>
  );
}

function AddChecklistItem({
  task,
  inputRef,
}: {
  task: TaskDetail;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const add = useAddChecklistItem(task.id);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<{ text: string }>({
    resolver: standardSchemaResolver(createTaskChecklistItemSchema),
    defaultValues: { text: '' },
  });
  const error = form.formState.errors.text;
  const field = form.register('text');
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
      <Field invalid={!!error}>
        <FieldLabel htmlFor={id} className="sr-only">
          {t('tasks.checklist.add')}
        </FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={id}
            placeholder={t('tasks.form.checklistPlaceholder')}
            maxLength={200}
            {...field}
            ref={(element) => {
              field.ref(element);
              inputRef.current = element;
            }}
          />
          <Button type="submit" variant="outline" disabled={form.formState.isSubmitting}>
            <PlusIcon />
            {t('tasks.form.addItem')}
          </Button>
        </div>
        <FieldError match={!!error}>{t('tasks.checklist.invalid')}</FieldError>
      </Field>
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
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; label: string; index: number } | null>(
    null,
  );
  const shownRemoving = useShownWhileClosing(removing);
  const canAdd = editable && task.links.length < TASK_LIMITS.links;
  return (
    <TaskSection
      title={t('tasks.links.title')}
      headingRef={heading}
      action={
        canAdd && (
          <Button ref={addButton} variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon />
            {t('tasks.links.add')}
          </Button>
        )
      }
    >
      {task.links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tasks.links.empty')}</p>
      ) : (
        <ul ref={list} className="flex flex-col gap-1.5">
          {task.links.map((link, index) => {
            const label = link.label ?? formatLinkHost(link.url);
            return (
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
                  <span className="truncate font-medium">{label}</span>
                  <span className="sr-only">{t('common.openInNewTab')}</span>
                  <span dir="ltr" className="truncate text-start text-xs text-muted-foreground">
                    {formatLink(link.url)}
                  </span>
                </a>
                {editable && (
                  <IconButton
                    data-focus="remove"
                    data-id={link.id}
                    label={t('common.remove', { label })}
                    onClick={() => setRemoving({ id: link.id, label, index })}
                  >
                    <XIcon />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editable && (
        <AddLinkDialog
          task={task}
          open={adding}
          onClose={() => setAdding(false)}
          // At the limit the add button leaves with the new link.
          finalFocus={() => addButton.current ?? heading.current ?? true}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('tasks.links.removeTitle')}
        body={t('tasks.links.removeBody', { label: shownRemoving?.label ?? '' })}
        action={t('tasks.links.removeAction')}
        destructive
        pending={remove.isPending}
        finalFocus={() =>
          removalTarget(list.current, shownRemoving, addButton.current ?? heading.current)
        }
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing.id);
          toast.add({ title: t('tasks.links.removed'), type: 'success' });
        }}
      />
    </TaskSection>
  );
}

function AddLinkDialog({
  task,
  open,
  onClose,
  finalFocus,
}: {
  task: TaskDetail;
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | true;
}) {
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
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      // After the exit animation, so the fields do not empty while the dialog fades.
      onOpenChangeComplete={(next) => {
        if (next) return;
        form.reset();
        setFailure(null);
      }}
    >
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
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
