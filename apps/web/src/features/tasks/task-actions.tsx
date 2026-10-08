import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import {
  type CreateTask,
  type CreateTaskInput,
  createTaskSchema,
  type DepartmentCode,
  isTaskFinished,
  type TaskDetail,
  type TaskMove,
  type TaskStatus,
  type TaskStatusChange,
  type TaskStatusChangeInput,
  taskMove,
  taskMoveNeedsNote,
  taskStatusChangeSchema,
  type UpdateTask,
  updateTaskSchema,
} from '@vertex-hub/contracts';
import {
  Avatar,
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
import type { TFunction } from 'i18next';
import {
  ArchiveIcon,
  BanIcon,
  CheckCheckIcon,
  CircleCheckBigIcon,
  CornerUpLeftIcon,
  EllipsisIcon,
  EyeIcon,
  type LucideIcon,
  MessageSquareReplyIcon,
  PackageCheckIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  SendIcon,
  StethoscopeIcon,
  UndoIcon,
  UserRoundCogIcon,
} from 'lucide-react';
import { type ComponentProps, type RefObject, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { errorMessage, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { clientQuery } from '../clients/clients.queries';
import { TaskStatusBadge } from './task-badges';
import {
  ApprovalFields,
  BriefField,
  ClientField,
  ClientRequestFields,
  DueFields,
  EngagementFields,
  PriorityField,
  TitleField,
  taskFormFailure,
  useClientOptions,
  useDepartmentMembers,
  useDepartments,
} from './task-form';
import { type MedicalDecision, MedicalReviewDialog } from './task-review';
import { useChangeTaskStatus, useUpdateTask } from './tasks.queries';

/** Icons that point along the reading direction, so they mirror in RTL (brand §6). */
export const MIRRORED_ICONS: ReadonlySet<LucideIcon> = new Set([
  SendIcon,
  UndoIcon,
  CornerUpLeftIcon,
]);

export const MOVE_ICONS: Record<TaskMove, LucideIcon> = {
  start: PlayIcon,
  submit: SendIcon,
  return: UndoIcon,
  send_to_client: EyeIcon,
  approve: CircleCheckBigIcon,
  client_approved: CheckCheckIcon,
  client_changes: MessageSquareReplyIcon,
  withdraw: CornerUpLeftIcon,
  resume: PlayIcon,
  resubmit: SendIcon,
  deliver: PackageCheckIcon,
  reopen_client: MessageSquareReplyIcon,
  reopen_internal: RotateCcwIcon,
  cancel: BanIcon,
  reopen: RotateCcwIcon,
};

/** Moves that send work back rather than forward: shown as secondary buttons. */
const BACKWARD: TaskMove[] = [
  'return',
  'client_changes',
  'withdraw',
  'reopen_client',
  'reopen_internal',
];

/** Moves that record who answered for the client. */
const CLIENT_MOVES: TaskMove[] = ['client_approved', 'client_changes', 'reopen_client'];

/** Client responses (F09 rule 16): the contact who answered is required. */
const RESPONSE_MOVES: TaskMove[] = ['client_approved', 'client_changes'];

/** Internal passes (F09 rule 1): they send the content token the reviewer was shown. */
const PASS_MOVES: TaskMove[] = ['send_to_client', 'approve'];

/** What a move without a dialog sends. */
export const moveInput = (task: TaskDetail, target: Target): TaskStatusChange => ({
  status: target.to,
  overrideDependencies: false,
  ...(PASS_MOVES.includes(target.move) && { contentToken: task.contentToken }),
});

/** What a finished move says: a healthcare client's pass waits for the medical review first. */
export const moveDone = (t: TFunction, move: TaskMove, task: Pick<TaskDetail, 'reviewStage'>) =>
  move === 'send_to_client' && task.reviewStage === 'medical'
    ? t('tasks.moves.done.to_medical')
    : t(`tasks.moves.done.${move}`);

export interface Target {
  to: TaskStatus;
  move: TaskMove;
}

/**
 * A move asks for input first: a note, who answered, or a reason to start a blocked task.
 * Withdrawing from the client is confirmed, with an optional note (F09 rule 6): it also takes
 * the task out of the client's approval link.
 */
export function needsDialog(task: TaskDetail, { move }: Target): boolean {
  return (
    taskMoveNeedsNote(move) ||
    CLIENT_MOVES.includes(move) ||
    move === 'withdraw' ||
    (move === 'start' && task.blocked)
  );
}

/**
 * A task linked to a post is approved by the client with the post and delivered when the post is
 * published (F08 rule 7): delivering by hand and recording a client response are refused
 * (`LINKED_TO_POST`).
 */
const refusedWhenLinked = (task: TaskDetail, move: TaskMove): boolean =>
  task.postId !== null &&
  (move === 'deliver' || (move === 'client_changes' && task.status === 'approved'));

/** The workflow moves the caller may make now, from the server's `allowedTransitions`. */
export function targetsOf(task: TaskDetail): Target[] {
  return task.allowedTransitions.flatMap((to) => {
    const move = taskMove(task.status, to);
    return move && !refusedWhenLinked(task, move) ? [{ to, move }] : [];
  });
}

type FinalFocus = ComponentProps<typeof DialogContent>['finalFocus'];

/**
 * The task page's controls that take the focus when an action removes the one that held it: a
 * move swaps the header's buttons, an archive swaps them for the notice's "restore".
 */
export interface TaskFocus {
  heading: RefObject<HTMLHeadingElement | null>;
  /** The header's buttons; the first move (`data-move`) takes the focus after another move. */
  actions: RefObject<HTMLDivElement | null>;
  menu: RefObject<HTMLButtonElement | null>;
  restore: RefObject<HTMLButtonElement | null>;
}

/**
 * The first of these controls still on the page: "restore" on an archived task, then the first
 * move and the menu (the menu first after a menu action), else the heading.
 */
export function focusTarget(focus: TaskFocus, first: 'move' | 'menu' = 'move'): HTMLElement | true {
  const move = focus.actions.current?.querySelector<HTMLElement>('[data-move]') ?? null;
  const order = first === 'menu' ? [focus.menu.current, move] : [move, focus.menu.current];
  for (const element of [focus.restore.current, ...order]) {
    if (element?.isConnected) return element;
  }
  return focus.heading.current ?? true;
}

type ActionDialog = Target | 'edit' | 'reassign';

/**
 * The header's actions: the workflow moves the caller may make now (`allowedTransitions`), then
 * edit, reassign, cancel and archive in a menu. The API enforces every rule; a move that became
 * stale answers `INVALID_TRANSITION` and the page reloads (edge case 1). Every dialog stays
 * mounted, so it fades out and gives the focus back: to the button that opened it, or the control
 * that replaced it.
 */
export function TaskActions({
  task,
  focus,
  onArchive,
}: {
  task: TaskDetail;
  focus: TaskFocus;
  /** The confirmation lives on the page: the menu leaves with the archive. */
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const change = useChangeTaskStatus(task.id);
  const [dialog, setDialog] = useState<ActionDialog | null>(null);
  const [medical, setMedical] = useState<MedicalDecision | null>(null);
  // The dialog's content stays while it fades out after closing.
  const shownDialog = useShownWhileClosing(dialog);
  const shownMedical = useShownWhileClosing(medical);
  // The button that opened a dialog; a menu item is gone once its menu closes.
  const opener = useRef<{ element: HTMLElement | null; fromMenu: boolean }>({
    element: null,
    fromMenu: false,
  });
  if (task.readOnly) return null;

  function open(next: ActionDialog, fromMenu = false) {
    opener.current = { element: document.activeElement as HTMLElement | null, fromMenu };
    setDialog(next);
  }
  function openMedical(decision: MedicalDecision) {
    opener.current = { element: document.activeElement as HTMLElement | null, fromMenu: false };
    setMedical(decision);
  }
  const finalFocus: FinalFocus = () => {
    const { element, fromMenu } = opener.current;
    if (!fromMenu && element?.isConnected && element !== document.body) return element;
    return focusTarget(focus, fromMenu ? 'menu' : 'move');
  };

  const targets = targetsOf(task);
  const moves = targets.filter((target) => target.move !== 'cancel');
  const cancel = targets.find((target) => target.move === 'cancel');
  const { canEdit, canAssign, canArchive, canMedicalReview } = task.permissions;
  const menu = canEdit || canAssign || canArchive || cancel;

  async function run(target: Target) {
    if (needsDialog(task, target)) {
      open(target);
      return;
    }
    try {
      const moved = await change.mutateAsync(moveInput(task, target));
      toast.add({ title: moveDone(t, target.move, moved), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <div ref={focus.actions} className="flex shrink-0 flex-wrap items-center gap-2">
      {canMedicalReview && (
        <>
          <Button data-move onClick={() => openMedical('approve')}>
            <StethoscopeIcon />
            {t('tasks.medical.approve')}
          </Button>
          <Button data-move variant="outline" onClick={() => openMedical('return')}>
            <UndoIcon className="rtl:-scale-x-100" />
            {t('tasks.medical.return')}
          </Button>
        </>
      )}
      {moves.map((target) => {
        const Icon = MOVE_ICONS[target.move];
        return (
          <Button
            key={target.to}
            data-move
            variant={BACKWARD.includes(target.move) ? 'outline' : 'primary'}
            disabled={change.isPending}
            // It may leave with the move: focusable, so the focus is not dropped meanwhile.
            focusableWhenDisabled
            onClick={() => run(target)}
          >
            <Icon className={MIRRORED_ICONS.has(Icon) ? 'rtl:-scale-x-100' : undefined} />
            {t(`tasks.moves.${target.move}`)}
          </Button>
        );
      })}
      {menu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton
                ref={focus.menu}
                variant="outline"
                size="icon"
                label={t('tasks.actions.more')}
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && (
              <DropdownMenuItem onClick={() => open('edit', true)}>
                <PencilIcon />
                {t('tasks.actions.edit')}
              </DropdownMenuItem>
            )}
            {canAssign && (
              <DropdownMenuItem onClick={() => open('reassign', true)}>
                <UserRoundCogIcon />
                {t('tasks.actions.reassign')}
              </DropdownMenuItem>
            )}
            {cancel && (
              <DropdownMenuItem variant="destructive" onClick={() => open(cancel, true)}>
                <BanIcon />
                {t('tasks.moves.cancel')}
              </DropdownMenuItem>
            )}
            {canArchive && (
              <>
                {(canEdit || canAssign || cancel) && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={onArchive}>
                  <ArchiveIcon />
                  {t('tasks.actions.archive')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {typeof shownDialog === 'object' && shownDialog !== null && (
        <MoveDialog
          key={shownDialog.move}
          task={task}
          target={shownDialog}
          open={dialog === shownDialog}
          onClose={() => setDialog(null)}
          finalFocus={finalFocus}
        />
      )}
      {shownMedical && (
        <MedicalReviewDialog
          key={shownMedical}
          task={task}
          decision={shownMedical}
          open={medical !== null}
          onClose={() => setMedical(null)}
          finalFocus={finalFocus}
        />
      )}
      {shownDialog === 'edit' && (
        <EditTaskDialog
          task={task}
          open={dialog === 'edit'}
          onClose={() => setDialog(null)}
          finalFocus={finalFocus}
        />
      )}
      {shownDialog === 'reassign' && (
        <ReassignDialog
          task={task}
          open={dialog === 'reassign'}
          onClose={() => setDialog(null)}
          finalFocus={finalFocus}
        />
      )}
    </div>
  );
}

/**
 * The input a move needs: what must change (returns and client changes, recorded as revisions),
 * a reason (cancel, reopen), who answered for the client, or why a blocked task starts anyway.
 */
export function MoveDialog({
  task,
  target,
  open,
  onClose,
  finalFocus,
}: {
  task: TaskDetail;
  target: Target;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const ids = { note: useId(), reason: useId(), contact: useId() };
  const contactTrigger = useRef<HTMLButtonElement>(null);
  const change = useChangeTaskStatus(task.id);
  const [failure, setFailure] = useState<string | null>(null);
  const { move } = target;
  const override = move === 'start' && task.blocked;
  const needsNote = taskMoveNeedsNote(move);
  const optionalNote = move === 'withdraw';
  const asksContact = CLIENT_MOVES.includes(move) && !!task.client;
  const needsContact = RESPONSE_MOVES.includes(move);
  const client = useQuery({ ...clientQuery(task.client?.id ?? ''), enabled: asksContact });
  // Rule 16: any contact may have answered; those with final approval are suggested first.
  const contacts = [...(client.data?.contacts ?? [])].sort(
    (a, b) => Number(b.hasFinalApproval) - Number(a.hasFinalApproval),
  );
  const contactItems = [
    { value: 'none', label: t('tasks.form.noContact') },
    ...contacts.map((contact) => ({
      value: contact.id,
      label:
        needsContact && contact.hasFinalApproval
          ? t('tasks.move.finalApprover', { name: contact.name })
          : contact.name,
    })),
  ];

  const form = useForm<TaskStatusChangeInput, unknown, TaskStatusChange>({
    resolver: standardSchemaResolver(taskStatusChangeSchema),
    defaultValues: {
      status: target.to,
      note: '',
      contactId: null,
      overrideDependencies: override,
      reason: '',
      ...(move === 'reopen_client' && { revisionSource: 'client' as const }),
      ...(move === 'reopen_internal' && { revisionSource: 'internal' as const }),
    },
  });
  const noteError = form.formState.errors.note;
  const contactError = form.formState.errors.contactId;
  const reasonError = form.formState.errors.reason;
  const waiting = task.dependencies.filter(
    (dependency) =>
      !dependency.archived &&
      dependency.status !== 'cancelled' &&
      !isTaskFinished(dependency.status),
  );
  const noteKind = ['return', 'client_changes', 'reopen_client'].includes(move)
    ? 'changes'
    : 'reason';

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // Every missing field says so; the first one in the dialog takes the focus.
    const missingNote = needsNote && !values.note;
    const missingContact = needsContact && !values.contactId;
    if (missingNote) {
      form.setError('note', { type: SCREEN_ERROR, message: t(`tasks.move.errors.${noteKind}`) });
    }
    if (missingContact) {
      form.setError('contactId', { type: SCREEN_ERROR, message: t('tasks.move.errors.contact') });
    }
    if (missingNote) form.setFocus('note');
    else if (missingContact) contactTrigger.current?.focus();
    if (missingNote || missingContact) return;
    try {
      const moved = await change.mutateAsync({
        ...values,
        note: needsNote || optionalNote ? values.note || undefined : undefined,
        reason: override ? values.reason : undefined,
        contactId: asksContact ? values.contactId : undefined,
      });
      toast.add({ title: moveDone(t, move, moved), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      // After the exit animation, so the note does not empty while the dialog fades.
      onOpenChangeComplete={(next) => {
        if (next) return;
        form.reset();
        setFailure(null);
      }}
    >
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t(`tasks.move.${move}.title`, { title: task.title })}</DialogTitle>
            <DialogDescription>{t(`tasks.move.${move}.body`)}</DialogDescription>
          </DialogHeader>
          {override && (
            <ul className="flex flex-col gap-2">
              {waiting.map((dependency) => (
                <li
                  key={dependency.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  {dependency.title}
                  <TaskStatusBadge status={dependency.status} />
                </li>
              ))}
            </ul>
          )}
          {needsNote && (
            <Field invalid={!!noteError}>
              <FieldLabel htmlFor={ids.note}>{t(`tasks.move.${noteKind}`)}</FieldLabel>
              <Textarea
                id={ids.note}
                rows={3}
                placeholder={t(`tasks.move.${noteKind}Placeholder`)}
                {...form.register('note')}
              />
              <FieldError match={!!noteError}>
                {fieldError(noteError, t(`tasks.move.errors.${noteKind}`))}
              </FieldError>
            </Field>
          )}
          {optionalNote && (
            <Field invalid={!!noteError}>
              <FieldLabel htmlFor={ids.note}>{t('tasks.move.optionalNote')}</FieldLabel>
              <Textarea id={ids.note} rows={2} {...form.register('note')} />
              <FieldError match={!!noteError}>{t('tasks.move.errors.changes')}</FieldError>
            </Field>
          )}
          {asksContact && (
            <Field invalid={!!contactError}>
              <FieldLabel id={ids.contact} render={<span />}>
                {t(needsContact ? 'tasks.move.responder' : 'tasks.move.contact')}
              </FieldLabel>
              <Select
                items={contactItems}
                value={form.watch('contactId') ?? 'none'}
                onValueChange={(next) => {
                  form.setValue('contactId', !next || next === 'none' ? null : next);
                  form.clearErrors('contactId');
                }}
              >
                <SelectTrigger ref={contactTrigger} aria-labelledby={ids.contact}>
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
              {needsContact && client.isSuccess && contacts.length === 0 && (
                <FieldDescription>{t('tasks.move.noContacts')}</FieldDescription>
              )}
              <FieldError match={!!contactError}>{t('tasks.move.errors.contact')}</FieldError>
            </Field>
          )}
          {override && (
            <Field invalid={!!reasonError}>
              <FieldLabel htmlFor={ids.reason}>{t('tasks.move.overrideReason')}</FieldLabel>
              <Textarea id={ids.reason} rows={2} {...form.register('reason')} />
              <FieldError match={!!reasonError}>{t('tasks.move.errors.reason')}</FieldError>
            </Field>
          )}
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button
              type="submit"
              variant={move === 'cancel' ? 'destructive' : 'primary'}
              disabled={form.formState.isSubmitting}
            >
              {t(`tasks.moves.${move}`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The edit form's values for the task as saved. */
function editValues(task: TaskDetail): CreateTaskInput {
  const request = task.clientRequest;
  return {
    type: task.type,
    title: task.title,
    brief: task.brief ?? '',
    department: task.department,
    assigneeId: task.assignee?.id ?? null,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    clientId: task.client?.id ?? null,
    projectId: task.project?.id ?? null,
    milestoneId: task.milestone?.id ?? null,
    retainerCycleId: task.cycle?.id ?? null,
    cycleLineId: task.cycleLine?.id ?? null,
    needsClientApproval: task.needsClientApproval,
    revisionLimit: task.revisions.limit,
    ...(request && {
      requestedByContactId: request.contact?.id ?? null,
      requestedOn: request.requestedOn,
      requestScope: request.scope,
    }),
  };
}

/**
 * The task's own fields as one form: what, when, for which client and engagement. Only changed
 * fields are sent; the assignee and department have their own dialog.
 */
function EditTaskDialog({
  task,
  open,
  onClose,
  finalFocus,
}: {
  task: TaskDetail;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const update = useUpdateTask(task.id);
  const [failure, setFailure] = useState<string | null>(null);
  // The current client stays listed even when it has ended since (rule 7 keeps existing links).
  const clients = useClientOptions(
    task.client
      ? { id: task.client.id, name: task.client.name, status: 'ended', accountManagerId: '' }
      : null,
  );
  const request = task.clientRequest;
  const form = useForm<CreateTaskInput, unknown, CreateTask>({
    resolver: standardSchemaResolver(createTaskSchema),
    // Another person's save shows here; what the user typed is kept while the dialog is open.
    values: editValues(task),
    resetOptions: { keepDirtyValues: true },
  });
  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const dirty = form.formState.dirtyFields;
    const changes: UpdateTask = {
      ...(dirty.title && { title: values.title }),
      ...(dirty.brief && { brief: values.brief ?? null }),
      ...(dirty.priority && { priority: values.priority }),
      ...(dirty.dueDate && { dueDate: values.dueDate }),
      ...(dirty.dueTime && { dueTime: values.dueTime ?? null }),
      ...(dirty.clientId && { clientId: values.clientId }),
      ...(dirty.projectId && { projectId: values.projectId }),
      ...(dirty.milestoneId && { milestoneId: values.milestoneId }),
      ...(dirty.retainerCycleId && { retainerCycleId: values.retainerCycleId }),
      ...(dirty.cycleLineId && { cycleLineId: values.cycleLineId }),
      ...(dirty.needsClientApproval && { needsClientApproval: values.needsClientApproval }),
      ...(dirty.revisionLimit && { revisionLimit: values.revisionLimit }),
      ...(dirty.requestedByContactId && {
        requestedByContactId: values.requestedByContactId ?? null,
      }),
      ...(dirty.requestedOn && values.requestedOn && { requestedOn: values.requestedOn }),
      ...(dirty.requestScope && values.requestScope && { requestScope: values.requestScope }),
    };
    // Nothing changed: nothing to send, and nothing to announce.
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync(changes);
      toast.add({ title: t('tasks.edit.saved'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(taskFormFailure(form, t, error));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      // After the exit animation: unsaved edits are dropped (`keepDirtyValues` is not applied).
      onOpenChangeComplete={(next) => {
        if (next) return;
        form.reset(editValues(task), { keepDirtyValues: false });
        setFailure(null);
      }}
    >
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl" finalFocus={finalFocus}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('tasks.edit.title')}</DialogTitle>
          </DialogHeader>
          <TitleField form={form} />
          <BriefField form={form} />
          <PriorityField form={form} />
          <DueFields form={form} allowPast />
          {task.type === 'work' && <ClientField form={form} clients={clients} />}
          <EngagementFields
            form={form}
            current={{
              project: task.project,
              milestone: task.milestone,
              retainer: task.retainer,
              cycle: task.cycle,
              cycleLine: task.cycleLine,
            }}
          />
          <ApprovalFields form={form} />
          {request && (
            <ClientRequestFields
              form={form}
              scopeLocked={!task.permissions.canRecordClientResponse}
            />
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
  );
}

const UNASSIGNED = 'unassigned';

/**
 * Assign scope moves the task to someone else or another department (rule 6): leaving it
 * unassigned puts it in the department's queue.
 */
function ReassignDialog({
  task,
  open,
  onClose,
  finalFocus,
}: {
  task: TaskDetail;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const ids = { department: useId(), assignee: useId() };
  const update = useUpdateTask(task.id);
  const departments = useDepartments();
  const [department, setDepartment] = useState<DepartmentCode>(task.department);
  const [assigneeId, setAssigneeId] = useState<string>(task.assignee?.id ?? UNASSIGNED);
  const [failure, setFailure] = useState<string | null>(null);
  const members = useDepartmentMembers(department);
  const departmentItems = departments.map(({ code, name }) => ({ value: code, label: name }));
  const assigneeItems = [
    { value: UNASSIGNED, label: t('tasks.unassigned') },
    ...members.map((member) => ({ value: member.id, label: member.name })),
  ];

  async function save() {
    setFailure(null);
    const next = assigneeId === UNASSIGNED ? null : assigneeId;
    const parsed = updateTaskSchema.safeParse({
      ...(department !== task.department && { department }),
      ...(next !== (task.assignee?.id ?? null) && { assigneeId: next }),
    });
    if (!parsed.success) {
      setFailure(t('errors.generic'));
      return;
    }
    // Nothing changed: nothing to send.
    if (Object.keys(parsed.data).length === 0) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync(parsed.data);
      toast.add({ title: t('tasks.reassign.done'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      // After the exit animation, back to the task's current department and assignee.
      onOpenChangeComplete={(next) => {
        if (next) return;
        setDepartment(task.department);
        setAssigneeId(task.assignee?.id ?? UNASSIGNED);
        setFailure(null);
      }}
    >
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
        <div className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t('tasks.reassign.title')}</DialogTitle>
            <DialogDescription>{t('tasks.reassign.body')}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel id={ids.department} render={<span />}>
              {t('tasks.form.department')}
            </FieldLabel>
            <Select
              items={departmentItems}
              value={department}
              onValueChange={(value) => {
                if (!value) return;
                setDepartment(value as DepartmentCode);
                setAssigneeId(UNASSIGNED);
              }}
            >
              <SelectTrigger aria-labelledby={ids.department}>
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
          <Field>
            <FieldLabel id={ids.assignee} render={<span />}>
              {t('tasks.form.assignee')}
            </FieldLabel>
            <Select
              items={assigneeItems}
              value={assigneeId}
              onValueChange={(value) => setAssigneeId(value ?? UNASSIGNED)}
            >
              <SelectTrigger aria-labelledby={ids.assignee}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>
                  <span className="text-muted-foreground">{t('tasks.unassigned')}</span>
                </SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    <span className="flex items-center gap-2">
                      <Avatar name={member.name} size="sm" />
                      {member.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{t('tasks.reassign.hint')}</FieldDescription>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button disabled={update.isPending} onClick={save}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
