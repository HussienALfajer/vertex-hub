import {
  CREW_ROLES,
  type ExternalCrewMember,
  MEETING_STATUSES,
  SHOOT_STATUSES,
  SHOOT_TYPES,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { clientContacts, clients } from './clients.js';
import { archivedAt, id, timestamps } from './columns.js';
import { tasks } from './tasks.js';

/*
 * Shoots, meetings and their people (F11, ADR 0022), owned by the api `calendar` module. Times
 * are instants; "the day" of a shoot or meeting is the Asia/Damascus date of `starts_at`.
 */

export const shootTypeEnum = pgEnum('shoot_type', SHOOT_TYPES);

export const shootStatusEnum = pgEnum('shoot_status', SHOOT_STATUSES);

export const crewRoleEnum = pgEnum('crew_role', CREW_ROLES);

export const meetingStatusEnum = pgEnum('meeting_status', MEETING_STATUSES);

export const shoots = pgTable(
  'shoots',
  {
    id: id(),
    title: text('title').notNull(),
    type: shootTypeEnum('type').notNull(),
    /** Null for an internal shoot; never changes after booking; the shoot task's client. */
    clientId: uuid('client_id').references(() => clients.id),
    /** The shoot task (rule 4); never changes after booking. */
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    location: text('location').notNull(),
    mapUrl: text('map_url'),
    brief: text('brief'),
    /** Freelancers by name, never checked for conflicts; validated by the contract schema. */
    externalCrew: jsonb('external_crew').$type<ExternalCrewMember[]>().notNull().default([]),
    status: shootStatusEnum('status').notNull().default('scheduled'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedById: uuid('completed_by_id').references(() => users.id),
    closeNote: text('close_note'),
    rawFilesUrl: text('raw_files_url'),
    /** The editing task closing created (rule 12). */
    editingTaskId: uuid('editing_task_id').references(() => tasks.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    /** The booker. */
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('shoots_client_id_idx').on(table.clientId),
    index('shoots_task_id_idx').on(table.taskId),
    /** One non-archived, non-cancelled shoot per task (rule 4, edge case 1). */
    uniqueIndex('shoots_task_active_unique')
      .on(table.taskId)
      .where(sql`${table.archivedAt} is null and ${table.status} <> 'cancelled'`),
    index('shoots_starts_at_idx').on(table.startsAt),
    index('shoots_status_idx').on(table.status),
    index('shoots_completed_by_id_idx').on(table.completedById),
    index('shoots_editing_task_id_idx').on(table.editingTaskId),
    index('shoots_created_by_id_idx').on(table.createdById),
    check('shoots_title_check', sql`char_length(${table.title}) between 1 and 160`),
    check('shoots_location_check', sql`char_length(${table.location}) between 1 and 300`),
    check(
      'shoots_times_check',
      sql`${table.endsAt} > ${table.startsAt}
        and ${table.endsAt} - ${table.startsAt} <= interval '72 hours'`,
    ),
    check(
      'shoots_text_check',
      sql`char_length(${table.mapUrl}) between 1 and 2048
        and char_length(${table.brief}) between 1 and 2000
        and char_length(${table.closeNote}) between 1 and 2000
        and char_length(${table.rawFilesUrl}) between 1 and 2048`,
    ),
    check(
      'shoots_external_crew_check',
      sql`jsonb_typeof(${table.externalCrew}) = 'array'
        and jsonb_array_length(${table.externalCrew}) <= 10`,
    ),
    check(
      'shoots_completed_check',
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)
        and (${table.completedAt} is null) = (${table.completedById} is null)`,
    ),
    check(
      'shoots_cancelled_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)
        and (${table.cancelledAt} is null) = (${table.cancelReason} is null)
        and char_length(${table.cancelReason}) between 1 and 500`,
    ),
  ],
);

/** The team crew of a shoot: 1–10 people, exactly one lead (rule 6). */
export const shootCrew = pgTable(
  'shoot_crew',
  {
    shootId: uuid('shoot_id')
      .notNull()
      .references(() => shoots.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: crewRoleEnum('role').notNull(),
    isLead: boolean('is_lead').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.shootId, table.userId] }),
    index('shoot_crew_user_id_idx').on(table.userId),
    uniqueIndex('shoot_crew_one_lead_idx').on(table.shootId).where(sql`${table.isLead}`),
  ],
);

/** The shot list of a shoot, by position (rule 7); at most 100 items. */
export const shootShots = pgTable(
  'shoot_shots',
  {
    id: id(),
    shootId: uuid('shoot_id')
      .notNull()
      .references(() => shoots.id),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    note: text('note'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneById: uuid('done_by_id').references(() => users.id),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('shoot_shots_position_unique').on(table.shootId, table.position),
    index('shoot_shots_done_by_id_idx').on(table.doneById),
    check('shoot_shots_text_check', sql`char_length(${table.text}) between 1 and 300`),
    check('shoot_shots_note_check', sql`char_length(${table.note}) between 1 and 500`),
    check('shoot_shots_done_check', sql`(${table.doneAt} is null) = (${table.doneById} is null)`),
  ],
);

export const meetings = pgTable(
  'meetings',
  {
    id: id(),
    title: text('title').notNull(),
    clientId: uuid('client_id').references(() => clients.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    location: text('location'),
    onlineUrl: text('online_url'),
    agenda: text('agenda'),
    /** Implicitly attending; not listed in `meeting_attendees`. */
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => users.id),
    status: meetingStatusEnum('status').notNull().default('scheduled'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('meetings_client_id_idx').on(table.clientId),
    index('meetings_starts_at_idx').on(table.startsAt),
    index('meetings_organizer_id_idx').on(table.organizerId),
    index('meetings_created_by_id_idx').on(table.createdById),
    check('meetings_title_check', sql`char_length(${table.title}) between 1 and 160`),
    check(
      'meetings_times_check',
      sql`${table.endsAt} > ${table.startsAt}
        and ${table.endsAt} - ${table.startsAt} <= interval '12 hours'`,
    ),
    check(
      'meetings_text_check',
      sql`char_length(${table.location}) between 1 and 300
        and char_length(${table.onlineUrl}) between 1 and 2048
        and char_length(${table.agenda}) between 1 and 2000`,
    ),
    check(
      'meetings_cancelled_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)
        and char_length(${table.cancelReason}) between 1 and 500`,
    ),
  ],
);

/** Team members invited besides the organizer; at most 20. */
export const meetingAttendees = pgTable(
  'meeting_attendees',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.meetingId, table.userId] }),
    index('meeting_attendees_user_id_idx').on(table.userId),
  ],
);

/** Contacts of the meeting's client; at most 10. */
export const meetingContacts = pgTable(
  'meeting_contacts',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => clientContacts.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.meetingId, table.contactId] }),
    index('meeting_contacts_contact_id_idx').on(table.contactId),
  ],
);
