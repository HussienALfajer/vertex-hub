import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  billingNeedsNote,
  businessDate,
  type CreateExtraWork,
  type CreateExtraWorkInput,
  type Currency,
  createExtraWorkSchema,
  EXTRA_WORK_BILLING,
  type ExtraWork,
  type ExtraWorkBilling,
  type ExtraWorkBillingChange,
  extraWorkBillingChangeSchema,
  type UpdateExtraWork,
} from '@vertex-hub/contracts';
import {
  Badge,
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
  EmptyState,
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
  Skeleton,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  CalendarIcon,
  EllipsisIcon,
  PencilIcon,
  PlusIcon,
  ReceiptTextIcon,
  StickyNoteIcon,
  UserRoundIcon,
  UserRoundPenIcon,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { MoneyInput } from '../../components/money-input';
import { TabHeader } from '../../components/tab-header';
import { ApiError } from '../../lib/api/client';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { useReturnFocus } from '../../lib/use-return-focus';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { clientQuery } from '../clients/clients.queries';
import {
  type ExtraWorkParent,
  extraWorkQuery,
  useArchiveExtraWork,
  useChangeExtraWorkBilling,
  useCreateExtraWork,
  useUpdateExtraWork,
} from './extra-work.queries';

/** A project or retainer as its Extra work tab needs it; the page works out what the caller may do. */
export interface ExtraWorkOwner extends ExtraWorkParent {
  clientId: string;
  /** Logging and editing: an open project, an active or paused retainer (M3). */
  canLog: boolean;
  /** Billing stays open once the work is done, with money access (M3). */
  canBill: boolean;
  /** The currency to show amounts in; null without money access (M1). */
  currency: Currency | null;
  /** The currency of the estimate input; null when the caller may not set money fields. */
  editCurrency: Currency | null;
}

const billingTone = { unbilled: 'warning', billed: 'success', waived: 'neutral' } as const;

export function BillingBadge({ status }: { status: ExtraWorkBilling }) {
  const { t } = useTranslation();
  return (
    <Badge tone={billingTone[status]}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`projects.extraWork.billing.${status}`)}
    </Badge>
  );
}

/**
 * Out-of-scope work the client asked for, logged for separate billing (M3), on a project or a
 * retainer. Logging and editing need open work; billing stays open after it ends.
 */
