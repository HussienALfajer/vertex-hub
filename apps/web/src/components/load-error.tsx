import { Button, EmptyState } from '@vertex-hub/ui';
import { CloudOffIcon, SearchXIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api/client';

/** The record does not exist or is hidden from the caller (404), or the id is malformed (400). */
export const isMissing = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 404 || error.status === 400);

/**
 * A query failed: say what could not load and offer a retry. When `error` says the record does
 * not exist (404, or a malformed id: 400), retrying cannot help: the page's back link is the way
 * out, so there is no retry and no "report it".
 */
export function LoadError({
  message,
  onRetry,
  error,
}: {
  message: string;
  onRetry: () => void;
  error?: unknown;
}) {
  const { t } = useTranslation();
  if (isMissing(error)) {
    return (
      <EmptyState
        role="alert"
        icon={<SearchXIcon />}
        title={message}
        description={t('common.missingBody')}
      />
    );
  }
  return (
    <EmptyState
      role="alert"
      icon={<CloudOffIcon />}
      title={message}
      description={t('common.errorBody')}
      action={
        <Button variant="outline" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      }
    />
  );
}
