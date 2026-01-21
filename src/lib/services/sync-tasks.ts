// Sync task queue service
// Provides persistent task tracking for crash recovery and progress reporting

/**
 * Sync task for tracking date processing in the task queue.
 * Used for crash recovery and progress tracking.
 */
export interface SyncTask {
  id: string; // Composite key: `${apiKeyId}|${date}`
  apiKeyId: string;
  date: string;
  status: 'todo' | 'in_progress' | 'done';
  createdAt: number;
  completedAt?: number;
}

/**
 * Create a task ID from apiKeyId and date
 */
export function createTaskId(apiKeyId: string, date: string): string {
  return `${apiKeyId}|${date}`;
}

/**
 * Parse a task ID back to apiKeyId and date
 */
export function parseTaskId(taskId: string): { apiKeyId: string; date: string } {
  const [apiKeyId, date] = taskId.split('|');
  return { apiKeyId, date };
}

/**
 * Sync task service interface.
 * Implementations exist for browser (Dexie) and Tauri (SQLite) modes.
 */
export interface SyncTaskService {
  /**
   * Create TODO entries for changed dates.
   * Deletes existing sales data for these dates and replaces any existing sync tasks.
   */
  createSyncTasks(apiKeyId: string, dates: string[]): Promise<void>;

  /**
   * Get all pending tasks (status = 'todo' or 'in_progress')
   */
  getPendingTasks(): Promise<SyncTask[]>;

  /**
   * Get pending tasks for a specific API key
   */
  getPendingTasksForKey(apiKeyId: string): Promise<SyncTask[]>;

  /**
   * Mark a task as in_progress (for crash recovery tracking)
   */
  markTaskInProgress(taskId: string): Promise<void>;

  /**
   * Mark a task as done
   */
  markTaskDone(taskId: string): Promise<void>;

  /**
   * Count pending tasks per API key
   * Returns a map of apiKeyId -> count
   */
  countPendingTasks(): Promise<Map<string, number>>;

  /**
   * Get total count of pending tasks
   */
  countAllPendingTasks(): Promise<number>;

  /**
   * Reset all in_progress tasks to todo (for crash recovery)
   * Returns the number of tasks reset
   */
  resetInProgressTasks(): Promise<number>;

  /**
   * Clear all completed tasks (cleanup)
   */
  clearCompletedTasks(): Promise<void>;

  /**
   * Clear ALL sync tasks (used after bulk processing)
   */
  clearAllSyncTasks(): Promise<void>;

  /**
   * Delete all sync tasks for a specific API key
   */
  deleteSyncTasksForKey(apiKeyId: string): Promise<void>;

  /**
   * Clear sales data for a specific date and API key
   */
  clearSalesForDate(apiKeyId: string, date: string): Promise<void>;
}
