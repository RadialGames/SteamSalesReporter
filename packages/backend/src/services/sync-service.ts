// Sync service for orchestrating Steam data synchronization
// Handles discovery, task creation, and batch processing

import { db } from '../db/index.js';
import {
  syncTasks,
  syncState,
  changedDatesQueries,
  salesRecords,
  apps,
  packages,
  bundles,
  partners,
  countries,
  discounts,
  type NewSalesRecord,
} from '../db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import {
  fetchChangedDates,
  fetchDetailedSales,
  usdToCents,
  priceToCents,
  type SteamDetailedSalesResponse,
} from './steam-api.js';
import { decrypt } from './encryption.js';

// Configuration
const BATCH_SIZE = 1000; // Records per batch insert
const CONCURRENT_TASKS = 8; // Parallel date fetches
const TASK_BATCH_SIZE = 10; // Tasks to claim at once

export interface SyncProgress {
  phase: 'discovery' | 'populate' | 'complete' | 'error';
  message: string;
  totalTasks?: number;
  completedTasks?: number;
  currentDate?: string;
  recordsProcessed?: number;
  error?: string;
}

export type ProgressCallback = (progress: SyncProgress) => void;

/**
 * Get the decrypted API key for an API key ID
 */
export async function getDecryptedApiKey(apiKeyId: string): Promise<string | null> {
  const result = await db.query.apiKeys.findFirst({
    where: (apiKeys, { eq }) => eq(apiKeys.id, apiKeyId),
  });
  if (!result) return null;
  return decrypt(result.encryptedKey);
}

/**
 * Get or create sync state for an API key
 */
async function getSyncState(apiKeyId: string): Promise<{ highwatermark: number }> {
  const existing = await db.query.syncState.findFirst({
    where: eq(syncState.apiKeyId, apiKeyId),
  });

  if (existing) {
    return { highwatermark: existing.highwatermark };
  }

  // Create new sync state
  const [created] = await db
    .insert(syncState)
    .values({ apiKeyId, highwatermark: 0 })
    .returning();

  return { highwatermark: created.highwatermark };
}

/**
 * Update highwatermark for an API key
 */
async function updateHighwatermark(apiKeyId: string, highwatermark: number): Promise<void> {
  await db
    .update(syncState)
    .set({ highwatermark, lastSyncAt: new Date() })
    .where(eq(syncState.apiKeyId, apiKeyId));
}

/**
 * Phase 1: Discovery - Find changed dates and create sync tasks
 */
export async function discoverChangedDates(
  apiKeyId: string,
  apiKey: string,
  onProgress?: ProgressCallback
): Promise<{ datesFound: number; newHighwatermark: number }> {
  onProgress?.({
    phase: 'discovery',
    message: 'Finding changed dates...',
  });

  const state = await getSyncState(apiKeyId);
  const { dates, newHighwatermark } = await fetchChangedDates(apiKey, state.highwatermark);

  if (dates.length === 0) {
    return { datesFound: 0, newHighwatermark };
  }

  // Log the query
  await db.insert(changedDatesQueries).values({
    apiKeyId,
    highwatermarkIn: state.highwatermark,
    highwatermarkOut: newHighwatermark,
    datesFound: dates.length,
  });

  // Delete existing sales for these dates (we'll re-fetch)
  await db
    .delete(salesRecords)
    .where(and(eq(salesRecords.apiKeyId, apiKeyId), inArray(salesRecords.date, dates)));

  // Create sync tasks for each date
  const taskValues = dates.map((date) => ({
    apiKeyId,
    date,
    status: 'pending' as const,
  }));

  // Use upsert to handle existing tasks
  for (const task of taskValues) {
    await db
      .insert(syncTasks)
      .values(task)
      .onConflictDoUpdate({
        target: [syncTasks.apiKeyId, syncTasks.date],
        set: { status: 'pending', errorMessage: null, startedAt: null, completedAt: null },
      });
  }

  onProgress?.({
    phase: 'discovery',
    message: `Found ${dates.length} dates to sync`,
    totalTasks: dates.length,
  });

  return { datesFound: dates.length, newHighwatermark };
}

/**
 * Phase 2: Process sync tasks in parallel batches
 */
