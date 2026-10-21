import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from '@tanstack/react-router';
import {
  ANNOUNCEMENT_LIMITS,
  type Announcement,
  type AnnouncementBody,
  addDays,
  businessDate,
  createAnnouncementSchema,
  NOTIFICATION_PRIORITIES,
  type NotificationPriority,
  POLL_LIMITS,
  POLL_RESULTS_VISIBILITY,
  updateAnnouncementSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  Callout,
  Checkbox,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  PageHeader,
  RadioCard,
  RadioGroup,
  RichTextEditor,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowRightIcon,
  FileStackIcon,
  LockIcon,
  PlusIcon,
  SaveIcon,
  TrashIcon,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import {
  Controller,
  type FieldErrors,
  type FieldError as FormFieldError,
  type Resolver,
  type UseFormReturn,
  useForm,
  useWatch,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { LoadError } from '../../components/load-error';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import { ApiError } from '../../lib/api/client';
import { scopesOf, useMe } from '../../lib/auth';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { useFocusFirstError } from '../../lib/focus-first-invalid';
import { formatNumber, fromBusinessDateTimeInput, toBusinessDateTimeInput } from '../../lib/format';
import { AudiencePicker } from '../audiences/audience-picker';
import { AnnouncementAttachments } from './announcement-attachments';
import {
  type AnnouncementFormValues,
  announcementFormValues,
  createInput,
  emptyPoll,
  newAnnouncementValues,
  type PollDraft,
  SEND_MODES,
  type SendMode,
  templateFields,
  updateInput,
  withTemplate,
} from './announcement-form';
import { AnnouncementBodyView, useRichTextLabels } from './announcement-parts';
import { SaveTemplateDialog, TemplatesDialog } from './announcement-templates';
import {
  announcementQuery,
  useArchiveAnnouncement,
  useCancelSchedule,
  useCreateAnnouncement,
  useSendAnnouncement,
  useUpdateAnnouncement,
} from './announcements.queries';

type Form = UseFormReturn<AnnouncementFormValues>;

/** Screen 13 for a new announcement. */
export function NewAnnouncementPage() {
  return <AnnouncementEditor announcement={null} />;
}

/** Screen 13 for a stored one: a draft, a scheduled one, or a sent one (rule D10). */
export function EditAnnouncementPage({ announcementId }: { announcementId: string }) {
  const { t } = useTranslation();
  const announcement = useQuery(announcementQuery(announcementId));
  if (announcement.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (announcement.isError) {
    return (
      <LoadError
        message={t('announcements.page.loadError')}
        error={announcement.error}
        onRetry={() => announcement.refetch()}
      />
    );
  }
  // Only the author edits it (rule D10); anyone else reads its page.
  if (!announcement.data.rights.edit) {
    return (
      <Navigate
        to="/announcements/$announcementId"
        params={{ announcementId: announcement.data.id }}
        replace
      />
    );
  }
  return <AnnouncementEditor key={announcement.data.id} announcement={announcement.data} />;
}

/**
 * Checks the editor's values with the contract the API uses (a new or a stored announcement),
 * so each issue lands on its field; a schedule needs its time even when a draft is sent later.
 */
function editorResolver(stored: Announcement | null): Resolver<AnnouncementFormValues> {
  // The resolver checks the input built from the values, not the values themselves.
  const check = (stored
    ? standardSchemaResolver(updateAnnouncementSchema)
    : standardSchemaResolver(createAnnouncementSchema)) as unknown as Resolver<
    Record<string, unknown>
  >;
  return async (values, context, options) => {
    const input = stored ? updateInput(values, stored) : createInput(values);
    const result = await check(
      input as Record<string, unknown>,
      context,
      options as unknown as Parameters<typeof check>[2],
    );
    const errors = { ...result.errors } as FieldErrors<AnnouncementFormValues>;
    if (values.send === 'schedule' && !values.scheduledAt && stored?.status !== 'sent') {
      errors.scheduledAt = { type: 'required', message: '' };
    }
    return Object.keys(errors).length > 0 ? { values: {}, errors } : { values, errors: {} };
  };
}

function AnnouncementEditor({ announcement }: { announcement: Announcement | null }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const create = useCreateAnnouncement();
  const update = useUpdateAnnouncement(announcement?.id ?? '');
  const send = useSendAnnouncement(announcement?.id ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  // The body editor reads its document once: a template remounts it with the template's body.
  const [bodyKey, setBodyKey] = useState(0);
  const status = announcement?.status ?? 'draft';
  const sent = status === 'sent';
  const form = useForm<AnnouncementFormValues>({
    resolver: editorResolver(announcement),
    defaultValues: announcement ? announcementFormValues(announcement) : newAnnouncementValues(),
    // Most fields are controlled pieces (editor, picker, poll): the page focuses the first error.
    shouldFocusError: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const { isDirty, isSubmitting } = form.formState;
  const priority = useWatch({ control: form.control, name: 'priority' });
  const mode = useWatch({ control: form.control, name: 'send' });
  const manages = scopesOf(me, 'announcements.manage').length > 0;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      let saved: Announcement;
      if (!announcement) {
        saved = await create.mutateAsync(createInput(values));
      } else {
        saved = await update.mutateAsync(updateInput(values, announcement));
        if (status === 'draft' && values.send !== 'draft') {
          saved = await send.mutateAsync(
            values.send === 'schedule' ? fromBusinessDateTimeInput(values.scheduledAt) : undefined,
          );
        }
      }
      toast.add({ title: t(`announcements.form.done.${doneKey(saved)}`), type: 'success' });
      await navigate(
        saved.status === 'draft'
          ? {
              to: '/announcements/$announcementId/edit',
              params: { announcementId: saved.id },
              replace: true,
            }
          : { to: '/announcements/$announcementId', params: { announcementId: saved.id } },
      );
      // A draft stays in the editor: what was saved is the new starting point.
      if (saved.status === 'draft') form.reset(announcementFormValues(saved));
    } catch (error) {
      setFailure(editorFailure(form, t, error));
    }
  });
  useFocusFirstError(form.formState.submitCount, formRef);

  return (
    <>
      <PageHeader
        title={announcement ? t('announcements.form.editTitle') : t('announcements.form.newTitle')}
        description={t(`announcements.form.subtitle.${announcement ? status : 'new'}`)}
        actions={
          <>
            <Button variant="ghost" render={<Link to="/announcements" />}>
              <ArrowRightIcon className="ltr:-scale-x-100" />
              {t('announcements.back')}
            </Button>
            <Button variant="outline" onClick={() => setPicking(true)}>
              <FileStackIcon />
              {t('announcements.templates.start')}
            </Button>
            <Button variant="outline" onClick={() => setSavingTemplate(true)}>
              <SaveIcon />
              {t('announcements.templates.saveAs')}
            </Button>
          </>
        }
      />
      {announcement?.unsentAt && status === 'draft' && (
        <Callout
          tone="warning"
          title={t('announcements.form.unsentTitle')}
          description={t('announcements.form.unsentBody')}
        />
      )}
      <form ref={formRef} className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <FormSection
          title={t('announcements.form.content')}
          hint={t('announcements.form.contentHint')}
        >
          <ContentFields form={form} bodyKey={bodyKey} />
        </FormSection>
        <FormSection
          title={t('announcements.attachments.title')}
          hint={t('announcements.form.attachmentsHint')}
        >
          {announcement ? (
            <AnnouncementAttachments announcementId={announcement.id} heading={false} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('announcements.form.attachmentsAfterDraft')}
            </p>
          )}
        </FormSection>
        <FormSection
          title={t('announcements.form.audience')}
          hint={sent ? t('announcements.form.lockedHint') : t('announcements.form.audienceHint')}
        >
          {sent ? (
            <LockedNote />
          ) : (
            <Controller
              control={form.control}
              name="audience"
              render={({ field, fieldState }) => (
                <AudienceField
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error}
                />
              )}
            />
          )}
        </FormSection>
        <FormSection
          title={t('announcements.form.delivery')}
          hint={t('announcements.form.deliveryHint')}
        >
          <DeliveryFields form={form} locked={sent} manages={manages} priority={priority} />
        </FormSection>
        <FormSection title={t('announcements.poll.title')} hint={t('announcements.form.pollHint')}>
          <PollField form={form} announcement={announcement} />
        </FormSection>
        <FormSection
          title={t('announcements.form.sending')}
          hint={t(`announcements.form.sendingHint.${status}`)}
        >
          <SendingFields form={form} status={status} />
        </FormSection>
        {failure && <FormAlert>{failure}</FormAlert>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {announcement && <SecondaryActions announcement={announcement} form={form} />}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? t('common.saving')
              : t(`announcements.form.submit.${submitKey(status, mode)}`)}
          </Button>
        </div>
      </form>
      {picking && (
        <TemplatesDialog
          onClose={() => setPicking(false)}
          onPick={(template) => {
            const values = withTemplate(form.getValues(), template);
            for (const name of [
              'title',
              'body',
              'linkUrl',
              'linkLabel',
              ...(sent ? [] : (['priority', 'requiresAck'] as const)),
            ] as const) {
              form.setValue(name, values[name], { shouldDirty: true });
            }
            setBodyKey((key) => key + 1);
          }}
        />
      )}
      {savingTemplate && (
        <SaveTemplateDialog
          fields={templateFields(form.getValues())}
          onClose={() => setSavingTemplate(false)}
        />
      )}
      <UnsavedChangesGuard dirty={isDirty && !isSubmitting} />
    </>
  );
}

const doneKey = (announcement: Announcement) =>
  announcement.status === 'sent'
    ? 'sent'
    : announcement.status === 'scheduled'
      ? 'scheduled'
      : 'draft';

function submitKey(status: Announcement['status'], mode: SendMode) {
  if (status === 'sent' || status === 'scheduled') return 'save';
  return mode;
}

/** Puts a refusal on the field it concerns; the rest goes above the buttons. */
function editorFailure(form: Form, t: ReturnType<typeof useTranslation>['t'], error: unknown) {
  if (
    error instanceof ApiError &&
    (error.code === 'EMPTY_AUDIENCE' || error.code === 'FORBIDDEN_AUDIENCE')
  ) {
    form.setError(
      'audience',
      { type: SCREEN_ERROR, message: errorMessage(t, error) },
      { shouldFocus: false },
    );
  }
  return errorMessage(t, error);
}

function LockedNote() {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <LockIcon className="size-4" aria-hidden="true" />
      {t('announcements.form.locked')}
    </p>
  );
}

