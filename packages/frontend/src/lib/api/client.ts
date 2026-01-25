// API client for communicating with the backend

const API_BASE = '/api';

// Error class for API errors
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Generic fetch wrapper
async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let details;
    try {
      details = await response.json();
    } catch {
      // Ignore JSON parse errors
    }
    throw new ApiError(
      details?.error || `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      details
    );
  }

  return response.json();
}

// ==================== API Key Management ====================

export interface ApiKeyInfo {
  id: string;
  displayName: string;
  keyHash: string;
  createdAt: string;
}

export async function getApiKeys(): Promise<ApiKeyInfo[]> {
  const { keys } = await fetchApi<{ keys: ApiKeyInfo[] }>('/keys');
  return keys;
}

export async function addApiKey(key: string, displayName?: string): Promise<ApiKeyInfo> {
  const { key: newKey } = await fetchApi<{ key: ApiKeyInfo }>('/keys', {
    method: 'POST',
    body: JSON.stringify({ key, displayName }),
  });
  return newKey;
}

export async function updateApiKey(id: string, displayName: string): Promise<ApiKeyInfo> {
  const { key } = await fetchApi<{ key: ApiKeyInfo }>(`/keys/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ displayName }),
  });
  return key;
}

export async function deleteApiKey(id: string): Promise<void> {
  await fetchApi(`/keys/${id}`, { method: 'DELETE' });
}

// ==================== Sync ====================

export interface SyncProgress {
  phase: 'discovery' | 'populate' | 'complete' | 'error';
  message: string;
  totalTasks?: number;
  completedTasks?: number;
  currentDate?: string;
  recordsProcessed?: number;
  error?: string;
}

export async function startSync(apiKeyIds?: string[]): Promise<{ syncId: string }> {
  return fetchApi('/sync/start', {
    method: 'POST',
    body: JSON.stringify({ apiKeyIds }),
  });
}

export async function getSyncStatus(syncId: string): Promise<SyncProgress> {
  const { progress } = await fetchApi<{ progress: SyncProgress }>(`/sync/status/${syncId}`);
  return progress;
}

export async function getSyncTasks(): Promise<Record<string, {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
}>> {
  const { tasks } = await fetchApi<{ tasks: Record<string, any> }>('/sync/tasks');
  return tasks;
}

// ==================== Sales Data ====================

export interface SalesRecord {
  id: number;
  date: string;
  lineItemType: string;
  appId: number | null;
  appName: string | null;
  packageId: number | null;
  packageName: string | null;
  countryCode: string | null;
  countryName: string | null;
  region: string | null;
  platform: string | null;
  currency: string | null;
  grossUnitsSold: number;
  grossUnitsReturned: number;
  netUnitsSold: number;
  grossSalesUsd: number;
  netSalesUsd: number;
  discountPercentage: number | null;
}

export interface SalesQueryParams {
  startDate?: string;
  endDate?: string;
  apiKeyIds?: string[];
  appIds?: number[];
  countryCode?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'date' | 'revenue' | 'units';
  sortOrder?: 'asc' | 'desc';
}

export interface SalesResponse {
  records: SalesRecord[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export async function getSales(params: SalesQueryParams = {}): Promise<SalesResponse> {
  const query = new URLSearchParams();
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.apiKeyIds?.length) query.set('apiKeyIds', params.apiKeyIds.join(','));
  if (params.appIds?.length) query.set('appIds', params.appIds.join(','));
  if (params.countryCode) query.set('countryCode', params.countryCode);
  if (params.limit) query.set('limit', params.limit.toString());
  if (params.offset) query.set('offset', params.offset.toString());
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);

  return fetchApi(`/sales?${query}`);
}

// ==================== Stats & Summaries ====================

export interface DashboardStats {
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
  appCount: number;
  countryCount: number;
  dateRange: { min: string; max: string } | null;
}

export async function getStats(params: SalesQueryParams = {}): Promise<DashboardStats> {
  const query = new URLSearchParams();
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.apiKeyIds?.length) query.set('apiKeyIds', params.apiKeyIds.join(','));

  const { stats } = await fetchApi<{ stats: DashboardStats }>(`/stats?${query}`);
  return stats;
}

export interface DailySummary {
  date: string;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
}

export async function getDailySummaries(params: SalesQueryParams = {}): Promise<DailySummary[]> {
  const query = new URLSearchParams();
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.apiKeyIds?.length) query.set('apiKeyIds', params.apiKeyIds.join(','));
  if (params.limit) query.set('limit', params.limit.toString());

  const { summaries } = await fetchApi<{ summaries: DailySummary[] }>(`/summaries/daily?${query}`);
  return summaries;
}

export interface AppSummary {
  appId: number;
  appName: string | null;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
  firstSale: string;
  lastSale: string;
}

export async function getAppSummaries(params: SalesQueryParams = {}): Promise<AppSummary[]> {
  const query = new URLSearchParams();
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.apiKeyIds?.length) query.set('apiKeyIds', params.apiKeyIds.join(','));
  if (params.limit) query.set('limit', params.limit.toString());

  const { summaries } = await fetchApi<{ summaries: AppSummary[] }>(`/summaries/apps?${query}`);
  return summaries;
}

export interface CountrySummary {
  countryCode: string;
  countryName: string | null;
  region: string | null;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
}

export async function getCountrySummaries(params: SalesQueryParams = {}): Promise<CountrySummary[]> {
  const query = new URLSearchParams();
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.apiKeyIds?.length) query.set('apiKeyIds', params.apiKeyIds.join(','));
  if (params.limit) query.set('limit', params.limit.toString());

  const { summaries } = await fetchApi<{ summaries: CountrySummary[] }>(`/summaries/countries?${query}`);
  return summaries;
}

// ==================== Lookups ====================

export interface AppLookup {
  appId: number;
  appName: string;
}

export async function getAppsLookup(): Promise<AppLookup[]> {
  const { apps } = await fetchApi<{ apps: AppLookup[] }>('/lookups/apps');
  return apps;
}

export interface CountryLookup {
  countryCode: string;
  countryName: string;
  region: string | null;
}

export async function getCountriesLookup(): Promise<CountryLookup[]> {
  const { countries } = await fetchApi<{ countries: CountryLookup[] }>('/lookups/countries');
  return countries;
}

// ==================== Health Check ====================

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  database: 'connected' | 'disconnected';
  timestamp: string;
}

export async function checkHealth(): Promise<HealthStatus> {
  return fetchApi('/health');
}
