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
  IconButton,
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
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { focusFirstInvalid } from '../../lib/focus-first-invalid';
import { formatNumber } from '../../lib/format';
import { canAssignIn } from '../tasks/task-access';
import { useDepartmentMembers, useDepartments } from '../tasks/task-form';
import { useCancelShoot, useCloseShoot, useReopenShoot } from './calendar.queries';
import { ConflictList } from './calendar-parts';

type Open = 'close' | 'cancel' | 'reopen';

type FinalFocus = ComponentProps<typeof DialogContent>['finalFocus'];

/**
 * The shoot page's controls that take the focus when an action removes the one that held it:
 * closing, cancelling and reopening swap the header's buttons, archiving swaps them for the
 * notice's "restore".
 */
export interface ShootFocus {
  heading: RefObject<HTMLHeadingElement | null>;
  actions: RefObject<HTMLDivElement | null>;
  restore: RefObject<HTMLButtonElement | null>;
}

/** "Restore" on an archived shoot, else the header's first action, else the heading. */
export function shootFocusTarget(focus: ShootFocus): HTMLElement | null {
  if (focus.restore.current?.isConnected) return focus.restore.current;
  return (
    focus.actions.current?.querySelector<HTMLElement>('button, a[href]') ?? focus.heading.current
  );
}

/**
 * What the caller may do with the shoot now (spec F11, screen 3), from the server's answer. Every
 * dialog stays mounted, so it fades out and gives the focus back: to the button that opened it,
 * or the control that replaced it.
 */
