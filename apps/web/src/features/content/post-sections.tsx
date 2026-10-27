import {
  captionGroupsOf,
  isPostOpen,
  type PostCaption,
  type PostDetail,
  publishedText,
  textLength,
  YOUTUBE_TITLE_LIMIT,
} from '@vertex-hub/contracts';
import {
  Button,
  PlatformMark,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@vertex-hub/ui';
import { CopyIcon, DownloadIcon, LockIcon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { imageSrc } from '../../lib/images';
import { fileThumbnailUrl } from '../files/files.queries';
import { TaskSection } from '../tasks/task-parts';
import { CharacterCounter, captionLength, useXLongPosts } from './caption-editor';
import { postPackUrl } from './content.queries';
import { ContentDialog } from './post-actions';
import { PostChecksList } from './post-checks-list';
import { PostPreview } from './post-preview-panel';

/*
 * The post page's F08B sections (screen 4): the captions per group, the checks while any
 * applies, the preview per platform, and the publishing pack.
 */

/** A group's caption as it is copied to the platform: the YouTube title, the text, the hashtags. */
const packText = (caption: Pick<PostCaption, 'caption' | 'hashtags' | 'title'>) =>
  [caption.title, publishedText(caption.caption, caption.hashtags)]
    .filter((part) => !!part)
    .join('\n\n');

/** Rules A1 and A3: a tab per caption group, with its length against the group's limit. */
export function ContentSection({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const xLongPosts = useXLongPosts(post.client.id);
  const groups = captionGroupsOf(post.platforms);
  const captions = groups.map(
    (group) =>
      post.captions.find((caption) => caption.group === group) ?? {
        group,
        caption: null,
        hashtags: null,
        title: null,
      },
  );
  return (
    <TaskSection
      title={t('content.page.content')}
      action={
        post.permissions.canEditContent && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <PencilIcon />
            {t('common.edit')}
          </Button>
        )
      }
    >
      {captions.length > 0 && (
        <Tabs defaultValue={captions[0]?.group}>
          <TabsList
            aria-label={t('content.captions.tabsLabel')}
            className="max-w-full overflow-x-auto"
          >
            {captions.map((caption) => (
              <TabsTrigger key={caption.group} value={caption.group}>
                {t(`content.captionGroups.${caption.group}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {captions.map((caption) => {
            const { length, limit } = captionLength(post.platforms, caption, xLongPosts);
            return (
              <TabsContent
                key={caption.group}
                value={caption.group}
                className="flex flex-col gap-3 pt-3"
              >
                {caption.group === 'youtube' && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{t('content.captions.title')}</span>
                      <CharacterCounter
                        length={textLength(caption.title)}
                        max={YOUTUBE_TITLE_LIMIT}
                      />
                    </div>
                    <p className="font-medium" dir="auto">
                      {caption.title || (
                        <span className="text-muted-foreground">{t('content.page.noTitle')}</span>
                      )}
                    </p>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{t('content.form.caption')}</span>
                    {limit !== null && <CharacterCounter length={length} max={limit} />}
                  </div>
                  {caption.caption ? (
                    <p className="max-w-prose text-base whitespace-pre-line" dir="auto">
                      {caption.caption}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('content.page.noCaption')}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1 border-t border-border pt-3">
                  <span className="text-xs text-muted-foreground">
                    {t('content.form.hashtags')}
                  </span>
                  {caption.hashtags ? (
                    <p className="max-w-prose text-sm whitespace-pre-line" dir="auto">
                      {caption.hashtags}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('content.page.noHashtags')}</p>
                  )}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      )}
      {post.permissions.canEdit && !post.permissions.canEditContent && isPostOpen(post.status) && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {t('content.page.contentLocked')}
        </p>
      )}
      <ContentDialog post={post} open={editing} onClose={() => setEditing(false)} />
    </TaskSection>
  );
}

/** Rule A5: the checks at the top of the page while any applies to an open post. */
export function ChecksSection({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  if (post.checks.length === 0 || !isPostOpen(post.status) || post.status === 'published') {
    return null;
  }
  const blocking = post.checks.some((check) => check.blocking);
  return (
    <TaskSection title={t('content.checks.title')}>
      <p className="text-sm text-muted-foreground">
        {blocking ? t('content.checks.blockingHint') : t('content.checks.warningsHint')}
      </p>
      <PostChecksList checks={post.checks} />
    </TaskSection>
  );
}

export function PreviewSection({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  return (
    <TaskSection title={t('content.preview.title')}>
      <PostPreview
        clientName={post.client.name}
        clientImage={imageSrc(post.client.imageId, 'sm')}
        type={post.type}
        platforms={post.platforms}
        captions={post.captions}
        media={post.media.map((medium) => ({
          key: medium.id,
          src: medium.previewStatus === 'ready' ? fileThumbnailUrl(medium.id) : null,
          type: medium.type,
          slideCaption: medium.slideCaption,
        }))}
      />
    </TaskSection>
  );
}

/**
 * Rule A11: on an approved, scheduled or published post, each platform's text to copy, and the
 * media as a zip named in slide order, with the captions per group.
 */
export function PackSection({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  if (!post.permissions.canDownloadPack) return null;
  const groups = captionGroupsOf(post.platforms);
  async function copy(caption: PostCaption) {
    try {
      await navigator.clipboard.writeText(packText(caption));
      toast.add({
        title: t('content.pack.copied', { group: t(`content.captionGroups.${caption.group}`) }),
        type: 'success',
      });
    } catch {
      toast.add({ title: t('content.pack.copyFailed'), type: 'error' });
    }
  }
  return (
    <TaskSection title={t('content.pack.title')}>
      <p className="text-sm text-muted-foreground">{t('content.pack.hint')}</p>
      <ul className="flex flex-col gap-2">
        {groups.map((group) => {
          const caption = post.captions.find((item) => item.group === group);
          return (
            <li key={group} className="flex items-center gap-2">
              <span className="flex flex-1 items-center gap-2 text-sm">
                {post.platforms
                  .filter((platform) => captionGroupsOf([platform])[0] === group)
                  .map((platform) => (
                    <PlatformMark key={platform} platform={platform} size="xs" />
                  ))}
                {t(`content.captionGroups.${group}`)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!caption || !packText(caption)}
                onClick={() => caption && void copy(caption)}
              >
                <CopyIcon />
                {t('content.pack.copy')}
              </Button>
            </li>
          );
        })}
      </ul>
      <Button
        variant="outline"
        className="self-start"
        render={<a href={postPackUrl(post.id)} download />}
      >
        <DownloadIcon />
        {t('content.pack.download')}
      </Button>
    </TaskSection>
  );
}
