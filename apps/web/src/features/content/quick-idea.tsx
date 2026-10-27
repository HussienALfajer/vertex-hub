import { IconButton } from '@vertex-hub/ui';
import { LightbulbIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { can, useMe } from '../../lib/auth';
import { IdeaDialog } from './ideas-panel';

/** Spec F08B screen 7: the top bar's button that adds an idea in one line, for every user. */
export function QuickIdea() {
  const { t } = useTranslation();
  const me = useMe();
  const [open, setOpen] = useState(false);
  if (!can(me, 'content.suggest')) return null;
  return (
    <>
      <IconButton
        size="icon"
        label={t('content.ideas.quick')}
        data-quick-idea
        onClick={() => setOpen(true)}
      >
        <LightbulbIcon />
      </IconButton>
      <IdeaDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
