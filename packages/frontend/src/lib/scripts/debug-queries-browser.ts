/**
 * Browser-based debug script for running database queries
 *
 * Usage: In browser console, run:
 *   await window.debugQueries.checkApp(1149000)
 */

import { sql } from '../db/sqlite';

export async function checkApp(appId: number) {
  console.log(`\n=== Checking App ID ${appId} ===\n`);

  // Query by app_id only
  const appIdResult = (
    (await sql`
    SELECT 
      COALESCE(SUM(ABS(gross_units_sold)), 0) as gross_sold,
      COALESCE(SUM(ABS(gross_units_returned)), 0) as gross_returned,
      COALESCE(SUM(ABS(gross_units_activated)), 0) as gross_activated,
      COUNT(*) as total_records
    FROM parsed_sales
    WHERE app_id = ${appId}
  `) as {
      gross_sold: number;
      gross_returned: number;
      gross_activated: number;
      total_records: number;
    }[]
  )[0];

  console.log('Query by app_id only:');
  console.log(`  Sold: ${appIdResult?.gross_sold ?? 0}`);
  console.log(`  Returned: ${appIdResult?.gross_returned ?? 0}`);
  console.log(`  Activated: ${appIdResult?.gross_activated ?? 0}`);
  console.log(`  Total Records: ${appIdResult?.total_records ?? 0}`);

  // Query all activations for packages of this app (regardless of app_id)
  const allPackageActivations = (
    (await sql`
    SELECT 
      COALESCE(SUM(ABS(gross_units_activated)), 0) as gross_activated,
      COUNT(*) as total_records,
      COUNT(DISTINCT app_id) as distinct_app_ids
    FROM parsed_sales
    WHERE packageid IN (SELECT DISTINCT packageid FROM parsed_sales WHERE app_id = ${appId} AND packageid IS NOT NULL)
    AND gross_units_activated != 0
  `) as {
      gross_activated: number;
      total_records: number;
      distinct_app_ids: number;
    }[]
  )[0];

  console.log('\nAll activations for packages of this app (regardless of app_id):');
  console.log(`  Activated: ${allPackageActivations?.gross_activated ?? 0}`);
  console.log(`  Total Records: ${allPackageActivations?.total_records ?? 0}`);
  console.log(`  Distinct app_ids: ${allPackageActivations?.distinct_app_ids ?? 0}`);

  // Query specifically for app_id = 0 or primary_appid = 0 for these packages
  const zeroAppIdActivations = (
    (await sql`
    SELECT 
      COALESCE(SUM(ABS(gross_units_activated)), 0) as gross_activated,
      COUNT(*) as total_records
    FROM parsed_sales
    WHERE packageid IN (SELECT DISTINCT packageid FROM parsed_sales WHERE app_id = ${appId} AND packageid IS NOT NULL)
    AND gross_units_activated != 0
    AND (app_id = 0 OR primary_appid = 0)
  `) as {
      gross_activated: number;
      total_records: number;
    }[]
  )[0];

  console.log('\nActivations with app_id=0 or primary_appid=0 for these packages:');
  console.log(`  Activated: ${zeroAppIdActivations?.gross_activated ?? 0}`);
  console.log(`  Total Records: ${zeroAppIdActivations?.total_records ?? 0}`);

  // Get package IDs
  const packageIds = (await sql`
    SELECT DISTINCT packageid 
    FROM parsed_sales 
    WHERE app_id = ${appId} AND packageid IS NOT NULL
  `) as { packageid: number }[];

  console.log(`\nPackage IDs for this app: ${packageIds.map((p) => p.packageid).join(', ')}`);

  const difference =
    (allPackageActivations?.gross_activated ?? 0) - (appIdResult?.gross_activated ?? 0);
  console.log(`\n=== Summary ===`);
  console.log(`Frontend (app_id only): ${appIdResult?.gross_activated ?? 0}`);
  console.log(`Backend (all packages): ${allPackageActivations?.gross_activated ?? 0}`);
  console.log(`Difference: ${difference}`);
  console.log(`Missing units (app_id=0): ${zeroAppIdActivations?.gross_activated ?? 0}`);

  return {
    appIdOnly: appIdResult?.gross_activated ?? 0,
    allPackages: allPackageActivations?.gross_activated ?? 0,
    appIdZero: zeroAppIdActivations?.gross_activated ?? 0,
    difference,
  };
}
