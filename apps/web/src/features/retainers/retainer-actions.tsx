import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  businessDate,
  type CreateRetainer,
  type CreateRetainerInput,
  createRetainerSchema,
  RETAINER_LIMITS,
  type RetainerDetail,
  type RetainerStatus,
  type UpdateRetainer,
} from '@vertex-hub/contracts';
import {
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
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  CircleStopIcon,
  EllipsisIcon,
  ListChecksIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import {
  checkDuplicateLines,
  checkRenewal,
  DatesFields,
  DeliverablesEditor,
  type DeliverablesFormValues,
  DepartmentsField,
  MoneyFields,
  NameField,
  parseLines,
  retainerFormFailure,
} from './retainer-form';
import {
  useArchiveRetainer,
  useChangeRetainerStatus,
  useUpdateDeliverables,
  useUpdateRetainer,
} from './retainers.queries';

/**
 * The header's actions: edit, edit lines, the status change that fits (pause or resume, end, or
 * reactivate), and archive. Only what the caller may do is offered; the API enforces it (R12).
 */
export function RetainerActions({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const { permissions, status } = retainer;
  const change = useChangeRetainerStatus(retainer.id);
  const [dialog, setDialog] = useState<'end' | 'reactivate' | 'archive' | null>(null);

  if (retainer.archivedAt !== null) return null;
  const manage = permissions.canManage;
  const menu = manage || permissions.canArchive;

  async function move(to: RetainerStatus) {
    try {
      await change.mutateAsync({ status: to });
      toast.add({ title: t(`retainers.actions.done.${to}`), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {manage && <EditRetainer retainer={retainer} />}
      {manage && <EditLines retainer={retainer} />}
      {manage && status === 'paused' && (
        <Button disabled={change.isPending} onClick={() => move('active')}>
          <PlayIcon />
          {t('retainers.actions.resume')}
        </Button>
      )}
      {permissions.canReactivate && (
        <Button onClick={() => setDialog('reactivate')}>
          <RotateCcwIcon />
          {t('retainers.actions.reactivate')}
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
            {manage && status === 'active' && (
              <DropdownMenuItem onClick={() => move('paused')}>
                <PauseIcon />
                {t('retainers.actions.pause')}
              </DropdownMenuItem>
            )}
            {manage && (
              <DropdownMenuItem variant="destructive" onClick={() => setDialog('end')}>
                <CircleStopIcon />
                {t('retainers.actions.end')}
              </DropdownMenuItem>
            )}
            {permissions.canArchive && (
              <>
                {manage && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={() => setDialog('archive')}>
                  <ArchiveIcon />
                  {t('retainers.actions.archive')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ConfirmDialog
        open={dialog === 'end'}
        onClose={() => setDialog(null)}
        title={t('retainers.end.title', { name: retainer.name })}
        body={t('retainers.end.body')}
        action={t('retainers.actions.end')}
        destructive
        pending={change.isPending}
        onConfirm={async () => {
          await change.mutateAsync({ status: 'ended' });
          toast.add({ title: t('retainers.actions.done.ended'), type: 'success' });
        }}
      />
      <ConfirmDialog
        open={dialog === 'reactivate'}
        onClose={() => setDialog(null)}
        title={t('retainers.reactivate.title', { name: retainer.name })}
        body={t('retainers.reactivate.body')}
        action={t('retainers.actions.reactivate')}
        pending={change.isPending}
        onConfirm={async () => {
          await change.mutateAsync({ status: 'active' });
          toast.add({ title: t('retainers.actions.done.reactivated'), type: 'success' });
        }}
      />
      <ArchiveDialog
        retainer={retainer}
        open={dialog === 'archive'}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

function ArchiveDialog({
  retainer,
  open,
  onClose,
}: {
  retainer: RetainerDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const archive = useArchiveRetainer(retainer.id);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t('retainers.archive.title', { name: retainer.name })}
      body={t('retainers.archive.body')}
      action={t('retainers.actions.archive')}
      destructive
      pending={archive.isPending}
      onConfirm={async () => {
        await archive.mutateAsync(undefined);
        toast.add({ title: t('retainers.archive.done'), type: 'success' });
      }}
    />
  );
}

/**
 * The retainer's basics as one form: name, departments, dates and, with money access, the
 * currency and monthly fee. The start date is fixed once the first cycle opened (R3); only
 * changed fields are sent.
 */
function EditRetainer({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const update = useUpdateRetainer(retainer.id);
  const { canEditMoney } = retainer.permissions;
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // A retainer that started has a cycle: it opens on the start date (R2, R3).
  const started = retainer.startDate <= businessDate();
  const form = useForm<CreateRetainerInput, unknown, CreateRetainer>({
    resolver: standardSchemaResolver(createRetainerSchema),
    // A refetch keeps what the user already changed.
    resetOptions: { keepDirtyValues: true },
    values: {
      clientId: retainer.client.id,
      name: retainer.name,
      departments: retainer.departments,
      startDate: retainer.startDate,
      renewalDate: retainer.renewalDate,
      currency: retainer.money?.currency ?? 'USD',
      monthlyFeeMinor: retainer.money?.monthlyFeeMinor ?? null,
      deliverables: [],
    },
  });

  function close() {
    setOpen(false);
    setFailure(null);
    form.reset();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (!checkRenewal(form, t, values.startDate, values.renewalDate)) return;
    const dirty = form.formState.dirtyFields;
    const changes: UpdateRetainer = {
      ...(dirty.name && { name: values.name }),
      ...(dirty.departments && { departments: values.departments }),
      ...(!started && dirty.startDate && { startDate: values.startDate }),
      ...(dirty.renewalDate && { renewalDate: values.renewalDate ?? null }),
      ...(canEditMoney && dirty.currency && { currency: values.currency }),
      ...(canEditMoney &&
        dirty.monthlyFeeMinor && { monthlyFeeMinor: values.monthlyFeeMinor ?? null }),
    };
    try {
      if (Object.keys(changes).length > 0) await update.mutateAsync(changes);
      toast.add({ title: t('projects.edit.saved'), type: 'success' });
      close();
    } catch (error) {
      setFailure(retainerFormFailure(form, t, error));
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
              <DialogTitle>{t('retainers.edit.title')}</DialogTitle>
            </DialogHeader>
            <NameField form={form} />
            <DepartmentsField form={form} />
            <DatesFields form={form} startLocked={started} />
            {canEditMoney && (
              <MoneyFields
                form={form}
                currencyLocked={(retainer.money?.monthlyFeeMinor ?? null) !== null}
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
    </>
  );
}

/** The retainer's standing lines. Changes apply from the next cycle (R10). */
function EditLines({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const update = useUpdateDeliverables(retainer.id);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<DeliverablesFormValues>({
    // A refetch keeps what the user already changed.
    resetOptions: { keepDirtyValues: true },
    values: {
      // The revision limit has no column yet (F04 PR 6) but is kept, not cleared, on save.
      deliverables: retainer.deliverables.map(
        ({ id, kind, label, monthlyQuantity, revisionLimit }) => ({
          id,
          kind,
          label,
          monthlyQuantity,
          revisionLimit,
        }),
      ),
    },
  });

  function close() {
    setOpen(false);
    setFailure(null);
    form.reset();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const lines = parseLines(form, values.deliverables, () =>
      setFailure(
        t('retainers.lines.errors.invalid', {
          max: formatNumber(RETAINER_LIMITS.deliverables),
        }),
      ),
    );
    if (!lines || !checkDuplicateLines(form, t, lines)) return;
    try {
      await update.mutateAsync({ lines });
      toast.add({ title: t('retainers.lines.saved'), type: 'success' });
      close();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DUPLICATE_DELIVERABLE') {
        checkDuplicateLines(form, t, lines);
      }
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ListChecksIcon />
        {t('retainers.actions.editLines')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent closeLabel={t('common.close')} className="max-w-3xl">
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{t('retainers.lines.editTitle')}</DialogTitle>
              <DialogDescription>{t('retainers.lines.editHint')}</DialogDescription>
            </DialogHeader>
            <DeliverablesEditor form={form} />
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
