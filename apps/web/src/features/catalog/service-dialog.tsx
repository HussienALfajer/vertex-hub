import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import {
  CATALOG_BILLINGS,
  type CatalogBilling,
  type CatalogService,
  type CreateCatalogService,
  type CreateCatalogServiceInput,
  createCatalogServiceSchema,
  DELIVERABLE_KINDS,
  DEPARTMENT_CODES,
  TEMPLATE_KIND_BY_BILLING,
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
  toast,
} from '@vertex-hub/ui';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { MoneyInput } from '../../components/money-input';
import { errorMessage } from '../../lib/errors';
import { useDepartmentNames } from '../projects/project-badges';
import { templateListQuery } from '../templates/templates.queries';
import { useCreateService, useUpdateService } from './catalog.queries';

const NONE = 'none';

const emptyService: CreateCatalogServiceInput = {
  name: '',
  description: '',
  department: 'design',
  billing: 'monthly',
  priceUsdMinor: 0,
  priceSypMinor: null,
  revisionRounds: 2,
  deliverableKind: null,
  deliverableLabel: '',
  templateId: null,
};

const toInput = (service: CatalogService): CreateCatalogServiceInput => ({
  name: service.name,
  description: service.description ?? '',
  department: service.department,
  billing: service.billing,
  priceUsdMinor: service.priceUsdMinor,
  priceSypMinor: service.priceSypMinor,
  revisionRounds: service.revisionRounds,
  deliverableKind: service.deliverableKind,
  deliverableLabel: service.deliverableLabel ?? '',
  templateId: service.template?.id ?? null,
});

