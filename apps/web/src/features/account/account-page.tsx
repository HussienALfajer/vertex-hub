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
  IconTile,
  Input,
  PageHeader,
  PasswordInput,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import { KeyRoundIcon, LockIcon, ShieldCheckIcon, ShieldIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { authClient, meQuery, useMe } from '../../lib/auth';
import {
  errorMessage,
  type Failure,
  fieldError,
  passwordFailure,
  SCREEN_ERROR,
} from '../../lib/errors';
import { useReturnFocus } from '../../lib/use-return-focus';
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
  const skillsId = useId();
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
          <Input type="tel" dir="ltr" {...register('phone')} />
          <FieldDescription>{t('users.form.phoneHint')}</FieldDescription>
          <FieldError match={!!errors.phone}>{t('users.form.errors.phone')}</FieldError>
        </Field>
        <Field invalid={!!errors.skills}>
          <FieldLabel htmlFor={skillsId}>{t('users.form.skills')}</FieldLabel>
          <Controller
            control={control}
            name="skills"
            render={({ field }) => (
              <SkillsInput
                id={skillsId}
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
    setError,
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
      const refused = passwordFailure(t, error);
      // A wrong current password belongs to its field: mark it and put the cursor back there.
      if (refused.field) {
        setError(
          'currentPassword',
          { type: SCREEN_ERROR, message: refused.message },
          { shouldFocus: true },
        );
      } else setFailure(refused.message);
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
      {/* The current password on its own row; the new one and its confirmation side by side. */}
      <form className="grid gap-5 sm:grid-cols-2" onSubmit={submit} noValidate>
        <div className="grid gap-5 sm:col-span-2 sm:grid-cols-2">
          <PasswordField
            label={t('account.password.current')}
            autoComplete="current-password"
            invalid={!!errors.currentPassword}
            error={fieldError(errors.currentPassword, t('account.password.errors.current'))}
            {...register('currentPassword')}
          />
        </div>
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
          <div className="sm:col-span-2">
            <FormAlert>{failure}</FormAlert>
          </div>
        )}
        <Button type="submit" className="justify-self-end sm:col-span-2" disabled={isSubmitting}>
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
}: { label: string; invalid: boolean; error: string } & Omit<
  React.ComponentProps<typeof PasswordInput>,
  'showLabel' | 'hideLabel'
>) {
  const { t } = useTranslation();
  return (
    <Field invalid={invalid}>
      <FieldLabel>{label}</FieldLabel>
      <PasswordInput
        showLabel={t('common.showPassword')}
        hideLabel={t('common.hidePassword')}
        {...props}
      />
      <FieldError match={invalid}>{error}</FieldError>
    </Field>
  );
}

function TwoFactorCard() {
  const { t } = useTranslation();
  const me = useMe();
  const { enabled, required } = me.twoFactor;
  const [dialog, setDialog] = useState<'disable' | 'regenerate' | null>(null);
  // Back to the button that opened the dialog; after turning 2FA off, to "Turn on" instead.
  const enableLink = useRef<HTMLAnchorElement>(null);
  const returnFocus = useReturnFocus(enableLink);
  const open = (mode: 'disable' | 'regenerate') => (event: React.MouseEvent<HTMLElement>) => {
    returnFocus.from(event.currentTarget);
    setDialog(mode);
  };

  return (
    <Card className="lg:sticky lg:top-24">
      <div className="flex items-start justify-between gap-3">
        <IconTile tone={enabled ? 'success' : 'muted'}>
          {enabled ? <ShieldCheckIcon /> : <ShieldIcon />}
        </IconTile>
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
          {required
            ? t('account.twoFactor.requiredHint')
            : enabled
              ? t('account.twoFactor.onHint')
              : t('account.twoFactor.offHint')}
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-2">
        {enabled ? (
          <>
            <Button variant="outline" onClick={open('regenerate')}>
              {t('account.twoFactor.regenerate')}
            </Button>
            {!required && (
              <Button variant="ghost" onClick={open('disable')}>
                {t('account.twoFactor.disableAction')}
              </Button>
            )}
          </>
        ) : (
          <Button render={<Link ref={enableLink} to="/setup-two-factor" />}>
            {t('account.twoFactor.enable')}
          </Button>
        )}
      </div>
      <PasswordDialog
        mode={dialog}
        onClose={() => setDialog(null)}
        finalFocus={returnFocus.target}
      />
    </Card>
  );
}

/** Confirms a 2FA change with the password: turning it off, or new backup codes (shown once). */
function PasswordDialog({
  mode,
  onClose,
  finalFocus,
}: {
  mode: 'disable' | 'regenerate' | null;
  onClose: () => void;
  finalFocus: () => HTMLElement | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  // The content stays as it was while the dialog fades out.
  const [shown, setShown] = useState(mode);
  if (mode && mode !== shown) setShown(mode);

  function reset() {
    setPassword('');
    setCodes(null);
    setFailure(null);
  }

  function refuse(error: unknown) {
    const refused = passwordFailure(t, error);
    setFailure(refused);
    if (refused.field) passwordInput.current?.focus();
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setPending(true);
    try {
      if (shown === 'disable') {
        const { error } = await authClient.twoFactor.disable({ password });
        if (error) return refuse(error);
        await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
        toast.add({ title: t('account.twoFactor.disabled'), type: 'success' });
        onClose();
      } else {
        const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
        if (error || !data) return refuse(error);
        setCodes(data.backupCodes);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={mode !== null}
      // The new codes are shown once and the old ones are gone: only the "saved" button closes.
      disablePointerDismissal={!!codes}
      onOpenChange={(open, details) => {
        if (open || (codes && details.reason !== 'close-press')) return;
        onClose();
      }}
      onOpenChangeComplete={(open) => !open && reset()}
    >
      <DialogContent closeLabel={codes ? undefined : t('common.close')} finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>
            {shown === 'disable'
              ? t('account.twoFactor.disableTitle')
              : t('account.twoFactor.regenerateTitle')}
          </DialogTitle>
          <DialogDescription>
            {codes
              ? t('twoFactorSetup.codesIntro')
              : shown === 'disable'
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
            <Field invalid={failure?.field}>
              <FieldLabel>{t('account.twoFactor.password')}</FieldLabel>
              <PasswordInput
                showLabel={t('common.showPassword')}
                hideLabel={t('common.hidePassword')}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
                ref={passwordInput}
              />
              <FieldError match={!!failure?.field} role="alert">
                {failure?.message}
              </FieldError>
            </Field>
            {failure && !failure.field && <FormAlert>{failure.message}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button
                type="submit"
                variant={shown === 'disable' ? 'destructive' : 'primary'}
                disabled={pending || !password}
              >
                {shown === 'disable'
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
