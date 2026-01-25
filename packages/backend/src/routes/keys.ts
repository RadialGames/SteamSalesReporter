// API key management routes

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { apiKeys, salesRecords, syncTasks, syncState } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { encrypt, decrypt, getKeyHash } from '../services/encryption.js';

// Request schemas
const addKeySchema = z.object({
  key: z.string().min(1),
  displayName: z.string().optional(),
});

const updateKeySchema = z.object({
  displayName: z.string().min(1),
});

export async function keysRoutes(fastify: FastifyInstance) {
  // List all API keys (without actual key values)
  fastify.get('/api/keys', async () => {
    const keys = await db
      .select({
        id: apiKeys.id,
        displayName: apiKeys.displayName,
        keyHash: apiKeys.keyHash,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .orderBy(apiKeys.createdAt);

    return { keys };
  });

  // Get a single API key info
  fastify.get<{ Params: { id: string } }>('/api/keys/:id', async (request, reply) => {
    const key = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.id, request.params.id),
      columns: {
        id: true,
        displayName: true,
        keyHash: true,
        createdAt: true,
      },
    });

    if (!key) {
      return reply.status(404).send({ error: 'API key not found' });
    }

    return { key };
  });

  // Add a new API key
  fastify.post('/api/keys', async (request, reply) => {
    const body = addKeySchema.parse(request.body);

    const encryptedKey = encrypt(body.key);
    const keyHash = getKeyHash(body.key);

    const [newKey] = await db
      .insert(apiKeys)
      .values({
        displayName: body.displayName || `Key ending in ${keyHash}`,
        keyHash,
        encryptedKey,
      })
      .returning({
        id: apiKeys.id,
        displayName: apiKeys.displayName,
        keyHash: apiKeys.keyHash,
        createdAt: apiKeys.createdAt,
      });

    return reply.status(201).send({ key: newKey });
  });

  // Update API key display name
  fastify.put<{ Params: { id: string } }>('/api/keys/:id', async (request, reply) => {
    const body = updateKeySchema.parse(request.body);

    const [updated] = await db
      .update(apiKeys)
      .set({ displayName: body.displayName })
      .where(eq(apiKeys.id, request.params.id))
      .returning({
        id: apiKeys.id,
        displayName: apiKeys.displayName,
        keyHash: apiKeys.keyHash,
        createdAt: apiKeys.createdAt,
      });

    if (!updated) {
      return reply.status(404).send({ error: 'API key not found' });
    }

    return { key: updated };
  });

  // Delete an API key and all associated data
  fastify.delete<{ Params: { id: string } }>('/api/keys/:id', async (request, reply) => {
    const { id } = request.params;

    // Check if key exists
    const existing = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.id, id),
    });

    if (!existing) {
      return reply.status(404).send({ error: 'API key not found' });
    }

    // Delete in order (foreign keys cascade, but let's be explicit)
    await db.delete(syncTasks).where(eq(syncTasks.apiKeyId, id));
    await db.delete(salesRecords).where(eq(salesRecords.apiKeyId, id));
    await db.delete(syncState).where(eq(syncState.apiKeyId, id));
    await db.delete(apiKeys).where(eq(apiKeys.id, id));

    return { success: true };
  });

  // Get stats for an API key
  fastify.get<{ Params: { id: string } }>('/api/keys/:id/stats', async (request, reply) => {
    const { id } = request.params;

    const [stats] = await db
      .select({
        recordCount: sql<number>`count(*)::int`,
        totalRevenue: sql<number>`coalesce(sum(${salesRecords.grossSalesUsdCents}), 0)::bigint`,
        totalUnits: sql<number>`coalesce(sum(${salesRecords.netUnitsSold}), 0)::int`,
        firstDate: sql<string>`min(${salesRecords.date})`,
        lastDate: sql<string>`max(${salesRecords.date})`,
      })
      .from(salesRecords)
      .where(eq(salesRecords.apiKeyId, id));

    return {
      stats: {
        ...stats,
        totalRevenue: (stats?.totalRevenue || 0) / 100, // Convert cents to dollars
      },
    };
  });
}
