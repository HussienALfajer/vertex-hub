import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import {
  businessDate,
  type CreatePost,
  type CreatePostInput,
  createPostSchema,
  POST_LIMITS,
  POST_PLATFORMS,
  POST_TYPES,
  type PostDetail,
  type PostPlatform,
  type PostType,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PlatformMark,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { useId, useState } from 'react';
import { Controller, type FieldPath, type UseFormReturn, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { useMe } from '../../lib/auth';
import { errorMessage, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { formatMonth, formatNumber } from '../../lib/format';
import { clientQuery } from '../clients/clients.queries';
import { lineName } from '../retainers/retainer-badges';
import { retainerListQuery } from '../retainers/retainers.queries';
import { useClientOptions, useDepartmentMembers } from '../tasks/task-form';
import { useCreatePost } from './content.queries';
import { canEditPostsOf, POST_TYPE_ICONS } from './post-parts';

/*
 * The fields of a post (spec F08, screens 3 and 4). The new-post dialog and the edit dialogs of
 * the post page share them over one form shape, `createPostSchema`; an edit sends only what
 * changed.
 */

export type PostFormMethods = UseFormReturn<CreatePostInput, unknown, CreatePost>;

type PostField = FieldPath<CreatePostInput>;

/** The field a refusal concerns; anything else shows above the buttons. */
const FIELD_OF_CODE: Record<string, PostField> = {
  CLIENT_ARCHIVED: 'clientId',
  CLIENT_ENDED: 'clientId',
  INVALID_RESPONSIBLE: 'responsibleId',
  INVALID_DATES: 'publishDate',
  INVALID_LINK: 'cycleLineId',
  CYCLE_CLOSED: 'cycleLineId',
  POST_COUNTED_BY_TASK: 'cycleLineId',
};

/**
 * Puts a failed save on the field it concerns and returns the form-level message for anything
 * else (null when a field took it).
 */
export function postFormFailure(form: PostFormMethods, t: TFunction, error: unknown) {
  const field = error instanceof ApiError ? FIELD_OF_CODE[error.code ?? ''] : undefined;
  if (field) {
    // The shared text of `INVALID_DATES` speaks of a start date, which posts do not have.
    const message =
      field === 'publishDate' ? t('content.form.errors.datePast') : errorMessage(t, error);
    form.setError(field, { type: SCREEN_ERROR, message });
    return null;
  }
  return errorMessage(t, error);
}

const Optional = () => {
  const { t } = useTranslation();
  return <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>;
};

export function TitleField({ form }: { form: PostFormMethods }) {
  const { t } = useTranslation();
  const error = form.formState.errors.title;
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('content.form.title')}</FieldLabel>
      <Input
        autoComplete="off"
        placeholder={t('content.form.titlePlaceholder')}
        {...form.register('title')}
      />
      <FieldDescription>{t('content.form.titleHint')}</FieldDescription>
      <FieldError match={!!error}>{t('content.form.errors.title')}</FieldError>
    </Field>
  );
}

export function TypeField({ form }: { form: PostFormMethods }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field>
      <FieldLabel id={id} render={<span />}>
        {t('content.form.type')}
      </FieldLabel>
      <Controller
        control={form.control}
        name="type"
        render={({ field }) => (
          <ToggleGroup
            aria-labelledby={id}
            className="max-w-full flex-wrap"
            value={[field.value]}
            onValueChange={(next: PostType[]) => next[0] && field.onChange(next[0])}
          >
            {POST_TYPES.map((type) => {
              const Icon = POST_TYPE_ICONS[type];
              return (
                <ToggleGroupItem key={type} value={type}>
                  <Icon aria-hidden="true" />
                  {t(`content.types.${type}`)}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        )}
      />
    </Field>
  );
}

/** The platforms the post goes out on: the client's own accounts first, then the rest. */
export function PlatformsField({ form }: { form: PostFormMethods }) {
  const { t } = useTranslation();
  const id = useId();
  const clientId = useWatch({ control: form.control, name: 'clientId' });
  const client = useQuery({ ...clientQuery(clientId), enabled: !!clientId });
  const error = form.formState.errors.platforms;
  const owned = new Set(client.data?.platformAccounts.map((account) => account.platform));
  const ordered = [
    ...POST_PLATFORMS.filter((platform) => owned.has(platform)),
    ...POST_PLATFORMS.filter((platform) => !owned.has(platform)),
  ];
  // A fieldset, not a `Field`: each checkbox is named by its own platform, the group by the legend.
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{t('content.form.platforms')}</legend>
      <Controller
        control={form.control}
        name="platforms"
        render={({ field }) => {
          const chosen: PostPlatform[] = field.value ?? [];
          return (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ordered.map((platform) => (
                <li key={platform}>
                  <label
                    htmlFor={`${id}-${platform}`}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                  >
                    <Checkbox
                      id={`${id}-${platform}`}
                      checked={chosen.includes(platform)}
                      onCheckedChange={(checked) =>
                        // Kept in the fixed order of the platforms, whatever the click order.
                        field.onChange(
                          POST_PLATFORMS.filter((known) =>
                            known === platform ? checked : chosen.includes(known),
                          ),
                        )
                      }
                    />
                    <PlatformMark platform={platform} size="xs" />
                    <span className="truncate">{t(`clients.platforms.names.${platform}`)}</span>
                  </label>
                </li>
              ))}
            </ul>
          );
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {t('content.form.errors.platforms')}
        </p>
      )}
    </fieldset>
  );
}

/** The publish date and an optional time; marking a post scheduled needs the time (rule 17). */
export function PublishFields({ form, allowPast }: { form: PostFormMethods; allowPast?: boolean }) {
  const { t } = useTranslation();
  const dateError = form.formState.errors.publishDate;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field invalid={!!dateError}>
        <FieldLabel>{t('content.form.publishDate')}</FieldLabel>
        <Input
          type="date"
          min={allowPast ? undefined : businessDate()}
          {...form.register('publishDate')}
        />
        <FieldError match={!!dateError}>
          {fieldError(dateError, t('content.form.errors.publishDate'))}
        </FieldError>
      </Field>
      <Field>
        <FieldLabel>
          {t('content.form.publishTime')}
          <Optional />
        </FieldLabel>
        <Controller
          control={form.control}
          name="publishTime"
          render={({ field }) => (
            <Input
              type="time"
              value={field.value ?? ''}
              onChange={(event) => field.onChange(event.target.value || null)}
              onBlur={field.onBlur}
              ref={field.ref}
            />
          )}
        />
        <FieldDescription>{t('content.form.publishTimeHint')}</FieldDescription>
      </Field>
    </div>
  );
}

/** "120 / 5000", in the danger color past the limit. */
function CharacterCount({ length, max }: { length: number; max: number }) {
  return (
    <span
      className={
        length > max
          ? 'text-xs text-destructive-text tabular-nums'
          : 'text-xs text-muted-foreground tabular-nums'
      }
    >
      {formatNumber(length)} / {formatNumber(max)}
    </span>
  );
}

/** The caption and its hashtags: one text for every platform of the post, with their lengths. */
export function CaptionFields({ form }: { form: PostFormMethods }) {
  const { t } = useTranslation();
  const [caption, hashtags] = useWatch({ control: form.control, name: ['caption', 'hashtags'] });
  const captionError = form.formState.errors.caption;
  const hashtagsError = form.formState.errors.hashtags;
  return (
    <>
      <Field invalid={!!captionError}>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>
            {t('content.form.caption')}
            <Optional />
          </FieldLabel>
          <CharacterCount length={caption?.length ?? 0} max={POST_LIMITS.caption} />
        </div>
        <Textarea
          rows={5}
          dir="auto"
          placeholder={t('content.form.captionPlaceholder')}
          {...form.register('caption')}
        />
        <FieldError match={!!captionError}>{t('content.form.errors.caption')}</FieldError>
      </Field>
      <Field invalid={!!hashtagsError}>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>
            {t('content.form.hashtags')}
            <Optional />
          </FieldLabel>
          <CharacterCount length={hashtags?.length ?? 0} max={POST_LIMITS.hashtags} />
        </div>
        <Textarea
          rows={2}
          dir="auto"
          placeholder={t('content.form.hashtagsPlaceholder')}
          {...form.register('hashtags')}
        />
        <FieldError match={!!hashtagsError}>{t('content.form.errors.hashtags')}</FieldError>
      </Field>
    </>
  );
}

export function NotesField({ form }: { form: PostFormMethods }) {
  const { t } = useTranslation();
  const error = form.formState.errors.notes;
  return (
    <Field invalid={!!error}>
      <FieldLabel>
        {t('content.form.notes')}
        <Optional />
      </FieldLabel>
      <Textarea
        rows={2}
        placeholder={t('content.form.notesPlaceholder')}
        {...form.register('notes')}
      />
      <FieldDescription>{t('content.form.notesHint')}</FieldDescription>
      <FieldError match={!!error}>{t('content.form.errors.notes')}</FieldError>
    </Field>
  );
}

export function ApprovalField({ form }: { form: PostFormMethods }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Controller
      control={form.control}
      name="needsClientApproval"
      render={({ field }) => (
        <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm font-medium">
          <Switch id={id} checked={field.value ?? true} onCheckedChange={field.onChange} />
          <span className="flex flex-col gap-0.5">
            {t('content.form.needsClientApproval')}
            <span className="font-normal text-muted-foreground">
              {t('content.form.needsClientApprovalHint')}
            </span>
          </span>
        </label>
      )}
    />
  );
}

