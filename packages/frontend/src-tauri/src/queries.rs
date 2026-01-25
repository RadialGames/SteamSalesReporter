// Database query module - queries SQLite directly from Rust

use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Get a new database connection (SQLite handles connection pooling internally)
pub fn get_connection() -> SqliteResult<Connection> {
    use crate::database::get_database_path;

    let path = get_database_path();
    Connection::open(&path)
}

// ==================== Query Parameters ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryFilters {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub app_ids: Option<Vec<i64>>,
    pub country_code: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
}

impl Default for QueryFilters {
    fn default() -> Self {
        Self {
            start_date: None,
            end_date: None,
            app_ids: None,
            country_code: None,
            limit: Some(1000),
            offset: Some(0),
            sort_by: Some("date".to_string()),
            sort_order: Some("desc".to_string()),
        }
    }
}

// ==================== Response Types ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesRecord {
    pub id: u64,
    pub date: String,
    #[serde(rename = "lineItemType")]
    pub line_item_type: String,
    #[serde(rename = "appId")]
    pub app_id: Option<i64>,
    #[serde(rename = "appName")]
    pub app_name: Option<String>,
    #[serde(rename = "packageId")]
    pub package_id: Option<i64>,
    #[serde(rename = "packageName")]
    pub package_name: Option<String>,
    #[serde(rename = "countryCode")]
    pub country_code: Option<String>,
    #[serde(rename = "countryName")]
    pub country_name: Option<String>,
    pub region: Option<String>,
    pub platform: Option<String>,
    pub currency: Option<String>,
    #[serde(rename = "grossUnitsSold")]
    pub gross_units_sold: i64,
    #[serde(rename = "grossUnitsReturned")]
    pub gross_units_returned: i64,
    #[serde(rename = "netUnitsSold")]
    pub net_units_sold: i64,
    #[serde(rename = "grossSalesUsd")]
    pub gross_sales_usd: f64,
    #[serde(rename = "netSalesUsd")]
    pub net_sales_usd: f64,
    #[serde(rename = "discountPercentage")]
    pub discount_percentage: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SalesResponse {
    pub records: Vec<SalesRecord>,
    pub pagination: Pagination,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Pagination {
    pub total: u64,
    pub limit: u32,
    pub offset: u32,
    pub has_more: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    pub total_revenue: f64,
    pub total_units: i64,
    pub record_count: u64,
    pub app_count: u64,
    pub country_count: u64,
    pub date_range: Option<DateRange>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DateRange {
    pub min: String,
    pub max: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailySummary {
    pub date: String,
    pub total_revenue: f64,
    pub total_units: i64,
    pub record_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSummary {
    #[serde(rename = "appId")]
    pub app_id: i64,
    #[serde(rename = "appName")]
    pub app_name: Option<String>,
    pub total_revenue: f64,
    pub total_units: i64,
    pub record_count: u64,
    #[serde(rename = "firstSale")]
    pub first_sale: String,
    #[serde(rename = "lastSale")]
    pub last_sale: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountrySummary {
    #[serde(rename = "countryCode")]
    pub country_code: String,
    #[serde(rename = "countryName")]
    pub country_name: Option<String>,
    pub region: Option<String>,
    pub total_revenue: f64,
    pub total_units: i64,
    pub record_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLookup {
    #[serde(rename = "appId")]
    pub app_id: i64,
    #[serde(rename = "appName")]
    pub app_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountryLookup {
    #[serde(rename = "countryCode")]
    pub country_code: String,
    #[serde(rename = "countryName")]
    pub country_name: String,
    pub region: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageLookup {
    #[serde(rename = "packageId")]
    pub package_id: i64,
    #[serde(rename = "packageName")]
    pub package_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductStats {
    pub total_revenue: f64,
    pub total_units: i64,
    pub record_count: u64,
    pub date_range: Option<DateRange>,
    pub daily: Vec<DailySummary>,
    pub by_country: Vec<CountrySummary>,
    pub by_platform: Vec<PlatformSummary>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSummary {
    pub platform: Option<String>,
    pub total_revenue: f64,
    pub total_units: i64,
    pub record_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchDay {
    pub day: u32,
    pub revenue: f64,
    pub units: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchComparisonApp {
    #[serde(rename = "appId")]
    pub app_id: Option<i64>,
    #[serde(rename = "packageId")]
    pub package_id: Option<i64>,
    #[serde(rename = "appName")]
    pub app_name: Option<String>,
    #[serde(rename = "packageName")]
    pub package_name: Option<String>,
    pub launch_date: String,
    pub days: Vec<LaunchDay>,
}

// ==================== Helper Functions ====================

// Get the app ID column name from the database schema
// Prioritizes "primary_app_id" as that's the actual column name in the database
fn get_app_id_column(conn: &Connection) -> String {
    // Check in priority order: primary_app_id first, then fallbacks
    for col_name in &["primary_app_id", "primary_appid", "appid", "app_id"] {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sales_data') WHERE name = ?",
                [col_name],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if exists > 0 {
            return col_name.to_string();
        }
    }
    // Fallback to appid if nothing found
    "appid".to_string()
}

// Get the app name column name from the database schema
fn get_app_name_column(conn: &Connection) -> Option<String> {
    // Check for app name columns in priority order
    for col_name in &[
        "primary_app_name",
        "primary_appname",
        "app_name",
        "appname",
        "appName",
    ] {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sales_data') WHERE name = ?",
                [col_name],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if exists > 0 {
            // Check if column has any non-NULL values
            let has_values: i64 = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM sales_data WHERE {} IS NOT NULL AND {} != ''",
                        col_name, col_name
                    ),
                    [],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            if has_values > 0 {
                return Some(col_name.to_string());
            }
        }
    }
    None
}

struct WhereClause {
    clause: String,
}

fn build_where_clause(filters: &QueryFilters, app_id_col: &str) -> WhereClause {
    let mut conditions: Vec<String> = Vec::new();

    if filters.start_date.is_some() {
        conditions.push("date >= ?".to_string());
    }
    if filters.end_date.is_some() {
        conditions.push("date <= ?".to_string());
    }
    if let Some(ref app_ids) = filters.app_ids {
        if !app_ids.is_empty() {
            let placeholders: Vec<String> = app_ids.iter().map(|_| "?".to_string()).collect();
            let in_clause = format!("{} IN ({})", app_id_col, placeholders.join(", "));
            conditions.push(in_clause);
        }
    }
    if filters.country_code.is_some() {
        conditions.push("country_code = ?".to_string());
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    WhereClause {
        clause: where_clause,
    }
}

fn parse_usd(value: &str) -> f64 {
    value.trim().replace(',', "").parse().unwrap_or(0.0)
}

// ==================== Query Functions ====================

pub fn get_stats(filters: QueryFilters) -> SqliteResult<DashboardStats> {
    let conn = get_connection()?;
    let app_id_col = get_app_id_column(&conn);

    let where_clause = build_where_clause(&filters, &app_id_col);

    let sql = format!(
        "SELECT 
            COALESCE(SUM(CAST(gross_sales_usd AS REAL)), 0) as total_revenue,
            COALESCE(SUM(net_units_sold), 0) as total_units,
            COUNT(*) as record_count,
            COUNT(DISTINCT {}) as app_count,
            COUNT(DISTINCT country_code) as country_count,
            MIN(date) as min_date,
            MAX(date) as max_date
        FROM sales_data {}",
        app_id_col, where_clause.clause
    );

    let mut stmt = conn.prepare(&sql)?;

    // Build params based on filters
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();
    if let Some(ref start_date) = filters.start_date {
        params.push(start_date);
    }
    if let Some(ref end_date) = filters.end_date {
        params.push(end_date);
    }
    if let Some(ref app_ids) = filters.app_ids {
        for app_id in app_ids {
            params.push(app_id);
        }
    }
    if let Some(ref country_code) = filters.country_code {
        params.push(country_code);
    }

    let row = stmt.query_row(params.as_slice(), |row| {
        Ok((
            row.get::<_, f64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
        ))
    })?;

    let (total_revenue, total_units, record_count, app_count, country_count, min_date, max_date) =
        row;

    let date_range = if let (Some(min), Some(max)) = (min_date, max_date) {
        Some(DateRange { min, max })
    } else {
        None
    };

    Ok(DashboardStats {
        total_revenue,
        total_units,
        record_count: record_count as u64,
        app_count: app_count as u64,
        country_count: country_count as u64,
        date_range,
    })
}

pub fn get_sales(filters: QueryFilters) -> SqliteResult<SalesResponse> {
    let conn = get_connection()?;
    let app_id_col = get_app_id_column(&conn);

    let where_clause = build_where_clause(&filters, &app_id_col);

    // Build params for WHERE clause
    let mut where_params: Vec<&dyn rusqlite::ToSql> = Vec::new();
    if let Some(ref start_date) = filters.start_date {
        where_params.push(start_date);
    }
    if let Some(ref end_date) = filters.end_date {
        where_params.push(end_date);
    }
    if let Some(ref app_ids) = filters.app_ids {
        for app_id in app_ids {
            where_params.push(app_id);
        }
    }
    if let Some(ref country_code) = filters.country_code {
        where_params.push(country_code);
    }

    // Get total count
    let count_sql = format!("SELECT COUNT(*) FROM sales_data {}", where_clause.clause);
    let total: i64 = conn.query_row(&count_sql, where_params.as_slice(), |row| row.get(0))?;

    // Build ORDER BY
    let sort_by = filters.sort_by.as_deref().unwrap_or("date");
    let sort_order = filters
        .sort_order
        .as_deref()
        .unwrap_or("desc")
        .to_uppercase();
    let order_by = match sort_by {
        "revenue" => format!("CAST(gross_sales_usd AS REAL) {}", sort_order),
        "units" => format!("net_units_sold {}", sort_order),
        _ => format!("date {}", sort_order),
    };

    // Get records
    let limit = filters.limit.unwrap_or(1000) as i64;
    let offset = filters.offset.unwrap_or(0) as i64;

    // Check if discount column exists - it may not exist in all database versions
    let has_discount_col = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('sales_data') WHERE name IN ('total_discount_percentage', 'discount_percentage')",
        [],
        |row| row.get::<_, i64>(0)
    ).unwrap_or(0) > 0;

    let discount_col = if has_discount_col {
        "COALESCE(total_discount_percentage, discount_percentage, NULL)"
    } else {
        "NULL"
    };

    // Check if lookup tables exist
    let lookup_apps_exists = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lookup_apps'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    let lookup_packages_exists = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lookup_packages'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    // Build SQL with JOINs if lookup tables exist
    let (sql, has_app_name, has_package_name) = if lookup_apps_exists && lookup_packages_exists {
        (
            format!(
                "SELECT 
                    s.date, s.line_item_type, s.{}, s.packageid, s.country_code, s.platform, s.currency,
                    s.gross_units_sold, s.gross_units_returned, s.net_units_sold,
                    s.gross_sales_usd, s.net_sales_usd, {} as discount_percentage,
                    a.app_name, p.package_name
                FROM sales_data s
                LEFT JOIN lookup_apps a ON s.{} = a.appid
                LEFT JOIN lookup_packages p ON s.packageid = p.packageid
                {}
                ORDER BY {}
                LIMIT ? OFFSET ?",
                app_id_col, discount_col, app_id_col, where_clause.clause, order_by
            ),
            true,
            true,
        )
    } else if lookup_apps_exists {
        (
            format!(
                "SELECT 
                    s.date, s.line_item_type, s.{}, s.packageid, s.country_code, s.platform, s.currency,
                    s.gross_units_sold, s.gross_units_returned, s.net_units_sold,
                    s.gross_sales_usd, s.net_sales_usd, {} as discount_percentage,
                    a.app_name, NULL as package_name
                FROM sales_data s
                LEFT JOIN lookup_apps a ON s.{} = a.appid
                {}
                ORDER BY {}
                LIMIT ? OFFSET ?",
                app_id_col, discount_col, app_id_col, where_clause.clause, order_by
            ),
            true,
            false,
        )
    } else if lookup_packages_exists {
        (
            format!(
                "SELECT 
                    s.date, s.line_item_type, s.{}, s.packageid, s.country_code, s.platform, s.currency,
                    s.gross_units_sold, s.gross_units_returned, s.net_units_sold,
                    s.gross_sales_usd, s.net_sales_usd, {} as discount_percentage,
                    NULL as app_name, p.package_name
                FROM sales_data s
                LEFT JOIN lookup_packages p ON s.packageid = p.packageid
                {}
                ORDER BY {}
                LIMIT ? OFFSET ?",
                app_id_col, discount_col, where_clause.clause, order_by
            ),
            false,
            true,
        )
    } else {
        (
            format!(
                "SELECT 
                    date, line_item_type, {}, packageid, country_code, platform, currency,
                    gross_units_sold, gross_units_returned, net_units_sold,
                    gross_sales_usd, net_sales_usd, {} as discount_percentage,
                    NULL as app_name, NULL as package_name
                FROM sales_data {}
                ORDER BY {}
                LIMIT ? OFFSET ?",
                app_id_col, discount_col, where_clause.clause, order_by
            ),
            false,
            false,
        )
    };

    // Combine WHERE params with LIMIT/OFFSET
    let mut all_params: Vec<&dyn rusqlite::ToSql> = where_params;
    all_params.push(&limit);
    all_params.push(&offset);

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(all_params.as_slice(), |row| {
        let mut record = SalesRecord {
            id: offset as u64 + 1, // Generate ID
            date: row.get::<_, String>(0)?,
            line_item_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            app_id: row.get::<_, Option<i64>>(2)?,
            app_name: None,
            package_id: row.get::<_, Option<i64>>(3)?,
            package_name: None,
            country_code: row.get::<_, Option<String>>(4)?,
            country_name: None,
            region: None,
            platform: row.get::<_, Option<String>>(5)?,
            currency: row.get::<_, Option<String>>(6)?,
            gross_units_sold: row.get::<_, i64>(7)?,
            gross_units_returned: row.get::<_, i64>(8)?,
            net_units_sold: row.get::<_, i64>(9)?,
            gross_sales_usd: parse_usd(&row.get::<_, String>(10)?),
            net_sales_usd: parse_usd(&row.get::<_, String>(11)?),
            discount_percentage: row.get::<_, Option<f64>>(12)?,
        };

        // Set app_name and package_name if available
        if has_app_name {
            record.app_name = row.get::<_, Option<String>>(13)?;
        }
        if has_package_name {
            let name_idx = if has_app_name { 14 } else { 13 };
            record.package_name = row.get::<_, Option<String>>(name_idx)?;
        }

        Ok(record)
    })?;

    let mut records = Vec::new();
    for (idx, row) in rows.enumerate() {
        let mut record = row?;
        record.id = offset as u64 + idx as u64 + 1;
        records.push(record);
    }

    let records_len = records.len() as i64;

    Ok(SalesResponse {
        records,
        pagination: Pagination {
            total: total as u64,
            limit: filters.limit.unwrap_or(1000),
            offset: filters.offset.unwrap_or(0),
            has_more: (offset + records_len) < total,
        },
    })
}

pub fn get_daily_summaries(filters: QueryFilters) -> SqliteResult<Vec<DailySummary>> {
    let conn = get_connection()?;
    let app_id_col = get_app_id_column(&conn);

    let where_clause = build_where_clause(&filters, &app_id_col);
    let limit = filters.limit.unwrap_or(1000) as i64;

    // Build params
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();
    if let Some(ref start_date) = filters.start_date {
        params.push(start_date);
    }
    if let Some(ref end_date) = filters.end_date {
        params.push(end_date);
    }
    if let Some(ref app_ids) = filters.app_ids {
        for app_id in app_ids {
            params.push(app_id);
        }
    }
    if let Some(ref country_code) = filters.country_code {
        params.push(country_code);
    }
    params.push(&limit);

    let sql = format!(
        "SELECT 
            date,
            SUM(CAST(gross_sales_usd AS REAL)) as total_revenue,
            SUM(net_units_sold) as total_units,
            COUNT(*) as record_count
        FROM sales_data {}
        GROUP BY date
        ORDER BY date
        LIMIT ?",
        where_clause.clause
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params.as_slice(), |row| {
        Ok(DailySummary {
            date: row.get::<_, String>(0)?,
            total_revenue: row.get::<_, f64>(1)?,
            total_units: row.get::<_, i64>(2)?,
            record_count: row.get::<_, i64>(3)? as u64,
        })
    })?;

    let mut summaries = Vec::new();
    for row in rows {
        summaries.push(row?);
    }

    Ok(summaries)
}

pub fn get_app_summaries(filters: QueryFilters) -> SqliteResult<Vec<AppSummary>> {
    let conn = get_connection()?;
    let app_id_col = get_app_id_column(&conn);

    let where_clause = build_where_clause(&filters, &app_id_col);
    let limit = filters.limit.unwrap_or(100) as i64;

    // Build params
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();
    if let Some(ref start_date) = filters.start_date {
        params.push(start_date);
    }
    if let Some(ref end_date) = filters.end_date {
        params.push(end_date);
    }
    if let Some(ref app_ids) = filters.app_ids {
        for app_id in app_ids {
            params.push(app_id);
        }
    }
    if let Some(ref country_code) = filters.country_code {
        params.push(country_code);
    }
    params.push(&limit);

    let sql = format!(
        "SELECT 
            {},
            SUM(CAST(gross_sales_usd AS REAL)) as total_revenue,
            SUM(net_units_sold) as total_units,
            COUNT(*) as record_count,
            MIN(date) as first_sale,
            MAX(date) as last_sale
        FROM sales_data {}
        GROUP BY {}
        ORDER BY total_revenue DESC
        LIMIT ?",
        app_id_col, where_clause.clause, app_id_col
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params.as_slice(), |row| {
        let app_id: Option<i64> = row.get(0)?;
        Ok((
            app_id,
            row.get::<_, f64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
        ))
    })?;

    let mut summaries = Vec::new();
    for row in rows {
        let (app_id_opt, total_revenue, total_units, record_count, first_sale, last_sale) = row?;
        if let Some(app_id) = app_id_opt {
            if app_id != 0 {
                summaries.push(AppSummary {
                    app_id,
                    app_name: None,
                    total_revenue,
                    total_units,
                    record_count: record_count as u64,
                    first_sale,
                    last_sale,
                });
            }
        }
    }

    Ok(summaries)
}

pub fn get_country_summaries(filters: QueryFilters) -> SqliteResult<Vec<CountrySummary>> {
    let conn = get_connection()?;
    let app_id_col = get_app_id_column(&conn);

    let where_clause = build_where_clause(&filters, &app_id_col);
    let limit = filters.limit.unwrap_or(250) as i64;

    // Build params
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();
    if let Some(ref start_date) = filters.start_date {
        params.push(start_date);
    }
    if let Some(ref end_date) = filters.end_date {
        params.push(end_date);
    }
    if let Some(ref app_ids) = filters.app_ids {
        for app_id in app_ids {
            params.push(app_id);
        }
    }
    if let Some(ref country_code) = filters.country_code {
        params.push(country_code);
    }
    params.push(&limit);

    let sql = format!(
        "SELECT 
            country_code,
            SUM(CAST(gross_sales_usd AS REAL)) as total_revenue,
            SUM(net_units_sold) as total_units,
            COUNT(*) as record_count
        FROM sales_data {}
        GROUP BY country_code
        ORDER BY total_revenue DESC
        LIMIT ?",
        where_clause.clause
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params.as_slice(), |row| {
        Ok(CountrySummary {
            country_code: row.get::<_, String>(0)?,
            country_name: None,
            region: None,
            total_revenue: row.get::<_, f64>(1)?,
            total_units: row.get::<_, i64>(2)?,
            record_count: row.get::<_, i64>(3)? as u64,
        })
    })?;

    let mut summaries = Vec::new();
    for row in rows {
        let summary = row?;
        if !summary.country_code.is_empty() {
            summaries.push(summary);
        }
    }

    Ok(summaries)
}

pub fn get_apps_lookup() -> SqliteResult<Vec<AppLookup>> {
    let conn = get_connection()?;
    let app_id_col = get_app_id_column(&conn);

    // Check if lookup_apps table exists
    let lookup_apps_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lookup_apps'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if lookup_apps_exists > 0 {
        // Use lookup_apps table
        let sql = format!(
            "SELECT DISTINCT s.{}, a.app_name 
             FROM sales_data s 
             JOIN lookup_apps a ON s.{} = a.appid 
             WHERE s.{} IS NOT NULL AND s.{} != 0 
             ORDER BY s.{}",
            app_id_col, app_id_col, app_id_col, app_id_col, app_id_col
        );

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let app_id: Option<i64> = row.get(0)?;
            let app_name: Option<String> = row.get(1)?;
            Ok((app_id, app_name))
        })?;

        let mut apps = Vec::new();
        for row in rows {
            if let (Some(app_id), app_name_opt) = row? {
                if app_id != 0 {
                    apps.push(AppLookup {
                        app_id,
                        app_name: app_name_opt.unwrap_or_else(|| format!("App {}", app_id)),
                    });
                }
            }
        }
        return Ok(apps);
    }

    // Fallback: check for app name column in sales_data
    let app_name_col = get_app_name_column(&conn);

    if let Some(ref name_col) = app_name_col {
        // Include app name in query
        let sql = format!("SELECT DISTINCT {}, MAX({}) as app_name FROM sales_data WHERE {} IS NOT NULL AND {} != 0 GROUP BY {} ORDER BY {}", app_id_col, name_col, app_id_col, app_id_col, app_id_col, app_id_col);
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let app_id: Option<i64> = row.get(0)?;
            let app_name: Option<String> = row.get(1)?;
            Ok((app_id, app_name))
        })?;

        let mut apps = Vec::new();
        for row in rows {
            if let (Some(app_id), app_name_opt) = row? {
                if app_id != 0 {
                    apps.push(AppLookup {
                        app_id,
                        app_name: app_name_opt.unwrap_or_else(|| format!("App {}", app_id)),
                    });
                }
            }
        }
        Ok(apps)
    } else {
        // No app name column - use ID only
        let sql = format!(
            "SELECT DISTINCT {} FROM sales_data WHERE {} IS NOT NULL AND {} != 0 ORDER BY {}",
            app_id_col, app_id_col, app_id_col, app_id_col
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let app_id: Option<i64> = row.get(0)?;
            Ok(app_id)
        })?;

        let mut apps = Vec::new();
        for row in rows {
            if let Some(app_id) = row? {
                if app_id != 0 {
                    apps.push(AppLookup {
                        app_id,
                        app_name: format!("App {}", app_id),
                    });
                }
            }
        }
        Ok(apps)
    }
}

pub fn get_countries_lookup() -> SqliteResult<Vec<CountryLookup>> {
    let conn = get_connection()?;

    let sql = "SELECT DISTINCT country_code FROM sales_data WHERE country_code IS NOT NULL ORDER BY country_code";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        let country_code: String = row.get(0)?;
        Ok(CountryLookup {
            country_code: country_code.clone(),
            country_name: country_code,
            region: None,
        })
    })?;

    let mut countries = Vec::new();
    for row in rows {
        countries.push(row?);
    }

    Ok(countries)
}

pub fn get_dates_list() -> SqliteResult<Vec<String>> {
    let conn = get_connection()?;
    let sql = "SELECT DISTINCT date FROM sales_data ORDER BY date DESC";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut dates = Vec::new();
    for row in rows {
        dates.push(row?);
    }
    Ok(dates)
}

pub fn get_raw_data_by_date(date: &str) -> SqliteResult<Vec<SalesRecord>> {
    let mut filters = QueryFilters::default();
    filters.start_date = Some(date.to_string());
    filters.end_date = Some(date.to_string());
    filters.limit = Some(100_000);
    filters.offset = Some(0);
    let response = get_sales(filters)?;
    Ok(response.records)
}

pub fn get_packages_lookup() -> SqliteResult<Vec<PackageLookup>> {
    let conn = get_connection()?;

    // Check if lookup_packages table exists
    let lookup_packages_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lookup_packages'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if lookup_packages_exists > 0 {
        // Use lookup_packages table
        let sql = "SELECT DISTINCT s.packageid, p.package_name 
                   FROM sales_data s 
                   JOIN lookup_packages p ON s.packageid = p.packageid 
                   WHERE s.packageid IS NOT NULL AND s.packageid != 0 
                   ORDER BY s.packageid";

        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |row| {
            let package_id: Option<i64> = row.get(0)?;
            let package_name: Option<String> = row.get(1)?;
            Ok((package_id, package_name))
        })?;

        let mut packages = Vec::new();
        for row in rows {
            if let (Some(package_id), package_name_opt) = row? {
                if package_id != 0 {
                    packages.push(PackageLookup {
                        package_id,
                        package_name: package_name_opt
                            .unwrap_or_else(|| format!("Package {}", package_id)),
                    });
                }
            }
        }
        return Ok(packages);
    }

    // Fallback: check for package name column in sales_data
    let package_name_col = conn.query_row(
        "SELECT name FROM pragma_table_info('sales_data') WHERE name IN ('primary_package_name', 'primary_packagename', 'package_name', 'packagename', 'packageName') LIMIT 1",
        [],
        |row| row.get::<_, String>(0)
    ).ok();

    if let Some(ref name_col) = package_name_col {
        // Include package name in query
        let sql = format!("SELECT DISTINCT packageid, MAX({}) as package_name FROM sales_data WHERE packageid IS NOT NULL AND packageid != 0 GROUP BY packageid ORDER BY packageid", name_col);
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let package_id: Option<i64> = row.get(0)?;
            let package_name: Option<String> = row.get(1)?;
            Ok((package_id, package_name))
        })?;

        let mut packages = Vec::new();
        for row in rows {
            if let (Some(package_id), package_name_opt) = row? {
                if package_id != 0 {
                    packages.push(PackageLookup {
                        package_id,
                        package_name: package_name_opt
                            .unwrap_or_else(|| format!("Package {}", package_id)),
                    });
                }
            }
        }
        Ok(packages)
    } else {
        // No package name column - use ID only
        let sql = "SELECT DISTINCT packageid FROM sales_data WHERE packageid IS NOT NULL AND packageid != 0 ORDER BY packageid";
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |row| {
            let package_id: Option<i64> = row.get(0)?;
            Ok(package_id)
        })?;

        let mut packages = Vec::new();
        for row in rows {
            if let Some(package_id) = row? {
                if package_id != 0 {
                    packages.push(PackageLookup {
                        package_id,
                        package_name: format!("Package {}", package_id),
                    });
                }
            }
        }
        Ok(packages)
    }
}

