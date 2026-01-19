// Service abstraction layer

import type { SalesService } from './types';
import { browserServices } from './browser';

export type { SalesService, SalesRecord, FetchParams, Filters, ApiKeyInfo } from './types';
export type { DailySummary, AppSummary, CountrySummary } from './types';

/**
 * The services object provides a unified interface for:
 * - API key management
 * - Steam API data fetching
 * - Local database operations
 * 
 * Uses IndexedDB for storage and fetch API for network requests
 */
export const services: SalesService = browserServices;
