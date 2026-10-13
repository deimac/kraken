import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const krakenPlans = pgTable(
  'kraken_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    priceCents: integer('price_cents'),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [check('kraken_plans_price_check', sql`${t.priceCents} is null or ${t.priceCents} >= 0`)],
);

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
    krakenPlanId: uuid('kraken_plan_id').references(() => krakenPlans.id, { onDelete: 'restrict' }),
    transition: text('transition', { enum: ['fade', 'slide', 'cut'] }).notNull().default('fade'),
    transitionMs: integer('transition_ms').notNull().default(600),
    tvLastSeenAt: timestamp('tv_last_seen_at', { withTimezone: true }), // last manifest fetch by the partner's TV
    tvCodeHash: text('tv_code_hash').unique(), // sha256 of the TV access code (sign in without user/password)
    tvCodeExpiresAt: timestamp('tv_code_expires_at', { withTimezone: true }),
    // Direct access: the TV signs in by opening /player/<slug>, no code. Convenient for tests; anyone with the address can join.
    playerOpen: boolean('player_open').notNull().default(false),
    // How often the TVs look for new ads (seconds). Short while testing, 5 minutes in normal operation.
    refreshSeconds: integer('refresh_seconds').notNull().default(300),
    ...timestamps,
  },
  (t) => [
    check('partners_refresh_check', sql`${t.refreshSeconds} in (15, 30, 60, 300)`),
    check('partners_status_check', sql`${t.status} in ('active', 'inactive')`),
    check(
      'partners_weights_check',
      sql`${t.weightLow} > 0 and ${t.weightMedium} > 0 and ${t.weightHigh} > 0`,
    ),
    check('partners_image_seconds_check', sql`${t.defaultImageSeconds} between 1 and 3600`),
    check('partners_transition_check', sql`${t.transition} in ('fade', 'slide', 'cut')`),
    check('partners_transition_ms_check', sql`${t.transitionMs} between 0 and 3000`),
  ],
);

export const PERSON_TYPES = ['pf', 'pj'] as const;

