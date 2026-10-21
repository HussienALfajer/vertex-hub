import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  BALANCE_LEAVE_TYPES,
  type BalanceLeaveType,
  businessDate,
  type CreateHrRequest,
  createHrRequestSchema,
  createLeaveAdjustmentSchema,
  HR_REQUEST_KINDS,
  HR_REQUEST_LIMITS,
  type HrRequestDetail,
  type HrRequestKind,
  type HrRequestPreview,
  LEAVE_HALVES,
  LEAVE_TYPES,
  type LeaveHalf,
  type LeaveType,
} from '@vertex-hub/contracts';
import {
  Callout,
  Checkbox,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import { CalendarCheckIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { type ComponentProps, useId, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { useDebouncedValue } from '../../lib/use-search-text';
import { ChoiceSelect } from '../quotes/choice-select';
import { FormDialog } from '../quotes/quote-dialogs';
import { checked } from './employee-dialogs';
import {
  hrRequestPreviewQuery,
  useAdjustLeaveBalance,
  useCancelHrRequest,
  useCreateHrRequest,
  useDecideHrRequest,
} from './hr.queries';

type FinalFocus = ComponentProps<typeof FormDialog>['finalFocus'];

const WHOLE = 'whole';

/** Stands in for a reason not typed yet, in the request the preview sends. */
const PREVIEW_REASON = '…';

interface RequestValues {
  kind: HrRequestKind;
  leaveType: LeaveType;
  startsOn: string;
  endsOn: string;
  half: LeaveHalf | typeof WHOLE;
  date: string;
  fromTime: string;
  toTime: string;
  reason: string;
}

function requestDefaults(): RequestValues {
  const today = businessDate();
  return {
    kind: 'leave',
    leaveType: 'annual',
    startsOn: today,
    endsOn: today,
    half: WHOLE,
    date: today,
    fromTime: '',
    toTime: '',
    reason: '',
  };
}

/** The request the values describe, in the shape the API takes. */
function requestInput(values: RequestValues, userId: string | undefined) {
  const reason = values.reason.trim() || null;
  return values.kind === 'permission'
    ? {
        kind: 'permission' as const,
        userId,
        date: values.date,
        fromTime: values.fromTime,
        toTime: values.toTime,
        reason,
      }
    : {
        kind: 'leave' as const,
        userId,
        leaveType: values.leaveType,
        startsOn: values.startsOn,
        endsOn: values.endsOn,
        half: values.startsOn === values.endsOn && values.half !== WHOLE ? values.half : null,
        reason,
      };
}

/**
 * A new leave or permission (spec screen "My attendance", Requests): its preview (days, the paid
 * and unpaid split, short notice, the certificate) before it is submitted. With `forUser`,
 * `hr.approve` records it for that employee, approved at once (rule B8). A sick leave that needs
 * a certificate opens its page after submitting, where the certificate is attached (rule B13).
 */
export function NewRequestDialog({
  open,
  onClose,
  finalFocus,
  forUser,
}: {
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
  forUser?: { id: string; name: string };
}) {
  const { t } = useTranslation();
  const ids = { kind: useId(), half: useId() };
  const navigate = useNavigate();
  const create = useCreateHrRequest();
  const form = useForm<RequestValues>({ defaultValues: requestDefaults() });
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;
  const values = useWatch({ control: form.control }) as RequestValues;
  // The preview asks once the values stop changing, and only for days and times the schema
  // takes: the reason changes nothing it shows, so a missing one does not hold it back.
  const parsed = createHrRequestSchema.safeParse(
    requestInput({ ...values, reason: values.reason.trim() || PREVIEW_REASON }, forUser?.id),
  );
  const settled = useDebouncedValue(open && parsed.success ? JSON.stringify(parsed.data) : '');
  const preview = useQuery(
    hrRequestPreviewQuery(settled ? (JSON.parse(settled) as CreateHrRequest) : null),
  );
  const leave = values.kind === 'leave';
  const singleDay = values.startsOn === values.endsOn;
  const reasonRequired = !leave || values.leaveType !== 'annual';

  const submit = form.handleSubmit(async (current) => {
    setFailure(null);
    const input = checked(
      form,
      createHrRequestSchema.safeParse(requestInput(current, forUser?.id)),
    );
    if (!input) return;
    try {
      const created = await create.mutateAsync(input);
      onClose();
      if (created.certificateRequired && created.documents === 0) {
        toast.add({ title: t('hr.requests.new.attachCertificate'), type: 'success' });
        await navigate({
          to: '/hr/requests/$requestId',
          params: { requestId: created.id },
          search: { from: forUser ? 'file' : 'mine' },
        });
        return;
      }
      toast.add({
        title:
          created.status === 'approved'
            ? t('hr.requests.new.recorded')
            : t('hr.requests.new.submitted'),
        type: 'success',
      });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  const kindItems = HR_REQUEST_KINDS.map((kind) => ({
    value: kind,
    label: t(`hr.requests.kinds.${kind}`),
  }));
  const typeItems = LEAVE_TYPES.map((type) => ({ value: type, label: t(`hr.leaveTypes.${type}`) }));
  const halfItems = ([WHOLE, ...LEAVE_HALVES] as const).map((half) => ({
    value: half,
    label: t(`hr.requests.halves.${half}`),
  }));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset(requestDefaults());
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={
        forUser
          ? t('hr.requests.new.recordTitle', { name: forUser.name })
          : t('hr.requests.new.title')
      }
      description={forUser ? t('hr.requests.new.recordHint') : t('hr.requests.new.hint')}
      action={forUser ? t('hr.requests.new.record') : t('hr.requests.new.submit')}
      failure={failure}
      onSubmit={submit}
    >
      <Controller
        control={form.control}
        name="kind"
        render={({ field }) => (
          <Field>
            <FieldLabel id={ids.kind} render={<span />}>
              {t('hr.requests.fields.kind')}
            </FieldLabel>
            <ToggleGroup
              aria-labelledby={ids.kind}
              value={[field.value]}
              onValueChange={(next: HrRequestKind[]) => next[0] && field.onChange(next[0])}
            >
              {kindItems.map((item) => (
                <ToggleGroupItem key={item.value} value={item.value}>
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        )}
      />

      {leave ? (
        <>
          <Controller
            control={form.control}
            name="leaveType"
            render={({ field }) => (
              <Field>
                <FieldLabel>{t('hr.requests.fields.leaveType')}</FieldLabel>
                <ChoiceSelect
                  label={t('hr.requests.fields.leaveType')}
                  items={typeItems}
                  value={field.value}
                  onChange={(next) => field.onChange(next as LeaveType)}
                />
                <FieldDescription>{t(`hr.requests.typeHints.${field.value}`)}</FieldDescription>
              </Field>
            )}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field invalid={!!errors.startsOn}>
              <FieldLabel>{t('hr.requests.fields.startsOn')}</FieldLabel>
              <Input
                type="date"
                dir="ltr"
                {...form.register('startsOn', {
                  onChange: (event: { target: { value: string } }) => {
                    // A leave moved past its end becomes a single day from the new start.
                    if (form.getValues('endsOn') < event.target.value) {
                      form.setValue('endsOn', event.target.value);
                    }
                  },
                })}
              />
              <FieldError match={!!errors.startsOn}>{t('hr.requests.errors.date')}</FieldError>
            </Field>
            <Field invalid={!!errors.endsOn}>
              <FieldLabel>{t('hr.requests.fields.endsOn')}</FieldLabel>
              <Input type="date" dir="ltr" min={values.startsOn} {...form.register('endsOn')} />
              <FieldError match={!!errors.endsOn}>{t('hr.requests.errors.endsOn')}</FieldError>
            </Field>
          </div>
          {singleDay && (
            <Controller
              control={form.control}
              name="half"
              render={({ field }) => (
                <Field>
                  <FieldLabel id={ids.half} render={<span />}>
                    {t('hr.requests.fields.half')}
                  </FieldLabel>
                  <ToggleGroup
                    aria-labelledby={ids.half}
                    value={[field.value]}
                    onValueChange={(next: RequestValues['half'][]) =>
                      next[0] && field.onChange(next[0])
                    }
                    className="flex-wrap"
                  >
                    {halfItems.map((item) => (
                      <ToggleGroupItem key={item.value} value={item.value}>
                        {item.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
              )}
            />
          )}
        </>
      ) : (
        <div className="grid gap-5 sm:grid-cols-3">
          <Field invalid={!!errors.date}>
            <FieldLabel>{t('hr.requests.fields.date')}</FieldLabel>
            <Input type="date" dir="ltr" {...form.register('date')} />
            <FieldError match={!!errors.date}>{t('hr.requests.errors.date')}</FieldError>
          </Field>
          <Field invalid={!!errors.fromTime}>
            <FieldLabel>{t('hr.requests.fields.fromTime')}</FieldLabel>
            <Input type="time" dir="ltr" {...form.register('fromTime')} />
            <FieldError match={!!errors.fromTime}>{t('hr.requests.errors.time')}</FieldError>
          </Field>
          <Field invalid={!!errors.toTime}>
            <FieldLabel>{t('hr.requests.fields.toTime')}</FieldLabel>
            <Input type="time" dir="ltr" {...form.register('toTime')} />
            <FieldError match={!!errors.toTime}>{t('hr.requests.errors.toTime')}</FieldError>
          </Field>
        </div>
      )}

      <Field invalid={!!errors.reason}>
        <FieldLabel>
          {reasonRequired ? t('hr.requests.fields.reason') : t('hr.requests.fields.reasonOptional')}
        </FieldLabel>
        <Textarea rows={2} maxLength={HR_REQUEST_LIMITS.reason} {...form.register('reason')} />
        {!leave && <FieldDescription>{t('hr.requests.permissionHint')}</FieldDescription>}
        <FieldError match={!!errors.reason}>{t('hr.requests.errors.reason')}</FieldError>
      </Field>

      {parsed.success && (
        <RequestPreview
          loading={preview.isPending || preview.isFetching}
          error={preview.isError ? preview.error : null}
          data={preview.data}
          leave={leave}
        />
      )}
    </FormDialog>
  );
}

/** Rules B9, B12, B13: what the request would be, or why the API would refuse it. */
function RequestPreview({
  loading,
  error,
  data,
  leave,
}: {
  loading: boolean;
  error: unknown;
  data: HrRequestPreview | undefined;
  leave: boolean;
}) {
  const { t } = useTranslation();
  if (error) {
    return (
      <Callout
        tone="danger"
        icon={<TriangleAlertIcon />}
        title={t('hr.requests.preview.refused')}
        description={errorMessage(t, error)}
        role="status"
      />
    );
  }
  if (!data) return <Skeleton className="h-16" />;
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border bg-muted p-3"
      aria-busy={loading}
      data-testid="request-preview"
    >
      {leave && data.days !== null && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <CalendarCheckIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            {t('hr.requests.days', { count: data.days, days: formatNumber(data.days) })}
          </span>
          {(data.unpaidDays ?? 0) > 0 && (
            <span className="text-muted-foreground">
              {t('hr.requests.preview.split', {
                paid: formatNumber(data.paidDays ?? 0),
                unpaid: formatNumber(data.unpaidDays ?? 0),
              })}
            </span>
          )}
        </div>
      )}
      {data.warnings.map((warning) => (
        <Callout
          key={warning}
          tone={warning === 'certificate_required' ? 'info' : 'warning'}
          icon={<InfoIcon />}
          title={t(`hr.requests.warnings.${warning}`)}
        />
      ))}
      {data.warnings.length === 0 && !leave && (
        <p className="text-sm text-muted-foreground">{t('hr.requests.preview.permissionOk')}</p>
      )}
    </div>
  );
}

interface AdjustmentValues {
  entry: 'adjustment' | 'opening';
  leaveType: BalanceLeaveType;
  days: string;
  note: string;
}

/** Rules B6 and B7: `hr.approve` records an opening balance or a signed adjustment. */
export function AdjustmentDialog({
  userId,
  year,
  open,
  onClose,
  finalFocus,
}: {
  userId: string;
  year: number;
  open: boolean;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const ids = { entry: useId() };
  const adjust = useAdjustLeaveBalance(userId);
  const defaults: AdjustmentValues = {
    entry: 'adjustment',
    leaveType: 'annual',
    days: '',
    note: '',
  };
  const form = useForm<AdjustmentValues>({ defaultValues: defaults });
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const input = checked(
      form,
      createLeaveAdjustmentSchema.safeParse({
        ...values,
        year,
        days: values.days.trim() === '' ? Number.NaN : Number(values.days),
      }),
    );
    if (!input) return;
    try {
      await adjust.mutateAsync(input);
      toast.add({ title: t('hr.balances.adjusted'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={t('hr.balances.adjustTitle', { year: formatNumber(year, { useGrouping: false }) })}
      description={t('hr.balances.adjustHint')}
      action={t('common.save')}
      failure={failure}
      onSubmit={submit}
    >
      <Controller
        control={form.control}
        name="entry"
        render={({ field }) => (
          <Field>
            <FieldLabel id={ids.entry} render={<span />}>
              {t('hr.balances.fields.entry')}
            </FieldLabel>
            <ToggleGroup
              aria-labelledby={ids.entry}
              value={[field.value]}
              onValueChange={(next: AdjustmentValues['entry'][]) =>
                next[0] && field.onChange(next[0])
              }
            >
              <ToggleGroupItem value="adjustment">
                {t('hr.balances.entries.adjustment')}
              </ToggleGroupItem>
              <ToggleGroupItem value="opening">{t('hr.balances.entries.opening')}</ToggleGroupItem>
            </ToggleGroup>
          </Field>
        )}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="leaveType"
          render={({ field }) => (
            <Field>
              <FieldLabel>{t('hr.balances.fields.leaveType')}</FieldLabel>
              <ChoiceSelect
                label={t('hr.balances.fields.leaveType')}
                items={BALANCE_LEAVE_TYPES.map((type) => ({
                  value: type,
                  label: t(`hr.leaveTypes.${type}`),
                }))}
                value={field.value}
                onChange={(next) => field.onChange(next as BalanceLeaveType)}
              />
            </Field>
          )}
        />
        <Field invalid={!!errors.days}>
          <FieldLabel>{t('hr.balances.fields.days')}</FieldLabel>
          <Input dir="ltr" inputMode="decimal" autoComplete="off" {...form.register('days')} />
          <FieldDescription>{t('hr.balances.fields.daysHint')}</FieldDescription>
          <FieldError match={!!errors.days}>{t('hr.balances.errors.days')}</FieldError>
        </Field>
      </div>
      <Field invalid={!!errors.note}>
        <FieldLabel>{t('hr.balances.fields.note')}</FieldLabel>
        <Textarea rows={2} maxLength={HR_REQUEST_LIMITS.note} {...form.register('note')} />
        <FieldError match={!!errors.note}>{t('hr.balances.errors.note')}</FieldError>
      </Field>
    </FormDialog>
  );
}

/**
 * Rule B14: approve or reject a pending request, a note required to reject. A sick leave without
 * its certificate asks to approve anyway (rule B13).
 */
export function DecisionDialog({
  request,
  decision,
  onClose,
  finalFocus,
}: {
  request: HrRequestDetail;
  decision: 'approve' | 'reject' | null;
  onClose: () => void;
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const decide = useDecideHrRequest(request.id);
  const confirmId = useId();
  const [note, setNote] = useState('');
  const [noteMissing, setNoteMissing] = useState(false);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const [withoutCertificate, setWithoutCertificate] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const certificateMissing = request.certificateRequired && request.documents === 0;
  const reject = decision === 'reject';

  async function submit() {
    setFailure(null);
    if (reject && !note.trim()) {
      setNoteMissing(true);
      noteField.current?.focus();
      return;
    }
    try {
      await decide.mutateAsync({
        decision: decision ?? 'approve',
        note: note.trim() || null,
        confirmMissingCertificate: withoutCertificate,
      });
      toast.add({
        title: reject ? t('hr.requests.decide.rejected') : t('hr.requests.decide.approved'),
        type: 'success',
      });
      onClose();
    } catch (error) {
      setFailure(
        error instanceof ApiError && error.code === 'CERTIFICATE_MISSING'
          ? t('hr.requests.decide.confirmCertificate')
          : errorMessage(t, error),
      );
    }
  }

  return (
    <FormDialog
      open={decision !== null}
      onClose={onClose}
      onClosed={() => {
        setNote('');
        setNoteMissing(false);
        setWithoutCertificate(false);
        setFailure(null);
      }}
      finalFocus={finalFocus}
      submitting={decide.isPending}
      title={reject ? t('hr.requests.decide.rejectTitle') : t('hr.requests.decide.approveTitle')}
      description={
        reject
          ? t('hr.requests.decide.rejectHint', { name: request.user.name })
          : t('hr.requests.decide.approveHint', { name: request.user.name })
      }
      action={reject ? t('hr.requests.decide.reject') : t('hr.requests.decide.approve')}
      failure={failure}
      onSubmit={async (event) => {
        event?.preventDefault();
        await submit();
      }}
    >
      <Field invalid={noteMissing}>
        <FieldLabel>
          {reject ? t('hr.requests.decide.note') : t('hr.requests.decide.noteOptional')}
        </FieldLabel>
        <Textarea
          ref={noteField}
          rows={3}
          maxLength={HR_REQUEST_LIMITS.note}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setNoteMissing(false);
          }}
        />
        <FieldError match={noteMissing}>{t('hr.requests.decide.noteRequired')}</FieldError>
      </Field>
      {!reject && certificateMissing && (
        <label htmlFor={confirmId} className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox
            id={confirmId}
            checked={withoutCertificate}
            onCheckedChange={(next) => setWithoutCertificate(next === true)}
          />
          {t('hr.requests.decide.withoutCertificate')}
        </label>
      )}
    </FormDialog>
  );
}

/** Rule B15: the employee cancels before the leave starts; `hr.approve` at any time. */
export function CancelRequestDialog({
  request,
  open,
  onClose,
  finalFocus,
}: {
  request: HrRequestDetail;
  open: boolean;
  onClose: () => void;
  finalFocus: ComponentProps<typeof ConfirmDialog>['finalFocus'];
}) {
  const { t } = useTranslation();
  const cancel = useCancelHrRequest(request.id);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t('hr.requests.cancel.title')}
      body={
        request.status === 'approved'
          ? t('hr.requests.cancel.approvedBody')
          : t('hr.requests.cancel.body')
      }
      action={t('hr.requests.cancel.action')}
      destructive
      pending={cancel.isPending}
      onConfirm={async () => {
        await cancel.mutateAsync({ note: null });
        toast.add({ title: t('hr.requests.cancel.done'), type: 'success' });
      }}
      finalFocus={finalFocus}
    />
  );
}
