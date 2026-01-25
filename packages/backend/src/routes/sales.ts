// Sales data query routes

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { salesRecords, apps, countries, packages } from '../db/schema.js';
import { eq, and, gte, lte, inArray, sql, desc, asc } from 'drizzle-orm';

// Query params schema
const salesQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  apiKeyIds: z.string().optional(), // Comma-separated
  appIds: z.string().optional(), // Comma-separated
  countryCode: z.string().optional(),
  limit: z.coerce.number().min(1).max(10000).default(1000),
  offset: z.coerce.number().min(0).default(0),
  sortBy: z.enum(['date', 'revenue', 'units']).default('date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export async function salesRoutes(fastify: FastifyInstance) {
  // Query sales records with filters
  fastify.get('/api/sales', async (request) => {
    const query = salesQuerySchema.parse(request.query);

    // Build where conditions
    const conditions = [];

    if (query.startDate) {
      conditions.push(gte(salesRecords.date, query.startDate));
    }
    if (query.endDate) {
      conditions.push(lte(salesRecords.date, query.endDate));
    }
    if (query.apiKeyIds) {
      const ids = query.apiKeyIds.split(',');
      conditions.push(inArray(salesRecords.apiKeyId, ids));
    }
    if (query.appIds) {
      const ids = query.appIds.split(',').map(Number);
      conditions.push(inArray(salesRecords.appId, ids));
    }
    if (query.countryCode) {
      conditions.push(eq(salesRecords.countryCode, query.countryCode));
    }

    // Build order by
    let orderBy;
    const direction = query.sortOrder === 'asc' ? asc : desc;
    switch (query.sortBy) {
      case 'revenue':
        orderBy = direction(salesRecords.grossSalesUsdCents);
        break;
      case 'units':
        orderBy = direction(salesRecords.netUnitsSold);
        break;
      default:
        orderBy = direction(salesRecords.date);
    }

    // Execute query with joins
    const records = await db
      .select({
        id: salesRecords.id,
        date: salesRecords.date,
        lineItemType: salesRecords.lineItemType,
        appId: salesRecords.appId,
        appName: apps.appName,
        packageId: salesRecords.packageId,
        packageName: packages.packageName,
        countryCode: salesRecords.countryCode,
        countryName: countries.countryName,
        region: countries.region,
        platform: salesRecords.platform,
        currency: salesRecords.currency,
        grossUnitsSold: salesRecords.grossUnitsSold,
        grossUnitsReturned: salesRecords.grossUnitsReturned,
        netUnitsSold: salesRecords.netUnitsSold,
        grossSalesUsd: sql<number>`${salesRecords.grossSalesUsdCents} / 100.0`,
        netSalesUsd: sql<number>`${salesRecords.netSalesUsdCents} / 100.0`,
        discountPercentage: salesRecords.discountPercentage,
      })
      .from(salesRecords)
      .leftJoin(apps, eq(salesRecords.appId, apps.appId))
      .leftJoin(packages, eq(salesRecords.packageId, packages.packageId))
      .leftJoin(countries, eq(salesRecords.countryCode, countries.countryCode))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(orderBy)
      .limit(query.limit)
      .offset(query.offset);

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(salesRecords)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return {
      records,
      pagination: {
        total: count,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + records.length < count,
      },
    };
  });

  // Get total stats
  fastify.get('/api/stats', async (request) => {
    const query = salesQuerySchema.parse(request.query);

    // Build where conditions
    const conditions = [];
    if (query.startDate) conditions.push(gte(salesRecords.date, query.startDate));
    if (query.endDate) conditions.push(lte(salesRecords.date, query.endDate));
    if (query.apiKeyIds) {
      conditions.push(inArray(salesRecords.apiKeyId, query.apiKeyIds.split(',')));
    }

    const [stats] = await db
      .select({
        totalRevenue: sql<number>`coalesce(sum(${salesRecords.grossSalesUsdCents}), 0) / 100.0`,
        totalUnits: sql<number>`coalesce(sum(${salesRecords.netUnitsSold}), 0)::int`,
        recordCount: sql<number>`count(*)::int`,
        appCount: sql<number>`count(distinct ${salesRecords.appId})::int`,
        countryCount: sql<number>`count(distinct ${salesRecords.countryCode})::int`,
        dateRange: sql<{ min: string; max: string }>`json_build_object('min', min(${salesRecords.date}), 'max', max(${salesRecords.date}))`,
      })
      .from(salesRecords)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return { stats };
  });
}
