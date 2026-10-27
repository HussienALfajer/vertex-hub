import {
  captionGroupOf,
  type FileType,
  type PostCaption,
  type PostPlatform,
  type PostType,
  publishedText,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Carousel,
  cn,
  PlatformMark,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@vertex-hub/ui';
import { EllipsisIcon, HeartIcon, MessageCircleIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { FileTypeIcon } from '../files/file-parts';
import { previewCaption, previewRatio } from './post-preview';

/*
 * F08B screens 1, 4 and 8: the post as it will look on each of its platforms, a frame close to
 * the platform's layout drawn in the design system's tokens (never the platforms' own colors):
 * the client's name and picture, the media at the type's ratio with the slides to swipe, the
 * caption cut where the platform cuts it with "more", and the hashtags.
 */

/** One slide of the preview: a picture when there is one, else its type's icon. */
export interface PreviewMedium {
  key: string;
  src: string | null;
  type: FileType;
  slideCaption: string | null;
}

export interface PostPreviewProps {
  clientName: string;
  clientImage: string | null;
  type: PostType;
  platforms: readonly PostPlatform[];
  captions: readonly Pick<PostCaption, 'group' | 'caption' | 'hashtags' | 'title'>[];
  media: readonly PreviewMedium[];
  className?: string;
}

/** A tab per platform of the post, each with its frame. */
export function PostPreview({ platforms, className, ...props }: PostPreviewProps) {
  const { t } = useTranslation();
  if (platforms.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('content.preview.noPlatforms')}</p>;
  }
  return (
    <Tabs defaultValue={platforms[0]} className={className}>
      <TabsList aria-label={t('content.preview.title')} className="max-w-full overflow-x-auto">
        {platforms.map((platform) => (
          <TabsTrigger key={platform} value={platform}>
            <PlatformMark platform={platform} size="xs" />
            {t(`clients.platforms.names.${platform}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {platforms.map((platform) => (
        <TabsContent key={platform} value={platform} className="pt-3">
          <PlatformFrame platform={platform} {...props} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

const RATIO_CLASSES = {
  portrait: 'aspect-9/16',
  square: 'aspect-4/5',
  wide: 'aspect-video',
} as const;

function PlatformFrame({
  platform,
  clientName,
  clientImage,
  type,
  captions,
  media,
}: Omit<PostPreviewProps, 'platforms' | 'className'> & { platform: PostPlatform }) {
  const { t } = useTranslation();
  const caption = captions.find((item) => item.group === captionGroupOf(platform));
  const ratio = previewRatio(platform, type);
  const name = (
    <div className="flex items-center gap-2 px-3 py-2">
      <Avatar name={clientName} src={clientImage ?? undefined} size="sm" shape="square" />
      <span className="min-w-0 flex-1 truncate text-sm font-bold">{clientName}</span>
      <PlatformMark platform={platform} size="xs" />
      <EllipsisIcon aria-hidden="true" className="size-4 text-muted-foreground" />
    </div>
  );
  const slides =
    media.length === 0
      ? [<EmptyMedium key="empty" type={type} />]
      : media.map((medium) => <Slide key={medium.key} medium={medium} />);
  return (
    <article
      aria-label={t('content.preview.on', {
        platform: t(`clients.platforms.names.${platform}`),
      })}
      className="mx-auto flex w-full max-w-xs flex-col overflow-hidden rounded-xl border border-border bg-surface"
    >
      {platform !== 'youtube' && name}
      <Carousel
        className={cn('w-full', ratio === 'portrait' && 'mx-auto max-w-56')}
        slideClassName={RATIO_CLASSES[ratio]}
        label={t('content.preview.slides')}
        previousLabel={t('content.preview.previous')}
        nextLabel={t('content.preview.next')}
        slideLabel={(n, total) =>
          t('content.preview.slide', { n: formatNumber(n), total: formatNumber(total) })
        }
        slides={slides}
      />
      {platform !== 'youtube' && (
        <div aria-hidden="true" className="flex gap-3 px-3 pt-1 text-muted-foreground">
          <HeartIcon className="size-5" />
          <MessageCircleIcon className="size-5" />
          <SendIcon className="size-5 rtl:-scale-x-100" />
        </div>
      )}
      {platform === 'youtube' && (
        <div className="flex flex-col gap-1 px-3 pt-2">
          <p className="text-sm font-bold" dir="auto">
            {caption?.title || (
              <span className="font-normal text-muted-foreground">
                {t('content.preview.noTitle')}
              </span>
            )}
          </p>
          <span className="text-xs text-muted-foreground">{clientName}</span>
        </div>
      )}
      <PreviewText
        platform={platform}
        text={publishedText(caption?.caption ?? null, caption?.hashtags ?? null)}
      />
    </article>
  );
}

function Slide({ medium }: { medium: PreviewMedium }) {
  return (
    <figure className="flex size-full flex-col bg-muted">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden text-muted-foreground">
        {medium.src ? (
          <img src={medium.src} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <FileTypeIcon type={medium.type} className="size-10" />
        )}
      </div>
      {medium.slideCaption && (
        <figcaption className="border-t border-border bg-surface px-3 py-1.5 text-xs" dir="auto">
          {medium.slideCaption}
        </figcaption>
      )}
    </figure>
  );
}

function EmptyMedium({ type }: { type: PostType }) {
  const { t } = useTranslation();
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 bg-muted p-4 text-center text-xs text-muted-foreground">
      <FileTypeIcon
        type={type === 'reel' || type === 'story' ? 'video' : 'image'}
        className="size-8"
      />
      {t('content.preview.noMedia')}
    </div>
  );
}

/** The caption as published, cut where the platform cuts it, hashtags in the link color. */
function PreviewText({ platform, text }: { platform: PostPlatform; text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!text) {
    return (
      <p className="px-3 pt-2 pb-3 text-sm text-muted-foreground">
        {t('content.preview.noCaption')}
      </p>
    );
  }
  const { shown, cut } = previewCaption(text, platform);
  return (
    <p className="px-3 pt-2 pb-3 text-sm whitespace-pre-line" dir="auto">
      <Tagged text={open ? text : shown} />
      {cut && !open && (
        <>
          {'… '}
          <button
            type="button"
            className="text-muted-foreground hover:underline"
            onClick={() => setOpen(true)}
          >
            {t('content.preview.more')}
          </button>
        </>
      )}
    </p>
  );
}

function Tagged({ text }: { text: string }) {
  const parts = text.split(/(#[^\s#]+)/u);
  return parts.map((part, index) =>
    part.startsWith('#') ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed text
      <span key={index} className="font-medium text-status-info-foreground">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
