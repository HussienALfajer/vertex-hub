import type { PostCaption } from '@vertex-hub/contracts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vertex-hub/ui';
import { useTranslation } from 'react-i18next';

/*
 * F08B rule A8: the captions of a post as the client and the reviewers read them, a tab per
 * caption group, or one text when every group says the same.
 */

const same = (a: PostCaption, b: PostCaption) =>
  a.caption === b.caption && a.hashtags === b.hashtags && a.title === b.title;

function CaptionText({ caption }: { caption: PostCaption }) {
  const { t } = useTranslation();
  if (!caption.caption && !caption.hashtags && !caption.title) {
    return <p className="text-sm text-muted-foreground">{t('content.page.noCaption')}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {caption.title && (
        <p className="font-bold" dir="auto">
          {caption.title}
        </p>
      )}
      {caption.caption && (
        <p className="whitespace-pre-line" dir="auto">
          {caption.caption}
        </p>
      )}
      {caption.hashtags && (
        <p className="text-sm text-muted-foreground" dir="auto">
          {caption.hashtags}
        </p>
      )}
    </div>
  );
}

export function PostCaptionsView({ captions }: { captions: readonly PostCaption[] }) {
  const { t } = useTranslation();
  const [first] = captions;
  if (!first) return null;
  if (captions.every((caption) => same(caption, first))) return <CaptionText caption={first} />;
  return (
    <Tabs defaultValue={first.group}>
      <TabsList aria-label={t('content.captions.tabsLabel')} className="max-w-full overflow-x-auto">
        {captions.map((caption) => (
          <TabsTrigger key={caption.group} value={caption.group}>
            {t(`content.captionGroups.${caption.group}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {captions.map((caption) => (
        <TabsContent key={caption.group} value={caption.group} className="pt-3">
          <CaptionText caption={caption} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
