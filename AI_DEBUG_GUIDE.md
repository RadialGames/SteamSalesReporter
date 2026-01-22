# AI Debug Guide - Steam Sales Reporter

This guide enables AI agents to debug database queries and calculations without launching the full application.

## Quick Start

1. **Ask user to export database**: In the app, go to the Database Statistics panel and click "Export for CLI"
2. **Default export path**: `~/steam-sales-debug.db`
3. **Run CLI commands**:
   ```bash
   npm run debug:db stats ~/steam-sales-debug.db
   ```

## CLI Commands Reference

### stats
Show database statistics (row counts for all tables).

```bash
npm run debug:db stats ~/steam-sales-debug.db
```

**Output**: Row counts for raw_api_data, parsed_sales, aggregates, cache tables, etc.

### apps
List all apps with revenue totals, sorted by revenue descending.

```bash
npm run debug:db apps ~/steam-sales-debug.db
```

**Output**: App ID, name, total revenue, total units, record count.

### countries
List revenue breakdown by country.

```bash
npm run debug:db countries ~/steam-sales-debug.db
```

**Output**: Country code, revenue, percentage of total, units, records.

### daily [days]
Show daily revenue for the last N days (default: 30).

```bash
npm run debug:db daily 7 ~/steam-sales-debug.db
npm run debug:db daily 30 ~/steam-sales-debug.db
```

**Output**: Date, revenue, units, record count per day.

### query \<sql\>
Execute arbitrary SQL query (read-only).

```bash
npm run debug:db query "SELECT * FROM parsed_sales LIMIT 5" ~/steam-sales-debug.db
npm run debug:db query "SELECT COUNT(*) FROM parsed_sales WHERE app_id = 1149000" ~/steam-sales-debug.db
```

**Output**: JSON results of the query.

### launch \<appId\> [days]
Show launch day metrics for an app (day-by-day breakdown from launch).

```bash
npm run debug:db launch 1149000 ~/steam-sales-debug.db
npm run debug:db launch 1149000 14 ~/steam-sales-debug.db
```

**Output**: Day offset, date, sold, returned, activated, net units, revenue.

### filters
Show available filter values (date range, apps, countries, API keys).

```bash
npm run debug:db filters ~/steam-sales-debug.db
```

**Output**: Date range, list of apps, list of countries, API keys.

### app \<appId\>
Debug unit metrics for a specific app (finds discrepancies).

```bash
npm run debug:db app 1149000 ~/steam-sales-debug.db
```

**Output**: 
- Query by app_id only (sold, returned, activated, net units, revenue)
- All activations for packages of this app (regardless of app_id)
- Activations with app_id=0 for these packages
- Package IDs for this app
- Summary comparing frontend vs backend totals

### packages [appId]
List packages, optionally filtered by app.

```bash
npm run debug:db packages ~/steam-sales-debug.db
npm run debug:db packages 1149000 ~/steam-sales-debug.db
```

**Output**: Package ID, name, revenue, sold, activated.

### raw [limit]
Show raw API data records (default: 10).

```bash
npm run debug:db raw ~/steam-sales-debug.db
npm run debug:db raw 20 ~/steam-sales-debug.db
```

**Output**: Date, status, response size, endpoint.

---

## Database Schema

### Tier 1: Raw API Data

#### raw_api_data
Source of truth - complete Steam API JSON responses.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key |
| api_key_id | TEXT | Which API key fetched this |
| date | TEXT | Date of the sales data (YYYY-MM-DD) |
| endpoint | TEXT | API endpoint called |
| response_json | TEXT | Complete JSON response |
| fetched_at | INTEGER | Unix timestamp when fetched |
| status | TEXT | 'raw', 'parsing', 'parsed', 'error' |

### Tier 2: Parsed Sales Records

#### parsed_sales
Main table for querying sales data.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key (unique record hash) |
| api_key_id | TEXT | Which API key this data came from |
| date | TEXT | Date (YYYY-MM-DD) |
| app_id | INTEGER | Primary app ID (denormalized) |
| primary_appid | INTEGER | Primary app from API |
| packageid | INTEGER | Package ID |
| bundleid | INTEGER | Bundle ID (if part of bundle) |
| country_code | TEXT | 2-letter country code |
| gross_units_sold | INTEGER | Units sold |
| gross_units_returned | INTEGER | Units returned/refunded |
| gross_units_activated | INTEGER | Units activated (retail keys) |
| net_units_sold | INTEGER | Net units from API |
| gross_sales_usd | REAL | Gross revenue USD |
| gross_returns_usd | REAL | Returns USD |
| net_sales_usd | REAL | Net revenue USD |
| net_tax_usd | REAL | Tax USD |
| app_name | TEXT | Denormalized app name |
| package_name | TEXT | Denormalized package name |
| country_name | TEXT | Denormalized country name |
| region | TEXT | Region from country_info |

**Key Indexes**:
- Single-column: date, app_id, country_code, api_key_id, packageid
- Composite: (date, app_id), (date, country_code), (api_key_id, date), (app_id, country_code, date)

### Tier 3: Aggregates

#### daily_aggregates
Pre-computed daily summaries.

| Column | Type |
|--------|------|
| date | TEXT (PK) |
| total_revenue | REAL |
| total_units | INTEGER |
| record_count | INTEGER |

#### app_aggregates
Pre-computed per-app summaries.

| Column | Type |
|--------|------|
| app_id | INTEGER (PK) |
| app_name | TEXT |
| total_revenue | REAL |
| total_units | INTEGER |
| record_count | INTEGER |
| first_sale_date | TEXT |
| last_sale_date | TEXT |

