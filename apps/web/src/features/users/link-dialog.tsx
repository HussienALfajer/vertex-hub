import type { UserLink } from '@vertex-hub/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
} from '@vertex-hub/ui';
import { CheckIcon, ClockIcon, CopyIcon, LinkIcon } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCopy } from '../../lib/clipboard';
import { formatDateTime } from '../../lib/format';

interface LinkDialogProps {
  link: UserLink | null;
  name: string;
  onClose: () => void;
  /** Buttons after "Copy", e.g. "Open profile". */
  actions?: ReactNode;
}

/**
 * Shows a one-time activation or reset link. It is shown only here, once: the user manager copies
 * it and sends it by hand until email exists (F01, Q5).
 */
export function LinkDialog({ link, name, onClose, actions }: LinkDialogProps) {
  const { t } = useTranslation();
  const { copy, copied } = useCopy();
  const copyButton = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={link !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-xl" initialFocus={copyButton}>
        {link && (
          <>
            <DialogHeader>
              <div className="mb-2 flex size-11 items-center justify-center rounded-lg bg-muted text-foreground">
                <LinkIcon className="size-5" />
              </div>
              <DialogTitle>
                {link.kind === 'activation'
                  ? t('users.link.activationTitle')
                  : t('users.link.resetTitle')}
              </DialogTitle>
              <DialogDescription>{t('users.link.body', { name })}</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel>{t('users.link.label')}</FieldLabel>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={link.url}
                  dir="ltr"
                  className="text-sm"
                  onFocus={(event) => event.currentTarget.select()}
                  aria-label={t('users.link.label')}
                />
                <Button ref={copyButton} onClick={() => copy(link.url)} className="min-w-32">
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? t('users.link.copied') : t('users.link.copy')}
                </Button>
              </div>
            </Field>
            <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <ClockIcon className="size-4 shrink-0" />
                {t('users.link.expires', { time: formatDateTime(link.expiresAt) })}
              </li>
              <li className="flex items-center gap-2">
                <LinkIcon className="size-4 shrink-0" />
                {t('users.link.replaces')}
              </li>
            </ul>
            {actions && <DialogFooter>{actions}</DialogFooter>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
