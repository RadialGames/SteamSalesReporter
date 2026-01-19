// Service abstraction layer

import type { SalesService } from './types';
import type { SyncTaskService } from './sync-tasks';
import { browserServices, browserSyncTaskService } from './browser';

export type { SalesService, SalesRecord, FetchParams, Filters, ApiKeyInfo } from './types';
export type { DailySummary, AppSummary, CountrySummary } from './types';
export type { SyncPhase, SyncProgress, KeySegment } from './types';
export type { SyncTask, SyncTaskService } from './sync-tasks';
export { createTaskId, parseTaskId } from './sync-tasks';

/**
 * The services object provides a unified interface for:
 * - API key management
 * - Steam API data fetching
 * - Local database operations
 *
 * Uses IndexedDB for storage and fetch API for network requests
 */
export const services: SalesService = browserServices;

/**
 * Sync task service for managing the task queue.
 * Provides crash recovery and progress tracking for data sync.
 */
export const syncTaskService: SyncTaskService = browserSyncTaskService;
