// Steam API client for Electron main process
// Makes direct HTTP requests without CORS restrictions

import type { SalesRecord, FetchParams, SteamChangedDatesResponse, SteamDetailedSalesResponse } from '../../src/lib/services/types';
import { getHighwatermark, setHighwatermark } from './database';

const STEAM_API_BASE = 'https://partner.steamgames.com/webapi';

async function fetchFromSteamApi<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const queryString = new URLSearchParams(params).toString();
  const url = `${STEAM_API_BASE}/${endpoint}?${queryString}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Steam API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

export async function fetchSalesDataFromSteam(params: FetchParams): Promise<SalesRecord[]> {
  const { apiKey } = params;
  const allSales: SalesRecord[] = [];
  
  // Get current highwatermark
  const highwatermark = getHighwatermark();
  
  // First, get changed dates
  const changedDatesResponse = await fetchFromSteamApi<SteamChangedDatesResponse>(
    'IPartnerFinancialsService/GetChangedDatesForPartner/v1',
    {
      key: apiKey,
      highwatermark: highwatermark.toString()
    }
  );
  
  const dates = changedDatesResponse.response?.dates || [];
  const newHighwatermark = changedDatesResponse.response?.result_highwatermark || highwatermark;
  
  // For each date, fetch detailed sales
  for (const date of dates) {
    let pageHighwatermark = 0;
    let hasMore = true;
    
    while (hasMore) {
      const salesResponse = await fetchFromSteamApi<SteamDetailedSalesResponse>(
        'IPartnerFinancialsService/GetDetailedSales/v1',
        {
          key: apiKey,
          date,
          highwatermark_id: pageHighwatermark.toString()
        }
      );
      
      const sales = salesResponse.response?.sales || [];
      const maxId = salesResponse.response?.max_id || 0;
      
      // Convert Steam API format to our format
      for (const sale of sales) {
        allSales.push({
          date: sale.date,
          appId: sale.appid,
          appName: sale.app_name,
          packageId: sale.packageid,
          countryCode: sale.country_code,
          unitsSold: sale.units_sold,
          grossRevenue: sale.gross_steam_revenue_usd,
          netRevenue: sale.net_steam_revenue_usd,
          currency: sale.currency || 'USD'
        });
      }
      
      // Check if there's more data
      hasMore = maxId > pageHighwatermark && sales.length > 0;
      pageHighwatermark = maxId;
    }
  }
  
  // Update highwatermark after successful fetch
  if (newHighwatermark > highwatermark) {
    setHighwatermark(newHighwatermark);
  }
  
  return allSales;
}

// Validate API key by making a test request
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    await fetchFromSteamApi<SteamChangedDatesResponse>(
      'IPartnerFinancialsService/GetChangedDatesForPartner/v1',
      {
        key: apiKey,
        highwatermark: '0'
      }
    );
    return true;
  } catch {
    return false;
  }
}
