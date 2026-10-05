import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { Link } from '@tanstack/react-router';
import { type RequestPasswordLink, requestPasswordLinkSchema } from '@vertex-hub/contracts';
import { Button, Field, FieldError, FieldLabel, Input } from '@vertex-hub/ui';
import { ArrowRightIcon, MailCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AuthHeading, AuthLayout } from '../../components/auth-layout';
import { FormAlert } from '../../components/form-alert';
import { api, call } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';

/**
 * F14 email screen 2: asks for a reset link. The answer is the same whether the address belongs
 * to an account or not (rule 13).
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RequestPasswordLink>({
    resolver: standardSchemaResolver(requestPasswordLinkSchema),
    defaultValues: { email: '' },
  });

  const submit = handleSubmit(async (body) => {
    setFailure(null);
    try {
      await call(api.POST('/api/password-links/request', { body }));
      setSent(true);
    } catch (error) {
      // nginx answers 429 past the sign-in limit (rule 13): "try again later".
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <AuthLayout>
      {sent ? (
        <div role="status" className="flex flex-col gap-6">
          <span className="flex size-12 items-center justify-center rounded-lg bg-status-success text-status-success-foreground">
            <MailCheckIcon className="size-6" />
          </span>
          <AuthHeading
            title={t('forgotPassword.sentTitle')}
            subtitle={t('forgotPassword.sentBody')}
          />
          <Button size="lg" className="w-full" render={<Link to="/login" />}>
            {t('forgotPassword.back')}
          </Button>
        </div>
      ) : (
        <>
          <AuthHeading title={t('forgotPassword.title')} subtitle={t('forgotPassword.subtitle')} />
          <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
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
            {failure && <FormAlert>{failure}</FormAlert>}
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
            </Button>
          </form>
          <div className="border-t border-border pt-4">
            <Button variant="ghost" size="sm" render={<Link to="/login" />}>
              <ArrowRightIcon className="ltr:-scale-x-100" />
              {t('forgotPassword.back')}
            </Button>
          </div>
        </>
      )}
    </AuthLayout>
  );
}
