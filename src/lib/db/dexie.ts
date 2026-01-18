// IndexedDB database using Dexie.js
// Used in browser development mode

import Dexie, { type EntityTable } from 'dexie';
import type { SalesRecord, SyncMeta } from '$lib/services/types';

// Extend Dexie with our tables
class SteamSalesDB extends Dexie {
  sales!: EntityTable<SalesRecord, 'id'>;
  syncMeta!: EntityTable<SyncMeta, 'key'>;

  constructor() {
    super('SteamSalesDB');
    
    this.version(1).stores({
      // Define indexes for efficient querying
      // id is auto-incremented, we index date, appId for filtering
      sales: '++id, date, appId, packageId, countryCode, [date+appId+packageId+countryCode]',
      syncMeta: 'key'
    });
  }
}

export const db = new SteamSalesDB();

// Helper functions for common operations
export async function clearAllData(): Promise<void> {
  await db.sales.clear();
  await db.syncMeta.clear();
}

export async function getUniqueApps(): Promise<{ appId: number; appName: string }[]> {
  const sales = await db.sales.toArray();
  const uniqueApps = new Map<number, string>();
  
  for (const sale of sales) {
    if (!uniqueApps.has(sale.appId)) {
      uniqueApps.set(sale.appId, sale.appName || `App ${sale.appId}`);
    }
  }
  
  return Array.from(uniqueApps.entries()).map(([appId, appName]) => ({
    appId,
    appName
  }));
}

export async function getUniqueCountries(): Promise<string[]> {
  const sales = await db.sales.toArray();
  const countries = new Set<string>();
  
  for (const sale of sales) {
    countries.add(sale.countryCode);
  }
  
  return Array.from(countries).sort();
}

export async function getDateRange(): Promise<{ min: string; max: string } | null> {
  const sales = await db.sales.orderBy('date').toArray();
  
  if (sales.length === 0) {
    return null;
  }
  
  return {
    min: sales[0].date,
    max: sales[sales.length - 1].date
  };
}
