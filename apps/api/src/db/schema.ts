import { sql } from 'drizzle-orm';
import {
  boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const partners = pgTable(
  'partners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    weightLow: integer('weight_low').notNull().default(1),
    weightMedium: integer('weight_medium').notNull().default(2),
    weightHigh: integer('weight_high').notNull().default(3),
    defaultImageSeconds: integer('default_image_seconds').notNull().default(10),
    showInstitutional: boolean('show_institutional').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    check('partners_status_check', sql`${t.status} in ('active', 'inactive')`),
    check(
      'partners_weights_check',
      sql`${t.weightLow} > 0 and ${t.weightMedium} > 0 and ${t.weightHigh} > 0`,
    ),
    check('partners_image_seconds_check', sql`${t.defaultImageSeconds} between 1 and 3600`),
  ],
);

export const ROLES = ['admin', 'partner_user', 'advertiser', 'player'] as const;
export type Role = (typeof ROLES)[number];

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ROLES }).notNull(),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    check('users_role_check', sql`${t.role} in ('admin', 'partner_user', 'advertiser', 'player')`),
    // admin has no partner; every other role belongs to exactly one partner.
    check('users_partner_scope_check', sql`(${t.role} = 'admin') = (${t.partnerId} is null)`),
    uniqueIndex('users_one_player_per_partner').on(t.partnerId).where(sql`${t.role} = 'player'`),
    index('users_partner_idx').on(t.partnerId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256(token) hex
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);
