import { useQuery } from '@tanstack/react-query';
import {
  CLIENT_STATUSES,
  type ClientStatus,
  type CreateClient,
  type CreateClientInput,
} from '@vertex-hub/contracts';
import {
  Autocomplete,
  Avatar,
  Badge,
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
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { StethoscopeIcon } from 'lucide-react';
import { useId } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { accountManagersQuery, invitedAccountManagersQuery, sectorsQuery } from './clients.queries';

export type ClientFormMethods = UseFormReturn<CreateClientInput, unknown, CreateClient>;

export const emptyClient: CreateClientInput = {
  tradeName: '',
  sector: '',
  accountManagerId: '',
  status: 'active',
  isHealthcare: false,
};

/**
 * Puts a failed save on the field it concerns and returns the form-level message for anything
 * else (null when a field took it).
 */
export function clientFormFailure(
  form: ClientFormMethods,
  t: TFunction,
  error: unknown,
): string | null {
  if (error instanceof ApiError && error.code === 'CLIENT_NAME_TAKEN') {
    form.setError('tradeName', { message: errorMessage(t, error) });
    return null;
  }
  if (error instanceof ApiError && error.code === 'INVALID_ACCOUNT_MANAGER') {
    form.setError('accountManagerId', { message: errorMessage(t, error) });
    return null;
  }
  return errorMessage(t, error);
}

export function TradeNameField({ form }: { form: ClientFormMethods }) {
  const { t } = useTranslation();
  const error = form.formState.errors.tradeName;
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('clients.form.tradeName')}</FieldLabel>
      <Input
        autoComplete="off"
        placeholder={t('clients.form.tradeNamePlaceholder')}
        {...form.register('tradeName')}
      />
      <FieldError match={!!error}>
        {error?.message || t('clients.form.errors.tradeName')}
      </FieldError>
    </Field>
  );
}

export function SectorField({ form }: { form: ClientFormMethods }) {
  const { t } = useTranslation();
  const id = useId();
  const sectors = useQuery(sectorsQuery);
  const invalid = !!form.formState.errors.sector;
  return (
    <Field invalid={invalid}>
      <FieldLabel htmlFor={id}>{t('clients.form.sector')}</FieldLabel>
      <Controller
        control={form.control}
        name="sector"
        render={({ field }) => (
          <Autocomplete
            id={id}
            name={field.name}
            inputRef={field.ref}
            value={field.value ?? ''}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
            suggestions={sectors.data?.items ?? []}
            placeholder={t('clients.form.sectorPlaceholder')}
            invalid={invalid}
          />
        )}
      />
      <FieldDescription>{t('clients.form.sectorHint')}</FieldDescription>
      <FieldError match={invalid}>{t('clients.form.errors.sector')}</FieldError>
    </Field>
  );
}

/**
 * Picks a non-archived user with the Account Manager role (rule 2). The current manager stays
 * listed when they no longer qualify, so the field shows who it is.
 */
export function AccountManagerField({
  form,
  current,
}: {
  form: ClientFormMethods;
  current?: { id: string; name: string; archived: boolean };
}) {
  const { t } = useTranslation();
  const active = useQuery(accountManagersQuery);
  const invited = useQuery(invitedAccountManagersQuery);
  const error = form.formState.errors.accountManagerId;

  const options = [
    ...(active.data?.items ?? []).map((user) => ({ id: user.id, name: user.name, note: null })),
    ...(invited.data?.items ?? []).map((user) => ({
      id: user.id,
      name: user.name,
      note: t('clients.form.invited'),
    })),
  ];
  if (current && !options.some((option) => option.id === current.id)) {
    options.push({
      id: current.id,
      name: current.name,
      note: current.archived ? t('clients.archivedBadge') : null,
    });
  }
  const items = options.map((option) => ({ value: option.id, label: option.name }));
  const loaded = active.isSuccess && invited.isSuccess;

  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('clients.form.accountManager')}</FieldLabel>
      <Controller
        control={form.control}
        name="accountManagerId"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value || null}
            onValueChange={(value) => field.onChange(value ?? '')}
          >
            <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
              <SelectValue placeholder={t('clients.form.accountManagerPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  <span className="flex items-center gap-2">
                    <Avatar name={option.name} size="sm" />
                    {option.name}
                    {option.note && <Badge tone="outline">{option.note}</Badge>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldDescription>
        {loaded && options.length === 0
          ? t('clients.form.noAccountManagers')
          : t('clients.form.accountManagerHint')}
      </FieldDescription>
      <FieldError match={!!error}>
        {error?.message || t('clients.form.errors.accountManager')}
      </FieldError>
    </Field>
  );
}

export function StatusField({ form }: { form: ClientFormMethods }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field>
      <FieldLabel id={id} render={<span />}>
        {t('clients.form.status')}
      </FieldLabel>
      <Controller
        control={form.control}
        name="status"
        render={({ field }) => (
          <ToggleGroup
            aria-labelledby={id}
            value={[field.value ?? 'active']}
            onValueChange={(next: ClientStatus[]) => {
              if (next[0]) field.onChange(next[0]);
            }}
          >
            {CLIENT_STATUSES.map((status) => (
              <ToggleGroupItem key={status} value={status}>
                {t(`clients.statuses.${status}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      />
    </Field>
  );
}

/** The healthcare flag as a setting row: it switches on the medical review later (F09). */
export function HealthcareField({ form }: { form: ClientFormMethods }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Controller
      control={form.control}
      name="isHealthcare"
      render={({ field }) => (
        <label
          htmlFor={id}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 transition-colors duration-150 ease-out hover:bg-muted/50 has-data-checked:border-primary"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-status-info text-status-info-foreground">
            <StethoscopeIcon className="size-5" />
          </span>
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="font-medium">{t('clients.form.healthcare')}</span>
            <span className="text-sm text-muted-foreground">
              {t('clients.form.healthcareHint')}
            </span>
          </span>
          <Switch
            id={id}
            checked={field.value ?? false}
            onCheckedChange={(checked) => field.onChange(checked)}
            className="mt-1"
          />
        </label>
      )}
    />
  );
}