export function ShootActions({
  shoot,
  focus,
  onArchive,
}: {
  shoot: ShootDetail;
  focus: ShootFocus;
  /** The confirmation lives on the page: the menu leaves with the archive. */
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Open | null>(null);
  // The button that opened a dialog; a menu item is gone once its menu closes.
  const opener = useRef<HTMLElement | null>(null);
  const { canEdit, canClose, canCancel, canReopen, canArchive } = shoot.permissions;
  const archived = shoot.archivedAt !== null;
  const menu = canCancel || (canArchive && !archived);
  if (!canEdit && !canClose && !canReopen && !menu) return null;

  function start(next: Open, fromMenu = false) {
    opener.current = fromMenu ? null : (document.activeElement as HTMLElement | null);
    setOpen(next);
  }
  const finalFocus: FinalFocus = () =>
    (opener.current?.isConnected && opener.current) || shootFocusTarget(focus) || true;
  const dialog = { shoot, onClose: () => setOpen(null), finalFocus };

  return (
    <div ref={focus.actions} className="flex shrink-0 flex-wrap items-center gap-2">
      {canClose && (
        <Button onClick={() => start('close')}>
          <CircleCheckBigIcon />
          {t('calendar.actions.close')}
        </Button>
      )}
      {canReopen && (
        <Button variant="outline" onClick={() => start('reopen')}>
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
            render={<IconButton variant="outline" size="icon" label={t('calendar.actions.more')} />}
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canCancel && (
              <DropdownMenuItem variant="destructive" onClick={() => start('cancel', true)}>
                <BanIcon />
                {t('calendar.actions.cancel')}
              </DropdownMenuItem>
            )}
            {canArchive && !archived && (
              <>
                {canCancel && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={onArchive}>
                  <ArchiveIcon />
                  {t('calendar.actions.archive')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <CloseDialog {...dialog} open={open === 'close'} />
      <CancelDialog {...dialog} open={open === 'cancel'} />
      <ReopenDialog {...dialog} open={open === 'reopen'} />
    </div>
  );
}

/** What each action dialog takes from the header. */
interface ShootDialogProps {
  shoot: ShootDetail;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
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
 * A dialog whose form lives inside its content: the form mounts with each opening, so it starts
 * from the shoot every time and keeps nothing typed before.
 */
function ActionDialog({
  open,
  onClose,
  finalFocus,
  children,
}: Omit<ShootDialogProps, 'shoot'> & {
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rules 10–12: closes the shoot with an optional note and raw files link, warns about unticked
 * shots without blocking, and proposes the editing task (off when the shoot task already has
 * dependent tasks).
 */
function CloseDialog({ shoot, ...dialog }: ShootDialogProps) {
  return (
    <ActionDialog {...dialog}>
      <CloseForm shoot={shoot} onClose={dialog.onClose} />
    </ActionDialog>
  );
}

function CloseForm({ shoot, onClose }: { shoot: ShootDetail; onClose: () => void }) {
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
  const formRef = useRef<HTMLFormElement>(null);
  // Every problem shows at once; the focus goes to the first one.
  useEffect(() => {
    if (Object.keys(problems).length > 0) focusFirstInvalid(formRef.current);
  }, [problems]);

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
    <form
      ref={formRef}
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
        <SwitchRow
          id={ids.create}
          label={t('calendar.close.createTask')}
          hint={
            hasDependents
              ? t('calendar.close.createTaskHintDependents')
              : t('calendar.close.createTaskHint')
          }
          checked={create}
          onChange={setCreate}
        />
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
                  onValueChange={(next) => setAssignee(!next || next === UNASSIGNED ? null : next)}
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
                <FieldError match={!!problems.assignee} role="alert">
                  {problems.assignee}
                </FieldError>
              </Field>
            </div>
            <Field invalid={!!problems.dueDate}>
              <FieldLabel>{t('calendar.close.dueDate')}</FieldLabel>
              <Input
                type="date"
                dir="ltr"
                min={businessDate()}
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
              <FieldDescription>{t('calendar.close.dueDateHint')}</FieldDescription>
              <FieldError match={!!problems.dueDate}>{problems.dueDate}</FieldError>
            </Field>
            {shoot.client && (
              <SwitchRow
                id={ids.approval}
                label={t('tasks.form.needsClientApproval')}
                checked={needsClientApproval}
                onChange={setNeedsClientApproval}
              />
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
  );
}

/** A switch beside its own label, with an optional hint under both. */
function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-3">
        <span className="text-sm font-medium">{label}</span>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </label>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Rule 13: a reason, and optionally the shoot task cancelled with it. */
function CancelDialog({ shoot, ...dialog }: ShootDialogProps) {
  return (
    <ActionDialog {...dialog}>
      <CancelForm shoot={shoot} onClose={dialog.onClose} />
    </ActionDialog>
  );
}

function CancelForm({ shoot, onClose }: { shoot: ShootDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const cancel = useCancelShoot(shoot.id);
  const [reason, setReason] = useState('');
  const [cancelTask, setCancelTask] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    setProblem(null);
    setFailure(null);
    const input = cancelShootSchema.safeParse({ reason, cancelTask });
    if (!input.success) {
      setProblem(t('calendar.cancel.errors.reason'));
      reasonRef.current?.focus();
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
          ref={reasonRef}
          rows={3}
          maxLength={CALENDAR_LIMITS.cancelReason}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <FieldError match={!!problem}>{problem}</FieldError>
      </Field>
      <SwitchRow
        id={id}
        label={t('calendar.cancel.cancelTask')}
        hint={t('calendar.cancel.cancelTaskHint')}
        checked={cancelTask}
        onChange={setCancelTask}
      />
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t('common.cancel')}</DialogClose>
        <Button type="submit" variant="destructive" disabled={cancel.isPending}>
          {t('calendar.cancel.action')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Rule 13: back to scheduled. When the crew is booked elsewhere by now, the API answers with the
 * conflicts and the dialog asks again before reopening anyway (rule 5).
 */
function ReopenDialog({ shoot, open, onClose, finalFocus }: ShootDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent finalFocus={finalFocus}>
        <ReopenForm shoot={shoot} onClose={onClose} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReopenForm({ shoot, onClose }: { shoot: ShootDetail; onClose: () => void }) {
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
    <>
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
        <Button disabled={reopen.isPending} focusableWhenDisabled onClick={submit}>
          {conflicts ? t('calendar.reopen.anyway') : t('calendar.actions.reopen')}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
