import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CONTENT_PLANNING_LIMITS,
  type ContentIdea,
  createContentIdeaSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  ChartDot,
  cn,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { LightbulbIcon, PlusIcon, UserRoundIcon, WandSparklesIcon, XIcon } from 'lucide-react';
import { type ComponentProps, type DragEvent, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { ALL } from '../../lib/search-params';
import { clientListQuery } from '../clients/clients.queries';
import { FormDialog } from '../quotes/quote-dialogs';
import {
  contentIdeasQuery,
  contentPillarsQuery,
  useCreateIdea,
  useDropIdea,
} from './content.queries';

/*
 * The ideas bank (spec F08B rule C12, screens 2 and 7): any user adds an idea in one line, from
 * the top bar or the panel beside the calendar; the content team drags it onto a day or uses it,
 * which opens the wizard from it, or drops it.
 */

/** Ideas the panel lists; the rest wait for the next ones to be used or dropped. */
const PANEL_SIZE = 50;

/**
 * The open ideas beside the calendar, of the client on a client's calendar, newest first; "Mine"
 * narrows them to the user's. Each drags onto a day of today or later when the user may create
 * posts.
 */
export function IdeasPanel({
  clientId,
  canDrag,
  draggedId,
  onDragStart,
  onDragEnd,
}: {
  clientId?: string;
  canDrag: boolean;
  draggedId: string | null;
  onDragStart: (event: DragEvent, idea: ContentIdea) => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const titleId = useId();
  const [mine, setMine] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dropping, setDropping] = useState<ContentIdea | null>(null);
  const ideas = useQuery(
    contentIdeasQuery({
      status: 'open',
      clientId,
      ...(mine && { mine: 'true' as const }),
      pageSize: PANEL_SIZE,
    }),
  );
  const items = ideas.data?.items ?? [];

  return (
    <section
      aria-labelledby={titleId}
      data-ideas-panel
      className="flex flex-col self-start overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <LightbulbIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        <h2 id={titleId} className="text-base font-bold">
          {t('content.ideas.title')}
        </h2>
        <Button
          variant={mine ? 'secondary' : 'ghost'}
          size="sm"
          className="ms-auto"
          aria-pressed={mine}
          onClick={() => setMine((current) => !current)}
        >
          <UserRoundIcon />
          {t('content.ideas.mine')}
        </Button>
        {can(me, 'content.suggest') && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon />
            {t('content.ideas.add')}
          </Button>
        )}
      </div>
      {canDrag && items.length > 0 && (
        <p className="px-3 pt-2 text-xs text-muted-foreground">{t('content.ideas.dragHint')}</p>
      )}
      {ideas.isPending ? (
        <div className="flex flex-col gap-2 p-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : ideas.isError ? (
        <div className="p-3">
          <LoadError message={t('content.ideas.loadError')} onRetry={() => ideas.refetch()} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<LightbulbIcon />}
          title={t('content.ideas.emptyTitle')}
          description={t('content.ideas.emptyHint')}
        />
      ) : (
        <ul className="flex max-h-[70dvh] flex-col gap-2 overflow-y-auto p-3">
          {items.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              showClient={!clientId}
              dragging={draggedId === idea.id}
              onDragStart={
                canDrag && idea.permissions.canUse ? (event) => onDragStart(event, idea) : undefined
              }
              onDragEnd={onDragEnd}
              onDrop={() => setDropping(idea)}
            />
          ))}
        </ul>
      )}
      <IdeaDialog open={adding} onClose={() => setAdding(false)} clientId={clientId} />
      <DropIdeaDialog idea={dropping} onClose={() => setDropping(null)} />
    </section>
  );
}

