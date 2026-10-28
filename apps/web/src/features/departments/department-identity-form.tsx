import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useNavigate } from '@tanstack/react-router';
import {
  type CreateDepartment,
  createDepartmentSchema,
  type DepartmentDetailResponse,
} from '@vertex-hub/contracts';
import {
  Button,
  DepartmentColorPicker,
  DepartmentIconPicker,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { useCreateDepartment, useUpdateDepartment } from './departments.queries';

/**
 * Name, description, color and icon of a department (rule 2): a new one, or the saved one's
 * identity when `department` is given. Lives inside a dialog; `onDone` closes it.
 */
export function DepartmentIdentityForm({
  department,
  onDone,
}: {
  department?: DepartmentDetailResponse;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateDepartment();
  const update = useUpdateDepartment(department?.id ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  const colorLabel = useId();
  const iconLabel = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateDepartment>({
    resolver: standardSchemaResolver(createDepartmentSchema),
    defaultValues: {
      name: department?.name ?? '',
      description: department?.description ?? '',
      color: department?.color ?? 'c1',
      icon: department?.icon ?? 'briefcase',
    },
  });

  const submit = handleSubmit(async (values) => {
    setFailure(null);
    const input = { ...values, description: values.description || null };
    try {
      if (department) {
        await update.mutateAsync(input);
        toast.add({ title: t('departments.detail.saved'), type: 'success' });
        onDone();
      } else {
        const created = await create.mutateAsync(input);
        toast.add({ title: t('departments.create.created'), type: 'success' });
        onDone();
        await navigate({
          to: '/departments/$departmentId',
          params: { departmentId: created.id },
        });
      }
    } catch (error) {
      // A taken name belongs to the field: mark it and put the cursor back there.
      if (error instanceof ApiError && error.code === 'DEPARTMENT_NAME_TAKEN') {
        setError(
          'name',
          { type: SCREEN_ERROR, message: errorMessage(t, error) },
          { shouldFocus: true },
        );
      } else setFailure(errorMessage(t, error));
    }
  });

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>
          {department ? t('departments.detail.editTitle') : t('departments.create.title')}
        </DialogTitle>
      </DialogHeader>
      <Field invalid={!!errors.name}>
        <FieldLabel>{t('departments.detail.name')}</FieldLabel>
        <Input autoFocus autoComplete="off" {...register('name')} />
        <FieldError match={!!errors.name} role={errorRole(errors.name)}>
          {fieldError(errors.name, t('departments.detail.nameError'))}
        </FieldError>
      </Field>
      <Field invalid={!!errors.description}>
        <FieldLabel>{t('departments.detail.description')}</FieldLabel>
        <Textarea rows={3} {...register('description')} />
        <FieldDescription>{t('departments.detail.descriptionHint')}</FieldDescription>
        <FieldError match={!!errors.description}>
          {t('departments.detail.descriptionError')}
        </FieldError>
      </Field>
      <div className="grid gap-2">
        <span id={colorLabel} className="text-sm font-medium">
          {t('departments.detail.color')}
        </span>
        <Controller
          control={control}
          name="color"
          render={({ field }) => (
            <DepartmentColorPicker
              aria-labelledby={colorLabel}
              value={field.value}
              onValueChange={field.onChange}
              optionLabel={(color) => t(`departments.colors.${color}`)}
            />
          )}
        />
      </div>
      <div className="grid gap-2">
        <span id={iconLabel} className="text-sm font-medium">
          {t('departments.detail.icon')}
        </span>
        <Controller
          control={control}
          name="icon"
          render={({ field }) => (
            <DepartmentIconPicker
              aria-labelledby={iconLabel}
              color={watch('color')}
              value={field.value}
              onValueChange={field.onChange}
              optionLabel={(icon) => t(`departments.icons.${icon}`)}
            />
          )}
        />
      </div>
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? t('common.saving')
            : department
              ? t('common.save')
              : t('departments.create.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
