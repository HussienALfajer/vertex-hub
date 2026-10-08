import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import {
  CATALOG_BILLINGS,
  CATALOG_LIMITS,
  type CatalogBilling,
  type CatalogPackage,
  type CreateCatalogPackage,
  type CreateCatalogPackageInput,
  createCatalogPackageSchema,
  type ErrorCode,
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
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@vertex-hub/ui';
import { Trash2Icon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { MoneyInput } from '../../components/money-input';
import { ApiError } from '../../lib/api/client';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { formatList } from '../../lib/format';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { templateListQuery } from '../templates/templates.queries';
import { serviceListQuery, useCreatePackage, useUpdatePackage } from './catalog.queries';
import type { CatalogDialogProps } from './catalog-dialog';

const NONE = 'none';

const emptyPackage: CreateCatalogPackageInput = {
  name: '',
  description: '',
  billing: 'monthly',
  priceUsdMinor: 0,
  priceSypMinor: null,
  templateId: null,
  items: [],
};

const toInput = (pkg: CatalogPackage): CreateCatalogPackageInput => ({
  name: pkg.name,
  description: pkg.description ?? '',
  billing: pkg.billing,
  priceUsdMinor: pkg.priceUsdMinor,
  priceSypMinor: pkg.priceSypMinor,
  templateId: pkg.template?.id ?? null,
  items: pkg.items.map((item) => ({ serviceId: item.serviceId, quantity: item.quantity })),
});

/** The field each refusal is about: it shows there, and the focus goes back to it. */
const ERROR_FIELDS: Partial<Record<ErrorCode, 'name' | 'billing' | 'templateId'>> = {
  PACKAGE_NAME_TAKEN: 'name',
  SERVICE_IN_USE: 'billing',
  INVALID_TEMPLATE: 'templateId',
};

/**
 * Spec screen 1: a package's price, template and services with quantities; the services offered
 * are the non-archived ones of the package's billing.
 */
export function PackageDialog({
  editing,
  onClose,
  finalFocus,
}: CatalogDialogProps<CatalogPackage>) {
  const { t } = useTranslation();
  const shown = useShownWhileClosing(editing);
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl" finalFocus={finalFocus}>
        {shown !== null && <PackageForm pkg={shown === 'new' ? null : shown} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

/** Mounts on each opening, so it starts from the saved package (or a blank one). */
function PackageForm({ pkg, onDone }: { pkg: CatalogPackage | null; onDone: () => void }) {
  const { t } = useTranslation();
  const ids = {
    billing: useId(),
    priceUsd: useId(),
    priceSyp: useId(),
    template: useId(),
    add: useId(),
  };
  const create = useCreatePackage();
  const update = useUpdatePackage();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CreateCatalogPackageInput, unknown, CreateCatalogPackage>({
    resolver: standardSchemaResolver(createCatalogPackageSchema),
    defaultValues: pkg ? toInput(pkg) : emptyPackage,
  });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const addPicker = useRef<HTMLButtonElement>(null);
  const { errors, isDirty, isSubmitting } = form.formState;
  const billing = form.watch('billing');
  const services = useQuery(serviceListQuery({ billing, pageSize: 100 }));
  const templates = useQuery({
    ...templateListQuery({ kind: 'retainer_cycle', pageSize: 100 }),
    enabled: billing === 'monthly',
  });

  // Names of the services on the package, including ones archived since it was saved.
  const names = new Map([
    ...(pkg?.items.map((item) => [item.serviceId, item.name] as const) ?? []),
    ...(services.data?.items.map((service) => [service.id, service.name] as const) ?? []),
  ]);
  const chosen = new Set(items.fields.map((item) => item.serviceId));
  const addable = (services.data?.items ?? []).filter((service) => !chosen.has(service.id));

  /** Items and template belong to one billing, so changing it starts them over. */
  function changeBilling(next: CatalogBilling) {
    form.setValue('billing', next, { shouldDirty: true });
    form.setValue('templateId', null, { shouldDirty: true });
    items.replace([]);
  }

  /** A service was archived or changed billing meanwhile: name it, at the item list. */
  function refuseItems(error: ApiError) {
    const serviceIds = (error.details as { serviceIds?: string[] } | undefined)?.serviceIds ?? [];
    const refused = serviceIds.map((id) => names.get(id)).filter((name) => name !== undefined);
    form.setError('items', {
      type: SCREEN_ERROR,
      message: refused.length
        ? t('catalog.packages.invalidItems', { names: formatList(refused) })
        : errorMessage(t, error),
    });
    const index = items.fields.findIndex((item) => serviceIds.includes(item.serviceId));
    if (index >= 0) form.setFocus(`items.${index}.quantity`);
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // Nothing changed: close without a request or a "saved" toast.
    if (pkg && !isDirty) return onDone();
    try {
      if (pkg) {
        await update.mutateAsync({ id: pkg.id, ...values });
        toast.add({ title: t('catalog.packages.saved'), type: 'success' });
      } else {
        await create.mutateAsync(values);
        toast.add({ title: t('catalog.packages.added'), type: 'success' });
      }
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.knownCode === 'INVALID_PACKAGE_ITEM') {
        return refuseItems(error);
      }
      const field = error instanceof ApiError && error.knownCode && ERROR_FIELDS[error.knownCode];
      if (field) {
        form.setError(
          field,
          { type: SCREEN_ERROR, message: errorMessage(t, error) },
          { shouldFocus: true },
        );
      } else setFailure(errorMessage(t, error));
    }
  });

  const billingItems = CATALOG_BILLINGS.map((value) => ({
    value,
    label: t(`catalog.billings.${value}`),
  }));
  const templateItems = [
    { value: NONE, label: t('templates.picker.none') },
    ...(templates.data?.items ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];
  if (pkg?.template?.archived && !templateItems.some((i) => i.value === pkg.template?.id)) {
    templateItems.push({ value: pkg.template.id, label: pkg.template.name });
  }
  const addItems = addable.map((service) => ({ value: service.id, label: service.name }));

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>
          {pkg ? t('catalog.packages.editTitle') : t('catalog.packages.addTitle')}
        </DialogTitle>
        <DialogDescription>{t('catalog.packages.formHint')}</DialogDescription>
      </DialogHeader>
      <Field invalid={!!errors.name}>
        <FieldLabel>{t('catalog.form.name')}</FieldLabel>
        <Input autoFocus autoComplete="off" {...form.register('name')} />
        <FieldError match={!!errors.name} role={errorRole(errors.name)}>
          {fieldError(errors.name, t('catalog.form.errors.name'))}
        </FieldError>
      </Field>
      <Field invalid={!!errors.description}>
        <FieldLabel>{t('catalog.form.description')}</FieldLabel>
        <Textarea {...form.register('description')} />
        <FieldError match={!!errors.description}>{t('catalog.form.errors.description')}</FieldError>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="billing"
          render={({ field }) => (
            <Field invalid={!!errors.billing}>
              <FieldLabel id={ids.billing} render={<span />}>
                {t('catalog.billing')}
              </FieldLabel>
              <Select
                items={billingItems}
                value={field.value}
                onValueChange={(next) => next && changeBilling(next as CatalogBilling)}
              >
                <SelectTrigger ref={field.ref} aria-labelledby={ids.billing}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {billingItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{t('catalog.form.packageBillingHint')}</FieldDescription>
              <FieldError match={!!errors.billing} role="alert">
                {errors.billing?.message}
              </FieldError>
            </Field>
          )}
        />
        {billing === 'monthly' && (
          <Controller
            control={form.control}
            name="templateId"
            render={({ field }) => (
              <Field invalid={!!errors.templateId}>
                <FieldLabel id={ids.template} render={<span />}>
                  {t('catalog.form.template')}
                </FieldLabel>
                <Select
                  items={templateItems}
                  value={field.value ?? NONE}
                  onValueChange={(next) => next && field.onChange(next === NONE ? null : next)}
                >
                  <SelectTrigger ref={field.ref} aria-labelledby={ids.template}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {templateItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{t('catalog.form.packageTemplateHint')}</FieldDescription>
                <FieldError match={!!errors.templateId} role="alert">
                  {errors.templateId?.message}
                </FieldError>
              </Field>
            )}
          />
        )}
        <Controller
          control={form.control}
          name="priceUsdMinor"
          render={({ field }) => (
            <Field invalid={!!errors.priceUsdMinor}>
              <FieldLabel htmlFor={ids.priceUsd}>{t('catalog.form.priceUsd')}</FieldLabel>
              <MoneyInput
                id={ids.priceUsd}
                currency="USD"
                value={field.value}
                onValueChange={(minor) => field.onChange(minor)}
              />
              <FieldDescription>{t(`catalog.form.packagePriceHints.${billing}`)}</FieldDescription>
              <FieldError match={!!errors.priceUsdMinor}>
                {t('catalog.form.errors.priceUsd')}
              </FieldError>
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="priceSypMinor"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor={ids.priceSyp}>{t('catalog.form.priceSyp')}</FieldLabel>
              <MoneyInput
                id={ids.priceSyp}
                currency="SYP"
                value={field.value}
                onValueChange={(minor) => field.onChange(minor)}
              />
              <FieldDescription>{t('catalog.form.priceSypHint')}</FieldDescription>
            </Field>
          )}
        />
      </div>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <legend className="px-1 font-medium">{t('catalog.packages.items')}</legend>
        {items.fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('catalog.packages.noItems')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.fields.map((item, index) => {
              const name = names.get(item.serviceId) ?? '';
              const remove = t('catalog.packages.removeItem', { name });
              return (
                <li key={item.id} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 wrap-anywhere">{name}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={CATALOG_LIMITS.quantity}
                    aria-label={t('catalog.packages.quantityOf', { name })}
                    aria-invalid={!!errors.items?.[index]?.quantity}
                    className="w-24 text-end tabular-nums"
                    {...form.register(`items.${index}.quantity`, { valueAsNumber: true })}
                  />
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={remove}
                          onClick={() => {
                            // The button leaves with its row; the focus goes to the picker.
                            flushSync(() => items.remove(index));
                            addPicker.current?.focus();
                          }}
                        />
                      }
                    >
                      <Trash2Icon />
                    </TooltipTrigger>
                    <TooltipContent>{remove}</TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        )}
        {items.fields.length < CATALOG_LIMITS.packageItems && addItems.length > 0 && (
          <Field>
            <FieldLabel id={ids.add} render={<span />} className="sr-only">
              {t('catalog.packages.addItem')}
            </FieldLabel>
            <Select
              items={addItems}
              value={null}
              onValueChange={(next) => next && items.append({ serviceId: next, quantity: 1 })}
            >
              <SelectTrigger ref={addPicker} aria-labelledby={ids.add} className="sm:max-w-sm">
                <SelectValue placeholder={t('catalog.packages.addItem')} />
              </SelectTrigger>
              <SelectContent>
                {addItems.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {errors.items && (
          <p role="alert" className="text-sm text-destructive-text">
            {errors.items.type === SCREEN_ERROR && errors.items.message
              ? errors.items.message
              : t('catalog.form.errors.items')}
          </p>
        )}
      </fieldset>

      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('common.saving') : t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
