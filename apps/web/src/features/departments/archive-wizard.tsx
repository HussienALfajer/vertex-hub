import { useQuery } from '@tanstack/react-query';
import type {
  ArchiveDepartment,
  DepartmentArchivePreview,
  DepartmentDetailResponse,
  DepartmentResponse,
  DepartmentTransferCategory,
} from '@vertex-hub/contracts';
import {
  Button,
  Callout,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import { ArchiveIcon, TriangleAlertIcon } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatList, formatNumber } from '../../lib/format';
import { DepartmentDot } from './department-badge';
import {
  departmentArchivePreviewQuery,
  departmentListQuery,
  useArchiveDepartment,
} from './departments.queries';

type Targets = Partial<Record<DepartmentTransferCategory, string>>;

/**
 * Rules 8–15: archiving in two steps. "What moves" lists each non-empty category with a target
 * (prefilled from "Move everything to"); "Confirm" sums it up. A refusal returns to the first
 * step with its reason (edge case 3).
 */
export function ArchiveWizard({ department }: { department: DepartmentDetailResponse }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <ArchiveIcon />
        {t('departments.archive.open')}
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <Wizard department={department} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function Wizard({
  department,
  onDone,
}: {
  department: DepartmentDetailResponse;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const preview = useQuery(departmentArchivePreviewQuery(department.id));
  const departments = useQuery(departmentListQuery);
  const archive = useArchiveDepartment(department.id);
  const [step, setStep] = useState<'moves' | 'confirm'>('moves');
  const [targets, setTargets] = useState<Targets>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const choices = (departments.data?.items ?? []).filter(
    (other) => !other.archivedAt && other.id !== department.id,
  );
  // Edge case 3: a target archived meanwhile leaves the choices and must be picked again.
  const offered: Targets = Object.fromEntries(
    Object.entries(targets).filter(([, id]) => choices.some((other) => other.id === id)),
  );
  const nameOf = (id: string | undefined) => choices.find((other) => other.id === id)?.name ?? '';
  const filled = (preview.data?.categories ?? []).filter(({ count }) => count > 0);
  const complete = filled.every(({ category }) => offered[category]);

  function next(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!complete) return setMissing(true);
    setStep('confirm');
  }

  async function confirm() {
    setFailure(null);
    const input: ArchiveDepartment = {
      targets: Object.fromEntries(filled.map(({ category }) => [category, offered[category]])),
    };
    try {
      await archive.mutateAsync(input);
      toast.add({
        title: t('departments.archive.done', { name: department.name }),
        type: 'success',
      });
      onDone();
    } catch (error) {
      setFailure(errorMessage(t, error));
      setStep('moves');
      void preview.refetch();
      void departments.refetch();
    }
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t('departments.archive.title', { name: department.name })}</DialogTitle>
        <DialogDescription>
          {step === 'moves'
            ? t('departments.archive.stepMoves')
            : t('departments.archive.stepConfirm')}
        </DialogDescription>
      </DialogHeader>
      {preview.isPending || departments.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : preview.isError || departments.isError ? (
        <LoadError
          message={t('departments.archive.loadError')}
          onRetry={() => {
            void preview.refetch();
            void departments.refetch();
          }}
        />
      ) : step === 'moves' ? (
        <MovesStep
          preview={preview.data}
          choices={choices}
          targets={offered}
          missing={missing}
          failure={failure}
          onTargets={(next) => {
            setTargets(next);
            setMissing(false);
          }}
          onNext={next}
        />
      ) : (
        <div className="grid gap-4">
          {filled.length === 0 ? (
            <p className="text-sm">{t('departments.archive.nothingMoves')}</p>
          ) : (
            <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm">
              {filled.map(({ category, count }) => (
                <li key={category}>
                  {t('departments.archive.moves', {
                    category: t(`departments.archive.categories.${category}`),
                    n: formatNumber(count),
                    target: nameOf(offered[category]),
                  })}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">{t('departments.archive.confirmHint')}</p>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStep('moves')} disabled={archive.isPending}>
              {t('departments.archive.back')}
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={archive.isPending}>
              <ArchiveIcon />
              {archive.isPending
                ? t('departments.archive.archiving')
                : t('departments.archive.submit')}
            </Button>
          </DialogFooter>
        </div>
      )}
    </div>
  );
}

function MovesStep({
  preview,
  choices,
  targets,
  missing,
  failure,
  onTargets,
  onNext,
}: {
  preview: DepartmentArchivePreview;
  choices: DepartmentResponse[];
  targets: Targets;
  missing: boolean;
  failure: string | null;
  onTargets: (targets: Targets) => void;
  onNext: (event: FormEvent) => void;
}) {
  const { t } = useTranslation();
  const allId = useId();
  const filled = preview.categories.filter(({ count }) => count > 0);
  // "Move everything to" shows the target while every category shares it.
  const first = filled[0] ? targets[filled[0].category] : undefined;
  const shared = filled.every(({ category }) => targets[category] === first) ? first : undefined;

  return (
    <form className="grid gap-4" onSubmit={onNext} noValidate>
      {preview.systemFunctions.length > 0 && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t('departments.archive.functionsTitle')}
          description={t('departments.archive.functionsBody', {
            functions: formatList(
              preview.systemFunctions.map((name) => t(`departments.functions.${name}`)),
            ),
          })}
        />
      )}
      {filled.length === 0 ? (
        <p className="text-sm">{t('departments.archive.nothingMoves')}</p>
      ) : (
        <>
          <Field>
            <FieldLabel htmlFor={allId}>{t('departments.archive.everything')}</FieldLabel>
            <TargetSelect
              id={allId}
              choices={choices}
              value={shared}
              onChange={(id) =>
                onTargets(Object.fromEntries(filled.map(({ category }) => [category, id])))
              }
            />
          </Field>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {filled.map(({ category, count, items }) => (
              <CategoryRow
                key={category}
                category={category}
                count={count}
                items={items.map((item) => item.name)}
                choices={choices}
                value={targets[category]}
                invalid={missing && !targets[category]}
                onChange={(id) => onTargets({ ...targets, [category]: id })}
              />
            ))}
          </ul>
        </>
      )}
      {missing && <FormAlert>{t('errors.TRANSFER_TARGET_REQUIRED')}</FormAlert>}
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit">{t('common.next')}</Button>
      </DialogFooter>
    </form>
  );
}

function CategoryRow({
  category,
  count,
  items,
  choices,
  value,
  invalid,
  onChange,
}: {
  category: DepartmentTransferCategory;
  count: number;
  items: string[];
  choices: DepartmentResponse[];
  value: string | undefined;
  invalid: boolean;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const more = count - items.length;
  return (
    <li className="grid gap-3 p-3 sm:grid-cols-[1fr_14rem] sm:items-center">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">
          {t(`departments.archive.categories.${category}`)}
          <span className="ms-2 text-muted-foreground tabular-nums">{formatNumber(count)}</span>
        </span>
        <span className="text-sm text-muted-foreground wrap-anywhere">
          {formatList(items)}
          {more > 0 && ` ${t('departments.archive.more', { n: formatNumber(more) })}`}
        </span>
      </div>
      <Field invalid={invalid}>
        <FieldLabel htmlFor={id} className="sr-only">
          {t('departments.archive.targetOf', {
            category: t(`departments.archive.categories.${category}`),
          })}
        </FieldLabel>
        <TargetSelect id={id} choices={choices} value={value} onChange={onChange} />
      </Field>
    </li>
  );
}

function TargetSelect({
  id,
  choices,
  value,
  onChange,
}: {
  id: string;
  choices: DepartmentResponse[];
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      items={choices.map((choice) => ({ value: choice.id, label: choice.name }))}
      value={value ?? null}
      onValueChange={(next) => next && onChange(next)}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={t('departments.archive.targetPlaceholder')} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            <DepartmentDot department={choice} />
            {choice.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
