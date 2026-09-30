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
  RotateCcwIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
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
import { useArchiveProject, useChangeProjectStatus, useUpdateProject } from './projects.queries';

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
 * The header's actions: edit, the project's next step as the primary button, and the rest in a
 * menu. Only what the caller may do on this status is offered (rule 6); the API enforces it.
 */
export function ProjectActions({
  project,
  onShowMilestones,
}: {
  project: ProjectDetail;
  onShowMilestones: () => void;
}) {
  const { t } = useTranslation();
  const { permissions, status } = project;
  const archived = project.archivedAt !== null;
  const change = useChangeProjectStatus(project.id);
  const [dialog, setDialog] = useState<'cancel' | 'complete' | 'archive' | null>(null);

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
          disabled={change.isPending}
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
              <Button variant="outline" size="icon" aria-label={t('projects.actions.more')} />
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
                <DropdownMenuItem variant="destructive" onClick={() => setDialog('archive')}>
                  <ArchiveIcon />
                  {t('projects.actions.archive')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <CancelDialog project={project} open={dialog === 'cancel'} onClose={() => setDialog(null)} />
      <CompleteDialog
        project={project}
        open={dialog === 'complete'}
        onClose={() => setDialog(null)}
        onShowMilestones={onShowMilestones}
      />
      <ArchiveDialog
        project={project}
        open={dialog === 'archive'}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

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
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
  onShowMilestones: () => void;
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
        onOpenChange={(next) => {
          if (!next) {
            setRefused(null);
            onClose();
          }
        }}
      >
        <AlertDialogContent>
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
                setRefused(null);
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
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
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

  function close() {
    setFailure(null);
    form.reset();
    onClose();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await change.mutateAsync(values);
      toast.add({ title: t('projects.actions.done.cancelled'), type: 'success' });
      close();
    } catch (failed) {
      setFailure(errorMessage(t, failed));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent closeLabel={t('common.close')}>
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

function ArchiveDialog({
  project,
  open,
  onClose,
}: {
  project: ProjectDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const archive = useArchiveProject(project.id);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t('projects.archive.title', { name: project.name })}
      body={t('projects.archive.body')}
      action={t('projects.actions.archive')}
      destructive
      pending={archive.isPending}
      onConfirm={async () => {
        await archive.mutateAsync(undefined);
        toast.add({ title: t('projects.archive.done'), type: 'success' });
      }}
    />
  );
}

/**
 * Reopens a completed or cancelled project (scope all). An archived project manager must be
 * replaced in the same step (edge case 8), so the dialog asks for one then.
 */
export function ReopenButton({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const id = useId();
  const change = useChangeProjectStatus(project.id);
  const options = useProjectManagerOptions().filter(
    (option) => option.id !== project.projectManager.id,
  );
  const needsManager = project.projectManager.archived;
  const [open, setOpen] = useState(false);
  const [managerId, setManagerId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const items = options.map((option) => ({ value: option.id, label: option.name }));

  function close() {
    setOpen(false);
    setManagerId(null);
    setFailure(null);
  }

  async function reopen() {
    setFailure(null);
    if (needsManager && !managerId) {
      setFailure(t('projects.reopen.managerRequired'));
      return;
    }
    try {
      await change.mutateAsync({
        status: 'active',
        ...(needsManager && managerId && { projectManagerId: managerId }),
      });
      toast.add({ title: t('projects.actions.done.reopened'), type: 'success' });
      close();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RotateCcwIcon />
        {t('projects.actions.reopen')}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !next && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('projects.reopen.title', { name: project.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {needsManager ? t('projects.reopen.bodyNewManager') : t('projects.reopen.body')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {needsManager && (
            <Field>
              <FieldLabel id={id} render={<span />}>
                {t('projects.form.projectManager')}
              </FieldLabel>
              <Select items={items} value={managerId} onValueChange={setManagerId}>
                <SelectTrigger aria-labelledby={id}>
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
    </>
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

  function close() {
    setOpen(false);
    setFailure(null);
    form.reset();
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
    try {
      if (Object.keys(changes).length > 0) await update.mutateAsync(changes);
      toast.add({ title: t('projects.edit.saved'), type: 'success' });
      close();
    } catch (error) {
      setFailure(projectFormFailure(form, t, error));
    }
  });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon />
        {t('common.edit')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
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
