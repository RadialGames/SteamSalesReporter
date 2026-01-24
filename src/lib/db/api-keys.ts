/**
 * API Key Metadata Storage
 *
 * Stores API key metadata (id, displayName, keyHash, createdAt) in SQLite.
 * The actual key values are stored in:
 * - Tauri mode: Secure storage (OS keychain)
 * - Browser mode: localStorage
 */

import { sql } from './sqlite';
import type { ApiKeyMetadata } from './sqlite-schema';
import type { ApiKeyInfo } from '$lib/services/types';

// Re-export the type
export type { ApiKeyMetadata };

/**
 * Convert DB record to ApiKeyInfo
 */
function toInfo(record: ApiKeyMetadata): ApiKeyInfo {
  return {
    id: record.id,
    displayName: record.display_name,
    keyHash: record.key_hash,
    createdAt: record.created_at,
  };
}

/**
 * Get all API keys
 */
export async function getAllApiKeys(): Promise<ApiKeyInfo[]> {
  try {
    const results = (await sql`
      SELECT id, display_name, key_hash, created_at 
      FROM api_keys 
      ORDER BY created_at DESC
    `) as ApiKeyMetadata[];

    const keys = results.map(toInfo);
    console.log(`[getAllApiKeys] Found ${keys.length} API key(s) in database`);
    return keys;
  } catch (error) {
    console.error('[getAllApiKeys] Error querying database:', error);
    throw error;
  }
}

/**
 * Get a specific API key metadata
 */
export async function getApiKeyMetadata(id: string): Promise<ApiKeyInfo | null> {
  const result = (await sql`
    SELECT id, display_name, key_hash, created_at 
    FROM api_keys 
    WHERE id = ${id}
  `) as ApiKeyMetadata[];

  return result[0] ? toInfo(result[0]) : null;
}

/**
 * Add API key metadata
 */
export async function addApiKeyMetadata(info: ApiKeyInfo): Promise<void> {
  try {
    await sql`
      INSERT OR REPLACE INTO api_keys (id, display_name, key_hash, created_at)
      VALUES (${info.id}, ${info.displayName ?? null}, ${info.keyHash}, ${info.createdAt})
    `;
    console.log(`[addApiKeyMetadata] Successfully inserted/updated API key metadata for id: ${info.id}`);
  } catch (error) {
    console.error('[addApiKeyMetadata] Error inserting API key metadata:', error);
    throw error;
  }
}

/**
 * Update API key display name
 */
export async function updateApiKeyName(id: string, displayName: string): Promise<void> {
  await sql`UPDATE api_keys SET display_name = ${displayName} WHERE id = ${id}`;
}

/**
 * Delete API key metadata
 */
export async function deleteApiKeyMetadata(id: string): Promise<void> {
  await sql`DELETE FROM api_keys WHERE id = ${id}`;
}

/**
 * Clear all API key metadata
 */
export async function clearAllApiKeyMetadata(): Promise<void> {
  await sql`DELETE FROM api_keys`;
}
