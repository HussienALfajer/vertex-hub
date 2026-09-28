import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { type SignIn, signInSchema } from '@vertex-hub/contracts';
import {
  AscentLines,
  Button,
  Field,
  FieldError,
  FieldLabel,
  Input,
  VertexLogo,
} from '@vertex-hub/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { authClient, meQuery, safeRedirect } from '../lib/auth';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: safeRedirect(search.redirect) } : {},
  beforeLoad: async ({ context, search }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh bg-background md:grid-cols-2">
      <main className="flex items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <VertexLogo label={t('app.brand')} className="w-28 text-primary md:hidden" />
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold">{t('login.title')}</h1>
            <p className="text-muted-foreground">{t('login.subtitle')}</p>
          </div>
          <SignInForm />
        </div>
      </main>
      {/* Brand panel: the full logo in sand on Vertex Green (approved colorway, §7). */}
      <aside className="relative hidden flex-col items-center justify-center gap-8 overflow-hidden bg-green-800 p-12 md:flex dark:bg-green-900">
        <AscentLines className="absolute inset-y-0 end-0 h-full w-1/4 text-gold-400 opacity-20" />
        <VertexLogo label={t('app.brand')} className="relative w-56 text-gold-400" />
        <p className="relative text-center text-lg text-neutral-300">{t('app.tagline')}</p>
      </aside>
    </div>
  );
}

function SignInForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
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
    const { error } = await authClient.signIn.email(values);
    if (error) {
      if (error.status === 401) setFailure(t('login.errors.invalid'));
      else if (error.status === 429) setFailure(t('login.errors.tooMany'));
      else setFailure(t('login.errors.generic'));
      return;
    }
    // Replace the cached "no session" answer before the guarded route reads it.
    await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
    await router.navigate({ href: safeRedirect(search.redirect), replace: true });
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
      {failure && (
        <p
          role="alert"
          className="rounded-md bg-status-danger px-3 py-2 text-sm text-status-danger-foreground"
        >
          {failure}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? t('login.submitting') : t('login.submit')}
      </Button>
    </form>
  );
}
