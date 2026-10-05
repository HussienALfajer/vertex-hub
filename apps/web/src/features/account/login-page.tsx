import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { backupCodeSchema, type SignIn, signInSchema, totpCodeSchema } from '@vertex-hub/contracts';
import { Button, Field, FieldError, FieldLabel, Input, OtpField } from '@vertex-hub/ui';
import { ArrowRightIcon, KeyRoundIcon, SmartphoneIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AuthHeading, AuthLayout } from '../../components/auth-layout';
import { FormAlert } from '../../components/form-alert';
import { authClient, meQuery, needsTwoFactorSetup, safeRedirect } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';

type Step = 'password' | 'totp' | 'backup';

/** Sign-in with the password, then the authenticator or a backup code (F01 rules 15, 16). */
export function LoginPage({ redirect }: { redirect?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('password');

  /** Loads the new session, then goes where the user was heading (or sets up 2FA first). */
  async function enter() {
    // Replace the cached "no session" answer before the guarded route reads it.
    const me = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
    if (me && needsTwoFactorSetup(me)) {
      await router.navigate({ to: '/setup-two-factor', replace: true });
      return;
    }
    await router.navigate({ href: safeRedirect(redirect), replace: true });
  }

  return (
    <AuthLayout>
      {step === 'password' && (
        <>
          <AuthHeading title={t('login.title')} subtitle={t('login.subtitle')} />
          <SignInForm onSignedIn={enter} onTwoFactor={() => setStep('totp')} />
        </>
      )}
      {step === 'totp' && (
        <>
          <AuthHeading
            title={t('login.twoFactor.title')}
            subtitle={t('login.twoFactor.subtitle')}
          />
          <TotpForm onVerified={enter} />
          <StepLinks
            onSwitch={() => setStep('backup')}
            switchLabel={t('login.twoFactor.useBackup')}
            switchIcon={<KeyRoundIcon />}
            onBack={() => setStep('password')}
          />
        </>
      )}
      {step === 'backup' && (
        <>
          <AuthHeading
            title={t('login.twoFactor.backupTitle')}
            subtitle={t('login.twoFactor.backupSubtitle')}
          />
          <BackupCodeForm onVerified={enter} />
          <StepLinks
            onSwitch={() => setStep('totp')}
            switchLabel={t('login.twoFactor.useApp')}
            switchIcon={<SmartphoneIcon />}
            onBack={() => setStep('password')}
          />
        </>
      )}
    </AuthLayout>
  );
}

function SignInForm({
  onSignedIn,
  onTwoFactor,
}: {
  onSignedIn: () => Promise<void>;
  onTwoFactor: () => void;
}) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignIn>({
    resolver: standardSchemaResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null);
    const { data, error } = await authClient.signIn.email(values);
    if (error) {
      if (error.status === 401) setFailure(t('login.errors.invalid'));
      else if (error.status === 429) setFailure(t('login.errors.tooMany'));
      else setFailure(t('login.errors.generic'));
      return;
    }
    // Users with 2FA get a second step before the session exists (F01 rule 16).
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) return onTwoFactor();
    await onSignedIn();
  });

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <Field invalid={!!errors.email}>
        <FieldLabel>{t('login.email')}</FieldLabel>
        <Input
          type="email"
          dir="ltr"
          className="text-end"
          autoComplete="username"
          autoFocus
          {...register('email')}
        />
        <FieldError match={!!errors.email}>{t('login.errors.email')}</FieldError>
      </Field>
      <Field invalid={!!errors.password}>
        <FieldLabel>{t('login.password')}</FieldLabel>
        <Input
          type="password"
          dir="ltr"
          className="text-end"
          autoComplete="current-password"
          {...register('password')}
        />
        <FieldError match={!!errors.password}>{t('login.errors.password')}</FieldError>
      </Field>
      <Button
        variant="link"
        size="sm"
        className="-mt-3 self-start px-0"
        render={<Link to="/forgot-password" />}
      >
        {t('login.forgot')}
      </Button>
      {failure && <FormAlert>{failure}</FormAlert>}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? t('login.submitting') : t('login.submit')}
      </Button>
    </form>
  );
}

function TotpForm({ onVerified }: { onVerified: () => Promise<void> }) {
  const { t } = useTranslation();
  const id = useId();
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function verify(value: string) {
    if (!totpCodeSchema.safeParse(value).success || pending) return;
    setFailure(null);
    setPending(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code: value });
    if (error) {
      setPending(false);
      setCode('');
      return setFailure(errorMessage(t, error));
    }
    await onVerified();
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void verify(code);
      }}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {t('login.twoFactor.code')}
        </label>
        <OtpField
          id={id}
          autoFocus
          value={code}
          onValueChange={setCode}
          onValueComplete={(value) => void verify(value)}
          slotLabel={(position) => t('twoFactorSetup.digit', { position })}
          disabled={pending}
          aria-invalid={failure ? true : undefined}
        />
      </div>
      {failure && <FormAlert>{failure}</FormAlert>}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={pending || !totpCodeSchema.safeParse(code).success}
      >
        {pending ? t('login.twoFactor.submitting') : t('login.twoFactor.submit')}
      </Button>
    </form>
  );
}

function BackupCodeForm({ onVerified }: { onVerified: () => Promise<void> }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = backupCodeSchema.safeParse(code);
    if (!parsed.success) return setFailure(t('login.twoFactor.backupError'));
    setFailure(null);
    setPending(true);
    const { error } = await authClient.twoFactor.verifyBackupCode({ code: parsed.data });
    if (error) {
      setPending(false);
      return setFailure(errorMessage(t, error));
    }
    await onVerified();
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      <Field invalid={!!failure}>
        <FieldLabel>{t('login.twoFactor.backupCode')}</FieldLabel>
        <Input
          dir="ltr"
          className="text-center text-lg tabular-nums"
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      {failure && <FormAlert>{failure}</FormAlert>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? t('login.twoFactor.submitting') : t('login.twoFactor.submit')}
      </Button>
    </form>
  );
}

function StepLinks({
  onSwitch,
  switchLabel,
  switchIcon,
  onBack,
}: {
  onSwitch: () => void;
  switchLabel: string;
  switchIcon: React.ReactNode;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
      <Button variant="ghost" size="sm" onClick={onSwitch}>
        {switchIcon}
        {switchLabel}
      </Button>
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowRightIcon className="ltr:-scale-x-100" />
        {t('login.twoFactor.back')}
      </Button>
    </div>
  );
}
