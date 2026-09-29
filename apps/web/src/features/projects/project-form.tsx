import { useQuery } from '@tanstack/react-query';
import {
  type ClientResponse,
  type CreateProject,
  type CreateProjectInput,
  CURRENCIES,
  type Currency,
  daysInclusive,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  MultiCombobox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { useId } from 'react';
import { Controller, type UseFormReturn, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api/client';
import { can, useMe } from '../../lib/auth';
import { errorMessage, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { ClientStatusBadge } from '../clients/client-badges';
import { clientListQuery } from '../clients/clients.queries';
import { departmentListQuery } from '../departments/departments.queries';
import { userListQuery } from '../users/users.queries';
import { projectCreateScope } from './project-access';

export type ProjectFormMethods = UseFormReturn<CreateProjectInput, unknown, CreateProject>;

/**
 * Puts a failed save on the field it concerns and returns the form-level message for anything
 * else (null when a field took it).
 */
export function projectFormFailure(
  form: ProjectFormMethods,
  t: TFunction,
  error: unknown,
): string | null {
  const field = error instanceof ApiError ? FIELD_OF_CODE[error.code ?? ''] : undefined;
  if (field) {
    form.setError(field, {
      type: SCREEN_ERROR,
      message: errorMessage(t, error),
    });
    return null;
  }
  return errorMessage(t, error);
}

const FIELD_OF_CODE: Record<string, 'name' | 'projectManagerId' | 'dueDate' | 'currency'> = {
  PROJECT_NAME_TAKEN: 'name',
  INVALID_PROJECT_MANAGER: 'projectManagerId',
  INVALID_DATES: 'dueDate',
  CURRENCY_LOCKED: 'currency',
};

/** Rule 5 before the round trip: the due date is on or after the start date. */
export function checkDates(form: ProjectFormMethods, t: TFunction, start: string, due: string) {
  if (due >= start) return true;
  form.setError('dueDate', {
    type: SCREEN_ERROR,
    message: t('errors.INVALID_DATES'),
  });
  return false;
}

/** The clients a project can be started for: active or paused, within the user's scope (rule 1). */
export function useProjectClients() {
  const me = useMe();
  const scope = projectCreateScope(me);
  return useQuery({
    ...clientListQuery({
      status: ['active', 'paused'],
      accountManagerId: scope === 'own_clients' ? me.user.id : undefined,
      pageSize: 100,
    }),
    enabled: scope !== null,
  });
}

export function ClientField({
  form,
  clients,
}: {
  form: ProjectFormMethods;
  clients: ClientResponse[];
}) {
  const { t } = useTranslation();
  const error = form.formState.errors.clientId;
  const items = clients.map((client) => ({ value: client.id, label: client.tradeName }));
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('projects.form.client')}</FieldLabel>
      <Controller
        control={form.control}
        name="clientId"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value || null}
            onValueChange={(value) => field.onChange(value ?? '')}
          >
            <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
              <SelectValue placeholder={t('projects.form.clientPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  <span className="flex items-center gap-2">
                    <Avatar name={client.tradeName} shape="square" size="sm" />
                    {client.tradeName}
                    {client.status !== 'active' && <ClientStatusBadge status={client.status} />}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldDescription>{t('projects.form.clientHint')}</FieldDescription>
      <FieldError match={!!error}>{t('projects.form.errors.client')}</FieldError>
    </Field>
  );
}

export function NameField({ form }: { form: ProjectFormMethods }) {
  const { t } = useTranslation();
  const error = form.formState.errors.name;
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('projects.form.name')}</FieldLabel>
      <Input
        autoComplete="off"
        placeholder={t('projects.form.namePlaceholder')}
        {...form.register('name')}
      />
      <FieldError match={!!error}>{fieldError(error, t('projects.form.errors.name'))}</FieldError>
    </Field>
  );
}

export function DescriptionField({ form }: { form: ProjectFormMethods }) {
  const { t } = useTranslation();
  const error = form.formState.errors.description;
  return (
    <Field invalid={!!error}>
      <FieldLabel>
        {t('projects.form.description')}
        <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>
      </FieldLabel>
      <Textarea
        rows={3}
        placeholder={t('projects.form.descriptionPlaceholder')}
        {...form.register('description')}
      />
      <FieldError match={!!error}>{t('projects.form.errors.description')}</FieldError>
    </Field>
  );
}

