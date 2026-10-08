import { Link, useNavigate } from '@tanstack/react-router';
import { Button, PageHeader, toast } from '@vertex-hub/ui';
import { ArrowRightIcon } from 'lucide-react';
import { useState } from 'react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import {
  AssigneesEditor,
  BasicsFields,
  StepsEditor,
  templateFormFailure,
  useTemplateForm,
} from './template-editor';
import { useCreateTemplate } from './templates.queries';

export function NewTemplatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateTemplate();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useTemplateForm({
    kind: 'project',
    name: '',
    description: '',
    stages: [],
    steps: [],
    assignees: [],
  });
  const kind = useWatch({ control: form.control, name: 'kind' });

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      const template = await create.mutateAsync(values);
      toast.add({ title: t('templates.new.created'), type: 'success' });
      await navigate({ to: '/templates/$templateId', params: { templateId: template.id } });
    } catch (error) {
      setFailure(templateFormFailure(form, t, error));
    }
  });

  return (
    <>
      <PageHeader
        title={t('templates.new.title')}
        description={t('templates.new.subtitle')}
        actions={
          <Button variant="ghost" render={<Link to="/templates" />}>
            <ArrowRightIcon className="ltr:-scale-x-100" />
            {t('templates.back')}
          </Button>
        }
      />
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <FormSection title={t('templates.form.basics')} hint={t('templates.form.basicsHint')}>
          <BasicsFields form={form} isNew />
        </FormSection>
        <FormSection
          title={t('templates.form.steps')}
          hint={
            kind === 'project' ? t('templates.form.stepsHint') : t('templates.form.stepsCycleHint')
          }
        >
          <StepsEditor form={form} readOnly={false} />
        </FormSection>
        <FormSection title={t('templates.form.assignees')} hint={t('templates.form.assigneesHint')}>
          <AssigneesEditor form={form} stored={[]} readOnly={false} />
        </FormSection>
        {failure && <FormAlert>{failure}</FormAlert>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="outline" render={<Link to="/templates" />}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? t('templates.form.creating')
              : t('templates.form.create')}
          </Button>
        </div>
      </form>
      <UnsavedChangesGuard dirty={form.formState.isDirty && !form.formState.isSubmitting} />
    </>
  );
}
