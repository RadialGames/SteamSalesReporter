/**
 * Table pagination and sorting state management hook
 * Provides reusable state and utilities for table components
 */

export type SortDirection = 'asc' | 'desc';

export interface TableState<T extends string> {
  sortField: T;
  sortDirection: SortDirection;
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalRecords: number;
}

export interface TableStateOptions {
  initialSortField?: string;
  initialSortDirection?: SortDirection;
  pageSize?: number;
}

/**
 * Hook for managing table pagination and sorting state
 */
export function useTableState<T extends string>(
  totalRecords: number,
  options: TableStateOptions = {}
): TableState<T> & {
  setSortField: (field: T) => void;
  toggleSort: (field: T) => void;
  setPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  getSortIcon: (field: T) => string;
} {
  const { initialSortField = '', initialSortDirection = 'desc', pageSize = 25 } = options;

  const state = $state<TableState<T>>({
    sortField: initialSortField as T,
    sortDirection: initialSortDirection,
    currentPage: 1,
    pageSize,
    totalPages: Math.ceil(totalRecords / pageSize),
    totalRecords,
  });

  // Update total pages when total records change
  $effect(() => {
    state.totalPages = Math.ceil(totalRecords / state.pageSize);
    state.totalRecords = totalRecords;
    // Reset to page 1 if current page is out of bounds
    if (state.currentPage > state.totalPages && state.totalPages > 0) {
      state.currentPage = 1;
    }
  });

  function setSortField(field: T) {
    if (state.sortField === field) {
      state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortField = field;
      state.sortDirection = 'desc';
    }
    state.currentPage = 1; // Reset to first page on sort change
  }

  function toggleSort(field: T) {
    setSortField(field);
  }

  function setPage(page: number) {
    if (page >= 1 && page <= state.totalPages) {
      state.currentPage = page;
    }
  }

  function nextPage() {
    if (state.currentPage < state.totalPages) {
      state.currentPage++;
    }
  }

  function prevPage() {
    if (state.currentPage > 1) {
      state.currentPage--;
    }
  }

  function getSortIcon(field: T): string {
    if (state.sortField !== field) return '&#8693;'; // Up-down arrows
    return state.sortDirection === 'asc' ? '&#9650;' : '&#9660;'; // Up or down arrow
  }

  return {
    ...state,
    setSortField,
    toggleSort,
    setPage,
    nextPage,
    prevPage,
    getSortIcon,
  };
}
