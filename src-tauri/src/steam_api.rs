use crate::types::{
    FetchResult, SalesRecord, SteamChangedDatesResponse, SteamDetailedSalesResponse,
};
use std::collections::{HashMap, HashSet};
use std::fmt::Write;
use thiserror::Error;

/// Generate a unique key from Steam API's unique identifying fields.
/// This creates a deterministic string key that uniquely identifies each sales record.
/// Must match the TypeScript implementation in steam-transform.ts
fn generate_unique_key(record: &SalesRecord) -> String {
    let mut key = String::new();
    
    // Always present fields (in consistent order)
    write!(key, "{}|", record.partnerid.map(|v| v.to_string()).unwrap_or_default()).ok();
    write!(key, "{}|", record.date).ok();
    write!(key, "{}|", record.line_item_type).ok();
    write!(key, "{}|", record.platform.as_deref().unwrap_or("")).ok();
    write!(key, "{}|", record.country_code).ok();
    write!(key, "{}|", record.currency.as_deref().unwrap_or("")).ok();
    write!(key, "{}|", record.api_key_id).ok();
    
    // Package-specific fields
    write!(key, "{}|", record.packageid.map(|v| v.to_string()).unwrap_or_default()).ok();
    write!(key, "{}|", record.bundleid.map(|v| v.to_string()).unwrap_or_default()).ok();
    write!(key, "{}|", record.package_sale_type.as_deref().unwrap_or("")).ok();
    write!(key, "{}|", record.key_request_id.map(|v| v.to_string()).unwrap_or_default()).ok();
    write!(key, "{}|", record.base_price.as_deref().unwrap_or("")).ok();
    write!(key, "{}|", record.sale_price.as_deref().unwrap_or("")).ok();
    
    // MicroTxn-specific fields
    write!(key, "{}|", record.appid.map(|v| v.to_string()).unwrap_or_default()).ok();
    write!(key, "{}|", record.game_item_id.map(|v| v.to_string()).unwrap_or_default()).ok();
    
    // Optional fields
    write!(key, "{}", record.combined_discount_id.map(|v| v.to_string()).unwrap_or_default()).ok();
    
    key
}

const STEAM_API_BASE: &str = "https://partner.steamgames.com/webapi";
const PARALLEL_BATCH_SIZE: usize = 3;

#[derive(Error, Debug)]
pub enum SteamApiError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API error: {0}")]
    Api(String),
}

pub struct SteamApi {
    client: reqwest::Client,
}

impl SteamApi {
    pub fn new() -> Self {
        SteamApi {
            client: reqwest::Client::new(),
        }
    }

    async fn fetch_from_steam<T: serde::de::DeserializeOwned>(
        &self,
        endpoint: &str,
        params: &[(&str, &str)],
    ) -> Result<T, SteamApiError> {
        let url = format!("{}/{}?{}", STEAM_API_BASE, endpoint, 
            params.iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect::<Vec<_>>()
                .join("&")
        );

        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(SteamApiError::Api(format!(
                "Steam API error: {} {}",
                response.status(),
                response.status().canonical_reason().unwrap_or("Unknown")
            )));
        }