export async function processSyncTasks(
  apiKeyId: string,
  apiKey: string,
  onProgress?: ProgressCallback
): Promise<{ recordsProcessed: number }> {
  let totalRecords = 0;
  let completedTasks = 0;

  // Get total pending tasks
  const [{ count: totalTasks }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(syncTasks)
    .where(and(eq(syncTasks.apiKeyId, apiKeyId), eq(syncTasks.status, 'pending')));

  onProgress?.({
    phase: 'populate',
    message: 'Processing sales data...',
    totalTasks,
    completedTasks: 0,
    recordsProcessed: 0,
  });

  while (true) {
    // Claim a batch of tasks
    const tasks = await db
      .update(syncTasks)
      .set({ status: 'in_progress', startedAt: new Date() })
      .where(
        and(
          eq(syncTasks.apiKeyId, apiKeyId),
          eq(syncTasks.status, 'pending'),
          sql`${syncTasks.id} IN (
            SELECT id FROM ${syncTasks}
            WHERE api_key_id = ${apiKeyId} AND status = 'pending'
            LIMIT ${TASK_BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
          )`
        )
      )
      .returning();

    if (tasks.length === 0) break;

    // Process tasks in parallel
    const results = await Promise.allSettled(
      tasks.map(async (task) => {
        try {
          const records = await processDateTask(apiKeyId, apiKey, task.date);
          await db
            .update(syncTasks)
            .set({ status: 'completed', completedAt: new Date() })
            .where(eq(syncTasks.id, task.id));
          return records;
        } catch (error) {
          await db
            .update(syncTasks)
            .set({
              status: 'failed',
              errorMessage: error instanceof Error ? error.message : 'Unknown error',
              completedAt: new Date(),
            })
            .where(eq(syncTasks.id, task.id));
          throw error;
        }
      })
    );

    // Tally results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        totalRecords += result.value;
        completedTasks++;
      } else {
        completedTasks++; // Count failed tasks too
      }
    }

    onProgress?.({
      phase: 'populate',
      message: `Processed ${completedTasks}/${totalTasks} dates`,
      totalTasks,
      completedTasks,
      recordsProcessed: totalRecords,
    });
  }

  return { recordsProcessed: totalRecords };
}

/**
 * Process a single date task - fetch and store sales data
 */
async function processDateTask(
  apiKeyId: string,
  apiKey: string,
  date: string
): Promise<number> {
  const pages = await fetchDetailedSales(apiKey, date);

  // Extract and upsert lookup data
  await extractAndStoreLookups(pages);

  // Transform and batch insert sales records
  const records: NewSalesRecord[] = [];

  for (const page of pages) {
    const results = page.response?.results || [];

    for (const item of results) {
      const primaryAppId = item.primary_appid || item.appid || null;

      records.push({
        apiKeyId,
        date: item.date,
        lineItemType: item.line_item_type,
        partnerId: item.partnerid || null,
        primaryAppId,
        packageId: item.packageid || null,
        bundleId: item.bundleid || null,
        appId: item.appid || null,
        gameItemId: item.game_item_id || null,
        countryCode: item.country_code || null,
        platform: item.platform || null,
        currency: item.currency || null,
        basePriceCents: priceToCents(item.base_price),
        salePriceCents: priceToCents(item.sale_price),
        avgSalePriceUsdCents: priceToCents(item.avg_sale_price_usd),
        packageSaleType: item.package_sale_type || null,
        grossUnitsSold: item.gross_units_sold ?? 0,
        grossUnitsReturned: item.gross_units_returned ?? 0,
        grossUnitsActivated: item.gross_units_activated ?? 0,
        netUnitsSold: item.net_units_sold ?? 0,
        grossSalesUsdCents: usdToCents(item.gross_sales_usd),
        grossReturnsUsdCents: usdToCents(item.gross_returns_usd),
        netSalesUsdCents: usdToCents(item.net_sales_usd),
        netTaxUsdCents: usdToCents(item.net_tax_usd),
        discountId: item.combined_discount_id || null,
        discountPercentage: item.total_discount_percentage ?? null,
      });
    }
  }

  // Batch insert records
  if (records.length > 0) {
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      await db.insert(salesRecords).values(batch);
    }
  }

  return records.length;
}

/**
 * Extract lookup data from API response and upsert to database
 */
