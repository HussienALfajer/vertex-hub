import { Viewer, type ViewerItem } from '@vertex-hub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';

export type { ViewerItem };

/**
 * F06B rule C4: the built-in viewer of `@vertex-hub/ui` with the app's labels. `open` shows a set
 * (the images and videos of a group) at one of its items; render `viewer` once on the page.
 */
export function useFileViewer() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<{ items: ViewerItem[]; index: number } | null>(null);
  const viewer = (
    <Viewer
      items={state?.items ?? []}
      index={state?.index ?? null}
      onIndexChange={(index) => setState((current) => current && { ...current, index })}
      onClose={() => setState(null)}
      dir={i18n.dir()}
      labels={{
        close: t('common.close'),
        previous: t('files.preview.previous'),
        next: t('files.preview.next'),
        zoomIn: t('files.viewer.zoomIn'),
        zoomOut: t('files.viewer.zoomOut'),
        resetZoom: t('files.viewer.resetZoom'),
        download: t('files.download'),
        position: (current, total) =>
          t('files.preview.position', {
            current: formatNumber(current),
            total: formatNumber(total),
          }),
      }}
    />
  );
  return {
    open: (items: ViewerItem[], index: number) => {
      if (items[index]) setState({ items, index });
    },
    viewer,
  };
}
