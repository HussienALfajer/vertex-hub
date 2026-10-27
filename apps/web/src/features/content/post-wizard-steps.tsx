import { useQuery } from '@tanstack/react-query';
import {
  addDays,
  type CalendarDate,
  daysInclusive,
  PLANNING_RULES,
  POST_LIMITS,
  type PostCheck,
  type PostPlatform,
  suggestPublishTimes,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  ChartDot,
  Checkbox,
  cn,
  Field,
  FieldDescription,
  FieldLabel,
  IconButton,
  Input,
  PlatformMark,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarHeartIcon,
  CircleCheckIcon,
  ClockIcon,
  GripVerticalIcon,
  ImageUpIcon,
  LightbulbIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import {
  type Dispatch,
  type DragEvent,
  type SetStateAction,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import {
  formatCalendarDate,
  formatFileSize,
  formatNumber,
  formatTimeOfDay,
} from '../../lib/format';
import { readMediaInfo, uploadFile } from '../files/files.queries';
import { namedFiles, pastedFiles } from '../files/held-uploads';
import { useDepartmentNames } from '../projects/project-badges';
import { readinessInput, uploadAge, type WizardValues } from '../tasks/task-wizard-draft';
import { ReadinessWarnings } from '../tasks/task-wizard-steps';
import { taskListQuery, taskReadinessQuery } from '../tasks/tasks.queries';
import {
  agencyContentSettingsQuery,
  clientContentSettingsQuery,
  contentCalendarQuery,
  contentIdeasQuery,
  contentOccasionsQuery,
  contentPillarsQuery,
} from './content.queries';
import { type CheckPlace, PostChecksList } from './post-checks-list';
import type { PostFormMethods } from './post-form';
import {
  moveItem,
  type PostWizardFile,
  type PostWizardStep,
  type PostWizardTask,
} from './post-wizard-draft';

/*
 * The steps of the new post wizard (spec F08B rule B1, screen 1) beyond the post's own fields,
 * which the wizard shares with the post page (`post-form.tsx`).
 */

type SetFiles = Dispatch<SetStateAction<PostWizardFile[]>>;

const NONE = 'none';

// Basics: pillar, occasion, idea and best times (rules C1, C3, C6, C12)

export function PillarField({ form }: { form: PostFormMethods }) {
  const { t } = useTranslation();
  const pillars = useQuery(contentPillarsQuery);
  const live = (pillars.data?.items ?? []).filter((pillar) => !pillar.archived);
  const items = [
    { value: NONE, label: t('content.wizard.noPillar') },
    ...live.map((pillar) => ({ value: pillar.id, label: pillar.name })),
  ];
  return (
    <Field>
      <FieldLabel>{t('content.wizard.pillar')}</FieldLabel>
      <Controller
        control={form.control}
        name="pillarId"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value ?? NONE}
            onValueChange={(next) => field.onChange(!next || next === NONE ? null : next)}
          >
            <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('content.wizard.noPillar')}</SelectItem>
              {live.map((pillar) => (
                <SelectItem key={pillar.id} value={pillar.id}>
                  <span className="flex items-center gap-2">
                    <ChartDot color={pillar.color} />
                    {pillar.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldDescription>{t('content.wizard.pillarHint')}</FieldDescription>
    </Field>
  );
}

/** The occasions of the client within two months of the publish date, by start (rule C4). */
export function OccasionField({ form }: { form: PostFormMethods }) {
  const { t } = useTranslation();
  const [clientId, publishDate] = useWatch({
    control: form.control,
    name: ['clientId', 'publishDate'],
  });
  const date = publishDate || undefined;
  const occasions = useQuery({
    ...contentOccasionsQuery({
      from: date ? addDays(date, -60) : '',
      to: date ? addDays(date, 60) : '',
      clientId,
    }),
    enabled: !!clientId && !!date,
  });
  const listed = (occasions.data?.items ?? []).flatMap((occasion) => {
    const start = occasion.occurrences[0]?.startDate;
    return start ? [{ id: occasion.id, name: occasion.name, start }] : [];
  });
  const items = [
    { value: NONE, label: t('content.wizard.noOccasion') },
    ...listed.map((occasion) => ({
      value: occasion.id,
      label: `${occasion.name} · ${formatCalendarDate(occasion.start)}`,
    })),
  ];
  return (
    <Field>
      <FieldLabel>{t('content.wizard.occasion')}</FieldLabel>
      <Controller
        control={form.control}
        name="occasionId"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value ?? NONE}
            disabled={!clientId}
            onValueChange={(next) => field.onChange(!next || next === NONE ? null : next)}
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
      <FieldDescription>{t('content.wizard.occasionHint')}</FieldDescription>
    </Field>
  );
}

/** "Start from an idea" (rule C12): the open ideas of the client, or every open idea. */
export function IdeaPicker({
  form,
  onPick,
}: {
  form: PostFormMethods;
  onPick: (idea: {
    id: string;
    text: string;
    clientId: string | null;
    pillarId: string | null;
    occasionId: string | null;
  }) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [clientId, ideaId] = useWatch({ control: form.control, name: ['clientId', 'ideaId'] });
  const ideas = useQuery(
    contentIdeasQuery({ status: 'open', clientId: clientId || undefined, pageSize: 50 }),
  );
  const items = ideas.data?.items ?? [];
  const chosen = ideaId ? items.find((idea) => idea.id === ideaId) : undefined;
  if (items.length === 0 && !ideaId) return null;
  const options = [
    { value: NONE, label: t('content.wizard.noIdea') },
    ...items.map((idea) => ({ value: idea.id, label: idea.text })),
  ];
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        <LightbulbIcon aria-hidden="true" className="size-4" />
        {t('content.wizard.fromIdea')}
      </FieldLabel>
      <Select
        items={options}
        value={ideaId ?? NONE}
        onValueChange={(next) => {
          const idea = items.find((item) => item.id === next);
          if (!idea) {
            form.setValue('ideaId', undefined, { shouldDirty: true });
            return;
          }
          onPick({
            id: idea.id,
            text: idea.text,
            clientId: idea.client?.id ?? null,
            pillarId: idea.pillar && !idea.pillar.archived ? idea.pillar.id : null,
            occasionId: idea.occasion && !idea.occasion.archived ? idea.occasion.id : null,
          });
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="line-clamp-2">{option.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {chosen ? t('content.wizard.ideaChosen') : t('content.wizard.ideaHint')}
      </FieldDescription>
    </Field>
  );
}

/**
 * Rule C3: the best windows of the date's weekday for the chosen platforms, the client's where it
 * sets them; a click fills the time with the window's start, nothing is filled without one.
 */
export function SuggestedTimes({ form }: { form: PostFormMethods }) {
  const { t } = useTranslation();
  const [clientId, publishDate, platforms = [], publishTime] = useWatch({
    control: form.control,
    name: ['clientId', 'publishDate', 'platforms', 'publishTime'],
  });
  const agency = useQuery(agencyContentSettingsQuery);
  const client = useQuery({ ...clientContentSettingsQuery(clientId), enabled: !!clientId });
  if (!publishDate || platforms.length === 0 || !agency.data) return null;
  const chips = suggestPublishTimes(
    client.data?.postingTimes ?? [],
    agency.data.postingTimes,
    publishDate,
    platforms as PostPlatform[],
  );
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <ClockIcon aria-hidden="true" className="size-4" />
        {t('content.wizard.bestTimes')}
      </p>
      <ul aria-label={t('content.wizard.bestTimes')} className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={`${chip.from}-${chip.to}`}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={publishTime === chip.from}
              className={cn(publishTime === chip.from && 'border-primary')}
              onClick={() => form.setValue('publishTime', chip.from, { shouldDirty: true })}
            >
              <span dir="ltr" className="tabular-nums">
                {formatTimeOfDay(chip.from)}–{formatTimeOfDay(chip.to)}
              </span>
              <span className="flex gap-0.5">
                {chip.platforms.map((platform) => (
                  <PlatformMark
                    key={platform}
                    platform={platform}
                    size="xs"
                    label={t(`clients.platforms.names.${platform}`)}
                  />
                ))}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Media (rules A6, B1)

/** The media dropped, pasted or chosen, uploaded at once and held until the post is saved. */
export function usePostUploads(setFiles: SetFiles) {
  const { t } = useTranslation();
  const controllers = useRef(new Map<string, AbortController>());
  // Pictures of the images picked in this visit; a reload keeps the file, not its picture.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      for (const url of Object.values(previewsRef.current)) URL.revokeObjectURL(url);
    };
  }, []);

  const patch = (key: string, change: Partial<PostWizardFile>) =>
    setFiles((current) =>
      current.map((file) => (file.key === key ? { ...file, ...change } : file)),
    );

  async function upload(file: File, key: string) {
    const controller = new AbortController();
    controllers.current.set(key, controller);
    const info = await readMediaInfo(file);
    patch(key, info);
    try {
      const upload = await uploadFile(file, {
        signal: controller.signal,
        onProgress: (progress) => patch(key, { progress }),
        mediaInfo: file.type.startsWith('video/') ? info : null,
      });
      patch(key, { uploadId: upload.uploadId, progress: 1, uploadedAt: new Date().toISOString() });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      patch(key, { failed: errorMessage(t, error) });
    } finally {
      controllers.current.delete(key);
    }
  }

  function add(picked: readonly File[], pasted: boolean, room: number) {
    if (picked.length === 0) {
      toast.add({ title: t('tasks.attachments.nothingToPaste'), type: 'error' });
      return;
    }
    if (picked.length > room) {
      toast.add({
        title: t('content.wizard.media.limit', { max: formatNumber(POST_LIMITS.files) }),
        type: 'error',
      });
    }
    for (const file of namedFiles(picked.slice(0, Math.max(0, room)), new Date(), pasted)) {
      const key = crypto.randomUUID();
      if (file.type.startsWith('image/')) {
        setPreviews((current) => ({ ...current, [key]: URL.createObjectURL(file) }));
      }
      setFiles((current) => [
        ...current,
        {
          key,
          name: file.name,
          sizeBytes: file.size,
          mimeType: file.type,
          uploadId: null,
          progress: 0,
          failed: null,
          uploadedAt: null,
          slideCaption: '',
          width: null,
          height: null,
          durationMs: null,
        },
      ]);
      void upload(file, key);
    }
  }

  function remove(key: string) {
    controllers.current.get(key)?.abort();
    setFiles((current) => current.filter((file) => file.key !== key));
  }

  return { add, remove, previews };
}

export type PostUploads = ReturnType<typeof usePostUploads>;

export function MediaStep({
  files,
  setFiles,
  uploads,
  checks,
}: {
  files: PostWizardFile[];
  setFiles: SetFiles;
  uploads: PostUploads;
  checks: readonly PostCheck[];
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [dragged, setDragged] = useState<number | null>(null);
  const room = POST_LIMITS.files - files.length;
  const receive = (picked: File[], pasted: boolean) => uploads.add(picked, pasted, room);
  // A paste anywhere on the step outside a field lands here.
  const receiveRef = useRef(receive);
  receiveRef.current = receive;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const pasted = pastedFiles(event);
      if (pasted === null) return;
      event.preventDefault();
      receiveRef.current(pasted, true);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);
  const move = (from: number, to: number) => setFiles((current) => moveItem(current, from, to));

  return (
    <div className="flex flex-col gap-4">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping is a shortcut; the button picks files */}
      <div
        onDragOver={(event: DragEvent) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event: DragEvent) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDropping(false);
          receive([...event.dataTransfer.files], false);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border px-4 py-8 text-center',
          dropping && 'border-primary bg-muted',
        )}
      >
        <ImageUpIcon aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('content.wizard.media.dropHint')}</p>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/*,video/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            receive([...(event.target.files ?? [])], false);
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={room <= 0}
          onClick={() => input.current?.click()}
        >
          <PaperclipIcon />
          {t('content.wizard.media.choose')}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t('content.wizard.media.limitHint', {
            n: formatNumber(files.length),
            max: formatNumber(POST_LIMITS.files),
          })}
        </p>
      </div>
      {files.length > 0 && (
        <ol aria-label={t('content.slides.title')} className="flex flex-col gap-2">
          {files.map((file, index) => (
            <SlideRow
              key={file.key}
              file={file}
              index={index}
              count={files.length}
              preview={uploads.previews[file.key]}
              checks={checks.filter((check) => check.mediaIndex === index)}
              dragging={dragged === index}
              onDragStart={() => setDragged(index)}
              onDrop={() => {
                if (dragged !== null) move(dragged, index);
                setDragged(null);
              }}
              onDragEnd={() => setDragged(null)}
              onMove={(to) => move(index, to)}
              onCaption={(slideCaption) =>
                setFiles((current) =>
                  current.map((item) => (item.key === file.key ? { ...item, slideCaption } : item)),
                )
              }
              onRemove={() => uploads.remove(file.key)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function SlideRow({
  file,
  index,
  count,
  preview,
  checks,
  dragging,
  onDragStart,
  onDrop,
  onDragEnd,
  onMove,
  onCaption,
  onRemove,
}: {
  file: PostWizardFile;
  index: number;
  count: number;
  preview: string | undefined;
  checks: PostCheck[];
  dragging: boolean;
  onDragStart: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onMove: (to: number) => void;
  onCaption: (caption: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const age = uploadAge(file, new Date());
  const name = t('content.slides.slide', { n: formatNumber(index + 1) });
  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'flex flex-col gap-3 rounded-md border border-border bg-surface p-3',
        dragging && 'opacity-50',
        (file.failed || age === 'expired') && 'border-destructive-text',
      )}
    >
      <div className="flex items-center gap-3">
        <GripVerticalIcon
          aria-hidden="true"
          className="size-4 shrink-0 cursor-grab text-muted-foreground"
        />
        <span className="w-6 shrink-0 text-center text-sm font-bold tabular-nums">
          {formatNumber(index + 1)}
        </span>
        {preview ? (
          <img src={preview} alt="" className="size-12 shrink-0 rounded-sm object-cover" />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-muted">
            <ImageUpIcon aria-hidden="true" className="size-5 text-muted-foreground" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-medium" dir="auto">
            {file.name}
          </span>
          {file.failed ? (
            <span role="alert" className="text-xs text-destructive-text">
              {file.failed}
            </span>
          ) : age === 'uploading' ? (
            <Progress
              value={file.progress * 100}
              aria-label={t('tasks.attachments.uploading', { name: file.name })}
            />
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {formatFileSize(file.sizeBytes)}
              {file.width && file.height && (
                <span dir="ltr" className="tabular-nums">
                  {formatNumber(file.width)}×{formatNumber(file.height)}
                </span>
              )}
              {age === 'aging' && <Badge tone="warning">{t('tasks.wizard.files.aging')}</Badge>}
              {age === 'expired' && <Badge tone="danger">{t('tasks.wizard.files.expired')}</Badge>}
            </span>
          )}
        </span>
        <div className="flex shrink-0 items-center">
          <IconButton
            label={t('content.slides.earlier', { name })}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ArrowUpIcon />
          </IconButton>
          <IconButton
            label={t('content.slides.later', { name })}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ArrowDownIcon />
          </IconButton>
          <IconButton label={t('common.remove', { label: file.name })} onClick={onRemove}>
            <XIcon />
          </IconButton>
        </div>
      </div>
      <Field>
        <FieldLabel htmlFor={id} className="sr-only">
          {t('content.slides.captionOf', { name })}
        </FieldLabel>
        <Input
          id={id}
          dir="auto"
          maxLength={POST_LIMITS.slideCaption}
          placeholder={t('content.slides.captionPlaceholder')}
          value={file.slideCaption}
          onChange={(event) => onCaption(event.target.value)}
        />
      </Field>
      <SlideWarnings checks={checks} />
    </li>
  );
}

/** The warnings of one slide (rule A4). */
export function SlideWarnings({ checks }: { checks: readonly PostCheck[] }) {
  const { t } = useTranslation();
  if (checks.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {checks.map((check, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: checks have no id
          key={index}
          className="flex items-center gap-1.5 text-xs text-status-warning-foreground"
        >
          <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {t(
            `content.checks.slide.${check.code === 'video_too_long' ? 'video_too_long' : 'aspect_ratio'}`,
            {
              platform: check.platform ? t(`clients.platforms.names.${check.platform}`) : '',
              limit: formatNumber(check.limit ?? 0),
              actual: formatNumber(check.actual ?? 0),
            },
          )}
        </li>
      ))}
    </ul>
  );
}

// Tasks (rule B1)

/** Existing open tasks of the client that no post links yet (F08 rule 6). */
export function LinkTasksField({
  form,
  room,
}: {
  form: PostFormMethods;
  /** Links left under the post's limit, the new tasks counted. */
  room: number;
}) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const clientId = useWatch({ control: form.control, name: 'clientId' });
  const tasks = useQuery({
    ...taskListQuery({ clientId, linkedToPost: 'false', topLevel: 'true', pageSize: 50 }),
    enabled: !!clientId,
  });
  return (
    <Controller
      control={form.control}
      name="linkTaskIds"
      render={({ field }) => {
        const chosen: string[] = field.value ?? [];
        if (!clientId) {
          return (
            <p className="text-sm text-muted-foreground">{t('content.wizard.tasks.noClient')}</p>
          );
        }
        if (tasks.isPending) return <Skeleton className="h-20" />;
        const items = tasks.data?.items ?? [];
        if (items.length === 0) {
          return (
            <p className="text-sm text-muted-foreground">{t('content.wizard.tasks.noOpen')}</p>
          );
        }
        return (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {items.map((task) => {
              const checked = chosen.includes(task.id);
              const inputId = `link-${task.id}`;
              return (
                <li key={task.id} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox
                    id={inputId}
                    checked={checked}
                    disabled={!checked && room <= 0}
                    onCheckedChange={(on) =>
                      field.onChange(
                        on ? [...chosen, task.id] : chosen.filter((other) => other !== task.id),
                      )
                    }
                  />
                  <label htmlFor={inputId} className="flex min-w-0 flex-1 cursor-pointer flex-col">
                    <span className="truncate text-sm font-medium">{task.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {departmentName(task.department)} · {formatCalendarDate(task.dueDate)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        );
      }}
    />
  );
}

export function NewTasksList({
  tasks,
  canAdd,
  onAdd,
  onEdit,
  onRemove,
}: {
  tasks: PostWizardTask[];
  canAdd: boolean;
  onAdd: () => void;
  onEdit: (task: PostWizardTask) => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  return (
    <div className="flex flex-col gap-3">
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('content.wizard.tasks.noneNew')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((item) => (
            <li
              key={item.key}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{item.task.title}</span>
                <span className="text-xs text-muted-foreground">
                  {[
                    departmentName(item.task.department),
                    item.mode === 'request'
                      ? t('content.wizard.tasks.queue')
                      : t('content.wizard.tasks.assigned'),
                    formatCalendarDate(item.task.dueDate),
                    item.task.subtasks.length > 0
                      ? t('content.wizard.tasks.subtasks', {
                          n: formatNumber(item.task.subtasks.length),
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <IconButton
                label={t('content.wizard.tasks.edit', { title: item.task.title })}
                onClick={() => onEdit(item)}
              >
                <PencilIcon />
              </IconButton>
              <IconButton
                label={t('common.remove', { label: item.task.title })}
                onClick={() => onRemove(item.key)}
              >
                <XIcon />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button type="button" variant="outline" disabled={!canAdd} onClick={onAdd}>
          <PlusIcon />
          {t('content.wizard.tasks.add')}
        </Button>
      </div>
    </div>
  );
}

// Review (rules A5, B1, C10)

/** F06B's readiness warnings for one new task, which never block. */
export function TaskReadiness({ item }: { item: PostWizardTask }) {
  const { t } = useTranslation();
  const check = readinessInput(item.task as WizardValues, item.files, false);
  const warnings = useQuery(taskReadinessQuery(check));
  const found = warnings.data?.warnings ?? [];
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-bold">{item.task.title}</h4>
      {warnings.isPending ? (
        <p className="text-sm text-muted-foreground">{t('tasks.wizard.review.checking')}</p>
      ) : found.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CircleCheckIcon aria-hidden="true" className="size-4" />
          {t('tasks.wizard.review.ready')}
        </p>
      ) : (
        <ReadinessWarnings
          warnings={found}
          subtaskTitles={item.task.subtasks.map((subtask) => subtask.title)}
        />
      )}
    </div>
  );
}

const daysApart = (from: CalendarDate, to: CalendarDate) => daysInclusive(from, to) - 1;

/**
 * Rule C10 for the date: another post of the client close by on a platform, the gap the post
 * fills, and the occasion it matches or could match.
 */
export function PlanningNotes({
  clientId,
  date,
  time,
  platforms,
  occasionId,
  onGoTo,
}: {
  clientId: string;
  date: CalendarDate;
  time: string | null;
  platforms: readonly PostPlatform[];
  occasionId: string | null;
  onGoTo: (step: PostWizardStep) => void;
}) {
  const { t } = useTranslation();
  const span = 14;
  const calendar = useQuery(
    contentCalendarQuery({ from: addDays(date, -span), to: addDays(date, span), clientId }),
  );
  const settings = useQuery(clientContentSettingsQuery(clientId));
  if (calendar.isPending) return <Skeleton className="h-16" />;
  if (!calendar.data) return null;
  // Rule C7 counts every post of the client; rule C8 those sharing a platform.
  const posts = calendar.data.posts.filter((post) => post.status !== 'cancelled');
  const notes: { key: string; text: string; tone: 'info' | 'warning'; step?: PostWizardStep }[] =
    [];
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const close = posts.filter(
    (post) =>
      post.publishDate === date &&
      post.platforms.some((p) => platforms.includes(p)) &&
      (!time ||
        !post.publishTime ||
        Math.abs(minutes(post.publishTime) - minutes(time)) < PLANNING_RULES.tooCloseHours * 60),
  );
  for (const post of close) {
    notes.push({
      key: `close-${post.id}`,
      tone: 'warning',
      text: t('content.wizard.planning.close', { title: post.title }),
    });
  }
  const before = posts.filter((post) => post.publishDate < date).at(-1);
  const maxGap = settings.data?.maxGapDays ?? PLANNING_RULES.maxGapDays;
  // The days without a post before this one (rule C7).
  const gap = (before ? daysApart(before.publishDate, date) : span) - 1;
  if (gap > maxGap) {
    notes.push({
      key: 'gap',
      tone: 'info',
      text: before
        ? t('content.wizard.planning.gapSince', { date: formatCalendarDate(before.publishDate) })
        : t('content.wizard.planning.gapNone', { n: formatNumber(span) }),
    });
  }
  for (const occasion of calendar.data.occasions) {
    const hintFrom = addDays(occasion.startDate, -occasion.leadDays);
    if (date < hintFrom || date > occasion.endDate) continue;
    if (occasion.id === occasionId) {
      notes.push({
        key: `occasion-${occasion.id}`,
        tone: 'info',
        text: t('content.wizard.planning.forOccasion', { name: occasion.name }),
      });
    } else if (!occasion.covered && !occasion.skipped) {
      notes.push({
        key: `occasion-${occasion.id}`,
        tone: 'warning',
        text: t('content.wizard.planning.occasionOpen', {
          name: occasion.name,
          date: formatCalendarDate(occasion.startDate),
        }),
        step: 'basics',
      });
    }
  }
  if (notes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('content.wizard.planning.none')}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {notes.map((note) => (
        <li
          key={note.key}
          className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm sm:flex-row sm:items-center"
        >
          {note.tone === 'warning' ? (
            <TriangleAlertIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-status-warning-foreground"
            />
          ) : (
            <CalendarHeartIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          )}
          <span className="flex-1">{note.text}</span>
          {note.step && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onGoTo('basics')}>
              {t('content.wizard.goTo', { step: t('content.wizard.steps.basics') })}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The step a check is fixed on. */
export const stepOfCheck = (place: CheckPlace): PostWizardStep =>
  place === 'captions' ? 'captions' : 'media';

export function ReviewChecks({
  checks,
  onGoTo,
}: {
  checks: readonly PostCheck[];
  onGoTo: (step: PostWizardStep) => void;
}) {
  const { t } = useTranslation();
  if (checks.length === 0) {
    return <Callout icon={<CircleCheckIcon />} title={t('content.checks.none')} />;
  }
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {checks.some((check) => check.blocking)
          ? t('content.checks.blockingHint')
          : t('content.checks.warningsHint')}
      </p>
      <PostChecksList checks={checks} onGoTo={(place) => onGoTo(stepOfCheck(place))} />
    </>
  );
}
