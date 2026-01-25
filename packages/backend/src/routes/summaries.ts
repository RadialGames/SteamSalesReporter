// Summary/aggregate routes for charts and dashboards

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { salesRecords, apps, countries } from '../db/schema.js';
import { eq, and, gte, lte, inArray, sql, desc } from 'drizzle-orm';

// Query params schema
const summaryQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  apiKeyIds: z.string().optional(), // Comma-separated
  limit: z.coerce.number().min(1).max(1000).default(100),
});

export async function summaryRoutes(fastify: FastifyInstance) {
  // Daily summaries for charts
  fastify.get('/api/summaries/daily', async (request) => {
    const query = summaryQuerySchema.parse(request.query);

    const conditions = [];
    if (query.startDate) conditions.push(gte(salesRecords.date, query.startDate));
    if (query.endDate) conditions.push(lte(salesRecords.date, query.endDate));
    if (query.apiKeyIds) {
      conditions.push(inArray(salesRecords.apiKeyId, query.apiKeyIds.split(',')));
    }

    const summaries = await db
      .select({
        date: salesRecords.date,
        totalRevenue: sql<number>`sum(${salesRecords.grossSalesUsdCents}) / 100.0`,
        totalUnits: sql<number>`sum(${salesRecords.netUnitsSold})::int`,
        recordCount: sql<number>`count(*)::int`,
      })
      .from(salesRecords)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(salesRecords.date)
      .orderBy(salesRecords.date)
      .limit(query.limit);

    return { summaries };
  });

  // App summaries
  fastify.get('/api/summaries/apps', async (request) => {
    const query = summaryQuerySchema.parse(request.query);

    const conditions = [];
    if (query.startDate) conditions.push(gte(salesRecords.date, query.startDate));
    if (query.endDate) conditions.push(lte(salesRecords.date, query.endDate));
    if (query.apiKeyIds) {
      conditions.push(inArray(salesRecords.apiKeyId, query.apiKeyIds.split(',')));
    }

    const summaries = await db
      .select({
        appId: salesRecords.appId,
        appName: apps.appName,
        totalRevenue: sql<number>`sum(${salesRecords.grossSalesUsdCents}) / 100.0`,
        totalUnits: sql<number>`sum(${salesRecords.netUnitsSold})::int`,
        recordCount: sql<number>`count(*)::int`,
        firstSale: sql<string>`min(${salesRecords.date})`,
        lastSale: sql<string>`max(${salesRecords.date})`,
      })
      .from(salesRecords)
      .leftJoin(apps, eq(salesRecords.appId, apps.appId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(salesRecords.appId, apps.appName)
      .orderBy(desc(sql`sum(${salesRecords.grossSalesUsdCents})`))
      .limit(query.limit);

    return { summaries };
  });

  // Country summaries
  fastify.get('/api/summaries/countries', async (request) => {
    const query = summaryQuerySchema.parse(request.query);

    const conditions = [];
    if (query.startDate) conditions.push(gte(salesRecords.date, query.startDate));
    if (query.endDate) conditions.push(lte(salesRecords.date, query.endDate));
    if (query.apiKeyIds) {
      conditions.push(inArray(salesRecords.apiKeyId, query.apiKeyIds.split(',')));
    }

    const summaries = await db
      .select({
        countryCode: salesRecords.countryCode,
        countryName: countries.countryName,
        region: countries.region,
        totalRevenue: sql<number>`sum(${salesRecords.grossSalesUsdCents}) / 100.0`,
        totalUnits: sql<number>`sum(${salesRecords.netUnitsSold})::int`,
        recordCount: sql<number>`count(*)::int`,
      })
      .from(salesRecords)
      .leftJoin(countries, eq(salesRecords.countryCode, countries.countryCode))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(salesRecords.countryCode, countries.countryName, countries.region)
      .orderBy(desc(sql`sum(${salesRecords.grossSalesUsdCents})`))
      .limit(query.limit);

    return { summaries };
  });

  // Monthly summaries
  fastify.get('/api/summaries/monthly', async (request) => {
    const query = summaryQuerySchema.parse(request.query);

    const conditions = [];
    if (query.startDate) conditions.push(gte(salesRecords.date, query.startDate));
    if (query.endDate) conditions.push(lte(salesRecords.date, query.endDate));
    if (query.apiKeyIds) {
      conditions.push(inArray(salesRecords.apiKeyId, query.apiKeyIds.split(',')));
    }

    const summaries = await db
      .select({
        month: sql<string>`to_char(${salesRecords.date}::date, 'YYYY-MM')`,
        totalRevenue: sql<number>`sum(${salesRecords.grossSalesUsdCents}) / 100.0`,
        totalUnits: sql<number>`sum(${salesRecords.netUnitsSold})::int`,
        recordCount: sql<number>`count(*)::int`,
        appCount: sql<number>`count(distinct ${salesRecords.appId})::int`,
        countryCount: sql<number>`count(distinct ${salesRecords.countryCode})::int`,
      })
      .from(salesRecords)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(sql`to_char(${salesRecords.date}::date, 'YYYY-MM')`)
      .orderBy(sql`to_char(${salesRecords.date}::date, 'YYYY-MM')`)
      .limit(query.limit);

    return { summaries };
  });

  // Lookup data for filters
  fastify.get('/api/lookups/apps', async () => {
    const appList = await db
      .select({
        appId: apps.appId,
        appName: apps.appName,
      })
      .from(apps)
      .orderBy(apps.appName);

    return { apps: appList };
  });

  fastify.get('/api/lookups/countries', async () => {
    const countryList = await db
      .select({
        countryCode: countries.countryCode,
        countryName: countries.countryName,
        region: countries.region,
      })
      .from(countries)
      .orderBy(countries.countryName);

    return { countries: countryList };
  });
}
