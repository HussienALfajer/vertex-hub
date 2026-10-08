import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import {
  ASSIGNABLE_ROLES,
  type AssignableRole,
  type CreateUser,
  type CreateUserInput,
  createUserSchema,
  type DepartmentResponse,
} from '@vertex-hub/contracts';
import {
  Button,
  Checkbox,
  cn,
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
} from '@vertex-hub/ui';
import { type ReactNode, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { departmentListQuery } from '../departments/departments.queries';
import { skillsQuery } from './users.queries';

type UserFormInput = CreateUserInput;

export const emptyUser: UserFormInput = {
  name: '',
  email: '',
  primaryDepartmentId: '',
  secondaryDepartmentIds: [],
  title: '',
  phone: '',
  skills: [],
  roles: [],
};

interface UserFormProps {
  defaultValues: UserFormInput;
  onSubmit: (values: CreateUser) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
  /** Only a General Manager may grant or remove the General Manager and Finance roles (F01 rule 5). */
  canGrantGeneralManager: boolean;
  /** The user edits their own account: roles are changed by someone else (F01 rule 5). */
  ownAccount?: boolean;
  /** Extra actions beside the submit button, such as cancel. */
  actions?: ReactNode;
  /** Says more about a refusal than its code's message (the records it names); else undefined. */
  describeFailure?: (error: unknown) => string | undefined;
}

/** Roles only a General Manager grants or removes (F01 rule 5; the API enforces it). */
const GENERAL_MANAGER_GRANTED: readonly AssignableRole[] = ['general_manager', 'finance'];

/** Create or edit a team member: identity, departments and roles, then profile details. */
export function UserForm({
  defaultValues,
  onSubmit,
  submitLabel,
  submittingLabel,
  canGrantGeneralManager,
  ownAccount = false,
  actions,
  describeFailure,
}: UserFormProps) {
  const { t } = useTranslation();
  const ids = { secondary: useId(), skills: useId() };
  const [failure, setFailure] = useState<string | null>(null);
  const departments = useQuery(departmentListQuery);
  const skills = useQuery(skillsQuery);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserFormInput, unknown, CreateUser>({
    resolver: standardSchemaResolver(createUserSchema),
    defaultValues,
  });

  const primaryId = watch('primaryDepartmentId');
  const departmentList = departments.data?.items ?? [];
  const departmentItems = departmentList.map((d) => ({ value: d.id, label: d.name }));
  // General Manager and Finance: shown to others only when the user already holds them, locked.
  const roles = ASSIGNABLE_ROLES.filter(
    (role) =>
      !GENERAL_MANAGER_GRANTED.includes(role) ||
      canGrantGeneralManager ||
      defaultValues.roles?.includes(role),
  );
  const locked = (role: AssignableRole) =>
    ownAccount || (GENERAL_MANAGER_GRANTED.includes(role) && !canGrantGeneralManager);

  const submit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      await onSubmit(values);
    } catch (error) {
      // A taken email belongs to the field: mark it and put the cursor back there.
      if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setError(
          'email',
          { type: SCREEN_ERROR, message: errorMessage(t, error) },
          { shouldFocus: true },
        );
      } else {
        setFailure(describeFailure?.(error) ?? errorMessage(t, error));
      }
    }
  });

  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      <FormSection title={t('users.form.identity')} hint={t('users.form.identityHint')}>
        <Field invalid={!!errors.name}>
          <FieldLabel>{t('users.form.name')}</FieldLabel>
          <Input autoFocus autoComplete="off" {...register('name')} />
          <FieldError match={!!errors.name}>{t('users.form.errors.name')}</FieldError>
        </Field>
        <Field invalid={!!errors.email}>
          <FieldLabel>{t('users.form.email')}</FieldLabel>
          <Input type="email" dir="ltr" autoComplete="off" {...register('email')} />
          <FieldDescription>{t('users.form.emailHint')}</FieldDescription>
          <FieldError match={!!errors.email} role={errorRole(errors.email)}>
            {fieldError(errors.email, t('users.form.errors.email'))}
          </FieldError>
        </Field>
      </FormSection>

      <FormSection title={t('users.form.organization')} hint={t('users.form.organizationHint')}>
        <div className="grid gap-5 @lg:grid-cols-2">
          <Field invalid={!!errors.primaryDepartmentId}>
            <FieldLabel>{t('users.form.primaryDepartment')}</FieldLabel>
            <Controller
              control={control}
              name="primaryDepartmentId"
              render={({ field }) => (
                <Select
                  items={departmentItems}
                  value={field.value || null}
                  onValueChange={(value) => {
                    field.onChange(value ?? '');
                    // The new primary department leaves the secondary ones (rule 1).
                    const secondary = getValues('secondaryDepartmentIds') ?? [];
                    if (value && secondary.includes(value)) {
                      setValue(
                        'secondaryDepartmentIds',
                        secondary.filter((id) => id !== value),
                      );
                    }
                  }}
                >
                  <SelectTrigger onBlur={field.onBlur}>
                    <SelectValue placeholder={t('users.form.primaryPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {departmentItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError match={!!errors.primaryDepartmentId}>
              {t('users.form.errors.primaryDepartment')}
            </FieldError>
          </Field>
          <Field invalid={!!errors.secondaryDepartmentIds}>
            <FieldLabel htmlFor={ids.secondary}>{t('users.form.secondaryDepartments')}</FieldLabel>
            <Controller
              control={control}
              name="secondaryDepartmentIds"
              render={({ field }) => (
                <MultiCombobox<DepartmentResponse>
                  id={ids.secondary}
                  items={departmentList.filter((d) => d.id !== primaryId)}
                  value={departmentList.filter((d) => field.value?.includes(d.id))}
                  onValueChange={(value) => field.onChange(value.map((d) => d.id))}
                  itemToLabel={(d) => d.name}
                  itemToKey={(d) => d.id}
                  placeholder={t('users.form.secondaryPlaceholder')}
                  emptyLabel={t('users.form.noMatches')}
                  removeLabel={(label) => t('users.form.remove', { label })}
                  invalid={!!errors.secondaryDepartmentIds}
                />
              )}
            />
            <FieldDescription>{t('users.form.secondaryHint')}</FieldDescription>
            <FieldError match={!!errors.secondaryDepartmentIds}>
              {t('users.form.errors.secondaryDepartments')}
            </FieldError>
          </Field>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-sm font-medium">{t('users.form.roles')}</legend>
          <Controller
            control={control}
            name="roles"
            render={({ field }) => (
              <div className="grid gap-3 @xl:grid-cols-3">
                {roles.map((role) => (
                  <RoleOption
                    key={role}
                    role={role}
                    checked={field.value?.includes(role) ?? false}
                    disabled={locked(role)}
                    onChange={(checked) => {
                      const current = field.value ?? [];
                      field.onChange(
                        checked ? [...current, role] : current.filter((r) => r !== role),
                      );
                    }}
                  />
                ))}
              </div>
            )}
          />
          <p className="text-sm text-muted-foreground">
            {ownAccount ? t('users.form.ownRolesHint') : t('users.form.rolesHint')}
          </p>
        </fieldset>
      </FormSection>

      <FormSection title={t('users.form.details')} hint={t('users.form.detailsHint')}>
        <div className="grid gap-5 @lg:grid-cols-2">
          <Field invalid={!!errors.title}>
            <FieldLabel>{t('users.form.title')}</FieldLabel>
            <Input placeholder={t('users.form.titlePlaceholder')} {...register('title')} />
            <FieldError match={!!errors.title}>{t('users.form.errors.title')}</FieldError>
          </Field>
          <Field invalid={!!errors.phone}>
            <FieldLabel>{t('users.form.phone')}</FieldLabel>
            <Input type="tel" dir="ltr" autoComplete="off" {...register('phone')} />
            <FieldDescription>{t('users.form.phoneHint')}</FieldDescription>
            <FieldError match={!!errors.phone}>{t('users.form.errors.phone')}</FieldError>
          </Field>
        </div>
        <SkillsField
          id={ids.skills}
          control={control}
          suggestions={skills.data?.items ?? []}
          invalid={!!errors.skills}
        />
      </FormSection>

      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {actions}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** A titled block of the form: the explanation beside the fields on wide screens. */
function FormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-lg border border-border bg-surface p-6 lg:grid-cols-[14rem_1fr] lg:gap-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {/* Field grids follow this column's width, which the sidebar and the hint column narrow. */}
      <div className="@container flex min-w-0 flex-col gap-5">{children}</div>
    </section>
  );
}

function RoleOption({
  role,
  checked,
  disabled,
  onChange,
}: {
  role: AssignableRole;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors duration-150 ease-out',
        'hover:bg-muted/50 has-data-checked:border-primary has-data-checked:bg-muted/50',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value)}
        className="mt-0.5"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{t(`roles.${role}`)}</span>
        <span className="text-xs text-muted-foreground">
          {t(`users.form.roleDescriptions.${role}`)}
        </span>
      </span>
    </label>
  );
}

