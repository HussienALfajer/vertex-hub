import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { TargetIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { can, useMe } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { leadListQuery } from './leads.queries';

/** Spec screen 7: the client profile names the lead it was converted from, for lead readers. */
export function ConvertedFromLead({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const me = useMe();
  const leads = useQuery({
    ...leadListQuery({ clientId, stage: ['won'], pageSize: 1 }),
    enabled: can(me, 'leads.read'),
  });
  const lead = leads.data?.items[0];
  if (!lead) return null;
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <TargetIcon aria-hidden="true" className="size-4" />
      <span>
        {t('leads.convertedFrom.before')}{' '}
        <Link
          to="/leads/$leadId"
          params={{ leadId: lead.id }}
          className="font-medium text-foreground hover:underline"
        >
          {lead.displayName}
        </Link>{' '}
        {lead.closedAt && t('leads.convertedFrom.on', { date: formatDate(lead.closedAt) })}
      </span>
    </p>
  );
}