export function ExtraWorkTab({ owner }: { owner: ExtraWorkOwner }) {
  const { t } = useTranslation();
  const items = useInfiniteQuery(extraWorkQuery(owner));
  const archive = useArchiveExtraWork(owner);
  const [logging, setLogging] = useState(false);
  const [archiving, setArchiving] = useState<{ item: ExtraWork; index: number } | null>(null);
  // The archived item stays named while the confirmation fades out.
  const shownArchiving = useShownWhileClosing(archiving);
  const { canLog, canBill, currency } = owner;
  // Only one "log" button shows at a time (header or empty state): the focus falls back to it
  // when the button that opened a dialog left with the change.
  const logButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const returnFocus = useReturnFocus(logButton);

  const all = items.data?.pages.flatMap((page) => page.items) ?? [];

  /** After an archive: the menu of the item now in its place, the one before, or "log". */
  function afterArchive() {
    const menus = list.current?.querySelectorAll<HTMLElement>('[data-focus="menu"]') ?? [];
    const index = shownArchiving?.index ?? 0;
    return menus[Math.min(index, menus.length - 1)] ?? returnFocus.target() ?? heading.current;
  }

  const logAction = canLog && (
    <Button
      ref={logButton}
      size={all.length > 0 ? 'sm' : undefined}
      onClick={(event) => {
        returnFocus.from(event.currentTarget);
        setLogging(true);
      }}
    >
      <PlusIcon />
      {t('projects.extraWork.log')}
    </Button>
  );

  return (
    <>
      <TabHeader
        title={t('projects.extraWork.title')}
        description={t('projects.extraWork.hint')}
        action={all.length > 0 && logAction}
        headingRef={heading}
      />
      {items.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : items.isError ? (
        <LoadError message={t('projects.extraWork.loadError')} onRetry={() => items.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState
          icon={<ReceiptTextIcon />}
          title={t('projects.extraWork.emptyTitle')}
          description={canLog ? t('projects.extraWork.emptyHint') : undefined}
          action={logAction}
        />
      ) : (
        <>
          {currency && !items.hasNextPage && <Ledger items={all} currency={currency} />}
          <ul ref={list} className="flex flex-col gap-3">
            {all.map((item, index) => (
              <ExtraWorkItem
                key={item.id}
                owner={owner}
                item={item}
                canEdit={canLog}
                canBill={canBill}
                onArchive={() => setArchiving({ item, index })}
              />
            ))}
          </ul>
          {items.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={items.isFetchingNextPage}
                onClick={() => items.fetchNextPage()}
              >
                {t('projects.extraWork.showOlder')}
              </Button>
            </div>
          )}
        </>
      )}
      {canLog && (
        <ExtraWorkDialog
          owner={owner}
          open={logging}
          onClose={() => setLogging(false)}
          finalFocus={() => returnFocus.target() ?? heading.current ?? true}
        />
      )}
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t('projects.extraWork.archiveTitle', { title: shownArchiving?.item.title ?? '' })}
        body={t('projects.extraWork.archiveBody')}
        action={t('projects.extraWork.archive')}
        destructive
        pending={archive.isPending}
        // Back to the menu that opened it, or the next item's once it is gone.
        finalFocus={() => afterArchive() ?? true}
        onConfirm={async () => {
          if (!archiving) return;
          await archive.mutateAsync(archiving.item.id);
          toast.add({ title: t('projects.extraWork.archived'), type: 'success' });
        }}
      />
    </>
  );
}

