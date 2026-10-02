import { Link } from '@tanstack/react-router';
import {
  businessDate,
  CALENDAR_LIMITS,
  cancelShootSchema,
  closeShootSchema,
  type DepartmentCode,
  editingTaskDefaults,
  type ScheduleConflict,
  SHOOT_DEPARTMENT,
  type ShootDetail,
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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  BanIcon,
  CircleCheckBigIcon,
  EllipsisIcon,
  PencilIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { canAssignIn } from '../tasks/task-access';
import { useDepartmentMembers, useDepartments } from '../tasks/task-form';
import { useArchiveShoot, useCancelShoot, useCloseShoot, useReopenShoot } from './calendar.queries';
import { ConflictList } from './calendar-parts';

type Open = 'close' | 'cancel' | 'reopen' | 'archive' | null;

/** What the caller may do with the shoot now (spec F11, screen 3), from the server's answer. */
export function ShootActions({ shoot }: { shoot: ShootDetail }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Open>(null);
  const archive = useArchiveShoot(shoot.id);
  const { canEdit, canClose, canCancel, canReopen, canArchive } = shoot.permissions;
  const archived = shoot.archivedAt !== null;
  const menu = canCancel || (canArchive && !archived);
  if (!canEdit && !canClose && !canReopen && !menu) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {canClose && (
        <Button onClick={() => setOpen('close')}>
          <CircleCheckBigIcon />
          {t('calendar.actions.close')}
        </Button>
      )}
      {canReopen && (
        <Button variant="outline" onClick={() => setOpen('reopen')}>
          <RotateCcwIcon className="rtl:-scale-x-100" />
          {t('calendar.actions.reopen')}
        </Button>
      )}
      {canEdit && (
        <Button
          variant="outline"
          render={<Link to="/shoots/$shootId/edit" params={{ shootId: shoot.id }} />}
        >
          <PencilIcon />
          {t('calendar.actions.edit')}
        </Button>
      )}
      {menu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="icon" aria-label={t('calendar.actions.more')} />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canCancel && (
              <DropdownMenuItem variant="destructive" onClick={() => setOpen('cancel')}>
                <BanIcon />
                {t('calendar.actions.cancel')}
              </DropdownMenuItem>
            )}
            {canArchive && !archived && (
              <>
                {canCancel && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={() => setOpen('archive')}>
                  <ArchiveIcon />
                  {t('calendar.actions.archive')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {open === 'close' && <CloseDialog shoot={shoot} onClose={() => setOpen(null)} />}
      {open === 'cancel' && <CancelDialog shoot={shoot} onClose={() => setOpen(null)} />}
      {open === 'reopen' && <ReopenDialog shoot={shoot} onClose={() => setOpen(null)} />}
      <ConfirmDialog
        open={open === 'archive'}
        onClose={() => setOpen(null)}
        title={t('calendar.archive.title', { title: shoot.title })}
        body={t('calendar.archive.body')}
        action={t('calendar.actions.archive')}
        destructive
        pending={archive.isPending}
        onConfirm={async () => {
          await archive.mutateAsync(undefined);
          toast.add({ title: t('calendar.archive.done'), type: 'success' });
        }}
      />
    </div>
  );
}

const Optional = () => {
  const { t } = useTranslation();
  return <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>;
};

const UNASSIGNED = 'unassigned';

/** The fields the contract checks before the round trip. */
const CHECKED_FIELDS = ['note', 'rawFilesUrl', 'title', 'dueDate'] as const;

type CloseProblem = (typeof CHECKED_FIELDS)[number] | 'assignee';

/**
 * Rules 10–12: closes the shoot with an optional note and raw files link, warns about unticked
 * shots without blocking, and proposes the editing task (off when the shoot task already has
 * dependent tasks).
 */
function CloseDialog({ shoot, onClose }: { shoot: ShootDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const ids = { create: useId(), approval: useId() };
  const close = useCloseShoot(shoot.id);
  const departments = useDepartments();
  const lead = shoot.crew.find((member) => member.isLead)?.user ?? null;
  const photographers = useDepartmentMembers(SHOOT_DEPARTMENT);
  const hasDependents = shoot.task.dependentCount > 0;
  const defaults = editingTaskDefaults({
    shootTitle: shoot.title,
    closeDay: businessDate(),
    lead: lead && {
      id: lead.id,
      inPhotography: photographers.some((member) => member.id === lead.id),
    },
    hasDependents,
    hasClient: shoot.client !== null,
  });
  const [note, setNote] = useState('');
  const [rawFilesUrl, setRawFilesUrl] = useState('');
  const [create, setCreate] = useState(defaults.create);
  const [title, setTitle] = useState(defaults.title);
  const [department, setDepartment] = useState<DepartmentCode>(defaults.department);
  // Untouched until picked: the default waits for the department's members to load.
  const [assignee, setAssignee] = useState<string | null | undefined>(undefined);
  const [dueDate, setDueDate] = useState<string>(defaults.dueDate);
  const [needsClientApproval, setNeedsClientApproval] = useState(defaults.needsClientApproval);
  const [problems, setProblems] = useState<Partial<Record<CloseProblem, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const members = useDepartmentMembers(department);
  // Rule 12: a crew member of the department, or anyone in it for those with assign scope.
  const anyone = canAssignIn(me, department, null);
  const assignees = members.filter(
    (member) => anyone || shoot.crew.some(({ user }) => user.id === member.id),
  );
  const defaultAssignee = department === SHOOT_DEPARTMENT ? defaults.assigneeId : null;
  const assigneeId = assignee === undefined ? defaultAssignee : assignee;
  const assigneeItems = [
    { value: UNASSIGNED, label: t('calendar.close.unassigned') },
    ...assignees.map((member) => ({ value: member.id, label: member.name })),
  ];
  const departmentItems = departments.map(({ code, name }) => ({ value: code, label: name }));
  const unticked = shoot.shots.filter((shot) => shot.doneAt === null).length;

  async function submit() {
    setProblems({});
    setFailure(null);
    const input = closeShootSchema.safeParse({
      note,
      rawFilesUrl: rawFilesUrl.trim() || null,
      editingTask: create ? { title, department, assigneeId, dueDate, needsClientApproval } : null,
    });
    if (!input.success) {
      const found: typeof problems = {};
      for (const issue of input.error.issues) {
        const field = CHECKED_FIELDS.find((known) => known === issue.path.at(-1));
        if (field) found[field] ??= t(`calendar.close.errors.${field}`);
      }
      if (Object.keys(found).length === 0) setFailure(t('errors.generic'));
      setProblems(found);
      return;
    }
    if (create && dueDate < businessDate()) {
      setProblems({ dueDate: t('calendar.close.errors.duePast') });
      return;
    }
    try {
      const closed = await close.mutateAsync(input.data);
      toast.add({
        title: closed.editingTask ? t('calendar.close.doneWithTask') : t('calendar.close.done'),
        type: 'success',
      });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_ASSIGNEE')
        setProblems({ assignee: errorMessage(t, error) });
      else setFailure(errorMessage(t, error));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('calendar.close.title', { title: shoot.title })}</DialogTitle>
            <DialogDescription>{t('calendar.close.body')}</DialogDescription>
          </DialogHeader>
          {unticked > 0 && (
            <Callout
              tone="warning"
              icon={<TriangleAlertIcon />}
              title={t('calendar.close.unticked', {
                n: formatNumber(unticked),
                total: formatNumber(shoot.shots.length),
              })}
              description={t('calendar.close.untickedBody')}
            />
          )}
          <Field invalid={!!problems.note}>
            <FieldLabel>
              {t('calendar.close.note')}
              <Optional />
            </FieldLabel>
            <Textarea
              rows={3}
              maxLength={CALENDAR_LIMITS.closeNote}
              placeholder={t('calendar.close.notePlaceholder')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <FieldError match={!!problems.note}>{problems.note}</FieldError>
          </Field>
          <Field invalid={!!problems.rawFilesUrl}>
            <FieldLabel>
              {t('calendar.close.rawFilesUrl')}
              <Optional />
            </FieldLabel>
            <Input
              type="url"
              dir="ltr"
              placeholder="https://drive.google.com/…"
              value={rawFilesUrl}
              onChange={(event) => setRawFilesUrl(event.target.value)}
            />
            <FieldDescription>{t('calendar.close.rawFilesHint')}</FieldDescription>
            <FieldError match={!!problems.rawFilesUrl}>{problems.rawFilesUrl}</FieldError>
          </Field>
          <div className="flex flex-col gap-4 rounded-md border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <label htmlFor={ids.create} className="flex flex-col gap-0.5 text-sm font-medium">
                {t('calendar.close.createTask')}
                <span className="font-normal text-muted-foreground">
                  {hasDependents
                    ? t('calendar.close.createTaskHintDependents')
                    : t('calendar.close.createTaskHint')}
                </span>
              </label>
              <Switch id={ids.create} checked={create} onCheckedChange={setCreate} />
            </div>
            {create && (
              <>
                <Field invalid={!!problems.title}>
                  <FieldLabel>{t('calendar.close.taskTitle')}</FieldLabel>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} />
                  <FieldError match={!!problems.title}>{problems.title}</FieldError>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>{t('calendar.close.department')}</FieldLabel>
                    <Select
                      items={departmentItems}
                      value={department}
                      onValueChange={(next) => {
                        if (!next || next === department) return;
                        setDepartment(next as DepartmentCode);
                        setAssignee(null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {departmentItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field invalid={!!problems.assignee}>
                    <FieldLabel>{t('calendar.close.assignee')}</FieldLabel>
                    <Select
                      items={assigneeItems}
                      value={assigneeId ?? UNASSIGNED}
                      onValueChange={(next) =>
                        setAssignee(!next || next === UNASSIGNED ? null : next)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {assigneeItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError match={!!problems.assignee}>{problems.assignee}</FieldError>
                  </Field>
                </div>
                <Field invalid={!!problems.dueDate}>
                  <FieldLabel>{t('calendar.close.dueDate')}</FieldLabel>
                  <Input
                    type="date"
                    min={businessDate()}
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                  <FieldDescription>{t('calendar.close.dueDateHint')}</FieldDescription>
                  <FieldError match={!!problems.dueDate}>{problems.dueDate}</FieldError>
                </Field>
                {shoot.client && (
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor={ids.approval} className="text-sm font-medium">
                      {t('tasks.form.needsClientApproval')}
                    </label>
                    <Switch
                      id={ids.approval}
                      checked={needsClientApproval}
                      onCheckedChange={setNeedsClientApproval}
                    />
                  </div>
                )}
              </>
            )}
          </div>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t('common.cancel')}</DialogClose>
            <Button type="submit" disabled={close.isPending}>
              {t('calendar.close.action')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Rule 13: a reason, and optionally the shoot task cancelled with it. */
function CancelDialog({ shoot, onClose }: { shoot: ShootDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const cancel = useCancelShoot(shoot.id);
  const [reason, setReason] = useState('');
  const [cancelTask, setCancelTask] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit() {
    setProblem(null);
    setFailure(null);
    const input = cancelShootSchema.safeParse({ reason, cancelTask });
    if (!input.success) {
      setProblem(t('calendar.cancel.errors.reason'));
      return;
    }
    try {
      await cancel.mutateAsync(input.data);
      toast.add({ title: t('calendar.cancel.done'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('calendar.cancel.title', { title: shoot.title })}</DialogTitle>
            <DialogDescription>{t('calendar.cancel.body')}</DialogDescription>
          </DialogHeader>
          <Field invalid={!!problem}>
            <FieldLabel>{t('calendar.cancel.reason')}</FieldLabel>
            <Textarea
              rows={3}
              maxLength={CALENDAR_LIMITS.cancelReason}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <FieldError match={!!problem}>{problem}</FieldError>
          </Field>
          <div className="flex items-start justify-between gap-3">
            <label htmlFor={id} className="flex flex-col gap-0.5 text-sm font-medium">
              {t('calendar.cancel.cancelTask')}
              <span className="font-normal text-muted-foreground">
                {t('calendar.cancel.cancelTaskHint')}
              </span>
            </label>
            <Switch id={id} checked={cancelTask} onCheckedChange={setCancelTask} />
          </div>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t('common.cancel')}</DialogClose>
            <Button type="submit" variant="destructive" disabled={cancel.isPending}>
              {t('calendar.cancel.action')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rule 13: back to scheduled. When the crew is booked elsewhere by now, the API answers with the
 * conflicts and the dialog asks again before reopening anyway (rule 5).
 */
function ReopenDialog({ shoot, onClose }: { shoot: ShootDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const reopen = useReopenShoot(shoot.id);
  const [conflicts, setConflicts] = useState<ScheduleConflict[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit() {
    setFailure(null);
    try {
      await reopen.mutateAsync({ acceptConflicts: conflicts !== null });
      toast.add({ title: t('calendar.reopen.done'), type: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SCHEDULE_CONFLICT' && !conflicts) {
        setConflicts(Array.isArray(error.details) ? (error.details as ScheduleConflict[]) : []);
        return;
      }
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('calendar.reopen.title', { title: shoot.title })}</AlertDialogTitle>
          <AlertDialogDescription>
            {conflicts ? t('calendar.form.confirmConflictsBody') : t('calendar.reopen.body')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {conflicts && <ConflictList conflicts={conflicts} />}
        {failure && <FormAlert>{failure}</FormAlert>}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            {t('common.cancel')}
          </AlertDialogClose>
          <Button disabled={reopen.isPending} onClick={submit}>
            {conflicts ? t('calendar.reopen.anyway') : t('calendar.actions.reopen')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
