import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type SetPasswordForm, setPasswordFormSchema } from '@vertex-hub/contracts';
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PasswordInput,
  Skeleton,
} from '@vertex-hub/ui';
import { CircleCheckIcon, LinkIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AuthHeading, AuthLayout, AuthOutcome } from '../../components/auth-layout';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { ApiError, api, call } from '../../lib/api/client';
import { authClient } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';

/** Survives a reload in this tab after the token has left the address bar; never sent anywhere. */
const TOKEN_KEY = 'vertex-link-token';

/**
 * The token travels in the link's fragment, which browsers never send to the server. It is kept
 * for the tab (sessionStorage), so reloading the page does not lose the link.
 */
function tokenFromLink(): string | null {
  const fromLink = new URLSearchParams(window.location.hash.slice(1)).get('token');
  try {
    if (fromLink) sessionStorage.setItem(TOKEN_KEY, fromLink);
    return fromLink ?? sessionStorage.getItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable (private mode): the link then works until the page reloads.
    return fromLink;
  }
}

function forgetToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing was stored.
  }
}

type Stage = 'form' | 'done' | 'invalid';

const REDIRECT_DELAY_MS = 4000;

/** Sets the password through an activation or reset link (F01 rules 13–14). */
export function ActivatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [token] = useState(tokenFromLink);
  const [stage, setStage] = useState<Stage>(token ? 'form' : 'invalid');
  // A dead link shows before anything is typed.
  const link = useQuery({
    queryKey: ['account', 'link', token],
    queryFn: () => call(api.POST('/api/password-links/check', { body: { token: token ?? '' } })),
    enabled: !!token && stage === 'form',
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const linkInvalid = link.error instanceof ApiError && link.error.code === 'LINK_INVALID';
  const kind = link.data?.kind ?? 'activation';
  // Saving clears the query cache (any other session in the browser), so keep the kind.
  const [doneKind, setDoneKind] = useState(kind);

  useEffect(() => {
    if (stage !== 'form' || linkInvalid) forgetToken();
  }, [stage, linkInvalid]);

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
      {stage === 'form' && token && !linkInvalid && (
        <>
          {/* The heading depends on the link's kind: wait for it rather than show the wrong one. */}
          {link.isPending && (
            <div className="flex flex-col gap-5" aria-busy="true">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-10" />
            </div>
          )}
          {link.data && (
            <AuthHeading
              title={t(`activate.${kind}.title`)}
              subtitle={t(`activate.${kind}.subtitle`)}
            />
          )}
          {link.isError && (
            <LoadError message={t('activate.checkFailed')} onRetry={() => void link.refetch()} />
          )}
          {link.data && (
            <PasswordForm
              token={token}
              email={link.data.email}
              onDone={() => {
                setDoneKind(kind);
                setStage('done');
              }}
              onInvalid={() => setStage('invalid')}
            />
          )}
        </>
      )}
      {stage === 'done' && (
        <AuthOutcome
          icon={<CircleCheckIcon />}
          tone="success"
          title={t(`activate.${doneKind}.doneTitle`)}
          body={t(`activate.${doneKind}.doneBody`)}
        >
          <Button size="lg" className="w-full" render={<Link to="/login" />}>
            {t('activate.toLogin')}
          </Button>
        </AuthOutcome>
      )}
      {(stage === 'invalid' || linkInvalid) && (
        <AuthOutcome
          icon={<LinkIcon />}
          tone="warning"
          title={t('activate.invalidTitle')}
          body={t('activate.invalidBody')}
        >
          <Button size="lg" className="w-full" render={<Link to="/forgot-password" />}>
            {t('activate.requestNew')}
          </Button>
          <Button variant="outline" className="w-full" render={<Link to="/login" />}>
            {t('activate.toLogin')}
          </Button>
        </AuthOutcome>
      )}
    </AuthLayout>
  );
}

function PasswordForm({
  token,
  email,
  onDone,
  onInvalid,
}: {
  token: string;
  email: string;
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
      <Field>
        <FieldLabel>{t('login.email')}</FieldLabel>
        {/* Read-only: tells whose account this is, and lets password managers save the pair. */}
        <Input type="email" dir="ltr" autoComplete="username" value={email} readOnly />
      </Field>
      <Field invalid={!!errors.password}>
        <FieldLabel>{t('activate.password')}</FieldLabel>
        <PasswordInput
          showLabel={t('common.showPassword')}
          hideLabel={t('common.hidePassword')}
          autoComplete="new-password"
          autoFocus
          {...register('password')}
        />
        {/* The error repeats the rule: show one or the other. */}
        {!errors.password && <FieldDescription>{t('activate.hint')}</FieldDescription>}
        <FieldError match={!!errors.password}>{t('activate.errors.tooShort')}</FieldError>
      </Field>
      <Field invalid={!!errors.confirm}>
        <FieldLabel>{t('activate.confirm')}</FieldLabel>
        <PasswordInput
          showLabel={t('common.showPassword')}
          hideLabel={t('common.hidePassword')}
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
