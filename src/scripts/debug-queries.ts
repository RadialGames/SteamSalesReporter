/**
 * CLI Debug Tool for Steam Sales Reporter
 *
 * This script provides database queries and calculations for debugging
 * without needing to launch the full application.
 *
 * Usage: npm run debug:db <command> [options] <dbPath>
 *
 * Commands:
 *   stats              - Show database statistics (table row counts)
 *   apps               - List all apps with revenue totals
 *   countries          - List country breakdown
 *   daily [days]       - Show daily revenue for last N days (default: 30)
 *   query <sql>        - Execute arbitrary SQL query
 *   launch <appId>     - Show launch day metrics for an app
 *   filters            - Show available filter values (date range, apps, countries)
 *   app <appId>        - Debug unit metrics for a specific app
 *   packages [appId]   - List packages, optionally filtered by app
 *   raw [limit]        - Show raw API data records
 *
 * Examples:
 *   npm run debug:db stats ~/steam-sales-debug.db
 *   npm run debug:db apps ~/steam-sales-debug.db
 *   npm run debug:db daily 7 ~/steam-sales-debug.db
 *   npm run debug:db query "SELECT * FROM parsed_sales LIMIT 5" ~/steam-sales-debug.db
 *   npm run debug:db launch 1149000 ~/steam-sales-debug.db
 *   npm run debug:db app 1149000 ~/steam-sales-debug.db
 */

import Database from 'better-sqlite3';

// ============================================================================
// Calculation Functions (imported logic from src/lib/utils/calculations.ts)
// ============================================================================

// UnitMetrics interface kept for documentation - matches src/lib/utils/calculations.ts
interface _UnitMetrics {
  grossSold: number;
  grossReturned: number;
  grossActivated: number;
}

// Using the convenience function that handles Math.abs() for Steam API quirks
function calculateNetUnitsFromValues(
  grossSold: number,
  grossActivated: number,
  grossReturned: number
): number {
  return Math.abs(grossSold) + Math.abs(grossActivated) - Math.abs(grossReturned);
}

// ============================================================================
// Formatting Utilities
// ============================================================================

function formatNumber(num: number): string {
  return num.toLocaleString();
}

