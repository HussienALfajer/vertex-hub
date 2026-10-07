import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  type CreateProject,
  type CreateProjectInput,
  createProjectSchema,
  isProjectClosed,
  type OPEN_PROJECT_STATUSES,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectStatusChange,
  projectStatusChangeSchema,
  type UpdateProject,
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  BanIcon,
  CircleCheckBigIcon,
  CircleDashedIcon,
  EllipsisIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
} from 'lucide-react';
import { type RefObject, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import {
  CurrencyField,
  checkDates,
  DatesFields,
  DepartmentsField,
  DescriptionField,
  NameField,
  ProjectManagerField,
  projectFormFailure,
  useProjectManagerOptions,
} from './project-form';
import { useChangeProjectStatus, useUpdateProject } from './projects.queries';

type StatusTarget = ProjectStatusChange['status'];

/** A project that is neither completed nor cancelled. */
const isOpen = (status: ProjectStatus): status is OpenStatus => !isProjectClosed(status);

type OpenStatus = (typeof OPEN_PROJECT_STATUSES)[number];

/** The primary button for an open project: its next step forward. */
const NEXT_STEP = {
  planned: { status: 'active', action: 'start', icon: PlayIcon },
  active: { status: 'completed', action: 'complete', icon: CircleCheckBigIcon },
  on_hold: { status: 'active', action: 'resume', icon: PlayIcon },
} as const satisfies Record<
  OpenStatus,
  { status: StatusTarget; action: string; icon: typeof PlayIcon }
>;

/**
 * The project page's controls that take the focus when an action removes the one that held it:
 * a status change swaps the header's buttons and notices (archive → restore → actions menu).
 */
export interface ProjectFocus {
  heading: RefObject<HTMLHeadingElement | null>;
  /** The next step forward (start, complete, resume). */
  next: RefObject<HTMLButtonElement | null>;
  menu: RefObject<HTMLButtonElement | null>;
  reopen: RefObject<HTMLButtonElement | null>;
  restore: RefObject<HTMLButtonElement | null>;
  /** The Milestones tab, where a refused completion sends the user. */
  milestones: RefObject<HTMLButtonElement | null>;
}

type FocusTarget = Exclude<keyof ProjectFocus, 'heading'>;

/** The first of these controls still on the page, else the heading: a dialog's `finalFocus`. */
export function focusTarget(focus: ProjectFocus, ...order: FocusTarget[]) {
  for (const name of order) {
    const element = focus[name].current;
    if (element?.isConnected) return element;
  }
  return focus.heading.current ?? true;
}

/**
 * The header's actions: edit, the project's next step as the primary button, and the rest in a
 * menu. Only what the caller may do on this status is offered (rule 6); the API enforces it.
 */
export function ProjectActions({
  project,
  focus,
  onShowMilestones,
  onArchive,
}: {
  project: ProjectDetail;
  focus: ProjectFocus;
  onShowMilestones: () => void;
  /** The confirmation lives on the page: the menu leaves with the archive. */
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const { permissions, status } = project;
  const archived = project.archivedAt !== null;
  const change = useChangeProjectStatus(project.id);
  const [dialog, setDialog] = useState<'cancel' | 'complete' | null>(null);
  const showingMilestones = useRef(false);

  if (archived) return null;
  const manage = permissions.canManage && isOpen(status);
  const next = permissions.canManage && isOpen(status) ? NEXT_STEP[status] : null;
  const canHold = manage && status === 'active';
  const canCancel = permissions.canCancel && isOpen(status);
  const menu = canHold || canCancel || permissions.canArchive;

  async function move(to: StatusTarget) {
    try {
      await change.mutateAsync({ status: to });
      toast.add({ title: t(`projects.actions.done.${to}`), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {manage && <EditProject project={project} />}
      {next && (
        <Button
          ref={focus.next}
          disabled={change.isPending}
          // Starting or resuming keeps the button (as the next step): it keeps the focus.
          focusableWhenDisabled
          onClick={() => (next.status === 'completed' ? setDialog('complete') : move(next.status))}
        >
          <next.icon />
          {t(`projects.actions.${next.action}`)}
        </Button>
      )}
      {menu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton
                ref={focus.menu}
                variant="outline"
                size="icon"
                label={t('projects.actions.more')}
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canHold && (
              <DropdownMenuItem onClick={() => move('on_hold')}>
                <PauseIcon />
                {t('projects.actions.hold')}
              </DropdownMenuItem>
            )}
            {canCancel && (
              <DropdownMenuItem variant="destructive" onClick={() => setDialog('cancel')}>
                <BanIcon />
                {t('projects.actions.cancel')}
              </DropdownMenuItem>
            )}
            {permissions.canArchive && (
              <>
                {(canHold || canCancel) && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={onArchive}>
                  <ArchiveIcon />
                  {t('projects.actions.archive')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <CancelDialog
        project={project}
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        // Cancelled: the reopen button, or the menu (archive) for those who may not reopen.
        finalFocus={() => focusTarget(focus, 'reopen', 'menu')}
      />
      <CompleteDialog
        project={project}
        open={dialog === 'complete'}
        onClose={() => setDialog(null)}
        onShowMilestones={() => {
          showingMilestones.current = true;
          onShowMilestones();
        }}
        // "Open milestones" sends the focus to their tab.
        finalFocus={() => {
          const toMilestones = showingMilestones.current;
          showingMilestones.current = false;
          return toMilestones
            ? focusTarget(focus, 'milestones')
            : focusTarget(focus, 'next', 'reopen', 'menu');
        }}
      />
    </div>
  );
}

/** Where a dialog of the header sends the focus when it closes. */
type FinalFocus = () => HTMLElement | true;

/**
 * Completing needs every milestone done (rule 6). Open ones are listed before any request, and
 * again from `MILESTONES_OPEN` when the page was out of date; pending milestones that are no
 * longer needed can be removed first (edge case 14).
 */
function CompleteDialog({
  project,
  open,
  onClose,
  onShowMilestones,
  finalFocus,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
  onShowMilestones: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const change = useChangeProjectStatus(project.id);
  const [refused, setRefused] = useState<{ id: string; name: string }[] | null>(null);
  const pending =
    refused ?? project.milestones.filter((milestone) => milestone.status === 'pending');

  if (pending.length > 0) {
    return (
      <AlertDialog
        open={open}
        onOpenChange={(next) => !next && onClose()}
        // After the exit animation, so the list does not change while the dialog fades.
        onOpenChangeComplete={(next) => !next && setRefused(null)}
      >
        <AlertDialogContent finalFocus={finalFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('projects.complete.blockedTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('projects.complete.blockedBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="flex flex-col gap-2">
            {pending.map((milestone) => (
              <li
                key={milestone.id}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <CircleDashedIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                {milestone.name}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t('common.close')}
            </AlertDialogClose>
            <Button
              onClick={() => {
                onClose();
                onShowMilestones();
              }}
            >
              {t('projects.complete.openMilestones')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t('projects.complete.title', { name: project.name })}
      body={t('projects.complete.body')}
      action={t('projects.actions.complete')}
      pending={change.isPending}
      finalFocus={finalFocus}
      onConfirm={async () => {
        try {
          await change.mutateAsync({ status: 'completed' });
          toast.add({ title: t('projects.actions.done.completed'), type: 'success' });
        } catch (error) {
          // The page was out of date: show the open milestones instead of a message.
          const open = openMilestonesOf(error);
          if (open) setRefused(open);
          throw error;
        }
      }}
    />
  );
}

/** The milestones listed by a `MILESTONES_OPEN` refusal, or null for any other error. */
function openMilestonesOf(error: unknown): { id: string; name: string }[] | null {
  if (!(error instanceof ApiError) || error.code !== 'MILESTONES_OPEN') return null;
  if (!Array.isArray(error.details)) return null;
  const open = error.details.filter(
    (item): item is { id: string; name: string } =>
      typeof item?.id === 'string' && typeof item?.name === 'string',
  );
  return open.length > 0 ? open : null;
}

/** Cancelling needs a reason (rule 6); the project becomes read-only until reopened. */
function CancelDialog({
  project,
  open,
  onClose,
  finalFocus,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const id = useId();
  const change = useChangeProjectStatus(project.id);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<ProjectStatusChange>({
    resolver: standardSchemaResolver(projectStatusChangeSchema),
    defaultValues: { status: 'cancelled', reason: '' },
  });
  const error = form.formState.errors.reason;

  // After the exit animation, so the reason does not vanish while the dialog fades.
  function closed() {
    setFailure(null);
    form.reset();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await change.mutateAsync(values);
      toast.add({ title: t('projects.actions.done.cancelled'), type: 'success' });
      onClose();
    } catch (failed) {
      setFailure(errorMessage(t, failed));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenChangeComplete={(next) => !next && closed()}
    >
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('projects.cancel.title', { name: project.name })}</DialogTitle>
            <DialogDescription>{t('projects.cancel.body')}</DialogDescription>
          </DialogHeader>
          <Field invalid={!!error}>
            <FieldLabel htmlFor={id}>{t('projects.cancel.reason')}</FieldLabel>
            <Textarea
              id={id}
              rows={3}
              placeholder={t('projects.cancel.reasonPlaceholder')}
              {...form.register('reason')}
            />
            <FieldError match={!!error}>{t('projects.cancel.reasonError')}</FieldError>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={form.formState.isSubmitting}>
              {t('projects.actions.cancel')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Reopens a completed or cancelled project (scope all). An archived project manager must be
 * replaced in the same step (edge case 8), so the dialog asks for one then. It lives on the page:
 * the notice that opens it leaves with the reopening.
 */
export function ReopenDialog({
  project,
  open,
  onClose,
  finalFocus,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const id = useId();
  const change = useChangeProjectStatus(project.id);
  const options = useProjectManagerOptions().filter(
    (option) => option.id !== project.projectManager.id,
  );
  const needsManager = project.projectManager.archived;
  const [managerId, setManagerId] = useState<string | null>(null);
  const [managerError, setManagerError] = useState<{ message: string; refused: boolean } | null>(
    null,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const managerTrigger = useRef<HTMLButtonElement>(null);
  const items = options.map((option) => ({ value: option.id, label: option.name }));

  function closed() {
    setManagerId(null);
    setManagerError(null);
    setFailure(null);
  }

  async function reopen() {
    setFailure(null);
    if (needsManager && !managerId) {
      setManagerError({ message: t('projects.reopen.managerRequired'), refused: false });
      managerTrigger.current?.focus();
      return;
    }
    try {
      await change.mutateAsync({
        status: 'active',
        ...(needsManager && managerId && { projectManagerId: managerId }),
      });
      toast.add({ title: t('projects.actions.done.reopened'), type: 'success' });
      onClose();
    } catch (error) {
      // The chosen manager was archived meanwhile: the field says so and takes the focus.
      if (needsManager && error instanceof ApiError && error.code === 'INVALID_PROJECT_MANAGER') {
        setManagerError({ message: errorMessage(t, error), refused: true });
        managerTrigger.current?.focus();
      } else {
        setFailure(errorMessage(t, error));
      }
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenChangeComplete={(next) => !next && closed()}
    >
      <AlertDialogContent finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('projects.reopen.title', { name: project.name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {needsManager ? t('projects.reopen.bodyNewManager') : t('projects.reopen.body')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {needsManager && (
          <Field invalid={!!managerError}>
            <FieldLabel id={id} render={<span />}>
              {t('projects.form.projectManager')}
            </FieldLabel>
            <Select
              items={items}
              value={managerId}
              onValueChange={(value) => {
                setManagerId(value);
                setManagerError(null);
              }}
            >
              <SelectTrigger ref={managerTrigger} aria-labelledby={id}>
                <SelectValue placeholder={t('projects.form.projectManagerPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {t('projects.reopen.archivedManager', { name: project.projectManager.name })}
            </FieldDescription>
            <FieldError match={!!managerError} role={managerError?.refused ? 'alert' : undefined}>
              {managerError?.message}
            </FieldError>
          </Field>
        )}
        {failure && <FormAlert>{failure}</FormAlert>}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            {t('common.cancel')}
          </AlertDialogClose>
          <Button disabled={change.isPending} onClick={reopen}>
            {t('projects.actions.reopen')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The project's basics as one form. The project manager needs client scope and the currency
 * money access (the detail's `permissions`); only changed fields are sent.
 */
function EditProject({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const update = useUpdateProject(project.id);
  const { canChangeManager, canEditMoney } = project.permissions;
  const editButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CreateProjectInput, unknown, CreateProject>({
    resolver: standardSchemaResolver(createProjectSchema),
    // A refetch keeps what the user already changed.
    resetOptions: { keepDirtyValues: true },
    values: {
      clientId: project.client.id,
      name: project.name,
      description: project.description ?? '',
      projectManagerId: project.projectManager.id,
      departments: project.departments,
      startDate: project.startDate,
      dueDate: project.dueDate,
      currency: project.money?.currency ?? 'USD',
      milestones: [],
    },
  });

  // After the exit animation: the next opening starts from the saved project. A plain `reset()`
  // would apply `keepDirtyValues` and keep what was typed.
  function closed() {
    setFailure(null);
    form.reset(undefined, { keepDirtyValues: false });
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (!checkDates(form, t, values.startDate, values.dueDate)) return;
    const dirty = form.formState.dirtyFields;
    const changes: UpdateProject = {
      ...(dirty.name && { name: values.name }),
      ...(dirty.description && { description: values.description ?? null }),
      ...(dirty.departments && { departments: values.departments }),
      ...(dirty.startDate && { startDate: values.startDate }),
      ...(dirty.dueDate && { dueDate: values.dueDate }),
      ...(canChangeManager &&
        dirty.projectManagerId && { projectManagerId: values.projectManagerId }),
      ...(canEditMoney && dirty.currency && { currency: values.currency }),
    };
    // Nothing changed: close without a request or a "saved" toast.
    if (Object.keys(changes).length === 0) return setOpen(false);
    try {
      await update.mutateAsync(changes);
      toast.add({ title: t('projects.edit.saved'), type: 'success' });
      setOpen(false);
    } catch (error) {
      setFailure(projectFormFailure(form, t, error));
    }
  });

  return (
    <>
      <Button ref={editButton} variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon />
        {t('common.edit')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} onOpenChangeComplete={(next) => !next && closed()}>
        <DialogContent closeLabel={t('common.close')} className="max-w-2xl" finalFocus={editButton}>
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{t('projects.edit.title')}</DialogTitle>
              {!canChangeManager && (
                <DialogDescription>{t('projects.edit.hint')}</DialogDescription>
              )}
            </DialogHeader>
            <NameField form={form} />
            <DescriptionField form={form} />
            {canChangeManager && (
              <ProjectManagerField form={form} current={project.projectManager} />
            )}
            <DepartmentsField form={form} />
            <DatesFields form={form} />
            {canEditMoney && (
              <CurrencyField form={form} locked={(project.money?.totalMinor ?? 0) > 0} />
            )}
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? t('common.saving') : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
