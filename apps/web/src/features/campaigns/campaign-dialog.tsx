import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  AD_FUNDINGS,
  AD_OBJECTIVES,
  AD_PLATFORMS,
  type AdFunding,
  type AdObjective,
  type AdPlatform,
  type CampaignDetail,
  createCampaignSchema,
  updateCampaignSchema,
} from '@vertex-hub/contracts';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { type ComponentProps, useId, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '../../components/money-input';
import { ApiError } from '../../lib/api/client';
import { canAll, useMe } from '../../lib/auth';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { useFocusFirstError } from '../../lib/focus-first-invalid';
import { clientListQuery } from '../clients/clients.queries';
import { projectListQuery } from '../projects/projects.queries';
import { type Choice, ChoiceSelect } from '../quotes/choice-select';
import { FormDialog } from '../quotes/quote-dialogs';
import { retainerListQuery } from '../retainers/retainers.queries';
import { taskListQuery } from '../tasks/tasks.queries';
import { userListQuery } from '../users/users.queries';
import { useCreateCampaign, useUpdateCampaign } from './campaigns.queries';

const NONE = 'none';

/** The field a refusal concerns; any other refusal shows above the buttons. */
const FIELD_OF_CODE: Partial<Record<string, keyof CampaignValues>> = {
  CLIENT_ARCHIVED: 'clientId',
  INVALID_OWNER: 'ownerId',
  INVALID_ENGAGEMENT: 'engagement',
  INVALID_DATES: 'endsOn',
  FUNDING_LOCKED: 'funding',
};

interface CampaignValues {
  clientId: string;
  name: string;
  platform: AdPlatform | null;
  objective: AdObjective | null;
  funding: AdFunding;
  budgetMinor: number | null;
  startsOn: string;
  endsOn: string;
  ownerId: string | null;
  /** `project:<id>`, `retainer:<id>` or `none`. */
  engagement: string;
  taskId: string;
  notes: string;
}

function valuesOf(campaign: CampaignDetail | undefined, clientId: string | undefined, me: string) {
  if (!campaign) {
    return {
      clientId: clientId ?? '',
      name: '',
      platform: null,
      objective: null,
      funding: 'wallet',
      budgetMinor: null,
      startsOn: '',
      endsOn: '',
      ownerId: me,
      engagement: NONE,
      taskId: NONE,
      notes: '',
    } satisfies CampaignValues;
  }
  return {
    clientId: campaign.client.id,
    name: campaign.name,
    platform: campaign.platform,
    objective: campaign.objective,
    funding: campaign.funding,
    budgetMinor: campaign.budgetMinor,
    startsOn: campaign.startsOn,
    endsOn: campaign.endsOn ?? '',
    ownerId: campaign.owner.id,
    engagement: campaign.engagement
      ? `${campaign.engagement.type}:${campaign.engagement.id}`
      : NONE,
    taskId: campaign.task?.id ?? NONE,
    notes: campaign.notes,
  } satisfies CampaignValues;
}

/**
 * Spec screen 2: a new campaign, or the whole campaign saved at once (rule 5). From a client's
 * Ads tab the client is fixed; the funding is locked once the campaign has updates (rule 6).
 */
export function CampaignDialog({
  open,
  onClose,
  clientId: fixedClientId,
  campaign,
  finalFocus,
}: {
  open: boolean;
  onClose: () => void;
  /** The client, when the dialog opens from its profile. */
  clientId?: string;
  /** The campaign to edit. */
  campaign?: CampaignDetail;
  /** Where the focus goes when it closes: the button that opened it, or what replaced it. */
  finalFocus: ComponentProps<typeof FormDialog>['finalFocus'];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // The signed-in user owns a new campaign by default.
  const me = useMe();
  const ids = {
    client: useId(),
    platform: useId(),
    objective: useId(),
    funding: useId(),
    budget: useId(),
    owner: useId(),
    engagement: useId(),
    task: useId(),
  };
  const create = useCreateCampaign();
  const update = useUpdateCampaign(campaign?.id ?? '');
  const defaults: CampaignValues = valuesOf(campaign, fixedClientId, me.user.id);
  // The first invalid field takes the focus, selects included (they register no element).
  const form = useForm<CampaignValues>({ values: defaults, shouldFocusError: false });
  const fields = useRef<HTMLDivElement>(null);
  useFocusFirstError(form.formState.submitCount, fields);
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;
  const clientId = useWatch({ control: form.control, name: 'clientId' });
  const editing = campaign !== undefined;

  // Archived clients get no new campaigns (rule 1); account managers create them for their own.
  const clients = useQuery({
    ...clientListQuery({
      status: ['active', 'paused', 'ended'],
      accountManagerId: canAll(me, 'campaigns.manage') ? undefined : me.user.id,
      pageSize: 100,
    }),
    enabled: open && !editing && !fixedClientId,
  });
  const users = useQuery({ ...userListQuery({ pageSize: 100 }), enabled: open });
  // No placeholder: another client's engagements must never be offered while these load.
  const projects = useQuery({
    ...projectListQuery({ clientId, pageSize: 100 }),
    enabled: open && !!clientId,
    placeholderData: undefined,
  });
  const retainers = useQuery({
    ...retainerListQuery({ clientId, pageSize: 100 }),
    enabled: open && !!clientId,
    placeholderData: undefined,
  });
  const tasks = useQuery({
    ...taskListQuery({ clientId, pageSize: 100 }),
    enabled: open && !!clientId,
    placeholderData: undefined,
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const [type, engagementId] = values.engagement.split(':');
    const fields = {
      name: values.name,
      platform: values.platform,
      objective: values.objective,
      funding: values.funding,
      budgetMinor: values.budgetMinor ?? 0,
      startsOn: values.startsOn,
      endsOn: values.endsOn || null,
      ownerId: values.ownerId,
      projectId: type === 'project' ? engagementId : null,
      retainerId: type === 'retainer' ? engagementId : null,
      taskId: values.taskId === NONE ? null : values.taskId,
      notes: values.notes,
    };
    if (values.endsOn && values.endsOn < values.startsOn) {
      form.setError('endsOn', { type: 'validate' });
      return;
    }
    const showIssues = (issues: readonly { path: readonly PropertyKey[] }[]) => {
      for (const issue of issues) {
        const field = issue.path[0];
        if (field === 'updatedAt') continue;
        const name =
          field === 'projectId' || field === 'retainerId'
            ? 'engagement'
            : (field as keyof CampaignValues);
        form.setError(name, { type: 'schema' });
      }
    };
    try {
      if (campaign) {
        const checked = updateCampaignSchema.safeParse({
          ...fields,
          updatedAt: campaign.updatedAt,
        });
        if (!checked.success) return showIssues(checked.error.issues);
        await update.mutateAsync(checked.data);
        toast.add({ title: t('campaigns.edit.saved'), type: 'success' });
        onClose();
        return;
      }
      const checked = createCampaignSchema.safeParse({ ...fields, clientId: values.clientId });
      if (!checked.success) return showIssues(checked.error.issues);
      const created = await create.mutateAsync(checked.data);
      toast.add({ title: t('campaigns.new.created'), type: 'success' });
      onClose();
      await navigate({ to: '/campaigns/$campaignId', params: { campaignId: created.id } });
    } catch (error) {
      const field = error instanceof ApiError ? FIELD_OF_CODE[error.code ?? ''] : undefined;
      // The client is fixed on an edit and from a client's profile: no field to show it under.
      if (field && !(field === 'clientId' && (editing || fixedClientId))) {
        form.setError(field, { type: SCREEN_ERROR, message: errorMessage(t, error) });
      } else {
        setFailure(errorMessage(t, error));
      }
    }
  });

  const clientItems: Choice[] = (clients.data?.items ?? []).map((client) => ({
    value: client.id,
    label: client.tradeName,
  }));
  const platformItems: Choice[] = AD_PLATFORMS.map((platform) => ({
    value: platform,
    label: t(`campaigns.platforms.${platform}`),
  }));
  const objectiveItems: Choice[] = AD_OBJECTIVES.map((objective) => ({
    value: objective,
    label: t(`campaigns.objectives.${objective}`),
  }));
  const fundingItems: Choice[] = AD_FUNDINGS.map((funding) => ({
    value: funding,
    label: t(`campaigns.funding.${funding}`),
  }));
  const ownerItems: Choice[] = (users.data?.items ?? []).map((user) => ({
    value: user.id,
    label: user.name,
  }));
  // An archived owner stays shown until another is picked (edge case 8).
  if (campaign && !ownerItems.some((item) => item.value === campaign.owner.id)) {
    ownerItems.push({
      value: campaign.owner.id,
      label: t('campaigns.form.archivedName', { name: campaign.owner.name }),
    });
  }
  const engagementItems: Choice[] = [
    { value: NONE, label: t('campaigns.form.noEngagement') },
    ...(projects.data?.items ?? []).map((project) => ({
      value: `project:${project.id}`,
      label: t('campaigns.form.project', { name: project.name }),
    })),
    ...(retainers.data?.items ?? []).map((retainer) => ({
      value: `retainer:${retainer.id}`,
      label: t('campaigns.form.retainer', { name: retainer.name }),
    })),
  ];
  // A link archived later stays (rule 3).
  const current = campaign?.engagement;
  if (current && !engagementItems.some((item) => item.value === `${current.type}:${current.id}`)) {
    engagementItems.push({
      value: `${current.type}:${current.id}`,
      label: t(`campaigns.form.${current.type}`, { name: current.name }),
    });
  }
  const taskItems: Choice[] = [
    { value: NONE, label: t('campaigns.form.noTask') },
    ...(tasks.data?.items ?? []).map((task) => ({ value: task.id, label: task.title })),
  ];
  if (campaign?.task && !taskItems.some((item) => item.value === campaign.task?.id)) {
    taskItems.push({ value: campaign.task.id, label: campaign.task.name });
  }
  const fundingLocked = editing && !campaign.permissions.canChangeFunding;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      // Reset once it has faded out, so nothing typed is kept for the next opening.
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={editing ? t('campaigns.edit.title') : t('campaigns.new.title')}
      description={editing ? t('campaigns.edit.hint') : t('campaigns.new.hint')}
      action={editing ? t('common.save') : t('campaigns.new.create')}
      failure={failure}
      onSubmit={submit}
    >
      <div ref={fields} className="contents">
        {!editing && !fixedClientId && (
          <Controller
            control={form.control}
            name="clientId"
            rules={{ validate: (value) => !!value }}
            render={({ field }) => (
              <Field invalid={!!errors.clientId}>
                <FieldLabel id={ids.client} render={<span />}>
                  {t('campaigns.form.client')}
                </FieldLabel>
                <ChoiceSelect
                  labelledBy={ids.client}
                  items={clientItems}
                  value={field.value || null}
                  placeholder={t('campaigns.form.pickClient')}
                  onChange={(next) => {
                    field.onChange(next);
                    form.setValue('engagement', NONE);
                    form.setValue('taskId', NONE);
                  }}
                />
                <FieldError match={!!errors.clientId} role={errorRole(errors.clientId)}>
                  {fieldError(errors.clientId, t('campaigns.form.errors.client'))}
                </FieldError>
              </Field>
            )}
          />
        )}
        <Field invalid={!!errors.name}>
          <FieldLabel>{t('campaigns.form.name')}</FieldLabel>
          <Input autoComplete="off" {...form.register('name')} />
          <FieldError match={!!errors.name}>{t('campaigns.form.errors.name')}</FieldError>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="platform"
            rules={{ validate: (value) => value !== null }}
            render={({ field }) => (
              <Field invalid={!!errors.platform}>
                <FieldLabel id={ids.platform} render={<span />}>
                  {t('campaigns.form.platform')}
                </FieldLabel>
                <ChoiceSelect
                  labelledBy={ids.platform}
                  items={platformItems}
                  value={field.value}
                  placeholder={t('campaigns.form.pick')}
                  onChange={field.onChange}
                />
                <FieldError match={!!errors.platform}>
                  {t('campaigns.form.errors.platform')}
                </FieldError>
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="objective"
            rules={{ validate: (value) => value !== null }}
            render={({ field }) => (
              <Field invalid={!!errors.objective}>
                <FieldLabel id={ids.objective} render={<span />}>
                  {t('campaigns.form.objective')}
                </FieldLabel>
                <ChoiceSelect
                  labelledBy={ids.objective}
                  items={objectiveItems}
                  value={field.value}
                  placeholder={t('campaigns.form.pick')}
                  onChange={field.onChange}
                />
                <FieldError match={!!errors.objective}>
                  {t('campaigns.form.errors.objective')}
                </FieldError>
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="funding"
            render={({ field }) => (
              <Field invalid={!!errors.funding}>
                <FieldLabel id={ids.funding} render={<span />}>
                  {t('campaigns.form.funding')}
                </FieldLabel>
                <ChoiceSelect
                  labelledBy={ids.funding}
                  items={fundingItems}
                  value={field.value}
                  disabled={fundingLocked}
                  onChange={field.onChange}
                />
                <FieldDescription>
                  {fundingLocked
                    ? t('campaigns.form.fundingLocked')
                    : t('campaigns.form.fundingHint')}
                </FieldDescription>
                <FieldError match={!!errors.funding} role={errorRole(errors.funding)}>
                  {errors.funding?.message}
                </FieldError>
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="budgetMinor"
            rules={{ validate: (minor) => !!minor && minor > 0 }}
            render={({ field }) => (
              <Field invalid={!!errors.budgetMinor}>
                <FieldLabel htmlFor={ids.budget}>{t('campaigns.form.budget')}</FieldLabel>
                <MoneyInput
                  id={ids.budget}
                  currency="USD"
                  value={field.value}
                  onValueChange={field.onChange}
                />
                <FieldDescription>{t('campaigns.form.budgetHint')}</FieldDescription>
                <FieldError match={!!errors.budgetMinor}>
                  {t('campaigns.form.errors.budget')}
                </FieldError>
              </Field>
            )}
          />
          <Field invalid={!!errors.startsOn}>
            <FieldLabel>{t('campaigns.form.startsOn')}</FieldLabel>
            <Input type="date" dir="ltr" {...form.register('startsOn', { required: true })} />
            <FieldError match={!!errors.startsOn}>{t('campaigns.form.errors.startsOn')}</FieldError>
          </Field>
          <Field invalid={!!errors.endsOn}>
            <FieldLabel>{t('campaigns.form.endsOn')}</FieldLabel>
            <Input type="date" dir="ltr" {...form.register('endsOn')} />
            <FieldDescription>{t('campaigns.form.endsOnHint')}</FieldDescription>
            <FieldError match={!!errors.endsOn} role={errorRole(errors.endsOn)}>
              {fieldError(errors.endsOn, t('campaigns.form.errors.endsOn'))}
            </FieldError>
          </Field>
        </div>
        <Controller
          control={form.control}
          name="ownerId"
          rules={{ validate: (value) => !!value }}
          render={({ field }) => (
            <Field invalid={!!errors.ownerId}>
              <FieldLabel id={ids.owner} render={<span />}>
                {t('campaigns.form.owner')}
              </FieldLabel>
              <ChoiceSelect
                labelledBy={ids.owner}
                items={ownerItems}
                value={field.value}
                placeholder={t('campaigns.form.pickOwner')}
                onChange={field.onChange}
              />
              <FieldError match={!!errors.ownerId} role={errorRole(errors.ownerId)}>
                {fieldError(errors.ownerId, t('campaigns.form.errors.owner'))}
              </FieldError>
            </Field>
          )}
        />
        {clientId && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="engagement"
              render={({ field }) => (
                <Field invalid={!!errors.engagement}>
                  <FieldLabel id={ids.engagement} render={<span />}>
                    {t('campaigns.form.engagement')}
                  </FieldLabel>
                  <ChoiceSelect
                    labelledBy={ids.engagement}
                    items={engagementItems}
                    value={field.value}
                    onChange={field.onChange}
                  />
                  <FieldDescription>{t('campaigns.form.linksHint')}</FieldDescription>
                  <FieldError match={!!errors.engagement} role={errorRole(errors.engagement)}>
                    {fieldError(errors.engagement, t('errors.INVALID_ENGAGEMENT'))}
                  </FieldError>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="taskId"
              render={({ field }) => (
                <Field>
                  <FieldLabel id={ids.task} render={<span />}>
                    {t('campaigns.form.task')}
                  </FieldLabel>
                  <ChoiceSelect
                    labelledBy={ids.task}
                    items={taskItems}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </Field>
              )}
            />
          </div>
        )}
        <Field invalid={!!errors.notes}>
          <FieldLabel>{t('campaigns.form.notes')}</FieldLabel>
          <Textarea rows={3} {...form.register('notes')} />
          <FieldError match={!!errors.notes}>{t('campaigns.form.errors.notes')}</FieldError>
        </Field>
      </div>
    </FormDialog>
  );
}
