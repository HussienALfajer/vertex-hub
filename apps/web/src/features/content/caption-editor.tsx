import { useQuery } from '@tanstack/react-query';
import {
  type CaptionGroup,
  captionGroupsOf,
  groupTextLimit,
  hashtagCount,
  INSTAGRAM_HASHTAG_LIMIT,
  POST_LIMITS,
  type PostCaptionInput,
  type PostPlatform,
  platformsOfGroup,
  publishedText,
  type SnippetKind,
  textLength,
  YOUTUBE_TITLE_LIMIT,
} from '@vertex-hub/contracts';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Field,
  FieldLabel,
  Input,
  PlatformMark,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@vertex-hub/ui';
import { CopyIcon, TextCursorInputIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { clientContentSettingsQuery, contentSnippetsQuery } from './content.queries';
import { appendHashtags, captionsOf, insertAt, withCaption } from './post-wizard-draft';

/*
 * F08B rules A1, A3 and A10: a caption per caption group, each with its hashtags (and YouTube's
 * title), a counter at the group's limit, "Copy from" another group and the client's and the
 * agency's snippets. The wizard's Captions step and the post page's Content dialog share it.
 */

export type CaptionDraft = Partial<PostCaptionInput>[];

/** Over a limit is a warning while editing; it blocks the submission for review (rule A3). */
export function useXLongPosts(clientId: string | undefined): boolean {
  const settings = useQuery({ ...clientContentSettingsQuery(clientId ?? ''), enabled: !!clientId });
  return settings.data?.xLongPosts ?? false;
}

/** The length of a group's published text against its limit. */
export function captionLength(
  platforms: readonly PostPlatform[],
  caption: Partial<PostCaptionInput> | undefined,
  xLongPosts: boolean,
) {
  const group = caption?.group;
  const limit = group ? groupTextLimit(platforms, group, { xLongPosts }) : null;
  const length = textLength(publishedText(caption?.caption ?? null, caption?.hashtags ?? null));
  return { length, limit: limit?.limit ?? null, platform: limit?.platform ?? null };
}

/** "120 / 2200", in the warning tone past the limit. */
export function CharacterCounter({
  length,
  max,
  label,
}: {
  length: number;
  max: number;
  label?: string;
}) {
  const { t } = useTranslation();
  const over = length > max;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs tabular-nums',
        over ? 'font-medium text-status-warning-foreground' : 'text-muted-foreground',
      )}
    >
      {over && <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />}
      {label && <span>{label}</span>}
      <span dir="ltr">
        {formatNumber(length)} / {formatNumber(max)}
      </span>
      {over && <span className="sr-only">{t('content.captions.over')}</span>}
    </span>
  );
}