        Ok(response.json().await?)
    }

    async fn fetch_sales_for_date(
        &self,
        api_key: &str,
        api_key_id: &str,
        date: &str,
    ) -> Result<Vec<SalesRecord>, SteamApiError> {
        let mut date_sales: Vec<SalesRecord> = Vec::new();
        let mut page_highwatermark: i64 = 0;
        let mut has_more = true;

        while has_more {
            let hwm_str = page_highwatermark.to_string();
            let response: SteamDetailedSalesResponse = self
                .fetch_from_steam(
                    "IPartnerFinancialsService/GetDetailedSales/v1",
                    &[
                        ("key", api_key),
                        ("date", date),
                        ("highwatermark_id", &hwm_str),
                    ],
                )
                .await?;

            let results = &response.response.results;
            let max_id: i64 = response
                .response
                .max_id
                .as_deref()
                .unwrap_or("0")
                .parse()
                .unwrap_or(0);

            // Build lookup maps
            let app_name_map: HashMap<i64, String> = response
                .response
                .app_info
                .iter()
                .map(|a| (a.appid, a.app_name.clone()))
                .collect();

            let package_name_map: HashMap<i64, String> = response
                .response
                .package_info
                .iter()
                .map(|p| (p.packageid, p.package_name.clone()))
                .collect();

            let bundle_name_map: HashMap<i64, String> = response
                .response
                .bundle_info
                .iter()
                .map(|b| (b.bundleid, b.bundle_name.clone()))
                .collect();

            let partner_name_map: HashMap<i64, String> = response
                .response
                .partner_info
                .iter()
                .map(|p| (p.partnerid, p.partner_name.clone()))
                .collect();

            let country_info_map: HashMap<String, (String, String)> = response
                .response
                .country_info
                .iter()
                .map(|c| {
                    (
                        c.country_code.clone(),
                        (c.country_name.clone(), c.region.clone()),
                    )
                })
                .collect();

            // Convert Steam API format to our format
            for item in results {
                let primary_appid = item.primary_appid.or(item.appid).unwrap_or(0);
                let gross_sales_usd = item
                    .gross_sales_usd
                    .as_ref()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0.0);
                let gross_returns_usd = item
                    .gross_returns_usd
                    .as_ref()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0.0);
                let net_sales_usd = item
                    .net_sales_usd
                    .as_ref()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0.0);
                let net_tax_usd = item
                    .net_tax_usd
                    .as_ref()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0.0);
                let units_sold = item
                    .net_units_sold
                    .or(item.gross_units_sold)
                    .or(item.gross_units_activated)
                    .unwrap_or(0);

                let country_info = country_info_map.get(&item.country_code);

                let mut record = SalesRecord {
                    id: None, // Will be set to unique key below
                    api_key_id: api_key_id.to_string(),
                    date: item.date.clone(),
                    line_item_type: item.line_item_type.clone(),
                    partnerid: item.partnerid,
                    primary_appid: Some(primary_appid),
                    packageid: item.packageid,
                    bundleid: item.bundleid,
                    appid: item.appid,
                    game_item_id: item.game_item_id,
                    country_code: item.country_code.clone(),
                    platform: item.platform.clone(),
                    currency: item.currency.clone(),
                    base_price: item.base_price.clone(),
                    sale_price: item.sale_price.clone(),
                    avg_sale_price_usd: item.avg_sale_price_usd.clone(),
                    package_sale_type: item.package_sale_type.clone(),
                    gross_units_sold: item.gross_units_sold,
                    gross_units_returned: item.gross_units_returned,
                    gross_units_activated: item.gross_units_activated,
                    net_units_sold: item.net_units_sold,
                    gross_sales_usd: Some(gross_sales_usd),
                    gross_returns_usd: Some(gross_returns_usd),
                    net_sales_usd: Some(net_sales_usd),
                    net_tax_usd: Some(net_tax_usd),
                    combined_discount_id: item.combined_discount_id,
                    total_discount_percentage: item.total_discount_percentage,
                    additional_revenue_share_tier: item.additional_revenue_share_tier,
                    key_request_id: item.key_request_id,
                    viw_grant_partnerid: item.viw_grant_partnerid,
                    app_name: app_name_map.get(&primary_appid).cloned(),
                    package_name: item.packageid.and_then(|id| package_name_map.get(&id).cloned()),
                    bundle_name: item.bundleid.and_then(|id| bundle_name_map.get(&id).cloned()),
                    partner_name: item.partnerid.and_then(|id| partner_name_map.get(&id).cloned()),
                    country_name: country_info.map(|(name, _)| name.clone()),
                    region: country_info.map(|(_, region)| region.clone()),
                    game_item_description: None,
                    game_item_category: None,
                    key_request_notes: None,
                    game_code_description: None,
                    combined_discount_name: None,
                    app_id: primary_appid,
                    units_sold,
                };
                
                // Generate and set the unique key as the id (primary key)
                record.id = Some(generate_unique_key(&record));
                date_sales.push(record);
            }

            has_more = max_id > page_highwatermark && !results.is_empty();
            page_highwatermark = max_id;
        }

        Ok(date_sales)
    }

    pub async fn fetch_sales_data(
        &self,
        api_key: &str,
        api_key_id: &str,
        stored_highwatermark: i64,
        existing_dates: &HashSet<String>,
        save_batch: impl Fn(&[SalesRecord]) -> Result<(), String>,
    ) -> Result<FetchResult, SteamApiError> {
        // Get changed dates
        let hwm_str = stored_highwatermark.to_string();
        let changed_dates_response: SteamChangedDatesResponse = self
            .fetch_from_steam(
                "IPartnerFinancialsService/GetChangedDatesForPartner/v1",
                &[("key", api_key), ("highwatermark", &hwm_str)],
            )
            .await?;

        let dates = changed_dates_response.response.dates;
        let new_highwatermark: i64 = match &changed_dates_response.response.result_highwatermark {
            Some(serde_json::Value::String(s)) => s.parse().unwrap_or(stored_highwatermark),
            Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(stored_highwatermark),
            _ => stored_highwatermark,
        };

        if dates.is_empty() {
            return Ok(FetchResult {
                sales: vec![],
                new_highwatermark,
                record_count: Some(0),
            });
        }

        // Sort dates to prioritize new ones
        let mut sorted_dates = dates.clone();
        sorted_dates.sort_by(|a, b| {
            let a_exists = existing_dates.contains(a);
            let b_exists = existing_dates.contains(b);
            match (a_exists, b_exists) {
                (true, false) => std::cmp::Ordering::Greater,
                (false, true) => std::cmp::Ordering::Less,
                _ => a.cmp(b),
            }
        });

        let mut total_records: i64 = 0;

        // Process dates in batches
        for chunk in sorted_dates.chunks(PARALLEL_BATCH_SIZE) {
            let mut batch_sales: Vec<SalesRecord> = Vec::new();

            // Fetch all dates in this batch (sequentially for simplicity)
            for date in chunk {
                let sales = self.fetch_sales_for_date(api_key, api_key_id, date).await?;
                batch_sales.extend(sales);
            }

            total_records += batch_sales.len() as i64;

            // Save batch to database
            if !batch_sales.is_empty() {
                save_batch(&batch_sales).map_err(|e| SteamApiError::Api(e))?;
            }
        }

        Ok(FetchResult {
            sales: vec![],
            new_highwatermark,
            record_count: Some(total_records),
        })
    }
}

impl Default for SteamApi {
    fn default() -> Self {
        Self::new()
    }
}