function ContentFields({ form, bodyKey }: { form: Form; bodyKey: number }) {
  const { t } = useTranslation();
  const labels = useRichTextLabels();
  const ids = { title: useId(), body: useId(), linkUrl: useId(), linkLabel: useId() };
  const errors = form.formState.errors;
  const body = useWatch({ control: form.control, name: 'body' });
  return (
    <>
      <Field invalid={!!errors.title}>
        <FieldLabel htmlFor={ids.title}>{t('announcements.form.title')}</FieldLabel>
        <Input
          id={ids.title}
          autoComplete="off"
          maxLength={ANNOUNCEMENT_LIMITS.titleMax}
          placeholder={t('announcements.form.titlePlaceholder')}
          {...form.register('title')}
        />
        <FieldError match={!!errors.title}>
          {t('announcements.form.errors.title', {
            min: formatNumber(ANNOUNCEMENT_LIMITS.titleMin),
            max: formatNumber(ANNOUNCEMENT_LIMITS.titleMax),
          })}
        </FieldError>
      </Field>
      <Field invalid={!!errors.body}>
        <FieldLabel id={ids.body} render={<span />}>
          {t('announcements.form.body')}
        </FieldLabel>
        <Tabs defaultValue="write" className="gap-3">
          <TabsList aria-label={t('announcements.form.bodyView')}>
            <TabsTrigger value="write">{t('announcements.form.write')}</TabsTrigger>
            <TabsTrigger value="preview">{t('announcements.form.preview')}</TabsTrigger>
          </TabsList>
          <TabsContent value="write" keepMounted>
            <Controller
              control={form.control}
              name="body"
              render={({ field }) => (
                <RichTextEditor
                  key={bodyKey}
                  defaultValue={field.value}
                  onChange={(doc) => field.onChange(doc as AnnouncementBody)}
                  labels={labels}
                  aria-labelledby={ids.body}
                  invalid={!!errors.body}
                />
              )}
            />
          </TabsContent>
          <TabsContent value="preview">
            <div className="min-h-40 rounded-md border border-border bg-surface p-4">
              {body?.content?.length ? (
                <AnnouncementBodyView body={body} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('announcements.form.previewEmpty')}
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>
        {errors.body && (
          <p className="text-sm text-destructive-text">
            {t('announcements.form.errors.body', {
              max: formatNumber(ANNOUNCEMENT_LIMITS.bodyText),
            })}
          </p>
        )}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.linkUrl}>
          <FieldLabel htmlFor={ids.linkUrl}>
            {t('announcements.form.linkUrl')}
            <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>
          </FieldLabel>
          <Input
            id={ids.linkUrl}
            type="url"
            dir="ltr"
            placeholder="https://"
            {...form.register('linkUrl')}
          />
          <FieldError match={!!errors.linkUrl}>{t('announcements.form.errors.linkUrl')}</FieldError>
        </Field>
        <Field invalid={!!errors.linkLabel}>
          <FieldLabel htmlFor={ids.linkLabel}>
            {t('announcements.form.linkLabel')}
            <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>
          </FieldLabel>
          <Input
            id={ids.linkLabel}
            maxLength={ANNOUNCEMENT_LIMITS.linkLabel}
            placeholder={t('announcements.form.linkLabelPlaceholder')}
            {...form.register('linkLabel')}
          />
          <FieldError match={!!errors.linkLabel}>
            {t('announcements.form.errors.linkLabel')}
          </FieldError>
        </Field>
      </div>
    </>
  );
}

