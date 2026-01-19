// Sales data database operations

use super::{Database, DatabaseError};
use crate::types::{Filters, SalesRecord};
use rusqlite::params;
use std::collections::HashSet;

impl Database {
    pub fn get_sales(&self, filters: &Filters) -> Result<Vec<SalesRecord>, DatabaseError> {
        let mut query = String::from(
            "SELECT id, date, app_id, app_name, package_id, country_code, units_sold, 
                    gross_revenue, net_revenue, currency, api_key_id 
             FROM sales WHERE 1=1",
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref start_date) = filters.start_date {
            query.push_str(" AND date >= ?");
            params_vec.push(Box::new(start_date.clone()));
        }

        if let Some(ref end_date) = filters.end_date {
            query.push_str(" AND date <= ?");
            params_vec.push(Box::new(end_date.clone()));
        }

        if let Some(app_id) = filters.app_id {
            query.push_str(" AND app_id = ?");
            params_vec.push(Box::new(app_id));
        }

        if let Some(ref country_code) = filters.country_code {
            query.push_str(" AND country_code = ?");
            params_vec.push(Box::new(country_code.clone()));
        }

        if let Some(ref api_key_id) = filters.api_key_id {
            query.push_str(" AND api_key_id = ?");
            params_vec.push(Box::new(api_key_id.clone()));
        }

        query.push_str(" ORDER BY date DESC");

        let mut stmt = self.conn.prepare(&query)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        let records = stmt
            .query_map(params_refs.as_slice(), |row| {
                let app_id: i64 = row.get(2)?;
                let units_sold: i64 = row.get(6)?;

                Ok(SalesRecord {
                    id: Some(row.get(0)?),
                    date: row.get(1)?,
                    app_id,
                    app_name: row.get(3)?,
                    country_code: row.get(5)?,
                    units_sold,
                    gross_sales_usd: Some(row.get(7)?),
                    net_sales_usd: Some(row.get(8)?),
                    currency: Some(row.get(9)?),
                    api_key_id: row.get(10)?,
                    // Set required fields
                    line_item_type: "Package".to_string(),
                    // Optional fields default to None
                    partnerid: None,
                    primary_appid: Some(app_id),
                    packageid: Some(row.get(4)?),
                    bundleid: None,
                    appid: None,
                    game_item_id: None,
                    platform: None,
                    base_price: None,
                    sale_price: None,
                    avg_sale_price_usd: None,
                    package_sale_type: None,
                    gross_units_sold: Some(units_sold),
                    gross_units_returned: None,
                    gross_units_activated: None,
                    net_units_sold: Some(units_sold),
                    gross_returns_usd: None,
                    net_tax_usd: None,
                    combined_discount_id: None,
                    total_discount_percentage: None,
                    additional_revenue_share_tier: None,
                    key_request_id: None,
                    viw_grant_partnerid: None,
                    package_name: None,
                    bundle_name: None,
                    partner_name: None,
                    country_name: None,
                    region: None,
                    game_item_description: None,
                    game_item_category: None,
                    key_request_notes: None,
                    game_code_description: None,
                    combined_discount_name: None,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(records)
    }

    pub fn save_sales(&self, data: &[SalesRecord], api_key_id: &str) -> Result<(), DatabaseError> {
        let tx = self.conn.unchecked_transaction()?;

        {
            let mut stmt = tx.prepare(
                "INSERT INTO sales (
                    id, date, app_id, app_name, package_id, country_code, units_sold, 
                    gross_revenue, net_revenue, currency, api_key_id, line_item_type,
                    partnerid, primary_appid, bundleid, appid, game_item_id, platform,
                    base_price, sale_price, avg_sale_price_usd, package_sale_type,
                    gross_units_sold, gross_units_returned, gross_units_activated, net_units_sold,
                    gross_sales_usd, gross_returns_usd, net_sales_usd, net_tax_usd,
                    combined_discount_id, total_discount_percentage, additional_revenue_share_tier,
                    key_request_id, viw_grant_partnerid
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) 
                 DO UPDATE SET
                   date = excluded.date,
                   app_id = excluded.app_id,
                   app_name = excluded.app_name,
                   package_id = excluded.package_id,
                   country_code = excluded.country_code,
                   units_sold = excluded.units_sold,
                   gross_revenue = excluded.gross_revenue,
                   net_revenue = excluded.net_revenue,
                   currency = excluded.currency,
                   api_key_id = excluded.api_key_id,
                   line_item_type = excluded.line_item_type,
                   partnerid = excluded.partnerid,
                   primary_appid = excluded.primary_appid,
                   bundleid = excluded.bundleid,
                   appid = excluded.appid,
                   game_item_id = excluded.game_item_id,
                   platform = excluded.platform,
                   base_price = excluded.base_price,
                   sale_price = excluded.sale_price,
                   avg_sale_price_usd = excluded.avg_sale_price_usd,
                   package_sale_type = excluded.package_sale_type,
                   gross_units_sold = excluded.gross_units_sold,
                   gross_units_returned = excluded.gross_units_returned,
                   gross_units_activated = excluded.gross_units_activated,
                   net_units_sold = excluded.net_units_sold,
                   gross_sales_usd = excluded.gross_sales_usd,
                   gross_returns_usd = excluded.gross_returns_usd,
                   net_sales_usd = excluded.net_sales_usd,
                   net_tax_usd = excluded.net_tax_usd,
                   combined_discount_id = excluded.combined_discount_id,
                   total_discount_percentage = excluded.total_discount_percentage,
                   additional_revenue_share_tier = excluded.additional_revenue_share_tier,
                   key_request_id = excluded.key_request_id,
                   viw_grant_partnerid = excluded.viw_grant_partnerid",
            )?;

            for record in data {
                // Ensure id is set (should always be set by generate_unique_key)
                let id = record.id.as_ref().ok_or_else(|| {
                    DatabaseError::Sqlite(rusqlite::Error::InvalidColumnType(
                        0,
                        "id".to_string(),
                        rusqlite::types::Type::Null,
                    ))
                })?;

                stmt.execute(params![
                    id,
                    record.date,
                    record.app_id,
                    record.app_name,
                    record.packageid.unwrap_or(0),
                    record.country_code,
                    record.units_sold,
                    record.gross_sales_usd.unwrap_or(0.0),
                    record.net_sales_usd.unwrap_or(0.0),
                    record.currency.as_deref().unwrap_or("USD"),
                    api_key_id,
                    record.line_item_type,
                    record.partnerid,
                    record.primary_appid,
                    record.bundleid,
                    record.appid,
                    record.game_item_id,
                    record.platform,
                    record.base_price,
                    record.sale_price,
                    record.avg_sale_price_usd,
                    record.package_sale_type,
                    record.gross_units_sold,
                    record.gross_units_returned,
                    record.gross_units_activated,
                    record.net_units_sold,
                    record.gross_sales_usd,
                    record.gross_returns_usd,
                    record.net_sales_usd,
                    record.net_tax_usd,
                    record.combined_discount_id,
                    record.total_discount_percentage,
                    record.additional_revenue_share_tier,
                    record.key_request_id,
                    record.viw_grant_partnerid
                ])?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    // Highwatermark operations
    pub fn get_highwatermark(&self, api_key_id: &str) -> Result<i64, DatabaseError> {
        let key = format!("highwatermark:{}", api_key_id);
        let result = self.conn.query_row(
            "SELECT value FROM sync_meta WHERE key = ?",
            params![key],
            |row| row.get::<_, String>(0),
        );

        match result {
            Ok(value) => Ok(value.parse().unwrap_or(0)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(0),
            Err(e) => Err(DatabaseError::Sqlite(e)),
        }
    }

    pub fn set_highwatermark(&self, api_key_id: &str, value: i64) -> Result<(), DatabaseError> {
        let key = format!("highwatermark:{}", api_key_id);
        self.conn.execute(
            "INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)",
            params![key, value.to_string()],
        )?;
        Ok(())
    }

    pub fn get_existing_dates(&self, api_key_id: &str) -> Result<HashSet<String>, DatabaseError> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT date FROM sales WHERE api_key_id = ?")?;

        let dates: HashSet<String> = stmt
            .query_map(params![api_key_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(dates)
    }
}
