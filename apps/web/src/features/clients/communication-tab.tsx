import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  type ClientDetailResponse,
  type CreateNote,
  type CreateNoteInput,
  createNoteSchema,
  NOTE_CHANNELS,
  type Note,
  type NoteChannel,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveXIcon,
  EllipsisIcon,
  type LucideIcon,
  MailIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  PencilIcon,
  PhoneIcon,
  StickyNoteIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { errorMessage } from '../../lib/errors';
import {
  businessDay,
  formatDate,
  formatTime,
  fromBusinessDateTimeInput,
  toBusinessDateTimeInput,
} from '../../lib/format';
import { ALL } from '../../lib/search-params';
import {
  type NoteFilters,
  notesQuery,
  useArchiveNote,
  useCreateNote,
  useUpdateNote,
} from './clients.queries';

export const channelIcon: Record<NoteChannel, LucideIcon> = {
  call: PhoneIcon,
  meeting: UsersRoundIcon,
  whatsapp: MessageCircleIcon,
  email: MailIcon,
  other: StickyNoteIcon,
};

export function CommunicationTab({
  client,
  archived,
}: {
  client: ClientDetailResponse;
  /** An archived client's log is read-only (rule 7). */
  archived: boolean;
}) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<NoteFilters>({});
  const notes = useInfiniteQuery(notesQuery(client.id, filters));
  const [editing, setEditing] = useState<Note | null>(null);
  const [withdrawing, setWithdrawing] = useState<Note | null>(null);
  const archive = useArchiveNote(client.id);
  const filtered = filters.channel !== undefined || filters.contactId !== undefined;
  const items = notes.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <TabHeader title={t('clients.notes.title')} description={t('clients.notes.description')} />

      {!archived && (
        <Card className="gap-4 p-5">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <MessagesSquareIcon aria-hidden="true" className="size-5 text-muted-foreground" />
            {t('clients.notes.composerTitle')}
          </h3>
          <NoteForm client={client} />
        </Card>
      )}

      {(items.length > 0 || filtered) && (
        <NoteFiltersBar client={client} filters={filters} onChange={setFilters} />
      )}

      {notes.isPending ? (
        <TimelineSkeleton />
      ) : notes.isError ? (
        <LoadError message={t('clients.notes.loadError')} onRetry={() => notes.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<MessagesSquareIcon />}
          title={filtered ? t('clients.notes.emptyFilteredTitle') : t('clients.notes.emptyTitle')}
          description={
            filtered ? t('clients.notes.emptyFilteredHint') : t('clients.notes.emptyHint')
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          <Timeline
            notes={items}
            readOnly={archived}
            onEdit={setEditing}
            onWithdraw={setWithdrawing}
          />
          {notes.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              onClick={() => notes.fetchNextPage()}
              disabled={notes.isFetchingNextPage}
            >
              {notes.isFetchingNextPage ? t('common.loading') : t('clients.notes.loadMore')}
            </Button>
          )}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('clients.notes.editTitle')}</DialogTitle>
          </DialogHeader>
          {editing && <NoteForm client={client} note={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={withdrawing !== null}
        onClose={() => setWithdrawing(null)}
        title={t('clients.notes.archiveTitle')}
        body={t('clients.notes.archiveBody')}
        action={t('clients.notes.archiveAction')}
        destructive
        pending={archive.isPending}
        onConfirm={async () => {
          if (!withdrawing) return;
          await archive.mutateAsync(withdrawing.id);
          toast.add({ title: t('clients.notes.archived'), type: 'success' });
        }}
      />
    </>
  );
}

function NoteFiltersBar({
  client,
  filters,
  onChange,
}: {
  client: ClientDetailResponse;
  filters: NoteFilters;
  onChange: (filters: NoteFilters) => void;
}) {
  const { t } = useTranslation();
  const channels = [
    { value: ALL, label: t('clients.notes.allChannels') },
    ...NOTE_CHANNELS.map((channel) => ({
      value: channel,
      label: t(`clients.notes.channels.${channel}`),
    })),
  ];
  const contacts = [
    { value: ALL, label: t('clients.notes.allContacts') },
    ...client.contacts.map((contact) => ({ value: contact.id, label: contact.name })),
  ];
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <FilterSelect
        label={t('clients.notes.channel')}
        items={channels}
        value={filters.channel ?? ALL}
        onChange={(value) =>
          onChange({ ...filters, channel: value === ALL ? undefined : (value as NoteChannel) })
        }
      />
      <FilterSelect
        label={t('clients.notes.contact')}
        items={contacts}
        value={filters.contactId ?? ALL}
        onChange={(value) => onChange({ ...filters, contactId: value === ALL ? undefined : value })}
      />
    </div>
  );
}