function AudienceField({
  value,
  onChange,
  error,
}: {
  value: AnnouncementFormValues['audience'];
  onChange: (next: AnnouncementFormValues['audience']) => void;
  error: FormFieldError | undefined;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-medium">
        {t('announcements.form.audienceSources')}
      </span>
      <AudiencePicker value={value} onChange={onChange} invalid={!!error} labelId={labelId} />
      {error && (
        <p role={errorRole(error)} className="text-sm text-destructive-text">
          {fieldError(error, t('announcements.form.errors.audience'))}
        </p>
      )}
    </div>
  );
}

function DeliveryFields({
  form,
  locked,
  manages,
  priority,
}: {
  form: Form;
  locked: boolean;
  manages: boolean;
  priority: NotificationPriority;
}) {
  const { t } = useTranslation();
  const ids = { priority: useId(), ack: useId(), pin: useId(), pinUntil: useId() };
  const errors = form.formState.errors;
  const pinnedUntil = useWatch({ control: form.control, name: 'pinnedUntil' });
  const [pinning, setPinning] = useState(pinnedUntil !== '');
  const today = businessDate(new Date());
  const critical = priority === 'critical';
  return (
    <>
      {/* Not a Field: its label would name every radio instead of the group. */}
      <div className="flex flex-col gap-2">
        <span id={ids.priority} className="text-sm font-medium">
          {t('announcements.form.priority')}
        </span>
        <Controller
          control={form.control}
          name="priority"
          render={({ field }) => (
            <RadioGroup<NotificationPriority>
              aria-labelledby={ids.priority}
              value={field.value}
              onValueChange={(next) => {
                field.onChange(next);
                if (next === 'critical') form.setValue('requiresAck', true, { shouldDirty: true });
              }}
              disabled={locked}
              className="sm:grid-cols-2"
            >
              {NOTIFICATION_PRIORITIES.map((value) => (
                <RadioCard
                  key={value}
                  value={value}
                  disabled={value === 'critical' && !manages}
                  title={t(`notifications.priorities.${value}`)}
                  description={
                    value === 'critical' && !manages
                      ? t('announcements.form.criticalNotAllowed')
                      : t(`announcements.form.priorityHints.${value}`)
                  }
                />
              ))}
            </RadioGroup>
          )}
        />
        {locked && (
          <p className="text-sm text-muted-foreground">{t('announcements.form.locked')}</p>
        )}
      </div>
      <Controller
        control={form.control}
        name="requiresAck"
        render={({ field }) => (
          <label htmlFor={ids.ack} className="flex cursor-pointer items-start gap-3 text-sm">
            <Checkbox
              id={ids.ack}
              checked={critical || field.value}
              disabled={locked || critical}
              onCheckedChange={field.onChange}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t('announcements.form.requiresAck')}</span>
              <span className="text-muted-foreground">
                {critical
                  ? t('announcements.form.requiresAckCritical')
                  : t('announcements.form.requiresAckHint')}
              </span>
            </span>
          </label>
        )}
      />
      <Field invalid={!!errors.pinnedUntil}>
        <label
          htmlFor={ids.pin}
          className="flex cursor-pointer items-center gap-3 text-sm font-medium"
        >
          <Switch
            id={ids.pin}
            checked={pinning}
            disabled={!manages}
            onCheckedChange={(next) => {
              setPinning(next);
              form.setValue('pinnedUntil', next ? addDays(today, 7) : '', { shouldDirty: true });
            }}
          />
          {t('announcements.form.pin')}
        </label>
        <FieldDescription>
          {manages ? t('announcements.form.pinHint') : t('announcements.form.pinNotAllowed')}
        </FieldDescription>
        {pinning && (
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={ids.pinUntil}>{t('announcements.form.pinUntil')}</FieldLabel>
            <Input
              id={ids.pinUntil}
              type="date"
              dir="ltr"
              className="sm:w-52"
              min={today}
              max={addDays(today, ANNOUNCEMENT_LIMITS.pinMaxDays)}
              {...form.register('pinnedUntil')}
            />
          </div>
        )}
        <FieldError match={!!errors.pinnedUntil}>
          {t('announcements.form.errors.pinnedUntil')}
        </FieldError>
      </Field>
    </>
  );
}