export const advertisers = pgTable(
  'advertisers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    email: text('email'),
    phone: text('phone'),
    source: text('source', { enum: ['manual', 'self_signup'] }).notNull(),
    personType: text('person_type', { enum: PERSON_TYPES }).notNull().default('pj'),
    document: text('document'), // CPF (pf) or CNPJ (pj), digits only; null only for legacy rows
    legalName: text('legal_name'),
    whatsapp: text('whatsapp'),
    notes: text('notes'),
    zip: text('zip'),
    street: text('street'),
    number: text('number'),
    complement: text('complement'),
    district: text('district'),
    city: text('city'),
    state: text('state'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check('advertisers_source_check', sql`${t.source} in ('manual', 'self_signup')`),
    check('advertisers_person_type_check', sql`${t.personType} in ('pf', 'pj')`),
    index('advertisers_partner_idx').on(t.partnerId),
    uniqueIndex('advertisers_partner_document_uq').on(t.partnerId, t.document).where(sql`${t.document} is not null`),
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
    advertiserId: uuid('advertiser_id').references(() => advertisers.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    check('users_role_check', sql`${t.role} in ('admin', 'partner_user', 'advertiser', 'player')`),
    // admin has no partner; every other role belongs to exactly one partner.
    check('users_partner_scope_check', sql`(${t.role} = 'admin') = (${t.partnerId} is null)`),
    check('users_advertiser_scope_check', sql`(${t.role} = 'advertiser') = (${t.advertiserId} is not null)`),
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

export const FREQUENCY_LEVELS = ['low', 'medium', 'high'] as const;
export type FrequencyLevel = (typeof FREQUENCY_LEVELS)[number];

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    frequencyLevel: text('frequency_level', { enum: FREQUENCY_LEVELS }).notNull(),
    active: boolean('active').notNull().default(true), // false = archived
    maxVideos: integer('max_videos').notNull().default(1),
    maxImages: integer('max_images').notNull().default(1),
    maxVideoSeconds: integer('max_video_seconds').notNull().default(30),
    priceCents: integer('price_cents').notNull().default(0),
    periodMonths: integer('period_months').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    check('plans_frequency_check', sql`${t.frequencyLevel} in ('low', 'medium', 'high')`),
    check('plans_limits_check', sql`${t.maxVideos} between 0 and 50 and ${t.maxImages} between 0 and 50 and ${t.maxVideos} + ${t.maxImages} > 0`),
    check('plans_video_seconds_check', sql`${t.maxVideoSeconds} between 5 and 300`),
    check('plans_price_check', sql`${t.priceCents} >= 0`),
    check('plans_period_check', sql`${t.periodMonths} in (1, 3, 6, 12)`),
    index('plans_partner_idx').on(t.partnerId),
  ],
);

// A commercial campaign is shown to people as a "subscription" (assinatura): advertiser + plan + period, with pieces.
export const CAMPAIGN_STATUSES = ['active', 'paused', 'cancelled'] as const;
export const PAYMENT_STATUSES = ['pending', 'paid'] as const;
export const PIECE_STATUSES = ['pending_review', 'approved', 'rejected', 'removed'] as const;
export type PieceStatus = (typeof PIECE_STATUSES)[number];
export const REVIEW_ACTIONS = [
  'submitted', 'approved', 'changes_requested', 'cancelled', // legacy campaign flow
  'created', 'paused', 'resumed', 'payment', 'piece_added', 'piece_submitted', 'piece_approved', 'piece_rejected', 'piece_removed',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
    advertiserId: uuid('advertiser_id').references(() => advertisers.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: ['commercial', 'institutional'] }).notNull(),
    name: text('name').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: CAMPAIGN_STATUSES }).notNull().default('active'),
    frequencyLevel: text('frequency_level', { enum: FREQUENCY_LEVELS }).notNull(),
    priceCents: integer('price_cents').notNull().default(0), // copied from the plan when created
    paymentStatus: text('payment_status', { enum: PAYMENT_STATUSES }).notNull().default('pending'),
    ...timestamps,
  },
  (t) => [
    check('campaigns_kind_check', sql`${t.kind} in ('commercial', 'institutional')`),
    check('campaigns_status_check', sql`${t.status} in ('active', 'paused', 'cancelled')`),
    check('campaigns_payment_check', sql`${t.paymentStatus} in ('pending', 'paid')`),
    check('campaigns_frequency_check', sql`${t.frequencyLevel} in ('low', 'medium', 'high')`),
    check('campaigns_period_check', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'campaigns_scope_check',
      sql`(${t.kind} = 'commercial' and ${t.partnerId} is not null and ${t.advertiserId} is not null and ${t.planId} is not null)
       or (${t.kind} = 'institutional' and ${t.partnerId} is null and ${t.advertiserId} is null and ${t.planId} is null)`,
    ),
    index('campaigns_partner_status_idx').on(t.partnerId, t.status),
    index('campaigns_advertiser_idx').on(t.advertiserId),
  ],
);

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id').notNull().references((): AnyPgColumn => campaigns.id, { onDelete: 'restrict' }),
    storageKey: text('storage_key').notNull().unique(),
    mediaType: text('media_type', { enum: ['image', 'video'] }).notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    durationMs: integer('duration_ms'),
    sha256: text('sha256').notNull(),
    displaySeconds: integer('display_seconds'),
    status: text('status', { enum: PIECE_STATUSES }).notNull().default('approved'),
    reviewReason: text('review_reason'),
    uploadedBy: uuid('uploaded_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    originalName: text('original_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('media_type_check', sql`${t.mediaType} in ('image', 'video')`),
    check('media_display_check', sql`(${t.mediaType} = 'image') = (${t.displaySeconds} is not null)`),
    check('media_status_check', sql`${t.status} in ('pending_review', 'approved', 'rejected', 'removed')`),
    index('media_campaign_idx').on(t.campaignId),
  ],
);

export const campaignReviews = pgTable(
  'campaign_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    action: text('action', { enum: REVIEW_ACTIONS }).notNull(),
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
    reason: text('reason'),
    actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'campaign_reviews_action_check',
      sql`${t.action} in ('submitted', 'approved', 'changes_requested', 'cancelled', 'created', 'paused', 'resumed', 'payment',
        'piece_added', 'piece_submitted', 'piece_approved', 'piece_rejected', 'piece_removed')`,
    ),
    index('campaign_reviews_campaign_idx').on(t.campaignId),
  ],
);

export const plays = pgTable(
  'plays',
  {
    id: uuid('id').primaryKey(), // generated by the player (UUIDv7): makes resends idempotent
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }),
    mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'restrict' }),
    mediaType: text('media_type', { enum: ['image', 'video'] }).notNull(),
    playedAt: timestamp('played_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('plays_media_type_check', sql`${t.mediaType} in ('image', 'video')`),
    index('plays_campaign_played_idx').on(t.campaignId, t.playedAt),
    index('plays_partner_played_idx').on(t.partnerId, t.playedAt),
  ],
);