interface PersonOption {
  id: string;
  name: string;
}

/**
 * Who may be responsible for a post of the client: the members of Content Management, the
 * client's account manager, the user creating it and the current responsible person. The API
 * decides (`INVALID_RESPONSIBLE`).
 */
function useResponsibleOptions(clientId: string, current?: PersonOption): PersonOption[] {
  const me = useMe();
  const client = useQuery({ ...clientQuery(clientId), enabled: !!clientId });
  const members = useDepartmentMembers('content_management');
  const options = new Map<string, PersonOption>();
  if (current) options.set(current.id, current);
  options.set(me.user.id, { id: me.user.id, name: me.user.name });
  const manager = client.data?.accountManager;
  if (manager && !manager.archived) options.set(manager.id, manager);
  for (const member of members) options.set(member.id, member);
  return [...options.values()];
}

export function ResponsibleField({
  form,
  current,
}: {
  form: PostFormMethods;
  current?: PersonOption;
}) {
  const { t } = useTranslation();
  const clientId = useWatch({ control: form.control, name: 'clientId' });
  const options = useResponsibleOptions(clientId, current);
  const error = form.formState.errors.responsibleId;
  const items = options.map((option) => ({ value: option.id, label: option.name }));
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('content.form.responsible')}</FieldLabel>
      <Controller
        control={form.control}
        name="responsibleId"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value ?? null}
            onValueChange={(next) => next && field.onChange(next)}
          >
            <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  <span className="flex items-center gap-2">
                    <Avatar name={option.name} size="sm" />
                    {option.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldDescription>{t('content.form.responsibleHint')}</FieldDescription>
      <FieldError match={!!error}>
        {fieldError(error, t('content.form.errors.responsible'))}
      </FieldError>
    </Field>
  );
}

