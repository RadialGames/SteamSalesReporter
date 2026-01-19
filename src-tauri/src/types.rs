use serde::{Deserialize, Serialize};

/// API Key management
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub key_hash: String,
    pub created_at: i64,
}

/// Sales record from Steam API
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesRecord {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>, // Unique key hash from Steam API identifying fields

    // API Key association
    pub api_key_id: String,

    // Core identifiers
    pub date: String,
    pub line_item_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partnerid: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_appid: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub packageid: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundleid: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub appid: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_item_id: Option<i64>,

    // Location & platform
    pub country_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,

    // Pricing
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_price: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sale_price: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_sale_price_usd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_sale_type: Option<String>,

    // Units
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gross_units_sold: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gross_units_returned: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gross_units_activated: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub net_units_sold: Option<i64>,

    // Revenue (USD)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gross_sales_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gross_returns_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub net_sales_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub net_tax_usd: Option<f64>,

    // Discounts & revenue share
    #[serde(skip_serializing_if = "Option::is_none")]
    pub combined_discount_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_discount_percentage: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_revenue_share_tier: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_request_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viw_grant_partnerid: Option<i64>,

    // Lookup data (friendly names)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partner_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_item_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_item_category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_request_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_code_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub combined_discount_name: Option<String>,

    // Legacy fields for backwards compatibility with charts
    pub app_id: i64,
    pub units_sold: i64,
}

/// Filters for querying sales data
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Filters {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_id: Option<String>,
}

/// Parameters for fetching sales data
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchParams {
    pub api_key_id: String,
}

/// Result from fetch operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub sales: Vec<SalesRecord>,
    pub new_highwatermark: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_count: Option<i64>,
}

// Steam API response types

#[derive(Debug, Deserialize)]
pub struct SteamChangedDatesResponse {
    pub response: SteamChangedDatesInner,
}

#[derive(Debug, Deserialize)]
pub struct SteamChangedDatesInner {
    #[serde(default)]
    pub dates: Vec<String>,
    pub result_highwatermark: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct SteamDetailedSalesResponse {
    pub response: SteamDetailedSalesInner,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct SteamDetailedSalesInner {
    #[serde(default)]
    pub results: Vec<SteamSaleItem>,
    pub max_id: Option<String>,
    #[serde(default)]
    pub app_info: Vec<AppInfo>,
    #[serde(default)]
    pub package_info: Vec<PackageInfo>,
    #[serde(default)]
    pub bundle_info: Vec<BundleInfo>,
    #[serde(default)]
    pub partner_info: Vec<PartnerInfo>,
    #[serde(default)]
    pub country_info: Vec<CountryInfo>,
    #[serde(default)]
    pub game_item_info: Vec<GameItemInfo>,
    #[serde(default)]
    pub key_request_info: Vec<KeyRequestInfo>,
    #[serde(default)]
    pub combined_discount_info: Vec<CombinedDiscountInfo>,
}

#[derive(Debug, Deserialize)]
pub struct SteamSaleItem {
    pub id: Option<i64>, // Record ID from Steam API
    pub date: String,
    pub line_item_type: String,
    pub partnerid: Option<i64>,
    pub primary_appid: Option<i64>,
    pub packageid: Option<i64>,
    pub bundleid: Option<i64>,
    pub appid: Option<i64>,
    pub game_item_id: Option<i64>,
    pub country_code: String,
    pub platform: Option<String>,
    pub currency: Option<String>,
    pub base_price: Option<String>,
    pub sale_price: Option<String>,
    pub avg_sale_price_usd: Option<String>,
    pub package_sale_type: Option<String>,
    pub gross_units_sold: Option<i64>,
    pub gross_units_returned: Option<i64>,
    pub gross_units_activated: Option<i64>,
    pub net_units_sold: Option<i64>,
    pub gross_sales_usd: Option<String>,
    pub gross_returns_usd: Option<String>,
    pub net_sales_usd: Option<String>,
    pub net_tax_usd: Option<String>,
    pub combined_discount_id: Option<i64>,
    pub total_discount_percentage: Option<f64>,
    pub additional_revenue_share_tier: Option<i64>,
    pub key_request_id: Option<i64>,
    pub viw_grant_partnerid: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct AppInfo {
    pub appid: i64,
    pub app_name: String,
}

#[derive(Debug, Deserialize)]
pub struct PackageInfo {
    pub packageid: i64,
    pub package_name: String,
}

#[derive(Debug, Deserialize)]
pub struct BundleInfo {
    pub bundleid: i64,
    pub bundle_name: String,
}

#[derive(Debug, Deserialize)]
pub struct PartnerInfo {
    pub partnerid: i64,
    pub partner_name: String,
}

#[derive(Debug, Deserialize)]
pub struct CountryInfo {
    pub country_code: String,
    pub country_name: String,
    pub region: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct GameItemInfo {
    pub appid: i64,
    pub game_item_id: i64,
    pub game_item_description: String,
    pub game_item_category: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct KeyRequestInfo {
    pub key_request_id: i64,
    pub key_request_notes: String,
    pub game_code_id: i64,
    pub game_code_description: String,
    pub territory_code_id: i64,
    pub territory_code_description: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct CombinedDiscountInfo {
    pub combined_discount_id: i64,
    pub combined_discount_name: String,
    pub total_discount_percentage: f64,
    #[serde(default)]
    pub discount_ids: Vec<i64>,
}
