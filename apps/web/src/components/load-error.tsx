import { Button, EmptyState } from '@vertex-hub/ui';
import { CloudOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** A query failed: say what could not load and offer a retry. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
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
