import {
  type AmendmentEffect,
  type AmendmentPreview,
  type AmendmentScope,
  addMonths,
  businessDate,
  type CalendarDate,
  type CreateAmendment,
  type Currency,
  DELIVERABLE_KINDS,
  type DeliverableKind,
  type DeliverableLine,
  deliverableKey,
  firstOfMonth,
  RETAINER_LIMITS,
  type RetainerDetail,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  Skeleton,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import { FilePenLineIcon, MinusIcon, PlusIcon, ShieldAlertIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { MoneyInput } from '../../components/money-input';
import { errorMessage } from '../../lib/errors';
import { formatMonth, formatNumber, isolateLtr } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { DeliverableIcon, lineName } from './retainer-badges';
import { useCreateAmendment, usePreviewAmendment } from './retainers.queries';

/** A line change being filled in: an existing line's delta, or a new line. */
interface LineDraft {
  kind: DeliverableKind;
  label: string;
  delta: number;
  /** A line the retainer does not have yet. */
  added: boolean;
}

type Direction = 'increase' | 'decrease';

const PREVIEW_DELAY_MS = 400;

/** The months an amendment may take effect in: this month and the next two years (A1). */
function effectiveMonths(): CalendarDate[] {
  const first = firstOfMonth(businessDate());
  return Array.from({ length: 25 }, (_, index) => addMonths(first, index));
}

/**
 * F05B screen 3, "New amendment": one month or onward, line changes, an amount change per month
 * and a reason, with a live preview of what happens to each month and the approval notice (A4).
 */
export function AmendmentDialog({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const ids = { month: useId(), reason: useId(), amount: useId(), scope: useId() };
  const currency = retainer.money?.currency ?? 'USD';
  const create = useCreateAmendment(retainer.id);
  const preview = usePreviewAmendment(retainer.id);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<AmendmentScope>('month');
  const [month, setMonth] = useState<CalendarDate>(firstOfMonth(businessDate()));
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [direction, setDirection] = useState<Direction>('increase');
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [problems, setProblems] = useState<{ empty?: true; reason?: true }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [shown, setShown] = useState<AmendmentPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const months = effectiveMonths().map((value) => ({ value, label: formatMonth(value) }));

  const body: CreateAmendment = {
    scope,
    effectiveMonth: month,
    lines: lines
      .filter((line) => line.delta !== 0)
      .map((line) => ({
        kind: line.kind,
        label: line.label.trim() || null,
        quantityDelta: line.delta,
      })),
    amountDeltaMinor: (amount ?? 0) * (direction === 'decrease' ? -1 : 1),
    reason: reason.trim(),
  };
  const empty = body.lines.length === 0 && body.amountDeltaMinor === 0;
  const request = JSON.stringify({ ...body, reason: undefined });

  // The preview follows the form, a moment after the last change; nothing is saved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `request` stands for the body
  useEffect(() => {
    if (!open || empty) {
      setShown(null);
      setPreviewError(null);
      return;
    }
    const timer = setTimeout(() => {
      preview.mutate(
        { ...body, reason: body.reason || '—' },
        {
          onSuccess: (result) => {
            setShown(result);
            setPreviewError(null);
          },
          onError: (error) => {
            setShown(null);
            setPreviewError(errorMessage(t, error));
          },
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, request]);

  function openDialog() {
    setScope('month');
    setMonth(firstOfMonth(businessDate()));
    setLines([]);
    setDirection('increase');
    setAmount(null);
    setReason('');
    setProblems({});
    setFailure(null);
    setShown(null);
    setPreviewError(null);
    setOpen(true);
  }

  function changeLine(line: { kind: DeliverableKind; label: string | null }, step: number) {
    const key = deliverableKey(line);
    setLines((current) => {
      const found = current.find((item) => deliverableKey(item) === key);
      if (found) {
        return current.map((item) =>
          deliverableKey(item) === key ? { ...item, delta: item.delta + step } : item,
        );
      }
      return [...current, { kind: line.kind, label: line.label ?? '', delta: step, added: false }];
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    const next = {
      ...(empty && { empty: true as const }),
      ...(!body.reason && { reason: true as const }),
    };
    setProblems(next);
    if (next.empty || next.reason) return;
    try {
      const saved = await create.mutateAsync(body);
      toast.add({ title: t(`retainers.amendments.saved.${saved.status}`), type: 'success' });
      setOpen(false);
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  const added = lines.filter((line) => line.added);

  return (
    <>
      <Button onClick={openDialog}>
        <FilePenLineIcon />
        {t('retainers.amendments.new')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{t('retainers.amendments.newTitle')}</DialogTitle>
              <DialogDescription>{t('retainers.amendments.newHint')}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel id={ids.scope} render={<span />}>
                  {t('retainers.amendments.scope')}
                </FieldLabel>
                <ToggleGroup
                  aria-labelledby={ids.scope}
                  value={[scope]}
                  onValueChange={(next: AmendmentScope[]) => next[0] && setScope(next[0])}
                >
                  {(['month', 'onward'] as const).map((value) => (
                    <ToggleGroupItem key={value} value={value}>
                      {t(`retainers.amendments.scopes.${value}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor={ids.month}>
                  {scope === 'month'
                    ? t('retainers.amendments.month')
                    : t('retainers.amendments.fromMonth')}
                </FieldLabel>
                <Select
                  items={months}
                  value={month}
                  onValueChange={(value: CalendarDate | null) => value && setMonth(value)}
                >
                  <SelectTrigger id={ids.month}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <LinesEditor
              standing={retainer.deliverables}
              lines={lines}
              onStep={changeLine}
              onAdd={() =>
                setLines((current) => [
                  ...current,
                  { kind: 'design', label: '', delta: 1, added: true },
                ])
              }
              onChangeAdded={(index, patch) =>
                setLines((current) => {
                  const target = added[index];
                  return current.map((item) => (item === target ? { ...item, ...patch } : item));
                })
              }
              onRemoveAdded={(index) =>
                setLines((current) => current.filter((item) => item !== added[index]))
              }
              canAdd={lines.length < RETAINER_LIMITS.amendmentLines}
            />

            <Field>
              <FieldLabel htmlFor={ids.amount}>{t('retainers.amendments.amount')}</FieldLabel>
              <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                <ToggleGroup
                  aria-label={t('retainers.amendments.direction')}
                  value={[direction]}
                  onValueChange={(next: Direction[]) => next[0] && setDirection(next[0])}
                >
                  {(['increase', 'decrease'] as const).map((value) => (
                    <ToggleGroupItem key={value} value={value}>
                      {t(`retainers.amendments.directions.${value}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <MoneyInput
                  id={ids.amount}
                  currency={currency}
                  value={amount}
                  onValueChange={setAmount}
                />
              </div>
              <FieldDescription>
                {scope === 'month'
                  ? t('retainers.amendments.amountHintMonth')
                  : t('retainers.amendments.amountHintOnward')}
              </FieldDescription>
            </Field>

            <Field invalid={!!problems.reason}>
              <FieldLabel htmlFor={ids.reason}>{t('retainers.amendments.reason')}</FieldLabel>
              <Textarea
                id={ids.reason}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setProblems((current) => ({ ...current, reason: undefined }));
                }}
              />
              <FieldError match={!!problems.reason}>
                {t('retainers.amendments.errors.reason')}
              </FieldError>
            </Field>

            <PreviewPanel
              currency={currency}
              empty={empty}
              pending={preview.isPending && !shown}
              preview={shown}
              error={previewError}
            />
            {problems.empty && <FormAlert>{t('errors.EMPTY_AMENDMENT')}</FormAlert>}
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending
                  ? t('common.saving')
                  : shown?.needsApproval
                    ? t('retainers.amendments.submitForApproval')
                    : t('retainers.amendments.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A2: the standing lines with − / +, then new lines (kind, label for "other", quantity). */
function LinesEditor({
  standing,
  lines,
  onStep,
  onAdd,
  onChangeAdded,
  onRemoveAdded,
  canAdd,
}: {
  standing: DeliverableLine[];
  lines: LineDraft[];
  onStep: (line: { kind: DeliverableKind; label: string | null }, step: number) => void;
  onAdd: () => void;
  onChangeAdded: (index: number, patch: Partial<LineDraft>) => void;
  onRemoveAdded: (index: number) => void;
  canAdd: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const kinds = DELIVERABLE_KINDS.map((kind) => ({
    value: kind,
    label: t(`retainers.kinds.${kind}`),
  }));
  const deltaOf = (line: { kind: DeliverableKind; label: string | null }) =>
    lines.find((item) => !item.added && deliverableKey(item) === deliverableKey(line))?.delta ?? 0;
  const added = lines.filter((line) => line.added);

  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-sm font-medium">
        {t('retainers.amendments.lines')}
      </span>
      <ul
        aria-labelledby={id}
        className="flex flex-col divide-y divide-border rounded-lg border border-border"
      >
        {standing.map((line) => {
          const delta = deltaOf(line);
          const name = lineName(t, line);
          return (
            <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <DeliverableIcon kind={line.kind} />
                <span className="truncate text-sm font-medium">{name}</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatNumber(line.monthlyQuantity)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={t('retainers.amendments.decrease', { line: name })}
                  onClick={() => onStep(line, -1)}
                >
                  <MinusIcon />
                </Button>
                <span
                  className="w-10 text-center text-sm font-bold tabular-nums"
                  aria-live="polite"
                >
                  {isolateLtr(delta > 0 ? `+${formatNumber(delta)}` : formatNumber(delta))}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={t('retainers.amendments.increase', { line: name })}
                  onClick={() => onStep(line, 1)}
                >
                  <PlusIcon />
                </Button>
              </span>
            </li>
          );
        })}
        {added.map((line, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: new lines have no id yet
            key={index}
            className="grid gap-2 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)_5rem_auto] sm:items-center"
          >
            <Select
              items={kinds}
              value={line.kind}
              onValueChange={(value: DeliverableKind | null) =>
                value && onChangeAdded(index, { kind: value })
              }
            >
              <SelectTrigger aria-label={t('retainers.amendments.newLineKind')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label={t('retainers.amendments.newLineLabel')}
              placeholder={t('retainers.amendments.newLineLabel')}
              maxLength={60}
              value={line.label}
              onChange={(event) => onChangeAdded(index, { label: event.target.value })}
            />
            <Input
              aria-label={t('retainers.amendments.newLineQuantity')}
              type="number"
              min={1}
              max={999}
              value={line.delta}
              onChange={(event) =>
                onChangeAdded(index, {
                  delta: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                })
              }
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('retainers.amendments.removeLine')}
              onClick={() => onRemoveAdded(index)}
            >
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <Button variant="outline" size="sm" onClick={onAdd} disabled={!canAdd}>
          <PlusIcon />
          {t('retainers.amendments.addLine')}
        </Button>
      </div>
    </div>
  );
}

/** C6: per month what saving would do, and whether it waits for the General Manager (A4). */
function PreviewPanel({
  currency,
  empty,
  pending,
  preview,
  error,
}: {
  currency: Currency;
  empty: boolean;
  pending: boolean;
  preview: AmendmentPreview | null;
  error: string | null;
}) {
  const { t } = useTranslation();
  if (empty) return null;
  return (
    <section
      aria-label={t('retainers.amendments.preview')}
      aria-live="polite"
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4"
      data-testid="amendment-preview"
    >
      <h3 className="text-sm font-bold">{t('retainers.amendments.preview')}</h3>
      {error ? (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      ) : pending || !preview ? (
        <Skeleton className="h-10" />
      ) : (
        <>
          {preview.months.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('retainers.amendments.linesOnly')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {preview.months.map((effect) => (
                <li key={`${effect.month}-${effect.effect}`}>
                  <EffectText effect={effect} currency={currency} />
                </li>
              ))}
            </ul>
          )}
          {preview.needsApproval && (
            <Callout
              tone="warning"
              icon={<ShieldAlertIcon />}
              title={t('retainers.amendments.needsApproval')}
              description={t('retainers.amendments.needsApprovalHint')}
            />
          )}
        </>
      )}
    </section>
  );
}

/** "Nov 2026: draft updated 300 → 400", "Oct 2026: INV-… already sent — supplementary 100". */
export function EffectText({ effect, currency }: { effect: AmendmentEffect; currency: Currency }) {
  const { t } = useTranslation();
  const money = effect.money;
  const values = {
    month: formatMonth(effect.month),
    invoice: effect.invoice?.displayNumber ?? '',
    before: money ? isolateLtr(formatMoney(money.beforeMinor, currency)) : '',
    after: money ? isolateLtr(formatMoney(money.afterMinor, currency)) : '',
    amount: money
      ? isolateLtr(formatMoney(Math.abs(money.afterMinor - money.beforeMinor), currency))
      : '',
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge
        tone={
          effect.effect === 'credit' ? 'warning' : effect.effect === 'addition' ? 'info' : 'neutral'
        }
      >
        {formatMonth(effect.month)}
      </Badge>
      <span>
        {money
          ? t(`retainers.amendments.effects.${effect.effect}`, values)
          : t(`retainers.amendments.effectsNoMoney.${effect.effect}`, values)}
      </span>
    </span>
  );
}
