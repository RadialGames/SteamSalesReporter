import {
  pgTable,
  uuid,
  text,
  timestamp,
  serial,
  bigint,
  integer,
  smallint,
  pgEnum,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ==================== ENUMS ====================

export const syncStatusEnum = pgEnum('sync_status', [
  'pending',
  'in_progress',
  'completed',
  'failed',
]);

// ==================== CONFIG TABLES ====================

// API key metadata (actual keys stored encrypted or in env)
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  keyHash: text('key_hash').notNull(), // Last 4 chars for display
  encryptedKey: text('encrypted_key').notNull(), // AES encrypted key
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Highwatermarks for incremental sync
export const syncState = pgTable('sync_state', {
  id: serial('id').primaryKey(),
  apiKeyId: uuid('api_key_id')
    .references(() => apiKeys.id, { onDelete: 'cascade' })
    .notNull(),
  highwatermark: bigint('highwatermark', { mode: 'number' }).default(0).notNull(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
});

// ==================== QUERY HISTORY ====================

// Track GetChangedDatesForPartner queries
export const changedDatesQueries = pgTable('changed_dates_queries', {
  id: serial('id').primaryKey(),
  apiKeyId: uuid('api_key_id')
    .references(() => apiKeys.id, { onDelete: 'cascade' })
    .notNull(),
  highwatermarkIn: bigint('highwatermark_in', { mode: 'number' }).notNull(),
  highwatermarkOut: bigint('highwatermark_out', { mode: 'number' }).notNull(),
  datesFound: integer('dates_found').notNull(),
  queriedAt: timestamp('queried_at', { withTimezone: true }).defaultNow().notNull(),
});

// ==================== SYNC TASKS (TODO LIST) ====================

export const syncTasks = pgTable(
  'sync_tasks',
  {
    id: serial('id').primaryKey(),
    apiKeyId: uuid('api_key_id')
      .references(() => apiKeys.id, { onDelete: 'cascade' })
      .notNull(),
    date: date('date').notNull(),
    status: syncStatusEnum('status').default('pending').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_sync_tasks_status').on(table.status),
    index('idx_sync_tasks_api_key_status').on(table.apiKeyId, table.status),
    uniqueIndex('idx_sync_tasks_unique').on(table.apiKeyId, table.date),
  ]
);

// ==================== LOOKUP TABLES ====================

export const apps = pgTable('apps', {
  appId: integer('app_id').primaryKey(),
  appName: text('app_name').notNull(),
});

export const packages = pgTable('packages', {
  packageId: integer('package_id').primaryKey(),
  packageName: text('package_name').notNull(),
});

export const bundles = pgTable('bundles', {
  bundleId: integer('bundle_id').primaryKey(),
  bundleName: text('bundle_name').notNull(),
});

export const partners = pgTable('partners', {
  partnerId: integer('partner_id').primaryKey(),
  partnerName: text('partner_name').notNull(),
});

export const countries = pgTable('countries', {
  countryCode: text('country_code').primaryKey(),
  countryName: text('country_name').notNull(),
  region: text('region'),
});

export const gameItems = pgTable(
  'game_items',
  {
    id: serial('id').primaryKey(),
    appId: integer('app_id')
      .references(() => apps.appId)
      .notNull(),
    gameItemId: integer('game_item_id').notNull(),
    description: text('description'),
    category: text('category'),
  },
  (table) => [uniqueIndex('idx_game_items_unique').on(table.appId, table.gameItemId)]
);

export const discounts = pgTable('discounts', {
  discountId: integer('discount_id').primaryKey(),
  discountName: text('discount_name').notNull(),
  discountPercentage: smallint('discount_percentage'),
});

// ==================== SALES RECORDS (MAIN DATA) ====================

export const salesRecords = pgTable(
  'sales_records',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    apiKeyId: uuid('api_key_id')
      .references(() => apiKeys.id, { onDelete: 'cascade' })
      .notNull(),
    date: date('date').notNull(),

    // Identifiers
    lineItemType: text('line_item_type').notNull(),
    partnerId: integer('partner_id').references(() => partners.partnerId),
    primaryAppId: integer('primary_app_id').references(() => apps.appId),
    packageId: integer('package_id').references(() => packages.packageId),
    bundleId: integer('bundle_id').references(() => bundles.bundleId),
    appId: integer('app_id').references(() => apps.appId),
    gameItemId: integer('game_item_id'),

    // Location & Platform
    countryCode: text('country_code').references(() => countries.countryCode),
    platform: text('platform'),
    currency: text('currency'),

    // Pricing (stored as cents to avoid floating point)
    basePriceCents: integer('base_price_cents'),
    salePriceCents: integer('sale_price_cents'),
    avgSalePriceUsdCents: integer('avg_sale_price_usd_cents'),
    packageSaleType: text('package_sale_type'),

    // Units
    grossUnitsSold: integer('gross_units_sold').default(0),
    grossUnitsReturned: integer('gross_units_returned').default(0),
    grossUnitsActivated: integer('gross_units_activated').default(0),
    netUnitsSold: integer('net_units_sold').default(0),

    // Revenue (stored as cents, use bigint for large values)
    grossSalesUsdCents: bigint('gross_sales_usd_cents', { mode: 'number' }).default(0),
    grossReturnsUsdCents: bigint('gross_returns_usd_cents', { mode: 'number' }).default(0),
    netSalesUsdCents: bigint('net_sales_usd_cents', { mode: 'number' }).default(0),
    netTaxUsdCents: bigint('net_tax_usd_cents', { mode: 'number' }).default(0),

    // Discounts
    discountId: integer('discount_id').references(() => discounts.discountId),
    discountPercentage: smallint('discount_percentage'),

    // Metadata
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_sales_date').on(table.date),
    index('idx_sales_api_key_date').on(table.apiKeyId, table.date),
    index('idx_sales_app').on(table.appId),
    index('idx_sales_country').on(table.countryCode),
    // Covering index for common aggregations
    index('idx_sales_agg').on(table.date, table.grossSalesUsdCents, table.netUnitsSold),
  ]
);

// ==================== TYPE EXPORTS ====================

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type SyncTask = typeof syncTasks.$inferSelect;
export type NewSyncTask = typeof syncTasks.$inferInsert;

export type SalesRecord = typeof salesRecords.$inferSelect;
export type NewSalesRecord = typeof salesRecords.$inferInsert;

export type App = typeof apps.$inferSelect;
export type Package = typeof packages.$inferSelect;
export type Bundle = typeof bundles.$inferSelect;
export type Partner = typeof partners.$inferSelect;
export type Country = typeof countries.$inferSelect;