function PollField({ form, announcement }: { form: Form; announcement: Announcement | null }) {
  const { t } = useTranslation();
  const sent = announcement?.status === 'sent';
  const voted = (announcement?.poll?.voters ?? 0) > 0;
  const switchId = useId();
  const poll = useWatch({ control: form.control, name: 'poll' });
  if (sent && (!announcement?.poll || voted)) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LockIcon className="size-4" aria-hidden="true" />
        {announcement?.poll ? t('announcements.form.pollVoted') : t('announcements.form.pollNone')}
      </p>
    );
  }
  return (
    <>
      {!sent && (
        <label
          htmlFor={switchId}
          className="flex cursor-pointer items-center gap-3 text-sm font-medium"
        >
          <Switch
            id={switchId}
            checked={poll !== null}
            onCheckedChange={(next) =>
              form.setValue('poll', next ? emptyPoll() : null, { shouldDirty: true })
            }
          />
          {t('announcements.form.addPoll')}
        </label>
      )}
      {poll && (
        <Controller
          control={form.control}
          name="poll"
          render={({ field }) => (
            <PollBuilder
              value={field.value as PollDraft}
              onChange={field.onChange}
              errors={form.formState.errors.poll}
            />
          )}
        />
      )}
    </>
  );
}

function PollBuilder({
  value,
  onChange,
  errors,
}: {
  value: PollDraft;
  onChange: (next: PollDraft) => void;
  errors: FieldErrors<AnnouncementFormValues>['poll'];
}) {
  const { t } = useTranslation();
  const ids = {
    question: useId(),
    kind: useId(),
    anonymous: useId(),
    results: useId(),
    closesAt: useId(),
  };
  const set = (patch: Partial<PollDraft>) => onChange({ ...value, ...patch });
  const optionErrors = errors?.options as
    | (FieldErrors<{ label: string }> & Record<number, unknown> & { root?: unknown })
    | undefined;
  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-muted/30 p-4">
      <Field invalid={!!errors?.question}>
        <FieldLabel htmlFor={ids.question}>{t('announcements.form.pollQuestion')}</FieldLabel>
        <Input
          id={ids.question}
          maxLength={POLL_LIMITS.questionMax}
          value={value.question}
          onChange={(event) => set({ question: event.target.value })}
        />
        <FieldError match={!!errors?.question}>
          {t('announcements.form.errors.pollQuestion', {
            min: formatNumber(POLL_LIMITS.questionMin),
            max: formatNumber(POLL_LIMITS.questionMax),
          })}
        </FieldError>
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t('announcements.form.pollOptions')}</legend>
        {value.options.map((option, index) => (
          <div
            // Options have no ids before they are stored: their position is their identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={index}
            className="flex items-center gap-2"
          >
            <Input
              aria-label={t('announcements.form.pollOption', { n: formatNumber(index + 1) })}
              aria-invalid={!!optionErrors?.[index] || undefined}
              maxLength={POLL_LIMITS.optionLabel}
              value={option}
              onChange={(event) =>
                set({
                  options: value.options.map((other, at) =>
                    at === index ? event.target.value : other,
                  ),
                })
              }
            />
            <IconButton
              label={t('announcements.form.pollRemoveOption', { n: formatNumber(index + 1) })}
              disabled={value.options.length <= POLL_LIMITS.optionsMin}
              onClick={() => set({ options: value.options.filter((_, at) => at !== index) })}
            >
              <TrashIcon />
            </IconButton>
          </div>
        ))}
        {errors?.options && (
          <p className="text-sm text-destructive-text">
            {t('announcements.form.errors.pollOptions', {
              min: formatNumber(POLL_LIMITS.optionsMin),
              max: formatNumber(POLL_LIMITS.optionsMax),
            })}
          </p>
        )}
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          disabled={value.options.length >= POLL_LIMITS.optionsMax}
          focusableWhenDisabled
          onClick={() => set({ options: [...value.options, ''] })}
        >
          <PlusIcon />
          {t('announcements.form.pollAddOption')}
        </Button>
      </fieldset>
      <Field>
        <FieldLabel id={ids.kind} render={<span />}>
          {t('announcements.form.pollKind')}
        </FieldLabel>
        <ToggleGroup
          aria-labelledby={ids.kind}
          value={[value.multiple ? 'multiple' : 'single']}
          onValueChange={(next: string[]) => next[0] && set({ multiple: next[0] === 'multiple' })}
        >
          <ToggleGroupItem value="single">{t('announcements.poll.single')}</ToggleGroupItem>
          <ToggleGroupItem value="multiple">{t('announcements.poll.multiple')}</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <label htmlFor={ids.anonymous} className="flex cursor-pointer items-start gap-3 text-sm">
        <Checkbox
          id={ids.anonymous}
          checked={value.anonymous}
          onCheckedChange={(anonymous) => set({ anonymous })}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{t('announcements.poll.anonymous')}</span>
          <span className="text-muted-foreground">{t('announcements.form.pollAnonymousHint')}</span>
        </span>
      </label>
      <div className="flex flex-col gap-2">
        <span id={ids.results} className="text-sm font-medium">
          {t('announcements.form.pollResults')}
        </span>
        <RadioGroup<PollDraft['results']>
          aria-labelledby={ids.results}
          value={value.results}
          onValueChange={(results) => set({ results })}
        >
          {POLL_RESULTS_VISIBILITY.map((results) => (
            <RadioCard
              key={results}
              value={results}
              title={t(`announcements.form.pollResultsOptions.${results}`)}
            />
          ))}
        </RadioGroup>
      </div>
      <Field invalid={!!errors?.closesAt}>
        <FieldLabel htmlFor={ids.closesAt}>
          {t('announcements.form.pollClosesAt')}
          <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>
        </FieldLabel>
        <Input
          id={ids.closesAt}
          type="datetime-local"
          dir="ltr"
          className="sm:w-64"
          min={toBusinessDateTimeInput(new Date())}
          value={value.closesAt}
          onChange={(event) => set({ closesAt: event.target.value })}
        />
        <FieldDescription>{t('announcements.form.pollClosesAtHint')}</FieldDescription>
        <FieldError match={!!errors?.closesAt}>
          {t('announcements.form.errors.pollClosesAt')}
        </FieldError>
      </Field>
    </div>
  );
}

