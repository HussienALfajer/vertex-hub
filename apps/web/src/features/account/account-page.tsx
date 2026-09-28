import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type ChangePasswordForm,
  changePasswordFormSchema,
  type UpdateOwnProfile,
  type UpdateOwnProfileInput,
  type UserResponse,
  updateOwnProfileSchema,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
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
  PageHeader,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import { KeyRoundIcon, LockIcon, ShieldCheckIcon, ShieldIcon } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { authClient, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { DepartmentChips } from '../users/user-badges';
import { SkillsInput } from '../users/user-form';
import { skillsQuery, userQuery, useUpdateOwnProfile } from '../users/users.queries';
import { BackupCodes } from './backup-codes';

export function AccountPage() {
  const { t } = useTranslation();
  const me = useMe();
  const user = useQuery(userQuery(me.user.id));

  return (
    <>
      <PageHeader title={t('account.title')} description={t('account.subtitle')} />
      {user.isPending ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      ) : user.isError ? (
        <LoadError message={t('users.profile.loadError')} onRetry={() => user.refetch()} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <ProfileCard user={user.data} />
            <ContactForm user={user.data} />
            <PasswordForm />
          </div>
          <TwoFactorCard />
        </div>
      )}
    </>
  );
}

function ProfileCard({ user }: { user: UserResponse }) {
  const { t } = useTranslation();
  const me = useMe();
  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar name={user.name} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-xl font-bold">{user.name}</h2>
          <span dir="ltr" className="self-start text-sm text-muted-foreground">
            {user.email}
          </span>
          {user.title && <span className="text-sm">{user.title}</span>}
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <DepartmentChips departments={user.departments} />
        <div className="flex flex-wrap gap-1.5">
          {me.roles.map((role) => (
            <Badge key={role} tone={role === 'general_manager' ? 'brand' : 'outline'}>
              {t(`roles.${role}`)}
            </Badge>
          ))}
        </div>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LockIcon className="size-4 shrink-0" />
          {t('account.profileHint')}
        </p>
      </div>
    </Card>
  );
}