export function CaptionEditor({
  clientId,
  platforms,
  captions,
  onChange,
}: {
  clientId: string | undefined;
  platforms: readonly PostPlatform[];
  captions: CaptionDraft;
  onChange: (captions: CaptionDraft) => void;
}) {
  const { t } = useTranslation();
  const xLongPosts = useXLongPosts(clientId);
  const groups = captionGroupsOf(platforms);
  const rows = captionsOf(platforms, captions);
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('content.captions.noPlatforms')}</p>;
  }
  const change = (group: CaptionGroup, next: Partial<Omit<PostCaptionInput, 'group'>>) =>
    onChange(withCaption(captions, group, next));
  return (
    <Tabs defaultValue={groups[0]}>
      <TabsList aria-label={t('content.captions.tabsLabel')} className="max-w-full overflow-x-auto">
        {rows.map((row) => {
          const { length, limit } = captionLength(platforms, row, xLongPosts);
          return (
            <TabsTrigger key={row.group} value={row.group}>
              <span className="flex items-center gap-1">
                {platformsOfGroup(platforms, row.group).map((platform) => (
                  <PlatformMark key={platform} platform={platform} size="xs" />
                ))}
              </span>
              {t(`content.captionGroups.${row.group}`)}
              {limit !== null && length > limit && (
                <TriangleAlertIcon
                  role="img"
                  aria-label={t('content.captions.over')}
                  className="text-status-warning-foreground"
                />
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {rows.map((row) => (
        <TabsContent key={row.group} value={row.group} className="pt-4">
          <GroupFields
            clientId={clientId}
            platforms={platforms}
            caption={row}
            others={rows.filter((other) => other.group !== row.group)}
            xLongPosts={xLongPosts}
            onChange={(next) => change(row.group, next)}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function GroupFields({
  clientId,
  platforms,
  caption,
  others,
  xLongPosts,
  onChange,
}: {
  clientId: string | undefined;
  platforms: readonly PostPlatform[];
  caption: PostCaptionInput;
  others: PostCaptionInput[];
  xLongPosts: boolean;
  onChange: (next: Partial<Omit<PostCaptionInput, 'group'>>) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const textArea = useRef<HTMLTextAreaElement>(null);
  const { length, limit, platform } = captionLength(platforms, caption, xLongPosts);
  const instagram = caption.group === 'facebook_instagram' && platforms.includes('instagram');
  const tags = hashtagCount(publishedText(caption.caption, caption.hashtags));
  const copyable = others.filter((other) => other.caption || other.hashtags);

  function insertSnippet(body: string) {
    const area = textArea.current;
    const { text, cursor } = insertAt(
      caption.caption,
      body,
      area?.selectionStart ?? (caption.caption ?? '').length,
      area?.selectionEnd ?? undefined,
    );
    onChange({ caption: text });
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {caption.group === 'facebook_instagram' &&
        platformsOfGroup(platforms, caption.group).length > 1 && (
          <p className="text-sm text-muted-foreground">{t('content.captions.sharedHint')}</p>
        )}
      <div className="flex flex-wrap items-center gap-2">
        <CopyFromMenu
          others={copyable}
          onCopy={(from) => onChange({ caption: from.caption, hashtags: from.hashtags })}
        />
        <SnippetMenu clientId={clientId} kind="caption" onPick={(body) => insertSnippet(body)} />
        <SnippetMenu
          clientId={clientId}
          kind="hashtags"
          onPick={(body) => onChange({ hashtags: appendHashtags(caption.hashtags, body) })}
        />
      </div>
      {caption.group === 'youtube' && (
        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor={`${id}-title`}>{t('content.captions.title')}</FieldLabel>
            <CharacterCounter length={textLength(caption.title)} max={YOUTUBE_TITLE_LIMIT} />
          </div>
          <Input
            id={`${id}-title`}
            dir="auto"
            autoComplete="off"
            maxLength={YOUTUBE_TITLE_LIMIT}
            value={caption.title ?? ''}
            onChange={(event) => onChange({ title: event.target.value || null })}
          />
        </Field>
      )}
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={`${id}-caption`}>
            {t('content.captions.caption', {
              group: t(`content.captionGroups.${caption.group}`),
            })}
          </FieldLabel>
          {limit !== null && <CharacterCounter length={length} max={limit} />}
        </div>
        <Textarea
          ref={textArea}
          id={`${id}-caption`}
          rows={6}
          dir="auto"
          maxLength={POST_LIMITS.caption}
          placeholder={t('content.form.captionPlaceholder')}
          value={caption.caption ?? ''}
          onChange={(event) => onChange({ caption: event.target.value || null })}
        />
        {limit !== null && length > limit && platform && (
          <p className="text-sm text-status-warning-foreground">
            {t('content.captions.overLimit', {
              platform: t(`clients.platforms.names.${platform}`),
              n: formatNumber(length - limit),
            })}
          </p>
        )}
      </Field>
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={`${id}-hashtags`}>{t('content.form.hashtags')}</FieldLabel>
          {instagram && (
            <CharacterCounter
              length={tags}
              max={INSTAGRAM_HASHTAG_LIMIT}
              label={t('content.captions.hashtagCount')}
            />
          )}
        </div>
        <Textarea
          id={`${id}-hashtags`}
          rows={2}
          dir="auto"
          maxLength={POST_LIMITS.hashtags}
          placeholder={t('content.form.hashtagsPlaceholder')}
          value={caption.hashtags ?? ''}
          onChange={(event) => onChange({ hashtags: event.target.value || null })}
        />
      </Field>
    </div>
  );
}

function CopyFromMenu({
  others,
  onCopy,
}: {
  others: PostCaptionInput[];
  onCopy: (from: PostCaptionInput) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" size="sm" disabled={others.length === 0} />}
      >
        <CopyIcon />
        {t('content.captions.copyFrom')}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {others.map((other) => (
          <DropdownMenuItem key={other.group} onClick={() => onCopy(other)}>
            {t(`content.captionGroups.${other.group}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The client's snippets of one kind, then the agency's (rule A10). */
function SnippetMenu({
  clientId,
  kind,
  onPick,
}: {
  clientId: string | undefined;
  kind: SnippetKind;
  onPick: (body: string) => void;
}) {
  const { t } = useTranslation();
  const snippets = useQuery(contentSnippetsQuery({ clientId: clientId || undefined, kind }));
  const items = snippets.data?.items ?? [];
  const own = items.filter((snippet) => snippet.client !== null);
  const agency = items.filter((snippet) => snippet.client === null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <TextCursorInputIcon />
        {t(`content.captions.insert.${kind}`)}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-w-xs">
        {items.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            {snippets.isPending ? t('common.loading') : t('content.captions.noSnippets')}
          </p>
        ) : (
          [
            { key: 'client' as const, list: own },
            { key: 'agency' as const, list: agency },
          ].map(
            ({ key, list }) =>
              list.length > 0 && (
                <DropdownMenuGroup key={key}>
                  <DropdownMenuLabel>{t(`content.captions.snippetsOf.${key}`)}</DropdownMenuLabel>
                  {list.map((snippet) => (
                    <DropdownMenuItem key={snippet.id} onClick={() => onPick(snippet.body)}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{snippet.name}</span>
                        <span className="truncate text-xs text-muted-foreground" dir="auto">
                          {snippet.body}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ),
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