async function extractAndStoreLookups(pages: SteamDetailedSalesResponse[]): Promise<void> {
  const appsMap = new Map<number, string>();
  const packagesMap = new Map<number, string>();
  const bundlesMap = new Map<number, string>();
  const partnersMap = new Map<number, string>();
  const countriesMap = new Map<string, { name: string; region?: string }>();
  const discountsMap = new Map<number, { name: string; percentage?: number }>();

  for (const page of pages) {
    for (const app of page.response?.app_info || []) {
      appsMap.set(app.appid, app.app_name);
    }
    for (const pkg of page.response?.package_info || []) {
      packagesMap.set(pkg.packageid, pkg.package_name);
    }
    for (const bundle of page.response?.bundle_info || []) {
      bundlesMap.set(bundle.bundleid, bundle.bundle_name);
    }
    for (const partner of page.response?.partner_info || []) {
      partnersMap.set(partner.partnerid, partner.partner_name);
    }
    for (const country of page.response?.country_info || []) {
      countriesMap.set(country.country_code, {
        name: country.country_name,
        region: country.region,
      });
    }
    for (const discount of page.response?.combined_discount_info || []) {
      discountsMap.set(discount.combined_discount_id, {
        name: discount.combined_discount_name,
        percentage: discount.total_discount_percentage,
      });
    }
  }

  // Upsert lookups
  if (appsMap.size > 0) {
    const values = Array.from(appsMap.entries()).map(([appId, appName]) => ({
      appId,
      appName,
    }));
    await db.insert(apps).values(values).onConflictDoNothing();
  }

  if (packagesMap.size > 0) {
    const values = Array.from(packagesMap.entries()).map(([packageId, packageName]) => ({
      packageId,
      packageName,
    }));
    await db.insert(packages).values(values).onConflictDoNothing();
  }

  if (bundlesMap.size > 0) {
    const values = Array.from(bundlesMap.entries()).map(([bundleId, bundleName]) => ({
      bundleId,
      bundleName,
    }));
    await db.insert(bundles).values(values).onConflictDoNothing();
  }

  if (partnersMap.size > 0) {
    const values = Array.from(partnersMap.entries()).map(([partnerId, partnerName]) => ({
      partnerId,
      partnerName,
    }));
    await db.insert(partners).values(values).onConflictDoNothing();
  }

  if (countriesMap.size > 0) {
    const values = Array.from(countriesMap.entries()).map(([countryCode, data]) => ({
      countryCode,
      countryName: data.name,
      region: data.region || null,
    }));
    await db.insert(countries).values(values).onConflictDoNothing();
  }

  if (discountsMap.size > 0) {
    const values = Array.from(discountsMap.entries()).map(([discountId, data]) => ({
      discountId,
      discountName: data.name,
      discountPercentage: data.percentage ?? null,
    }));
    await db.insert(discounts).values(values).onConflictDoNothing();
  }
}

/**
 * Run full sync for an API key
 */
export async function runSync(
  apiKeyId: string,
  onProgress?: ProgressCallback
): Promise<{ datesFound: number; recordsProcessed: number }> {
  // Get decrypted API key
  const apiKey = await getDecryptedApiKey(apiKeyId);
  if (!apiKey) {
    throw new Error('API key not found');
  }

  try {
    // Phase 1: Discovery
    const { datesFound, newHighwatermark } = await discoverChangedDates(
      apiKeyId,
      apiKey,
      onProgress
    );

    if (datesFound === 0) {
      onProgress?.({
        phase: 'complete',
        message: 'No new data to sync',
        totalTasks: 0,
        completedTasks: 0,
        recordsProcessed: 0,
      });
      return { datesFound: 0, recordsProcessed: 0 };
    }

    // Phase 2: Process tasks
    const { recordsProcessed } = await processSyncTasks(apiKeyId, apiKey, onProgress);

    // Save highwatermark only after successful completion
    await updateHighwatermark(apiKeyId, newHighwatermark);

    onProgress?.({
      phase: 'complete',
      message: `Sync complete: ${recordsProcessed} records`,
      totalTasks: datesFound,
      completedTasks: datesFound,
      recordsProcessed,
    });

    return { datesFound, recordsProcessed };
  } catch (error) {
    onProgress?.({
      phase: 'error',
      message: 'Sync failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Get current sync status
 */
export async function getSyncStatus(apiKeyId: string): Promise<{
  pendingTasks: number;
  completedTasks: number;
  failedTasks: number;
}> {
  const results = await db
    .select({
      status: syncTasks.status,
      count: sql<number>`count(*)::int`,
    })
    .from(syncTasks)
    .where(eq(syncTasks.apiKeyId, apiKeyId))
    .groupBy(syncTasks.status);

  const counts = {
    pendingTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
  };

  for (const row of results) {
    if (row.status === 'pending' || row.status === 'in_progress') {
      counts.pendingTasks += row.count;
    } else if (row.status === 'completed') {
      counts.completedTasks = row.count;
    } else if (row.status === 'failed') {
      counts.failedTasks = row.count;
    }
  }

  return counts;
}
