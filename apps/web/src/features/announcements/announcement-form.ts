import type {
  Announcement,
  AnnouncementBody,
  AnnouncementTemplate,
  AudienceInput,
  NotificationPriority,
  PollResultsVisibility,
} from '@vertex-hub/contracts';
import { fromBusinessDateTimeInput, toBusinessDateTimeInput } from '../../lib/format';
import type { CreateAnnouncementBody, UpdateAnnouncementBody } from './announcements.queries';

/*
 * The editor's values (screen 13). Their names follow the create and update inputs, so the
 * contract's issues land on the field they concern; empty texts and switches become nulls here.
 */

export const SEND_MODES = ['now', 'schedule', 'draft'] as const;

export type SendMode = (typeof SEND_MODES)[number];

export interface PollDraft {
  question: string;
  options: string[];
  multiple: boolean;
  anonymous: boolean;
  results: PollResultsVisibility;
  /** A `datetime-local` value in the business timezone; empty: closed by hand. */
  closesAt: string;
}

export interface AnnouncementFormValues {
  title: string;
  /** Null until something is written. */
  body: AnnouncementBody | null;
  linkUrl: string;
  linkLabel: string;
  priority: NotificationPriority;
  requiresAck: boolean;
  audience: AudienceInput;
  /** `YYYY-MM-DD`; empty: not pinned. */
  pinnedUntil: string;
  poll: PollDraft | null;
  send: SendMode;
  /** A `datetime-local` value in the business timezone. */
  scheduledAt: string;
  /** A sent announcement's "Notify again" (rule D10). */
  notifyAgain: boolean;
}

export const emptyPoll = (): PollDraft => ({
  question: '',
  options: ['', ''],
  multiple: false,
  anonymous: false,
  results: 'everyone_after_voting',
  closesAt: '',
});

export const newAnnouncementValues = (): AnnouncementFormValues => ({
  title: '',
  body: null,
  linkUrl: '',
  linkLabel: '',
  priority: 'normal',
  requiresAck: false,
  audience: {},
  pinnedUntil: '',
  poll: null,
  send: 'now',
  scheduledAt: '',
  notifyAgain: false,
});

/** A stored announcement as the editor opens it. */
export function announcementFormValues(announcement: Announcement): AnnouncementFormValues {
  const poll = announcement.poll;
  return {
    title: announcement.title,
    body: announcement.body,
    linkUrl: announcement.linkUrl ?? '',
    linkLabel: announcement.linkLabel ?? '',
    priority: announcement.priority,
    requiresAck: announcement.requiresAck,
    audience: announcement.audience ?? {},
    pinnedUntil: announcement.pinnedUntil ?? '',
    poll: poll && {
      question: poll.question,
      options: poll.options.map((option) => option.label),
      multiple: poll.multiple,
      anonymous: poll.anonymous,
      results: poll.results,
      closesAt: poll.closesAt ? toBusinessDateTimeInput(poll.closesAt) : '',
    },
    send: announcement.status === 'scheduled' ? 'schedule' : 'now',
    scheduledAt: announcement.scheduledAt ? toBusinessDateTimeInput(announcement.scheduledAt) : '',
    notifyAgain: false,
  };
}

/** A template's fields over the editor's values (rule D12); templates hold no audience. */
export function withTemplate(
  values: AnnouncementFormValues,
  template: AnnouncementTemplate,
): AnnouncementFormValues {
  return {
    ...values,
    title: template.title,
    body: template.body,
    priority: template.priority,
    requiresAck: template.requiresAck,
    linkUrl: template.linkUrl ?? '',
    linkLabel: template.linkLabel ?? '',
  };
}

const orNull = (text: string) => (text.trim() ? text.trim() : null);

const instantOrNull = (value: string) => (value ? fromBusinessDateTimeInput(value) : null);

function pollInput(poll: PollDraft | null) {
  if (!poll) return null;
  return {
    question: poll.question,
    options: poll.options,
    multiple: poll.multiple,
    anonymous: poll.anonymous,
    results: poll.results,
    closesAt: instantOrNull(poll.closesAt),
  };
}

/** The fields a template keeps, from the editor. */
export function templateFields(values: AnnouncementFormValues) {
  return {
    title: values.title,
    body: values.body as AnnouncementBody,
    priority: values.priority,
    requiresAck: values.requiresAck,
    linkUrl: orNull(values.linkUrl),
    linkLabel: orNull(values.linkLabel),
  };
}

/** A new announcement (`POST /announcements`). */
export function createInput(values: AnnouncementFormValues): CreateAnnouncementBody {
  return {
    ...templateFields(values),
    audience: values.audience,
    pinnedUntil: orNull(values.pinnedUntil),
    poll: pollInput(values.poll),
    send: values.send,
    ...(values.send === 'schedule' && {
      scheduledAt: instantOrNull(values.scheduledAt) ?? undefined,
    }),
  } as CreateAnnouncementBody;
}

/**
 * A stored announcement's change (`PATCH /announcements/:id`). A sent one sends only what may
 * still change (rule D10): the poll only while nobody voted.
 */
export function updateInput(
  values: AnnouncementFormValues,
  announcement: Announcement,
): UpdateAnnouncementBody {
  const sent = announcement.status === 'sent';
  const fields = {
    ...templateFields(values),
    pinnedUntil: orNull(values.pinnedUntil),
  };
  if (sent) {
    const pollLocked = !announcement.poll || (announcement.poll.voters ?? 0) > 0;
    return {
      title: fields.title,
      body: fields.body,
      linkUrl: fields.linkUrl,
      linkLabel: fields.linkLabel,
      pinnedUntil: fields.pinnedUntil,
      ...(!pollLocked && { poll: pollInput(values.poll) }),
      ...(values.notifyAgain && { notifyAgain: true }),
    } as UpdateAnnouncementBody;
  }
  return {
    ...fields,
    audience: values.audience,
    poll: pollInput(values.poll),
    ...(announcement.status === 'scheduled' && {
      scheduledAt: instantOrNull(values.scheduledAt) ?? undefined,
    }),
  } as UpdateAnnouncementBody;
}