function FilterSelect({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select items={items} value={value} onValueChange={(next) => onChange(next ?? ALL)}>
      <SelectTrigger aria-label={label} className="sm:w-56">
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
  );
}

/** Notes grouped by day in the business timezone, newest first, on a vertical line. */
function Timeline({
  notes,
  readOnly,
  onEdit,
  onWithdraw,
}: {
  notes: Note[];
  readOnly: boolean;
  onEdit: (note: Note) => void;
  onWithdraw: (note: Note) => void;
}) {
  const days = new Map<string, Note[]>();
  for (const note of notes) {
    const day = businessDay(note.occurredAt);
    days.set(day, [...(days.get(day) ?? []), note]);
  }
  return (
    <div className="flex flex-col gap-6">
      {[...days.entries()].map(([day, dayNotes]) => (
        <section key={day} className="flex flex-col gap-3">
          <h3 className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
            <span aria-hidden="true" className="inline-block h-4 w-0.5 -skew-x-30 bg-accent" />
            {formatDate(dayNotes[0]?.occurredAt ?? day)}
          </h3>
          <ol className="flex flex-col">
            {dayNotes.map((note) => (
              <TimelineEntry
                key={note.id}
                note={note}
                readOnly={readOnly}
                onEdit={() => onEdit(note)}
                onWithdraw={() => onWithdraw(note)}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function TimelineEntry({
  note,
  readOnly,
  onEdit,
  onWithdraw,
}: {
  note: Note;
  readOnly: boolean;
  onEdit: () => void;
  onWithdraw: () => void;
}) {
  const { t } = useTranslation();
  const Icon = channelIcon[note.channel];
  const canEdit = !readOnly && note.canEdit;
  const canWithdraw = !readOnly && note.canArchive;
  return (
    <li className="relative flex gap-4 pb-4 last:pb-0">
      {/* The line joining the day's notes, behind the channel markers. */}
      <span
        aria-hidden="true"
        className="absolute start-4.5 top-10 bottom-0 w-px bg-border in-[li:last-child]:hidden"
      />
      <span
        aria-hidden="true"
        className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground"
      >
        <Icon className="size-4" />
      </span>
      <article className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
          <Badge tone="neutral">{t(`clients.notes.channels.${note.channel}`)}</Badge>
          <time dateTime={note.occurredAt} className="text-muted-foreground tabular-nums">
            {formatTime(note.occurredAt)}
          </time>
          {note.contact && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-1 rounded-full bg-border" />
              <span className={note.contact.archived ? 'text-muted-foreground' : 'font-medium'}>
                {note.contact.name}
              </span>
              {note.contact.archived && (
                <Badge tone="outline">{t('clients.notes.removedContact')}</Badge>
              )}
            </span>
          )}
          <span className="ms-auto flex items-center gap-2">
            <Avatar name={note.author.name} size="sm" />
            <span className="text-muted-foreground">{note.author.name}</span>
            {(canEdit || canWithdraw) && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('clients.notes.actions')}
                    />
                  }
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit && (
                    <DropdownMenuItem onClick={onEdit}>
                      <PencilIcon />
                      {t('clients.notes.edit')}
                    </DropdownMenuItem>
                  )}
                  {canEdit && canWithdraw && <DropdownMenuSeparator />}
                  {canWithdraw && (
                    <DropdownMenuItem variant="destructive" onClick={onWithdraw}>
                      <ArchiveXIcon />
                      {t('clients.notes.archive')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        </header>
        <p className="text-base whitespace-pre-line">{note.summary}</p>
      </article>
    </li>
  );
}

const freshNote = (): CreateNoteInput => ({
  summary: '',
  channel: 'call',
  contactId: null,
  occurredAt: new Date().toISOString(),
});

const NO_CONTACT = 'none';

/**
 * Adds a note (the composer) or edits one (in a dialog). The time is entered in the business
 * timezone and stored as an instant; it defaults to now, and may be earlier (edge case 9).
 */
function NoteForm({
  client,
  note,
  onDone,
}: {
  client: ClientDetailResponse;
  note?: Note;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const ids = { channel: useId(), time: useId() };
  const create = useCreateNote(client.id);
  const update = useUpdateNote(client.id);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CreateNoteInput, unknown, CreateNote>({
    resolver: standardSchemaResolver(createNoteSchema),
    defaultValues: note
      ? {
          summary: note.summary,
          channel: note.channel,
          contactId: note.contact?.id ?? null,
          occurredAt: note.occurredAt,
        }
      : freshNote(),
  });
  const { errors } = form.formState;

  // A removed contact stays selectable on a note that already names it (rule 10).
  const contacts = [
    { value: NO_CONTACT, label: t('clients.notes.noContact') },
    ...client.contacts.map((contact) => ({ value: contact.id, label: contact.name })),
    ...(note?.contact?.archived ? [{ value: note.contact.id, label: note.contact.name }] : []),
  ];

  const labels = note
    ? { submit: t('common.save'), submitting: t('common.saving') }
    : { submit: t('clients.notes.add'), submitting: t('clients.notes.adding') };

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      if (note) {
        await update.mutateAsync({ noteId: note.id, ...values });
        toast.add({ title: t('clients.notes.saved'), type: 'success' });
      } else {
        // An untouched time means "now": the API stamps the note when it is added.
        await create.mutateAsync({
          ...values,
          occurredAt: form.formState.dirtyFields.occurredAt ? values.occurredAt : undefined,
        });
        toast.add({ title: t('clients.notes.added'), type: 'success' });
        form.reset(freshNote());
      }
      onDone?.();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <Field invalid={!!errors.summary}>
        <FieldLabel className={note ? undefined : 'sr-only'}>
          {t('clients.notes.summary')}
        </FieldLabel>
        <Textarea
          className="min-h-20"
          placeholder={t('clients.notes.summaryPlaceholder')}
          {...form.register('summary')}
        />
        <FieldError match={!!errors.summary}>{t('clients.notes.errors.summary')}</FieldError>
      </Field>

      <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <Field>
          <FieldLabel id={ids.channel} render={<span />}>
            {t('clients.notes.channel')}
          </FieldLabel>
          <Controller
            control={form.control}
            name="channel"
            render={({ field }) => (
              <ToggleGroup
                aria-labelledby={ids.channel}
                className="flex-wrap"
                value={[field.value]}
                onValueChange={(next: NoteChannel[]) => {
                  if (next[0]) field.onChange(next[0]);
                }}
              >
                {NOTE_CHANNELS.map((channel) => {
                  const Icon = channelIcon[channel];
                  return (
                    <ToggleGroupItem key={channel} value={channel}>
                      <Icon aria-hidden="true" />
                      {t(`clients.notes.channels.${channel}`)}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            )}
          />
        </Field>
        <Field>
          <FieldLabel>{t('clients.notes.contact')}</FieldLabel>
          <Controller
            control={form.control}
            name="contactId"
            render={({ field }) => (
              <Select
                items={contacts}
                value={field.value ?? NO_CONTACT}
                onValueChange={(value) => field.onChange(value === NO_CONTACT ? null : value)}
              >
                <SelectTrigger className="min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        <Field invalid={!!errors.occurredAt}>
          <FieldLabel htmlFor={ids.time}>{t('clients.notes.occurredAt')}</FieldLabel>
          <Controller
            control={form.control}
            name="occurredAt"
            render={({ field }) => (
              <Input
                id={ids.time}
                type="datetime-local"
                dir="ltr"
                className="text-end tabular-nums"
                max={toBusinessDateTimeInput(new Date())}
                value={field.value ? toBusinessDateTimeInput(field.value) : ''}
                onChange={(event) =>
                  field.onChange(
                    event.target.value ? fromBusinessDateTimeInput(event.target.value) : '',
                  )
                }
                onBlur={field.onBlur}
              />
            )}
          />
          <FieldDescription>{t('clients.notes.occurredAtHint')}</FieldDescription>
          <FieldError match={!!errors.occurredAt}>
            {t('clients.notes.errors.occurredAt')}
          </FieldError>
        </Field>
      </div>

      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {onDone && (
          <Button variant="outline" type="button" onClick={onDone}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? labels.submitting : labels.submit}
        </Button>
      </div>
    </form>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {['a', 'b', 'c'].map((row) => (
        <div key={row} className="flex gap-4">
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="h-24 flex-1" />
        </div>
      ))}
    </div>
  );
}