pub fn get_product_stats(product_type: &str, product_id: i64) -> SqliteResult<ProductStats> {
    let conn = get_connection()?;
    let app_id_col = get_app_id_column(&conn);
    let (col, param): (String, &dyn rusqlite::ToSql) = match product_type {
        "app" => (app_id_col.clone(), &product_id as &dyn rusqlite::ToSql),
        "package" => ("packageid".to_string(), &product_id as &dyn rusqlite::ToSql),
        _ => {
            return Err(rusqlite::Error::InvalidParameterName(
                "product_type must be 'app' or 'package'".to_string(),
            ))
        }
    };
    let filter = format!("WHERE {} = ?", col);

    // Totals + date range
    let sql = format!(
        "SELECT
            COALESCE(SUM(CAST(gross_sales_usd AS REAL)), 0) as total_revenue,
            COALESCE(SUM(net_units_sold), 0) as total_units,
            COUNT(*) as record_count,
            MIN(date) as min_date,
            MAX(date) as max_date
        FROM sales_data {}",
        filter
    );
    let row = conn.query_row(&sql, [param], |r| {
        Ok((
            r.get::<_, f64>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
        ))
    })?;
    let (total_revenue, total_units, record_count, min_date, max_date) = row;
    let date_range = match (min_date, max_date) {
        (Some(min), Some(max)) => Some(DateRange { min, max }),
        _ => None,
    };

    // Daily breakdown
    let sql_daily = format!(
        "SELECT date, SUM(CAST(gross_sales_usd AS REAL)) as tr, SUM(net_units_sold) as tu, COUNT(*) as rc
         FROM sales_data {} GROUP BY date ORDER BY date",
        filter
    );
    let mut stmt = conn.prepare(&sql_daily)?;
    let daily: Vec<DailySummary> = stmt
        .query_map([param], |r| {
            Ok(DailySummary {
                date: r.get(0)?,
                total_revenue: r.get(1)?,
                total_units: r.get(2)?,
                record_count: r.get::<_, i64>(3)? as u64,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // By country
    let country_sql = if product_type == "app" {
        format!("SELECT country_code, SUM(CAST(gross_sales_usd AS REAL)) as tr, SUM(net_units_sold) as tu, COUNT(*) as rc
         FROM sales_data WHERE {} = ? AND country_code IS NOT NULL AND country_code != ''
         GROUP BY country_code ORDER BY tr DESC LIMIT 500", app_id_col)
    } else {
        "SELECT country_code, SUM(CAST(gross_sales_usd AS REAL)) as tr, SUM(net_units_sold) as tu, COUNT(*) as rc
         FROM sales_data WHERE packageid = ? AND country_code IS NOT NULL AND country_code != ''
         GROUP BY country_code ORDER BY tr DESC LIMIT 500".to_string()
    };
    let mut stmt_country = conn.prepare(&country_sql)?;
    let by_country: Vec<CountrySummary> = stmt_country
        .query_map([product_id], |r| {
            Ok(CountrySummary {
                country_code: r.get(0)?,
                country_name: None,
                region: None,
                total_revenue: r.get(1)?,
                total_units: r.get(2)?,
                record_count: r.get::<_, i64>(3)? as u64,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // By platform
    let (platform_sql, platform_params): (String, Vec<&dyn rusqlite::ToSql>) = if product_type
        == "app"
    {
        (
            format!("SELECT platform, SUM(CAST(gross_sales_usd AS REAL)) as tr, SUM(net_units_sold) as tu, COUNT(*) as rc
             FROM sales_data WHERE {} = ? GROUP BY platform ORDER BY tr DESC LIMIT 100", app_id_col),
            vec![&product_id],
        )
    } else {
        (
            "SELECT platform, SUM(CAST(gross_sales_usd AS REAL)) as tr, SUM(net_units_sold) as tu, COUNT(*) as rc
             FROM sales_data WHERE packageid = ? GROUP BY platform ORDER BY tr DESC LIMIT 100".to_string(),
            vec![&product_id],
        )
    };
    let mut stmt = conn.prepare(&platform_sql)?;
    let by_platform: Vec<PlatformSummary> = stmt
        .query_map(platform_params.as_slice(), |r| {
            Ok(PlatformSummary {
                platform: r.get(0)?,
                total_revenue: r.get(1)?,
                total_units: r.get(2)?,
                record_count: r.get::<_, i64>(3)? as u64,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ProductStats {
        total_revenue,
        total_units,
        record_count: record_count as u64,
        date_range,
        daily,
        by_country,
        by_platform,
    })
}

// Helper function to calculate days for a single product efficiently
fn calculate_product_days(
    conn: &Connection,
    product_id: i64,
    launch_date: &str,
    max_days: u32,
    id_column: &str,
    latest_date: &str,
) -> SqliteResult<Vec<LaunchDay>> {
    // Calculate actual max days: from launch_date to latest_date in database, capped at max_days
    // This prevents calculating beyond the data we have
    let actual_max_days: i64 = conn
        .query_row(
            "SELECT MIN(CAST(julianday(?) - julianday(?) AS INTEGER), ?)",
            rusqlite::params![latest_date, launch_date, max_days as i64],
            |r| r.get(0),
        )
        .unwrap_or(max_days as i64);

    let actual_max = actual_max_days.max(0).min(max_days as i64) as u32;

    // Batch query all days at once instead of one query per day
    // Only query dates from launch_date to min(launch_date + max_days, latest_date)
    let batch_sql = format!(
        "SELECT 
            CAST(julianday(date) - julianday(?1) AS INTEGER) as day,
            COALESCE(SUM(CAST(gross_sales_usd AS REAL)), 0) as revenue,
            COALESCE(SUM(net_units_sold), 0) as units
         FROM sales_data
         WHERE {} = ?2
           AND date >= ?1
           AND date <= MIN(date(?1, '+' || ?3 || ' days'), ?4)
           AND CAST(julianday(date) - julianday(?1) AS INTEGER) >= 0
           AND CAST(julianday(date) - julianday(?1) AS INTEGER) <= ?3
         GROUP BY day
         ORDER BY day",
        id_column
    );

    let mut day_map: HashMap<u32, (f64, i64)> = HashMap::new();
    let mut stmt = conn.prepare(&batch_sql)?;
    let batch_rows = stmt.query_map(
        rusqlite::params![launch_date, product_id, actual_max, latest_date],
        |r| {
            let day: i64 = r.get(0)?;
            let revenue: f64 = r.get(1)?;
            let units: i64 = r.get(2)?;
            Ok((day as u32, (revenue, units)))
        },
    )?;

    for row in batch_rows {
        if let Ok((day, data)) = row {
            day_map.insert(day, data);
        }
    }

    // Build days array, filling in missing days with zeros
    let mut days = Vec::new();
    for day in 0..=max_days {
        if day <= actual_max {
            let (revenue, units) = day_map.get(&day).copied().unwrap_or((0.0, 0));
            days.push(LaunchDay {
                day,
                revenue,
                units,
            });
        } else {
            // Future days or beyond actual_max - set to zero
            days.push(LaunchDay {
                day,
                revenue: 0.0,
                units: 0,
            });
        }
    }

    Ok(days)
}

pub fn get_launch_comparison(
    max_days: u32,
    product_type: &str,
) -> SqliteResult<Vec<LaunchComparisonApp>> {
    let conn = get_connection()?;
    let is_package = product_type == "package";

    // Get the latest date in the database (most recent date we have data for)
    let latest_date: String = conn
        .query_row("SELECT MAX(date) FROM sales_data", [], |r| r.get(0))
        .unwrap_or_else(|_| {
            // Fallback: if no data exists, use a far future date to avoid issues
            // This should rarely happen as we check for data before calling this
            "2099-12-31".to_string()
        });

    if is_package {
        // Package-based launch comparison
        // Check if lookup_packages table exists
        let lookup_packages_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lookup_packages'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let mut result = Vec::new();

        if lookup_packages_exists > 0 {
            // Find launch date as first date with revenue > 0 for each package
            // Use a subquery to find the minimum date where revenue > 0
            let sql = "
                SELECT 
                    s.packageid,
                    p.package_name,
                    MIN(s.date) as launch_date
                FROM sales_data s
                LEFT JOIN lookup_packages p ON s.packageid = p.packageid
                WHERE s.packageid IS NOT NULL 
                  AND s.packageid != 0
                  AND CAST(s.gross_sales_usd AS REAL) > 0
                GROUP BY s.packageid
                ORDER BY s.packageid
            ";

            let mut stmt = conn.prepare(sql)?;
            let package_rows: Vec<(Option<i64>, Option<String>, String)> = stmt
                .query_map([], |r| {
                    let package_id: Option<i64> = r.get(0)?;
                    let package_name: Option<String> = r.get(1)?;
                    let launch_date: String = r.get(2)?;
                    Ok((package_id, package_name, launch_date))
                })?
                .filter_map(|row| row.ok())
                .collect();

            for (package_id_opt, package_name_opt, launch_date) in package_rows {
                if let Some(package_id) = package_id_opt {
                    let days = calculate_product_days(
                        &conn,
                        package_id,
                        &launch_date,
                        max_days,
                        "packageid",
                        &latest_date,
                    )?;
                    result.push(LaunchComparisonApp {
                        app_id: None,
                        package_id: Some(package_id),
                        app_name: None,
                        package_name: package_name_opt
                            .filter(|s| !s.is_empty())
                            .or_else(|| Some(format!("Package {}", package_id))),
                        launch_date,
                        days,
                    });
                }
            }
        } else {
            // No lookup table - find launch date as first date with revenue > 0
            let sql = "
                SELECT 
                    packageid,
                    MIN(date) as launch_date
                FROM sales_data
                WHERE packageid IS NOT NULL 
                  AND packageid != 0
                  AND CAST(gross_sales_usd AS REAL) > 0
                GROUP BY packageid
                ORDER BY packageid
            ";

            let mut stmt = conn.prepare(sql)?;
            let package_rows: Vec<(i64, String)> = stmt
                .query_map([], |r| {
                    let package_id: Option<i64> = r.get(0)?;
                    let launch_date: String = r.get(1)?;
                    Ok((package_id, launch_date))
                })?
                .filter_map(|row| {
                    row.ok().and_then(|(package_id_opt, launch_date)| {
                        package_id_opt.map(|package_id| (package_id, launch_date))
                    })
                })
                .collect();

            for (package_id, launch_date) in package_rows {
                let days = calculate_product_days(
                    &conn,
                    package_id,
                    &launch_date,
                    max_days,
                    "packageid",
                    &latest_date,
                )?;
                result.push(LaunchComparisonApp {
                    app_id: None,
                    package_id: Some(package_id),
                    app_name: None,
                    package_name: Some(format!("Package {}", package_id)),
                    launch_date,
                    days,
                });
            }
        }

        return Ok(result);
    }

    // App-based launch comparison
    let app_id_col = get_app_id_column(&conn);

    // Check if lookup_apps table exists
    let lookup_apps_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lookup_apps'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let mut result = Vec::new();

    if lookup_apps_exists > 0 {
        // Find launch date as first date with revenue > 0 for each app
        let sql_with_join = format!(
            "SELECT s.{}, a.app_name, MIN(s.date) as launch_date 
             FROM sales_data s 
             LEFT JOIN lookup_apps a ON s.{} = a.appid 
             WHERE s.{} IS NOT NULL AND s.{} != 0 
               AND CAST(s.gross_sales_usd AS REAL) > 0
             GROUP BY s.{} 
             ORDER BY s.{}",
            app_id_col, app_id_col, app_id_col, app_id_col, app_id_col, app_id_col
        );
        let mut stmt = conn.prepare(&sql_with_join)?;
        let app_rows: Vec<(Option<i64>, Option<String>, String)> = stmt
            .query_map([], |r| {
                let app_id: Option<i64> = r.get(0)?;
                let app_name: Option<String> = r.get(1)?;
                let launch_date: String = r.get(2)?;
                Ok((app_id, app_name, launch_date))
            })?
            .filter_map(|row| row.ok())
            .collect();

        for (app_id_opt, app_name_opt, launch_date) in app_rows {
            if let Some(app_id) = app_id_opt {
                let days = calculate_product_days(
                    &conn,
                    app_id,
                    &launch_date,
                    max_days,
                    &app_id_col,
                    &latest_date,
                )?;
                result.push(LaunchComparisonApp {
                    app_id: Some(app_id),
                    package_id: None,
                    app_name: app_name_opt
                        .filter(|s| !s.is_empty())
                        .or_else(|| Some(format!("App {}", app_id))),
                    package_name: None,
                    launch_date,
                    days,
                });
            }
        }
        return Ok(result);
    }

    // Fallback: check for app name column in sales_data
    let app_name_col = get_app_name_column(&conn);

    if app_name_col.is_some() {
        let name_col = app_name_col.as_ref().unwrap();
        // Find launch date as first date with revenue > 0
        let sql_with_name = format!(
            "SELECT {}, MAX(NULLIF({}, '')) as app_name, MIN(date) as launch_date 
             FROM sales_data 
             WHERE {} IS NOT NULL AND {} != 0 
               AND CAST(gross_sales_usd AS REAL) > 0
             GROUP BY {} 
             ORDER BY {}",
            app_id_col, name_col, app_id_col, app_id_col, app_id_col, app_id_col
        );
        let mut stmt = conn.prepare(&sql_with_name)?;
        let app_rows: Vec<(Option<i64>, Option<String>, String)> = stmt
            .query_map([], |r| {
                let app_id: Option<i64> = r.get(0)?;
                let app_name: Option<String> = r.get(1)?;
                let launch_date: String = r.get(2)?;
                Ok((app_id, app_name, launch_date))
            })?
            .filter_map(|row| row.ok())
            .collect();

        for (app_id_opt, app_name_opt, launch_date) in app_rows {
            if let Some(app_id) = app_id_opt {
                let days = calculate_product_days(
                    &conn,
                    app_id,
                    &launch_date,
                    max_days,
                    &app_id_col,
                    &latest_date,
                )?;
                result.push(LaunchComparisonApp {
                    app_id: Some(app_id),
                    package_id: None,
                    app_name: app_name_opt
                        .filter(|s| !s.is_empty())
                        .or_else(|| Some(format!("App {}", app_id))),
                    package_name: None,
                    launch_date,
                    days,
                });
            }
        }
        return Ok(result);
    }

    // No app name column - find launch date as first date with revenue > 0
    let sql = format!(
        "SELECT {}, MIN(date) as launch_date 
         FROM sales_data 
         WHERE {} IS NOT NULL AND {} != 0 
           AND CAST(gross_sales_usd AS REAL) > 0
         GROUP BY {} 
         ORDER BY {}",
        app_id_col, app_id_col, app_id_col, app_id_col, app_id_col
    );
    let mut stmt = conn.prepare(&sql)?;
    let app_rows: Vec<(i64, String)> = stmt
        .query_map([], |r| {
            let app_id: Option<i64> = r.get(0)?;
            let launch_date: String = r.get(1)?;
            Ok((app_id, launch_date))
        })?
        .filter_map(|row| {
            row.ok().and_then(|(app_id_opt, launch_date)| {
                app_id_opt.map(|app_id| (app_id, launch_date))
            })
        })
        .collect();

    for (app_id, launch_date) in app_rows {
        let days = calculate_product_days(
            &conn,
            app_id,
            &launch_date,
            max_days,
            &app_id_col,
            &latest_date,
        )?;
        result.push(LaunchComparisonApp {
            app_id: Some(app_id),
            package_id: None,
            app_name: Some(format!("App {}", app_id)),
            package_name: None,
            launch_date,
            days,
        });
    }

    Ok(result)
}

// ==================== Tauri Commands ====================

#[tauri::command]
pub async fn query_stats(filters: QueryFilters) -> Result<DashboardStats, String> {
    get_stats(filters).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_sales(filters: QueryFilters) -> Result<SalesResponse, String> {
    get_sales(filters).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_daily_summaries(filters: QueryFilters) -> Result<Vec<DailySummary>, String> {
    get_daily_summaries(filters).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_app_summaries(filters: QueryFilters) -> Result<Vec<AppSummary>, String> {
    get_app_summaries(filters).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_country_summaries(filters: QueryFilters) -> Result<Vec<CountrySummary>, String> {
    get_country_summaries(filters).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_apps_lookup() -> Result<Vec<AppLookup>, String> {
    get_apps_lookup().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_countries_lookup() -> Result<Vec<CountryLookup>, String> {
    get_countries_lookup().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_dates_list() -> Result<Vec<String>, String> {
    get_dates_list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_raw_data_by_date(date: String) -> Result<Vec<SalesRecord>, String> {
    get_raw_data_by_date(&date).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_packages_lookup() -> Result<Vec<PackageLookup>, String> {
    get_packages_lookup().map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn query_packages_by_app(appId: i64) -> Result<Vec<PackageLookup>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    // Check if lookup_packages table exists
    let lookup_packages_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lookup_packages'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if lookup_packages_exists > 0 {
        // Get the app ID column name
        let app_id_col = get_app_id_column(&conn);

        // Query packages where primary_app_id matches
        let sql = format!(
            "SELECT DISTINCT s.packageid, p.package_name 
             FROM sales_data s 
             JOIN lookup_packages p ON s.packageid = p.packageid 
             WHERE s.packageid IS NOT NULL 
               AND s.packageid != 0 
               AND s.{} = ?
             ORDER BY s.packageid",
            app_id_col
        );

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([appId], |row| {
                let package_id: Option<i64> = row.get(0)?;
                let package_name: Option<String> = row.get(1)?;
                Ok((package_id, package_name))
            })
            .map_err(|e| e.to_string())?;

        let mut packages = Vec::new();
        for row in rows {
            if let (Some(package_id), package_name_opt) = row.map_err(|e| e.to_string())? {
                if package_id != 0 {
                    packages.push(PackageLookup {
                        package_id,
                        package_name: package_name_opt
                            .unwrap_or_else(|| format!("Package {}", package_id)),
                    });
                }
            }
        }
        Ok(packages)
    } else {
        // Fallback: query directly from sales_data
        let app_id_col = get_app_id_column(&conn);
        let sql = format!(
            "SELECT DISTINCT packageid 
             FROM sales_data 
             WHERE packageid IS NOT NULL 
               AND packageid != 0 
               AND {} = ?
             ORDER BY packageid",
            app_id_col
        );

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([appId], |row| {
                let package_id: Option<i64> = row.get(0)?;
                Ok(package_id)
            })
            .map_err(|e| e.to_string())?;

        let mut packages = Vec::new();
        for row in rows {
            if let Some(package_id) = row.map_err(|e| e.to_string())? {
                if package_id != 0 {
                    packages.push(PackageLookup {
                        package_id,
                        package_name: format!("Package {}", package_id),
                    });
                }
            }
        }
        Ok(packages)
    }
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn query_product_stats(
    productType: String,
    productId: i64,
) -> Result<ProductStats, String> {
    get_product_stats(&productType, productId).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn query_launch_comparison(
    maxDays: u32,
    productType: String,
) -> Result<Vec<LaunchComparisonApp>, String> {
    get_launch_comparison(maxDays, &productType).map_err(|e| e.to_string())
}
