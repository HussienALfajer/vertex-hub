import type { QuoteDetail } from '@vertex-hub/contracts';
import { Badge, Button, toast } from '@vertex-hub/ui';
import { DownloadIcon, FileTextIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { quotePdfUrl, useRenderPdf } from './quotes.queries';

/** Asks for a render: the draft's preview, or a sent version again after a failure. */
function RenderButton({ quote, label }: { quote: QuoteDetail; label: string }) {
  const { t } = useTranslation();
  const render = useRenderPdf(quote.id);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={render.isPending}
      onClick={async () => {
        try {
          await render.mutateAsync();
        } catch (error) {
          toast.add({ title: errorMessage(t, error), type: 'error' });
        }
      }}
    >
      <RefreshCwIcon />
      {label}
    </Button>
  );
}

function Preparing({ text }: { text: string }) {
  return (
    <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircleIcon
        aria-hidden="true"
        className="size-4 animate-spin motion-reduce:animate-none"
      />
      {text}
    </span>
  );
}

/** Rule 12: the sent version's PDF, "being prepared" until it exists, "render again" on failure. */
export function SentPdf({ quote }: { quote: QuoteDetail }) {
  const { t } = useTranslation();
  if (!quote.pdf) return null;
  if (quote.pdf.state === 'ready') {
    return (
      <Button
        variant="outline"
        render={<a href={quotePdfUrl(quote.id)} target="_blank" rel="noopener" />}
      >
        <DownloadIcon />
        {t('quotes.pdf.download')}
      </Button>
    );
  }
  if (quote.pdf.state === 'pending') return <Preparing text={t('quotes.pdf.preparing')} />;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone="danger">{t('quotes.pdf.failed')}</Badge>
      {quote.permissions.canRenderPdf && (
        <RenderButton quote={quote} label={t('quotes.pdf.renderAgain')} />
      )}
    </span>
  );
}

/**
 * Rule 13: the draft's preview. Asking needs the saved draft (`saved`); a preview of an older
 * draft says so.
 */
export function DraftPreview({ quote, saved }: { quote: QuoteDetail; saved: boolean }) {
  const { t } = useTranslation();
  const preview = quote.draftPdf;
  const canRender = quote.permissions.canRenderPdf && saved;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4">
      <FileTextIcon aria-hidden="true" className="size-5 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{t('quotes.pdf.previewTitle')}</span>
        <span className="text-sm text-muted-foreground">
          {!saved && quote.permissions.canRenderPdf
            ? t('quotes.pdf.saveFirst')
            : preview?.state === 'ready' && preview.renderedAt
              ? t('quotes.pdf.previewRendered', { when: formatDateTime(preview.renderedAt) })
              : t('quotes.pdf.previewHint')}
        </span>
      </div>
      {preview?.state === 'pending' && <Preparing text={t('quotes.pdf.preparingPreview')} />}
      {preview?.state === 'failed' && <Badge tone="danger">{t('quotes.pdf.failed')}</Badge>}
      {preview?.state === 'ready' && (
        <>
          {preview.outdated && <Badge tone="warning">{t('quotes.pdf.outdated')}</Badge>}
          <Button
            variant="outline"
            size="sm"
            render={<a href={quotePdfUrl(quote.id, true)} target="_blank" rel="noopener" />}
          >
            <DownloadIcon />
            {t('quotes.pdf.openPreview')}
          </Button>
        </>
      )}
      {canRender && preview?.state !== 'pending' && (
        <RenderButton quote={quote} label={t('quotes.pdf.preview')} />
      )}
    </div>
  );
}
