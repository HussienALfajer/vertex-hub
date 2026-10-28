import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { DepartmentDetailResponse, UserResponse } from '@vertex-hub/contracts';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  MultiCombobox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowLeftRightIcon,
  EllipsisIcon,
  StarIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
} from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { userListQuery } from '../users/users.queries';
import { DepartmentDot } from './department-badge';
import {
  departmentListQuery,
  useAddDepartmentMembers,
  useDepartmentMemberAction,
} from './departments.queries';

type Member = DepartmentDetailResponse['members'][number];

/** Rules 17–21: the manager, the members and, for `users.manage`, their changes. */
export function DepartmentMembers({ department }: { department: DepartmentDetailResponse }) {
  const { t } = useTranslation();
  const canManage = can(useMe(), 'users.manage') && !department.archivedAt;
  const [failure, setFailure] = useState<{ memberId: string; message: string } | null>(null);

  return (
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
            <Avatar
              name={department.manager.name}
              src={imageSrc(department.manager.imageId, 'lg')}
              size="lg"
            />
            <span className="min-w-0 text-lg font-bold wrap-anywhere group-hover:underline">
              {department.manager.name}
            </span>
          </Link>
        ) : (
          <p className="text-muted-foreground">
            {canManage ? t('departments.detail.noManagerHint') : t('departments.noManager')}
          </p>
        )}
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            {t('departments.detail.members')}
            <Badge tone="neutral" className="tabular-nums">
              {formatNumber(department.members.length)}
            </Badge>
          </CardTitle>
          {canManage && <AddMembersDialog department={department} />}
        </CardHeader>
        {department.members.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title={t('departments.detail.noMembers')}
            description={
              department.archivedAt
                ? t('departments.detail.archivedMembers')
                : canManage
                  ? t('departments.detail.noMembersHint')
                  : undefined
            }
            className="py-8"
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {department.members.map((member) => (
              <li key={member.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <Avatar name={member.name} src={imageSrc(member.imageId, 'md')} size="md" />
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
                    {canManage && (
                      <MemberMenu
                        department={department}
                        member={member}
                        onFailure={(message) =>
                          setFailure(message ? { memberId: member.id, message } : null)
                        }
                      />
                    )}
                  </div>
                </div>
                {failure?.memberId === member.id && <FormAlert>{failure.message}</FormAlert>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * A member's changes: make primary here, move, remove. The manager's membership can be neither
 * moved nor removed (rule 21) and a primary one is never removed (rule 20): the menu says why.
 */
function MemberMenu({
  department,
  member,
  onFailure,
}: {
  department: DepartmentDetailResponse;
  member: Member;
  onFailure: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const action = useDepartmentMemberAction(department.id);
  const [dialog, setDialog] = useState<'move' | 'remove' | null>(null);
  const isManager = member.id === department.manager?.id;

  async function makePrimary() {
    onFailure(null);
    try {
      await action.mutateAsync({ kind: 'primary', userId: member.id });
      toast.add({ title: t('departments.members.primaryDone', { name: member.name }) });
    } catch (error) {
      onFailure(errorMessage(t, error));
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<IconButton label={t('departments.members.actions', { name: member.name })} />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-72">
          {!member.isPrimary && (
            <DropdownMenuItem disabled={action.isPending} onClick={makePrimary}>
              <StarIcon />
              {t('departments.members.makePrimary')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={isManager} onClick={() => setDialog('move')}>
            <ArrowLeftRightIcon />
            {t('departments.members.move')}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={isManager || member.isPrimary}
            onClick={() => setDialog('remove')}
          >
            <Trash2Icon />
            {t('departments.members.remove')}
          </DropdownMenuItem>
          {(isManager || member.isPrimary) && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {isManager
                ? t('departments.members.managerLocked')
                : t('departments.members.primaryLocked')}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <MoveDialog
        department={department}
        member={member}
        open={dialog === 'move'}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'remove'}
        onClose={() => setDialog(null)}
        title={t('departments.members.removeTitle', { name: member.name })}
        body={t('departments.members.removeBody', { department: department.name })}
        action={t('departments.members.remove')}
        destructive
        pending={action.isPending}
        onConfirm={async () => {
          await action.mutateAsync({ kind: 'remove', userId: member.id });
          toast.add({ title: t('departments.members.removed', { name: member.name }) });
        }}
      />
    </>
  );
}

/** Rule 19: the membership moves with its kind to another active department. */
function MoveDialog({
  department,
  member,
  open,
  onClose,
}: {
  department: DepartmentDetailResponse;
  member: Member;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <MoveForm department={department} member={member} onDone={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function MoveForm({
  department,
  member,
  onDone,
}: {
  department: DepartmentDetailResponse;
  member: Member;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const action = useDepartmentMemberAction(department.id);
  const departments = useQuery(departmentListQuery);
  const targets = (departments.data?.items ?? []).filter(
    (other) => !other.archivedAt && other.id !== department.id,
  );
  const [target, setTarget] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const pickerId = useId();

  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!target) return setMissing(true);
    try {
      await action.mutateAsync({ kind: 'move', userId: member.id, departmentId: target });
      toast.add({ title: t('departments.members.moved', { name: member.name }) });
      onDone();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <form className="grid gap-4" onSubmit={save} noValidate>
      <DialogHeader>
        <DialogTitle>{t('departments.members.moveTitle', { name: member.name })}</DialogTitle>
        <DialogDescription>
          {member.isPrimary
            ? t('departments.members.moveHintPrimary')
            : t('departments.members.moveHintSecondary')}
        </DialogDescription>
      </DialogHeader>
      <Field invalid={missing}>
        <FieldLabel htmlFor={pickerId}>{t('departments.members.moveTo')}</FieldLabel>
        <Select
          items={targets.map((other) => ({ value: other.id, label: other.name }))}
          value={target}
          onValueChange={(value) => {
            setTarget(value);
            setMissing(false);
          }}
        >
          <SelectTrigger id={pickerId}>
            <SelectValue placeholder={t('departments.members.moveToPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {targets.map((other) => (
              <SelectItem key={other.id} value={other.id}>
                <DepartmentDot department={other} />
                {other.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError match={missing}>{t('departments.members.moveToMissing')}</FieldError>
      </Field>
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={action.isPending}>
          {action.isPending ? t('common.saving') : t('departments.members.moveSubmit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

const ADD_LIMIT = 20;

/** Rule 17: up to 20 users who are not members join as secondary members, invited ones too. */
function AddMembersDialog({ department }: { department: DepartmentDetailResponse }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <UserPlusIcon />
        {t('departments.members.add')}
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')}>
        <AddMembersForm department={department} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddMembersForm({
  department,
  onDone,
}: {
  department: DepartmentDetailResponse;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const add = useAddDepartmentMembers(department.id);
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<UserResponse[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const pickerId = useId();
  const text = search || undefined;
  const active = useQuery(userListQuery({ status: 'active', search: text, pageSize: 50 }));
  const invited = useQuery(userListQuery({ status: 'invited', search: text, pageSize: 50 }));
  const members = new Set(department.members.map((member) => member.id));
  const options = [...(active.data?.items ?? []), ...(invited.data?.items ?? [])]
    .filter((user) => !members.has(user.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (chosen.length === 0) return setMissing(true);
    try {
      await add.mutateAsync(chosen.map((user) => user.id));
      toast.add({
        title: t('departments.members.added', {
          count: chosen.length,
          n: formatNumber(chosen.length),
        }),
        type: 'success',
      });
      onDone();
    } catch (error) {
      // Edge case 13: all or nothing; the message names the refusal.
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <form className="grid gap-4" onSubmit={save} noValidate>
      <DialogHeader>
        <DialogTitle>{t('departments.members.addTitle', { name: department.name })}</DialogTitle>
        <DialogDescription>{t('departments.members.addHint')}</DialogDescription>
      </DialogHeader>
      <Field invalid={missing}>
        <FieldLabel htmlFor={pickerId}>{t('departments.members.people')}</FieldLabel>
        <MultiCombobox
          id={pickerId}
          items={options}
          onSearch={setSearch}
          value={chosen}
          onValueChange={(next) => {
            setChosen(next.slice(0, ADD_LIMIT));
            setMissing(false);
          }}
          itemToLabel={(user) => user.name}
          itemToKey={(user) => user.id}
          placeholder={t('departments.members.peoplePlaceholder')}
          emptyLabel={t('common.noMatches')}
          removeLabel={(label) => t('common.remove', { label })}
          invalid={missing}
        />
        <FieldDescription>
          {t('departments.members.limit', { n: formatNumber(ADD_LIMIT) })}
        </FieldDescription>
        <FieldError match={missing}>{t('departments.members.peopleMissing')}</FieldError>
      </Field>
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? t('common.saving') : t('departments.members.addSubmit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