function formatCurrency(num: number): string {
  return (
    '$' + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function formatPercent(num: number): string {
  return num.toFixed(1) + '%';
}

function padRight(str: string, len: number): string {
  return str.padEnd(len);
}

function padLeft(str: string, len: number): string {
  return str.padStart(len);
}

// ============================================================================
// Database Connection
// ============================================================================

function openDatabase(dbPath: string): Database.Database {
  try {
    return new Database(dbPath, { readonly: true });
  } catch (error) {
    console.error(`Error opening database: ${dbPath}`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Show database statistics (table row counts)
 */
function cmdStats(db: Database.Database): void {
  console.log('\n=== Database Statistics ===\n');

  const tables = [
    { name: 'raw_api_data', label: 'Raw API Data' },
    { name: 'parsed_sales', label: 'Parsed Sales' },
    { name: 'daily_aggregates', label: 'Daily Aggregates' },
    { name: 'app_aggregates', label: 'App Aggregates' },
    { name: 'country_aggregates', label: 'Country Aggregates' },
    { name: 'display_cache', label: 'Display Cache' },
    { name: 'data_state', label: 'Data State' },
    { name: 'api_keys', label: 'API Keys' },
    { name: 'sync_tasks', label: 'Sync Tasks' },
  ];

  let total = 0;
  for (const table of tables) {
    try {
      const result = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as {
        count: number;
      };
      console.log(`${padRight(table.label + ':', 20)} ${padLeft(formatNumber(result.count), 10)}`);
      total += result.count;
    } catch {
      console.log(`${padRight(table.label + ':', 20)} ${padLeft('(error)', 10)}`);
    }
  }
  console.log('-'.repeat(31));
  console.log(`${padRight('Total:', 20)} ${padLeft(formatNumber(total), 10)}`);
}

/**
 * List all apps with revenue totals
 */
function cmdApps(db: Database.Database): void {
  console.log('\n=== Apps by Revenue ===\n');

  const apps = db
    .prepare(
      `
    SELECT 
      app_id,
      app_name,
      total_revenue,
      total_units,
      record_count,
      first_sale_date,
      last_sale_date
    FROM app_aggregates
    ORDER BY total_revenue DESC
  `
    )
    .all() as {
    app_id: number;
    app_name: string;
    total_revenue: number;
    total_units: number;
    record_count: number;
    first_sale_date: string;
    last_sale_date: string;
  }[];

  if (apps.length === 0) {
    console.log('No apps found. Run aggregation first.');
    return;
  }

  console.log(
    `${padRight('App ID', 12)} ${padRight('Name', 40)} ${padLeft('Revenue', 15)} ${padLeft('Units', 10)} ${padLeft('Records', 10)}`
  );
  console.log('-'.repeat(90));

  for (const app of apps) {
    const name = (app.app_name || 'Unknown').slice(0, 38);
    console.log(
      `${padRight(String(app.app_id), 12)} ${padRight(name, 40)} ${padLeft(formatCurrency(app.total_revenue), 15)} ${padLeft(formatNumber(app.total_units), 10)} ${padLeft(formatNumber(app.record_count), 10)}`
    );
  }

  console.log('-'.repeat(90));
  console.log(`Total: ${apps.length} apps`);
}

/**
 * List country breakdown
 */
function cmdCountries(db: Database.Database): void {
  console.log('\n=== Revenue by Country ===\n');

  const countries = db
    .prepare(
      `
    SELECT 
      country_code,
      total_revenue,
      total_units,
      record_count
    FROM country_aggregates
    ORDER BY total_revenue DESC
  `
    )
    .all() as {
    country_code: string;
    total_revenue: number;
    total_units: number;
    record_count: number;
  }[];

  if (countries.length === 0) {
    console.log('No country data found. Run aggregation first.');
    return;
  }

  // Calculate total for percentages
  const totalRevenue = countries.reduce((sum, c) => sum + c.total_revenue, 0);

  console.log(
    `${padRight('Country', 10)} ${padLeft('Revenue', 15)} ${padLeft('%', 8)} ${padLeft('Units', 10)} ${padLeft('Records', 10)}`
  );
  console.log('-'.repeat(55));

  for (const country of countries.slice(0, 20)) {
    const pct = totalRevenue > 0 ? (country.total_revenue / totalRevenue) * 100 : 0;
    console.log(
      `${padRight(country.country_code, 10)} ${padLeft(formatCurrency(country.total_revenue), 15)} ${padLeft(formatPercent(pct), 8)} ${padLeft(formatNumber(country.total_units), 10)} ${padLeft(formatNumber(country.record_count), 10)}`
    );
  }

  if (countries.length > 20) {
    console.log(`... and ${countries.length - 20} more countries`);
  }

  console.log('-'.repeat(55));
  console.log(`Total: ${countries.length} countries, ${formatCurrency(totalRevenue)} revenue`);
}

/**
 * Show daily revenue for last N days
 */
function cmdDaily(db: Database.Database, days: number): void {
  console.log(`\n=== Daily Revenue (Last ${days} Days) ===\n`);

  const dailyData = db
    .prepare(
      `
    SELECT 
      date,
      total_revenue,
      total_units,
      record_count
    FROM daily_aggregates
    ORDER BY date DESC
    LIMIT ?
  `
    )
    .all(days) as {
    date: string;
    total_revenue: number;
    total_units: number;
    record_count: number;
  }[];

  if (dailyData.length === 0) {
    console.log('No daily data found. Run aggregation first.');
    return;
  }

  console.log(
    `${padRight('Date', 12)} ${padLeft('Revenue', 15)} ${padLeft('Units', 10)} ${padLeft('Records', 10)}`
  );
  console.log('-'.repeat(50));

  // Reverse to show oldest first
  for (const day of [...dailyData].reverse()) {
    console.log(
      `${padRight(day.date, 12)} ${padLeft(formatCurrency(day.total_revenue), 15)} ${padLeft(formatNumber(day.total_units), 10)} ${padLeft(formatNumber(day.record_count), 10)}`
    );
  }

  const totalRevenue = dailyData.reduce((sum, d) => sum + d.total_revenue, 0);
  const totalUnits = dailyData.reduce((sum, d) => sum + d.total_units, 0);
  console.log('-'.repeat(50));
  console.log(
    `${padRight('Total:', 12)} ${padLeft(formatCurrency(totalRevenue), 15)} ${padLeft(formatNumber(totalUnits), 10)}`
  );
}

/**
 * Execute arbitrary SQL query
 */
function cmdQuery(db: Database.Database, sql: string): void {
  console.log('\n=== Query Results ===\n');
  console.log(`SQL: ${sql}\n`);

  try {
    const stmt = db.prepare(sql);
    const isSelect = sql.trim().toLowerCase().startsWith('select');

    if (isSelect) {
      const results = stmt.all();
      if (results.length === 0) {
        console.log('No results');
        return;
      }

      // Print as JSON for complex results
      console.log(JSON.stringify(results, null, 2));
      console.log(`\n(${results.length} rows)`);
    } else {
      console.log('Only SELECT queries are supported in read-only mode');
    }
  } catch (error) {
    console.error('Query error:', error instanceof Error ? error.message : error);
  }
}

/**
 * Show launch day metrics for an app
 */
function cmdLaunch(db: Database.Database, appId: number, maxDays = 30): void {
  console.log(`\n=== Launch Metrics for App ${appId} ===\n`);

  // Get all sales records for this app
  const records = db
    .prepare(
      `
    SELECT 
      date,
      gross_units_sold,
      gross_units_returned,
      gross_units_activated,
      net_sales_usd,
      bundleid
    FROM parsed_sales
    WHERE app_id = ?
    ORDER BY date ASC
  `
    )
    .all(appId) as {
    date: string;
    gross_units_sold: number;
    gross_units_returned: number;
    gross_units_activated: number;
    net_sales_usd: number;
    bundleid: number | null;
  }[];

  if (records.length === 0) {
    console.log(`No sales records found for app ${appId}`);
    return;
  }

  // Find launch date (first date with revenue > 0)
  const launchRecord = records.find((r) => r.net_sales_usd > 0);
  if (!launchRecord) {
    console.log('No revenue found for this app');
    return;
  }

  const launchDate = launchRecord.date;
  const launchTime = new Date(launchDate).getTime();
  const MS_PER_DAY = 86400000;

  console.log(`Launch Date: ${launchDate}`);
  console.log(`Total Records: ${records.length}\n`);

  // Aggregate by day offset
  const dayMap = new Map<
    number,
    {
      day: number;
      date: string;
      sold: number;
      returned: number;
      activated: number;
      revenue: number;
      bundle: number;
    }
  >();

  for (const record of records) {
    const recordTime = new Date(record.date).getTime();
    const dayOffset = Math.floor((recordTime - launchTime) / MS_PER_DAY);

    if (dayOffset < 0 || dayOffset >= maxDays) continue;

    let day = dayMap.get(dayOffset);
    if (!day) {
      day = {
        day: dayOffset,
        date: record.date,
        sold: 0,
        returned: 0,
        activated: 0,
        revenue: 0,
        bundle: 0,
      };
      dayMap.set(dayOffset, day);
    }

    day.sold += record.gross_units_sold ?? 0;
    day.returned += record.gross_units_returned ?? 0;
    day.activated += record.gross_units_activated ?? 0;
    day.revenue += record.net_sales_usd ?? 0;
    if (record.bundleid != null) {
      day.bundle += (record.gross_units_sold ?? 0) + (record.gross_units_activated ?? 0);
    }
  }

  const days = Array.from(dayMap.values()).sort((a, b) => a.day - b.day);

  console.log(
    `${padRight('Day', 5)} ${padRight('Date', 12)} ${padLeft('Sold', 8)} ${padLeft('Ret', 8)} ${padLeft('Act', 8)} ${padLeft('Net', 8)} ${padLeft('Revenue', 12)}`
  );
  console.log('-'.repeat(65));

  let totalSold = 0,
    totalReturned = 0,
    totalActivated = 0,
    totalRevenue = 0;

  for (const day of days) {
    const netUnits = calculateNetUnitsFromValues(day.sold, day.activated, day.returned);
    console.log(
      `${padRight(String(day.day), 5)} ${padRight(day.date, 12)} ${padLeft(formatNumber(day.sold), 8)} ${padLeft(formatNumber(day.returned), 8)} ${padLeft(formatNumber(day.activated), 8)} ${padLeft(formatNumber(netUnits), 8)} ${padLeft(formatCurrency(day.revenue), 12)}`
    );
    totalSold += day.sold;
    totalReturned += day.returned;
    totalActivated += day.activated;
    totalRevenue += day.revenue;
  }

  const totalNet = calculateNetUnitsFromValues(totalSold, totalActivated, totalReturned);
  console.log('-'.repeat(65));
  console.log(
    `${padRight('Total', 5)} ${padRight('', 12)} ${padLeft(formatNumber(totalSold), 8)} ${padLeft(formatNumber(totalReturned), 8)} ${padLeft(formatNumber(totalActivated), 8)} ${padLeft(formatNumber(totalNet), 8)} ${padLeft(formatCurrency(totalRevenue), 12)}`
  );
}

/**
 * Show available filter values (date range, apps, countries)
 */
function cmdFilters(db: Database.Database): void {
  console.log('\n=== Available Filter Values ===\n');

  // Date range
  const dateRange = db
    .prepare(
      `
    SELECT MIN(date) as min_date, MAX(date) as max_date, COUNT(DISTINCT date) as date_count
    FROM parsed_sales
  `
    )
    .get() as { min_date: string; max_date: string; date_count: number };

  console.log('Date Range:');
  console.log(`  From: ${dateRange.min_date || 'N/A'}`);
  console.log(`  To:   ${dateRange.max_date || 'N/A'}`);
  console.log(`  Days: ${dateRange.date_count}`);

  // Apps
  const apps = db
    .prepare(
      `
    SELECT DISTINCT app_id, app_name
    FROM parsed_sales
    WHERE app_id > 0
    ORDER BY app_id
  `
    )
    .all() as { app_id: number; app_name: string }[];

  console.log(`\nApps (${apps.length}):`);
  for (const app of apps.slice(0, 10)) {
    console.log(`  ${app.app_id}: ${app.app_name || 'Unknown'}`);
  }
  if (apps.length > 10) {
    console.log(`  ... and ${apps.length - 10} more`);
  }

  // Countries
  const countries = db
    .prepare(
      `
    SELECT DISTINCT country_code
    FROM parsed_sales
    ORDER BY country_code
  `
    )
    .all() as { country_code: string }[];

  console.log(`\nCountries (${countries.length}):`);
  console.log(`  ${countries.map((c) => c.country_code).join(', ')}`);

  // API Keys
  const apiKeys = db
    .prepare(
      `
    SELECT id, display_name, key_hash
    FROM api_keys
    ORDER BY created_at
  `
    )
    .all() as { id: string; display_name: string; key_hash: string }[];

  console.log(`\nAPI Keys (${apiKeys.length}):`);
  for (const key of apiKeys) {
    console.log(`  ${key.id}: ${key.display_name || 'Unnamed'} (${key.key_hash})`);
  }
}

/**
 * Debug unit metrics for a specific app
 */
function cmdApp(db: Database.Database, appId: number): void {
  console.log(`\n=== Debug App ${appId} ===\n`);

  // Query by app_id only
  const appIdResult = db
    .prepare(
      `
    SELECT 
      COALESCE(SUM(ABS(gross_units_sold)), 0) as gross_sold,
      COALESCE(SUM(ABS(gross_units_returned)), 0) as gross_returned,
      COALESCE(SUM(ABS(gross_units_activated)), 0) as gross_activated,
      COALESCE(SUM(net_sales_usd), 0) as net_revenue,
      COUNT(*) as total_records
    FROM parsed_sales
    WHERE app_id = ?
  `
    )
    .get(appId) as {
    gross_sold: number;
    gross_returned: number;
    gross_activated: number;
    net_revenue: number;
    total_records: number;
  };

  console.log('Query by app_id only:');
  console.log(`  Sold:      ${formatNumber(appIdResult.gross_sold)}`);
  console.log(`  Returned:  ${formatNumber(appIdResult.gross_returned)}`);
  console.log(`  Activated: ${formatNumber(appIdResult.gross_activated)}`);
  console.log(
    `  Net Units: ${formatNumber(calculateNetUnitsFromValues(appIdResult.gross_sold, appIdResult.gross_activated, appIdResult.gross_returned))}`
  );
  console.log(`  Revenue:   ${formatCurrency(appIdResult.net_revenue)}`);
  console.log(`  Records:   ${formatNumber(appIdResult.total_records)}`);

  // Query all activations for packages of this app
  const allPackageActivations = db
    .prepare(
      `
    SELECT 
      COALESCE(SUM(ABS(gross_units_activated)), 0) as gross_activated,
      COUNT(*) as total_records,
      COUNT(DISTINCT app_id) as distinct_app_ids
    FROM parsed_sales
    WHERE packageid IN (SELECT DISTINCT packageid FROM parsed_sales WHERE app_id = ? AND packageid IS NOT NULL)
    AND gross_units_activated != 0
  `
    )
    .get(appId) as {
    gross_activated: number;
    total_records: number;
    distinct_app_ids: number;
  };

  console.log('\nAll activations for packages of this app (regardless of app_id):');
  console.log(`  Activated:       ${formatNumber(allPackageActivations.gross_activated)}`);
  console.log(`  Records:         ${formatNumber(allPackageActivations.total_records)}`);
  console.log(`  Distinct app_ids: ${allPackageActivations.distinct_app_ids}`);

  // Query for app_id = 0 activations
  const zeroAppIdActivations = db
    .prepare(
      `
    SELECT 
      COALESCE(SUM(ABS(gross_units_activated)), 0) as gross_activated,
      COUNT(*) as total_records
    FROM parsed_sales
    WHERE packageid IN (SELECT DISTINCT packageid FROM parsed_sales WHERE app_id = ? AND packageid IS NOT NULL)
    AND gross_units_activated != 0
    AND (app_id = 0 OR primary_appid = 0)
  `
    )
    .get(appId) as {
    gross_activated: number;
    total_records: number;
  };

  console.log('\nActivations with app_id=0 for these packages:');
  console.log(`  Activated: ${formatNumber(zeroAppIdActivations.gross_activated)}`);
  console.log(`  Records:   ${formatNumber(zeroAppIdActivations.total_records)}`);

  // Get package IDs
  const packageIds = db
    .prepare(
      `
    SELECT DISTINCT packageid 
    FROM parsed_sales 
    WHERE app_id = ? AND packageid IS NOT NULL
  `
    )
    .all(appId) as { packageid: number }[];

  console.log(
    `\nPackage IDs for this app: ${packageIds.map((p) => p.packageid).join(', ') || 'None'}`
  );

  // Summary
  const difference = allPackageActivations.gross_activated - appIdResult.gross_activated;
  console.log('\n=== Summary ===');
  console.log(`Frontend (app_id only):    ${formatNumber(appIdResult.gross_activated)}`);
  console.log(`Backend (all packages):    ${formatNumber(allPackageActivations.gross_activated)}`);
  console.log(`Difference:                ${formatNumber(difference)}`);
  console.log(`Missing units (app_id=0):  ${formatNumber(zeroAppIdActivations.gross_activated)}`);
}

/**
 * List packages, optionally filtered by app
 */
function cmdPackages(db: Database.Database, appId?: number): void {
  console.log('\n=== Packages ===\n');

  let query = `
    SELECT 
      packageid,
      package_name,
      COUNT(*) as record_count,
      COALESCE(SUM(net_sales_usd), 0) as total_revenue,
      COALESCE(SUM(ABS(gross_units_sold)), 0) as total_sold,
      COALESCE(SUM(ABS(gross_units_activated)), 0) as total_activated
    FROM parsed_sales
    WHERE packageid IS NOT NULL
  `;

  if (appId) {
    query += ` AND app_id = ${appId}`;
  }

  query += ` GROUP BY packageid ORDER BY total_revenue DESC`;

  const packages = db.prepare(query).all() as {
    packageid: number;
    package_name: string;
    record_count: number;
    total_revenue: number;
    total_sold: number;
    total_activated: number;
  }[];

  if (packages.length === 0) {
    console.log('No packages found');
    return;
  }

  console.log(
    `${padRight('Package ID', 12)} ${padRight('Name', 35)} ${padLeft('Revenue', 12)} ${padLeft('Sold', 8)} ${padLeft('Activated', 10)}`
  );
  console.log('-'.repeat(80));

  for (const pkg of packages.slice(0, 20)) {
    const name = (pkg.package_name || 'Unknown').slice(0, 33);
    console.log(
      `${padRight(String(pkg.packageid), 12)} ${padRight(name, 35)} ${padLeft(formatCurrency(pkg.total_revenue), 12)} ${padLeft(formatNumber(pkg.total_sold), 8)} ${padLeft(formatNumber(pkg.total_activated), 10)}`
    );
  }

  if (packages.length > 20) {
    console.log(`\n... and ${packages.length - 20} more packages`);
  }
}

/**
 * Show raw API data records
 */
function cmdRaw(db: Database.Database, limit: number): void {
  console.log(`\n=== Raw API Data (Last ${limit}) ===\n`);

  const raw = db
    .prepare(
      `
    SELECT 
      id,
      api_key_id,
      date,
      endpoint,
      status,
      fetched_at,
      LENGTH(response_json) as response_size
    FROM raw_api_data
    ORDER BY fetched_at DESC
    LIMIT ?
  `
    )
    .all(limit) as {
    id: string;
    api_key_id: string;
    date: string;
    endpoint: string;
    status: string;
    fetched_at: number;
    response_size: number;
  }[];

  if (raw.length === 0) {
    console.log('No raw API data found');
    return;
  }

  console.log(
    `${padRight('Date', 12)} ${padRight('Status', 10)} ${padLeft('Size', 10)} ${padRight('Endpoint', 30)}`
  );
  console.log('-'.repeat(65));

  for (const record of raw) {
    console.log(
      `${padRight(record.date, 12)} ${padRight(record.status, 10)} ${padLeft(formatNumber(record.response_size), 10)} ${record.endpoint.slice(0, 30)}`
    );
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

function showHelp(): void {
  console.log(`
Steam Sales Reporter - CLI Debug Tool

Usage: npm run debug:db <command> [options] <dbPath>

Commands:
  stats                    Show database statistics (table row counts)
  apps                     List all apps with revenue totals
  countries                List country breakdown  
  daily [days]             Show daily revenue for last N days (default: 30)
  query <sql>              Execute arbitrary SQL query
  launch <appId> [days]    Show launch day metrics for an app
  filters                  Show available filter values
  app <appId>              Debug unit metrics for a specific app
  packages [appId]         List packages, optionally filtered by app
  raw [limit]              Show raw API data records (default: 10)

Examples:
  npm run debug:db stats ~/steam-sales-debug.db
  npm run debug:db apps ~/steam-sales-debug.db
  npm run debug:db daily 7 ~/steam-sales-debug.db
  npm run debug:db launch 1149000 ~/steam-sales-debug.db
  npm run debug:db query "SELECT COUNT(*) FROM parsed_sales" ~/steam-sales-debug.db

Notes:
  - Export database from app first: Settings > Export for CLI
  - Default export location: ~/steam-sales-debug.db
  `);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  const command = args[0];

  // Find database path (last argument that looks like a path)
  let dbPath = args[args.length - 1];
  if (!dbPath.includes('/') && !dbPath.includes('.db')) {
    // Try default location
    const { homedir } = await import('os');
    dbPath = `${homedir()}/steam-sales-debug.db`;
  }

  const db = openDatabase(dbPath);

  try {
    switch (command) {
      case 'stats':
        cmdStats(db);
        break;

      case 'apps':
        cmdApps(db);
        break;

      case 'countries':
        cmdCountries(db);
        break;

      case 'daily': {
        const days = parseInt(args[1], 10) || 30;
        cmdDaily(db, days);
        break;
      }

      case 'query': {
        const sql = args.slice(1, -1).join(' ') || args[1];
        if (!sql || sql === dbPath) {
          console.error('Usage: npm run debug:db query "<sql>" <dbPath>');
          process.exit(1);
        }
        cmdQuery(db, sql);
        break;
      }

      case 'launch': {
        const appId = parseInt(args[1], 10);
        const maxDays = parseInt(args[2], 10) || 30;
        if (isNaN(appId)) {
          console.error('Usage: npm run debug:db launch <appId> [days] <dbPath>');
          process.exit(1);
        }
        cmdLaunch(db, appId, maxDays);
        break;
      }

      case 'filters':
        cmdFilters(db);
        break;

      case 'app': {
        const appId = parseInt(args[1], 10);
        if (isNaN(appId)) {
          console.error('Usage: npm run debug:db app <appId> <dbPath>');
          process.exit(1);
        }
        cmdApp(db, appId);
        break;
      }

      case 'packages': {
        const appId = parseInt(args[1], 10);
        cmdPackages(db, isNaN(appId) ? undefined : appId);
        break;
      }

      case 'raw': {
        const limit = parseInt(args[1], 10) || 10;
        cmdRaw(db, limit);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