#### country_aggregates
Pre-computed per-country summaries.

| Column | Type |
|--------|------|
| country_code | TEXT (PK) |
| total_revenue | REAL |
| total_units | INTEGER |
| record_count | INTEGER |

### Tier 4: Display Cache

#### display_cache
Key-value store for pre-computed UI data.

| Column | Type |
|--------|------|
| key | TEXT (PK) |
| value | TEXT (JSON) |
| computed_at | INTEGER |

### Tier 5: Data State

#### data_state
Key-value store for processing state and dirty flags.

| Column | Type |
|--------|------|
| key | TEXT (PK) |
| value | TEXT |

### Other Tables

#### api_keys
API key metadata (actual keys stored in secure storage).

| Column | Type |
|--------|------|
| id | TEXT (PK) |
| display_name | TEXT |
| key_hash | TEXT |
| created_at | INTEGER |

#### sync_tasks
Sync task queue.

| Column | Type |
|--------|------|
| id | TEXT (PK) |
| api_key_id | TEXT |
| date | TEXT |
| status | TEXT ('todo', 'in_progress', 'done') |
| created_at | INTEGER |
| completed_at | INTEGER |

---

## Common Debug Queries

### Count records by app
```sql
SELECT app_id, app_name, COUNT(*) as records, SUM(net_sales_usd) as revenue
FROM parsed_sales
GROUP BY app_id
ORDER BY revenue DESC
```

### Find revenue discrepancy for an app
```sql
-- Direct app_id query
SELECT 
  SUM(ABS(gross_units_sold)) as sold,
  SUM(ABS(gross_units_returned)) as returned,
  SUM(ABS(gross_units_activated)) as activated,
  SUM(net_sales_usd) as revenue
FROM parsed_sales
WHERE app_id = 1149000

-- All packages for this app (may have different app_id)
SELECT 
  SUM(ABS(gross_units_activated)) as activated
FROM parsed_sales
WHERE packageid IN (
  SELECT DISTINCT packageid 
  FROM parsed_sales 
  WHERE app_id = 1149000 AND packageid IS NOT NULL
)
AND gross_units_activated != 0
```

### Check for app_id=0 records (often retail key activations)
```sql
SELECT COUNT(*), SUM(ABS(gross_units_activated))
FROM parsed_sales
WHERE app_id = 0 AND gross_units_activated != 0
```

### Date range of data
```sql
SELECT MIN(date) as first_date, MAX(date) as last_date, COUNT(DISTINCT date) as days
FROM parsed_sales
```

### Revenue by date range
```sql
SELECT date, SUM(net_sales_usd) as revenue, SUM(ABS(gross_units_sold)) as units
FROM parsed_sales
WHERE date BETWEEN '2024-01-01' AND '2024-01-31'
GROUP BY date
ORDER BY date
```

### Find duplicate records
```sql
SELECT id, COUNT(*) as cnt
FROM parsed_sales
GROUP BY id
HAVING cnt > 1
```

### Check raw data processing status
```sql
SELECT status, COUNT(*) as count
FROM raw_api_data
GROUP BY status
```

---

## Calculation Formulas

### Net Units
The canonical formula used throughout the app:

```
netUnits = grossUnitsSold + grossUnitsActivated - grossUnitsReturned
```

Note: Values are normalized using `Math.abs()` because Steam's API may return negative values for returns.

### Launch Day Calculation
Launch date is determined as the earliest date with `netSalesUsd > 0`. Records are then aggregated by day offset from launch.

---

## Troubleshooting

### "Database file not found"
1. Export the database from the app first
2. Check the path is correct (default: `~/steam-sales-debug.db`)
3. Ensure the file exists: `ls -la ~/steam-sales-debug.db`

### "No results" for queries
1. Check if data exists: `npm run debug:db stats ~/steam-sales-debug.db`
2. If `parsed_sales` is 0, data hasn't been synced or parsed yet
3. Run aggregation in the app if aggregate tables are empty

### Discrepancy between frontend and backend numbers
1. Use `npm run debug:db app <appId>` to debug
2. Check for records with `app_id=0` (retail key activations)
3. Check if packages are shared across multiple apps

### Slow queries
1. Use aggregate tables when possible (daily_aggregates, app_aggregates)
2. Add LIMIT to queries
3. Use indexed columns in WHERE clauses (date, app_id, country_code)

---

## File Locations

| File | Purpose |
|------|---------|
| `src/scripts/debug-queries.ts` | CLI debug tool source |
| `src/lib/db/sqlite.ts` | Database connection & export functions |
| `src/lib/db/sqlite-schema.ts` | Schema definitions & TypeScript types |
| `src/lib/utils/calculations.ts` | Pure calculation functions |
| `src/lib/utils/launch-metrics.ts` | Launch day metrics |
| `src/lib/db/aggregates.ts` | Aggregation queries |
| `src/lib/db/parsed-data.ts` | Parsed sales queries |

---

## Example Debugging Session

```bash
# 1. Check database has data
npm run debug:db stats ~/steam-sales-debug.db

# 2. See what apps exist
npm run debug:db apps ~/steam-sales-debug.db

# 3. Check specific app metrics
npm run debug:db app 1149000 ~/steam-sales-debug.db

# 4. View launch performance
npm run debug:db launch 1149000 14 ~/steam-sales-debug.db

# 5. Run custom query
npm run debug:db query "SELECT date, SUM(net_sales_usd) FROM parsed_sales WHERE app_id = 1149000 GROUP BY date ORDER BY date DESC LIMIT 7" ~/steam-sales-debug.db
```