/** Spec screen 1: a service's fields, new or edited; the whole service is sent on save. */
export function ServiceDialog({
  editing,
  onClose,
}: {
  editing: CatalogService | 'new' | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = {
    department: useId(),
    billing: useId(),
    priceUsd: useId(),
    priceSyp: useId(),
    rounds: useId(),
    kind: useId(),
    template: useId(),
  };
  const nameOf = useDepartmentNames();
  const create = useCreateService();
  const update = useUpdateService();
  const [failure, setFailure] = useState<string | null>(null);
  const service = editing === 'new' ? null : editing;
  const form = useForm<CreateCatalogServiceInput, unknown, CreateCatalogService>({
    resolver: standardSchemaResolver(createCatalogServiceSchema),
    resetOptions: { keepDirtyValues: true },
    values: service ? toInput(service) : emptyService,
  });
  const { errors } = form.formState;
  const billing = form.watch('billing');
  const kind = form.watch('deliverableKind');
  const templates = useQuery({
    ...templateListQuery({ kind: TEMPLATE_KIND_BY_BILLING[billing], pageSize: 100 }),
    enabled: editing !== null,
  });

  function close() {
    setFailure(null);
    form.reset(emptyService);
    onClose();
  }

  /** A one-off service is never counted, and a template of the other kind no longer fits. */
  function changeBilling(next: CatalogBilling) {
    form.setValue('billing', next, { shouldDirty: true });
    form.setValue('templateId', null, { shouldDirty: true });
    if (next === 'one_off') {
      form.setValue('deliverableKind', null, { shouldDirty: true });
      form.setValue('deliverableLabel', '', { shouldDirty: true });
    }
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      if (service) {
        await update.mutateAsync({ id: service.id, ...values });
        toast.add({ title: t('catalog.services.saved'), type: 'success' });
      } else {
        await create.mutateAsync(values);
        toast.add({ title: t('catalog.services.added'), type: 'success' });
      }
      close();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  const departmentItems = DEPARTMENT_CODES.map((code) => ({ value: code, label: nameOf(code) }));
  const billingItems = CATALOG_BILLINGS.map((value) => ({
    value,
    label: t(`catalog.billings.${value}`),
  }));
  const kindItems = [
    { value: NONE, label: t('catalog.notCounted') },
    ...DELIVERABLE_KINDS.map((value) => ({ value, label: t(`retainers.kinds.${value}`) })),
  ];
  const templateItems = [
    { value: NONE, label: t('templates.picker.none') },
    ...(templates.data?.items ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];
  // A linked template archived later stays selectable until it is changed (C3).
  if (service?.template?.archived && !templateItems.some((i) => i.value === service.template?.id)) {
    templateItems.push({ value: service.template.id, label: service.template.name });
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {service ? t('catalog.services.editTitle') : t('catalog.services.addTitle')}
            </DialogTitle>
            <DialogDescription>{t('catalog.services.formHint')}</DialogDescription>
          </DialogHeader>
          <Field invalid={!!errors.name}>
            <FieldLabel>{t('catalog.form.name')}</FieldLabel>
            <Input autoComplete="off" {...form.register('name')} />
            <FieldError match={!!errors.name}>{t('catalog.form.errors.name')}</FieldError>
          </Field>
          <Field invalid={!!errors.description}>
            <FieldLabel>{t('catalog.form.description')}</FieldLabel>
            <Textarea {...form.register('description')} />
            <FieldDescription>{t('catalog.form.descriptionHint')}</FieldDescription>
            <FieldError match={!!errors.description}>
              {t('catalog.form.errors.description')}
            </FieldError>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="department"
              render={({ field }) => (
                <Field>
                  <FieldLabel id={ids.department} render={<span />}>
                    {t('catalog.department')}
                  </FieldLabel>
                  <Select
                    items={departmentItems}
                    value={field.value}
                    onValueChange={(next) => next && field.onChange(next)}
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
                  <FieldDescription>{t('catalog.form.departmentHint')}</FieldDescription>
                </Field>
              )}
            />
            <Field>
              <FieldLabel id={ids.billing} render={<span />}>
                {t('catalog.billing')}
              </FieldLabel>
              <Select
                items={billingItems}
                value={billing}
                onValueChange={(next) => next && changeBilling(next as CatalogBilling)}
              >
                <SelectTrigger aria-labelledby={ids.billing}>
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
              <FieldDescription>{t(`catalog.form.billingHints.${billing}`)}</FieldDescription>
            </Field>
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
                  <FieldDescription>{t(`catalog.form.priceHints.${billing}`)}</FieldDescription>
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
                <Field invalid={!!errors.priceSypMinor}>
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
            <Field invalid={!!errors.revisionRounds}>
              <FieldLabel htmlFor={ids.rounds}>{t('catalog.form.revisionRounds')}</FieldLabel>
              <Input
                id={ids.rounds}
                type="number"
                inputMode="numeric"
                min={0}
                max={20}
                className="w-32 text-end tabular-nums"
                {...form.register('revisionRounds', { valueAsNumber: true })}
              />
              <FieldError match={!!errors.revisionRounds}>
                {t('catalog.form.errors.revisionRounds')}
              </FieldError>
            </Field>
            <Controller
              control={form.control}
              name="templateId"
              render={({ field }) => (
                <Field>
                  <FieldLabel id={ids.template} render={<span />}>
                    {t('catalog.form.template')}
                  </FieldLabel>
                  <Select
                    items={templateItems}
                    value={field.value ?? NONE}
                    onValueChange={(next) => next && field.onChange(next === NONE ? null : next)}
                  >
                    <SelectTrigger aria-labelledby={ids.template}>
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
                  <FieldDescription>{t(`catalog.form.templateHints.${billing}`)}</FieldDescription>
                </Field>
              )}
            />
          </div>
          {billing === 'monthly' && (
            <div className="grid gap-5 rounded-lg border border-border p-4 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="deliverableKind"
                render={({ field }) => (
                  <Field>
                    <FieldLabel id={ids.kind} render={<span />}>
                      {t('catalog.form.counted')}
                    </FieldLabel>
                    <Select
                      items={kindItems}
                      value={field.value ?? NONE}
                      onValueChange={(next) => {
                        if (!next) return;
                        field.onChange(next === NONE ? null : next);
                        if (next === NONE) form.setValue('deliverableLabel', '');
                      }}
                    >
                      <SelectTrigger aria-labelledby={ids.kind}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {kindItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>{t('catalog.form.countedHint')}</FieldDescription>
                  </Field>
                )}
              />
              {kind && (
                <Field invalid={!!errors.deliverableLabel}>
                  <FieldLabel>{t('catalog.form.deliverableLabel')}</FieldLabel>
                  <Input autoComplete="off" {...form.register('deliverableLabel')} />
                  <FieldDescription>
                    {kind === 'other'
                      ? t('catalog.form.deliverableLabelRequired')
                      : t('catalog.form.deliverableLabelHint')}
                  </FieldDescription>
                  <FieldError match={!!errors.deliverableLabel}>
                    {t('catalog.form.errors.deliverableLabel')}
                  </FieldError>
                </Field>
              )}
            </div>
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