function IdeaCard({
  idea,
  showClient,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  idea: ContentIdea;
  showClient: boolean;
  dragging: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const { t } = useTranslation();
  const meta = [
    showClient ? (idea.client?.name ?? t('content.ideas.noClient')) : null,
    idea.createdBy.name,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li
      data-idea={idea.id}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'flex flex-col gap-2 rounded-md border border-border bg-surface p-2.5 text-sm',
        onDragStart && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-50',
      )}
    >
      <p className="whitespace-pre-line">{idea.text}</p>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {idea.pillar && (
          <span className="flex items-center gap-1">
            <ChartDot color={idea.pillar.color} muted={idea.pillar.archived} />
            {idea.pillar.name}
          </span>
        )}
        {idea.occasion && <span>{idea.occasion.name}</span>}
        <span className="truncate">{meta}</span>
      </span>
      {(idea.permissions.canUse || idea.permissions.canDrop) && (
        <span className="flex flex-wrap items-center gap-1.5">
          {idea.permissions.canUse && (
            <Button
              size="sm"
              variant="outline"
              draggable={false}
              render={
                <Link
                  to="/content/new"
                  search={{ ideaId: idea.id, ...(idea.client && { clientId: idea.client.id }) }}
                />
              }
            >
              <WandSparklesIcon />
              {t('content.ideas.use')}
            </Button>
          )}
          {idea.permissions.canDrop && (
            <Button size="sm" variant="ghost" onClick={onDrop}>
              <XIcon />
              {t('content.ideas.drop')}
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

interface IdeaValues {
  text: string;
  clientId: string;
  pillarId: string;
}

/**
 * Screen 7: an idea in one line, with an optional client and pillar. From the top bar for every
 * user, or the ideas panel with its client preset.
 */
export function IdeaDialog({
  open,
  onClose,
  clientId,
  finalFocus,
}: {
  open: boolean;
  onClose: () => void;
  clientId?: string;
  finalFocus?: ComponentProps<typeof FormDialog>['finalFocus'];
}) {
  const { t } = useTranslation();
  const textId = useId();
  const create = useCreateIdea();
  const [failure, setFailure] = useState<string | null>(null);
  const clients = useQuery({
    ...clientListQuery({ status: ['active', 'paused'], pageSize: 100 }),
    enabled: open,
  });
  const pillars = useQuery({ ...contentPillarsQuery, enabled: open });
  const defaults: IdeaValues = { text: '', clientId: clientId ?? ALL, pillarId: ALL };
  const form = useForm<IdeaValues>({ values: defaults });
  const { errors } = form.formState;
  const clientItems = [
    { value: ALL, label: t('content.ideas.noClient') },
    ...(clients.data?.items ?? []).map((client) => ({
      value: client.id,
      label: client.tradeName,
    })),
  ];
  const livePillars = (pillars.data?.items ?? []).filter((pillar) => !pillar.archived);
  const pillarItems = [
    { value: ALL, label: t('content.ideas.noPillar') },
    ...livePillars.map((pillar) => ({ value: pillar.id, label: pillar.name })),
  ];

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const checked = createContentIdeaSchema.safeParse({
      text: values.text,
      clientId: values.clientId === ALL ? null : values.clientId,
      pillarId: values.pillarId === ALL ? null : values.pillarId,
    });
    if (!checked.success) {
      form.setError('text', { type: 'schema' });
      return;
    }
    try {
      await create.mutateAsync(checked.data);
      toast.add({ title: t('content.ideas.added'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={t('content.ideas.addTitle')}
      description={t('content.ideas.addBody')}
      action={t('content.ideas.addAction')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.text}>
        <FieldLabel htmlFor={textId}>{t('content.ideas.text')}</FieldLabel>
        <Textarea
          id={textId}
          rows={2}
          maxLength={CONTENT_PLANNING_LIMITS.ideaText}
          placeholder={t('content.ideas.textPlaceholder')}
          {...form.register('text')}
        />
        <FieldError match={!!errors.text}>{t('content.ideas.textError')}</FieldError>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChoiceField
          name="clientId"
          label={t('content.ideas.client')}
          items={clientItems}
          control={form.control}
        />
        <ChoiceField
          name="pillarId"
          label={t('content.ideas.pillar')}
          items={pillarItems}
          control={form.control}
        />
      </div>
      <p className="text-sm text-muted-foreground">{t('content.ideas.addHint')}</p>
    </FormDialog>
  );
}

function ChoiceField({
  name,
  label,
  items,
  control,
}: {
  name: 'clientId' | 'pillarId';
  label: string;
  items: { value: string; label: string }[];
  control: ReturnType<typeof useForm<IdeaValues>>['control'];
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select
            items={items}
            value={field.value}
            onValueChange={(next) => field.onChange(next ?? ALL)}
          >
            <SelectTrigger id={id}>
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
    </Field>
  );
}

/** Rule C12: an open idea dropped, with an optional reason; it can be restored later. */
function DropIdeaDialog({ idea, onClose }: { idea: ContentIdea | null; onClose: () => void }) {
  const { t } = useTranslation();
  const reasonId = useId();
  const drop = useDropIdea();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  const submit = form.handleSubmit(async ({ reason }) => {
    if (!idea) return;
    setFailure(null);
    try {
      await drop.mutateAsync({ id: idea.id, reason: reason.trim() || undefined });
      toast.add({ title: t('content.ideas.dropped'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });
  return (
    <FormDialog
      open={idea !== null}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset({ reason: '' });
      }}
      submitting={form.formState.isSubmitting}
      title={t('content.ideas.dropTitle')}
      description={idea?.text ?? ''}
      action={t('content.ideas.drop')}
      failure={failure}
      onSubmit={submit}
    >
      <Field>
        <FieldLabel htmlFor={reasonId}>{t('content.ideas.dropReason')}</FieldLabel>
        <Textarea
          id={reasonId}
          rows={2}
          maxLength={CONTENT_PLANNING_LIMITS.dropReason}
          {...form.register('reason')}
        />
      </Field>
    </FormDialog>
  );
}