const NO_LINE = 'none';

/** The lines of the open cycles of the client's retainers, each named with its retainer. */
export function useCycleLineOptions(clientId: string) {
  const { t } = useTranslation();
  const retainers = useQuery({
    ...retainerListQuery({ clientId, pageSize: 100 }),
    enabled: !!clientId,
    // Another client's lines must never be offered while these load.
    placeholderData: undefined,
  });
  return (retainers.data?.items ?? []).flatMap((retainer) =>
    retainer.currentCycle?.status === 'open'
      ? retainer.currentCycle.lines.map((line) => ({
          line,
          label: t('content.form.cycleLineOption', {
            line: lineName(t, line),
            retainer: retainer.name,
            month: formatMonth(retainer.currentCycle?.month ?? ''),
          }),
        }))
      : [],
  );
}

/**
 * The retainer line the post counts on directly when published (rule 16); a post with a linked
 * task on a line is counted through the task instead (`POST_COUNTED_BY_TASK`).
 */
export function CycleLineField({
  form,
  current,
}: {
  form: PostFormMethods;
  current?: PostDetail['cycleLine'];
}) {
  const { t } = useTranslation();
  const clientId = useWatch({ control: form.control, name: 'clientId' });
  const options = useCycleLineOptions(clientId);
  const error = form.formState.errors.cycleLineId;
  const items = [
    { value: NO_LINE, label: t('content.form.noCycleLine') },
    ...options.map((option) => ({ value: option.line.id, label: option.label })),
  ];
  // Edge case 4: a line of an earlier month's open cycle stays chosen.
  if (current && !items.some((item) => item.value === current.id)) {
    items.push({
      value: current.id,
      label: `${lineName(t, current)} · ${current.retainer.name}`,
    });
  }
  return (
    <Field invalid={!!error}>
      <FieldLabel>
        {t('content.form.cycleLine')}
        <Optional />
      </FieldLabel>
      <Controller
        control={form.control}
        name="cycleLineId"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value ?? NO_LINE}
            onValueChange={(next) => field.onChange(!next || next === NO_LINE ? null : next)}
          >
            <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldDescription>{t('content.form.cycleLineHint')}</FieldDescription>
      <FieldError match={!!error}>{fieldError(error, t('errors.INVALID_LINK'))}</FieldError>
    </Field>
  );
}

