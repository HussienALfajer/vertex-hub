import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type SetPasswordForm, setPasswordFormSchema } from '@vertex-hub/contracts';
import { Button, Field, FieldDescription, FieldError, FieldLabel, Input } from '@vertex-hub/ui';
import { CircleCheckIcon, LinkIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AuthHeading, AuthLayout } from '../../components/auth-layout';
import { FormAlert } from '../../components/form-alert';
import { ApiError, api, call } from '../../lib/api/client';
import { authClient } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';

/** The token travels in the link's fragment, which browsers never send to the server. */
function tokenFromLink(): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get('token');
}

type Stage = 'form' | 'done' | 'invalid';

const REDIRECT_DELAY_MS = 4000;

/** Sets the password through an activation or reset link (F01 rules 13–14). */
export function ActivatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [token] = useState(tokenFromLink);
  const [stage, setStage] = useState<Stage>(token ? 'form' : 'invalid');

  // After a short confirmation, go on to sign-in (F01 screen 6).
  useEffect(() => {
    if (stage !== 'done') return;
    const timer = setTimeout(() => void navigate({ to: '/login' }), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [stage, navigate]);

  // Drop the token from the address bar so it does not stay in the browser history.
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  return (
    <AuthLayout>
      {stage === 'form' && token && (
        <>
          <AuthHeading title={t('activate.title')} subtitle={t('activate.subtitle')} />
          <PasswordForm
            token={token}
            onDone={() => setStage('done')}
            onInvalid={() => setStage('invalid')}
          />
        </>
      )}
      {stage === 'done' && (
        <Outcome
          icon={<CircleCheckIcon className="size-6" />}
          tone="bg-status-success text-status-success-foreground"
          title={t('activate.doneTitle')}
          body={t('activate.doneBody')}
        >
          <Button size="lg" className="w-full" render={<Link to="/login" />}>
            {t('activate.toLogin')}
          </Button>
        </Outcome>
      )}
      {stage === 'invalid' && (
        <Outcome
          icon={<LinkIcon className="size-6" />}
          tone="bg-status-warning text-status-warning-foreground"
          title={t('activate.invalidTitle')}
          body={t('activate.invalidBody')}
        >
          <Button variant="outline" className="w-full" render={<Link to="/login" />}>
            {t('activate.toLogin')}
          </Button>
        </Outcome>
      )}
    </AuthLayout>
  );
}

function PasswordForm({
  token,
  onDone,
  onInvalid,
}: {
  token: string;
  onDone: () => void;
  onInvalid: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SetPasswordForm>({
    resolver: standardSchemaResolver(setPasswordFormSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const submit = handleSubmit(async ({ password }) => {
    setFailure(null);
    try {
      await call(api.POST('/api/password-links/redeem', { body: { token, password } }));
      // The link holder signs in next as themselves: drop any other session open in this browser,
      // or /login would send them into that account.
      await authClient.signOut();
      queryClient.clear();
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'LINK_INVALID') onInvalid();
      else setFailure(errorMessage(t, error));
    }
  });

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      <Field invalid={!!errors.password}>
        <FieldLabel>{t('activate.password')}</FieldLabel>
        <Input
          type="password"
          dir="ltr"
          className="text-end"
          autoComplete="new-password"
          autoFocus
          {...register('password')}
        />
        <FieldDescription>{t('activate.hint')}</FieldDescription>
        <FieldError match={!!errors.password}>{t('activate.errors.tooShort')}</FieldError>
      </Field>
      <Field invalid={!!errors.confirm}>
        <FieldLabel>{t('activate.confirm')}</FieldLabel>
        <Input
          type="password"
          dir="ltr"
          className="text-end"
          autoComplete="new-password"
          {...register('confirm')}
        />
        <FieldError match={!!errors.confirm}>{t('activate.errors.mismatch')}</FieldError>
      </Field>
      {failure && <FormAlert>{failure}</FormAlert>}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? t('activate.submitting') : t('activate.submit')}
      </Button>
    </form>
  );
}

function Outcome({
  icon,
  tone,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className={`flex size-12 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
      <AuthHeading title={title} subtitle={body} />
      {children}
    </div>
  );
}
