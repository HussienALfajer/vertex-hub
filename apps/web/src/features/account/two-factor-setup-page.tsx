import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { totpCodeSchema } from '@vertex-hub/contracts';
import { Button, Checkbox, cn, Field, FieldLabel, Input, OtpField, toast } from '@vertex-hub/ui';
import { CheckIcon, CopyIcon, LogOutIcon, ShieldAlertIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthHeading, AuthLayout } from '../../components/auth-layout';
import { FormAlert } from '../../components/form-alert';
import { authClient, meQuery } from '../../lib/auth';
import { useCopy } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { BackupCodes } from './backup-codes';

type Step = 'password' | 'scan' | 'codes';
const STEPS: Step[] = ['password', 'scan', 'codes'];

interface Enrollment {
  totpURI: string;
  backupCodes: string[];
}

/** Sets up TOTP two-factor sign-in (F01 rules 15–16): password, authenticator app, backup codes. */
export function TwoFactorSetupPage({ required }: { required: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('password');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    await router.navigate({ to: '/login' });
  }

  return (
    <AuthLayout wide>
      <div className="flex flex-col gap-4">
        <AuthHeading title={t('twoFactorSetup.title')} subtitle={t('twoFactorSetup.subtitle')} />
        {required && (
          <p className="flex items-start gap-2 rounded-md bg-status-gold px-3 py-2 text-sm text-status-gold-foreground">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
            {t('twoFactorSetup.requiredNotice')}
          </p>
        )}
      </div>
      <Stepper current={step} />

      {step === 'password' && (
        <PasswordStep
          onEnrolled={(next) => {
            setEnrollment(next);
            setStep('scan');
          }}
        />
      )}
      {step === 'scan' && enrollment && (
        <ScanStep
          totpURI={enrollment.totpURI}
          onVerified={async () => {
            // Reload the session now: the app guard reads it on the next navigation.
            await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
            setStep('codes');
          }}
        />
      )}
      {step === 'codes' && enrollment && (
        <CodesStep
          codes={enrollment.backupCodes}
          onFinish={async () => {
            toast.add({ title: t('twoFactorSetup.enabled'), type: 'success' });
            await router.navigate({ to: '/' });
          }}
        />
      )}

      <Button variant="ghost" size="sm" className="self-start" onClick={signOut}>
        <LogOutIcon className="rtl:-scale-x-100" />
        {t('twoFactorSetup.signOut')}
      </Button>
    </AuthLayout>
  );
}

/** Three stages drawn as rising bars, like the strokes of the mark (§5). */
function Stepper({ current }: { current: Step }) {
  const { t } = useTranslation();
  const index = STEPS.indexOf(current);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {t('twoFactorSetup.stepOf', { step: index + 1, total: STEPS.length })}
        {' · '}
        <span className="font-medium text-foreground">{t(`twoFactorSetup.steps.${current}`)}</span>
      </p>
      <ol className="flex items-end gap-1.5" aria-hidden="true">
        {STEPS.map((step, position) => (
          <li
            key={step}
            className={cn(
              'flex-1 rounded-sm transition-colors duration-250 ease-out',
              position === 0 ? 'h-1.5' : position === 1 ? 'h-2' : 'h-2.5',
              position <= index ? 'bg-accent' : 'bg-muted',
            )}
          />
        ))}
      </ol>
    </div>
  );
}

function PasswordStep({ onEnrolled }: { onEnrolled: (enrollment: Enrollment) => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setPending(true);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data || !('totpURI' in data)) return setFailure(errorMessage(t, error));
    onEnrolled({ totpURI: data.totpURI, backupCodes: data.backupCodes });
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <p className="text-muted-foreground">{t('twoFactorSetup.passwordIntro')}</p>
      <Field>
        <FieldLabel>{t('twoFactorSetup.password')}</FieldLabel>
        <Input
          type="password"
          dir="ltr"
          className="text-end"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      {failure && <FormAlert>{failure}</FormAlert>}
      <Button type="submit" size="lg" className="w-full" disabled={pending || !password}>
        {pending ? t('twoFactorSetup.starting') : t('twoFactorSetup.start')}
      </Button>
    </form>
  );
}

/** The secret in groups of four, easier to type into an app by hand. */
function groupKey(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

function ScanStep({ totpURI, onVerified }: { totpURI: string; onVerified: () => Promise<void> }) {
  const { t } = useTranslation();
  const codeId = useId();
  const { copy, copied } = useCopy();
  const secret = new URL(totpURI).searchParams.get('secret') ?? '';
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
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground">{t('twoFactorSetup.scanIntro')}</p>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {/* Scanners need dark modules on a light ground, in both themes. */}
        <div className="shrink-0 rounded-lg border border-border bg-white p-3">
          <QRCodeSVG
            value={totpURI}
            size={168}
            role="img"
            aria-label={t('twoFactorSetup.qrLabel')}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm text-muted-foreground">{t('twoFactorSetup.manualKey')}</p>
          <span
            dir="ltr"
            className="rounded-md bg-muted px-3 py-2 text-center text-sm font-medium break-all tabular-nums select-all"
          >
            {groupKey(secret)}
          </span>
          <Button variant="outline" size="sm" className="self-start" onClick={() => copy(secret)}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? t('common.copied') : t('twoFactorSetup.copyKey')}
          </Button>
        </div>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void verify(code);
        }}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor={codeId} className="text-sm font-medium">
            {t('twoFactorSetup.code')}
          </label>
          <OtpField
            id={codeId}
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
          {pending ? t('twoFactorSetup.verifying') : t('twoFactorSetup.verify')}
        </Button>
      </form>
    </div>
  );
}

function CodesStep({ codes, onFinish }: { codes: string[]; onFinish: () => Promise<void> }) {
  const { t } = useTranslation();
  const savedId = useId();
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground">{t('twoFactorSetup.codesIntro')}</p>
      <BackupCodes codes={codes} />
      <label
        htmlFor={savedId}
        className="flex cursor-pointer items-center gap-3 text-sm font-medium"
      >
        <Checkbox id={savedId} checked={saved} onCheckedChange={(value) => setSaved(value)} />
        {t('twoFactorSetup.confirmSaved')}
      </label>
      <Button size="lg" className="w-full" disabled={!saved} onClick={() => void onFinish()}>
        {t('twoFactorSetup.finish')}
      </Button>
    </div>
  );
}