function ClientField({ form }: { form: PostFormMethods }) {
  const { t } = useTranslation();
  const me = useMe();
  // Rule 2: active and paused clients; those under the user's edit scope.
  const clients = useClientOptions().filter((client) =>
    canEditPostsOf(me, client.accountManagerId),
  );
  const error = form.formState.errors.clientId;
  const items = clients.map((client) => ({ value: client.id, label: client.name }));
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('content.form.client')}</FieldLabel>
      <Controller
        control={form.control}
        name="clientId"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value || null}
            onValueChange={(next) => next && field.onChange(next)}
          >
            <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
              <SelectValue placeholder={t('content.form.clientPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldError match={!!error}>{fieldError(error, t('content.form.errors.client'))}</FieldError>
    </Field>
  );
}

/**
 * The new-post dialog (screen 3). From a client's Content tab the client is fixed; on the Content
 * page it is chosen among the clients the user may edit.
 */
export function NewPostDialog({
  client,
  defaultDate,
  onClose,
}: {
  client?: { id: string; name: string };
  defaultDate?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const create = useCreatePost();
  const [failure, setFailure] = useState<string | null>(null);
  const today = businessDate();
  const form = useForm<CreatePostInput, unknown, CreatePost>({
    resolver: standardSchemaResolver(createPostSchema),
    defaultValues: {
      clientId: client?.id ?? '',
      title: '',
      type: 'post',
      platforms: [],
      // A new post is never in the past (`INVALID_DATES`).
      publishDate: defaultDate && defaultDate > today ? defaultDate : today,
      publishTime: null,
      caption: '',
      hashtags: '',
      notes: '',
      needsClientApproval: true,
      responsibleId: me.user.id,
    },
  });
  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await create.mutateAsync(values);
      toast.add({ title: t('content.new.created'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(postFormFailure(form, t, error));
    }
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('content.new.title')}</DialogTitle>
            <DialogDescription>
              {client ? t('content.new.forClient', { client: client.name }) : t('content.new.body')}
            </DialogDescription>
          </DialogHeader>
          {!client && <ClientField form={form} />}
          <TitleField form={form} />
          <TypeField form={form} />
          <PlatformsField form={form} />
          <PublishFields form={form} />
          <CaptionFields form={form} />
          <NotesField form={form} />
          <ResponsibleField form={form} />
          <ApprovalField form={form} />
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('common.saving') : t('content.new.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
