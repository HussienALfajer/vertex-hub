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
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
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
            department.error instanceof ApiError && department.error.status === 404
              ? t('departments.detail.notFound')
              : t('departments.detail.loadError')
          }
          onRetry={() => department.refetch()}
        />
      ) : (
        <Department department={department.data} />
      )}
    </>
  );
}

function Department({ department }: { department: DepartmentDetailResponse }) {
  const { t } = useTranslation();
  const me = useMe();
  const manager = can(me, 'users.manage');
  const capability = capabilityKey(department.code);
  const [editing, setEditing] = useState<'name' | 'manager' | null>(null);

  return (
    <>
      <PageHeader
        title={department.name}
        description={capability ? t(capability) : undefined}
        actions={
          manager && (
            <Button variant="outline" onClick={() => setEditing('name')}>
              <PencilIcon />
              {t('departments.detail.rename')}
            </Button>
          )
        }
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
              className="group flex items-center gap-3"
            >
              <Avatar name={department.manager.name} size="lg" />
              <span className="text-lg font-bold group-hover:underline">
                {department.manager.name}
              </span>
            </Link>
          ) : (
            <p className="text-muted-foreground">
              {manager ? t('departments.detail.noManagerHint') : t('departments.noManager')}
            </p>
          )}
          {manager && (
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => setEditing('manager')}
            >
              <UserCogIcon />
              {t('departments.detail.changeManager')}
            </Button>
          )}
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
              description={manager ? t('departments.detail.noMembersHint') : undefined}
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

      {manager && (
        <>
          <RenameDialog
            department={department}
            open={editing === 'name'}
            onClose={() => setEditing(null)}
          />
          <ManagerDialog
            department={department}
            open={editing === 'manager'}
            onClose={() => setEditing(null)}
          />
        </>
      )}
    </>
  );
}

const renameSchema = updateDepartmentSchema.pick({ name: true }).required();

function RenameDialog({
  department,
  open,
  onClose,
}: {
  department: DepartmentDetailResponse;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateDepartment(department.id);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: standardSchemaResolver(renameSchema),
    values: { name: department.name },
  });

  const submit = handleSubmit(async ({ name }) => {
    setFailure(null);
    try {
      await update.mutateAsync({ name });
      toast.add({ title: t('departments.detail.saved'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          setFailure(null);
          onClose();
        }
      }}
    >
      <DialogContent closeLabel={t('common.close')}>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('departments.detail.renameTitle')}</DialogTitle>
          </DialogHeader>
          <Field invalid={!!errors.name}>
            <FieldLabel>{t('departments.detail.name')}</FieldLabel>
            <Input autoFocus {...register('name')} />
            <FieldError match={!!errors.name}>{t('departments.detail.nameError')}</FieldError>
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
      </DialogContent>
    </Dialog>
  );
}

const NO_MANAGER = 'none';

function ManagerDialog({
  department,
  open,
  onClose,
}: {
  department: DepartmentDetailResponse;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateDepartment(department.id);
  const currentManager = department.manager?.id ?? NO_MANAGER;
  const [choice, setChoice] = useState(currentManager);
  const [failure, setFailure] = useState<string | null>(null);

  // Start from the current manager each time the dialog opens.
  useEffect(() => {
    if (open) setChoice(currentManager);
  }, [open, currentManager]);
  // Only active members can manage (F01 rule 8).
  const items = [
    { value: NO_MANAGER, label: t('departments.detail.noManagerOption') },
    ...department.members
      .filter((member) => member.status === 'active')
      .map((member) => ({ value: member.id, label: member.name })),
  ];

  async function save() {
    setFailure(null);
    try {
      await update.mutateAsync({ managerId: choice === NO_MANAGER ? null : choice });
      toast.add({ title: t('departments.detail.saved'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setFailure(null);
          onClose();
        }
      }}
    >
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {t('departments.detail.changeManagerTitle', { name: department.name })}
          </DialogTitle>
          <DialogDescription>{t('departments.detail.managerHint')}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>{t('departments.detail.managerLabel')}</FieldLabel>
          <Select
            items={items}
            value={choice}
            onValueChange={(value) => setChoice(value ?? NO_MANAGER)}
          >
            <SelectTrigger>
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
        </Field>
        {failure && <FormAlert>{failure}</FormAlert>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('common.cancel')}</DialogClose>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
