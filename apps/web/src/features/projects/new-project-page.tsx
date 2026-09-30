import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  businessDate,
  type ClientResponse,
  type CreateProject,
  type CreateProjectInput,
  type Currency,
  createProjectSchema,
  daysInclusive,
  type TemplateDetail,
} from '@vertex-hub/contracts';
import { AscentLines, AscentMeter, Avatar, Button, PageHeader, toast } from '@vertex-hub/ui';
import { ArrowRightIcon, CalendarRangeIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { useMe } from '../../lib/auth';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { idParam } from '../../lib/search-params';
import { stageMilestones } from '../templates/template-document';
import { ProjectTemplateField } from '../templates/template-pickers';
import { MilestonesEditor, suggestedMilestones } from './milestones-editor';
import { hasMoneyAccess } from './project-access';
import { DepartmentChips, PersonName, ProjectStatusBadge } from './project-badges';
import {
  ClientField,
  CurrencyField,
  checkDates,
  DatesFields,
  DepartmentsField,
  DescriptionField,
  NameField,
  type ProjectFormMethods,
  ProjectManagerField,
  projectFormFailure,
  StatusField,
  useProjectClients,
  useProjectManagerOptions,
} from './project-form';
import { useCreateProject } from './projects.queries';

export interface NewProjectSearch {
  /** Preset from the client profile's Projects tab. */
  clientId?: string;
}

export function parseNewProjectSearch(search: Record<string, unknown>): NewProjectSearch {
  return {
    clientId: idParam(search.clientId),
  };
}

export function NewProjectPage({ search }: { search: NewProjectSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const create = useCreateProject();
  const clients = useProjectClients();
  const [failure, setFailure] = useState<string | null>(null);
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const form = useForm<CreateProjectInput, unknown, CreateProject>({
    resolver: standardSchemaResolver(createProjectSchema),
    defaultValues: {
      clientId: search.clientId ?? '',
      name: '',
      description: '',
      projectManagerId: '',
      departments: [],
      startDate: businessDate(),
      dueDate: '',
      status: 'planned',
      currency: 'USD',
      milestones: suggestedMilestones(t),
    },
  });
  const [clientId, currency, startDate] = useWatch({
    control: form.control,
    name: ['clientId', 'currency', 'startDate'],
  });
  const client = clients.data?.items.find((item) => item.id === clientId);
  // F07 screen 4: the template's stages become the milestones, due in work days from the start
  // (rule 7), and follow the start date; runs start today at the earliest (rule 6).
  useEffect(() => {
    if (!template || !startDate) return;
    const today = businessDate();
    const start = startDate > today ? startDate : today;
    form.setValue('milestones', stageMilestones(template, start), { shouldDirty: true });
  }, [template, startDate, form]);
  // Money fields follow the chosen client's account manager (M1).
  const money = client && hasMoneyAccess(me, client.accountManager.id) ? (currency ?? 'USD') : null;
  const back = search.clientId
    ? ({
        to: '/clients/$clientId',
        params: { clientId: search.clientId },
        search: { tab: 'projects' },
      } as const)
    : ({ to: '/projects' } as const);

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (!checkDates(form, t, values.startDate, values.dueDate)) return;
    // Without money access the API refuses money fields, so none are sent (M1).
    const input: CreateProject = money
      ? values
      : {
          ...values,
          currency: undefined,
          milestones: values.milestones.map(({ installmentMinor: _, ...milestone }) => milestone),
        };
    try {
      const project = await create.mutateAsync(input);
      toast.add({ title: t('projects.new.created'), type: 'success' });
      // F07 screen 4: the generate dialog opens with the chosen template.
      await navigate({
        to: '/projects/$projectId',
        params: { projectId: project.id },
        search: template ? { tab: 'tasks', generate: template.id } : {},
      });
    } catch (error) {
      setFailure(projectFormFailure(form, t, error));
    }
  });

  return (
    <>
      <PageHeader
        title={t('projects.new.title')}
        description={t('projects.new.subtitle')}
        actions={
          <Button variant="ghost" render={<Link {...back} />}>
            <ArrowRightIcon className="ltr:-scale-x-100" />
            {search.clientId ? t('projects.new.backToClient') : t('projects.new.back')}
          </Button>
        }
      />
      <form
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
        onSubmit={submit}
        noValidate
      >
        <div className="flex min-w-0 flex-col gap-6">
          <FormSection title={t('projects.form.identity')} hint={t('projects.form.identityHint')}>
            <ClientField form={form} clients={clients.data?.items ?? []} />
            <NameField form={form} />
            <DescriptionField form={form} />
          </FormSection>
          <FormSection title={t('projects.form.team')} hint={t('projects.form.teamHint')}>
            <ProjectManagerField form={form} />
            <DepartmentsField form={form} />
          </FormSection>
          <FormSection title={t('projects.form.schedule')} hint={t('projects.form.scheduleHint')}>
            <DatesFields form={form} />
            <StatusField form={form} />
          </FormSection>
          <FormSection
            title={t('projects.form.plan')}
            hint={money ? t('projects.form.planHintMoney') : t('projects.form.planHint')}
          >
            <ProjectTemplateField value={template?.id ?? null} onChange={setTemplate} />
            {money && <CurrencyField form={form} />}
            <MilestonesEditor form={form} money={money} />
          </FormSection>
          {failure && <FormAlert>{failure}</FormAlert>}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="outline" render={<Link {...back} />}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? t('projects.form.creating')
                : t('projects.form.create')}
            </Button>
          </div>
        </div>
        <Preview form={form} client={client} money={money} />
      </form>
    </>
  );
}

