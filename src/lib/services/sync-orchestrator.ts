// Sync orchestrator for coordinating multi-key Steam sales data synchronization
// Manages session state for pause/resume functionality

import type { FetchProgress, ApiKeyInfo } from './types';
import { services } from './index';

// Session state for tracking sync progress across pause/resume
// This is cleared when the modal is closed, ensuring fresh starts work correctly
export interface KeySyncState {
  sortedDates: string[]; // Full list of all dates for this key
  processedDates: Set<string>; // Dates completed in this session
  newHighwatermark: number; // HWM to save on success
  apiKey: string; // The actual API key value
  newDates: number; // Count of new dates (Phase 1)
  reprocessDates: number; // Count of update dates (Phase 2)
  phase1Dates: string[]; // New dates (Phase 1) - processed first
  phase2Dates: string[]; // Update dates (Phase 2) - processed after all Phase 1
}

export interface KeySegment {
  keyId: string;
  keyName: string;
  newDates: number;
  reprocessDates: number;
}

export interface SyncSessionState {
  keyStates: Map<string, KeySyncState>; // Keyed by apiKeyId
  keySegments: KeySegment[];
  totalDates: number;
  totalRecordsFetched: number;
}

export type SyncProgress = FetchProgress & { phase: FetchProgress['phase'] | 'cancelled' };

export interface SyncCallbacks {
  onProgress: (progress: SyncProgress) => void;
  getAbortSignal: () => AbortSignal | undefined;
}

/**
 * Create a new empty sync session state
 */
export function createSyncSessionState(): SyncSessionState {
  return {
    keyStates: new Map(),
    keySegments: [],
    totalDates: 0,
    totalRecordsFetched: 0,
  };
}

/**
 * Get total processed dates across all keys in a session
 */
export function getTotalProcessedDates(state: SyncSessionState): number {
  let count = 0;
  for (const [, keyState] of state.keyStates) {
    count += keyState.processedDates.size;
  }
  return count;
}

/**
 * Fetch changed dates for all API keys and build session state
 */
export async function fetchChangedDatesForAllKeys(
  apiKeys: ApiKeyInfo[],
  sessionState: SyncSessionState,
  callbacks: SyncCallbacks
): Promise<{ totalDates: number; totalReprocessDates: number }> {
  let totalDatesAcrossAllKeys = 0;
  let totalDatesToReprocess = 0;
  const keySegments: KeySegment[] = [];

  for (let i = 0; i < apiKeys.length; i++) {
    const keyInfo = apiKeys[i];
    const apiKey = await services.getApiKey(keyInfo.id);

    if (!apiKey) continue;

    // Check if cancelled
    if (callbacks.getAbortSignal()?.aborted) {
      throw new Error('SyncCancelledError');
    }

    const { dates, newHighwatermark } = await services.getChangedDates(apiKey, keyInfo.id);

    // Get existing dates to calculate re-processing count
    const existingDates = await services.getExistingDates(keyInfo.id);

    // Separate dates into Phase 1 (new) and Phase 2 (updates)
    const newDates = dates.filter((d) => !existingDates.has(d));
    const updateDates = dates.filter((d) => existingDates.has(d));

    // Sort each phase chronologically
    newDates.sort((a, b) => a.localeCompare(b));
    updateDates.sort((a, b) => a.localeCompare(b));

    totalDatesToReprocess += updateDates.length;
    totalDatesAcrossAllKeys += dates.length;

    const keyName = keyInfo.displayName || `Key ...${keyInfo.keyHash}`;

    // Store in session state - keep phases separate for ordered processing
    sessionState.keyStates.set(keyInfo.id, {
      sortedDates: dates, // Keep full list for tracking
      processedDates: new Set(),
      newHighwatermark,
      apiKey,
      newDates: newDates.length,
      reprocessDates: updateDates.length,
      phase1Dates: newDates, // New dates - processed first
      phase2Dates: updateDates, // Update dates - processed after all Phase 1
    });

    keySegments.push({
      keyId: keyInfo.id,
      keyName,
      newDates: newDates.length,
      reprocessDates: updateDates.length,
    });

    callbacks.onProgress({
      phase: 'dates',
      message: `Checking API key ${i + 1} of ${apiKeys.length}...`,
      current: i + 1,
      total: apiKeys.length,
      recordsFetched: 0,
      currentKeyId: keyInfo.id,
      currentKeyName: keyName,
      currentKeyIndex: i,
      totalKeys: apiKeys.length,
      datesToReprocess: totalDatesToReprocess,
      keySegments: [...keySegments],
    });
  }

  // Update session state with final counts
  sessionState.keySegments = keySegments;
  sessionState.totalDates = totalDatesAcrossAllKeys;

  return { totalDates: totalDatesAcrossAllKeys, totalReprocessDates: totalDatesToReprocess };
}

/**
 * Process dates for a specific key and phase
 */