/** Estimates by billing status: what is still to bill, what was billed and what was waived. */
function Ledger({ items, currency }: { items: ExtraWork[]; currency: Currency }) {
  const { t } = useTranslation();
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {EXTRA_WORK_BILLING.map((status) => {
        const matching = items.filter((item) => item.billingStatus === status);
        const total = matching.reduce((sum, item) => sum + (item.money?.estimateMinor ?? 0), 0);
        return (
          <div
            key={status}
            className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4"
          >
            <dt className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
              <BillingBadge status={status} />
              <span>
                {t('projects.extraWork.items', {
                  count: matching.length,
                  n: formatNumber(matching.length),
                })}
              </span>
            </dt>
            <dd className="text-xl font-bold tabular-nums">{formatMoney(total, currency)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function ExtraWorkItem({
  owner,
  item,
  canEdit,
  canBill,
  onArchive,
}: {
  owner: ExtraWorkOwner;
  item: ExtraWork;
  canEdit: boolean;
  canBill: boolean;
  /** The confirmation lives in the tab: the item leaves with the archive. */
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<'edit' | 'billing' | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const estimate = item.money?.estimateMinor ?? null;
  // Billed work follows its invoice (F13 rule 25): void the invoice to change it.
  const canChangeBilling = canBill && item.billingStatus !== 'billed';

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-start">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <ReceiptTextIcon aria-hidden="true" className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{item.title}</h3>
          <BillingBadge status={item.billingStatus} />
        </div>
        {item.description && (
          <p className="text-sm whitespace-pre-line text-foreground">{item.description}</p>
        )}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CalendarIcon aria-hidden="true" className="size-4" />
            {t('projects.extraWork.requestedOn', { date: formatCalendarDate(item.requestedOn) })}
          </span>
          {item.contact && (
            <span className="flex items-center gap-1.5">
              <UserRoundIcon aria-hidden="true" className="size-4" />
              {t('projects.extraWork.requestedBy', { name: item.contact.name })}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <UserRoundPenIcon aria-hidden="true" className="size-4" />
            {t('projects.extraWork.loggedBy', { name: item.loggedBy.name })}
          </span>
        </p>
        {item.billingNote && (
          <p className="flex items-start gap-1.5 rounded-md bg-muted px-3 py-2 text-sm">
            <StickyNoteIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {item.billingNote}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
        {item.money && (
          <span className="flex flex-col sm:items-end">
            <span className="text-xs text-muted-foreground">
              {t('projects.extraWork.estimate')}
            </span>
            <span className="font-medium tabular-nums">
              {estimate === null ? t('common.none') : formatMoney(estimate, item.money.currency)}
            </span>
          </span>
        )}
        {(canEdit || canChangeBilling) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <IconButton
                  ref={menuButton}
                  data-focus="menu"
                  label={t('projects.extraWork.actions', { title: item.title })}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && (
                <DropdownMenuItem onClick={() => setDialog('edit')}>
                  <PencilIcon />
                  {t('common.edit')}
                </DropdownMenuItem>
              )}
              {canChangeBilling && (
                <DropdownMenuItem onClick={() => setDialog('billing')}>
                  <ReceiptTextIcon />
                  {t('projects.extraWork.changeBilling')}
                </DropdownMenuItem>
              )}
              {canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={onArchive}>
                    <ArchiveIcon />
                    {t('projects.extraWork.archive')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {canEdit && (
        <ExtraWorkDialog
          owner={owner}
          item={item}
          open={dialog === 'edit'}
          onClose={() => setDialog(null)}
          finalFocus={() => menuButton.current ?? true}
        />
      )}
      {canChangeBilling && (
        <BillingDialog
          owner={owner}
          item={item}
          open={dialog === 'billing'}
          onClose={() => setDialog(null)}
          finalFocus={() => menuButton.current ?? true}
        />
      )}
    </li>
  );
}

const NO_CONTACT = 'none';

/** Logs extra work, or edits it. The estimate is shown and sent only with money access (M1). */
function ExtraWorkDialog({
  owner,
  item,
  open,
  onClose,
  finalFocus,
}: {
  owner: ExtraWorkOwner;
  item?: ExtraWork;
  open: boolean;
  onClose: () => void;
  /** Where the focus goes when it closes: the button that opened it, or a fallback. */
  finalFocus: () => HTMLElement | true;
}) {
  const { t } = useTranslation();
  const ids = {
    title: useId(),
    description: useId(),
    date: useId(),
    contact: useId(),
    estimate: useId(),
  };
  const create = useCreateExtraWork(owner);
  const update = useUpdateExtraWork(owner);
  const client = useQuery({ ...clientQuery(owner.clientId), enabled: open });
  const money = owner.editCurrency;
  const today = businessDate();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CreateExtraWorkInput, unknown, CreateExtraWork>({
    resolver: standardSchemaResolver(createExtraWorkSchema),
    // A refetch keeps what the user already changed.
    resetOptions: { keepDirtyValues: true },
    values: {
      title: item?.title ?? '',
      description: item?.description ?? '',
      requestedOn: item?.requestedOn ?? today,
      requestedByContactId: item?.contact?.id ?? null,
      estimateMinor: item?.money?.estimateMinor ?? null,
    },
  });
  const errors = form.formState.errors;

  const contacts = client.data?.contacts ?? [];
  const contactItems = [
    { value: NO_CONTACT, label: t('projects.extraWork.noContact') },
    ...contacts.map((contact) => ({ value: contact.id, label: contact.name })),
  ];
  // A contact archived since keeps showing on the item it requested.
  if (item?.contact && !contacts.some((contact) => contact.id === item.contact?.id)) {
    contactItems.push({ value: item.contact.id, label: item.contact.name });
  }

  // After the exit animation, so the next opening starts afresh. A plain `reset()` would apply
  // `keepDirtyValues` and keep what was typed.
  function closed() {
    setFailure(null);
    form.reset(undefined, { keepDirtyValues: false });
  }

  const futureDate = () =>
    form.setError(
      'requestedOn',
      { type: SCREEN_ERROR, message: t('projects.extraWork.errors.futureDate') },
      { shouldFocus: true },
    );

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (values.requestedOn && values.requestedOn > today) return futureDate();
    const dirty = form.formState.dirtyFields;
    try {
      if (item) {
        const changes: UpdateExtraWork = {
          ...(dirty.title && { title: values.title }),
          ...(dirty.description && { description: values.description ?? null }),
          ...(dirty.requestedOn && values.requestedOn && { requestedOn: values.requestedOn }),
          ...(dirty.requestedByContactId && {
            requestedByContactId: values.requestedByContactId ?? null,
          }),
          ...(money && dirty.estimateMinor && { estimateMinor: values.estimateMinor ?? null }),
        };
        // Nothing changed: close without a request or a "saved" toast.
        if (Object.keys(changes).length === 0) return onClose();
        await update.mutateAsync({ itemId: item.id, ...changes });
        toast.add({ title: t('projects.extraWork.saved'), type: 'success' });
      } else {
        await create.mutateAsync(money ? values : { ...values, estimateMinor: undefined });
        toast.add({ title: t('projects.extraWork.logged'), type: 'success' });
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_DATES') {
        futureDate();
      } else if (error instanceof ApiError && error.code === 'UNKNOWN_CONTACT') {
        form.setError(
          'requestedByContactId',
          { type: SCREEN_ERROR, message: errorMessage(t, error) },
          { shouldFocus: true },
        );
      } else {
        setFailure(errorMessage(t, error));
      }
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
            <DialogTitle>
              {item ? t('projects.extraWork.editTitle') : t('projects.extraWork.logTitle')}
            </DialogTitle>
            {!item && <DialogDescription>{t('projects.extraWork.logHint')}</DialogDescription>}
          </DialogHeader>
          <Field invalid={!!errors.title}>
            <FieldLabel htmlFor={ids.title}>{t('projects.extraWork.fields.title')}</FieldLabel>
            <Input
              id={ids.title}
              autoComplete="off"
              placeholder={t('projects.extraWork.fields.titlePlaceholder')}
              {...form.register('title')}
            />
            <FieldError match={!!errors.title}>{t('projects.extraWork.errors.title')}</FieldError>
          </Field>
          <Field invalid={!!errors.description}>
            <FieldLabel htmlFor={ids.description}>
              {t('projects.extraWork.fields.description')}
              <span className="ms-1 font-normal text-muted-foreground">
                ({t('common.optional')})
              </span>
            </FieldLabel>
            <Textarea id={ids.description} rows={3} {...form.register('description')} />
            <FieldError match={!!errors.description}>
              {t('projects.extraWork.errors.description')}
            </FieldError>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field invalid={!!errors.requestedOn}>
              <FieldLabel htmlFor={ids.date}>
                {t('projects.extraWork.fields.requestedOn')}
              </FieldLabel>
              <Input
                id={ids.date}
                type="date"
                dir="ltr"
                max={today}
                {...form.register('requestedOn')}
              />
              <FieldError match={!!errors.requestedOn} role={errorRole(errors.requestedOn)}>
                {fieldError(errors.requestedOn, t('projects.form.errors.date'))}
              </FieldError>
            </Field>
            <Field invalid={!!errors.requestedByContactId}>
              <FieldLabel id={ids.contact} render={<span />}>
                {t('projects.extraWork.fields.contact')}
              </FieldLabel>
              <Controller
                control={form.control}
                name="requestedByContactId"
                render={({ field }) => (
                  <Select
                    items={contactItems}
                    value={field.value ?? NO_CONTACT}
                    onValueChange={(value) =>
                      field.onChange(!value || value === NO_CONTACT ? null : value)
                    }
                  >
                    <SelectTrigger
                      aria-labelledby={ids.contact}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {contactItems.map((contact) => (
                        <SelectItem key={contact.value} value={contact.value}>
                          {contact.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError
                match={!!errors.requestedByContactId}
                role={errorRole(errors.requestedByContactId)}
              >
                {fieldError(errors.requestedByContactId, t('errors.UNKNOWN_CONTACT'))}
              </FieldError>
            </Field>
          </div>
          {money && (
            <Field>
              <FieldLabel htmlFor={ids.estimate}>
                {t('projects.extraWork.estimate')}
                <span className="ms-1 font-normal text-muted-foreground">
                  ({t('common.optional')})
                </span>
              </FieldLabel>
              <Controller
                control={form.control}
                name="estimateMinor"
                render={({ field }) => (
                  <MoneyInput
                    id={ids.estimate}
                    currency={money}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
              <FieldDescription>{t('projects.extraWork.estimateHint')}</FieldDescription>
            </Field>
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

/** What a person sets by hand; issuing its invoice bills the work (F13 rule 25). */
const HAND_BILLING = ['unbilled', 'waived'] as const satisfies readonly ExtraWorkBilling[];

/** Marks an item waived (with why) or back to unbilled (M3); never billed (F13 rule 25). */
function BillingDialog({
  owner,
  item,
  open,
  onClose,
  finalFocus,
}: {
  owner: ExtraWorkOwner;
  item: ExtraWork;
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | true;
}) {
  const { t } = useTranslation();
  const ids = { status: useId(), note: useId() };
  const change = useChangeExtraWorkBilling(owner);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<ExtraWorkBillingChange>({
    resolver: standardSchemaResolver(extraWorkBillingChangeSchema),
    // A refetch keeps what the user already changed.
    resetOptions: { keepDirtyValues: true },
    values: { billingStatus: item.billingStatus, billingNote: item.billingNote ?? '' },
  });
  const status = form.watch('billingStatus');
  const { errors, isDirty } = form.formState;
  const noteError = errors.billingNote;

  // After the exit animation, so the next opening starts from the saved status. A plain
  // `reset()` would apply `keepDirtyValues` and keep what was typed.
  function closed() {
    setFailure(null);
    form.reset(undefined, { keepDirtyValues: false });
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (billingNeedsNote(values.billingStatus) && !values.billingNote) {
      form.setError(
        'billingNote',
        { type: SCREEN_ERROR, message: t('errors.BILLING_NOTE_REQUIRED') },
        { shouldFocus: true },
      );
      return;
    }
    // Nothing changed: close without a request or a "saved" toast.
    if (!isDirty) return onClose();
    try {
      await change.mutateAsync({ itemId: item.id, ...values });
      toast.add({ title: t('projects.extraWork.billingSaved'), type: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'BILLING_NOTE_REQUIRED') {
        form.setError(
          'billingNote',
          { type: SCREEN_ERROR, message: errorMessage(t, error) },
          { shouldFocus: true },
        );
      } else {
        setFailure(errorMessage(t, error));
      }
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
            <DialogTitle>{t('projects.extraWork.billingTitle', { title: item.title })}</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel id={ids.status} render={<span />}>
              {t('projects.extraWork.fields.billing')}
            </FieldLabel>
            <Controller
              control={form.control}
              name="billingStatus"
              render={({ field }) => (
                <ToggleGroup
                  aria-labelledby={ids.status}
                  value={[field.value]}
                  onValueChange={(next: ExtraWorkBilling[]) => next[0] && field.onChange(next[0])}
                >
                  {HAND_BILLING.map((value) => (
                    <ToggleGroupItem key={value} value={value}>
                      {t(`projects.extraWork.billing.${value}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
            />
          </Field>
          <Field invalid={!!noteError}>
            <FieldLabel htmlFor={ids.note}>
              {t('projects.extraWork.fields.billingNote')}
              {!billingNeedsNote(status) && (
                <span className="ms-1 font-normal text-muted-foreground">
                  ({t('common.optional')})
                </span>
              )}
            </FieldLabel>
            <Textarea id={ids.note} rows={2} {...form.register('billingNote')} />
            <FieldDescription>{t(`projects.extraWork.noteHint.${status}`)}</FieldDescription>
            <FieldError match={!!noteError} role={errorRole(noteError)}>
              {fieldError(noteError, t('projects.extraWork.errors.billingNote'))}
            </FieldError>
          </Field>
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