/** How the project will read once created, updated as the form is filled in. */
function Preview({
  form,
  client,
  money,
}: {
  form: ProjectFormMethods;
  client: ClientResponse | undefined;
  money: Currency | null;
}) {
  const { t } = useTranslation();
  const values = useWatch({ control: form.control });
  const managers = useProjectManagerOptions();
  const manager = managers.find((option) => option.id === values.projectManagerId);
  const name = values.name?.trim() || t('projects.form.namePlaceholder');
  const milestones = (values.milestones ?? []).filter((milestone) => milestone?.name?.trim());
  const total = milestones.reduce((sum, milestone) => sum + (milestone?.installmentMinor ?? 0), 0);
  const { startDate, dueDate } = values;
  const days =
    startDate && dueDate && dueDate >= startDate ? daysInclusive(startDate, dueDate) : null;

  return (
    <aside
      aria-label={t('projects.new.preview')}
      className="relative flex flex-col gap-4 overflow-hidden rounded-lg border border-border bg-surface p-5 lg:sticky lg:top-24"
    >
      <AscentLines className="absolute inset-y-0 end-0 h-full w-16 text-border" />
      <p className="relative text-sm font-medium text-muted-foreground">
        {t('projects.new.preview')}
      </p>
      <div className="relative flex items-center gap-3">
        <Avatar
          name={client?.tradeName ?? name}
          shape="square"
          size="lg"
          tone={client ? 'brand' : 'muted'}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-lg font-bold">{name}</p>
          <p className="truncate text-sm text-muted-foreground">
            {client?.tradeName ?? t('projects.form.clientPlaceholder')}
          </p>
        </div>
      </div>
      <div className="relative flex flex-wrap gap-1.5">
        <ProjectStatusBadge status={values.status ?? 'planned'} />
      </div>
      {(values.departments?.length ?? 0) > 0 && (
        <div className="relative">
          <DepartmentChips codes={(values.departments ?? []).flatMap((code) => code ?? [])} />
        </div>
      )}
      <dl className="relative flex flex-col gap-3 border-t border-border pt-4 text-sm">
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-muted-foreground">{t('projects.form.projectManager')}</dt>
          <dd className="font-medium">
            {manager ? (
              <PersonName name={manager.name} />
            ) : (
              <span className="font-normal text-muted-foreground">
                {t('projects.form.projectManagerPlaceholder')}
              </span>
            )}
          </dd>
        </div>
        {startDate && dueDate && days !== null && (
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">{t('projects.form.schedule')}</dt>
            <dd className="flex items-center gap-2">
              <CalendarRangeIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              <span>
                {t('projects.dateRange', {
                  start: formatCalendarDate(startDate),
                  due: formatCalendarDate(dueDate),
                })}
              </span>
            </dd>
            <dd className="text-xs text-muted-foreground">
              {t('projects.form.span', { count: days, days: formatNumber(days) })}
            </dd>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <dt className="text-xs text-muted-foreground">
            {t('projects.milestonesCount', {
              count: milestones.length,
              n: formatNumber(milestones.length),
            })}
          </dt>
          {milestones.length > 0 && (
            <dd>
              <AscentMeter
                value={0}
                max={milestones.length}
                aria-label={t('projects.milestonesDone', {
                  done: formatNumber(0),
                  total: formatNumber(milestones.length),
                })}
              />
            </dd>
          )}
        </div>
        {money && total > 0 && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-xs text-muted-foreground">{t('projects.milestones.total')}</dt>
            <dd className="font-bold tabular-nums">{formatMoney(total, money)}</dd>
          </div>
        )}
      </dl>
    </aside>
  );
}
