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
  IconTile,
  Input,
} from '@vertex-hub/ui';
import { CheckIcon, ClockIcon, CopyIcon, LinkIcon, MailCheckIcon } from 'lucide-react';
import { type ComponentProps, type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCopy } from '../../lib/clipboard';
import { formatDateTime } from '../../lib/format';

interface LinkDialogProps {
  link: UserLink | null;
  name: string;
  /** The address the link was emailed to (F14 email rule 13). */
  email: string | null;
  onClose: () => void;
  /** Buttons after "Copy", e.g. "Open profile". */
  actions?: ReactNode;
  /** Where the focus goes when it closes, when the element that opened it is gone (a menu item). */
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus'];
}

/**
 * Shows a one-time activation or reset link. It is emailed to the user and shown here once, so the
 * user manager can also copy it (F01, F14 email screen 7).
 */
export function LinkDialog({ link, name, email, onClose, actions, finalFocus }: LinkDialogProps) {
  const { t } = useTranslation();
  const { copy, copied } = useCopy();
  const copyButton = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={link !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        closeLabel={t('common.close')}
        className="max-w-xl"
        initialFocus={copyButton}
        finalFocus={finalFocus}
      >
        {link && (
          <>
            <DialogHeader>
              <IconTile className="mb-2">
                <LinkIcon />
              </IconTile>
              <DialogTitle>
                {link.kind === 'activation'
                  ? t('users.link.activationTitle')
                  : t('users.link.resetTitle')}
              </DialogTitle>
              <DialogDescription>{t('users.link.body', { name })}</DialogDescription>
            </DialogHeader>
            {email && (
              <p className="flex items-center gap-2 text-sm font-medium">
                <MailCheckIcon className="size-4 shrink-0 text-muted-foreground" />
                <span>
                  {t('users.link.sentTo')} <bdi dir="ltr">{email}</bdi>
                </span>
              </p>
            )}
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
