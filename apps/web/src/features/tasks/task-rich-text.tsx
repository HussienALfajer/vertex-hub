import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserResponse } from '@vertex-hub/contracts';
import { Badge, cn, type RichTextMentions } from '@vertex-hub/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { everyPage } from '../../lib/every-page';
import { userListQuery } from '../users/users.queries';

export { useRichTextLabels } from '../announcements/announcement-parts';

/*
 * F06B rule B2: the task thread and brief write ADR 0038's rich text with mention nodes (F06 rule
 * 16: active users only). A mention shows the person's current name (edge case 14).
 */

/** Every active user, however many: who can be mentioned or asked. */
export function useActiveUsers(): UserResponse[] {
  const queryClient = useQueryClient();
  const users = useQuery({
    queryKey: ['users', 'mentionable'],
    queryFn: () =>
      everyPage((page) => queryClient.fetchQuery(userListQuery({ page, pageSize: 100 }))),
    staleTime: 60_000,
  });
  return users.data ?? [];
}

/** The editor's mention picker, naming people the message already mentions too. */
export function useMentions(known: readonly { id: string; name: string }[] = []): RichTextMentions {
  const { t } = useTranslation();
  const users = useActiveUsers();
  const names = new Map<string, string>();
  for (const person of [...known, ...users]) names.set(person.id.toLowerCase(), person.name);
  return {
    people: users.map((user) => ({ id: user.id, name: user.name })),
    nameOf: (userId) => names.get(userId.toLowerCase()) ?? '…',
    label: t('tasks.comments.mention'),
    searchLabel: t('tasks.comments.mentionSearch'),
    empty: t('common.noMatches'),
  };
}

/** How a mention node shows in a message: the person's current name, muted once archived. */
export function mentionRenderer(
  people: readonly { id: string; name: string; archived: boolean }[],
): (userId: string) => ReactNode {
  const byId = new Map(people.map((person) => [person.id.toLowerCase(), person]));
  return (userId) => {
    const person = byId.get(userId.toLowerCase());
    return (
      <Badge
        tone={person?.archived ? 'outline' : 'info'}
        className={cn('mx-0.5 align-baseline', person?.archived && 'text-muted-foreground')}
      >
        @{person?.name ?? '…'}
      </Badge>
    );
  };
}
