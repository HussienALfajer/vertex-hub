import { Link, useNavigate } from '@tanstack/react-router';
import type { UserWithLinkResponse } from '@vertex-hub/contracts';
import { Button, PageHeader } from '@vertex-hub/ui';
import { ArrowRightIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../../lib/auth';
import { LinkDialog } from './link-dialog';
import { emptyUser, UserForm } from './user-form';
import { useCreateUser } from './users.queries';

export function NewUserPage() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const create = useCreateUser();
  const [created, setCreated] = useState<UserWithLinkResponse | null>(null);
  // Remounts the form empty after "Create another".
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <PageHeader
        title={t('users.new.title')}
        description={t('users.new.subtitle')}
        actions={
          <Button variant="ghost" render={<Link to="/team" />}>
            <ArrowRightIcon className="ltr:-scale-x-100" />
            {t('users.new.back')}
          </Button>
        }
      />
      <UserForm
        key={formKey}
        defaultValues={emptyUser}
        canGrantGeneralManager={me.roles.includes('general_manager')}
        submitLabel={t('users.form.create')}
        submittingLabel={t('users.form.creating')}
        onSubmit={async (values) => setCreated(await create.mutateAsync(values))}
        actions={
          <Button variant="outline" render={<Link to="/team" />}>
            {t('common.cancel')}
          </Button>
        }
      />
      <LinkDialog
        link={created?.link ?? null}
        name={created?.user.name ?? ''}
        email={created?.user.email ?? ''}
        onClose={() => {
          if (created) void navigate({ to: '/team/$userId', params: { userId: created.user.id } });
        }}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setCreated(null);
                setFormKey((key) => key + 1);
              }}
            >
              {t('users.link.createAnother')}
            </Button>
            {created && (
              <Button render={<Link to="/team/$userId" params={{ userId: created.user.id }} />}>
                {t('users.link.openProfile')}
              </Button>
            )}
          </>
        }
      />
    </>
  );
}
