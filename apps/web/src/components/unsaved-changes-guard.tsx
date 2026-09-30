import { useBlocker } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './confirm-dialog';

/**
 * Asks before leaving a page with unsaved changes: a link, the back button, or closing the tab
 * (the browser's own prompt). Used by the long whole-record editors (template, brand kit).
 */
export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const { t } = useTranslation();
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  return (
    <ConfirmDialog
      open={blocker.status === 'blocked'}
      onClose={() => blocker.reset?.()}
      title={t('common.unsaved.title')}
      body={t('common.unsaved.body')}
      action={t('common.unsaved.leave')}
      destructive
      pending={false}
      onConfirm={async () => blocker.proceed?.()}
    />
  );
}