function SkillsField({
  id,
  control,
  suggestions,
  invalid,
}: {
  id: string;
  control: ReturnType<typeof useForm<UserFormInput, unknown, CreateUser>>['control'];
  suggestions: string[];
  invalid: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field invalid={invalid}>
      <FieldLabel htmlFor={id}>{t('users.form.skills')}</FieldLabel>
      <Controller
        control={control}
        name="skills"
        render={({ field }) => (
          <SkillsInput
            id={id}
            value={field.value ?? []}
            onChange={field.onChange}
            suggestions={suggestions}
            invalid={invalid}
          />
        )}
      />
      <FieldError match={invalid}>{t('users.form.errors.skills')}</FieldError>
    </Field>
  );
}

/** Skills as chips: suggestions come from the team, and a new skill can be typed in. */
export function SkillsInput({
  id,
  value,
  onChange,
  suggestions,
  invalid,
}: {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  suggestions: string[];
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <MultiCombobox<string>
      id={id}
      items={suggestions}
      value={value}
      onValueChange={onChange}
      itemToLabel={(skill) => skill}
      itemToKey={(skill) => skill.toLocaleLowerCase('ar')}
      placeholder={t('users.form.skillsPlaceholder')}
      emptyLabel={t('users.form.noMatches')}
      removeLabel={(label) => t('users.form.remove', { label })}
      create={{ label: (skill) => t('users.form.addSkill', { skill }), toItem: (skill) => skill }}
      invalid={invalid}
    />
  );
}
