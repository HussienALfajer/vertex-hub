import { Link } from '@tanstack/react-router';
import type {
  ApprovalItemKind,
  ApprovalItemStatus,
  ApprovalRequest,
  ApprovalRequestState,
  MeResponse,
} from '@vertex-hub/contracts';
import {
  Badge,
  type BadgeProps,
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import {
  CheckIcon,
  CopyIcon,
  type LucideIcon,
  MessageCircleIcon,
  NewspaperIcon,
  SquareCheckBigIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { can, scopesOf } from '../../lib/auth';
import { useCopy } from '../../lib/clipboard';
import { formatDateTime, formatNumber } from '../../lib/format';

/*
 * Pieces the approval screens share (spec F09): who has which queue, the badges of requests and
 * items, the requests table, and handing a link to the contact by hand (rule 10).
 */

/** Medical reviewers have the medical queue (rule 4). Cosmetic: the API enforces it. */
export const reviewsMedical = (me: MeResponse) => can(me, 'approvals.review_medical');

/** Client scope on some client: `tasks.manage` under `all` or `own_clients` (rules 8–12). */
export function sendsApprovals(me: MeResponse): boolean {
  const scopes = scopesOf(me, 'tasks.manage');
  return scopes.includes('all') || scopes.includes('own_clients');
}

const STATE_TONES: Record<ApprovalRequestState, BadgeProps['tone']> = {
  open: 'info',
  expired: 'warning',
  completed: 'success',
  revoked: 'neutral',
};

export function RequestStateBadge({ state }: { state: ApprovalRequestState }) {
  const { t } = useTranslation();
  return <Badge tone={STATE_TONES[state]}>{t(`approvals.states.${state}`)}</Badge>;
}

const ITEM_TONES: Record<ApprovalItemStatus, BadgeProps['tone']> = {
  pending: 'info',
  approved: 'success',
  changes_requested: 'warning',
  withdrawn: 'neutral',
};

export function ItemStatusBadge({ status }: { status: ApprovalItemStatus }) {
  const { t } = useTranslation();
  return <Badge tone={ITEM_TONES[status]}>{t(`approvals.itemStatuses.${status}`)}</Badge>;
}

const KIND_ICONS: Record<ApprovalItemKind, LucideIcon> = {
  task: SquareCheckBigIcon,
  post: NewspaperIcon,
};

/** Whether an item is a task or a post (F08): shown where both are listed together. */
export function ItemKindBadge({ kind }: { kind: ApprovalItemKind }) {
  const { t } = useTranslation();
  const Icon = KIND_ICONS[kind];
  return (
    <Badge tone="outline" className="shrink-0">
      <Icon aria-hidden="true" />
      {t(`approvals.kinds.${kind}`)}
    </Badge>
  );
}

/** Requests as rows: who was asked, how far the answers are, and until when the link works. */
export function RequestsTable({
  requests,
  showClient = true,
}: {
  requests: ApprovalRequest[];
  showClient?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('approvals.sent.columns.request')}</TableHead>
          <TableHead>{t('approvals.sent.columns.state')}</TableHead>
          <TableHead>{t('approvals.sent.columns.decided')}</TableHead>
          <TableHead>{t('approvals.sent.columns.issued')}</TableHead>
          <TableHead>{t('approvals.sent.columns.expires')}</TableHead>
          <TableHead>{t('approvals.sent.columns.createdBy')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((request) => (
          <TableRow key={request.id}>
            <TableCell className="min-w-56 whitespace-normal">
              <span className="flex flex-col items-start gap-0.5">
                <Link
                  to="/approvals/requests/$requestId"
                  params={{ requestId: request.id }}
                  className="font-medium hover:underline"
                >
                  {showClient ? request.client.name : request.contact.name}
                </Link>
                {showClient && (
                  <span className="text-xs text-muted-foreground">{request.contact.name}</span>
                )}
              </span>
            </TableCell>
            <TableCell>
              <RequestStateBadge state={request.state} />
            </TableCell>
            <TableCell className="tabular-nums">
              {t('approvals.sent.decided', {
                decided: formatNumber(request.items.approved + request.items.changesRequested),
                total: formatNumber(request.items.total),
              })}
            </TableCell>
            <TableCell className="tabular-nums">{formatDateTime(request.issuedAt)}</TableCell>
            <TableCell className="tabular-nums">{formatDateTime(request.expiresAt)}</TableCell>
            <TableCell>{request.createdBy.name}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Opens WhatsApp with a prepared message to the contact (rule 10): the system sends nothing. */
export function whatsAppUrl(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

export function WhatsAppButton({
  phone,
  text,
  label,
}: {
  phone: string;
  text: string;
  label: string;
}) {
  return (
    <Button
      variant="outline"
      render={<a href={whatsAppUrl(phone, text)} target="_blank" rel="noopener noreferrer" />}
    >
      <MessageCircleIcon />
      {label}
    </Button>
  );
}

/**
 * A link just issued, shown this once (rule 9): copy it, or open WhatsApp with the message to the
 * contact. Without a phone only copying is offered.
 */
export function IssuedLink({
  link,
  contactName,
  contactPhone,
}: {
  link: string;
  contactName: string;
  contactPhone: string | null;
}) {
  const { t } = useTranslation();
  const { copy, copied } = useCopy();
  return (
    <div className="flex flex-col gap-3">
      <Input
        readOnly
        dir="ltr"
        value={link}
        aria-label={t('approvals.link.label')}
        onFocus={(event) => event.target.select()}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => copy(link)}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? t('common.copied') : t('approvals.link.copy')}
        </Button>
        {contactPhone && (
          <WhatsAppButton
            phone={contactPhone}
            text={t('approvals.link.whatsAppMessage', { name: contactName, link })}
            label={t('approvals.link.whatsApp')}
          />
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {contactPhone ? t('approvals.link.onceHint') : t('approvals.link.onceNoPhoneHint')}
      </p>
    </div>
  );
}