/** Users who may manage a project: anyone not archived, invited users included (rule 2). */
export function useProjectManagerOptions(current?: {
  id: string;
  name: string;
  archived: boolean;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const active = useQuery(userListQuery({ pageSize: 100 }));
  // Only user managers may list invited users; the API accepts them as project managers.
  const invited = useQuery({
    ...userListQuery({ status: 'invited', pageSize: 100 }),
    enabled: can(me, 'users.manage'),
  });
  const options = [
    ...(active.data?.items ?? []).map((user) => ({
      id: user.id,
      name: user.name,
      note: user.title,
    })),
    ...(invited.data?.items ?? []).map((user) => ({
      id: user.id,
      name: user.name,
      note: t('projects.form.invited'),
    })),
  ];
  if (current && !options.some((option) => option.id === current.id)) {
    options.push({
      id: current.id,
      name: current.name,
      note: current.archived ? t('projects.archivedBadge') : null,
    });
  }
  return options;
}

export function ProjectManagerField({
  form,
  current,
}: {
  form: ProjectFormMethods;
  current?: { id: string; name: string; archived: boolean };
}) {
  const { t } = useTranslation();
  const options = useProjectManagerOptions(current);
  const error = form.formState.errors.projectManagerId;
  const items = options.map((option) => ({ value: option.id, label: option.name }));
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('projects.form.projectManager')}</FieldLabel>
      <Controller
        control={form.control}
        name="projectManagerId"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value || null}
            onValueChange={(value) => field.onChange(value ?? '')}
          >
            <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
              <SelectValue placeholder={t('projects.form.projectManagerPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  <span className="flex items-center gap-2">
                    <Avatar name={option.name} size="sm" />
                    {option.name}
                    {option.note && (
                      <span className="text-sm text-muted-foreground">{option.note}</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldDescription>{t('projects.form.projectManagerHint')}</FieldDescription>
      <FieldError match={!!error}>
        {fieldError(error, t('projects.form.errors.projectManager'))}
      </FieldError>
    </Field>
  );
}

export function DepartmentsField({ form }: { form: ProjectFormMethods }) {
  const { t } = useTranslation();
  const id = useId();
  const departments = useQuery(departmentListQuery);
  const error = form.formState.errors.departments;
  const items = (departments.data?.items ?? []).map(({ code, name }) => ({ code, name }));
  const byCode = new Map(items.map((item) => [item.code, item]));
  return (
    <Field invalid={!!error}>
      <FieldLabel htmlFor={id}>{t('projects.form.departments')}</FieldLabel>
      <Controller
        control={form.control}
        name="departments"
        render={({ field }) => (
          <MultiCombobox
            id={id}
            items={items}
            value={(field.value ?? []).flatMap((code) => byCode.get(code) ?? [])}
            onValueChange={(next) => field.onChange(next.map((item) => item.code))}
            itemToLabel={(item) => item.name}
            itemToKey={(item) => item.code}
            placeholder={t('projects.form.departmentsPlaceholder')}
            emptyLabel={t('common.noMatches')}
            removeLabel={(label) => t('common.remove', { label })}
            invalid={!!error}
          />
        )}
      />
      <FieldDescription>{t('projects.form.departmentsHint')}</FieldDescription>
      <FieldError match={!!error}>{t('projects.form.errors.departments')}</FieldError>
    </Field>
  );
}

/** Start and due dates side by side, with the span they make. */
export function DatesFields({ form }: { form: ProjectFormMethods }) {
  const { t } = useTranslation();
  const [start, due] = useWatch({ control: form.control, name: ['startDate', 'dueDate'] });
  const startError = form.formState.errors.startDate;
  const dueError = form.formState.errors.dueDate;
  const days = start && due && due >= start ? daysInclusive(start, due) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!startError}>
          <FieldLabel>{t('projects.form.startDate')}</FieldLabel>
          <Input type="date" {...form.register('startDate')} />
          <FieldError match={!!startError}>{t('projects.form.errors.date')}</FieldError>
        </Field>
        <Field invalid={!!dueError}>
          <FieldLabel>{t('projects.form.dueDate')}</FieldLabel>
          <Input type="date" min={start || undefined} {...form.register('dueDate')} />
          <FieldError match={!!dueError}>
            {fieldError(dueError, t('projects.form.errors.date'))}
          </FieldError>
        </Field>
      </div>
      {days !== null && (
        <p className="text-sm text-muted-foreground">
          {t('projects.form.span', { count: days, days: formatNumber(days) })}
        </p>
      )}
    </div>
  );
}

export function StatusField({ form }: { form: ProjectFormMethods }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field>
      <FieldLabel id={id} render={<span />}>
        {t('projects.form.status')}
      </FieldLabel>
      <Controller
        control={form.control}
        name="status"
        render={({ field }) => (
          <ToggleGroup
            aria-labelledby={id}
            value={[field.value ?? 'planned']}
            onValueChange={(next: ('planned' | 'active')[]) => {
              if (next[0]) field.onChange(next[0]);
            }}
          >
            <ToggleGroupItem value="planned">{t('projects.statuses.planned')}</ToggleGroupItem>
            <ToggleGroupItem value="active">{t('projects.statuses.active')}</ToggleGroupItem>
          </ToggleGroup>
        )}
      />
      <FieldDescription>{t('projects.form.statusHint')}</FieldDescription>
    </Field>
  );
}

/** Every installment and extra work estimate on the project uses this currency (M2). */
export function CurrencyField({ form, locked }: { form: ProjectFormMethods; locked?: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const error = form.formState.errors.currency;
  return (
    <Field invalid={!!error}>
      <FieldLabel id={id} render={<span />}>
        {t('projects.form.currency')}
      </FieldLabel>
      <Controller
        control={form.control}
        name="currency"
        render={({ field }) => (
          <ToggleGroup
            aria-labelledby={id}
            value={[field.value ?? 'USD']}
            disabled={locked}
            onValueChange={(next: Currency[]) => {
              if (next[0]) field.onChange(next[0]);
            }}
          >
            {CURRENCIES.map((currency) => (
              <ToggleGroupItem key={currency} value={currency}>
                <Badge tone="outline" className="h-5 px-1.5">
                  {currency}
                </Badge>
                {t(`projects.currencies.${currency}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      />
      <FieldDescription>
        {locked ? t('projects.form.currencyLocked') : t('projects.form.currencyHint')}
      </FieldDescription>
      <FieldError match={!!error}>{fieldError(error, t('errors.CURRENCY_LOCKED'))}</FieldError>
    </Field>
  );
}
