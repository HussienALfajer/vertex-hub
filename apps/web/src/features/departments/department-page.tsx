import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type DepartmentDetailResponse, updateDepartmentSchema } from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import { ArrowRightIcon, PencilIcon, UserCogIcon, UsersIcon } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { isMissing, LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { can, useMe } from '../../lib/auth';
import { errorMessage, errorRole, type Failure, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { capabilityKey } from './capabilities';
import { departmentQuery, useUpdateDepartment } from './departments.queries';

export function DepartmentPage({ departmentId }: { departmentId: string }) {
  const { t } = useTranslation();
  const department = useQuery(departmentQuery(departmentId));
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/departments" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('departments.detail.back')}
        </Button>
      </div>
      {department.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-10 w-72" />
          <div className="grid gap-6 lg:grid-cols-3">
            <Skeleton className="h-56" />
            <Skeleton className="h-56 lg:col-span-2" />
          </div>
        </div>
      ) : department.isError ? (
        <LoadError
          message={
            isMissing(department.error)
              ? t('departments.detail.notFound')
              : t('departments.detail.loadError')
          }
          onRetry={() => department.refetch()}
          error={department.error}
        />
      ) : (
        <Department department={department.data} />
      )}
    </>
  );
}

function Department({ department }: { department: DepartmentDetailResponse }) {
  const { t } = useTranslation();
  const canManage = can(useMe(), 'users.manage');
  const capability = capabilityKey(department.code);

  return (
    <>
      <PageHeader
        title={department.name}
        description={capability ? t(capability) : undefined}
        actions={canManage && <RenameDialog department={department} />}
      />
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('departments.detail.managerCard')}</CardTitle>
          </CardHeader>
          {department.manager ? (
            <Link
              to="/team/$userId"
              params={{ userId: department.manager.id }}
              className="group flex min-w-0 items-center gap-3"
            >
              <Avatar name={department.manager.name} size="lg" />
              <span className="min-w-0 text-lg font-bold wrap-anywhere group-hover:underline">
                {department.manager.name}
              </span>
            </Link>
          ) : (
            <p className="text-muted-foreground">
              {canManage ? t('departments.detail.noManagerHint') : t('departments.noManager')}
            </p>
          )}
          {canManage && <ManagerDialog department={department} />}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-lg">{t('departments.detail.members')}</CardTitle>
            <Badge tone="neutral" className="tabular-nums">
              {formatNumber(department.members.length)}
            </Badge>
          </CardHeader>
          {department.members.length === 0 ? (
            <EmptyState
              icon={<UsersIcon />}
              title={t('departments.detail.noMembers')}
              description={canManage ? t('departments.detail.noMembersHint') : undefined}
              className="py-8"
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {department.members.map((member) => (
                <li key={member.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <Avatar name={member.name} size="md" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link
                      to="/team/$userId"
                      params={{ userId: member.id }}
                      className="truncate font-medium hover:underline"
                    >
                      {member.name}
                    </Link>
                    <span className="truncate text-sm text-muted-foreground">
                      {member.title ?? t('common.none')}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {member.id === department.manager?.id && (
                      <Badge tone="gold">{t('users.managerBadge')}</Badge>
                    )}
                    {member.status === 'invited' && (
                      <Badge tone="info">{t('users.statuses.invited')}</Badge>
                    )}
                    <Badge tone={member.isPrimary ? 'neutral' : 'outline'}>
                      {member.isPrimary
                        ? t('departments.detail.primary')
                        : t('departments.detail.secondary')}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

// Each dialog owns its trigger, so closing it puts the focus back on the button that opened it,
// and its form mounts on every opening, so it starts from the saved department.

function RenameDialog({ department }: { department: DepartmentDetailResponse }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <PencilIcon />
        {t('departments.detail.rename')}
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')}>
        <RenameForm department={department} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

const renameSchema = updateDepartmentSchema.pick({ name: true }).required();

function RenameForm({
  department,
  onDone,
}: {
  department: DepartmentDetailResponse;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateDepartment(department.id);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: standardSchemaResolver(renameSchema),
    defaultValues: { name: department.name },
  });

  const submit = handleSubmit(async ({ name }) => {
    setFailure(null);
    if (name === department.name) return onDone();
    try {
      await update.mutateAsync({ name });
      toast.add({ title: t('departments.detail.saved'), type: 'success' });
      onDone();
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
        <DialogTitle>{t('departments.detail.renameTitle')}</DialogTitle>
      </DialogHeader>
      <Field invalid={!!errors.name}>
        <FieldLabel>{t('departments.detail.name')}</FieldLabel>
        <Input autoFocus autoComplete="off" {...register('name')} />
        <FieldError match={!!errors.name} role={errorRole(errors.name)}>
          {fieldError(errors.name, t('departments.detail.nameError'))}
        </FieldError>
      </Field>
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

function ManagerDialog({ department }: { department: DepartmentDetailResponse }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="secondary" className="self-start" />}>
        <UserCogIcon />
        {t('departments.detail.changeManager')}
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')}>
        <ManagerForm department={department} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

const NO_MANAGER = 'none';

function ManagerForm({
  department,
  onDone,
}: {
  department: DepartmentDetailResponse;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateDepartment(department.id);
  const current = department.manager?.id ?? NO_MANAGER;
  const [choice, setChoice] = useState(current);
  const [failure, setFailure] = useState<Failure | null>(null);
  const picker = useRef<HTMLButtonElement>(null);
  // Only active members can manage (F01 rule 8).
  const items = [
    { value: NO_MANAGER, label: t('departments.detail.noManagerOption') },
    ...department.members
      .filter((member) => member.status === 'active')
      .map((member) => ({ value: member.id, label: member.name })),
  ];

  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (choice === current) return onDone();
    try {
      await update.mutateAsync({ managerId: choice === NO_MANAGER ? null : choice });
      toast.add({ title: t('departments.detail.saved'), type: 'success' });
      onDone();
    } catch (error) {
      // The chosen member left or was archived meanwhile: that is the picker's error.
      const field = error instanceof ApiError && error.code === 'MANAGER_NOT_MEMBER';
      setFailure({ message: errorMessage(t, error), field });
      if (field) picker.current?.focus();
    }
  }

  return (
    <form className="grid gap-4" onSubmit={save} noValidate>
      <DialogHeader>
        <DialogTitle>
          {t('departments.detail.changeManagerTitle', { name: department.name })}
        </DialogTitle>
        <DialogDescription>{t('departments.detail.managerHint')}</DialogDescription>
      </DialogHeader>
      <Field invalid={!!failure?.field}>
        <FieldLabel>{t('departments.detail.managerLabel')}</FieldLabel>
        <Select
          items={items}
          value={choice}
          onValueChange={(value) => setChoice(value ?? NO_MANAGER)}
        >
          <SelectTrigger ref={picker}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError match={!!failure?.field} role="alert">
          {failure?.message}
        </FieldError>
      </Field>
      {failure && !failure.field && <FormAlert>{failure.message}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