export async function processDatesForKey(
  keyId: string,
  datesToProcess: string[],
  phaseLabel: string,
  sessionState: SyncSessionState,
  totalDatesAcrossAllKeys: number,
  totalDatesToReprocess: number,
  callbacks: SyncCallbacks
): Promise<void> {
  const keyState = sessionState.keyStates.get(keyId);
  if (!keyState || datesToProcess.length === 0) return;

  const segment = sessionState.keySegments.find((s) => s.keyId === keyId);
  if (!segment) return;

  const keyName = segment.keyName;

  // Filter out already processed dates
  const remainingDates = datesToProcess.filter((d) => !keyState.processedDates.has(d));
  if (remainingDates.length === 0) return;

  // Capture the record count BEFORE starting this fetch call
  const recordsBeforeThisFetch = sessionState.totalRecordsFetched;

  // Fetch data from Steam API
  await services.fetchSalesData({
    apiKey: keyState.apiKey,
    apiKeyId: keyId,
    signal: callbacks.getAbortSignal(),
    datesToFetch: remainingDates,
    onProgress: (progress) => {
      // Use processedDates.size as the authoritative count
      const totalProcessed = getTotalProcessedDates(sessionState);

      // progress.recordsFetched is cumulative within THIS fetch call
      const totalRecordsFetched = recordsBeforeThisFetch + (progress.recordsFetched ?? 0);

      // Update session state so it's correct if user pauses
      sessionState.totalRecordsFetched = totalRecordsFetched;

      callbacks.onProgress({
        ...progress,
        message: `${phaseLabel}: Fetching sales data...`,
        current: totalProcessed,
        total: totalDatesAcrossAllKeys,
        recordsFetched: totalRecordsFetched,
        currentKeyId: keyId,
        currentKeyName: keyName,
        totalKeys: sessionState.keySegments.length,
        datesToReprocess: totalDatesToReprocess,
        keySegments: sessionState.keySegments,
      });
    },
    onDateProcessed: (date: string) => {
      // Track this date as processed in session state
      keyState.processedDates.add(date);
    },
  });
}

/**
 * Run the full sync process for all keys
 */
export async function runSync(
  apiKeys: ApiKeyInfo[],
  sessionState: SyncSessionState,
  callbacks: SyncCallbacks,
  isResuming: boolean
): Promise<{ totalRecords: number }> {
  let totalDatesAcrossAllKeys: number;
  let totalDatesToReprocess: number;

  if (isResuming) {
    // SCENARIO A: Resume from pause - use cached session state
    totalDatesAcrossAllKeys = sessionState.totalDates;
    totalDatesToReprocess = sessionState.keySegments.reduce((sum, k) => sum + k.reprocessDates, 0);

    // Calculate current progress from processed dates
    const processedCount = getTotalProcessedDates(sessionState);

    callbacks.onProgress({
      phase: 'sales',
      message: 'Resuming sync...',
      current: processedCount,
      total: totalDatesAcrossAllKeys,
      recordsFetched: sessionState.totalRecordsFetched,
      keySegments: sessionState.keySegments,
    });
  } else {
    // SCENARIO B: Fresh start - fetch dates from Steam API
    callbacks.onProgress({
      phase: 'dates',
      message: 'Checking for updates across all API keys...',
      current: 0,
      total: apiKeys.length,
      recordsFetched: 0,
    });

    const result = await fetchChangedDatesForAllKeys(apiKeys, sessionState, callbacks);
    totalDatesAcrossAllKeys = result.totalDates;
    totalDatesToReprocess = result.totalReprocessDates;
  }

  // If no dates to process, we're done
  if (totalDatesAcrossAllKeys === 0) {
    callbacks.onProgress({
      phase: 'complete',
      message: 'Already up to date!',
      current: 0,
      total: 0,
      recordsFetched: 0,
    });
    return { totalRecords: 0 };
  }

  // PHASE 1: Process all NEW dates across all keys first
  for (const segment of sessionState.keySegments) {
    const keyState = sessionState.keyStates.get(segment.keyId);
    if (!keyState) continue;

    if (callbacks.getAbortSignal()?.aborted) {
      throw new Error('SyncCancelledError');
    }

    if (keyState.phase1Dates.length > 0) {
      await processDatesForKey(
        segment.keyId,
        keyState.phase1Dates,
        'Phase 1 (New Data)',
        sessionState,
        totalDatesAcrossAllKeys,
        totalDatesToReprocess,
        callbacks
      );
    }
  }

  // PHASE 2: Process all UPDATE dates across all keys
  for (const segment of sessionState.keySegments) {
    const keyState = sessionState.keyStates.get(segment.keyId);
    if (!keyState) continue;

    if (callbacks.getAbortSignal()?.aborted) {
      throw new Error('SyncCancelledError');
    }

    if (keyState.phase2Dates.length > 0) {
      await processDatesForKey(
        segment.keyId,
        keyState.phase2Dates,
        'Phase 2 (Updates)',
        sessionState,
        totalDatesAcrossAllKeys,
        totalDatesToReprocess,
        callbacks
      );
    }

    // Save highwatermark AFTER all dates for this key are processed
    if (keyState.processedDates.size === keyState.sortedDates.length) {
      const keyInfo = apiKeys.find((k) => k.id === segment.keyId);
      if (keyInfo) {
        const currentHighwatermark = await services.getHighwatermark(keyInfo.id);
        if (keyState.newHighwatermark > currentHighwatermark) {
          await services.setHighwatermark(keyInfo.id, keyState.newHighwatermark);
        }
      }
    }
  }

  return { totalRecords: sessionState.totalRecordsFetched };
}

/**
 * Check if an error represents a cancellation
 */
export function isCancellationError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'SyncCancelledError' ||
      err.name === 'AbortError' ||
      err.message === 'SyncCancelledError')
  );
}
