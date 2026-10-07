import { BRAND_FILE_KINDS, type BrandKit, type ClientDetailResponse } from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  ColorSwatch,
  EmptyState,
  IconButton,
} from '@vertex-hub/ui';
import {
  BanIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ImageIcon,
  type LucideIcon,
  MessageSquareQuoteIcon,
  PaletteIcon,
  PencilIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TypeIcon,
} from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { TabHeader } from '../../components/tab-header';
import { useCopy } from '../../lib/clipboard';
import { formatLink, formatLinkHost } from '../../lib/format';
import { BrandFilesCard } from '../files/brand-files-card';
import { BrandKitForm } from './brand-kit-form';

const isEmpty = (kit: BrandKit) =>
  kit.colors.length === 0 &&
  kit.fonts.length === 0 &&
  !kit.toneOfVoice &&
  kit.forbiddenWords.length === 0 &&
  kit.files.length === 0 &&
  kit.references.length === 0;

export function BrandKitTab({
  client,
  editable,
}: {
  client: ClientDetailResponse;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const kit = client.brandKit;

  if (editing) {
    return (
      <BrandKitForm
        client={client}
        onDone={() => {
          // The view comes back with the button that opened the form: the focus returns to it.
          flushSync(() => setEditing(false));
          editButton.current?.focus();
        }}
      />
    );
  }

  const editAction = editable && (
    <Button
      ref={editButton}
      variant={isEmpty(kit) ? 'primary' : 'outline'}
      onClick={() => setEditing(true)}
    >
      <PencilIcon />
      {isEmpty(kit) ? t('clients.brandKit.fill') : t('clients.brandKit.edit')}
    </Button>
  );

  // The button stays in the header whether the kit is empty or not, so it is the same element
  // after the first save fills the kit, and keeps the focus.
  const header = (
    <TabHeader
      title={t('clients.brandKit.title')}
      description={t('clients.brandKit.description')}
      action={editAction}
    />
  );

  if (isEmpty(kit)) {
    return (
      <>
        {header}
        <EmptyState
          icon={<PaletteIcon />}
          title={t('clients.brandKit.emptyTitle')}
          description={t('clients.brandKit.emptyHint')}
        />
        <BrandFilesCard clientId={client.id} />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-3">
        <KitCard icon={PaletteIcon} title={t('clients.brandKit.colors')} className="lg:col-span-2">
          {kit.colors.length === 0 ? (
            <NotSet />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
              {kit.colors.map((color) => (
                <li key={color.hex}>
                  <ColorTile hex={color.hex} name={color.name} />
                </li>
              ))}
            </ul>
          )}
        </KitCard>

        <KitCard icon={TypeIcon} title={t('clients.brandKit.fonts')}>
          {kit.fonts.length === 0 ? (
            <NotSet />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {kit.fonts.map((font) => (
                <li key={font} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-bold"
                  >
                    {t('clients.brandKit.fontSample')}
                  </span>
                  <span dir="auto" className="font-medium">
                    {font}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </KitCard>

        <KitCard
          icon={MessageSquareQuoteIcon}
          title={t('clients.brandKit.toneOfVoice')}
          className="lg:col-span-2"
        >
          {kit.toneOfVoice ? (
            <blockquote className="border-s-2 border-accent ps-4 text-base whitespace-pre-line">
              {kit.toneOfVoice}
            </blockquote>
          ) : (
            <NotSet />
          )}
        </KitCard>

        <KitCard icon={BanIcon} title={t('clients.brandKit.forbiddenWords')}>
          {kit.forbiddenWords.length === 0 ? (
            <NotSet />
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {kit.forbiddenWords.map((word) => (
                <li key={word}>
                  <Badge tone="danger" className="h-7 px-2.5 text-sm">
                    <BanIcon aria-hidden="true" />
                    {word}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </KitCard>

        <KitCard
          icon={FileTextIcon}
          title={t('clients.brandKit.files')}
          description={t('clients.brandKit.filesHint')}
        >
          {kit.files.length === 0 ? <NotSet /> : <FileLinks files={kit.files} />}
        </KitCard>

        <KitCard
          icon={ImageIcon}
          title={t('clients.brandKit.references')}
          className="lg:col-span-2"
        >
          {kit.references.length === 0 ? (
            <NotSet />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <ReferenceColumn kind="liked" references={kit.references} />
              <ReferenceColumn kind="disliked" references={kit.references} />
            </div>
          )}
        </KitCard>

        <BrandFilesCard clientId={client.id} />
      </div>
    </>
  );
}

function KitCard({
  icon: Icon,
  title,
  description,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
          {title}
        </CardTitle>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>
      {children}
    </Card>
  );
}

function NotSet() {
  const { t } = useTranslation();
  return <p className="text-muted-foreground">{t('clients.brandKit.notSet')}</p>;
}

/** A brand color large enough to judge, with its code one click from the clipboard. */
function ColorTile({ hex, name }: { hex: string; name: string | null }) {
  const { t } = useTranslation();
  const { copy, copied } = useCopy();
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border">
      <ColorSwatch color={hex} className="h-20 w-full rounded-none border-0 border-b" />
      <div className="flex items-center gap-2 p-2">
        <div className="flex min-w-0 flex-1 flex-col">
          {name && <span className="text-sm font-medium break-words">{name}</span>}
          <span dir="ltr" className="text-end text-sm text-muted-foreground tabular-nums">
            {hex}
          </span>
        </div>
        <IconButton
          label={
            copied ? t('clients.brandKit.copied', { hex }) : t('clients.brandKit.copyHex', { hex })
          }
          onClick={() => copy(hex)}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </IconButton>
      </div>
    </div>
  );
}

function FileLinks({ files }: { files: BrandKit['files'] }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      {BRAND_FILE_KINDS.filter((kind) => files.some((file) => file.kind === kind)).map((kind) => (
        <div key={kind} className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t(`clients.brandKit.fileKinds.${kind}`)}
          </p>
          <ul className="flex flex-col gap-1">
            {files
              .filter((file) => file.kind === kind)
              .map((file) => (
                <li key={file.url}>
                  <ExternalLink url={file.url} label={file.label} />
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** A link that opens in a new tab, showing its label and the site it points to. */
function ExternalLink({ url, label }: { url: string; label: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-3 rounded-md border border-border px-3 py-2 transition-colors duration-150 ease-out hover:bg-muted"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium group-hover:underline">{label}</span>
        <span dir="ltr" className="truncate text-end text-xs text-muted-foreground">
          {formatLinkHost(url)}
        </span>
      </span>
      <ExternalLinkIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="sr-only">{t('common.openInNewTab')}</span>
    </a>
  );
}

function ReferenceColumn({
  kind,
  references,
}: {
  kind: 'liked' | 'disliked';
  references: BrandKit['references'];
}) {
  const { t } = useTranslation();
  const items = references.filter((reference) => reference.kind === kind);
  const Icon = kind === 'liked' ? ThumbsUpIcon : ThumbsDownIcon;
  return (
    <section className="flex flex-col gap-2">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <span
          className={
            kind === 'liked'
              ? 'flex size-6 items-center justify-center rounded-sm bg-status-success text-status-success-foreground'
              : 'flex size-6 items-center justify-center rounded-sm bg-status-danger text-status-danger-foreground'
          }
        >
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
        {t(`clients.brandKit.${kind}`)}
      </h4>
      {items.length === 0 ? (
        <NotSet />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((reference) => (
            <li key={reference.url}>
              <ExternalLink
                url={reference.url}
                label={reference.note ?? formatLink(reference.url)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
