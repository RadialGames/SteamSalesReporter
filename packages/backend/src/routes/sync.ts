// Sync management routes

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { apiKeys, syncTasks } from '../db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import { runSync, getSyncStatus, type SyncProgress } from '../services/sync-service.js';

// In-memory sync state tracking
const activeSyncs = new Map<string, SyncProgress>();

// Request schemas
const startSyncSchema = z.object({
  apiKeyIds: z.array(z.string().uuid()).optional(), // If not provided, sync all keys
});

export async function syncRoutes(fastify: FastifyInstance) {
  // Start sync for one or more API keys
  fastify.post('/api/sync/start', async (request, reply) => {
    const body = startSyncSchema.parse(request.body);

    // Get API keys to sync
    let keysToSync: { id: string; displayName: string }[];

    if (body.apiKeyIds && body.apiKeyIds.length > 0) {
      keysToSync = await db
        .select({ id: apiKeys.id, displayName: apiKeys.displayName })
        .from(apiKeys)
        .where(sql`${apiKeys.id} = ANY(${body.apiKeyIds})`);
    } else {
      keysToSync = await db
        .select({ id: apiKeys.id, displayName: apiKeys.displayName })
        .from(apiKeys);
    }

    if (keysToSync.length === 0) {
      return reply.status(400).send({ error: 'No API keys found' });
    }

    // Start sync in background
    const syncId = crypto.randomUUID();

    // Initialize progress
    activeSyncs.set(syncId, {
      phase: 'discovery',
      message: 'Starting sync...',
      totalTasks: 0,
      completedTasks: 0,
      recordsProcessed: 0,
    });

    // Run sync in background (don't await)
    (async () => {
      let totalRecords = 0;
      let totalDates = 0;

      for (const key of keysToSync) {
        try {
          const result = await runSync(key.id, (progress) => {
            activeSyncs.set(syncId, {
              ...progress,
              message: `[${key.displayName}] ${progress.message}`,
            });
          });
          totalRecords += result.recordsProcessed;
          totalDates += result.datesFound;
        } catch (error) {
          activeSyncs.set(syncId, {
            phase: 'error',
            message: `Error syncing ${key.displayName}`,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return;
        }
      }

      activeSyncs.set(syncId, {
        phase: 'complete',
        message: `Sync complete: ${totalRecords} records from ${totalDates} dates`,
        totalTasks: totalDates,
        completedTasks: totalDates,
        recordsProcessed: totalRecords,
      });

      // Clean up after 5 minutes
      setTimeout(() => activeSyncs.delete(syncId), 5 * 60 * 1000);
    })();

    return { syncId, message: 'Sync started' };
  });

  // Get sync progress
  fastify.get<{ Params: { syncId: string } }>(
    '/api/sync/status/:syncId',
    async (request, reply) => {
      const progress = activeSyncs.get(request.params.syncId);

      if (!progress) {
        return reply.status(404).send({ error: 'Sync not found or expired' });
      }

      return { progress };
    }
  );

  // Get pending tasks for an API key
  fastify.get<{ Params: { apiKeyId: string } }>(
    '/api/sync/tasks/:apiKeyId',
    async (request) => {
      const status = await getSyncStatus(request.params.apiKeyId);
      return { status };
    }
  );

  // Get all pending tasks across all keys
  fastify.get('/api/sync/tasks', async () => {
    const results = await db
      .select({
        apiKeyId: syncTasks.apiKeyId,
        status: syncTasks.status,
        count: sql<number>`count(*)::int`,
      })
      .from(syncTasks)
      .groupBy(syncTasks.apiKeyId, syncTasks.status);

    // Group by API key
    const byKey: Record<
      string,
      { pending: number; inProgress: number; completed: number; failed: number }
    > = {};

    for (const row of results) {
      if (!byKey[row.apiKeyId]) {
        byKey[row.apiKeyId] = { pending: 0, inProgress: 0, completed: 0, failed: 0 };
      }
      if (row.status === 'pending') byKey[row.apiKeyId].pending = row.count;
      if (row.status === 'in_progress') byKey[row.apiKeyId].inProgress = row.count;
      if (row.status === 'completed') byKey[row.apiKeyId].completed = row.count;
      if (row.status === 'failed') byKey[row.apiKeyId].failed = row.count;
    }

    return { tasks: byKey };
  });

  // Get recent failed tasks
  fastify.get('/api/sync/failed', async () => {
    const failedTasks = await db
      .select()
      .from(syncTasks)
      .where(eq(syncTasks.status, 'failed'))
      .orderBy(desc(syncTasks.completedAt))
      .limit(100);

    return { tasks: failedTasks };
  });

  // Retry failed tasks for an API key
  fastify.post<{ Params: { apiKeyId: string } }>(
    '/api/sync/retry/:apiKeyId',
    async (request) => {
      const { apiKeyId } = request.params;

      // Reset failed tasks to pending
      const result = await db
        .update(syncTasks)
        .set({ status: 'pending', errorMessage: null, startedAt: null, completedAt: null })
        .where(and(eq(syncTasks.apiKeyId, apiKeyId), eq(syncTasks.status, 'failed')))
        .returning({ id: syncTasks.id });

      return { retriedCount: result.length };
    }
  );
}