function ContactForm({ user }: { user: UserResponse }) {
  const { t } = useTranslation();
  const update = useUpdateOwnProfile();
  const skills = useQuery(skillsQuery);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<UpdateOwnProfileInput, unknown, UpdateOwnProfile>({
    resolver: standardSchemaResolver(updateOwnProfileSchema),
    defaultValues: { phone: user.phone ?? '', skills: user.skills },
  });

  const submit = handleSubmit(async (values) => {
    setFailure(null);
    try {
      const saved = await update.mutateAsync(values);
      reset({ phone: saved.phone ?? '', skills: saved.skills });
      toast.add({ title: t('account.saved'), type: 'success' });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('account.contact')}</CardTitle>
        <CardDescription className="text-sm">{t('account.contactHint')}</CardDescription>
      </CardHeader>
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        <Field invalid={!!errors.phone}>
          <FieldLabel>{t('users.form.phone')}</FieldLabel>
          <Input type="tel" dir="ltr" className="text-end" {...register('phone')} />
          <FieldDescription>{t('users.form.phoneHint')}</FieldDescription>
          <FieldError match={!!errors.phone}>{t('users.form.errors.phone')}</FieldError>
        </Field>
        <Field invalid={!!errors.skills}>
          <FieldLabel>{t('users.form.skills')}</FieldLabel>
          <Controller
            control={control}
            name="skills"
            render={({ field }) => (
              <SkillsInput
                value={field.value ?? []}
                onChange={field.onChange}
                suggestions={skills.data?.items ?? []}
                invalid={!!errors.skills}
              />
            )}
          />
          <FieldError match={!!errors.skills}>{t('users.form.errors.skills')}</FieldError>
        </Field>
        {failure && <FormAlert>{failure}</FormAlert>}
        <Button type="submit" className="self-end" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? t('common.saving') : t('common.save')}
        </Button>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordForm>({
    resolver: standardSchemaResolver(changePasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });

  const submit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setFailure(null);
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (error) {
      setFailure(errorMessage(t, error));
      return;
    }
    reset();
    toast.add({ title: t('account.password.changed'), type: 'success' });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRoundIcon className="size-5 text-muted-foreground" />
          {t('account.password.title')}
        </CardTitle>
        <CardDescription className="text-sm">{t('account.password.hint')}</CardDescription>
      </CardHeader>
      <form className="grid gap-5 md:grid-cols-3" onSubmit={submit} noValidate>
        <PasswordField
          label={t('account.password.current')}
          autoComplete="current-password"
          invalid={!!errors.currentPassword}
          error={t('account.password.errors.current')}
          {...register('currentPassword')}
        />
        <PasswordField
          label={t('account.password.next')}
          autoComplete="new-password"
          invalid={!!errors.newPassword}
          error={t('account.password.errors.tooShort')}
          {...register('newPassword')}
        />
        <PasswordField
          label={t('account.password.confirm')}
          autoComplete="new-password"
          invalid={!!errors.confirm}
          error={t('account.password.errors.mismatch')}
          {...register('confirm')}
        />
        {failure && (
          <div className="md:col-span-3">
            <FormAlert>{failure}</FormAlert>
          </div>
        )}
        <Button type="submit" className="justify-self-end md:col-span-3" disabled={isSubmitting}>
          {isSubmitting ? t('common.saving') : t('account.password.submit')}
        </Button>
      </form>
    </Card>
  );
}

function PasswordField({
  label,
  invalid,
  error,
  ...props
}: { label: string; invalid: boolean; error: string } & React.ComponentProps<typeof Input>) {
  return (
    <Field invalid={invalid}>
      <FieldLabel>{label}</FieldLabel>
      <Input type="password" dir="ltr" className="text-end" {...props} />
      <FieldError match={invalid}>{error}</FieldError>
    </Field>
  );
}

function TwoFactorCard() {
  const { t } = useTranslation();
  const me = useMe();
  const { enabled, required } = me.twoFactor;
  const [dialog, setDialog] = useState<'disable' | 'regenerate' | null>(null);

  return (
    <Card className="lg:sticky lg:top-24">
      <div className="flex items-start justify-between gap-3">
        <span
          className={`flex size-11 items-center justify-center rounded-lg ${
            enabled
              ? 'bg-status-success text-status-success-foreground'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {enabled ? <ShieldCheckIcon className="size-5" /> : <ShieldIcon className="size-5" />}
        </span>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Badge tone={enabled ? 'success' : 'neutral'}>
            {enabled ? t('account.twoFactor.on') : t('account.twoFactor.off')}
          </Badge>
          {required && <Badge tone="gold">{t('account.twoFactor.required')}</Badge>}
        </div>
      </div>
      <CardHeader>
        <CardTitle className="text-lg">{t('account.twoFactor.title')}</CardTitle>
        <CardDescription className="text-sm">
          {required ? t('account.twoFactor.requiredHint') : t('account.twoFactor.optionalHint')}
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-2">
        {enabled ? (
          <>
            <Button variant="outline" onClick={() => setDialog('regenerate')}>
              {t('account.twoFactor.regenerate')}
            </Button>
            {!required && (
              <Button variant="ghost" onClick={() => setDialog('disable')}>
                {t('account.twoFactor.disable')}
              </Button>
            )}
          </>
        ) : (
          <Button render={<Link to="/setup-two-factor" />}>{t('account.twoFactor.enable')}</Button>
        )}
      </div>
      <PasswordDialog mode={dialog} onClose={() => setDialog(null)} />
    </Card>
  );
}

/** Confirms a 2FA change with the password: turning it off, or new backup codes (shown once). */
function PasswordDialog({
  mode,
  onClose,
}: {
  mode: 'disable' | 'regenerate' | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    setPassword('');
    setCodes(null);
    setFailure(null);
    onClose();
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setPending(true);
    try {
      if (mode === 'disable') {
        const { error } = await authClient.twoFactor.disable({ password });
        if (error) return setFailure(errorMessage(t, error));
        await queryClient.invalidateQueries({ queryKey: ['me'] });
        toast.add({ title: t('account.twoFactor.disabled'), type: 'success' });
        close();
      } else {
        const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
        if (error || !data) return setFailure(errorMessage(t, error));
        setCodes(data.backupCodes);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {mode === 'disable'
              ? t('account.twoFactor.disableTitle')
              : t('account.twoFactor.regenerateTitle')}
          </DialogTitle>
          <DialogDescription>
            {codes
              ? t('twoFactorSetup.codesIntro')
              : mode === 'disable'
                ? t('account.twoFactor.disableBody')
                : t('account.twoFactor.regenerateBody')}
          </DialogDescription>
        </DialogHeader>
        {codes ? (
          <>
            <BackupCodes codes={codes} />
            <DialogFooter>
              <DialogClose render={<Button />}>{t('twoFactorSetup.confirmSaved')}</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form className="grid gap-4" onSubmit={confirm}>
            <Field>
              <FieldLabel>{t('account.twoFactor.password')}</FieldLabel>
              <Input
                type="password"
                dir="ltr"
                className="text-end"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
              />
            </Field>
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button
                type="submit"
                variant={mode === 'disable' ? 'destructive' : 'primary'}
                disabled={pending || !password}
              >
                {mode === 'disable'
                  ? t('account.twoFactor.disable')
                  : t('account.twoFactor.regenerateSubmit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
