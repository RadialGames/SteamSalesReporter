// Common progress handling utilities

export interface ProgressCallback {
  (progress: {
    phase: string;
    message: string;
    current?: number;
    total?: number;
    currentDate?: string;
    recordsFetched?: number;
    totalTasks?: number;
    completedTasks?: number;
    keySegments?: string[];
    error?: string;
  }): void;
}

export interface ProgressState {
  phase: string;
  message: string;
  current?: number;
  total?: number;
  currentDate?: string;
  recordsFetched?: number;
  totalTasks?: number;
  completedTasks?: number;
  keySegments?: string[];
  error?: string;
}

/**
 * Creates a progress state manager
 */
export function createProgressState(initialState: Partial<ProgressState> = {}): ProgressState & {
  update: (updates: Partial<ProgressState>) => void;
  reset: () => void;
  getCallback: () => ProgressCallback;
} {
  let state = $state<ProgressState>({
    phase: 'init',
    message: 'Initializing...',
    ...initialState,
  });

  return {
    get phase() {
      return state.phase;
    },
    get message() {
      return state.message;
    },
    get current() {
      return state.current;
    },
    get total() {
      return state.total;
    },
    get currentDate() {
      return state.currentDate;
    },
    get recordsFetched() {
      return state.recordsFetched;
    },
    get totalTasks() {
      return state.totalTasks;
    },
    get completedTasks() {
      return state.completedTasks;
    },
    get keySegments() {
      return state.keySegments;
    },
    get error() {
      return state.error;
    },
    update: (updates: Partial<ProgressState>) => {
      Object.assign(state, updates);
    },
    reset: () => {
      state = {
        phase: 'init',
        message: 'Initializing...',
        ...initialState,
      };
    },
    getCallback: (): ProgressCallback => {
      return (progress) => {
        Object.assign(state, progress);
      };
    },
  };
}

/**
 * Progress phase constants
 */
export const ProgressPhases = {
  INIT: 'init',
  DATES: 'dates',
  SALES: 'sales',
  AGGREGATES: 'aggregates',
  COMPLETE: 'complete',
  ERROR: 'error',
  CANCELLED: 'cancelled',
} as const;

export type ProgressPhase = (typeof ProgressPhases)[keyof typeof ProgressPhases];