function SendingFields({ form, status }: { form: Form; status: Announcement['status'] }) {
  const { t } = useTranslation();
  const ids = { mode: useId(), at: useId(), notify: useId() };
  const errors = form.formState.errors;
  const mode = useWatch({ control: form.control, name: 'send' });
  if (status === 'sent') {
    return (
      <Controller
        control={form.control}
        name="notifyAgain"
        render={({ field }) => (
          <label htmlFor={ids.notify} className="flex cursor-pointer items-start gap-3 text-sm">
            <Checkbox id={ids.notify} checked={field.value} onCheckedChange={field.onChange} />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t('announcements.form.notifyAgain')}</span>
              <span className="text-muted-foreground">
                {t('announcements.form.notifyAgainHint')}
              </span>
            </span>
          </label>
        )}
      />
    );
  }
  const scheduleField = (
    <Field invalid={!!errors.scheduledAt}>
      <FieldLabel htmlFor={ids.at}>{t('announcements.form.scheduledAt')}</FieldLabel>
      <Input
        id={ids.at}
        type="datetime-local"
        dir="ltr"
        className="sm:w-64"
        min={toBusinessDateTimeInput(new Date())}
        {...form.register('scheduledAt')}
      />
      <FieldDescription>
        {t('announcements.form.scheduledAtHint', {
          days: formatNumber(ANNOUNCEMENT_LIMITS.scheduleMaxDays),
        })}
      </FieldDescription>
      <FieldError match={!!errors.scheduledAt}>
        {fieldError(errors.scheduledAt, t('announcements.form.errors.scheduledAt'))}
      </FieldError>
    </Field>
  );
  if (status === 'scheduled') return scheduleField;
  return (
    <>
      <Controller
        control={form.control}
        name="send"
        render={({ field }) => (
          <Field>
            <FieldLabel id={ids.mode} render={<span />}>
              {t('announcements.form.sendMode')}
            </FieldLabel>
            <ToggleGroup
              aria-labelledby={ids.mode}
              value={[field.value]}
              onValueChange={(next: SendMode[]) => next[0] && field.onChange(next[0])}
              className="flex-wrap"
            >
              {SEND_MODES.map((value) => (
                <ToggleGroupItem key={value} value={value}>
                  {t(`announcements.form.sendModes.${value}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        )}
      />
      {mode === 'schedule' && scheduleField}
    </>
  );
}

/** Cancel the schedule (back to draft) or discard a draft (rules D5, D10). */
function SecondaryActions({ announcement, form }: { announcement: Announcement; form: Form }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cancel = useCancelSchedule(announcement.id);
  const discard = useArchiveAnnouncement(announcement.id);
  const [confirming, setConfirming] = useState<'cancel' | 'discard' | null>(null);
  if (announcement.status !== 'draft' && announcement.status !== 'scheduled') return null;
  return (
    <>
      {announcement.status === 'scheduled' ? (
        <Button variant="outline" onClick={() => setConfirming('cancel')}>
          {t('announcements.form.cancelSchedule')}
        </Button>
      ) : (
        <Button variant="ghost" onClick={() => setConfirming('discard')}>
          <TrashIcon />
          {t('announcements.form.discard')}
        </Button>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={
          confirming === 'cancel'
            ? t('announcements.form.cancelScheduleTitle')
            : t('announcements.form.discardTitle')
        }
        body={
          confirming === 'cancel'
            ? t('announcements.form.cancelScheduleBody')
            : t('announcements.form.discardBody')
        }
        action={
          confirming === 'cancel'
            ? t('announcements.form.cancelSchedule')
            : t('announcements.form.discard')
        }
        destructive={confirming === 'discard'}
        pending={cancel.isPending || discard.isPending}
        onConfirm={async () => {
          if (confirming === 'cancel') {
            const draft = await cancel.mutateAsync();
            form.reset(announcementFormValues(draft));
            toast.add({ title: t('announcements.form.scheduleCancelled'), type: 'success' });
            return;
          }
          form.reset();
          await discard.mutateAsync();
          toast.add({ title: t('announcements.form.discarded'), type: 'success' });
          await navigate({ to: '/announcements', search: { view: 'sent' } });
        }}
      />
    </>
  );
}
